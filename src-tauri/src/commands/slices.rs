//! MGR-018: воркер — приёмник запечатанных срезов карт.
//!
//! Карты создаёт только менеджер: он запечатывает срез X25519-пубключом
//! воркера и кладёт на сервер (routes/worker-cards.js), сервер хранит только
//! шифротекст. Воркер регистрирует свой публичный ключ, забирает конверты,
//! распечатывает их тем же sealed-box контрактом, что и телеметрию
//! (commands/telemetry.rs — HKDF_INFO и формат конверта совпадают), вставляет
//! карты с `source='manager'` и подтверждает импорт ack'ом.

use crate::database::Database;
use crate::models::{perms, CardInput, ProxyInput};
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

    // MGR-018 (этап C): приём карточного среза тоже включает managed-
    // режим пула прокси/email (менеджер — единственный источник пулов).
    if received > 0 && failed < received {
        mark_managed_pool(db);
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

// ─────────────────────────────────────────
//  MGR-018 (этап C): централизованные срезы прокси/email
// ─────────────────────────────────────────
//
// Тот же конверт, что у карт: менеджер запечатывает JSON X25519-пубключом
// воркера, сервер-курьер хранит шифротекст (cc-sync-server routes/worker-assets.js):
//   GET  /sync/assets/issued?kind=proxy|email  → [{id, asset_hash, sealed_data}]
//   POST /sync/assets/issued/ack               → {ids}
// Форматы полезной нагрузки (контракт с менеджером):
//   proxy: { "host": "1.2.3.4", "port": 8080, "proxy_type": "http",
//            "username": "u", "password": "p", "label": "l", "notes": "n" }
//   email: { "email": "a@b.c", "label": "l" }
// PPTP/uPanel-секрет сюда не ходит — он остаётся локальным и не синкается.

fn proxy_from_payload(payload: &Value) -> Result<ProxyInput, String> {
    let host = payload["host"].as_str().unwrap_or("").trim().to_string();
    if host.is_empty() { return Err("no_host".into()); }
    let port = payload["port"].as_i64()
        .or_else(|| payload["port"].as_str().and_then(|s| s.trim().parse::<i64>().ok()))
        .ok_or("no_port")?;
    if port <= 0 || port > 65535 { return Err("bad_port".into()); }
    let proxy_type = payload["proxy_type"].as_str().unwrap_or("http").trim().to_string();
    let proxy_type = if proxy_type.is_empty() { "http".to_string() } else { proxy_type };
    let s = |k: &str| payload[k].as_str().unwrap_or("").trim().to_string();
    Ok(ProxyInput {
        host,
        port,
        proxy_type,
        username: s("username"),
        password: s("password"),
        label: s("label"),
        notes: s("notes"),
    })
}

fn email_from_payload(payload: &Value) -> Result<(String, Option<String>), String> {
    let email = payload["email"].as_str().unwrap_or("").trim().to_string();
    if email.is_empty() { return Err("no_email".into()); }
    let label = payload["label"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Ok((email, label))
}

/// Признак managed-развёртывания: воркер реально получил хотя бы один срез
/// от менеджера. Именно получение, а не регистрация ключа — solo-пользователь,
/// случайно нажавший «Загрузить срезы», не должен потерять ручное управление.
/// Выставляется при первом принятом срезе; по нему закрываются: локальные
/// мутации пула прокси/email (этап C) и внешние вызовы BIN API (этап D).
const MANAGED_MODE_FLAG: &str = "managed_mode";

fn mark_managed_pool(db: &Database) {
    let _ = db.set_config(MANAGED_MODE_FLAG, "1");
}

/// MGR-018: воркер под управлением менеджера (получал срезы)?
pub(crate) fn is_managed(db: &Database) -> bool {
    db.get_config(MANAGED_MODE_FLAG).map(|v| v.as_deref() == Some("1")).unwrap_or(false)
}

/// MGR-018 (этап C): в managed-режиме пул прокси/email централизован —
/// локальные add/update/delete/import запрещены (read-only). Чтение, блокировки
/// и PPTP/uPanel (локальный секрет) не затрагиваются.
pub(crate) fn enforce_pool_editable(db: &Database) -> Result<(), String> {
    if is_managed(db) { return Err("managed_pool_readonly".into()); }
    Ok(())
}

fn fetch_assets_and_store(kind: &'static str) -> Result<Value, String> {
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        register_key_if_needed(db, &token)?;

        let resp = ureq::get(&crate::endpoints::endpoint(&format!("/sync/assets/issued?kind={kind}")))
            .set("Authorization", &format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| format!("fetch_issued_failed: {e}"))?;
        let body: Value = resp.into_json().map_err(|e| format!("fetch_body: {e}"))?;
        let slices = body.get("slices").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let received = slices.len();

        let mut ack_ids: Vec<i64> = Vec::new();
        let mut imported = 0usize;
        let mut duplicates = 0usize;
        let mut failed = 0usize;

        for s in &slices {
            let id = s["id"].as_i64().unwrap_or(0);
            let sealed = s["sealed_data"].as_str().unwrap_or("");
            if id <= 0 || sealed.is_empty() { continue; }
            // true — вставлено, false — дубль; ошибка → failed, но ack'аем,
            // чтобы не зациклиться (перевыпуск — на стороне менеджера),
            // как и у карточных срезов.
            let processed = (|| -> Result<bool, String> {
                let env: crate::commands::telemetry::TelemetryEnvelope = serde_json::from_str(sealed)
                    .map_err(|e| format!("sealed_parse: {e}"))?;
                let priv_hex = ensure_slice_key(db)?;
                let payload_str = crate::commands::telemetry::unseal_envelope(&priv_hex, &env)?;
                let payload: Value = serde_json::from_str(&payload_str)
                    .map_err(|e| format!("payload_parse: {e}"))?;
                let inserted = match kind {
                    "proxy" => db.insert_manager_proxy(id, &proxy_from_payload(&payload)?)?,
                    _ => {
                        let (email, label) = email_from_payload(&payload)?;
                        db.insert_manager_email(id, &email, label)?
                    }
                };
                Ok(inserted.is_some())
            })();
            match processed {
                Ok(true) => { imported += 1; ack_ids.push(id); }
                Ok(false) => { duplicates += 1; ack_ids.push(id); }
                Err(e) => {
                    failed += 1;
                    ack_ids.push(id);
                    let _ = db.log_event(
                        &format!("slices.{kind}_failed"),
                        &format!("slice #{id}: {e}"),
                        Some(kind), None,
                    );
                }
            }
        }

        if !ack_ids.is_empty() {
            let body = json!({ "ids": ack_ids });
            let _ = ureq::post(&crate::endpoints::endpoint("/sync/assets/issued/ack"))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                .send_string(&body.to_string());
        }

        if received > 0 && failed < received {
            mark_managed_pool(db);
        }

        let _ = db.log_event(
            &format!("slices.{kind}_fetched"),
            &format!("received={received} imported={imported} duplicates={duplicates} failed={failed}"),
            Some(kind), None,
        );
        Ok(json!({
            "kind": kind,
            "received": received,
            "imported": imported,
            "duplicates": duplicates,
            "failed": failed,
        }))
    })
}

