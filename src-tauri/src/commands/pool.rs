//! REDESIGN-05-5B1: пул карт — самообслуживание воркера.
//!
//! Дополняет адресную выдачу (slices.rs): менеджер заливает срезы в общий
//! пул, зашифровав их симметричным ключом пула (AES-256-GCM), а ключ раздаёт
//! воркерам запечатанным их X25519-пубключами (тот же sealed-box, что у
//! slices/telemetry). Воркер бронирует карты сам:
//!
//!   pool_status          → GET  /sync/cards/pool          (сколько свободно + мои брони)
//!   pool_reserve(count)  → POST /sync/cards/pool/reserve  → расшифровать → insert → ack
//!   pool_release(ids)    → POST /sync/cards/pool/release  (вернуть неиспользованную бронь)
//!   pool_report_outcome  → POST /sync/cards/pool/outcome  (used/burned по взятым картам)
//!
//! Формат среза пула: sealed_data = base64(nonce[12] || AES-256-GCM(key=pool,
//! plaintext=JSON payload формата slices::slice_to_card)). Формат share
//! ключа: sealed_key = sealed-box конверт (telemetry::TelemetryEnvelope),
//! payload = hex(32 байта ключа пула). Контракт зафиксирован в
//! docs/MANAGER_APP.md и cc-sync-server/routes/card-pool.js.

use crate::commands::slices::{ensure_slice_key, slice_to_card};
use crate::database::Database;
use crate::models::perms;
use crate::state::{require_perm, with_db};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::Emitter;

const POOL_KEY_PREFIX: &str = "card_pool_key_";
const HTTP_TIMEOUT_SECS: u64 = 30;
const MAX_RESERVE_PER_CALL: i64 = 50;
const POOL_OUTCOMES: [&str; 2] = ["used", "burned"];

// Локальные копии auth_token/register_key_if_needed из slices.rs (там они
// приватные, а файл сейчас — чужая рабочая зона MGR-018C). Держать в синхроне
// с оригиналами; после стабилизации дерева можно вернуть переиспользование.
fn pool_auth_token(db: &Database) -> Result<String, String> {
    db.get_config("license_token")
        .map_err(|e| e.to_string())?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "license_not_activated".to_string())
}

fn pool_register_key_if_needed(db: &Database, token: &str) -> Result<(), String> {
    const REGISTERED_CFG: &str = "worker_slice_key_registered";
    if db
        .get_config(REGISTERED_CFG)
        .map_err(|e| e.to_string())?
        .as_deref()
        == Some("1")
    {
        return Ok(());
    }
    let priv_hex = ensure_slice_key(db)?;
    let body = serde_json::json!({ "pubkey": crate::commands::slices::pubkey_hex(&priv_hex), "label": "worker-slices" });
    let resp = ureq::post(&crate::endpoints::endpoint("/sync/worker-key/register"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&body.to_string())
        .map_err(|e| format!("worker_key_register: {e}"))?;
    let _ = resp.into_json::<serde_json::Value>();
    db.set_config(REGISTERED_CFG, "1").ok();
    Ok(())
}

fn validate_count(count: i64) -> Result<i64, String> {
    if !(1..=MAX_RESERVE_PER_CALL).contains(&count) {
        return Err(format!("count_invalid: 1..={MAX_RESERVE_PER_CALL}"));
    }
    Ok(count)
}

fn validate_outcome(outcome: &str) -> Result<&str, String> {
    let o = outcome.trim();
    if POOL_OUTCOMES.contains(&o) {
        Ok(if o == "used" { "used" } else { "burned" })
    } else {
        Err("outcome_invalid: used|burned".into())
    }
}

/// Достать тело {error} из ответа с ошибкой, чтобы фронт показал
/// серверную причину (worker_paused / quota_cards_exceeded / ...).
fn http_err(context: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let detail = resp
                .into_json::<Value>()
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
                .unwrap_or_else(|| format!("http_{code}"));
            format!("{context}: {detail}")
        }
        other => format!("{context}: {other}"),
    }
}

fn post_json(path: &str, token: &str, body: &Value) -> Result<Value, String> {
    let resp = ureq::post(&crate::endpoints::endpoint(path))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&body.to_string())
        .map_err(|e| http_err(path, e))?;
    resp.into_json::<Value>().map_err(|e| format!("{path}: parse: {e}"))
}

fn get_json(path: &str, token: &str) -> Result<Value, String> {
    let resp = ureq::get(&crate::endpoints::endpoint(path))
        .set("Authorization", &format!("Bearer {token}"))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| http_err(path, e))?;
    resp.into_json::<Value>().map_err(|e| format!("{path}: parse: {e}"))
}

