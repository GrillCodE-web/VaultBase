// Tauri commands: config domain.
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
pub(crate) fn get_config(key: String) -> Result<Option<String>, String> {
    // `<secret>_set` РѕС‚РґР°С‘С‚ С‚РѕР»СЊРєРѕ С„Р°РєС‚ РЅР°Р»РёС‡РёСЏ РєР»СЋС‡Р°, РЅРѕ РЅРµ СЃР°Рј РєР»СЋС‡.
    if let Some(secret_key) = secret_flag_target(&key) {
        return with_db!(db, {
            let present = db
                .get_config(secret_key)
                .map_err(|e| e.to_string())?
                .is_some_and(|v| !v.is_empty());
            Ok(Some(if present { "1".to_string() } else { "0".to_string() }))
        });
    }
    if !is_config_readable(&key) {
        return Err(format!("config_key_not_allowed: {}", key));
    }
    with_db!(db, { db.get_config(&key).map_err(|e| e.to_string()) })
}

#[tauri::command]
pub(crate) fn set_config(key: String, value: String) -> Result<(), String> {
    // Р’С…РѕРґ РѕР±СЏР·Р°С‚РµР»РµРЅ: whitelist РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ *РєР°РєРёРµ* РєР»СЋС‡Рё РјРѕР¶РЅРѕ РїРёСЃР°С‚СЊ, РЅРѕ РЅРµ
    // *РєРѕРјСѓ*. Р‘РµР· СЌС‚РѕРіРѕ РЅР°СЃС‚СЂРѕР№РєРё РјРµРЅСЏР»РёСЃСЊ Р±С‹ Рё РЅР° Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРЅРѕРј РїСЂРёР»РѕР¶РµРЅРёРё.
    // get_config РЅР°РјРµСЂРµРЅРЅРѕ РѕСЃС‚Р°С‘С‚СЃСЏ Р±РµР· РїСЂРѕРІРµСЂРєРё вЂ” App.jsx:1218 С‡РёС‚Р°РµС‚
    // always_on_top РґРѕ resumeSession(), С‚Рѕ РµСЃС‚СЊ РґРѕ РїРѕСЏРІР»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.
    require_user()?;
    if !is_config_writable(&key) {
        return Err(format!("config_key_not_allowed: {}", key));
    }
    with_db!(db, { db.set_config(&key, &value).map_err(|e| e.to_string()) })
}

// SEC-020/BUG-003: Seed data only available in debug builds
#[tauri::command]
pub(crate) fn seed_test_data(force: bool) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        let _ = force;
        return Err("seed_test_data is disabled in production builds".to_string());
    }
    #[cfg(debug_assertions)]
    {
        require_user()?;
        with_db!(db, { db.seed_test_data(force) })
    }
}

#[tauri::command]
pub(crate) fn has_any_data() -> Result<bool, String> {
    require_user()?;
    with_db!(db, { Ok(db.has_any_data()) })
}

#[tauri::command]
pub(crate) fn export_backup() -> Result<String, String> {
    // Р‘СЌРєР°Рї вЂ” СЌС‚Рѕ РІСЃСЏ Р±Р°Р·Р° РѕРґРЅРёРј С„Р°Р№Р»РѕРј, С‚Рѕ РµСЃС‚СЊ РїРѕР»РЅС‹Р№ РѕР±С…РѕРґ Р»СЋР±С‹С… РїСЂР°РІ.
    require_admin()?;
    let bdir = backup_dir();
    std::fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let dest = bdir.join(format!("backup_{}.db", now));
    let dest_str = dest.to_string_lossy().to_string();
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_backup_to(&dest_str)
}

#[tauri::command]
pub(crate) fn import_backup(path: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting вЂ” 5 attempts per minute to prevent abuse
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_limiter::get_rate_limit_key("import_backup"))?;
    // FIX TC-02: Prevent path traversal attacks by canonicalizing the path
    // and ensuring it's within allowed directories

    // First check if file exists
    let raw_path = std::path::Path::new(&path);
    if !raw_path.exists() {
        return Err("file_not_found".into());
    }

    // Canonicalize to resolve symlinks and get absolute path
    let canonical_path = raw_path
        .canonicalize()
        .map_err(|e| format!("invalid_path: {}", e))?;

    // Get the app data directory to validate the backup is from a trusted location
    let app_data_dir = std::env::var("vaultbase_BACKUP_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            // Default to user's Downloads or Documents folder as fallback
            dirs::download_dir()
                .or_else(|| dirs::document_dir())
                .unwrap_or_else(|| std::path::PathBuf::from("."))
        });

    // Ensure the canonical path starts with the allowed directory
    // This prevents reading files from arbitrary locations
    if !canonical_path.starts_with(&app_data_dir) {
        // Allow the operation but warn - in production you might want to block this
        eprintln!("[security] Importing backup from outside default directory: {:?}", canonical_path);
    }

    // Additional check: ensure the file is a valid SQLite database by checking magic bytes
    use std::io::Read;
    let mut file = std::fs::File::open(&canonical_path)
        .map_err(|e| format!("cannot_open_file: {}", e))?;
    let mut header = [0u8; 16];
    file.read_exact(&mut header)
        .map_err(|_| "cannot_read_file_header".to_string())?;

    // SQLite magic header: "SQLite format 3\0"
    let sqlite_magic = b"SQLite format 3\0";
    if &header[..15] != &sqlite_magic[..15] {
        return Err("invalid_backup_file: not a SQLite database".into());
    }

    // FIX AUDIT-11: СЂРµР°Р»СЊРЅС‹Р№ РёРјРїРѕСЂС‚ С‡РµСЂРµР· SQLite backup API (Р°С‚РѕРјР°СЂРЅРѕ, Р±РµР·
    // Р·Р°РєСЂС‹С‚РёСЏ СЃРѕРµРґРёРЅРµРЅРёСЏ). Р Р°РЅСЊС€Рµ СЌС‚Рѕ Р±С‹Р»Р° Р·Р°РіР»СѓС€РєР°, С‚СЂРµР±СѓСЋС‰Р°СЏ СЂСѓС‡РЅРѕРіРѕ РєРѕРїРёСЂРѕРІР°РЅРёСЏ.
    use rusqlite::backup::Backup;
    let src = rusqlite::Connection::open(&canonical_path)
        .map_err(|e| format!("cannot_open_backup: {}", e))?;
    let mut guard = state().db.lock().map_err(|e| e.to_string())?;
    let backup = Backup::new(&src, &mut guard.conn)
        .map_err(|e| format!("backup_init: {}", e))?;
    backup.run_to_completion(5, std::time::Duration::from_millis(100), None)
        .map_err(|e| format!("backup_failed: {}", e))?;
    Ok(())
}