#[tauri::command]
pub(crate) fn proxy_slices_fetch() -> Result<Value, String> {
    fetch_assets_and_store("proxy")
}

#[tauri::command]
pub(crate) fn email_slices_fetch() -> Result<Value, String> {
    fetch_assets_and_store("email")
}

// ─────────────────────────────────────────
//  MGR-018 (этап D): share-ключи конфигурации (stuffer)
// ─────────────────────────────────────────
//
// Отдельный от срезов канал: менеджер запечатывает {"base_url","api_key"}
// и кладёт конверт на сервер (worker_config_shares, routes/worker-assets.js).
// Воркер хранит ключ read-only: stuffer_set_config отказывает, пока активен
// share-ключ, а значения во frontend не утекают — STUFFER_SHARED_* не входят
// ни в CONFIG_READABLE, ни в CONFIG_SECRET (их пишет только этот код).
// 17track менеджер не трогает: tracking_api_key остаётся локальным fallback.

const STUFFER_SHARED_KEY: &str = "stuffer_shared_api_key";
const STUFFER_SHARED_BASE: &str = "stuffer_shared_base_url";

/// Конфигурация stuffer из запечатанного payload менеджера:
/// { "base_url": "https://...", "api_key": "..." }. base_url опционален.
fn stuffer_config_from_payload(payload: &Value) -> Result<(String, String), String> {
    let api_key = payload["api_key"].as_str().unwrap_or("").trim().to_string();
    if api_key.is_empty() { return Err("no_api_key".into()); }
    let base_url = payload["base_url"].as_str().unwrap_or("").trim().to_string();
    let base_url = if base_url.is_empty() {
        crate::stuffer::DEFAULT_BASE_URL.to_string()
    } else {
        base_url
    };
    Ok((base_url, api_key))
}