// ── Ключ пула ────────────────────────────────────────────────────────────────

/// Ключ пула из локального config-KV.
fn stored_pool_key(db: &Database, key_id: i64) -> Result<Option<String>, String> {
    db.get_config(&format!("{POOL_KEY_PREFIX}{key_id}"))
        .map_err(|e| e.to_string())
        .map(|opt| opt.filter(|s| !s.is_empty()))
}

/// Забрать с сервера мой share активного ключа пула и распечатать его
/// приватным X25519-ключом срезов. Возвращает (key_id, key_hex).
fn fetch_pool_key(db: &Database, token: &str) -> Result<Option<(i64, String)>, String> {
    let body = get_json("/sync/cards/pool/key", token)?;
    let key_id = body.get("key_id").and_then(|v| v.as_i64());
    let sealed = body.get("sealed_key").and_then(|v| v.as_str()).unwrap_or("");
    let key_id = match key_id {
        Some(id) if id > 0 && !sealed.is_empty() => id,
        _ => return Ok(None),
    };
    let env: crate::commands::telemetry::TelemetryEnvelope =
        serde_json::from_str(sealed).map_err(|e| format!("pool_key_sealed_parse: {e}"))?;
    let priv_hex = ensure_slice_key(db)?;
    let key_hex = crate::commands::telemetry::unseal_envelope(&priv_hex, &env)
        .map_err(|e| format!("pool_key_unseal: {e}"))?;
    if hex::decode(key_hex.trim()).map(|b| b.len() != 32).unwrap_or(true) {
        return Err("pool_key_invalid: ожидался hex 32 байт".into());
    }
    db.set_config(&format!("{POOL_KEY_PREFIX}{key_id}"), key_hex.trim())
        .map_err(|e| e.to_string())?;
    let _ = db.log_event("pool.key_received", &format!("key_id={key_id}"), Some("card"), None);
    Ok(Some((key_id, key_hex.trim().to_string())))
}

/// Ключ для конкретного среза: из KV, иначе — fetch активного с сервера
/// (reserve гарантирует, что share на этот key_id у меня есть).
fn pool_key_for(db: &Database, token: &str, key_id: i64) -> Result<String, String> {
    if let Some(k) = stored_pool_key(db, key_id)? {
        return Ok(k);
    }
    match fetch_pool_key(db, token)? {
        Some((fetched_id, k)) if fetched_id == key_id => Ok(k),
        Some((fetched_id, _)) => Err(format!(
            "pool_key_unavailable: нужен key_id={key_id}, сервер отдал активный {fetched_id} — попросите менеджера дораздать ключ"
        )),
        None => Err("pool_key_unavailable: менеджер не выдал ключ пула".into()),
    }
}

// ── Шифрование срезов пула (AES-256-GCM сырым ключом пула) ──────────────────

pub(crate) fn decrypt_pool_slice(key_hex: &str, sealed_data: &str) -> Result<String, String> {
    let key_bytes = hex::decode(key_hex.trim()).map_err(|e| format!("pool_key_hex: {e}"))?;
    if key_bytes.len() != 32 {
        return Err("pool_key_len: ожидалось 32 байта".into());
    }
    let blob = base64::engine::general_purpose::STANDARD
        .decode(sealed_data.trim())
        .map_err(|e| format!("pool_slice_b64: {e}"))?;
    if blob.len() <= 12 {
        return Err("pool_slice_short".into());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let plain = cipher
        .decrypt(Nonce::from_slice(&blob[..12]), &blob[12..])
        .map_err(|_| "pool_slice_decrypt: auth failed")?;
    String::from_utf8(plain).map_err(|e| format!("pool_slice_utf8: {e}"))
}

/// Шифрование тем же контрактом (nonce[12] || ct, base64) — для тестов и
/// будущей менеджерской реализации на этой же стороне.
#[cfg(test)]
pub(crate) fn encrypt_pool_slice(key_hex: &str, plaintext: &str) -> Result<String, String> {
    use aes_gcm::aead::rand_core::RngCore;
    let key_bytes = hex::decode(key_hex.trim()).map_err(|e| format!("pool_key_hex: {e}"))?;
    if key_bytes.len() != 32 {
        return Err("pool_key_len".into());
    }
    let mut nonce = [0u8; 12];
    aes_gcm::aead::OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| "pool_slice_encrypt")?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ct);
    Ok(base64::engine::general_purpose::STANDARD.encode(blob))
}

// ── Импорт ───────────────────────────────────────────────────────────────────

