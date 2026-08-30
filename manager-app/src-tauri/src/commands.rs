use crate::alerts;
use crate::crypto::{self, FieldEncryption, PasswordValidation};
use crate::db::{self, Database, Sidecar};
use crate::http;
use crate::insights;
use crate::license;
use crate::state::{with_open, AppState, DbState};
use crate::telemetry;
use crate::vault;
use base64::Engine;
use serde_json::{json, Value};
use tauri::State;

fn read_phase_plain(path: &str) -> Result<Value, String> {
    let database = Database::open_plain(path)?;
    let token = database.get_config("license_token");
    let role = database.get_config("license_role");
    let res = json!({
        "phase": if token.is_some() { "needs_master" } else { "not_activated" },
        "installation_id": database.get_config("installation_id"),
        "challenge": database.get_config("challenge"),
        "server_url": http::server_base(&database),
        "role": role,
    });
    Ok(res)
}

#[tauri::command]
pub fn get_app_state(state: State<'_, AppState>) -> Result<Value, String> {
    let path = db::db_path()?;

    let unlocked = {
        let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        matches!(&*guard, DbState::Open { .. })
    };
    if unlocked {
        return with_open(&state, |database, _| {
            Ok(json!({
                "phase": "unlocked",
                "installation_id": database.get_config("installation_id"),
                "server_url": http::server_base(database),
                "role": database.get_config("license_role"),
                "version": env!("CARGO_PKG_VERSION"),
            }))
        });
    }

    if !std::path::Path::new(&path).exists() {
        let database = Database::open_plain(&path)?;
        if database.get_config("installation_id").is_none() {
            database.set_config("installation_id", &license::generate_installation_id())?;
            database.set_config("challenge", &license::generate_challenge())?;
        }
        let iid = database.get_config("installation_id");
        let challenge = database.get_config("challenge");
        return Ok(json!({
            "phase": "not_activated",
            "installation_id": iid,
            "challenge": challenge,
            "server_url": http::server_base(&database),
            "role": Value::Null,
        }));
    }

    if db::is_encrypted(&path) {
        let base = std::env::var("VAULTBASE_SERVER_URL")
            .ok()
            .map(|s| s.trim().trim_end_matches('/').to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| http::DEFAULT_SERVER_URL.to_string());
        return Ok(json!({
            "phase": "locked",
            "server_url": base,
            "role": Value::Null,
        }));
    }

    read_phase_plain(&path)
}

#[tauri::command]
pub fn set_server_url(state: State<'_, AppState>, url: String) -> Result<(), String> {
    let normalized = http::normalize_url(&url)?;

    let guard_open = {
        let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        matches!(&*guard, DbState::Open { .. })
    };

    if guard_open {
        return with_open(&state, |database, _| database.set_config("server_url", &normalized));
    }

    let path = db::db_path()?;
    if db::is_encrypted(&path) {
        return Err("locked_cannot_change_url".into());
    }
    let database = Database::open_plain(&path)?;
    database.set_config("server_url", &normalized)
}

#[tauri::command]
pub fn activate_license(state: State<'_, AppState>, activation_key: String) -> Result<Value, String> {
    let path = db::db_path()?;
    if db::is_encrypted(&path) {
        return Err("already_locked".into());
    }

    {
        let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        if matches!(&*guard, DbState::Open { .. }) {
            return Err("already_activated".into());
        }
    }

    let database = Database::open_plain(&path)?;
    if database.get_config("license_token").is_some() {
        return Err("already_activated".into());
    }

    let iid = match database.get_config("installation_id") {
        Some(v) => v,
        None => {
            let v = license::generate_installation_id();
            database.set_config("installation_id", &v)?;
            v
        }
    };
    let challenge = match database.get_config("challenge") {
        Some(v) => v,
        None => {
            let v = license::generate_challenge();
            database.set_config("challenge", &v)?;
            v
        }
    };

    let base = http::server_base(&database);
    let result = license::activate(&base, &iid, &challenge, &activation_key)?;

    if result.role != "manager" && result.role != "admin" {
        return Err("wrong_license_role".into());
    }

    database.set_config("license_token", &result.token)?;
    database.set_config("license_role", &result.role)?;
    database.log_event("activate", &format!("role={}", result.role));

    Ok(json!({ "ok": true, "role": result.role }))
}

