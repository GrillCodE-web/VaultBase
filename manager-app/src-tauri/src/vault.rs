//! MGR-017: vault карт менеджера. Карты добавляет ТОЛЬКО менеджер (PAN живёт
//! только в его локальной SQLCipher-БД, поля зашифрованы FieldEncryption).
//! Раздача — запечатанные срезы под X25519-пубключ воркера через сервер
//! (POST /manager/api/cards/issue, см. cc-sync-server/routes/worker-cards.js).
//!
//! Жизненный цикл: pool → on_worker → (declined | pool) → burned / exported.
//! Дедуп импорта — по pan_hash (HKDF-SHA256 с локальной солью vault_salt:
//! хеш уходит на сервер как идентификатор среза, но обратно в PAN не читается).

use crate::crypto::{seal_envelope, FieldEncryption};
use crate::db::Database;
use crate::http;
use hkdf::Hkdf;
use rusqlite::params;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub const STATUSES: [&str; 5] = ["pool", "on_worker", "declined", "burned", "exported"];
const MAX_IMPORT_LINES: usize = 5000;
const MAX_SLICES_PER_ISSUE: usize = 100;
const LOST_HOURS: i64 = 24;

// ── PAN: нормализация, Luhn, хеш, маска ──────────────────────────────────────

pub fn normalize_pan(raw: &str) -> String {
    raw.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn luhn_valid(pan: &str) -> bool {
    let digits = normalize_pan(pan);
    if digits.len() < 12 || digits.len() > 19 {
        return false;
    }
    let mut sum = 0i32;
    for (i, ch) in digits.chars().rev().enumerate() {
        let mut d = ch as u32 - '0' as u32;
        if i % 2 == 1 {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d as i32;
    }
    sum % 10 == 0
}

pub fn pan_hash(salt_hex: &str, pan: &str) -> String {
    let salt = hex::decode(salt_hex).unwrap_or_default();
    let hk = Hkdf::<Sha256>::new(Some(&salt), pan.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(b"vb-vault-pan-hash-v1", &mut okm).expect("hkdf 32 bytes");
    hex::encode(okm)
}

pub fn mask_pan(pan: &str) -> String {
    let digits = normalize_pan(pan);
    let n = digits.chars().count();
    if n < 8 {
        return "*".repeat(n);
    }
    let head: String = digits.chars().take(6).collect();
    let tail: String = digits.chars().skip(n - 4).collect();
    format!("{head}{}{tail}", "*".repeat(n - 10))
}

fn masked_from_enc(enc: &FieldEncryption, pan_enc: &str) -> String {
    match enc.decrypt(pan_enc) {
        Ok(pan) => mask_pan(&pan),
        Err(_) => "****".into(),
    }
}

fn vault_salt(db: &Database) -> Result<String, String> {
    if let Some(s) = db.get_config("vault_salt") {
        return Ok(s);
    }
    let s = hex::encode(crate::crypto::generate_salt());
    db.set_config("vault_salt", &s)?;
    Ok(s)
}

// ── HTTP-хелпер ──────────────────────────────────────────────────────────────

fn api_request(db: &Database, method: &str, path: &str, body: Option<&str>) -> Result<(u16, Value), String> {
    let base = http::server_base(db);
    let token = db.get_config("license_token").ok_or("not_activated")?;
    let resp = http::request(&base, method, path, Some(&token), body)?;
    let parsed = serde_json::from_str(&resp.body).unwrap_or(Value::Null);
    Ok((resp.status, parsed))
}

fn ids_placeholders(n: usize) -> String {
    (1..=n).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",")
}

// ── Импорт ───────────────────────────────────────────────────────────────────

struct ParsedCard {
    pan: String,
    exp: String,
    cvv: String,
    extra: Value,
}

/// Строка: PAN [; exp ; cvv ; holder ; zip ; addr]. Разделитель ';' или '|'.
/// Допустим список голых PAN — остальные поля опциональны.
fn parse_card_line(line: &str) -> Result<ParsedCard, &'static str> {
    let parts: Vec<&str> = line.split([';', '|']).map(|p| p.trim()).collect();
    let pan = normalize_pan(parts[0]);
    if !luhn_valid(&pan) {
        return Err("invalid_pan");
    }
    let field = |i: usize| parts.get(i).copied().unwrap_or("").trim().to_string();
    let exp = field(1);
    let cvv = field(2);
    let holder = field(3);
    let zip = field(4);
    let addr = field(5);
    if !exp.is_empty() {
        let chars_ok = exp
            .chars()
            .enumerate()
            .all(|(i, c)| c.is_ascii_digit() || (i == 2 && c == '/'));
        if !(chars_ok && (exp.len() == 4 || exp.len() == 5)) {
            return Err("invalid_exp");
        }
    }
    if !cvv.is_empty() && !(cvv.len() >= 3 && cvv.len() <= 4 && cvv.chars().all(|c| c.is_ascii_digit())) {
        return Err("invalid_cvv");
    }
    let mut extra = Map::new();
    for (k, v) in [("holder", holder), ("zip", zip), ("addr", addr)] {
        if !v.is_empty() {
            extra.insert(k.to_string(), json!(v));
        }
    }
    Ok(ParsedCard { pan, exp, cvv, extra: Value::Object(extra) })
}

/// Импорт: дедуп по pan_hash против всего реестра (живой пул / на руках /
/// деклайны / сожжённые / выведенные). Дубли НЕ перезаписывают существующие
/// карты — «реестр сожжённых» и «на руках у воркера» блокируют повтор.
pub fn import(db: &Database, enc: &FieldEncryption, text: &str) -> Result<Value, String> {
    if text.lines().count() > MAX_IMPORT_LINES {
        return Err("too_many_lines".into());
    }
    let salt = vault_salt(db)?;

    let mut existing: std::collections::HashMap<String, String> = {
        let mut stmt = db
            .conn
            .prepare("SELECT pan_hash, status FROM card_vault")
            .map_err(|e| e.to_string())?;
        let mapped = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)));
        match mapped {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => return Err(e.to_string()),
        }
    };

    let mut duplicates: Vec<Value> = Vec::new();
    let mut invalid: Vec<Value> = Vec::new();
    let mut batch: Vec<(String, String, String, String, String, String)> = Vec::new();

    for (idx, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        match parse_card_line(line) {
            Err(reason) => invalid.push(json!({ "line": idx + 1, "reason": reason })),
            Ok(card) => {
                let h = pan_hash(&salt, &card.pan);
                if let Some(st) = existing.get(&h) {
                    duplicates.push(json!({ "pan": mask_pan(&card.pan), "existing_status": st }));
                } else {
                    existing.insert(h.clone(), "pool".to_string());
                    let exp_enc = if card.exp.is_empty() { String::new() } else { enc.encrypt(&card.exp)? };
                    let cvv_enc = if card.cvv.is_empty() { String::new() } else { enc.encrypt(&card.cvv)? };
                    let extra_enc = enc.encrypt(&card.extra.to_string())?;
                    let bin = bin6(&card.pan);
                    batch.push((h, enc.encrypt(&card.pan)?, exp_enc, cvv_enc, extra_enc, bin));
                }
            }
        }
    }

    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut ins = tx
            .prepare(
                "INSERT INTO card_vault (pan_hash, pan_enc, exp_enc, cvv_enc, extra_enc, bin, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pool')",
            )
            .map_err(|e| e.to_string())?;
        for (h, pan_enc, exp_enc, cvv_enc, extra_enc, bin) in &batch {
            ins.execute(params![h, pan_enc, exp_enc, cvv_enc, extra_enc, bin])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let added = batch.len() as u32;
    if added > 0 {
        db.log_event(
            "vault_import",
            &format!("added={added} duplicates={} invalid={}", duplicates.len(), invalid.len()),
        );
    }
    Ok(json!({ "added": added, "duplicates": duplicates, "invalid": invalid }))
}

