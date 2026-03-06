// ============================================================
// PATCH: main.rs — Email Pool + Proxy Tauri commands
// ============================================================

use crate::models::{EmailFilter, ProxyInput, ProxyFilter};

// ─── Email Pool commands ──────────────────────────────────────

#[tauri::command]
fn add_email(email: String, label: String, notes: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let entry = db.add_email(&email, &label, &notes)?;
    serde_json::to_value(entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_emails(filter: EmailFilter, page: u32, per_page: u32) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.get_emails(filter, page, per_page)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_clean_email_for_shop(shop_id: i64) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let entry = db.get_clean_email_for_shop(shop_id)?;
    serde_json::to_value(entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_email(id: i64, label: String, notes: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let entry = db.update_email(id, &label, &notes)?;
    serde_json::to_value(entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn block_email(id: i64, blocked: bool) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.block_email(id, blocked)
}

#[tauri::command]
fn delete_email(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_email(id)
}

// ─── Proxy commands ───────────────────────────────────────────

#[tauri::command]
fn add_proxy(input: ProxyInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let proxy = db.add_proxy(input)?;
    serde_json::to_value(proxy).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_proxies(raw: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.import_proxies(&raw)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_proxies(filter: ProxyFilter, page: u32, per_page: u32) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.get_proxies(filter, page, per_page)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_clean_proxy_for_shop(shop_id: i64) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let proxy = db.get_clean_proxy_for_shop(shop_id)?;
    serde_json::to_value(proxy).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_proxy(id: i64, input: ProxyInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let proxy = db.update_proxy(id, input)?;
    serde_json::to_value(proxy).map_err(|e| e.to_string())
}

#[tauri::command]
fn block_proxy(id: i64, blocked: bool) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.block_proxy(id, blocked)
}

#[tauri::command]
fn delete_proxy(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_proxy(id)
}

// ─── Register in invoke_handler! ─────────────────────────────
// add_email, get_emails, get_clean_email_for_shop,
// update_email, block_email, delete_email,
// add_proxy, import_proxies, get_proxies, get_clean_proxy_for_shop,
// update_proxy, block_proxy, delete_proxy
