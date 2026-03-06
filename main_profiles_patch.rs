// ============================================================
// PATCH: main.rs — Profile / Drop Tauri commands
// Replace the stub implementations for these command names
// ============================================================

use crate::models::{ProfileFilter, DropInput};

// ─── Profile commands ─────────────────────────────────────────

#[tauri::command]
fn create_profile(card_id: i64, notes: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let profile = db.create_profile(card_id, &notes)?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_profiles(filter: ProfileFilter, page: u32, per_page: u32) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.get_profiles(filter, page, per_page)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_profile_detail(id: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.get_profile_detail(&id)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_profile_notes(id: String, notes: String) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.update_profile_notes(&id, &notes)
}

#[tauri::command]
fn delete_profile(id: String) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_profile(&id)
}

#[tauri::command]
fn duplicate_profile(id: String) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let profile = db.duplicate_profile(&id)?;
    serde_json::to_value(profile).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_duplicate_profiles() -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let groups = db.find_duplicate_profiles()?;
    serde_json::to_value(groups).map_err(|e| e.to_string())
}

// ─── Drop commands ────────────────────────────────────────────

#[tauri::command]
fn add_drop(profile_id: String, drop: DropInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.add_drop(&profile_id, drop)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_drop(id: i64, drop: DropInput) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.update_drop(id, drop)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_primary_drop(id: i64, profile_id: String) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.set_primary_drop(id, &profile_id)
}

#[tauri::command]
fn delete_drop(id: i64, profile_id: String) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    db.delete_drop(id, &profile_id)
}

#[tauri::command]
fn import_drops(profile_id: String, raw: String, mapping: Vec<String>) -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let result = db.import_drops(&profile_id, &raw, mapping)?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_duplicate_drops() -> Result<serde_json::Value, String> {
    let db = DB.get().ok_or("db_not_init")?;
    let db = db.lock().map_err(|_| "db_lock")?;
    if db.is_locked() { return Err("locked".into()); }
    let groups = db.find_duplicate_drops()?;
    serde_json::to_value(groups).map_err(|e| e.to_string())
}

// ─── Add to invoke_handler! ───────────────────────────────────
// create_profile, get_profiles, get_profile_detail,
// update_profile_notes, delete_profile, duplicate_profile,
// find_duplicate_profiles,
// add_drop, update_drop, set_primary_drop, delete_drop,
// import_drops, find_duplicate_drops
