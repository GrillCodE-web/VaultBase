// ============================================================
// PATCH: main.rs — Shops + Products Tauri commands
// ============================================================

use crate::models::{ShopInput, ProductInput};

#[tauri::command]
fn create_shop(input: ShopInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.create_shop(input)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_shop(id: i64, input: ShopInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.update_shop(id, input)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_shops(page: u32, per_page: u32, search: Option<String>) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_shops(page, per_page, search)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_shop_detail(id: i64) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_shop_detail(id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_shop(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_shop(id)
}

#[tauri::command]
fn get_shop_smart_suggestions(shop_id: i64, card_id: i64) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_shop_smart_suggestions(shop_id, card_id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_shop_products(shop_id: i64) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.get_shop_products(shop_id)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_shop_product(shop_id: i64, product: ProductInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.add_shop_product(shop_id, product)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_shop_product(id: i64, product: ProductInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    serde_json::to_value(db.update_shop_product(id, product)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_shop_product(id: i64) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_shop_product(id)
}

// ─── invoke_handler! additions ────────────────────────────────
// create_shop, update_shop, get_shops, get_shop_detail, delete_shop,
// get_shop_smart_suggestions,
// get_shop_products, add_shop_product, update_shop_product, delete_shop_product
