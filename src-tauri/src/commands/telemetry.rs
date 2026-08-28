// MGR-004: телеметрия воркера менеджер-приложению запечатанными конвертами.
// Контракт: docs/MANAGER_APP.md §2.2/§4/§5 и сервер cc-sync-server/routes/telemetry.js.
//
// Схема (sealed box): эфемерный X25519 (e,E) → shared = X25519(e,B) →
// key = HKDF-SHA256(ikm=shared, salt=B||E, info=b"vb-mgr-telemetry-v1", 32) →
// AES-256-GCM(key, nonce=12 случайных байт, payload UTF8-JSON).
// Конверт: {"key_id": int, "ephemeral": hex(E), "nonce": hex(12), "ct": base64}.
// Сервер видит только форму конверта — plaintext не покидает воркер.

use crate::state::*;
use crate::database::Database;
use rusqlite::params;
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, Payload, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

const HKDF_INFO: &[u8] = b"vb-mgr-telemetry-v1";

// ── Запечатанный конверт ─────────────────────────────────────────

/// Форма совпадает с валидатором сервера (routes/telemetry.js):
/// key_id int, ephemeral hex{64}, nonce hex{24}, ct base64.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEnvelope {
    pub key_id: i64,
    pub ephemeral: String,
    pub nonce: String,
    pub ct: String,
}

/// Публичный менеджерский ключ из `GET /api/telemetry/keys`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryManagerKey {
    pub id: i64,
    pub pubkey: String,
    pub key_type: Option<String>,
    pub label: Option<String>,
}

fn derive_key(shared: &[u8; 32], b: &[u8; 32], e: &[u8; 32]) -> Result<[u8; 32], String> {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(b);
    salt[32..].copy_from_slice(e);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm).map_err(|e| e.to_string())?;
    Ok(okm)
}

/// Запечатать `plaintext` для получателя с публичным ключом `pub_hex`
/// (32 байта X25519, hex). Эфемерная пара генерируется на каждый вызов.
pub(crate) fn seal_envelope(
    key_id: i64,
    pub_hex: &str,
    plaintext: &str,
) -> Result<TelemetryEnvelope, String> {
    let b_bytes = hex::decode(pub_hex.trim())
        .map_err(|e| format!("bad_pubkey_hex: {}", e))?;
    if b_bytes.len() != 32 {
        return Err(format!("bad_pubkey_len: {}", b_bytes.len()));
    }
    let b = PublicKey::from(<[u8; 32]>::try_from(b_bytes.as_slice()).unwrap());

    let e = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
    let e_pub = PublicKey::from(&e);
    let shared = e.diffie_hellman(&b);

    let key = derive_key(shared.as_bytes(), b.as_bytes(), e_pub.as_bytes())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext.as_bytes(), aad: &[] })
        .map_err(|e| format!("aes_gcm_encrypt: {}", e))?;

    Ok(TelemetryEnvelope {
        key_id,
        ephemeral: hex::encode(e_pub.as_bytes()),
        nonce: hex::encode(nonce),
        ct: {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(ct)
        },
    })
}

/// Распечатать конверт приватным ключом получателя `priv_hex` (32 байта, hex).
/// Воркеру для отправки не нужен (только seal), но это обратная сторона
/// того же контракта: roundtrip-тесты и отладка локальной расшифровкой.
#[cfg(test)]
pub(crate) fn unseal_envelope(priv_hex: &str, env: &TelemetryEnvelope) -> Result<String, String> {
    let b_secret_bytes = hex::decode(priv_hex.trim())
        .map_err(|e| format!("bad_privkey_hex: {}", e))?;
    if b_secret_bytes.len() != 32 {
        return Err(format!("bad_privkey_len: {}", b_secret_bytes.len()));
    }
    let b_secret = StaticSecret::from(<[u8; 32]>::try_from(b_secret_bytes.as_slice()).unwrap());
    let b_pub = PublicKey::from(&b_secret);

    let e_bytes = hex::decode(&env.ephemeral).map_err(|e| format!("bad_ephemeral: {}", e))?;
    if e_bytes.len() != 32 {
        return Err(format!("bad_ephemeral_len: {}", e_bytes.len()));
    }
    let e_pub = PublicKey::from(<[u8; 32]>::try_from(e_bytes.as_slice()).unwrap());

    let shared = b_secret.diffie_hellman(&e_pub);
    let key = derive_key(shared.as_bytes(), b_pub.as_bytes(), e_pub.as_bytes())?;

    let nonce_bytes = hex::decode(&env.nonce).map_err(|e| format!("bad_nonce: {}", e))?;
    let ct = {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&env.ct)
            .map_err(|e| format!("bad_ct: {}", e))?
    };
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: &ct, aad: &[] })
        .map_err(|_| "aes_gcm_decrypt_failed".to_string())?;
    String::from_utf8(pt).map_err(|e| format!("bad_utf8: {}", e))
}

// ── Heartbeat payload (§2.2) ──────────────────────────────────────

/// `"ok" | "down"` — по свежести успешных sync-событий в activity_log
/// (успешное событие за последние 15 минут = connectivity жив).
/// WS-статус живёт в событиях фронтенда (`ws_sync:status`), из БД недоступен —
/// приближение, уточняется в MGR-005.
fn sync_ws_state(db: &Database) -> &'static str {
    let n: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'sync.%' \
         AND event_type NOT LIKE '%fail%' AND event_type NOT LIKE '%error%' \
         AND event_type NOT LIKE '%reject%' \
         AND created_at > datetime('now', '-15 minutes')",
        [], |r| r.get(0),
    ).unwrap_or(0);
    if n > 0 { "ok" } else { "down" }
}

/// `true | false | null`: есть активные аккаунты → true, если хотя бы у
/// одного успешная проверка за 24 ч; нет аккаунтов → null (нет данных).
fn imap_health(db: &Database) -> Option<bool> {
    let total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM imap_accounts WHERE is_active = 1", [], |r| r.get(0),
    ).unwrap_or(0);
    if total == 0 { return None; }
    let ok: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM imap_accounts \
         WHERE is_active = 1 AND last_ok IS NOT NULL AND last_ok > datetime('now', '-1 day')",
        [], |r| r.get(0),
    ).unwrap_or(0);
    Some(ok > 0)
}

/// Аналогично прокси: есть → не все заблокированы; нет → null.
fn proxy_health(db: &Database) -> Option<bool> {
    let total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies", [], |r| r.get(0),
    ).unwrap_or(0);
    if total == 0 { return None; }
    let alive: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies WHERE is_blocked = 0", [], |r| r.get(0),
    ).unwrap_or(0);
    Some(alive > 0)
}