fn fetch_config_shares_and_store() -> Result<Value, String> {
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        register_key_if_needed(db, &token)?;

        let resp = ureq::get(&crate::endpoints::endpoint("/sync/config/shares?kind=stuffer"))
            .set("Authorization", &format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| format!("fetch_shares_failed: {e}"))?;
        let body: Value = resp.into_json().map_err(|e| format!("fetch_body: {e}"))?;
        let shares = body.get("shares").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let received = shares.len();

        let mut ack_ids: Vec<i64> = Vec::new();
        let mut applied = 0usize;
        let mut failed = 0usize;

        for s in &shares {
            let id = s["id"].as_i64().unwrap_or(0);
            let sealed = s["sealed_data"].as_str().unwrap_or("");
            if id <= 0 || sealed.is_empty() { continue; }
            let processed = (|| -> Result<(), String> {
                let env: crate::commands::telemetry::TelemetryEnvelope = serde_json::from_str(sealed)
                    .map_err(|e| format!("sealed_parse: {e}"))?;
                let priv_hex = ensure_slice_key(db)?;
                let payload_str = crate::commands::telemetry::unseal_envelope(&priv_hex, &env)?;
                let payload: Value = serde_json::from_str(&payload_str)
                    .map_err(|e| format!("payload_parse: {e}"))?;
                let (base_url, api_key) = stuffer_config_from_payload(&payload)?;
                db.set_config(STUFFER_SHARED_BASE, &base_url).map_err(|e| e.to_string())?;
                db.set_config(STUFFER_SHARED_KEY, &api_key).map_err(|e| e.to_string())?;
                // В лог — только base_url; сам ключ не светим нигде.
                let _ = db.log_event(
                    "stuffer.shared_key_received",
                    &format!("Stuffer key received from manager (base_url={base_url})"),
                    Some("stuffer"), None,
                );
                Ok(())
            })();
            match processed {
                Ok(()) => { applied += 1; ack_ids.push(id); }
                Err(e) => {
                    failed += 1;
                    ack_ids.push(id);
                    let _ = db.log_event(
                        "stuffer.shared_key_failed",
                        &format!("share #{id}: {e}"),
                        Some("stuffer"), None,
                    );
                }
            }
        }

        if !ack_ids.is_empty() {
            let body = json!({ "ids": ack_ids });
            let _ = ureq::post(&crate::endpoints::endpoint("/sync/config/shares/ack"))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                .send_string(&body.to_string());
        }

        Ok(json!({ "received": received, "applied": applied, "failed": failed }))
    })
}

#[tauri::command]
pub(crate) fn config_shares_fetch() -> Result<Value, String> {
    fetch_config_shares_and_store()
}

/// WS-хук: {"type":"config_shared"} — менеджер выдал share-ключ конфигурации.
pub(crate) fn fetch_config_shares_on_ws_notify() {
    spawn_task(|| {
        if let Err(e) = fetch_config_shares_and_store() {
            eprintln!("[slices] background config-shares fetch failed: {e}");
        }
    });
}