// ── Список и сводка ──────────────────────────────────────────────────────────

pub fn list(db: &Database, enc: &FieldEncryption, status: Option<&str>, query: &str, limit: i64) -> Result<Value, String> {
    let mut conds: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    if let Some(st) = status {
        if STATUSES.contains(&st) {
            conds.push(format!("status = ?{}", args.len() + 1));
            args.push(st.to_string());
        }
    }
    let q = query.trim();
    if !q.is_empty() {
        let like = format!("%{}%", q.replace('%', "").replace('_', ""));
        let n = args.len() + 1;
        conds.push(format!("(bin LIKE ?{n} OR pan_hash LIKE ?{n} OR assigned_iid LIKE ?{n})"));
        args.push(like);
    }

    let mut sql = String::from(
        "SELECT id, pan_enc, bin, status, assigned_iid, issued_at, returned_at, decline_count, created_at FROM card_vault",
    );
    if !conds.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conds.join(" AND "));
    }
    let limit = limit.clamp(1, 1000);
    sql.push_str(&format!(" ORDER BY id DESC LIMIT {limit}"));

    let mut stmt = db.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect::<Vec<_>>();

    let cards: Vec<Value> = rows
        .into_iter()
        .map(|(id, pan_enc, bin, status, assigned, issued_at, returned_at, decline_count, created_at)| {
            json!({
                "id": id,
                "pan_masked": masked_from_enc(enc, &pan_enc),
                "bin": bin.unwrap_or_default(),
                "status": status,
                "assigned_iid": assigned,
                "issued_at": issued_at,
                "returned_at": returned_at,
                "decline_count": decline_count,
                "created_at": created_at,
            })
        })
        .collect();
    Ok(json!({ "cards": cards }))
}