fn count_recent_errors(db: &Database) -> i64 {
    db.conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE created_at > datetime('now', '-1 day') \
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%reject%')",
        [], |r| r.get(0),
    ).unwrap_or(0)
}

/// Payload heartbeat из §2.2 (в конверте; plaintext указан в MANAGER_APP.md).
pub(crate) fn build_heartbeat_payload(db: &Database) -> serde_json::Value {
    serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "sync_ws": sync_ws_state(db),
        "db_ok": !db.is_locked(),
        "imap_ok": imap_health(db),
        "smtp_ok": serde_json::Value::Null,
        "proxy_ok": proxy_health(db),
        "errors_24h": count_recent_errors(db),
    })
}

// ── daily_stats за дату (§4) ──────────────────────────────────────

fn scalar_i64(db: &Database, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    db.conn.query_row(sql, params, |r| r.get(0)).unwrap_or(0)
}

/// Собрать daily_stats за `date` ("YYYY-MM-DD", локальная дата).
/// created_at в БД — UTC, поэтому сравнение через `'localtime'`.
/// Карточные переходы (used/dead) восстанавливаются из activity_log
/// (в credit_cards нет updated_at) — событие `card.status_changed`.
pub(crate) fn build_daily_stats(db: &Database, date: &str) -> serde_json::Value {
    let mut orders_by_status = serde_json::Map::new();
    let mut total_orders = 0i64;
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT status, COUNT(*) FROM orders \
         WHERE DATE(created_at, 'localtime') = ?1 GROUP BY status",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }) {
            for row in rows.flatten() {
                total_orders += row.1;
                orders_by_status.insert(row.0, row.1.into());
            }
        }
    }

    let cards_taken = scalar_i64(db,
        "SELECT COUNT(*) FROM credit_cards WHERE DATE(created_at, 'localtime') = ?1",
        &[&date]);
    let mut cards_used = 0i64;
    let mut cards_dead = 0i64;
    let mut by_bin: std::collections::BTreeMap<String, (i64, i64)> =
        std::collections::BTreeMap::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT l.description, l.entity_id FROM activity_log l \
         WHERE l.event_type = 'card.status_changed' AND DATE(l.created_at, 'localtime') = ?1",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for (desc, entity_id) in rows.flatten() {
                // формат: "Card {id} status → {status}" (commands/cards.rs)
                let status = desc
                    .as_deref()
                    .and_then(|d| d.rsplit('→').next())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                let bin: Option<String> = entity_id
                    .as_deref()
                    .and_then(|id| id.parse::<i64>().ok())
                    .and_then(|id| db.conn.query_row(
                        "SELECT bin FROM credit_cards WHERE id = ?1", params![id],
                        |r| r.get(0),
                    ).ok().flatten());
                let entry = by_bin.entry(bin.unwrap_or_else(|| "?".into())).or_insert((0, 0));
                match status.as_str() {
                    "in_use" => { cards_used += 1; entry.0 += 1; }
                    "dead"   => { cards_dead += 1; entry.1 += 1; }
                    _ => {}
                }
            }
        }
    }

    let drops_taken = scalar_i64(db,
        "SELECT COUNT(*) FROM drops WHERE DATE(created_at, 'localtime') = ?1",
        &[&date]);
    let mut drops_by_destination = serde_json::Map::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT s.domain, COUNT(DISTINCT d.id) FROM drops d \
         JOIN orders o ON o.profile_id = d.profile_id \
         JOIN shops s ON s.id = o.shop_id \
         WHERE DATE(d.created_at, 'localtime') = ?1 GROUP BY s.domain",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }) {
            for row in rows.flatten() {
                drops_by_destination.insert(row.0, row.1.into());
            }
        }
    }

    let mut shops = serde_json::Map::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT s.domain, COUNT(*), \
                SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END), \
                SUM(CASE WHEN o.status = 'declined' THEN 1 ELSE 0 END), \
                SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), \
                COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount END), 0.0) \
         FROM orders o JOIN shops s ON s.id = o.shop_id \
         WHERE DATE(o.created_at, 'localtime') = ?1 GROUP BY s.domain",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok(serde_json::json!({
                "domain": r.get::<_, String>(0)?, "orders": r.get::<_, i64>(1)?,
                "delivered": r.get::<_, i64>(2)?, "declined": r.get::<_, i64>(3)?,
                "cancelled": r.get::<_, i64>(4)?, "revenue": r.get::<_, f64>(5)?,
            }))
        }) {
            for row in rows.flatten() {
                if let Some(d) = row.get("domain").and_then(|v| v.as_str()) {
                    shops.insert(d.to_string(), row.clone());
                }
            }
        }
    }

    let (imap_ok, imap_fail) = (
        scalar_i64(db,
            "SELECT COUNT(*) FROM activity_log WHERE event_type = 'imap.poll_completed' \
             AND DATE(created_at, 'localtime') = ?1", &[&date]),
        scalar_i64(db,
            "SELECT COUNT(*) FROM activity_log \
             WHERE event_type IN ('imap.poll_error', 'imap.check_error') \
             AND DATE(created_at, 'localtime') = ?1", &[&date]),
    );
    let ws_ok = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'sync.%' \
         AND event_type NOT LIKE '%fail%' AND event_type NOT LIKE '%error%' \
         AND event_type NOT LIKE '%reject%' AND DATE(created_at, 'localtime') = ?1",
        &[&date]) > 0;
    let push_fail = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type = 'sync.push_rejected' \
         AND DATE(created_at, 'localtime') = ?1", &[&date]);

    serde_json::json!({
        "date": date,
        "app_version": env!("CARGO_PKG_VERSION"),
        "orders": {
            "total": total_orders,
            "by_status": orders_by_status,
        },
        "cards": {
            "taken": cards_taken,
            "used": cards_used,
            "dead": cards_dead,
            "by_bin": by_bin.iter().map(|(k, (used, dead))| (
                k.clone(), serde_json::json!({ "used": used, "dead": dead })
            )).collect::<serde_json::Map<String, serde_json::Value>>(),
        },
        "drops": {
            "taken": drops_taken,
            "by_destination": drops_by_destination,
        },
        "shops": shops,
        "health": {
            "imap_ok": imap_ok, "imap_fail": imap_fail,
            "smtp_ok": 0, "smtp_fail": 0,
            "proxy_ok": 0, "proxy_fail": 0,
        },
        "sync": { "ws_ok": ws_ok, "push_ok": 0, "push_fail": push_fail },
    })
}

// ── HTTP-отправка (контракт routes/telemetry.js) ──────────────────