/// Расшифровать срез пула, вставить карту и связать её с серверным срезом
/// (card_pool_links). Возвращает (card_id, inserted): card_id=0, если дедуп.
fn import_pool_slice(db: &Database, pool_slice_id: i64, server_card_hash: &str, sealed_data: &str, key_hex: &str) -> Result<(i64, usize), String> {
    let plaintext = decrypt_pool_slice(key_hex, sealed_data)?;
    let payload: Value = serde_json::from_str(&plaintext).map_err(|e| format!("pool_payload: {e}"))?;
    let card = slice_to_card(&payload)?;
    let pan = card.card_number.clone();
    let inserted = db.insert_cards(vec![card])?;
    if inserted == 0 {
        return Ok((0, 0)); // дедуп по локальному card_hash — карта уже есть
    }
    let local_hash = format!("{:x}", Sha256::digest(pan.as_bytes()));
    let card_id: i64 = db
        .conn
        .query_row(
            "SELECT id FROM credit_cards WHERE card_hash = ?1",
            rusqlite::params![local_hash],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    db.conn
        .execute(
            "INSERT OR IGNORE INTO card_pool_links (pool_slice_id, card_id, card_hash) VALUES (?1, ?2, ?3)",
            rusqlite::params![pool_slice_id, card_id, server_card_hash],
        )
        .map_err(|e| e.to_string())?;
    Ok((card_id, inserted))
}

/// Общий конвейер «срезы → карты → ack»: возвращает статистику и списки id.
fn import_reserved_locked(db: &Database, token: &str, slices: &[Value]) -> Result<Value, String> {
    let mut ack_ids: Vec<i64> = Vec::new();
    let mut failed_ids: Vec<i64> = Vec::new();
    let mut imported = 0usize;
    let mut duplicates = 0usize;
    let mut first_error = String::new();

    for s in slices {
        let id = s["id"].as_i64().unwrap_or(0);
        let key_id = s["key_id"].as_i64().unwrap_or(0);
        let sealed = s["sealed_data"].as_str().unwrap_or("");
        let card_hash = s["card_hash"].as_str().unwrap_or("");
        if id <= 0 || key_id <= 0 || sealed.is_empty() {
            continue;
        }
        let outcome = pool_key_for(db, token, key_id)
            .and_then(|key_hex| import_pool_slice(db, id, card_hash, sealed, &key_hex));
        match outcome {
            Ok((_, 0)) => {
                duplicates += 1;
                ack_ids.push(id);
            }
            Ok((_, n)) => {
                imported += n;
                ack_ids.push(id);
            }
            Err(e) => {
                let _ = db.log_event("pool.slice_failed", &format!("slice #{id}: {e}"), Some("card"), None);
                if first_error.is_empty() {
                    first_error = format!("slice #{id}: {e}");
                }
                // Не смогли расшифровать/вставить — не держим бронь, пусть
                // срез вернётся в пул и его заберёт кто-то с нужным ключом.
                failed_ids.push(id);
            }
        }
    }

    let mut acked = 0i64;
    if !ack_ids.is_empty() {
        let resp = post_json("/sync/cards/pool/ack", token, &json!({ "ids": ack_ids }))?;
        acked = resp.get("acked").and_then(|v| v.as_i64()).unwrap_or(0);
    }
    let mut released_failed = 0i64;
    if !failed_ids.is_empty() {
        released_failed = post_json("/sync/cards/pool/release", token, &json!({ "ids": failed_ids }))
            .ok()
            .and_then(|v| v.get("released").and_then(|n| n.as_i64()))
            .unwrap_or(0);
    }

    Ok(json!({
        "imported": imported,
        "duplicates": duplicates,
        "failed": failed_ids.len(),
        "acked": acked,
        "released_failed": released_failed,
        "first_error": if first_error.is_empty() { Value::Null } else { json!(first_error) },
    }))
}

// ── Команды ──────────────────────────────────────────────────────────────────

/// Обзор пула: сколько карт доступно лично мне (по розданным ключам) и мои
/// брони. sealed_data из ответа вырезается — расшифровка только в reserve.
#[tauri::command]
pub(crate) fn pool_status() -> Result<Value, String> {
    require_perm(perms::VIEW_CARDS_POOL)?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".to_string());
        }
        let token = pool_auth_token(db)?;
        let mut body = get_json("/sync/cards/pool", &token)?;
        if let Some(mine) = body.get_mut("mine").and_then(|m| m.as_array_mut()) {
            for s in mine.iter_mut() {
                let has = s.get("sealed_data").and_then(|v| v.as_str()).map(|v| !v.is_empty()).unwrap_or(false);
                if let Some(o) = s.as_object_mut() {
                    o.remove("sealed_data");
                    o.insert("has_sealed".into(), json!(has));
                }
            }
        }
        Ok(body)
    })
}