pub fn stats(db: &Database) -> Result<Value, String> {
    let mut by_status: Map<String, Value> = Map::new();
    for st in STATUSES {
        by_status.insert(st.to_string(), json!(0));
    }
    let mut stmt = db
        .conn
        .prepare("SELECT status, COUNT(*) FROM card_vault GROUP BY status")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    for (st, n) in rows {
        by_status.insert(st, json!(n));
    }

    let total: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM card_vault", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let decline_total: i64 = db
        .conn
        .query_row("SELECT COALESCE(SUM(decline_count), 0) FROM card_vault", [], |r| r.get(0))
        .unwrap_or(0);

    let mut stmt = db
        .conn
        .prepare("SELECT COALESCE(assigned_iid, ''), COUNT(*) FROM card_vault WHERE status = 'on_worker' GROUP BY assigned_iid")
        .map_err(|e| e.to_string())?;
    let occupied: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "target_iid": r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                "cards": r.get::<_, i64>(1)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Потеряшки: срез выдан (pending/delivered), ack нет дольше LOST_HOURS.
    let sql = format!(
        "SELECT COALESCE(v.assigned_iid, '') AS iid, COUNT(DISTINCT v.id)
         FROM card_issues ci JOIN card_vault v ON v.id = ci.card_id
         WHERE ci.status IN ('pending','delivered')
           AND v.status = 'on_worker'
           AND ci.created_at < datetime('now', '-{LOST_HOURS} hours')
         GROUP BY ci.target_iid"
    );
    let mut stmt = db.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let lost: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "target_iid": r.get::<_, String>(0)?,
                "cards": r.get::<_, i64>(1)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    Ok(json!({
        "total": total,
        "by_status": by_status,
        "occupied_by_worker": occupied,
        "lost_by_worker": lost,
        "decline_total": decline_total,
    }))
}

// ── Раздача запечатанных срезов ──────────────────────────────────────────────

fn bin6(pan: &str) -> String {
    normalize_pan(pan).chars().take(6).collect()
}

/// Запечатать срез: расшифровываем поля локально, собираем payload и
/// запечатываем X25519-пубключом воркера. Сервер получает только шифротекст.
fn seal_card_slice(
    enc: &FieldEncryption,
    id: i64,
    pan_enc: &str,
    exp_enc: &str,
    cvv_enc: &str,
    extra_enc: &str,
    pan_hash_hex: &str,
    key_id: i64,
    worker_pub: &[u8; 32],
    issued_at: &str,
    issued_by: &str,
) -> Result<Value, String> {
    let pan = enc.decrypt(pan_enc)?;
    let exp = if exp_enc.is_empty() { String::new() } else { enc.decrypt(exp_enc)? };
    let cvv = if cvv_enc.is_empty() { String::new() } else { enc.decrypt(cvv_enc)? };
    let extra: Value = if extra_enc.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&enc.decrypt(extra_enc)?).unwrap_or(json!({}))
    };
    let payload = json!({
        "v": 1,
        "card_hash": pan_hash_hex,
        "pan": pan,
        "exp": exp,
        "cvv": cvv,
        "bin": bin6(&pan),
        "extra": extra,
        "issued_at": issued_at,
        "issued_by": issued_by,
    });
    let envelope = seal_envelope(key_id, &payload.to_string(), worker_pub)?;
    Ok(json!({ "card_hash": pan_hash_hex, "sealed_data": envelope.to_string(), "vault_id": id }))
}