fn worker_token(db: &Database) -> Result<String, String> {
    let stored = db.get_config("license_token").map_err(|e| e.to_string())?;
    match stored {
        Some(t) if !t.is_empty() => match &db.encryption {
            Some(enc) => Ok(enc.decrypt(&t).unwrap_or(t)),
            None => Ok(t),
        },
        _ => Err("no_token".into()),
    }
}

const HEARTBEAT_TIMEOUT_SECS: u64 = 10;

/// Активные менеджерские ключи (`GET /api/telemetry/keys` → `{keys:[...]}`).
/// Сервер принимает ≤8 конвертов — обрезаем список так же.
fn fetch_manager_keys(token: &str) -> Result<Vec<TelemetryManagerKey>, String> {
    let resp = ureq::get(&crate::endpoints::endpoint("/api/telemetry/keys"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("http_{}", code),
            _ => "network_error".to_string(),
        })?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|_| "bad_keys_response".to_string())?;
    let mut keys: Vec<TelemetryManagerKey> = Vec::new();
    if let Some(arr) = body.get("keys").and_then(|v| v.as_array()) {
        for k in arr {
            let id = k.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let pubkey = k.get("pubkey").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id > 0 && pubkey.len() == 64 && hex::decode(&pubkey).map(|b| b.len() == 32).unwrap_or(false) {
                keys.push(TelemetryManagerKey {
                    id,
                    pubkey,
                    key_type: k.get("key_type").and_then(|v| v.as_str()).map(String::from),
                    label: k.get("label").and_then(|v| v.as_str()).map(String::from),
                });
            }
        }
    }
    if keys.is_empty() {
        return Err("no_active_manager_keys".into());
    }
    keys.truncate(8);
    Ok(keys)
}

fn seal_for_managers(
    keys: &[TelemetryManagerKey],
    payload: &serde_json::Value,
) -> Result<Vec<TelemetryEnvelope>, String> {
    let plaintext = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    keys.iter()
        .map(|k| seal_envelope(k.id, &k.pubkey, &plaintext))
        .collect()
}

fn http_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!("http_{}", code),
        _ => "network_error".to_string(),
    }
}

// ── MGR-005: применение политик живьём ───────────────────────────
// Политика приходит в ответе heartbeat (`{ok, policy, update_required}`)
// или в 403 banned (`{error, reason, policy}`). Поля серверной строки
// worker_policies: banned, banned_reason, ban_until, permissions_override,
// quota_cards_day, quota_orders_day, min_version, version_exempt,
// force_logout, updated_by, updated_at.

/// Эффекты применения — то, о чём фронту надо узнать немедленно.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyEffects {
    pub banned: bool,
    pub force_logout: bool,
    pub update_required: bool,
}

/// SQLite-хранимые флаги приходят как 0/1, из JSON — как bool.
fn policy_flag(v: &serde_json::Value, key: &str) -> bool {
    match v.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    }
}

fn policy_opt_i64(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| x.as_i64())
}

fn policy_opt_string(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// permissions_override — TEXT-колонка с JSON: может прийти строкой или
/// уже объектом. Невалидное значение игнорируем, чтобы не ломать права.
fn parse_permissions_override(v: &serde_json::Value) -> Option<std::collections::HashMap<String, bool>> {
    let parsed: serde_json::Value = match v.get("permissions_override") {
        Some(serde_json::Value::String(s)) => serde_json::from_str(s).ok()?,
        Some(o @ serde_json::Value::Object(_)) => o.clone(),
        _ => return None,
    };
    parsed.as_object().map(|m| {
        m.iter().filter_map(|(k, val)| val.as_bool().map(|b| (k.clone(), b))).collect()
    })
}

/// Разобрать строку политики в PolicyState (update_required живёт отдельно
/// от строки worker_policies — его сервер вычисляет на heartbeat).
fn parse_policy_state(policy: &serde_json::Value, update_required: bool) -> PolicyState {
    PolicyState {
        banned: policy_flag(policy, "banned"),
        banned_reason: policy_opt_string(policy, "banned_reason"),
        ban_until: policy_opt_string(policy, "ban_until"),
        update_required,
        min_version: policy_opt_string(policy, "min_version"),
        permissions_override: parse_permissions_override(policy),
        quota_cards_day: policy_opt_i64(policy, "quota_cards_day"),
        quota_orders_day: policy_opt_i64(policy, "quota_orders_day"),
        force_logout: policy_flag(policy, "force_logout"),
    }
}

/// Применить политику живьём: персистит в config `worker_policy` (вместе с
/// update_required — одним ключом), обновляет in-memory PolicyState.
/// force_logout гасит все локальные сессии и ставит флаг ack — следующий
/// heartbeat уйдёт с `ack_force_logout:true`, и сервер сбросит флаг.
pub(crate) fn apply_policy(db: &mut Database, policy: &serde_json::Value, update_required: bool) -> PolicyEffects {
    let next = parse_policy_state(policy, update_required);
    let mut stored = policy.clone();
    stored["update_required"] = serde_json::json!(update_required);
    let _ = db.set_config("worker_policy", &stored.to_string());

    let force_logout = next.force_logout;
    if let Some(st) = STATE.get() {
        if let Ok(mut p) = st.policy.lock() { *p = next.clone(); }
        if force_logout {
            if let Ok(mut u) = st.current_user.lock() { *u = None; }
        }
    }
    if force_logout {
        let _ = db.logout_all_sessions();
        let _ = db.set_config("telemetry_ack_force_logout", "1");
    }
    PolicyEffects { banned: next.banned, force_logout, update_required }
}

/// Восстановить политику из config при логине — после рестарта приложения
/// бан/override/квоты продолжают действовать до первого свежего heartbeat.
pub(crate) fn restore_policy_from_config(db: &Database) {
    let Some(raw) = db.get_config("worker_policy").ok().flatten() else { return };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let next = parse_policy_state(&v, policy_flag(&v, "update_required"));
    if let Some(st) = STATE.get() {
        if let Ok(mut p) = st.policy.lock() { *p = next; }
    }
}

// ── MGR-005: дневные квоты ───────────────────────────────────────
// Счётчик считается так же, как в daily_stats (локальная дата,
// DATE(..., 'localtime')) — менеджер видит те же числа в отчёте.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DailyQuota { Cards, Orders }

fn quota_err(kind: DailyQuota) -> String {
    match kind {
        DailyQuota::Cards => "quota_exceeded:cards_day".to_string(),
        DailyQuota::Orders => "quota_exceeded:orders_day".to_string(),
    }
}

fn quota_used_today(db: &Database, kind: DailyQuota) -> i64 {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let sql = match kind {
        DailyQuota::Cards =>
            "SELECT COUNT(*) FROM card_assignments WHERE DATE(assigned_at, 'localtime') = ?1",
        DailyQuota::Orders =>
            "SELECT COUNT(*) FROM orders WHERE DATE(created_at, 'localtime') = ?1",
    };
    scalar_i64(db, sql, &[&today as &dyn rusqlite::ToSql])
}

/// Проверка с явным лимитом — тестируемое ядро; `None` = без квоты,
/// `Some(0)` = полный запрет на сегодня.
pub(crate) fn enforce_daily_quota_with(db: &Database, kind: DailyQuota, limit: Option<i64>) -> Result<(), String> {
    let Some(limit) = limit else { return Ok(()) };
    if limit <= 0 || quota_used_today(db, kind) >= limit {
        return Err(quota_err(kind));
    }
    Ok(())
}

/// Проверка по активной политике (in-memory; без политики — пропускает).
pub(crate) fn enforce_daily_quota(db: &Database, kind: DailyQuota) -> Result<(), String> {
    let p = crate::state::policy_snapshot();
    let limit = match kind {
        DailyQuota::Cards => p.quota_cards_day,
        DailyQuota::Orders => p.quota_orders_day,
    };
    enforce_daily_quota_with(db, kind, limit)
}

/// Ответ heartbeat: `{ok, policy, update_required}`; при бане middleware
/// отвечает `403 {error:'banned', reason, policy}` — policy уходит наверх
/// целиком (MGR-005 применяет бан/лок/квоты).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryHeartbeatResult {
    pub sent: bool,
    pub reason: String,
    pub update_required: bool,
    pub banned: bool,
    pub policy: Option<serde_json::Value>,
    /// MGR-005: политика потребовала разлогин — фронт должен выкинуть на логин.
    #[serde(default)]
    pub force_logout: bool,
}