#[tauri::command]
pub fn setup_master_password(state: State<'_, AppState>, password: String) -> Result<Value, String> {
    let path = db::db_path()?;
    if db::is_encrypted(&path) {
        return Err("already_initialized".into());
    }

    let validation = PasswordValidation::check(&password);
    if let Some(code) = validation.error_code() {
        return Err(code);
    }

    let database = Database::open_plain(&path)?;
    if database.get_config("license_token").is_none() {
        return Err("not_activated".into());
    }
    drop(database);

    let salt = crypto::generate_salt();
    let dek = crypto::generate_random_key();
    let wrapped = crypto::wrap_dek(&dek, &password, &salt)?;

    let sidecar = Sidecar {
        salt_b64: base64::engine::general_purpose::STANDARD.encode(&salt),
        wrapped_dek: Some(wrapped),
    };
    db::write_sidecar(&path, &sidecar)?;

    db::migrate_plain_to_encrypted(&path, &dek)?;

    let database = Database::open_with_key(&path, &dek)?;
    database.log_event("setup_master", "db encrypted");

    let enc = FieldEncryption { key: dek };
    {
        let mut guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        *guard = DbState::Open { db: database, enc };
    }

    let key_warning = with_open(&state, |database, enc| {
        let base = http::server_base(database);
        let token = database
            .get_config("license_token")
            .ok_or("not_activated".to_string())?;
        telemetry::ensure_manager_key(database, enc, &base, &token).map(|_| ())
    })
    .is_err();

    Ok(json!({ "ok": true, "key_upload_warning": key_warning }))
}

#[tauri::command]
pub fn unlock_app(state: State<'_, AppState>, password: String) -> Result<Value, String> {
    let path = db::db_path()?;
    if !std::path::Path::new(&path).exists() {
        return Err("not_initialized".into());
    }

    {
        let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        if matches!(&*guard, DbState::Open { .. }) {
            return Ok(json!({ "ok": true, "role": Value::Null }));
        }
    }

    let sidecar = db::read_sidecar(&path).ok_or("no_sidecar".to_string())?;
    let wrapped = sidecar.wrapped_dek.ok_or("no_sidecar".to_string())?;
    let salt = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        sidecar.salt_b64.as_bytes(),
    )
    .map_err(|e| format!("salt: {e}"))?;

    let dek = crypto::unwrap_dek(&wrapped, &password, &salt).map_err(|_| "wrong_master_password".to_string())?;
    let database = Database::open_with_key(&path, &dek).map_err(|_| "wrong_master_password".to_string())?;

    let role = database.get_config("license_role").unwrap_or_else(|| "manager".into());
    database.log_event("unlock", "");

    {
        let mut guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        *guard = DbState::Open {
            db: database,
            enc: FieldEncryption { key: dek },
        };
    }

    Ok(json!({ "ok": true, "role": role }))
}

#[tauri::command]
pub fn lock_app(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
    *guard = DbState::Closed;
    Ok(())
}

#[tauri::command]
pub fn server_request(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<Value, String> {
    with_open(&state, |database, _| {
        let base = http::server_base(database);
        let token = database
            .get_config("license_token")
            .ok_or("not_activated".to_string())?;

        let resp = http::request(&base, &method, &path, Some(&token), body.as_deref())?;
        let parsed_body = serde_json::from_str::<Value>(&resp.body).unwrap_or(Value::String(resp.body.clone()));
        Ok(json!({ "status": resp.status, "body": parsed_body }))
    })
}

#[tauri::command]
pub fn sync_telemetry(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, enc| telemetry::sync(database, enc))
}

#[tauri::command]
pub fn get_analytics(state: State<'_, AppState>, from: String, to: String) -> Result<Value, String> {
    let date_ok = |s: &str| s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-';
    if !date_ok(&from) || !date_ok(&to) {
        return Err("invalid_date".into());
    }
    with_open(&state, |database, _| telemetry::analytics(database, &from, &to))
}

