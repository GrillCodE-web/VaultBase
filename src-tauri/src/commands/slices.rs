//! MGR-018: воркер — приёмник запечатанных срезов карт.
//!
//! Карты создаёт только менеджер: он запечатывает срез X25519-пубключом
//! воркера и кладёт на сервер (routes/worker-cards.js), сервер хранит только
//! шифротекст. Воркер регистрирует свой публичный ключ, забирает конверты,
//! распечатывает их тем же sealed-box контрактом, что и телеметрию
//! (commands/telemetry.rs — HKDF_INFO и формат конверта совпадают), вставляет
//! карты с `source='manager'` и подтверждает импорт ack'ом.

use crate::database::Database;
use crate::models::{perms, CardInput};
use crate::state::{require_perm, spawn_task, with_db};
use serde_json::{json, Value};
use tauri::Emitter;

/// Ключи приёма срезов в config-KV. Приватник НЕ отдаётся во frontend
/// (config-команды с whitelist'ом про него не знают) — он нужен только
/// Rust-коду.
const SLICE_KEY_PRIV: &str = "worker_slice_key_priv";
const SLICE_KEY_REGISTERED: &str = "worker_slice_key_registered";
const HTTP_TIMEOUT_SECS: u64 = 30;

/// Приватный X25519-ключ приёма срезов (hex). Создаётся один раз и живёт
/// в config-KV до явной ротации через worker_key_register.
pub(crate) fn ensure_slice_key(db: &Database) -> Result<String, String> {
    if let Some(h) = db.get_config(SLICE_KEY_PRIV).map_err(|e| e.to_string())? {
        if !h.is_empty() {
            return Ok(h);
        }
    }
    let secret = x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng);
    let priv_hex = hex::encode(secret.to_bytes());
    db.set_config(SLICE_KEY_PRIV, &priv_hex).map_err(|e| e.to_string())?;
    let _ = db.log_event(
        "slices.key_created",
        &format!("pub={}", pubkey_hex(&priv_hex)),
        Some("card"),
        None,
    );
    Ok(priv_hex)
}

/// Пубключ (hex) из приватника.
pub(crate) fn pubkey_hex(priv_hex: &str) -> String {
    let bytes = match hex::decode(priv_hex.trim()) {
        Ok(b) if b.len() == 32 => <[u8; 32]>::try_from(b.as_slice()).unwrap(),
        _ => return String::new(),
    };
    let secret = x25519_dalek::StaticSecret::from(bytes);
    hex::encode(x25519_dalek::PublicKey::from(&secret).as_bytes())
}

fn auth_token(db: &Database) -> Result<String, String> {
    db.get_config("license_token")
        .map_err(|e| e.to_string())?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "license_not_activated".to_string())
}

/// Зарегистрировать (или ротировать) X25519-пубключ приёма срезов на сервере.
/// Флаг в config не даёт регистрироваться на каждый fetch (на сервере всё
/// равно rate-limit 20/час на установку).
fn register_key_if_needed(db: &Database, token: &str) -> Result<(), String> {
    if db.get_config(SLICE_KEY_REGISTERED).map_err(|e| e.to_string())?.as_deref() == Some("1") {
        return Ok(());
    }
    let priv_hex = ensure_slice_key(db)?;
    let body = json!({ "pubkey": pubkey_hex(&priv_hex), "label": "worker-slices" });
    let resp = ureq::post(&crate::endpoints::endpoint("/sync/worker-key/register"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&body.to_string())
        .map_err(|e| format!("register_failed: {e}"))?;
    let key_id = resp
        .into_json::<Value>()
        .map_err(|e| format!("register_parse: {e}"))?
        .get("key_id")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    db.set_config(SLICE_KEY_REGISTERED, "1").map_err(|e| e.to_string())?;
    let _ = db.log_event(
        "slices.key_registered",
        &format!("key_id={key_id}"),
        Some("card"),
        None,
    );
    Ok(())
}

/// Payload среза менеджера → CardInput воркера. Карта хранится с
/// `source='manager'`; card_hash считает insert_cards сам (sha256(pan)),
/// менеджерский salted-хэш в локальную схему не переносится.
pub(crate) fn slice_to_card(payload: &Value) -> Result<CardInput, String> {
    let pan = payload["pan"].as_str().unwrap_or("").trim().to_string();
    if pan.is_empty() {
        return Err("slice_missing_pan".into());
    }
    Ok(CardInput {
        card_number: pan,
        expiry_date: non_empty(&payload["exp"]),
        cvv: non_empty(&payload["cvv"]),
        holder_name: non_empty(&payload["extra"]["holder"]),
        billing_address: non_empty(&payload["extra"]["addr"]),
        zip: non_empty(&payload["extra"]["zip"]),
        source: "manager".into(),
        acquired_at: non_empty(&payload["issued_at"]),
        ..Default::default()
    })
}

fn non_empty(v: &Value) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Распечатать один конверт и вставить карту (source='manager'). Возвращает
/// число вставленных карт: 1 — новая, 0 — дедуп по card_hash (повторная
/// раздача той же карты).
pub(crate) fn insert_slice_payload(db: &Database, payload: &Value) -> Result<usize, String> {
    let card = slice_to_card(payload)?;
    db.insert_cards(vec![card])
}

#[tauri::command]
pub(crate) fn worker_key_register() -> Result<Value, String> {
    require_perm(perms::VIEW_CARDS_POOL)?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let priv_hex = ensure_slice_key(db)?;
        let token = auth_token(db)?;
        let key_id = register_key(&priv_hex, &token)?;
        db.set_config(SLICE_KEY_REGISTERED, "1").map_err(|e| e.to_string())?;
        let _ = db.log_event(
            "slices.key_registered",
            &format!("key_id={key_id}"),
            Some("card"),
            None,
        );
        Ok(json!({ "ok": true, "key_id": key_id }))
    })
}