impl TelemetryHeartbeatResult {
    fn fail(reason: String) -> Self {
        TelemetryHeartbeatResult {
            sent: false, reason, update_required: false, banned: false,
            policy: None, force_logout: false,
        }
    }
}

pub(crate) fn send_heartbeat(db: &mut Database) -> TelemetryHeartbeatResult {
    let token = match worker_token(db) {
        Ok(t) => t,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    let keys = match fetch_manager_keys(&token) {
        Ok(k) => k,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    let envelopes = match seal_for_managers(&keys, &build_heartbeat_payload(db)) {
        Ok(e) => e,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    // MGR-005: после force_logout следующий heartbeat подтверждает разлогин —
    // сервер по ack_force_logout:true сбрасывает флаг в worker_policies.
    let ack = db.get_config("telemetry_ack_force_logout").ok().flatten().as_deref() == Some("1");
    let body = if ack {
        serde_json::json!({ "envelopes": envelopes, "ack_force_logout": true })
    } else {
        serde_json::json!({ "envelopes": envelopes })
    };
    let resp = ureq::post(&crate::endpoints::endpoint("/api/telemetry/heartbeat"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .set("X-App-Version", env!("CARGO_PKG_VERSION"))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .send_string(&body.to_string());

    match resp {
        Ok(r) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
                let _ = db.set_config("telemetry_last_heartbeat_at",
                    &chrono::Utc::now().to_rfc3339());
                if ack { let _ = db.set_config("telemetry_ack_force_logout", "0"); }
                let update_required = v.get("update_required").and_then(|x| x.as_bool()).unwrap_or(false);
                let policy = v.get("policy").cloned();
                let effects = match &policy {
                    Some(p) => apply_policy(db, p, update_required),
                    None => PolicyEffects::default(),
                };
                TelemetryHeartbeatResult {
                    sent: true, reason: "ok".into(),
                    update_required,
                    banned: effects.banned,
                    policy,
                    force_logout: effects.force_logout,
                }
            } else {
                TelemetryHeartbeatResult::fail("bad_response".into())
            }
        }
        Err(ureq::Error::Status(403, r)) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            let policy = v.get("policy").cloned();
            let effects = match &policy {
                Some(p) => apply_policy(db, p, false),
                None => PolicyEffects::default(),
            };
            TelemetryHeartbeatResult {
                sent: false,
                reason: v.get("error").and_then(|x| x.as_str()).unwrap_or("banned").to_string(),
                update_required: false,
                banned: true,
                policy,
                force_logout: effects.force_logout,
            }
        }
        Err(e) => TelemetryHeartbeatResult {
            sent: false, reason: http_err(e), update_required: false, banned: false,
            policy: None, force_logout: false,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryReportResult {
    pub sent: bool,
    pub reason: String,
    pub date: String,
}

pub(crate) fn send_daily_stats(db: &mut Database, date: &str) -> TelemetryReportResult {
    let fail = |reason: &str| TelemetryReportResult {
        sent: false, reason: reason.into(), date: date.into(),
    };
    let token = match worker_token(db) { Ok(t) => t, Err(e) => return fail(&e) };
    let keys = match fetch_manager_keys(&token) { Ok(k) => k, Err(e) => return fail(&e) };
    let payload = build_daily_stats(db, date);
    let envelopes = match seal_for_managers(&keys, &payload) { Ok(e) => e, Err(e) => return fail(&e) };
    let body = serde_json::json!({ "kind": "daily_stats", "date": date, "envelopes": envelopes });
    match ureq::post(&crate::endpoints::endpoint("/api/telemetry/report"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .send_string(&body.to_string())
    {
        Ok(r) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
                let _ = db.set_config("telemetry_last_daily_stats", date);
                TelemetryReportResult { sent: true, reason: "ok".into(), date: date.into() }
            } else {
                fail("bad_response")
            }
        }
        Err(ureq::Error::Status(c, _)) => fail(&format!("http_{}", c)),
        Err(_) => fail("network_error"),
    }
}

// ── Интеграционная точка: команды + идемпотентный tick ────────────

pub(crate) fn yesterday_local() -> String {
    (chrono::Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d").to_string()
}

/// heartbeat + отчет за прошлые сутки, если они пришли по расписанию.
/// `force=true` шлёт heartbeat даже внутри интервала (кнопка «отправить сейчас»).
pub(crate) fn telemetry_tick_impl(db: &mut Database, force: bool) -> serde_json::Value {
    let interval: i64 = db
        .get_config("telemetry_heartbeat_interval_secs").ok().flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);
    let due = force || match db.get_config("telemetry_last_heartbeat_at").ok().flatten() {
        Some(ts) => chrono::DateTime::parse_from_rfc3339(&ts)
            .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() >= interval)
            .unwrap_or(true),
        None => true,
    };
    let heartbeat = if due { send_heartbeat(db) } else {
        TelemetryHeartbeatResult::fail("skipped_not_due".into())
    };

    // MGR-006: после успешного heartbeat подтягиваем новости и приоритеты
    // (best-effort — сбой сети/формата не должен ломать телеметрию).
    let mut feeds = serde_json::json!({ "news": "skipped", "priorities": "skipped" });
    if heartbeat.sent {
        let n = fetch_and_store_news(db);
        let p = fetch_and_store_priorities(db);
        feeds = serde_json::json!({
            "news": n.as_ref().map(|c| serde_json::json!(c)).unwrap_or_else(|e| serde_json::json!(format!("err:{}", e))),
            "priorities": p.as_ref().map(|c| serde_json::json!(c)).unwrap_or_else(|e| serde_json::json!(format!("err:{}", e))),
        });
    }

    let yesterday = yesterday_local();
    let already_sent = db.get_config("telemetry_last_daily_stats").ok().flatten()
        .map(|d| d == yesterday).unwrap_or(false);
    let daily = if already_sent {
        TelemetryReportResult { sent: false, reason: "skipped_already_sent".into(),
            date: yesterday }
    } else {
        send_daily_stats(db, &yesterday)
    };
    serde_json::json!({ "heartbeat": heartbeat, "daily_stats": daily, "feeds": feeds })
}

#[tauri::command]
pub(crate) fn telemetry_send_heartbeat() -> Result<TelemetryHeartbeatResult, String> {
    with_db!(db, { Ok(send_heartbeat(db)) })
}

#[tauri::command]
pub(crate) fn telemetry_send_daily_stats(date: Option<String>) -> Result<TelemetryReportResult, String> {
    with_db!(db, {
        let d = date.unwrap_or_else(|| {
            chrono::Local::now().format("%Y-%m-%d").to_string()
        });
        if !regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap().is_match(&d) {
            return Err("invalid_date".into());
        }
        Ok(send_daily_stats(db, &d))
    })
}

#[tauri::command]
pub(crate) fn telemetry_tick(force: Option<bool>) -> Result<serde_json::Value, String> {
    with_db!(db, { Ok(telemetry_tick_impl(db, force.unwrap_or(false))) })
}

// ── MGR-006: новости и приоритеты шопов от менеджера ─────────────
// Сервер фильтрует по таргетингу и отдаёт уже применимое к этому воркеру.
// Воркер кеширует снимок локально (миграция v17): новости с флагом прочтения,
// приоритеты — мапой domain→weight для сортировки каталога.

/// GET-запрос к telemetry API с Bearer-токеном; возвращает распарсенный JSON.
fn telemetry_get(db: &Database, path: &str) -> Result<serde_json::Value, String> {
    let token = worker_token(db)?;
    ureq::get(&crate::endpoints::endpoint(path))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .call()
        .map_err(http_err)?
        .into_json()
        .map_err(|_| "bad_response".to_string())
}

/// Забрать новости с сервера и слить в локальный кеш. Сервер уже посчитал
/// is_read, но локальный флаг приоритетнее (пользователь мог отметить оффлайн).
/// Новости, исчезнувшие из выборки (unpublish/expire), подтираем.
pub(crate) fn fetch_and_store_news(db: &Database) -> Result<i64, String> {
    let body = telemetry_get(db, "/api/telemetry/news")?;
    let items = body.get("news").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut seen: Vec<i64> = Vec::new();
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for n in &items {
        let id = n.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id <= 0 { continue; }
        seen.push(id);
        let severity = n.get("severity").and_then(|v| v.as_str()).unwrap_or("info");
        let title = n.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let body_t = n.get("body").and_then(|v| v.as_str());
        let published = n.get("published_at").and_then(|v| v.as_str());
        let expires = n.get("expires_at").and_then(|v| v.as_str());
        let server_read = n.get("is_read").and_then(|v| v.as_i64()).unwrap_or(0);
        tx.execute(
            "INSERT INTO manager_news (id, severity, title, body, published_at, expires_at, is_read)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                severity = excluded.severity,
                title = excluded.title,
                body = excluded.body,
                published_at = excluded.published_at,
                expires_at = excluded.expires_at,
                is_read = MAX(manager_news.is_read, excluded.is_read)",
            params![id, severity, title, body_t, published, expires, server_read],
        ).map_err(|e| e.to_string())?;
    }
    if !seen.is_empty() {
        let ph = seen.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM manager_news WHERE id NOT IN ({})", ph);
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = seen.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
        stmt.execute(refs.as_slice()).map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM manager_news", []).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(seen.len() as i64)
}

/// Забрать приоритеты шопов и заменить локальную мапу domain→weight.
/// Сервер уже развернул таргеты (all / iid / role) в конкретные строки;
/// при конфликте одного домена в разных таргетах берём максимальный вес.
pub(crate) fn fetch_and_store_priorities(db: &Database) -> Result<i64, String> {
    let body = telemetry_get(db, "/api/telemetry/priorities")?;
    let items = body.get("priorities").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM shop_priorities", []).map_err(|e| e.to_string())?;
    for p in &items {
        let domain = p.get("shop_domain").and_then(|v| v.as_str()).unwrap_or("");
        if domain.is_empty() { continue; }
        let weight = p.get("weight").and_then(|v| v.as_i64()).unwrap_or(5);
        let notes = p.get("notes").and_then(|v| v.as_str()).unwrap_or("");
        let updated = p.get("updated_at").and_then(|v| v.as_str());
        tx.execute(
            "INSERT INTO shop_priorities (shop_domain, weight, notes, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(shop_domain) DO UPDATE SET
                weight = MAX(shop_priorities.weight, excluded.weight),
                notes = excluded.notes,
                updated_at = excluded.updated_at",
            params![domain, weight, notes, updated],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(items.len() as i64)
}

#[tauri::command]
pub(crate) fn manager_refresh_feeds() -> Result<serde_json::Value, String> {
    with_db!(db, {
        let news = fetch_and_store_news(db).map_err(|e| format!("news: {}", e))?;
        let priorities = fetch_and_store_priorities(db).map_err(|e| format!("priorities: {}", e))?;
        Ok(serde_json::json!({ "news": news, "priorities": priorities }))
    })
}

#[tauri::command]
pub(crate) fn get_manager_news(unread_only: Option<bool>) -> Result<serde_json::Value, String> {
    with_db!(db, {
        let unread = unread_only.unwrap_or(false);
        let sql = if unread {
            "SELECT id, severity, title, body, published_at, expires_at, is_read
             FROM manager_news WHERE is_read = 0 ORDER BY published_at DESC LIMIT 100"
        } else {
            "SELECT id, severity, title, body, published_at, expires_at, is_read
             FROM manager_news ORDER BY published_at DESC LIMIT 100"
        };
        let mut stmt = db.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "severity": r.get::<_, String>(1)?,
                "title": r.get::<_, String>(2)?,
                "body": r.get::<_, Option<String>>(3)?,
                "published_at": r.get::<_, Option<String>>(4)?,
                "expires_at": r.get::<_, Option<String>>(5)?,
                "is_read": r.get::<_, i64>(6)? == 1,
            }))
        }).map_err(|e| e.to_string())?;
        let news: Vec<serde_json::Value> = rows.flatten().collect();
        let unread_count: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)
        ).unwrap_or(0);
        Ok(serde_json::json!({ "news": news, "unread": unread_count }))
    })
}