/// Забронировать count карт из пула, расшифровать, вставить, подтвердить.
/// Нерасшифрованные срезы возвращаются в пул (release) с записью в лог.
#[tauri::command]
pub(crate) fn pool_reserve(app: tauri::AppHandle, count: i64) -> Result<Value, String> {
    require_perm(perms::TAKE_CARDS)?;
    let count = validate_count(count)?;
    let result: Result<Value, String> = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".to_string());
        }
        let token = pool_auth_token(db)?;
        pool_register_key_if_needed(db, &token)?;
        let body = post_json("/sync/cards/pool/reserve", &token, &json!({ "count": count }))?;
        let slices = body.get("slices").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let reserved = body.get("reserved").and_then(|v| v.as_i64()).unwrap_or(0);
        let mut stats = import_reserved_locked(db, &token, &slices)?;
        if let Some(o) = stats.as_object_mut() {
            o.insert("requested".into(), json!(count));
            o.insert("reserved".into(), json!(reserved));
        }
        let _ = db.log_event(
            "pool.reserve",
            &format!("requested={count} reserved={reserved} imported={} failed={}",
                stats.get("imported").and_then(|v| v.as_i64()).unwrap_or(0),
                stats.get("failed").and_then(|v| v.as_i64()).unwrap_or(0)),
            Some("card"),
            None,
        );
        Ok(stats)
    });
    let result = result?;
    let _ = app.emit("pool_updated", result.clone());
    Ok(result)
}

/// Вернуть неиспользованную бронь в пул (только до ack — подтверждённые
/// карты уже локально, их возвращает менеджер через /cards/pool/return).
#[tauri::command]
pub(crate) fn pool_release(app: tauri::AppHandle, ids: Vec<i64>) -> Result<Value, String> {
    require_perm(perms::TAKE_CARDS)?;
    if ids.is_empty() || ids.len() > 100 || ids.iter().any(|i| *i <= 0) {
        return Err("ids_array_required".into());
    }
    let result: Result<Value, String> = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".to_string());
        }
        let token = pool_auth_token(db)?;
        let body = post_json("/sync/cards/pool/release", &token, &json!({ "ids": ids }))?;
        let _ = db.log_event(
            "pool.release",
            &format!("ids={} released={}", ids.len(), body.get("released").and_then(|v| v.as_i64()).unwrap_or(0)),
            Some("card"),
            None,
        );
        Ok(body)
    });
    let result = result?;
    let _ = app.emit("pool_updated", result.clone());
    Ok(result)
}

/// Отчёт по взятым картам: used/burned. Локальные card_id переводятся
/// в серверные pool_slice_id через card_pool_links.
#[tauri::command]
pub(crate) fn pool_report_outcome(app: tauri::AppHandle, card_ids: Vec<i64>, outcome: String) -> Result<Value, String> {
    require_perm(perms::TAKE_CARDS)?;
    let outcome = validate_outcome(&outcome)?;
    if card_ids.is_empty() || card_ids.len() > 100 || card_ids.iter().any(|i| *i <= 0) {
        return Err("card_ids_array_required".into());
    }
    let result: Result<Value, String> = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".to_string());
        }
        let placeholders = card_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT pool_slice_id FROM card_pool_links WHERE card_id IN ({placeholders})"
        );
        let mut stmt = db.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let slice_ids: Vec<i64> = stmt
            .query_map(rusqlite::params_from_iter(card_ids.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        let skipped_unlinked = card_ids.len() - slice_ids.len();
        if slice_ids.is_empty() {
            return Ok(json!({ "updated": 0, "skipped_unlinked": skipped_unlinked }));
        }
        let token = pool_auth_token(db)?;
        let body = post_json("/sync/cards/pool/outcome", &token, &json!({ "ids": slice_ids, "outcome": outcome }))?;
        let updated = body.get("updated").and_then(|v| v.as_i64()).unwrap_or(0);
        let _ = db.log_event(
            "pool.outcome",
            &format!("outcome={outcome} updated={updated} skipped_unlinked={skipped_unlinked}"),
            Some("card"),
            None,
        );
        Ok(json!({ "updated": updated, "skipped_unlinked": skipped_unlinked }))
    });
    let result = result?;
    let _ = app.emit("pool_updated", result.clone());
    Ok(result)
}