// MGR-022: сравнение воркеров между собой (объёмы, воронка, SLA, дрейф версий)
#[tauri::command]
pub fn get_fleet_comparison(state: State<'_, AppState>, from: String, to: String) -> Result<Value, String> {
    let date_ok = |s: &str| s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-';
    if !date_ok(&from) || !date_ok(&to) {
        return Err("invalid_date".into());
    }
    with_open(&state, |database, _| telemetry::fleet_comparison(database, &from, &to))
}

// MGR-022: флотовая теплокарта BIN×шоп
#[tauri::command]
pub fn get_fleet_bin_shop(state: State<'_, AppState>, from: String, to: String) -> Result<Value, String> {
    let date_ok = |s: &str| s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-';
    if !date_ok(&from) || !date_ok(&to) {
        return Err("invalid_date".into());
    }
    with_open(&state, |database, _| telemetry::fleet_bin_shop(database, &from, &to))
}

// MGR-020: умный слой — dual-baseline аномалии, прогноз пула, действия дня
#[tauri::command]
pub fn get_insights(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| insights::insights(database))
}

#[tauri::command]
pub fn get_worker_snapshots(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| telemetry::worker_snapshots(database))
}

#[tauri::command]
pub fn get_worker_stats(
    state: State<'_, AppState>,
    installation_id: String,
    days: Option<i64>,
) -> Result<Value, String> {
    if installation_id.is_empty() || installation_id.len() > 128 {
        return Err("invalid_installation_id".into());
    }
    with_open(&state, |database, _| {
        telemetry::worker_stats(database, &installation_id, days.unwrap_or(30))
    })
}

#[tauri::command]
pub fn evaluate_alerts(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| alerts::evaluate(database))
}

#[tauri::command]
pub fn get_local_alerts(state: State<'_, AppState>, status: Option<String>) -> Result<Value, String> {
    with_open(&state, |database, _| alerts::list(database, status.as_deref().unwrap_or("all")))
}

#[tauri::command]
pub fn local_alert_action(state: State<'_, AppState>, id: i64, action: String) -> Result<(), String> {
    with_open(&state, |database, _| alerts::act(database, id, &action))
}

const WRITABLE_CONFIG_KEYS: &[&str] = &[
    "alert_decline_pct",
    "alert_dead_pct",
    "alert_min_orders",
    "alert_min_cards",
    "alert_webhook_url",
    "alert_notify_os",
    "idle_lock_min",
];

#[tauri::command]
pub fn get_config_values(state: State<'_, AppState>, keys: Vec<String>) -> Result<Value, String> {
    with_open(&state, |database, _| {
        let mut out = serde_json::Map::new();
        for key in keys {
            if WRITABLE_CONFIG_KEYS.contains(&key.as_str()) {
                if let Some(v) = database.get_config(&key) {
                    out.insert(key, Value::String(v));
                }
            }
        }
        Ok(Value::Object(out))
    })
}

#[tauri::command]
pub fn set_config_value(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    if !WRITABLE_CONFIG_KEYS.contains(&key.as_str()) {
        return Err("config_key_not_allowed".into());
    }
    match key.as_str() {
        "alert_decline_pct" | "alert_dead_pct" | "alert_min_orders" | "alert_min_cards" | "idle_lock_min" => {
            let n: i64 = value.trim().parse().map_err(|_| "config_value_not_int".to_string())?;
            if !(0..=10000).contains(&n) {
                return Err("config_value_out_of_range".into());
            }
        }
        "alert_webhook_url" => {
            let t = value.trim();
            if !t.is_empty() && !(t.starts_with("https://") || t.starts_with("http://")) {
                return Err("url_must_be_http_s".into());
            }
        }
        "alert_notify_os" => {
            if value.trim() != "0" && value.trim() != "1" {
                return Err("config_value_invalid".into());
            }
        }
        _ => {}
    }
    with_open(&state, |database, _| database.set_config(&key, value.trim()))
}