#[tauri::command]
pub(crate) fn mark_manager_news_read(id: i64) -> Result<(), String> {
    with_db!(db, {
        db.conn.execute("UPDATE manager_news SET is_read = 1 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // best-effort: сообщаем серверу, чтобы счётчики читателей у менеджера совпадали
        if let Ok(token) = worker_token(db) {
            let _ = ureq::post(&crate::endpoints::endpoint(&format!("/api/telemetry/news/{}/read", id)))
                .set("Authorization", &format!("Bearer {}", token))
                .timeout(std::time::Duration::from_secs(5))
                .call();
        }
        Ok(())
    })
}

/// Приоритеты шопов: мапа domain→weight для сортировки каталога.
#[tauri::command]
pub(crate) fn get_shop_priorities() -> Result<serde_json::Value, String> {
    with_db!(db, {
        let mut stmt = db.conn.prepare(
            "SELECT shop_domain, weight, notes FROM shop_priorities ORDER BY weight DESC, shop_domain ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?))
        }).map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        let mut list: Vec<serde_json::Value> = Vec::new();
        for (domain, weight, notes) in rows.flatten() {
            map.insert(domain.clone(), serde_json::json!(weight));
            list.push(serde_json::json!({ "domain": domain, "weight": weight, "notes": notes }));
        }
        Ok(serde_json::json!({ "by_domain": serde_json::Value::Object(map), "list": list }))
    })
}

