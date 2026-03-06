// ============================================================
// PATCH: main.rs — Orders Tauri commands
// ============================================================

use crate::models::{OrderInput, OrderFilter, StatusMeta, SaveTemplateInput};

#[tauri::command]
fn create_order(input: OrderInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.create_order(input)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_orders(filter: OrderFilter, page: u32, per_page: u32) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_orders(filter, page, per_page)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_order_status(id: i64, status: String, meta: Option<StatusMeta>) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.update_order_status(id, &status, meta)
}

#[tauri::command]
fn delete_order(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_order(id)
}

#[tauri::command]
fn run_risk_check(
    profile_id: String,
    shop_id: i64,
    drop_id: i64,
    email_pool_id: Option<i64>,
    proxy_id: Option<i64>,
) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.run_risk_check(&profile_id, shop_id, drop_id, email_pool_id, proxy_id)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_order_template(input: SaveTemplateInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.save_order_template(input)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_order_templates(shop_tag: Option<String>) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_order_templates(shop_tag)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_order_template(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_order_template(id)
}

// ─── invoke_handler! additions ────────────────────────────────
// create_order, get_orders, update_order_status, delete_order,
// run_risk_check,
// save_order_template, get_order_templates, delete_order_template