/// POST /sync/worker-key/register — регистрация/ротация пубключа.
fn register_key(priv_hex: &str, token: &str) -> Result<i64, String> {
    let body = json!({ "pubkey": pubkey_hex(priv_hex), "label": "worker-slices" });
    let resp = ureq::post(&crate::endpoints::endpoint("/sync/worker-key/register"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&body.to_string())
        .map_err(|e| format!("register_failed: {e}"))?;
    let parsed: Value = resp.into_json().map_err(|e| format!("register_parse: {e}"))?;
    Ok(parsed.get("key_id").and_then(|v| v.as_i64()).unwrap_or(0))
}

/// Забрать запечатанные срезы с сервера, распечатать, вставить (source='manager')
/// и подтвердить ack'ом. Общая точка входа для ручного fetch и WS-события.
fn fetch_and_store(app: Option<&tauri::AppHandle>) -> Result<Value, String> {
    let result = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        fetch_locked(db)
    })?;
    if let Some(app) = app {
        let _ = app.emit("slices_received", result.clone());
    }
    Ok(result)
}

fn fetch_locked(db: &mut Database) -> Result<Value, String> {
    let token = auth_token(db)?;
    register_key_if_needed(db, &token)?;

    let resp = ureq::get(&crate::endpoints::endpoint("/sync/cards/issued"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("fetch_issued_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("fetch_body: {e}"))?;
    let slices = body
        .get("slices")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let received = slices.len();

    let mut ack_ids: Vec<i64> = Vec::new();
    let mut imported = 0usize;
    let mut duplicates = 0usize;
    let mut failed = 0usize;
    let mut first_error = String::new();

    for s in &slices {
        let id = s["id"].as_i64().unwrap_or(0);
        let sealed = s["sealed_data"].as_str().unwrap_or("");
        if id <= 0 || sealed.is_empty() {
            continue;
        }
        // Битый конверт чинить нечем — ack'аем, чтобы не зациклиться на нём,
        // но оставляем след в activity log (перевыпуск — на стороне менеджера).
        let imported_n = match import_sealed_slice(db, sealed) {
            Ok(n) => {
                if n > 0 { imported += n; } else { duplicates += 1; }
                ack_ids.push(id);
                continue;
            }
            Err(e) => e,
        };
        let _ = db.log_event(
            "slices.slice_failed",
            &format!("slice #{id}: {imported_n}"),
            Some("card"),
            None,
        );
        if first_error.is_empty() {
            first_error = format!("slice #{id}: {imported_n}");
        }
        failed += 1;
        ack_ids.push(id);
    }

    if !ack_ids.is_empty() {
        let body = json!({ "ids": ack_ids });
        let _ = ureq::post(&crate::endpoints::endpoint("/sync/cards/issued/ack"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body.to_string());
    }

    let _ = db.log_event(
        "slices.received",
        &format!("received={received} imported={imported} duplicates={duplicates} failed={failed}"),
        Some("card"),
        None,
    );
    Ok(json!({
        "received": received,
        "imported": imported,
        "duplicates": duplicates,
        "failed": failed,
        "first_error": if first_error.is_empty() { Value::Null } else { json!(first_error) },
    }))
}

/// Распечатать один конверт и вставить карту. Возвращает число вставленных
/// карт (0 = дедуп по card_hash — карта уже была, напр. при перевыпуске).
pub(crate) fn import_sealed_slice(db: &Database, sealed_data: &str) -> Result<usize, String> {
    let env: crate::commands::telemetry::TelemetryEnvelope = serde_json::from_str(sealed_data)
        .map_err(|e| format!("sealed_parse: {e}"))?;
    let priv_hex = ensure_slice_key(db)?;
    let payload_str = crate::commands::telemetry::unseal_envelope(&priv_hex, &env)?;
    let payload: Value = serde_json::from_str(&payload_str)
        .map_err(|e| format!("payload_parse: {e}"))?;
    let card = slice_to_card(&payload)?;
    Ok(db.insert_cards(vec![card])?)
}

#[tauri::command]
pub(crate) fn slices_fetch() -> Result<Value, String> {
    fetch_and_store(None)
}

/// WS-хук: сервер уведомил воркера о новых срезах (cards_issued) — забираем
/// в фоне (вне потока-читателя ws, чтобы не держать цикл).
pub(crate) fn fetch_on_ws_notify() {
    spawn_task(|| {
        if let Err(e) = fetch_and_store(None) {
            eprintln!("[slices] background fetch failed: {e}");
        }
    });
}

#[cfg(test)]
mod slices_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("slices.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new(
            "slices_test_pw_1234567890",
            &salt,
        ));
        (dir, db)
    }

    fn sample_payload() -> Value {
        json!({
            "v": 1,
            "card_hash": "deadbeef",
            "pan": "4111111111111111",
            "exp": "12/28",
            "cvv": "123",
            "bin": "411111",
            "extra": { "holder": "JOHN DOE", "zip": "10001", "addr": "5th Ave 1" },
            "issued_at": "2026-08-30 10:00:00",
            "issued_by": "mgr",
        })
    }

    #[test]
    fn ensure_slice_key_generates_once_and_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let k1 = ensure_slice_key(&db).unwrap();
        let k2 = ensure_slice_key(&db).unwrap();
        assert_eq!(k1, k2);
        assert_eq!(hex::decode(&k2).unwrap().len(), 32);
        // публичный ключ — детерминирован от приватного
        assert_eq!(pubkey_hex(&k1), pubkey_hex(&k2));
        assert!(!pubkey_hex(&k2).is_empty());
        // приватник попал в config-KV
        assert_eq!(db.get_config(SLICE_KEY_PRIV).unwrap().as_deref(), Some(k1.as_str()));
    }

    #[test]
    fn slice_to_card_maps_manager_fields() {
        let card = slice_to_card(&sample_payload()).unwrap();
        assert_eq!(card.card_number, "4111111111111111");
        assert_eq!(card.expiry_date.as_deref(), Some("12/28"));
        assert_eq!(card.cvv.as_deref(), Some("123"));
        assert_eq!(card.holder_name.as_deref(), Some("JOHN DOE"));
        assert_eq!(card.zip.as_deref(), Some("10001"));
        assert_eq!(card.source, "manager");
        assert_eq!(card.acquired_at.as_deref(), Some("2026-08-30 10:00:00"));
    }

    #[test]
    fn slice_to_card_rejects_missing_pan() {
        let mut p = sample_payload();
        p["pan"] = json!("");
        assert!(slice_to_card(&p).is_err());
        assert!(slice_to_card(&json!({})).is_err());
    }

    #[test]
    fn sealed_slice_roundtrip_and_dedup() {
        // Полный контракт: запечатываем payload тем же sealed-box (как менеджер
        // crypto.rs seal_envelope: salt = recipient||ephemeral, vb-mgr-telemetry-v1),
        // потом принимаем как воркер (unseal) и вставляем с source='manager'.
        let (dir, db) = test_db();
        let _ = &dir;
        let priv_hex = ensure_slice_key(&db).unwrap();
        let payload = sample_payload();

        // Запечатываем тем же кодом, каким менеджер запечатывает срез (формат
        // конверта и HKDF_INFO идентичны — см. manager-app/src-tauri/src/crypto.rs).
        let envelope = crate::commands::telemetry::seal_envelope(
            42,
            &pubkey_hex(&priv_hex),
            &payload.to_string(),
        )
        .unwrap();
        let sealed_data = serde_json::to_string(&envelope).unwrap();

        let n1 = import_sealed_slice(&db, &sealed_data).unwrap();
        assert_eq!(n1, 1);
        // повторный конверт той же карты — дедуп по card_hash, но ack'ается
        let n2 = insert_slice_payload(&db, &payload).unwrap();
        assert_eq!(n2, 0);

        let (source, last4, bin): (String, String, String) = db.conn
            .query_row(
                "SELECT source, last4, bin FROM credit_cards",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(source, "manager");
        assert_eq!(last4, "1111");
        assert_eq!(bin, "411111");
    }

    #[test]
    fn import_sealed_slice_rejects_wrong_recipient() {
        let (_dir, db) = test_db();
        // воркер имеет свой ключ, но конверт запечатан под чужой пубключ —
        // unseal обязан упасть (AES-GCM auth)
        let _own_priv = ensure_slice_key(&db).unwrap();
        let wrong_secret = x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng);
        let wrong_pub = hex::encode(x25519_dalek::PublicKey::from(&wrong_secret).as_bytes());
        let envelope = crate::commands::telemetry::seal_envelope(
            1,
            &wrong_pub,
            &sample_payload().to_string(),
        )
        .unwrap();
        let sealed_data = serde_json::to_string(&envelope).unwrap();
        assert!(import_sealed_slice(&db, &sealed_data).is_err());
    }
}