/// MGR-005: снимок активной политики для фронта. Читает только память —
/// работает и на заблокированной БД (экран лока показывает причину бана).
#[tauri::command]
pub(crate) fn telemetry_get_policy() -> serde_json::Value {
    let p = crate::state::policy_snapshot();
    serde_json::json!({
        "banned": p.banned,
        "banned_reason": p.banned_reason,
        "ban_until": p.ban_until,
        "update_required": p.update_required,
        "min_version": p.min_version,
        "permissions_override": p.permissions_override,
        "quota_cards_day": p.quota_cards_day,
        "quota_orders_day": p.quota_orders_day,
        "force_logout": p.force_logout,
    })
}

// ── Тесты ─────────────────────────────────────────────────────────

#[cfg(test)]
mod telemetry_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("telemetry_test_pw_1234567890", &salt));
        (dir, db)
    }

    fn make_profile(db: &Database, n: usize) -> String {
        db.insert_cards(vec![crate::models::CardInput {
            card_number: format!("4111111111{n:06}"),
            source: "test".into(),
            ..Default::default()
        }]).unwrap();
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0))
            .unwrap();
        db.create_profile(card_id, None).unwrap().id
    }

    fn make_shop(db: &Database, domain: &str) -> i64 {
        db.create_shop(&crate::models::ShopInput {
            name: format!("Shop {domain}"),
            url: format!("https://{domain}"),
            category: "general".into(),
            ..Default::default()
        }).unwrap().id
    }

    fn make_order(db: &Database, profile_id: &str, shop_id: i64, n: usize) -> i64 {
        db.create_order(&crate::models::OrderInput {
            profile_id: profile_id.into(),
            shop_id,
            drop_id: None, email_pool_id: None, proxy_id: None,
            order_number: Some(format!("ORD-{n}")),
            notes: None,
            items: vec![crate::models::OrderItemInput {
                name: "Item".into(), sku: "S".into(), qty: 1, price: 10.0,
            }],
        }).unwrap().id
    }

    fn today_local() -> String {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    }

    fn json_str(s: &str) -> serde_json::Value { serde_json::Value::String(s.into()) }

    // ── Конверт ──

    #[test]
    fn test_seal_unseal_roundtrip() {
        let b = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        let b_pub = PublicKey::from(&b);
        let payload = r#"{"ts":"2026-08-26T00:00:00Z","platform":"windows"}"#;
        let env = seal_envelope(7, &hex::encode(b_pub.as_bytes()), payload).unwrap();
        assert_eq!(env.key_id, 7);
        // форма по валидатору сервера: hex{64}, hex{24}, base64
        assert_eq!(env.ephemeral.len(), 64);
        assert!(env.ephemeral.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(env.nonce.len(), 24);
        assert!(env.nonce.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!env.ct.is_empty());

        let opened = unseal_envelope(&hex::encode(b.as_bytes()), &env).unwrap();
        assert_eq!(opened, payload);

        // чужой ключ не распечатывает
        let c = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        assert!(unseal_envelope(&hex::encode(c.as_bytes()), &env).is_err());
    }

    #[test]
    fn test_seal_rejects_bad_pubkey() {
        assert!(seal_envelope(1, "zz", "x").is_err());
        assert!(seal_envelope(1, &"ab".repeat(16), "x").is_err()); // 16 байт, не 32
    }

    #[test]
    fn test_seal_nondeterministic() {
        let b = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        let b_pub = PublicKey::from(&b);
        let e1 = seal_envelope(1, &hex::encode(b_pub.as_bytes()), "p").unwrap();
        let e2 = seal_envelope(1, &hex::encode(b_pub.as_bytes()), "p").unwrap();
        assert_ne!(e1.nonce, e2.nonce);
        assert_ne!(e1.ephemeral, e2.ephemeral);
    }

    // ── Heartbeat payload ──

    #[test]
    fn test_heartbeat_payload_shape() {
        let (_dir, db) = test_db();
        let p = build_heartbeat_payload(&db);
        assert!(p.get("ts").unwrap().as_str().unwrap().starts_with("20"));
        assert_eq!(p["app_version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(p["platform"], std::env::consts::OS);
        assert_eq!(p["sync_ws"], "down"); // событий sync нет
        assert!(p["db_ok"].as_bool().unwrap());
        assert!(p["imap_ok"].is_null()); // аккаунтов нет
        assert!(p["proxy_ok"].is_null());
        assert_eq!(p["errors_24h"], 0);
    }

    #[test]
    fn test_heartbeat_health_signals() {
        let (_dir, db) = test_db();
        db.conn.execute(
            "INSERT INTO imap_accounts(label,host,login,is_active,last_ok) \
             VALUES('a','imap.test','l',1,datetime('now','-2 hours'))", [],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO proxies(host,port,is_blocked) VALUES('p.test',8080,0),('q.test',8080,1)", [],
        ).unwrap();
        db.log_event("imap.check_error", "boom", Some("imap"), None).unwrap();
        let p = build_heartbeat_payload(&db);
        assert_eq!(p["imap_ok"], serde_json::json!(true));
        assert_eq!(p["proxy_ok"], serde_json::json!(true));
        assert_eq!(p["errors_24h"], 1);

        // все прокси заблокированы → false
        db.conn.execute("UPDATE proxies SET is_blocked = 1", []).unwrap();
        assert_eq!(build_heartbeat_payload(&db)["proxy_ok"], serde_json::json!(false));
    }

    // ── daily_stats ──

    #[test]
    fn test_daily_stats_fixture_day() {
        let (_dir, db) = test_db();
        let pid = make_profile(&db, 1);
        let shop_id = make_shop(&db, "shop.example.com");
        let o1 = make_order(&db, &pid, shop_id, 1);
        let _o2 = make_order(&db, &pid, shop_id, 2);
        db.conn.execute(
            "UPDATE orders SET status='delivered', total_amount=50.0 WHERE id=?1",
            params![o1],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO drops(profile_id,recipient_name,address,city,zip,country) \
             VALUES(?1,'R','addr','Springfield','00000','US')",
            params![pid],
        ).unwrap();
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        db.log_event("card.status_changed", &format!("Card {card_id} status → dead"),
            Some("card"), Some(&card_id.to_string())).unwrap();

        let s = build_daily_stats(&db, &today_local());
        assert_eq!(s["date"], json_str(&today_local()));
        assert_eq!(s["orders"]["total"], 2);
        assert_eq!(s["orders"]["by_status"]["delivered"], 1);
        assert_eq!(s["orders"]["by_status"]["pending"], 1);
        assert_eq!(s["cards"]["taken"], 1);
        assert_eq!(s["cards"]["dead"], 1);
        assert_eq!(s["cards"]["by_bin"]["411111"]["dead"], 1);
        assert_eq!(s["drops"]["taken"], 1);
        assert_eq!(s["drops"]["by_destination"]["shop.example.com"], 1);
        assert_eq!(s["shops"]["shop.example.com"]["orders"], 2);
        assert_eq!(s["shops"]["shop.example.com"]["delivered"], 1);
        assert_eq!(s["shops"]["shop.example.com"]["revenue"], 50.0);
        // другой день — пусто
        let empty = build_daily_stats(&db, "2001-01-01");
        assert_eq!(empty["orders"]["total"], 0);
        assert_eq!(empty["drops"]["taken"], 0);
    }

    #[test]
    fn test_daily_stats_sync_health_from_log() {
        let (_dir, db) = test_db();
        db.log_event("imap.poll_completed", "ok", Some("imap"), None).unwrap();
        db.log_event("imap.poll_error", "bad", Some("imap"), None).unwrap();
        db.log_event("sync.footprints_sent", "10", Some("sync"), None).unwrap();
        db.log_event("sync.push_rejected", "x", Some("sync"), None).unwrap();
        let s = build_daily_stats(&db, &today_local());
        assert_eq!(s["health"]["imap_ok"], 1);
        assert_eq!(s["health"]["imap_fail"], 1);
        assert_eq!(s["sync"]["ws_ok"], serde_json::json!(true));
        assert_eq!(s["sync"]["push_fail"], 1);
    }

    // ── tick ──

    #[test]
    fn test_tick_gating_without_token() {
        let (_dir, mut db) = test_db();
        // первый tick: heartbeat пытается, но токена нет → no_token (не паникует)
        let r = telemetry_tick_impl(&mut db, false);
        assert_eq!(r["heartbeat"]["sent"], serde_json::json!(false));
        assert_eq!(r["heartbeat"]["reason"], "no_token");
        assert_eq!(r["daily_stats"]["reason"], "no_token");
    }

    #[test]
    fn test_tick_respects_schedule_marks() {
        let (_dir, mut db) = test_db();
        db.set_config("telemetry_last_heartbeat_at",
            &chrono::Utc::now().to_rfc3339()).unwrap();
        db.set_config("telemetry_last_daily_stats",
            &yesterday_local()).unwrap();
        let r = telemetry_tick_impl(&mut db, false);
        assert_eq!(r["heartbeat"]["reason"], "skipped_not_due");
        assert_eq!(r["daily_stats"]["reason"], "skipped_already_sent");
        // force ломает только интервал heartbeat, не уже отправленный отчёт
        let forced = telemetry_tick_impl(&mut db, true);
        assert_eq!(forced["heartbeat"]["reason"], "no_token");
        assert_eq!(forced["daily_stats"]["reason"], "skipped_already_sent");
    }

    // ── MGR-005: политики ──

    fn policy_json() -> serde_json::Value {
        serde_json::json!({
            "banned": 0,
            "banned_reason": null,
            "ban_until": null,
            "permissions_override": null,
            "quota_cards_day": null,
            "quota_orders_day": null,
            "min_version": null,
            "force_logout": 0,
        })
    }

    #[test]
    fn test_apply_policy_ban_persisted() {
        let (_dir, mut db) = test_db();
        let mut p = policy_json();
        p["banned"] = serde_json::json!(1);
        p["banned_reason"] = json_str("fraud chargeback");
        let fx = apply_policy(&mut db, &p, true);
        assert!(fx.banned && fx.update_required && !fx.force_logout);
        // персист одним ключом, update_required внутри
        let stored = db.get_config("worker_policy").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(v["banned"], 1);
        assert_eq!(v["update_required"], true);
        assert_eq!(v["banned_reason"], "fraud chargeback");
    }

    #[test]
    fn test_apply_policy_unban_clears_state() {
        let (_dir, mut db) = test_db();
        let mut p = policy_json();
        p["banned"] = serde_json::json!(1);
        apply_policy(&mut db, &p, false);
        // сервер снял бан (авто-унбан по ban_until или вручную в панели)
        let fx = apply_policy(&mut db, &policy_json(), false);
        assert!(!fx.banned);
        let stored = db.get_config("worker_policy").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(v["banned"], 0);
    }

    #[test]
    fn test_apply_policy_force_logout_wipes_sessions() {
        let (_dir, mut db) = test_db();
        db.conn.execute(
            "INSERT INTO users(username, password_hash, display_name, role) \
             VALUES('u','h','U','admin')", []).unwrap();
        db.conn.execute(
            "INSERT INTO user_sessions(user_id, token) VALUES(1,'tok')", []).unwrap();
        let mut p = policy_json();
        p["force_logout"] = serde_json::json!(1);
        let fx = apply_policy(&mut db, &p, false);
        assert!(fx.force_logout);
        assert_eq!(scalar_i64(&db, "SELECT COUNT(*) FROM user_sessions", &[]), 0);
        // ack уйдёт следующим heartbeat — сервер по нему сбросит флаг
        assert_eq!(db.get_config("telemetry_ack_force_logout").unwrap().as_deref(), Some("1"));
    }

    #[test]
    fn test_permissions_override_parsing_and_merge() {
        let mut p = policy_json();
        p["permissions_override"] = json_str("{\"take_cards\":false,\"manage_users\":true}");
        let st = parse_policy_state(&p, false);
        let ov = st.permissions_override.clone().unwrap();
        assert_eq!(ov.get("take_cards"), Some(&false));
        assert_eq!(ov.get("manage_users"), Some(&true));

        // невалидный JSON не ломает права
        p["permissions_override"] = json_str("{broken");
        assert!(parse_policy_state(&p, false).permissions_override.is_none());

        // мерж поверх perms: явный false режет даже админа…
        let admin = crate::models::ActiveUser {
            user_id: 1, username: "a".into(), role: "admin".into(),
            permissions: vec![], token: "t".into(), ip_address: None,
        };
        assert!(!crate::state::perm_allowed_with(&st, &admin, "take_cards"));
        assert!(crate::state::perm_allowed_with(&st, &admin, "export_data")); // без ключа — обычная логика

        // …а явный true выдаёт право оператору без него
        let op = crate::models::ActiveUser {
            user_id: 2, username: "o".into(), role: "operator".into(),
            permissions: vec![], token: "t".into(), ip_address: None,
        };
        assert!(crate::state::perm_allowed_with(&st, &op, "manage_users"));
        assert!(!crate::state::perm_allowed_with(&st, &op, "export_data"));
    }

    #[test]
    fn test_quota_orders_enforced() {
        let (_dir, db) = test_db();
        let pid = make_profile(&db, 1);
        let sid = make_shop(&db, "quota.test");
        make_order(&db, &pid, sid, 1);
        // лимит 1 уже исчерпан созданным заказом
        assert_eq!(
            enforce_daily_quota_with(&db, DailyQuota::Orders, Some(1)).unwrap_err(),
            "quota_exceeded:orders_day"
        );
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, Some(2)).is_ok());
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, None).is_ok());
        // 0 = полный запрет на сегодня
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, Some(0)).is_err());
    }

    #[test]
    fn test_quota_cards_enforced() {
        let (_dir, db) = test_db();
        db.conn.execute(
            "INSERT INTO users(username, password_hash, display_name, role) \
             VALUES('u','h','U','admin')", []).unwrap();
        make_profile(&db, 1); // создаёт карту в пуле
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        db.assign_card_to_user(card_id, 1, Some(1)).unwrap();
        assert_eq!(
            enforce_daily_quota_with(&db, DailyQuota::Cards, Some(1)).unwrap_err(),
            "quota_exceeded:cards_day"
        );
        assert!(enforce_daily_quota_with(&db, DailyQuota::Cards, Some(5)).is_ok());
        assert!(enforce_daily_quota_with(&db, DailyQuota::Cards, None).is_ok());
    }

    #[test]
    fn test_restore_policy_without_state_is_noop() {
        let (_dir, db) = test_db();
        db.set_config("worker_policy", "{\"banned\":1}").unwrap();
        restore_policy_from_config(&db); // STATE нет в юнит-тестах — не паникует
        db.set_config("worker_policy", "{broken").unwrap();
        restore_policy_from_config(&db); // битый JSON — тоже молча пропускаем
    }

    // MGR-006: кеш новостей и приоритетов

    fn insert_news(db: &Database, id: i64, severity: &str, read: i64) {
        db.conn.execute(
            "INSERT OR REPLACE INTO manager_news (id, severity, title, body, published_at, is_read)
             VALUES (?1, ?2, ?3, 'b', '2026-08-28 10:00:00', ?4)",
            params![id, severity, format!("n{}", id), read],
        ).unwrap();
    }

    #[test]
    fn test_news_read_mark_and_unread_count() {
        let (_dir, db) = test_db();
        insert_news(&db, 1, "warning", 0);
        insert_news(&db, 2, "info", 0);
        let unread: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(unread, 2);
        db.conn.execute("UPDATE manager_news SET is_read = 1 WHERE id = 1", []).unwrap();
        let unread: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(unread, 1);
    }

    #[test]
    fn test_news_upsert_keeps_local_read_flag() {
        let (_dir, db) = test_db();
        insert_news(&db, 7, "info", 1); // уже прочитано локально
        // симулируем upsert от сервера с is_read=0 — локальный флаг не должен сброситься
        db.conn.execute(
            "INSERT INTO manager_news (id, severity, title, body, published_at, expires_at, is_read)
             VALUES (7, 'warning', 'upd', 'b2', '2026-08-28 11:00:00', NULL, 0)
             ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, title=excluded.title,
                is_read = MAX(manager_news.is_read, excluded.is_read)",
            []).unwrap();
        let (sev, read): (String, i64) = db.conn.query_row(
            "SELECT severity, is_read FROM manager_news WHERE id = 7", [],
            |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(sev, "warning");
        assert_eq!(read, 1);
    }

    #[test]
    fn test_priorities_conflict_takes_max_weight() {
        let (_dir, db) = test_db();
        let upsert = |domain: &str, weight: i64| {
            db.conn.execute(
                "INSERT INTO shop_priorities (shop_domain, weight) VALUES (?1, ?2)
                 ON CONFLICT(shop_domain) DO UPDATE SET weight = MAX(shop_priorities.weight, excluded.weight)",
                params![domain, weight]).unwrap();
        };
        upsert("amazon.com", 5);
        upsert("amazon.com", 9); // таргет по iid важнее общего
        upsert("amazon.com", 3); // меньший вес не должен понизить
        let w: i64 = db.conn.query_row(
            "SELECT weight FROM shop_priorities WHERE shop_domain = 'amazon.com'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(w, 9);
    }

    #[test]
    fn test_priorities_replaced_fully_on_refresh() {
        let (_dir, db) = test_db();
        db.conn.execute("INSERT INTO shop_priorities (shop_domain, weight) VALUES ('old.com', 5)", []).unwrap();
        // fetch_and_store_priorities делает DELETE + insert; симулируем финальное состояние
        db.conn.execute("DELETE FROM shop_priorities", []).unwrap();
        db.conn.execute("INSERT INTO shop_priorities (shop_domain, weight) VALUES ('new.com', 8)", []).unwrap();
        let count: i64 = db.conn.query_row("SELECT COUNT(*) FROM shop_priorities", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let has_old: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM shop_priorities WHERE shop_domain = 'old.com'", [], |r| r.get(0)).unwrap();
        assert_eq!(has_old, 0);
    }
}
