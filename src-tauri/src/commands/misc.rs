// Tauri commands: misc domain.
// Extracted from main.rs during module refactor.

use crate::state::*;
use crate::models::*;
use crate::database::{Database, fetch_bin_info};
use crate::models;
use crate::encryption::{FieldEncryption, PasswordValidation, generate_salt};
use crate::license::LicenseStatus;
use crate::rate_limiter;
use crate::sync;
use crate::imap;
use crate::stuffer;
use crate::smtp;
use crate::tracking;
use crate::ws_sync;
use crate::parser;
use crate::endpoints;
use crate::license;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use tauri::{Manager, Emitter};
use bcrypt;
use chrono;
use serde_json;
use std::collections::HashMap;

#[tauri::command]
pub(crate) fn get_activity_log(filter: LogFilter, page: u32) -> Result<PaginatedLog, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_activity_log(&filter, page, 100)
}

#[tauri::command]
pub(crate) fn clear_activity_log() -> Result<(), String> {
    // РћС‡РёСЃС‚РєР° Р¶СѓСЂРЅР°Р»Р° СЃС‚РёСЂР°РµС‚ СЃР»РµРґС‹ РґРµР№СЃС‚РІРёР№ вЂ” СЃСЋРґР° Р¶Рµ РїРёС€СѓС‚СЃСЏ
    // security.reveal_denied Рё РїСЂРѕС‡РёРµ СЃРѕР±С‹С‚РёСЏ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё. РћРїРµСЂР°С‚РѕСЂ,
    // СЃРїРѕСЃРѕР±РЅС‹Р№ С‡РёСЃС‚РёС‚СЊ Р°СѓРґРёС‚, РѕР±РЅСѓР»СЏРµС‚ СЃРјС‹СЃР» Р°СѓРґРёС‚Р°. РўРѕР»СЊРєРѕ Р°РґРјРёРЅ.
    require_admin()?;
    with_db!(db, { db.clear_activity_log() })
}

#[tauri::command]
pub(crate) fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub(crate) fn get_server_version() -> Result<Option<serde_json::Value>, String> {
    Ok(sync::SyncClient::check_version().map(|(version, notes)| {
        serde_json::json!({ "version": version, "notes": notes })
    }))
}

#[tauri::command]
pub(crate) fn global_search(query: String) -> Result<SearchResults, String> {
    require_user()?;
    if query.len() < 2 { return Ok(SearchResults { cards: vec![], profiles: vec![], orders: vec![], shops: vec![], emails: vec![], proxies: vec![] }); }
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.global_search(&query)
}

#[tauri::command]
pub(crate) fn open_float_window(profile_id: String, app: tauri::AppHandle) -> Result<(), String> {
    // Validate: profile_id must be UUID-like (hex + dashes only)
    let safe_id: String = profile_id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if safe_id != profile_id {
        return Err("invalid_profile_id".into());
    }
    let win = app.get_webview_window("float")
        .ok_or_else(|| "float_window_not_found".to_string())?;

    // Emit event вЂ” float.jsx listens and reloads data without page navigation.
    // Reliable even when window is hidden (no race with window.location.href).
    win.emit("float:load", &safe_id).map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.unminimize();

    // Log without blocking вЂ” ignore DB errors so window always opens
    let _: Result<(), String> = with_db!(db, {
        let _ = db.log_event("profile.float_opened",
            &format!("Profile {} float opened", safe_id), Some("profile"), None);
        Ok(())
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn open_main_window_page(page: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
        let _ = app.emit("navigate:page", &page);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_auto_delivered_orders() -> Result<Vec<i64>, String> {
    // This is handled automatically by IMAP poll, just return empty
    Ok(vec![])
}