#[cfg(test)]
mod pool_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pool.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new(
            "pool_test_pw_1234567890",
            &salt,
        ));
        (dir, db)
    }

    fn sample_payload() -> Value {
        json!({
            "v": 1,
            "card_hash": "srv-hash-1",
            "pan": "5555555555554444",
            "exp": "01/29",
            "cvv": "321",
            "extra": { "holder": "JANE DOE", "zip": "20001" },
            "issued_at": "2026-08-30 12:00:00",
        })
    }

    #[test]
    fn pool_slice_crypto_roundtrip_and_tamper() {
        let key_hex = hex::encode([7u8; 32]);
        let sealed = encrypt_pool_slice(&key_hex, "{\"ok\":true}").unwrap();
        let plain = decrypt_pool_slice(&key_hex, &sealed).unwrap();
        assert_eq!(plain, "{\"ok\":true}");

        // Чужой ключ — auth failure
        let other = hex::encode([9u8; 32]);
        assert!(decrypt_pool_slice(&other, &sealed).is_err());
        // Битый base64 / короткий blob
        assert!(decrypt_pool_slice(&key_hex, "!!!").is_err());
        assert!(decrypt_pool_slice(&key_hex, "aGk=").is_err()); // "hi" < 12 байт nonce
        // Битый ключ
        assert!(decrypt_pool_slice("zz", &sealed).is_err());
        assert!(decrypt_pool_slice(&hex::encode([1u8; 16]), &sealed).is_err());
    }

    #[test]
    fn import_pool_slice_inserts_links_and_dedups() {
        let (_dir, db) = test_db();
        let key_hex = hex::encode([3u8; 32]);
        let sealed = encrypt_pool_slice(&key_hex, &sample_payload().to_string()).unwrap();

        let (card_id, inserted) = import_pool_slice(&db, 101, "srv-hash-1", &sealed, &key_hex).unwrap();
        assert_eq!(inserted, 1);
        assert!(card_id > 0);

        // связка пул ↔ карта
        let (linked_slice, linked_hash, source): (i64, String, String) = db.conn
            .query_row(
                "SELECT l.pool_slice_id, l.card_hash, c.source FROM card_pool_links l JOIN credit_cards c ON c.id = l.card_id WHERE l.card_id = ?1",
                rusqlite::params![card_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(linked_slice, 101);
        assert_eq!(linked_hash, "srv-hash-1");
        assert_eq!(source, "manager");

        // Повторный импорт того же PAN — дедуп, новой связки нет.
        let (dup_id, dup_inserted) = import_pool_slice(&db, 102, "srv-hash-1", &sealed, &key_hex).unwrap();
        assert_eq!(dup_inserted, 0);
        assert_eq!(dup_id, 0);
        let links: i64 = db.conn
            .query_row("SELECT COUNT(*) FROM card_pool_links", [], |r| r.get(0))
            .unwrap();
        assert_eq!(links, 1);
    }

    #[test]
    fn import_pool_slice_rejects_wrong_key_and_bad_payload() {
        let (_dir, db) = test_db();
        let key_hex = hex::encode([3u8; 32]);
        let sealed = encrypt_pool_slice(&key_hex, &sample_payload().to_string()).unwrap();
        let wrong = hex::encode([4u8; 32]);
        assert!(import_pool_slice(&db, 1, "h", &sealed, &wrong).is_err());

        let no_pan = encrypt_pool_slice(&key_hex, "{\"exp\":\"01/29\"}").unwrap();
        assert!(import_pool_slice(&db, 2, "h", &no_pan, &key_hex).is_err());
    }

    #[test]
    fn validators_enforce_bounds() {
        assert!(validate_count(1).is_ok());
        assert!(validate_count(50).is_ok());
        assert!(validate_count(0).is_err());
        assert!(validate_count(51).is_err());
        assert!(validate_count(-3).is_err());

        assert_eq!(validate_outcome("used").unwrap(), "used");
        assert_eq!(validate_outcome(" burned ").unwrap(), "burned");
        assert!(validate_outcome("lost").is_err());
        assert!(validate_outcome("").is_err());
    }

    #[test]
    fn pool_key_config_roundtrip() {
        let (_dir, db) = test_db();
        assert!(stored_pool_key(&db, 5).unwrap().is_none());
        db.set_config("card_pool_key_5", &hex::encode([1u8; 32])).unwrap();
        assert_eq!(stored_pool_key(&db, 5).unwrap().as_deref(), Some(hex::encode([1u8; 32]).as_str()));
        // пустая строка трактуется как «нет ключа»
        db.set_config("card_pool_key_6", "").unwrap();
        assert!(stored_pool_key(&db, 6).unwrap().is_none());
    }
}