#[tauri::command]
pub fn wipe_local_data(state: State<'_, AppState>, confirm: bool) -> Result<Value, String> {
    if !confirm {
        return Err("confirm_required".into());
    }

    {
        let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
        if matches!(&*guard, DbState::Open { .. }) {
            return Err("lock_first".into());
        }
    }

    let path = db::db_path()?;
    for suffix in ["", "-wal", "-shm", ".sidecar.json", ".encrypted"] {
        let _ = std::fs::remove_file(format!("{path}{suffix}"));
    }
    Ok(json!({ "ok": true }))
}

// ── MGR-009: self-update manager-app ────────────────────────────────────────
// Эндпоинт строится в рантайме: в query добавляются channel (stable|beta) и
// installation_id — по ним сервер (/update?app=manager) решает видимость
// канала и бакет staged rollout. Подпись проверяется ОТДЕЛЬНЫМ ключом
// manager-app (plugins.updater.pubkey в tauri.conf.json), не ключом воркера.

fn manager_update_url(base: &str, channel: &str, iid: &str) -> Result<tauri::Url, String> {
    let raw = format!(
        "{}/update?app=manager&current_version={{{{current_version}}}}&channel={}&iid={}",
        base.trim_end_matches('/'),
        channel,
        iid
    );
    tauri::Url::parse(&raw).map_err(|e| format!("bad_update_endpoint: {e}"))
}

fn manager_update_params(state: &State<'_, AppState>) -> Result<(String, String, String), String> {
    with_open(state, |database, _| {
        Ok((
            http::server_base(database),
            database
                .get_config("update_channel")
                .unwrap_or_else(|| "stable".to_string()),
            database.get_config("installation_id").unwrap_or_default(),
        ))
    })
}

#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let (base, channel, iid) = manager_update_params(&state)?;
    let url = manager_update_url(&base, &channel, &iid)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(json!({
            "available": true,
            "version": update.version,
            "current_version": update.current_version,
            "notes": update.body,
            "date": update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(json!({
            "available": false,
            "current_version": env!("CARGO_PKG_VERSION"),
        })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let (base, channel, iid) = manager_update_params(&state)?;
    let url = manager_update_url(&base, &channel, &iid)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    update
        .download_and_install(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

// ── MGR-017: vault карт (импорт, пулы, раздача срезов, экспорт) ──────────────

#[tauri::command]
pub fn vault_import(state: State<'_, AppState>, text: String) -> Result<Value, String> {
    with_open(&state, |database, enc| vault::import(database, enc, &text))
}

#[tauri::command]
pub fn vault_list(
    state: State<'_, AppState>,
    status: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    with_open(&state, |database, enc| {
        vault::list(database, enc, status.as_deref(), &query.unwrap_or_default(), limit.unwrap_or(300))
    })
}

#[tauri::command]
pub fn vault_stats(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| vault::stats(database))
}

#[tauri::command]
pub fn vault_issue(
    state: State<'_, AppState>,
    target_iid: String,
    card_ids: Vec<i64>,
) -> Result<Value, String> {
    with_open(&state, |database, enc| vault::issue(database, enc, &target_iid, &card_ids))
}

#[tauri::command]
pub fn vault_sync_issue_status(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| vault::sync_issue_status(database))
}

#[tauri::command]
pub fn vault_recall(state: State<'_, AppState>, card_ids: Vec<i64>, to_status: String) -> Result<Value, String> {
    with_open(&state, |database, _| vault::recall(database, &card_ids, &to_status))
}

#[tauri::command]
pub fn vault_burn(state: State<'_, AppState>, card_ids: Vec<i64>, reason: Option<String>) -> Result<Value, String> {
    with_open(&state, |database, _| vault::burn(database, &card_ids, &reason.unwrap_or_default()))
}

#[tauri::command]
pub fn vault_export(
    state: State<'_, AppState>,
    card_ids: Vec<i64>,
    path: String,
    password: String,
    purge: Option<bool>,
) -> Result<Value, String> {
    with_open(&state, |database, enc| {
        vault::export(database, enc, &card_ids, &path, &password, purge.unwrap_or(true))
    })
}

#[tauri::command]
pub fn vault_export_log(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |database, _| vault::export_log(database))
}