/// WS-хук: сервер уведомил о новых срезах прокси/email (assets_issued) —
/// забираем в фоне. Неизвестный kind игнорируем (forward-compat).
pub(crate) fn fetch_assets_on_ws_notify(kind: &str) {
    let kind_static: &'static str = match kind {
        "proxy" => "proxy",
        "email" => "email",
        _ => { eprintln!("[slices] unknown assets_issued kind: {kind}"); return; }
    };
    spawn_task(move || {
        if let Err(e) = fetch_assets_and_store(kind_static) {
            eprintln!("[slices] background {kind_static} fetch failed: {e}");
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

    // ── MGR-018 (этап C): срезы прокси/email ──

    #[test]
    fn proxy_from_payload_maps_fields() {
        let p = proxy_from_payload(&json!({
            "host": "1.2.3.4", "port": 8080, "proxy_type": "socks5",
            "username": "u", "password": "p", "label": "l1", "notes": "n1",
        })).unwrap();
        assert_eq!(p.host, "1.2.3.4");
        assert_eq!(p.port, 8080);
        assert_eq!(p.proxy_type, "socks5");
        assert_eq!(p.username, "u");
        assert_eq!(p.password, "p");
        assert_eq!(p.label, "l1");
        // порт строкой тоже принимаем; proxy_type по умолчанию http
        let p2 = proxy_from_payload(&json!({ "host": "5.6.7.8", "port": "1080" })).unwrap();
        assert_eq!(p2.port, 1080);
        assert_eq!(p2.proxy_type, "http");
        assert_eq!(p2.username, "");
    }

    #[test]
    fn proxy_from_payload_rejects_garbage() {
        assert!(proxy_from_payload(&json!({ "port": 8080 })).is_err());           // нет host
        assert!(proxy_from_payload(&json!({ "host": "1.2.3.4" })).is_err());       // нет port
        assert!(proxy_from_payload(&json!({ "host": "1.2.3.4", "port": 0 })).is_err());
        assert!(proxy_from_payload(&json!({ "host": "1.2.3.4", "port": 70000 })).is_err());
    }

    #[test]
    fn email_from_payload_maps_and_rejects() {
        let (email, label) = email_from_payload(&json!({ "email": "a@b.c", "label": "work" })).unwrap();
        assert_eq!(email, "a@b.c");
        assert_eq!(label.as_deref(), Some("work"));
        let (email2, label2) = email_from_payload(&json!({ "email": " x@y.z " })).unwrap();
        assert_eq!(email2, "x@y.z");
        assert_eq!(label2, None);
        assert!(email_from_payload(&json!({})).is_err());
        assert!(email_from_payload(&json!({ "email": "  " })).is_err());
    }

    #[test]
    fn insert_manager_email_dedups_by_slice_id_and_hash() {
        let (_dir, db) = test_db();
        let id1 = db.insert_manager_email(101, "slice@x.com", Some("l".into())).unwrap();
        assert!(id1.is_some());
        // тот же pool_slice_id — повторная доставка, дедуп
        assert_eq!(db.insert_manager_email(101, "slice@x.com", None).unwrap(), None);
        // другой срез, но тот же email — дедуп по email_hash
        assert_eq!(db.insert_manager_email(102, "slice@x.com", None).unwrap(), None);
        // новый email новым срезом — вставляется
        assert!(db.insert_manager_email(103, "other@x.com", None).unwrap().is_some());
        let (cnt, src): (i64, String) = db.conn
            .query_row("SELECT COUNT(*), MAX(source) FROM email_pool", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(cnt, 2);
        assert_eq!(src, "manager");
    }

    #[test]
    fn insert_manager_proxy_dedups_by_slice_id_and_content() {
        let (_dir, db) = test_db();
        let input = proxy_from_payload(&json!({
            "host": "9.9.9.9", "port": 3128, "proxy_type": "http", "username": "u1",
        })).unwrap();
        assert!(db.insert_manager_proxy(201, &input).unwrap().is_some());
        // тот же срез повторно
        assert_eq!(db.insert_manager_proxy(201, &input).unwrap(), None);
        // другой срез с тем же host+port+username — дедуп по содержимому
        assert_eq!(db.insert_manager_proxy(202, &input).unwrap(), None);
        // другой порт — уже другой прокси
        let input2 = proxy_from_payload(&json!({ "host": "9.9.9.9", "port": 3129 })).unwrap();
        assert!(db.insert_manager_proxy(203, &input2).unwrap().is_some());
        let (cnt, src): (i64, String) = db.conn
            .query_row("SELECT COUNT(*), MAX(source) FROM proxies", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(cnt, 2);
        assert_eq!(src, "manager");
        // мусорный срез (нет host) молча пропускается
        let bad = ProxyInput {
            host: String::new(), port: 0, proxy_type: "http".into(),
            username: String::new(), password: String::new(),
            label: String::new(), notes: String::new(),
        };
        assert_eq!(db.insert_manager_proxy(204, &bad).unwrap(), None);
    }

    #[test]
    fn enforce_pool_editable_gates_only_managed_mode() {
        let (_dir, db) = test_db();
        assert!(enforce_pool_editable(&db).is_ok(), "solo-режим не ограничивается");
        db.set_config(MANAGED_MODE_FLAG, "1").unwrap();
        assert_eq!(enforce_pool_editable(&db).unwrap_err(), "managed_pool_readonly");
    }

    // ── MGR-018 (этап D): share-ключи stuffer ──

    #[test]
    fn stuffer_config_from_payload_maps_and_defaults() {
        let (base, key) = stuffer_config_from_payload(&json!({
            "base_url": "https://panel.example", "api_key": "k1",
        })).unwrap();
        assert_eq!(base, "https://panel.example");
        assert_eq!(key, "k1");
        // без base_url — дефолт панели
        let (base2, _) = stuffer_config_from_payload(&json!({ "api_key": "k2" })).unwrap();
        assert_eq!(base2, crate::stuffer::DEFAULT_BASE_URL);
        // без ключа — отказ
        assert!(stuffer_config_from_payload(&json!({ "base_url": "https://x" })).is_err());
        assert!(stuffer_config_from_payload(&json!({ "api_key": "  " })).is_err());
    }

    #[test]
    fn sealed_stuffer_share_roundtrip_applies_to_config() {
        // Контракт как у карточного roundtrip: менеджер запечатывает конфиг,
        // воркер открывает своим ключом и складывает в shared-конфиг.
        let (_dir, db) = test_db();
        let priv_hex = ensure_slice_key(&db).unwrap();
        let payload = json!({ "v": 1, "base_url": "https://panel.example", "api_key": "mgr-issued-key" });
        let envelope = crate::commands::telemetry::seal_envelope(
            7,
            &pubkey_hex(&priv_hex),
            &payload.to_string(),
        ).unwrap();
        let sealed_data = serde_json::to_string(&envelope).unwrap();

        // то же, что делает fetch_config_shares_and_store с каждым конвертом
        let env: crate::commands::telemetry::TelemetryEnvelope =
            serde_json::from_str(&sealed_data).unwrap();
        let payload_str = crate::commands::telemetry::unseal_envelope(
            &ensure_slice_key(&db).unwrap(),
            &env,
        ).unwrap();
        let (base, key) = stuffer_config_from_payload(&serde_json::from_str(&payload_str).unwrap()).unwrap();
        db.set_config(STUFFER_SHARED_BASE, &base).unwrap();
        db.set_config(STUFFER_SHARED_KEY, &key).unwrap();

        assert_eq!(db.get_config(STUFFER_SHARED_BASE).unwrap().as_deref(), Some("https://panel.example"));
        assert_eq!(db.get_config(STUFFER_SHARED_KEY).unwrap().as_deref(), Some("mgr-issued-key"));
    }
}