/// Раздача: запечатать выбранные карты пулом под ключ воркера и отправить
/// срезы на сервер (один вызов, кап 100 — задаёт лимит и сервер).
pub fn issue(db: &Database, enc: &FieldEncryption, target_iid: &str, card_ids: &[i64]) -> Result<Value, String> {
    if target_iid.trim().is_empty() || card_ids.is_empty() {
        return Err("empty_request".into());
    }
    if card_ids.len() > MAX_SLICES_PER_ISSUE {
        return Err("too_many_cards".into());
    }

    let (status, body) = api_request(db, "GET", "/manager/api/workers/keys", None)?;
    if status != 200 {
        return Err(format!("worker_keys_http_{status}"));
    }
    let mut worker_pub: Option<([u8; 32], i64)> = None;
    if let Some(keys) = body.get("keys").and_then(Value::as_array) {
        for k in keys {
            if k.get("installation_id").and_then(Value::as_str) != Some(target_iid) {
                continue;
            }
            let pub_hex = k.get("pubkey").and_then(Value::as_str).unwrap_or("");
            if let Ok(raw) = hex::decode(pub_hex) {
                if raw.len() == 32 {
                    let mut b = [0u8; 32];
                    b.copy_from_slice(&raw);
                    worker_pub = Some((b, k.get("id").and_then(Value::as_i64).unwrap_or(0)));
                }
            }
        }
    }
    let (worker_key_pub, key_id) = worker_pub.ok_or("worker_key_not_registered")?;

    let ids_in = ids_placeholders(card_ids.len());
    let sql = format!("SELECT id, pan_enc, exp_enc, cvv_enc, extra_enc, pan_hash FROM card_vault WHERE id IN ({ids_in})");
    let mut stmt = db.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, String, String, String, String)> = stmt
        .query_map(rusqlite::params_from_iter(card_ids.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    if rows.len() != card_ids.len() {
        return Err("card_not_found".into());
    }

    let mgr_iid = db.get_config("installation_id").unwrap_or_default();
    let issued_at: String = db
        .conn
        .query_row("SELECT strftime('%Y-%m-%d %H:%M:%S','now')", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let mut slices: Vec<Value> = Vec::new();
    let mut selected: Vec<(i64, String)> = Vec::new();
    for (id, pan_enc, exp_enc, cvv_enc, extra_enc, hash) in &rows {
        let status: String = db
            .conn
            .query_row("SELECT status FROM card_vault WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if status != "pool" {
            return Err("card_not_in_pool".into());
        }
        let slice = seal_card_slice(
            enc,
            *id,
            pan_enc,
            exp_enc,
            cvv_enc,
            extra_enc,
            hash,
            key_id,
            &worker_key_pub,
            &issued_at,
            &mgr_iid,
        )?;
        selected.push((*id, hash.clone()));
        slices.push(json!({ "card_hash": hash, "sealed_data": slice["sealed_data"].as_str().unwrap_or_default() }));
    }

    let req_body = json!({ "target_iid": target_iid, "slices": slices });
    let (status, resp) = api_request(db, "POST", "/manager/api/cards/issue", Some(&req_body.to_string()))?;
    if status != 201 {
        let code = resp.get("error").and_then(Value::as_str).unwrap_or("issue_failed");
        return Err(format!("issue_failed:{code}"));
    }

    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (card_id, hash) in &selected {
        tx.execute(
            "UPDATE card_vault SET status = 'on_worker', assigned_iid = ?2, issued_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'pool'",
            params![card_id, target_iid],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO card_issues (card_id, pan_hash, target_iid, key_id, status) VALUES (?1, ?2, ?3, ?4, 'pending')",
            params![card_id, hash, target_iid, key_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    db.log_event("vault_issue", &format!("target={target_iid} issued={}", selected.len()));
    Ok(json!({ "issued": selected.len(), "target_iid": target_iid }))
}

// ── Синхронизация статусов раздач, отзыв, сжигание ───────────────────────────

/// Сверка с сервером: статусы срезов (pending/delivered/ack/revoked) в
/// card_issues + локальные следствия (revoked → карта возвращается в пул).
pub fn sync_issue_status(db: &Database) -> Result<Value, String> {
    let (status, body) = api_request(db, "GET", "/manager/api/cards/issued", None)?;
    if status != 200 {
        return Err(format!("issue_status_http_{status}"));
    }
    let slices = body.get("slices").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut updated = 0u32;
    for s in &slices {
        let hash = s.get("card_hash").and_then(Value::as_str).unwrap_or("");
        let iid = s.get("target_iid").and_then(Value::as_str).unwrap_or("");
        let st = s.get("status").and_then(Value::as_str).unwrap_or("");
        if hash.is_empty() || iid.is_empty() || st.is_empty() {
            continue;
        }
        let server_id = s.get("id").and_then(Value::as_i64);
        let delivered = s.get("delivered_at").and_then(Value::as_str);
        let acked = s.get("acked_at").and_then(Value::as_str);
        let n = db
            .conn
            .execute(
                "UPDATE card_issues SET status = ?1, server_id = ?2, delivered_at = ?3, acked_at = ?4
                 WHERE pan_hash = ?5 AND target_iid = ?6",
                params![st, server_id, delivered, acked, hash, iid],
            )
            .map_err(|e| e.to_string())?;
        updated += n as u32;
        if st == "revoked" {
            let _ = db.conn.execute(
                "UPDATE card_vault SET status = 'pool', assigned_iid = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE pan_hash = ?1 AND status = 'on_worker'",
                params![hash],
            );
        }
    }
    Ok(json!({ "slices": slices, "updated": updated }))
}

/// Отозвать открытые срезы карт на сервере (best-effort): статус revoked
/// исключает их из выдачи воркеру (GET /sync/cards/issued их не отдаёт).
fn revoke_open_slices(db: &Database, card_ids: &[i64]) -> i64 {
    let _ = sync_issue_status(db);
    let mut server_ids: Vec<i64> = Vec::new();
    for &cid in card_ids {
        if let Ok(mut stmt) = db.conn.prepare(
            "SELECT DISTINCT server_id FROM card_issues
             WHERE card_id = ?1 AND status IN ('pending','delivered') AND server_id IS NOT NULL",
        ) {
            if let Ok(rows) = stmt.query_map([cid], |r| r.get::<_, i64>(0)) {
                for sid in rows.flatten() {
                    server_ids.push(sid);
                }
            }
        }
    }
    if server_ids.is_empty() {
        return 0;
    }
    let body = json!({ "ids": server_ids }).to_string();
    match api_request(db, "POST", "/manager/api/cards/issued/revoke", Some(&body)) {
        Ok((200, resp)) => resp.get("revoked").and_then(Value::as_i64).unwrap_or(0),
        _ => 0,
    }
}

/// Забрать карты воркеру обратно: срезы отзываются на сервере, карта
/// возвращается в живой пул ('pool') или в пул №2 ('declined').
pub fn recall(db: &Database, card_ids: &[i64], to_status: &str) -> Result<Value, String> {
    if card_ids.is_empty() {
        return Err("empty_request".into());
    }
    if to_status != "pool" && to_status != "declined" {
        return Err("bad_status".into());
    }
    let revoked = revoke_open_slices(db, card_ids);

    let ph = ids_placeholders(card_ids.len());
    let decline_bump = if to_status == "declined" { ", decline_count = decline_count + 1" } else { "" };
    let sql = format!(
        "UPDATE card_vault SET status = '{to_status}', assigned_iid = NULL, returned_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP{decline_bump} WHERE id IN ({ph}) AND status != 'burned'"
    );
    let n = db
        .conn
        .execute(&sql, rusqlite::params_from_iter(card_ids.iter()))
        .map_err(|e| e.to_string())?;
    let ph_issues = ids_placeholders(card_ids.len());
    let sql_issues = format!(
        "UPDATE card_issues SET status = 'revoked' WHERE card_id IN ({ph_issues}) AND status IN ('pending','delivered')"
    );
    let _ = db.conn.execute(&sql_issues, rusqlite::params_from_iter(card_ids.iter()));
    db.log_event("vault_recall", &format!("to={to_status} cards={n} revoked={revoked}"));
    Ok(json!({ "recalled": n, "revoked": revoked }))
}

/// Сжечь карты (реестр сожжённых — остаётся в vault для дедупа навсегда).
pub fn burn(db: &Database, card_ids: &[i64], reason: &str) -> Result<Value, String> {
    if card_ids.is_empty() {
        return Err("empty_request".into());
    }
    let revoked = revoke_open_slices(db, card_ids);
    let ph = ids_placeholders(card_ids.len());
    let sql = format!(
        "UPDATE card_vault SET status = 'burned', assigned_iid = NULL, returned_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id IN ({ph}) AND status != 'burned'"
    );
    let n = db
        .conn
        .execute(&sql, rusqlite::params_from_iter(card_ids.iter()))
        .map_err(|e| e.to_string())?;
    let ph2 = ids_placeholders(card_ids.len());
    let _ = db.conn.execute(
        &format!("UPDATE card_issues SET status = 'revoked' WHERE card_id IN ({ph2}) AND status IN ('pending','delivered')"),
        rusqlite::params_from_iter(card_ids.iter()),
    );
    db.log_event("vault_burn", &format!("cards={n} reason={reason} revoked={revoked}"));
    Ok(json!({ "burned": n, "revoked": revoked }))
}

// ── Экспорт пулов на ПК + зачистка + журнал вывозов ─────────────────────────

/// Экспорт выбранных карт в зашифрованный файл на ПК. Формат файла:
/// {"format":"vaultbase-vault-export","v":1,"salt":b64,"ct":AES-256-GCM(json)}.
/// После записи поля шифра в vault обнуляются, статус → 'exported'
/// (tombstone с pan_hash остаётся в реестре и держит дедуп навсегда).
pub fn export(
    db: &Database,
    enc: &FieldEncryption,
    card_ids: &[i64],
    path: &str,
    password: &str,
    purge: bool,
) -> Result<Value, String> {
    if card_ids.is_empty() {
        return Err("empty_request".into());
    }
    if password.len() < 8 {
        return Err("export_password_short".into());
    }

    let ph = ids_placeholders(card_ids.len());
    let sql = format!(
        "SELECT id, pan_enc, exp_enc, cvv_enc, extra_enc, bin, status, pan_hash, decline_count, created_at
         FROM card_vault WHERE id IN ({ph}) AND status != 'exported'"
    );
    let mut stmt = db.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String, String, String, String, Option<String>, String, String, i64, String)> = stmt
        .query_map(rusqlite::params_from_iter(card_ids.iter()), |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, String>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    if rows.is_empty() {
        return Err("no_cards".into());
    }

    let mut records: Vec<Value> = Vec::new();
    for (id, pan_enc, exp_enc, cvv_enc, extra_enc, bin, status, hash, decline_count, created_at) in &rows {
        let _ = id;
        let pan = match enc.decrypt(pan_enc) {
            Ok(p) => p,
            Err(_) => continue, // зачищенная запись без данных
        };
        let exp = if exp_enc.is_empty() { String::new() } else { enc.decrypt(exp_enc).unwrap_or_default() };
        let cvv = if cvv_enc.is_empty() { String::new() } else { enc.decrypt(cvv_enc).unwrap_or_default() };
        let extra: Value = if extra_enc.is_empty() {
            json!({})
        } else {
            serde_json::from_str(&enc.decrypt(extra_enc).unwrap_or_default()).unwrap_or(json!({}))
        };
        records.push(json!({
            "pan": pan,
            "exp": exp,
            "cvv": cvv,
            "extra": extra,
            "bin": bin.clone().unwrap_or_default(),
            "pan_hash": hash,
            "status": status,
            "decline_count": decline_count,
            "created_at": created_at,
        }));
    }

    let created_at: String = db
        .conn
        .query_row("SELECT strftime('%Y-%m-%d %H:%M:%S','now')", [], |r| r.get(0))
        .unwrap_or_default();
    let salt = crate::crypto::generate_salt();
    let kek = FieldEncryption::new(password, &salt);
    let blob = json!({
        "format": "vaultbase-vault-export",
        "v": 1,
        "created_at": created_at,
        "cards": records,
    });
    let ct = kek.encrypt(&blob.to_string())?;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let file_json = json!({
        "format": "vaultbase-vault-export",
        "v": 1,
        "created_at": created_at,
        "salt": B64.encode(&salt),
        "ct": ct,
    });

    // Относительный путь резолвим в data_dir/exports/, абсолютный — как есть.
    let mut p = std::path::PathBuf::from(path);
    if !p.is_absolute() {
        let dir = crate::db::data_dir()?;
        p = std::path::Path::new(&dir).join("exports").join(p);
    }
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file_body = serde_json::to_string_pretty(&file_json).map_err(|e| e.to_string())?;
    std::fs::write(&p, file_body.as_bytes()).map_err(|e| format!("write: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(file_body.as_bytes());
    let sha256_hex = hex::encode(hasher.finalize());

    db.conn
        .execute(
            "INSERT INTO card_exports (kind, cards_count, file_path, file_sha256, note) VALUES ('export', ?1, ?2, ?3, ?4)",
            params![records.len() as i64, p.to_string_lossy().as_ref(), sha256_hex, ""],
        )
        .map_err(|e| e.to_string())?;

    // Зачистка: шифрополя обнуляются, остаётся tombstone (pan_hash) для дедупа.
    if purge {
        let ph2 = ids_placeholders(card_ids.len());
        let upd = format!(
            "UPDATE card_vault SET pan_enc = '', exp_enc = '', cvv_enc = '', extra_enc = '',
             status = 'exported', assigned_iid = NULL, updated_at = CURRENT_TIMESTAMP WHERE id IN ({ph2})"
        );
        db.conn
            .execute(&upd, rusqlite::params_from_iter(card_ids.iter()))
            .map_err(|e| e.to_string())?;
    }
    db.log_event("vault_export", &format!("cards={} purge={purge}", records.len()));
    Ok(json!({ "exported": records.len(), "path": p.to_string_lossy(), "sha256": sha256_hex }))
}

/// Журнал вывозов (последние 200 записей).
pub fn export_log(db: &Database) -> Result<Value, String> {
    let mut stmt = db
        .conn
        .prepare("SELECT id, kind, cards_count, file_path, file_sha256, note, created_at FROM card_exports ORDER BY id DESC LIMIT 200")
        .map_err(|e| e.to_string())?;
    let exports: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "kind": r.get::<_, String>(1)?,
                "cards_count": r.get::<_, i64>(2)?,
                "file_path": r.get::<_, String>(3)?,
                "file_sha256": r.get::<_, String>(4)?,
                "note": r.get::<_, String>(5)?,
                "created_at": r.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    Ok(json!({ "exports": exports }))
}

// ── Тесты ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{generate_x25519, unseal_envelope};
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;

    const GOOD_PAN: &str = "4111111111111111";
    const GOOD_PAN2: &str = "4012888888881881";

    fn test_db(dir: &tempfile::TempDir) -> Database {
        Database::open_plain(dir.path().join("v.db").to_str().unwrap()).unwrap()
    }

    fn test_enc() -> FieldEncryption {
        FieldEncryption::new("test password 1!", b"unit-salt")
    }

    #[test]
    fn luhn_mask_and_hash() {
        assert!(luhn_valid("4111111111111111"));
        assert!(luhn_valid("5555555555554444"));
        assert!(!luhn_valid("4111111111111112"));
        assert!(!luhn_valid("411111111111"));
        assert_eq!(mask_pan("4111111111111111"), "411111******1111");
        assert_eq!(mask_pan("4111"), "****");

        let a = pan_hash("aabb", GOOD_PAN);
        assert_eq!(a, pan_hash("aabb", GOOD_PAN));
        assert_ne!(a, pan_hash("abab", GOOD_PAN));
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn import_dedup_invalid_and_burn_registry() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(&dir);
        let enc = test_enc();

        let text = format!("{GOOD_PAN};12/26;123\n{GOOD_PAN}\n4111111111111112\n");
        let r = import(&db, &enc, &text).unwrap();
        assert_eq!(r["added"], 1);
        assert_eq!(r["duplicates"].as_array().unwrap().len(), 1);

        // Повторный импорт — дубль против живого пула.
        let r = import(&db, &enc, GOOD_PAN).unwrap();
        assert_eq!(r["added"], 0);
        assert_eq!(r["duplicates"][0]["existing_status"], "pool");

        // Сжечь → дедуп по реестру сожжённых.
        let id: i64 = db.conn.query_row("SELECT id FROM card_vault", [], |r| r.get(0)).unwrap();
        let out = burn(&db, &[id], "test burn").unwrap();
        assert_eq!(out["burned"], 1);
        let r = import(&db, &enc, GOOD_PAN).unwrap();
        assert_eq!(r["duplicates"][0]["existing_status"], "burned");

        let st = stats(&db).unwrap();
        assert_eq!(st["total"], 1);
        assert_eq!(st["by_status"]["burned"], 1);
        assert_eq!(st["by_status"]["pool"], 0);
    }

    #[test]
    fn import_fields_and_invalid_lines() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(&dir);
        let enc = test_enc();

        let text = format!("{GOOD_PAN};12/26;123;Ivanov;190000;SPb\n{GOOD_PAN2};bad-exp;12\n#cmt\n");
        let r = import(&db, &enc, &text).unwrap();
        assert_eq!(r["added"], 1);
        assert_eq!(r["invalid"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn slice_seal_roundtrip() {
        let enc = test_enc();
        let pan_enc = enc.encrypt(GOOD_PAN).unwrap();
        let (secret, public) = generate_x25519();
        let slice = seal_card_slice(
            &enc, 42, &pan_enc, "", "", "", "hash-hex-1", 5, &public, "2026-08-30 12:00:00", "mgr-1",
        )
        .unwrap();
        assert_eq!(slice["card_hash"], "hash-hex-1");
        assert_eq!(slice["vault_id"], 42);

        let envelope: Value = serde_json::from_str(slice["sealed_data"].as_str().unwrap()).unwrap();
        let plaintext = unseal_envelope(&secret, &envelope).unwrap();
        let v: Value = serde_json::from_str(&plaintext).unwrap();
        assert_eq!(v["pan"], GOOD_PAN);
        assert_eq!(v["card_hash"], "hash-hex-1");
        assert_eq!(v["issued_by"], "mgr-1");
    }

    #[test]
    fn export_roundtrip_and_purge() {
        let dir = tempfile::tempdir().unwrap();
        let db = test_db(&dir);
        let enc = test_enc();

        let text = format!("{GOOD_PAN};12/26;123\n{GOOD_PAN2}\n");
        let r = import(&db, &enc, &text).unwrap();
        assert_eq!(r["added"], 2);
        let ids: Vec<i64> = {
            let mut stmt = db.conn.prepare("SELECT id FROM card_vault ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get::<_, i64>(0)).unwrap().flatten().collect()
        };
        assert_eq!(ids.len(), 2);

        let out_path = dir.path().join("out.vbex");
        let r = export(&db, &enc, &ids, out_path.to_str().unwrap(), "StrongPass1!", true).unwrap();
        assert_eq!(r["exported"], 2);

        let file: Value = serde_json::from_str(&std::fs::read_to_string(&out_path).unwrap()).unwrap();
        let salt = B64.decode(file["salt"].as_str().unwrap()).unwrap();
        let kek = FieldEncryption::new("StrongPass1!", &salt);
        let blob: Value = serde_json::from_str(&kek.decrypt(file["ct"].as_str().unwrap()).unwrap()).unwrap();
        assert_eq!(blob["cards"].as_array().unwrap().len(), 2);
        assert_eq!(blob["cards"][0]["pan"], GOOD_PAN);

        let st = stats(&db).unwrap();
        assert_eq!(st["by_status"]["exported"], 2);
    }
}
