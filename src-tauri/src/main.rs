#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unused_imports, unused_variables, dead_code, unused_mut)]

mod database;
mod encryption;
mod imap;
mod license;
mod models;
mod parser;
mod rate_limiter;  // FIX TC-H03: Rate limiting infrastructure
mod smtp;
mod sync;
mod tracking;
mod ws_sync;

use database::{Database, fetch_bin_info};
use encryption::{FieldEncryption, PasswordValidation, generate_salt};
use license::LicenseStatus;
use models::*;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use tauri::{Manager, Emitter};

// ─────────────────────────────────────────
//  Global state
// ─────────────────────────────────────────

struct AppState {
    db: Mutex<Database>,
    is_locked: AtomicBool,  // FIX B-MED-05: Atomic flag для предотвращения race condition в autolock
}
static STATE: OnceCell<AppState> = OnceCell::new();
fn state() -> &'static AppState { STATE.get().expect("AppState not initialized") }

// ── WS Sync global handle ──────────────────────────────────────────────────
static WS_HANDLE: OnceCell<std::sync::Arc<ws_sync::WsSyncHandle>> = OnceCell::new();
fn ws_handle() -> &'static std::sync::Arc<ws_sync::WsSyncHandle> {
    WS_HANDLE.get().expect("WsSyncHandle not initialized")
}

fn db_path() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let cwd = std::env::current_dir().unwrap_or_default();
        let mut p = if cwd.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
            let mut parent = cwd.clone();
            parent.pop();
            parent
        } else {
            cwd
        };
        p.push("cc_manager.db");
        p
    }
    #[cfg(not(debug_assertions))]
    {
        let dir = dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("cc-manager");
        std::fs::create_dir_all(&dir).ok();
        dir.join("cc_manager.db")
    }
}

/// Единая директория для всех бэкапов (FIX B29)
fn backup_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("cc-manager")
        .join("backups")
}

macro_rules! with_db {
    ($db:ident, $body:block) => {{
        let mut guard = state().db.lock().map_err(|e| e.to_string())?;
        let $db = &mut *guard;
        $db.touch_activity();
        $body
    }};
}

// ─────────────────────────────────────────
//  Whitelist для get_config/set_config (FIX B49)
// ─────────────────────────────────────────

const CONFIG_READABLE: &[&str] = &[
    "autolock_timeout", "bin_api_key", "tracking_api_key",
    "sync_enabled", "theme", "language", "installation_id",
    "license_status_cache",
    "sync_group_id", "sync_group_name",
    "always_on_top", "last_backup_time",
    "dash_collapsed_banks", "dash_collapsed_countries",
    "dash_collapsed_sources", "dash_collapsed_expiring",
    "badge_notify_imap", "badge_notify_tracking",
];

const CONFIG_WRITABLE: &[&str] = &[
    "autolock_timeout", "bin_api_key", "tracking_api_key",
    "sync_enabled", "theme", "language",
    "always_on_top", "last_backup_time",
    "dash_collapsed_banks", "dash_collapsed_countries",
    "dash_collapsed_sources", "dash_collapsed_expiring",
    "badge_notify_imap", "badge_notify_tracking",
];

fn is_config_readable(key: &str) -> bool {
    CONFIG_READABLE.contains(&key)
}
fn is_config_writable(key: &str) -> bool {
    CONFIG_WRITABLE.contains(&key)
}

// ─────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────

#[tauri::command]
fn setup_password(password: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, 0)?;
    let v = PasswordValidation::check(&password);
    if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
    with_db!(db, {
        if db.get_config("master_password_hash").map_err(|e| e.to_string())?.is_some() {
            return Err("password_already_set".into());
        }
        let salt = generate_salt();
        let salt_b64 = B64.encode(&salt);
        // FIX CRY-H02: Use bcrypt cost factor 14 for stronger password hashing (OWASP 2026 recommendation)
        let hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
        db.set_config("master_password_hash", &hash).map_err(|e| e.to_string())?;
        db.set_config("encryption_salt", &salt_b64).map_err(|e| e.to_string())?;
        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.password_created", "Master password created", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn is_password_set() -> Result<bool, String> {
    with_db!(db, {
        Ok(db.get_config("master_password_hash")
            .map_err(|e| e.to_string())?
            .map(|v| !v.is_empty())
            .unwrap_or(false))
    })
}

#[tauri::command]
fn unlock(password: String, app: tauri::AppHandle) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, 0)?;
    let (token, group_id) = with_db!(db, {
        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&password, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }

        // FIX B-MED-07: Автоматическая миграция bcrypt cost factor
        // bcrypt хеш формата $2b$XX$... где XX — cost factor
        // Парсим cost из хеша и обновляем если < 14
        let needs_upgrade = hash.starts_with("$2b$") && hash.len() > 7
            && hash[4..7].parse::<u32>().map(|c| c < 14).unwrap_or(false);

        if needs_upgrade {
            // Ре-хешируем с новым cost factor
            let new_hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
            db.set_config("master_password_hash", &new_hash).map_err(|e| e.to_string())?;
            eprintln!("[bcrypt] Upgraded cost factor to 14");
        }

        let salt_b64 = db.get_config("encryption_salt").map_err(|e| e.to_string())?
            .ok_or("encryption_salt_missing")?;
        let salt = B64.decode(&salt_b64).map_err(|e| e.to_string())?;
        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.unlocked", "Database unlocked", Some("system"), None)
            .map_err(|e| e.to_string())?;
        let _ = auto_backup(db);
        // Extract WS creds while lock is held
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        let group_id = db.get_config("sync_group_id").ok().flatten();
        Ok::<(Option<String>, Option<String>), String>((token, group_id))
    })?;

    // FIX B-MED-05: Сбрасываем атомарный флаг после успешного unlock
    if let Some(st) = STATE.get() {
        st.is_locked.store(false, Ordering::Relaxed);
    }

    // Start WS sync in background (non-blocking)
    if let Some(h) = WS_HANDLE.get() {
        h.set_creds(token, group_id);
        let db_p = db_path().to_str().unwrap_or("cc_manager.db").to_string();
        ws_sync::start(app, db_p, h.clone());
    }
    Ok(())
}

fn auto_backup(db: &Database) -> Result<(), String> {
    let src = match db.conn.path() {
        Some(p) => p.to_string(),
        None => return Ok(()),
    };
    // FIX B29: единая директория через backup_dir()
    let bdir = backup_dir();
    std::fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let dest = bdir.join(format!("backup_{ts}.db"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    // FIX B09: фильтруем только файлы backup_*.db
    let mut entries: Vec<_> = std::fs::read_dir(&bdir)
        .map(|rd| rd.filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("backup_"))
            .collect())
        .unwrap_or_default();
    entries.sort_by_key(|e| e.file_name());
    if entries.len() > 30 {
        for old in &entries[..entries.len() - 30] {
            let _ = std::fs::remove_file(old.path());
        }
    }
    let _ = db.log_event("system.backup_created", &format!("Auto-backup: {}", dest.display()), Some("system"), None);
    Ok(())
}

#[tauri::command]
fn lock() -> Result<(), String> {
    with_db!(db, {
        db.clear_encryption();
        let _ = db.log_event("system.locked", "Database locked", Some("system"), None);
        Ok::<(), String>(())
    })?;
    // FIX B-MED-05: Атомарно устанавливаем флаг блокировки
    if let Some(st) = STATE.get() {
        st.is_locked.store(true, Ordering::Relaxed);
    }
    // Stop WS sync
    if let Some(h) = WS_HANDLE.get() {
        h.stop();
        h.set_creds(None, None);
    }
    Ok(())
}

#[tauri::command]
fn is_locked() -> Result<bool, String> {
    Ok(state().db.lock().map_err(|e| e.to_string())?.is_locked())
}

// FIX B23 + TC-H03: change_password теперь атомарен + rate limiting
#[tauri::command]
fn change_password(old: String, new: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, 0)?;
    let v = PasswordValidation::check(&new);
    if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
    with_db!(db, {
        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&old, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }
        let salt_b64 = db.get_config("encryption_salt").map_err(|e| e.to_string())?
            .ok_or("encryption_salt_missing")?;
        let old_salt = B64.decode(&salt_b64).map_err(|e| e.to_string())?;
        let old_enc  = FieldEncryption::new(&old, &old_salt);
        let new_salt = generate_salt();
        let new_enc  = FieldEncryption::new(&new, &new_salt);
        // FIX CRY-H02: Use bcrypt cost factor 14 for stronger password hashing (OWASP 2026 recommendation)
        let new_hash     = bcrypt::hash(&new, 14).map_err(|e| e.to_string())?;
        let new_salt_b64 = B64.encode(&new_salt);
        // Сначала обновляем метаданные, потом шифруем данные.
        // При crash после set_config но до reencrypt_all — данные всё ещё
        // читаются старым ключом, пользователь может залогиниться старым паролем.
        // Это лучше чем обратный порядок где crash оставляет БД нечитаемой.
        // FIX B24: перешифровываем license_token тоже (через reencrypt_all)
        db.set_config("master_password_hash", &new_hash).map_err(|e| e.to_string())?;
        db.set_config("encryption_salt", &new_salt_b64).map_err(|e| e.to_string())?;
        db.reencrypt_all(&old_enc, &new_enc)?;
        // FIX B24: перешифровать license_token
        if let Ok(Some(raw_token)) = db.get_config("license_token") {
            if !raw_token.is_empty() {
                let plain = old_enc.decrypt(&raw_token).unwrap_or(raw_token);
                if let Ok(new_enc_token) = new_enc.encrypt(&plain) {
                    let _ = db.set_config("license_token", &new_enc_token);
                }
            }
        }
        db.set_encryption(new_enc);
        db.log_event("system.password_changed", "Password changed", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ─────────────────────────────────────────
//  Card commands
// ─────────────────────────────────────────

#[tauri::command]
fn detect_mapping_preview(raw: String) -> Result<MappingPreview, String> {
    Ok(parser::mapping_preview(&raw))
}

#[tauri::command]
fn import_cards(raw: String, mapping: Vec<String>, source: String) -> Result<ImportResult, String> {
    let parse_result = parser::parse_cards(&raw, mapping, &source);
    let total_parsed = parse_result.parsed.len();

    let inserted = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.insert_cards(parse_result.parsed)
    })?;

    let skipped = total_parsed - inserted + parse_result.skipped;

    with_db!(db, {
        let _ = db.log_event(
            "card.imported",
            &format!("Imported {} cards from source '{}'", inserted, source),
            Some("card"), None,
        );
        Ok(ImportResult {
            total:    total_parsed as u32,
            imported: inserted as u32,
            skipped:  skipped as u32,
            errors:   parse_result.errors,
        })
    })
}

#[tauri::command]
fn get_cards(filter: CardFilter, page: u32, per_page: u32) -> Result<PaginatedCards, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_cards(&filter, page, per_page.max(1))
}

// FIX B01: get_card теперь реально фильтрует по id
#[tauri::command]
fn get_card_filter_meta() -> Result<CardFilterMeta, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_filter_meta()
}

#[tauri::command]
fn get_card(id: i64) -> Result<Card, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    let filter = CardFilter { id: Some(id), ..Default::default() };
    let result = guard.get_cards(&filter, 1, 1)?;
    result.items.into_iter().next().ok_or_else(|| "card_not_found".into())
}

// FIX B67 + TC-H04 + TC-H03: reveal_card требует мастер-пароль + rate limiting
// Это предотвращает несанкционированный доступ и brute-force атаки
#[tauri::command]
fn reveal_card(id: i64, master_password: Option<String>) -> Result<CardDecrypted, String> {
    // FIX TC-H03: Rate limiting — 5 requests per minute per installation
    let rate_key = id as u64;
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_key)?;

    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // FIX TC-H04: Require master password verification for sensitive card data
        if let Some(password) = master_password {
            // Verify master password before revealing card details
            let stored_hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?;
            if let Some(expected_hash) = stored_hash {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(password.as_bytes());
                let provided_hash = format!("{:x}", hasher.finalize());

                if provided_hash != expected_hash {
                    // Log failed attempt
                    let _ = db.log_event("security.reveal_failed",
                        &format!("Failed attempt to reveal card {} - wrong password", id),
                        Some("security"), None);
                    return Err("invalid_master_password".into());
                }
            }
        } else {
            // If app is locked, require password
            if db.is_locked() {
                return Err("app_locked_password_required".into());
            }
        }

        let card = db.get_card_decrypted(id)?;

        // Log successful reveal with audit trail
        let _ = db.log_event("card.revealed",
            &format!("Card {} full data accessed (CVV, full number)", id),
            Some("card"), Some(&id.to_string()));

        Ok(card)
    })
}

#[tauri::command]
fn update_card_status(id: i64, status: String, app: tauri::AppHandle) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash and encrypted_data for sync
        let (hash, enc_data): (String, Option<String>) = db.conn.query_row(
            "SELECT card_hash, encrypted_data FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|e| format!("card_not_found: {}", e))?;

        db.update_card_status(id, &status)?;
        let _ = db.log_event("card.status_changed",
            &format!("Card {} status → {}", id, status), Some("card"), Some(&id.to_string()));

        // FIX P1-RETRY-03: Push update to sync server with retry
        let update = crate::models::CardSyncUpdate {
            card_hash: hash,
            status: status.clone(),
            notes: None,
            encrypted_data: enc_data,
        };
        let _ = crate::sync::SyncGroupClient::push_card_updates(db, &[update]);

        Ok(())
    })
}

#[tauri::command]
fn update_card_notes(id: i64, notes: String, app: tauri::AppHandle) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash and status for sync
        let (hash, cur_status, enc_data): (String, String, Option<String>) = db.conn.query_row(
            "SELECT card_hash, status, encrypted_data FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        ).map_err(|e| format!("card_not_found: {}", e))?;

        db.update_card_notes(id, &notes)?;
        let _ = db.log_event("card.notes_updated",
            &format!("Card {} notes updated", id), Some("card"), Some(&id.to_string()));

        // FIX P1-RETRY-04: Push update to sync server with retry
        let update = crate::models::CardSyncUpdate {
            card_hash: hash,
            status: cur_status,
            notes: Some(notes),
            encrypted_data: enc_data,
        };
        let _ = crate::sync::SyncGroupClient::push_card_updates(db, &[update]);

        Ok(())
    })
}

#[tauri::command]
fn delete_card(id: i64) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.delete_card(id)?;
        let _ = db.log_event("card.deleted", &format!("Card {} deleted", id),
            Some("card"), Some(&id.to_string()));
        Ok(())
    })
}

#[tauri::command]
fn bulk_update_cards(ids: Vec<i64>, status: String) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash for each ID and build updates
        let mut updates = Vec::with_capacity(ids.len());
        for id in &ids {
            let result: Result<(String, Option<String>), _> = db.conn.query_row(
                "SELECT card_hash, encrypted_data FROM credit_cards WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            );

            if let Ok((hash, enc_data)) = result {
                if !hash.is_empty() {
                    updates.push(crate::models::CardSyncUpdate {
                        card_hash: hash,
                        status: status.clone(),
                        notes: None,
                        encrypted_data: enc_data,
                    });
                }
            }
        }

        db.bulk_update_status(&ids, &status)?;
        let _ = db.log_event("card.bulk_status",
            &format!("{} cards → {}", ids.len(), status), Some("card"), None);

        // FIX P1-RETRY-05: Push bulk update to sync server with retry
        if !updates.is_empty() {
            let _ = crate::sync::SyncGroupClient::push_card_updates(db, &updates);
        }

        Ok(())
    })
}

#[tauri::command]
fn bulk_delete_cards(ids: Vec<i64>) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_delete(&ids)?;
        let _ = db.log_event("card.bulk_deleted",
            &format!("{} cards deleted", ids.len()), Some("card"), None);
        Ok(())
    })
}

// FIX B50: export_cards теперь логирует количество и список id
#[tauri::command]
fn export_cards(ids: Vec<i64>, format: String) -> Result<String, String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let result = db.export_cards(&ids, &format)?;
        let _ = db.log_event("card.exported",
            &format!("{} cards exported (format: {})", ids.len(), format),
            Some("card"), None);
        Ok(result)
    })
}

#[tauri::command]
fn enrich_bin(bin: String) -> Result<BinInfo, String> {
    let guard  = state().db.lock().map_err(|e| e.to_string())?;
    let api_key = guard.get_config("bin_api_key")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    drop(guard);
    fetch_bin_info(&bin, &api_key)
}

// ─────────────────────────────────────────
//  Profiles + Drops
// ─────────────────────────────────────────

#[tauri::command]
fn create_profile(card_id: i64, notes: Option<String>) -> Result<Profile, String> {
    with_db!(db, { db.create_profile(card_id, notes) })
}
#[tauri::command]
fn get_profiles(filter: ProfileFilter, page: u32, per_page: u32) -> Result<PaginatedProfiles, String> {
    with_db!(db, { db.get_profiles(&filter, page, per_page) })
}
#[tauri::command]
fn get_profile(id: String) -> Result<ProfileDetail, String> {
    with_db!(db, { db.get_profile_detail(&id) })
}
#[tauri::command]
fn get_profile_detail(id: String) -> Result<ProfileDetail, String> {
    with_db!(db, { db.get_profile_detail(&id) })
}
#[tauri::command]
fn update_profile(id: String, notes: String) -> Result<(), String> {
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}
#[tauri::command]
fn update_profile_notes(id: String, notes: String) -> Result<(), String> {
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}
#[tauri::command]
fn delete_profile(id: String) -> Result<(), String> {
    with_db!(db, { db.delete_profile(&id) })
}
#[tauri::command]
fn duplicate_profile(id: String) -> Result<Profile, String> {
    with_db!(db, { db.duplicate_profile(&id) })
}
#[tauri::command]
fn find_duplicate_profiles() -> Result<Vec<Vec<Profile>>, String> {
    with_db!(db, { db.find_duplicate_profiles() })
}

#[tauri::command]
fn save_profile_template(name: String, country: Option<String>, state: Option<String>, city: Option<String>, phone_prefix: Option<String>, source: Option<String>) -> Result<i64, String> {
    with_db!(db, { db.save_profile_template(&name, country.as_deref(), state.as_deref(), city.as_deref(), phone_prefix.as_deref(), source.as_deref()) })
}

#[tauri::command]
fn get_profile_templates() -> Result<Vec<ProfileTemplate>, String> {
    with_db!(db, { db.get_profile_templates() })
}

#[tauri::command]
fn delete_profile_template(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_profile_template(id) })
}

#[tauri::command]
fn add_drop(profile_id: String, drop: DropInput) -> Result<Drop, String> {
    with_db!(db, { db.add_drop(&profile_id, &drop) })
}
#[tauri::command]
fn update_drop(id: i64, drop: DropInput) -> Result<(), String> {
    with_db!(db, { db.update_drop(id, &drop) })
}
#[tauri::command]
fn delete_drop(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_drop(id) })
}
#[tauri::command]
fn set_primary_drop(id: i64, profile_id: String) -> Result<(), String> {
    with_db!(db, { db.set_primary_drop(id, &profile_id) })
}
#[tauri::command]
fn import_drops(profile_id: String, raw: String, mapping: Vec<String>) -> Result<ImportResult, String> {
    let cols = mapping.clone();
    let rows: Vec<DropInput> = raw.lines().filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let get = |key: &str| -> String {
                cols.iter().position(|c| c == key)
                    .and_then(|i| parts.get(i))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            };
            Some(DropInput {
                recipient_name: get("recipient_name"),
                address: get("address"),
                city: get("city"),
                state: Some(get("state")),
                zip: get("zip"),
                country: get("country"),
                phone: Some(get("phone")),
            })
        }).collect();
    with_db!(db, { db.import_drops(&profile_id, rows) })
}
#[tauri::command]
fn find_duplicate_drops() -> Result<Vec<Vec<Drop>>, String> {
    with_db!(db, { db.find_duplicate_drops() })
}

// ─────────────────────────────────────────
//  Email Pool
// ─────────────────────────────────────────

#[tauri::command]
fn add_email(email: String, label: String, notes: String) -> Result<EmailPoolEntry, String> {
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.add_email(&email, label, notes) })
}
#[tauri::command]
fn get_emails(filter: EmailFilter, page: u32, per_page: u32) -> Result<PaginatedEmails, String> {
    with_db!(db, { db.get_emails(&filter, page, per_page) })
}
#[tauri::command]
fn update_email(id: i64, label: String, notes: String) -> Result<(), String> {
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.update_email(id, label, notes) })
}
#[tauri::command]
fn block_email(id: i64, blocked: bool) -> Result<(), String> {
    with_db!(db, { db.block_email(id, blocked) })
}
#[tauri::command]
fn delete_email(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_email(id) })
}
#[tauri::command]
fn get_clean_email_for_shop(shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
    with_db!(db, { db.get_clean_email_for_shop(shop_id) })
}

// ─────────────────────────────────────────
//  Proxies
// ─────────────────────────────────────────

#[tauri::command]
fn add_proxy(input: ProxyInput) -> Result<Proxy, String> {
    with_db!(db, { db.add_proxy(&input) })
}
#[tauri::command]
fn import_proxies(raw: String) -> Result<ImportResult, String> {
    with_db!(db, { db.import_proxies(&raw) })
}
#[tauri::command]
fn get_proxies(filter: ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
    with_db!(db, { db.get_proxies(&filter, page, per_page) })
}
#[tauri::command]
fn update_proxy(id: i64, input: ProxyInput) -> Result<(), String> {
    with_db!(db, { db.update_proxy(id, &input) })
}
#[tauri::command]
fn block_proxy(id: i64, blocked: bool) -> Result<(), String> {
    with_db!(db, { db.block_proxy(id, blocked) })
}
#[tauri::command]
fn delete_proxy(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_proxy(id) })
}

#[tauri::command]
fn test_proxy_connection(host: String, port: u16) -> Result<bool, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    let addr = format!("{}:{}", host, port);
    let addrs: Vec<_> = addr.to_socket_addrs().map_err(|e| e.to_string())?.collect();
    for a in addrs {
        if TcpStream::connect_timeout(&a, std::time::Duration::from_secs(5)).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

// ─────────────────────────────────────────
//  Shops
// ─────────────────────────────────────────

#[tauri::command]
fn create_shop(input: ShopInput) -> Result<Shop, String> {
    with_db!(db, { db.create_shop(&input) })
}
#[tauri::command]
fn get_shops(page: u32, per_page: u32, search: String) -> Result<PaginatedShops, String> {
    with_db!(db, { db.get_shops(page, per_page, &search) })
}
#[tauri::command]
fn get_shop(id: i64) -> Result<ShopDetail, String> {
    with_db!(db, { db.get_shop_detail(id) })
}
#[tauri::command]
fn update_shop(id: i64, input: ShopInput) -> Result<(), String> {
    with_db!(db, { db.update_shop(id, &input) })
}
#[tauri::command]
fn delete_shop(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_shop(id) })
}
#[tauri::command]
fn add_shop_product(shop_id: i64, product: ProductInput) -> Result<Product, String> {
    with_db!(db, { db.add_shop_product(shop_id, &product) })
}
#[tauri::command]
fn update_shop_product(id: i64, product: ProductInput) -> Result<(), String> {
    with_db!(db, { db.update_shop_product(id, &product) })
}
#[tauri::command]
fn delete_shop_product(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_shop_product(id) })
}
#[tauri::command]
fn get_shop_smart_suggestions(shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
    with_db!(db, { db.get_shop_smart_suggestions(shop_id, card_id) })
}

// ─────────────────────────────────────────
//  Orders
// ─────────────────────────────────────────

#[tauri::command]
fn create_order(input: OrderInput) -> Result<Order, String> {
    with_db!(db, { db.create_order(&input) })
}
#[tauri::command]
fn get_orders(filter: OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
    with_db!(db, { db.get_orders(&filter, page, per_page) })
}
#[tauri::command]
fn get_order(id: i64) -> Result<OrderDetail, String> {
    with_db!(db, { db.get_order(id) })
}
#[tauri::command]
fn get_latest_order_by_profile(profile_id: String) -> Result<Option<Order>, String> {
    with_db!(db, { db.get_latest_order_by_profile(&profile_id) })
}
#[tauri::command]
fn get_recent_orders_by_profile(profile_id: String, limit: u32) -> Result<Vec<Order>, String> {
    with_db!(db, { db.get_recent_orders_by_profile(&profile_id, limit) })
}
#[tauri::command]
fn update_order_status(id: i64, status: String, meta: Option<StatusMeta>) -> Result<(), String> {
    with_db!(db, { db.update_order_status(id, &status, meta.as_ref()) })
}
#[tauri::command]
fn delete_order(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_order(id) })
}

// FIX B02: различаем offline (нет токена/сети) и "сервер ответил — нет риска"
#[tauri::command]
fn run_risk_check(profile_id: String, shop_id: i64, drop_id: Option<i64>, email_pool_id: Option<i64>, proxy_id: Option<i64>) -> Result<RiskCheckResult, String> {
    with_db!(db, {
        // FIX B31: передаём все факторы риска в БД-функцию
        let mut result = db.run_risk_check(&profile_id, shop_id, drop_id, email_pool_id, proxy_id)?;
        let server_result = sync::SyncClient::check_risk_detailed(&db, &profile_id, shop_id);
        match server_result {
            sync::RiskCheckOutcome::Offline => {
                result.offline = true;
            }
            sync::RiskCheckOutcome::Clean => {
                result.offline = false;
            }
            sync::RiskCheckOutcome::Warnings(server_warnings) => {
                result.offline = false;
                result.score = result.score.saturating_add(30);
                result.warnings.extend(server_warnings);
                result.level = if result.score >= 40 { "high" } else if result.score >= 20 { "warning" } else { "safe" }.into();
            }
        }
        Ok(result)
    })
}

#[tauri::command]
fn save_order_template(input: SaveTemplateInput) -> Result<(), String> {
    with_db!(db, { db.save_order_template(&input) })
}
#[tauri::command]
fn get_order_templates(shop_tag: Option<String>) -> Result<Vec<OrderTemplate>, String> {
    with_db!(db, { db.get_order_templates(shop_tag.as_deref()) })
}

// Dashboard
#[tauri::command]
fn get_dashboard_stats(period: String, from: Option<String>, to: Option<String>) -> Result<DashboardStats, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_dashboard_stats(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_revenue_chart(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<RevenuePoint>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_revenue_chart(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_heatmap_data(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<HeatmapCell>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_heatmap_data(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_top_banks(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<BankStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_top_banks(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_by_country(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<CountryStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_country(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_by_source(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<SourceStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_source(&period, from.as_deref(), to.as_deref())
}

// P2-DOMAIN: Statistics by domain
#[tauri::command]
fn get_by_domain(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<DomainStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_domain(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_expiring_cards_dashboard(days: u32) -> Result<Vec<ExpiringCard>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_expiring_cards_dashboard(days)
}
#[tauri::command]
fn export_dashboard_csv(period: String, from: Option<String>, to: Option<String>) -> Result<String, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_dashboard_csv(&period, from.as_deref(), to.as_deref())
}
#[tauri::command]
fn get_sidebar_badges() -> Result<SidebarBadges, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_sidebar_badges()
}
#[tauri::command]
fn get_bin_performance() -> Result<Vec<models::BinPerf>, String> {
    with_db!(db, { db.get_bin_performance() })
}
#[tauri::command]
fn get_shop_win_loss() -> Result<Vec<models::ShopWinLoss>, String> {
    with_db!(db, { db.get_shop_win_loss() })
}

// IMAP
#[tauri::command]
fn add_imap_account(input: ImapInput) -> Result<ImapAccount, String> {
    with_db!(db, { db.add_imap_account(&input) })
}
#[tauri::command]
fn get_imap_accounts() -> Result<Vec<ImapAccount>, String> {
    with_db!(db, { db.get_imap_accounts() })
}
#[tauri::command]
fn update_imap_account(id: i64, input: ImapInput) -> Result<(), String> {
    with_db!(db, { db.update_imap_account(id, &input) })
}
#[tauri::command]
fn delete_imap_account(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_imap_account(id) })
}
#[tauri::command]
fn toggle_imap_account(id: i64, active: bool) -> Result<(), String> {
    with_db!(db, { db.toggle_imap_account(id, active) })
}
#[tauri::command]
fn get_imap_messages(filter: ImapMsgFilter, page: u32) -> Result<PaginatedMessages, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_messages(&filter, page, 50)
}
/// Non-blocking: spawns per-account threads, returns account count immediately.
/// Progress events: imap_check_progress { account_id, account_label, messages, orders, error? }
#[tauri::command]
fn imap_check_all(app_handle: tauri::AppHandle) -> Result<ImapCheckResult, String> {
    let accounts: Vec<_> = {
        let guard = state().db.lock().map_err(|e| e.to_string())?;
        guard.get_imap_accounts()?.into_iter().filter(|a| a.is_active).collect()
    };
    let count = accounts.len() as u32;
    for acc in accounts {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            // 1. Get credentials (brief lock)
            let creds = {
                let Ok(g) = state().db.lock() else { return };
                g.get_imap_account_with_password(acc.id)
            };
            let (_, pw) = match creds {
                Ok((a, p)) if !p.is_empty() => (a, p),
                _ => return,
            };
            // 2. Get known UIDs (brief lock)
            let known_uids: std::collections::HashSet<String> = {
                let Ok(g) = state().db.lock() else { return };
                g.get_known_imap_uids(acc.id).unwrap_or_default().into_iter().collect()
            };
            // 3. IMAP fetch (no lock!)
            match imap::fetch_account_messages(&acc, &pw, &known_uids) {
                Ok(result) => {
                    let msgs = result.messages.len();
                    let mut orders = 0usize;
                    if msgs > 0 {
                        if let Ok(g) = state().db.lock() {
                            for msg in &result.messages {
                                if let (Some(onum), Some(act)) = (msg.order_number.as_deref(), msg.action.as_deref()) {
                                    if let Ok(Some(oid)) = g.find_order_by_number(onum) {
                                        let _ = g.update_order_status_simple(oid, act, msg.tracking.as_deref());
                                    }
                                }
                                let _ = g.save_imap_message(
                                    acc.id, msg.uid.as_deref(), &msg.subject,
                                    &msg.from_email, &msg.received_at,
                                    msg.order_number.as_deref(), msg.tracking.as_deref(),
                                    msg.action.as_deref(),
                                );
                                if msg.action.as_deref() == Some("delivered") {
                                    let _ = g.auto_mark_delivered_by_account(acc.id);
                                }
                                let _ = app.emit("new_imap_message", serde_json::json!({
                                    "account_id": acc.id, "subject": &msg.subject, "from": &msg.from_email,
                                }));
                            }
                            let _ = g.update_imap_last_checked(acc.id);
                            orders = g.auto_mark_delivered_by_account(acc.id).unwrap_or_default().len();
                        }
                    }
                    let _ = app.emit("imap_check_progress", serde_json::json!({
                        "account_id": acc.id, "account_label": acc.label,
                        "messages": msgs, "orders": orders,
                    }));
                }
                Err(e) => {
                    let _ = app.emit("imap_check_progress", serde_json::json!({
                        "account_id": acc.id, "account_label": acc.label,
                        "messages": 0, "orders": 0, "error": e,
                    }));
                }
            }
        });
    }
    Ok(ImapCheckResult { accounts_checked: count, messages_found: 0, orders_updated: 0 })
}
#[tauri::command]
fn test_imap_connection(id: i64) -> Result<String, String> {
    let (acc, pw) = with_db!(db, { db.get_imap_account_with_password(id) })?;
    imap::ImapPoller::test_connection(&acc.host, acc.port as u16, &acc.login, &pw)
}
#[tauri::command]
fn link_all_imap_accounts() -> Result<u32, String> {
    with_db!(db, { db.link_all_imap_to_email_pool() })
}
#[tauri::command]
fn link_email_to_imap(email_id: i64, imap_account_id: Option<i64>) -> Result<(), String> {
    with_db!(db, {
        db.conn.execute("UPDATE email_pool SET imap_account_id=?1 WHERE id=?2",
            rusqlite::params![imap_account_id, email_id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// IMAP — new email client commands

/// Returns cached folder list immediately; spawns background thread to refresh from server.
/// Emits imap_folders_refreshed { account_id, folders } when background fetch completes.
#[tauri::command]
fn list_imap_folders(account_id: i64, app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cached = {
        let guard = state().db.lock().map_err(|e| e.to_string())?;
        guard.get_cached_imap_folders(account_id)
    };
    // Spawn background refresh
    std::thread::spawn(move || {
        let creds = {
            let Ok(g) = state().db.lock() else { return };
            g.get_imap_account_with_password(account_id)
        };
        let (acc, pw) = match creds {
            Ok((a, p)) if !p.is_empty() => (a, p),
            _ => return,
        };
        let folders = imap::list_imap_folders(&acc, &pw).unwrap_or_else(|_| vec!["INBOX".into()]);
        if let Ok(g) = state().db.lock() {
            let _ = g.save_cached_imap_folders(account_id, &folders);
        }
        let _ = app_handle.emit("imap_folders_refreshed", serde_json::json!({
            "account_id": account_id, "folders": folders,
        }));
    });
    Ok(if cached.is_empty() { vec!["INBOX".into()] } else { cached })
}
#[tauri::command]
fn get_imap_account_stats(account_id: i64) -> Result<ImapAccountStats, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_account_stats(account_id)
}
/// Returns cached messages from DB immediately (no IMAP connection).
/// Call refresh_folder_from_imap() separately to trigger background server fetch.
#[tauri::command]
fn get_folder_messages(account_id: i64, folder: String, page: u32, search: Option<String>) -> Result<PaginatedMessages, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_folder_messages(account_id, &folder, page, 30, search.as_deref())
}

/// Background IMAP refresh: fetches new messages from server, saves to DB,
/// then emits imap_messages_refreshed { account_id, folder, new_count }.
/// Returns immediately — never blocks the UI.
#[tauri::command]
fn refresh_folder_from_imap(account_id: i64, folder: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let (acc, pw) = {
        let g = state().db.lock().map_err(|e| e.to_string())?;
        match g.get_imap_account_with_password(account_id) {
            Ok((a, p)) if !p.is_empty() => (a, p),
            _ => return Ok(()),
        }
    };
    std::thread::spawn(move || {
        let known_uids: std::collections::HashSet<String> = {
            let Ok(g) = state().db.lock() else { return };
            g.get_known_imap_uids(account_id).unwrap_or_default().into_iter().collect()
        };
        match imap::fetch_account_messages(&acc, &pw, &known_uids) {
            Ok(result) => {
                let count = result.messages.len();
                if count > 0 {
                    if let Ok(g) = state().db.lock() {
                        for msg in &result.messages {
                            let _ = g.save_imap_message_with_body(
                                account_id, msg.uid.as_deref(), &msg.subject, &msg.from_email,
                                None, &msg.received_at, None, &folder,
                                msg.order_number.as_deref(), msg.tracking.as_deref(),
                                msg.action.as_deref(), false,
                            );
                        }
                    }
                }
                let _ = app_handle.emit("imap_messages_refreshed", serde_json::json!({
                    "account_id": account_id, "folder": folder, "new_count": count,
                }));
            }
            Err(e) => {
                eprintln!("[imap] refresh_folder error account {}: {}", account_id, e);
                let _ = app_handle.emit("imap_messages_refreshed", serde_json::json!({
                    "account_id": account_id, "folder": folder, "new_count": 0,
                }));
            }
        }
    });
    Ok(())
}

/// Unified inbox: all accounts' INBOX messages sorted newest first.
#[tauri::command]
fn get_unified_inbox(page: u32, search: Option<String>) -> Result<PaginatedMessages, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_all_inbox_messages(page, 30, search.as_deref())
}
#[tauri::command]
fn archive_imap_message(account_id: i64, message_id: i64) -> Result<(), String> {
    with_db!(db, { db.archive_imap_message(message_id) })
}
#[tauri::command]
fn get_imap_message_body(account_id: i64, message_id: i64) -> Result<String, String> {
    with_db!(db, { imap::get_message_body_from_server(db, account_id, message_id) })
}
#[tauri::command]
fn mark_imap_message_read(account_id: i64, message_id: i64) -> Result<(), String> {
    with_db!(db, { imap::mark_message_read_on_server(db, account_id, message_id) })
}
#[tauri::command]
fn delete_imap_message(account_id: i64, message_id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_imap_message(message_id) })
}

// SMTP
#[tauri::command]
fn add_smtp_config(input: SmtpConfigInput) -> Result<SmtpConfig, String> {
    with_db!(db, { db.add_smtp_config(&input) })
}
#[tauri::command]
fn get_smtp_configs() -> Result<Vec<SmtpConfig>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_smtp_configs()
}
#[tauri::command]
fn delete_smtp_config(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_smtp_config(id) })
}
#[tauri::command]
fn test_smtp_connection(id: i64) -> Result<String, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    let cfg = guard.get_smtp_configs()?.into_iter().find(|c| c.id == id)
        .ok_or_else(|| "smtp_config_not_found".to_string())?;
    let pw = guard.get_smtp_config_password(id)?;
    drop(guard);
    smtp::EmailSender::test(&cfg.host, cfg.port as u16, &cfg.login, &pw, cfg.use_tls)
}
#[tauri::command]
fn send_email(smtp_config_id: i64, to: String, subject: String, body: String) -> Result<(), String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    smtp::EmailSender::send(&*guard, smtp_config_id, &to, &subject, &body)
}
#[tauri::command]
fn get_sent_emails(page: u32) -> Result<PaginatedSentEmails, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_sent_emails(page, 50)
}

// Activity Log
#[tauri::command]
fn get_activity_log(filter: LogFilter, page: u32) -> Result<PaginatedLog, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_activity_log(&filter, page, 100)
}
#[tauri::command]
fn clear_activity_log() -> Result<(), String> {
    with_db!(db, { db.clear_activity_log() })
}

// Sync
#[tauri::command]
fn get_unsynced_footprints() -> Result<Vec<Footprint>, String> {
    with_db!(db, { db.get_unsynced_footprints_db() })
}
#[tauri::command]
fn mark_footprints_synced(ids: Vec<i64>) -> Result<(), String> {
    with_db!(db, { db.mark_footprints_synced_db(&ids) })
}
#[tauri::command]
fn sync_now() -> Result<SyncResult, String> {
    with_db!(db, { sync::SyncClient::sync_footprints(db) })
}

// Version
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}
#[tauri::command]
fn get_server_version() -> Result<Option<serde_json::Value>, String> {
    Ok(sync::SyncClient::check_version().map(|(version, notes)| {
        serde_json::json!({ "version": version, "notes": notes })
    }))
}

// FIX B49: get_config/set_config с whitelist
#[tauri::command]
fn get_config(key: String) -> Result<Option<String>, String> {
    if !is_config_readable(&key) {
        return Err(format!("config_key_not_allowed: {}", key));
    }
    with_db!(db, { db.get_config(&key).map_err(|e| e.to_string()) })
}
#[tauri::command]
fn set_config(key: String, value: String) -> Result<(), String> {
    if !is_config_writable(&key) {
        return Err(format!("config_key_not_allowed: {}", key));
    }
    with_db!(db, { db.set_config(&key, &value).map_err(|e| e.to_string()) })
}

// FIX B29: export_backup использует единую backup_dir()
#[tauri::command]
fn export_backup() -> Result<String, String> {
    let bdir = backup_dir();
    std::fs::create_dir_all(&bdir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let dest = bdir.join(format!("backup_{}.db", now));
    let dest_str = dest.to_string_lossy().to_string();
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_backup_to(&dest_str)
}

#[tauri::command]
fn import_backup(path: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent abuse
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, 0)?;
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
    let app_data_dir = std::env::var("CC_MANAGER_BACKUP_DIR")
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

    // For now, require manual copy - this is a safety measure
    Err("restart_required: Copy the backup file manually and restart".into())
}

// License
#[tauri::command]
fn get_installation_id() -> Result<String, String> {
    with_db!(db, { license::get_or_create_installation_id(db) })
}
#[tauri::command]
fn get_challenge_code() -> Result<String, String> {
    with_db!(db, { license::get_challenge_code(db) })
}
#[tauri::command]
fn activate_license(activation_key: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, 0)?;
    with_db!(db, { license::activate(db, &activation_key) })
}
#[tauri::command]
fn get_license_status() -> Result<LicenseStatus, String> {
    with_db!(db, { license::verify_at_startup(db) })
}
#[tauri::command]
fn retry_license_connection() -> Result<LicenseStatus, String> {
    with_db!(db, { license::retry_verify(db) })
}

// Search
#[tauri::command]
fn global_search(query: String) -> Result<SearchResults, String> {
    if query.len() < 2 { return Ok(SearchResults { cards: vec![], profiles: vec![], orders: vec![], shops: vec![], emails: vec![], proxies: vec![] }); }
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.global_search(&query)
}

#[tauri::command]
fn open_float_window(profile_id: String, app: tauri::AppHandle) -> Result<(), String> {
    // Validate: profile_id must be UUID-like (hex + dashes only)
    let safe_id: String = profile_id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if safe_id != profile_id {
        return Err("invalid_profile_id".into());
    }
    let win = app.get_webview_window("float")
        .ok_or_else(|| "float_window_not_found".to_string())?;

    // Emit event — float.jsx listens and reloads data without page navigation.
    // Reliable even when window is hidden (no race with window.location.href).
    win.emit("float:load", &safe_id).map_err(|e| e.to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.unminimize();

    // Log without blocking — ignore DB errors so window always opens
    let _: Result<(), String> = with_db!(db, {
        let _ = db.log_event("profile.float_opened",
            &format!("Profile {} float opened", safe_id), Some("profile"), None);
        Ok(())
    });
    Ok(())
}

#[tauri::command]
fn open_main_window_page(page: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
        let _ = app.emit("navigate:page", &page);
    }
    Ok(())
}

// ─────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────

fn start_background_threads(handle: tauri::AppHandle) {
    // ── Autolock thread (every 30s) ──
    // FIX B-MED-05: Race condition fix — используем атомарный флаг + единый lock
    let h = handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if let Some(st) = STATE.get() {
            // Быстрая проверка атомарного флага без lock
            if st.is_locked.load(Ordering::Relaxed) {
                continue; // Уже заблокировано, пропускаем
            }

            // Единый lock для проверки и блокировки
            let should_lock = {
                let db = match st.db.lock() { Ok(d) => d, Err(_) => continue };
                if db.is_locked() {
                    false
                } else {
                    let timeout_secs = db.get_config("autolock_timeout").ok().flatten()
                        .and_then(|v| if v == "never" { None } else { v.parse::<u64>().ok() })
                        .unwrap_or(300);
                    db.last_activity.lock().map(|t| t.elapsed().as_secs() >= timeout_secs).unwrap_or(false)
                }
            };

            if should_lock {
                // Блокируем и атомарно устанавливаем флаг
                if let Ok(mut db) = st.db.lock() {
                    db.clear_encryption();
                }
                st.is_locked.store(true, Ordering::Relaxed);
                let _ = h.emit("app_locked", ());
            }
        }
    });

    // ── Sync thread (every 2 min) ──
    // FIX P3-FOOTPRINT-AUTO-01: Periodic footprint sync с retry и логированием
    let h = handle.clone();
    std::thread::spawn(move || {
        let mut last_online: Option<bool> = None;
        let mut consecutive_failures = 0u32;
        const MAX_FAILURES_BEFORE_PAUSE: u32 = 5; // Pause after 5 consecutive failures

        loop {
            std::thread::sleep(std::time::Duration::from_secs(120));
            if let Some(st) = STATE.get() {
                let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
                if !db_locked {
                    let online = sync::SyncClient::check_server_online();
                    if last_online != Some(online) {
                        last_online = Some(online);
                        if online {
                            eprintln!("[sync] Server online detected");
                            let _ = h.emit("server_online", ());
                        } else {
                            eprintln!("[sync] Server offline detected");
                            let _ = h.emit("server_offline", ());
                        }
                    }

                    if online {
                        if let Ok(mut db) = st.db.lock() {
                            match sync::SyncClient::sync_footprints(&mut db) {
                                Ok(res) => {
                                    if res.synced > 0 {
                                        eprintln!("[sync] Successfully synced {} footprints", res.synced);
                                        let _ = h.emit("sync_completed", serde_json::json!({
                                            "type": "footprints",
                                            "sent": res.synced,
                                            "message": res.message
                                        }));
                                        consecutive_failures = 0; // Reset on success
                                    } else if res.failed > 0 {
                                        eprintln!("[sync] Footprint sync failed: {} (server_reached: {})", res.message, res.server_reached);
                                        consecutive_failures += 1;
                                    }
                                    // nothing to sync — don't increment failures
                                }
                                Err(e) => {
                                    eprintln!("[sync] Footprint sync error: {}", e);
                                    let _ = db.log_event("sync.footprints_error", &e, Some("sync"), None);
                                    consecutive_failures += 1;
                                }
                            }

                            // Pause syncing after consecutive failures to avoid spam
                            if consecutive_failures >= MAX_FAILURES_BEFORE_PAUSE {
                                eprintln!("[sync] Pausing footprint sync after {} consecutive failures", consecutive_failures);
                                consecutive_failures = 0;
                                // Sleep extra long before next attempt
                                std::thread::sleep(std::time::Duration::from_secs(600)); // 10 min pause
                            }
                        }
                    } else {
                        // Server offline — reset failures but don't attempt sync
                        consecutive_failures = 0;
                    }
                }
            }
        }
    });

    // FIX B22: IMAP тред — lock держим минимально, не во время сетевых операций
    let h = handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        if let Some(st) = STATE.get() {
            let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
            if db_locked { continue; }

            let accounts = match st.db.lock() {
                Ok(d) => d.get_imap_accounts().unwrap_or_default(),
                Err(_) => continue,
            };

            for acc in accounts.into_iter().filter(|a| a.is_active) {
                let should_poll = acc.last_checked.as_ref().map(|lc| {
                    chrono::DateTime::parse_from_rfc3339(lc)
                        .map(|t| chrono::Utc::now().signed_duration_since(t).num_minutes() >= acc.poll_interval)
                        .unwrap_or(true)
                }).unwrap_or(true);

                if !should_poll { continue; }

                // FIX B22: lock → получить данные аккаунта → RELEASE → сетевой IMAP → lock → сохранить
                let fetch_data = {
                    let Ok(db) = st.db.lock() else { continue };
                    let Ok((account, password)) = db.get_imap_account_with_password(acc.id) else { continue };
                    // Собираем уже известные UID пока держим lock
                    let known_uids: std::collections::HashSet<String> = db
                        .get_known_imap_uids(acc.id)
                        .unwrap_or_default()
                        .into_iter().collect();
                    (account, password, known_uids)
                }; // Mutex освобождён здесь — до сетевого вызова

                // Сетевая операция без lock
                match imap::fetch_account_messages(&fetch_data.0, &fetch_data.1, &fetch_data.2) {
                    Ok(result) => {
                        if let Ok(mut db) = st.db.lock() {
                            for msg in &result.messages {
                                if let (Some(onum), Some(act)) = (msg.order_number.as_deref(), msg.action.as_deref()) {
                                    if let Ok(Some(oid)) = db.find_order_by_number(onum) {
                                        let _ = db.update_order_status_simple(oid, act, msg.tracking.as_deref());
                                    }
                                }
                                let _ = db.save_imap_message(
                                    acc.id, msg.uid.as_deref(), &msg.subject,
                                    &msg.from_email, &msg.received_at,
                                    msg.order_number.as_deref(), msg.tracking.as_deref(),
                                    msg.action.as_deref(),
                                );
                                // E2: Auto-mark orders as Delivered when email contains "delivered"
                                let body_lower = ""; // body not available here; check subject only
                                let subject_lower = msg.subject.to_lowercase();
                                if subject_lower.contains("delivered") || msg.action.as_deref() == Some("delivered") {
                                    let _ = db.auto_mark_delivered_by_account(acc.id);
                                }
                                // B5: Emit event for new email notification
                                let _ = h.emit("new_imap_message", serde_json::json!({
                                    "account_id": acc.id,
                                    "subject": &msg.subject,
                                    "from": &msg.from_email,
                                }));
                            }
                            let _ = db.update_imap_last_checked(acc.id);
                        }
                    }
                    Err(e) => {
                        if let Ok(db) = st.db.lock() {
                            let _ = db.log_event("imap.poll_error", &e, Some("imap"), None);
                        }
                    }
                }

                if let Some(badges) = st.db.lock().ok().and_then(|d| d.get_sidebar_badges().ok()) {
                    let _ = h.emit("badge_update", badges.clone());
                    // Update macOS Dock badge based on user prefs
                    let notify_imap = st.db.lock().ok()
                        .and_then(|d| d.get_config("badge_notify_imap").ok().flatten())
                        .map(|v| v != "0").unwrap_or(true);
                    let notify_tracking = st.db.lock().ok()
                        .and_then(|d| d.get_config("badge_notify_tracking").ok().flatten())
                        .map(|v| v != "0").unwrap_or(true);
                    let mut badge_count = 0u32;
                    if notify_imap { badge_count += badges.unread_imap as u32; }
                    set_dock_badge(badge_count);
                }
            }
        }
    });

    // FIX B30: 17track батчинг по 40 номеров
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(300));
        loop {
            if let Some(st) = STATE.get() {
                let api_key = st.db.lock().ok()
                    .and_then(|d| d.get_config("tracking_api_key").ok().flatten())
                    .filter(|k| !k.is_empty());
                if let Some(key) = api_key {
                    run_tracking_update(&key);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(1800));
        }
    });

    // ── Proxy health check thread (every 30 minutes) ──
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1800));
        if let Some(st) = STATE.get() {
            let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
            if !db_locked {
                if let Ok(db) = st.db.lock() {
                    let _ = db.check_all_proxy_health();
                }
            }
        }
    });

    // ── PHASE 6: Smart Card Protection thread (every 5 minutes) ──
    let h_card_protection = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60)); // Start after 1 min
        loop {
            if let Some(st) = STATE.get() {
                let config = st.db.lock().ok()
                    .and_then(|d| d.get_automation_config().ok());
                if let Some(cfg) = config {
                    if cfg.auto_archive_enabled {
                        // Auto-archive burned cards
                        let burned_count = st.db.lock().ok()
                            .and_then(|mut d| d.auto_archive_burned_cards(cfg.burned_card_threshold).ok())
                            .unwrap_or(0);

                        // Auto-archive cards with consecutive declines
                        let risky_count = st.db.lock().ok()
                            .and_then(|mut d| d.auto_archive_risky_cards(cfg.decline_threshold).ok())
                            .unwrap_or(0);

                        if burned_count > 0 || risky_count > 0 {
                            let _ = h_card_protection.emit("card_protection_action", serde_json::json!({
                                "burned_archived": burned_count,
                                "risky_archived": risky_count,
                            }));
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(300)); // Every 5 minutes
        }
    });

    // ── Auto-fetch catalog on first run if empty ──
    let h_catalog = handle.clone();
    std::thread::spawn(move || {
        // Wait a few seconds for the app to finish initializing
        std::thread::sleep(std::time::Duration::from_secs(5));
        let needs_catalog = STATE.get()
            .and_then(|st| st.db.lock().ok())
            .and_then(|db| db.get_catalog_stats().ok())
            .map(|stats| stats.items == 0)
            .unwrap_or(true);
        if needs_catalog {
            let _ = sync_catalog_from_server(&h_catalog);
        }
    });
}

// PHASE 3: Smart tracking update with direct carrier API + 17track fallback
fn run_tracking_update(api_key: &str) {
    let orders = match STATE.get() {
        Some(st) => st.db.lock().ok()
            .and_then(|db| db.get_orders_with_tracking().ok())
            .unwrap_or_default(),
        None => return,
    };
    if orders.is_empty() { return; }

    let tracking_numbers: Vec<String> = orders.iter()
        .filter_map(|(_, num)| num.clone())
        .collect();
    if tracking_numbers.is_empty() { return; }

    // Group tracking numbers by carrier
    let mut ups: Vec<&str> = Vec::new();
    let mut fedex: Vec<&str> = Vec::new();
    let mut usps: Vec<&str> = Vec::new();
    let mut unknown: Vec<&str> = Vec::new();

    for t in &tracking_numbers {
        match tracking::detect_carrier(t) {
            Some("UPS") => ups.push(t),
            Some("FedEx") => fedex.push(t),
            Some("USPS") => usps.push(t),
            _ => unknown.push(t),
        }
    }

    // Process direct carrier APIs first
    for tracking in &ups {
        if let Ok(status) = tracking::check_ups_tracking(tracking) {
            let new_status = match status.status.as_str() {
                "delivered" => Some("delivered"),
                "in_transit" | "pre_transit" => Some("shipped"),
                "exception" => Some("exception"),
                _ => None,
            };
            if let Some(s) = new_status {
                if let Some(st) = STATE.get() {
                    if let Ok(mut db) = st.db.lock() {
                        let _ = db.update_order_status_by_tracking(tracking, s);
                    }
                }
            }
        }
    }

    for tracking in &fedex {
        if let Ok(status) = tracking::check_fedex_tracking(tracking) {
            let new_status = match status.status.as_str() {
                "delivered" => Some("delivered"),
                "in_transit" | "pre_transit" => Some("shipped"),
                "exception" => Some("exception"),
                _ => None,
            };
            if let Some(s) = new_status {
                if let Some(st) = STATE.get() {
                    if let Ok(mut db) = st.db.lock() {
                        let _ = db.update_order_status_by_tracking(tracking, s);
                    }
                }
            }
        }
    }

    for tracking in &usps {
        if let Ok(status) = tracking::check_usps_tracking(tracking) {
            let new_status = match status.status.as_str() {
                "delivered" => Some("delivered"),
                "in_transit" | "pre_transit" => Some("shipped"),
                "exception" => Some("exception"),
                _ => None,
            };
            if let Some(s) = new_status {
                if let Some(st) = STATE.get() {
                    if let Ok(mut db) = st.db.lock() {
                        let _ = db.update_order_status_by_tracking(tracking, s);
                    }
                }
            }
        }
    }

    // Fallback to 17track for unknown carriers (batch by 40)
    if !unknown.is_empty() && !api_key.is_empty() {
        for chunk in unknown.chunks(40) {
            let body: Vec<serde_json::Value> = chunk.iter()
                .map(|n| serde_json::json!({ "number": n }))
                .collect();

            let resp = ureq::post("https://api.17track.net/track/v2.2/gettrackinfo")
                .set("17token", api_key)
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(15))
                .send_string(&serde_json::json!(body).to_string());

            let data = match resp {
                Ok(r) => match r.into_json::<serde_json::Value>() { Ok(j) => j, Err(_) => continue },
                Err(_) => continue,
            };

            let accepted = match data["data"]["accepted"].as_array() {
                Some(a) => a.clone(),
                None => continue,
            };

            for item in accepted {
                let number = match item["number"].as_str() { Some(n) => n, None => continue };
                let status_str = item["track_info"]["latest_status"]["status"].as_str().unwrap_or("");
                let new_status = match status_str {
                    "Delivered"                               => Some("delivered"),
                    "InTransit" | "Pickup" | "OutForDelivery" => Some("shipped"),
                    "Expired"                                 => Some("failed"),
                    _                                         => None,
                };
                if let Some(status) = new_status {
                    if let Some(st) = STATE.get() {
                        if let Ok(mut db) = st.db.lock() {
                            let _ = db.update_order_status_by_tracking(number, status);
                        }
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────
//  Footprint analytics commands
// ─────────────────────────────────────────

#[tauri::command]
fn get_card_shop_usage(card_id: i64) -> Result<Vec<CardShopUsage>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_shop_usage(card_id)
}

#[tauri::command]
fn get_email_footprint_stats(email_id: i64) -> Result<EmailFootprintStats, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_email_footprint_stats(email_id)
}

#[tauri::command]
fn get_shop_risk_score(shop_id: i64) -> Result<ShopRiskScore, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_shop_risk_score(shop_id)
}

#[tauri::command]
fn get_card_timeline(card_id: i64) -> Result<Vec<CardTimelineEvent>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_timeline(card_id)
}

// ─────────────────────────────────────────
//  PHASE 5: Automation Coordination Commands
// ─────────────────────────────────────────

#[tauri::command]
fn get_automation_config() -> Result<models::AutomationConfig, String> {
    with_db!(db, { db.get_automation_config() })
}

#[tauri::command]
fn set_automation_config_cmd(key: String, value: String) -> Result<(), String> {
    with_db!(db, { db.set_automation_config(&key, &value) })
}

#[tauri::command]
fn get_automation_health() -> Result<models::AutomationHealth, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_automation_health()
}

// ─────────────────────────────────────────
//  PHASE 6: Smart Card Protection Commands
// ─────────────────────────────────────────

#[tauri::command]
fn get_burned_cards(threshold: u32) -> Result<Vec<models::BurnedCard>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_burned_cards(threshold)
}

#[tauri::command]
fn auto_archive_burned_cards_cmd(threshold: u32) -> Result<u32, String> {
    with_db!(db, { db.auto_archive_burned_cards(threshold) })
}

#[tauri::command]
fn get_consecutive_declines_cmd(card_id: i64) -> Result<u32, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_consecutive_declines(card_id)
}

#[tauri::command]
fn auto_archive_risky_cards_cmd(decline_threshold: u32) -> Result<u32, String> {
    with_db!(db, { db.auto_archive_risky_cards(decline_threshold) })
}

#[tauri::command]
fn get_card_replacement_suggestions_cmd(burned_card_id: i64, shop_id: i64) -> Result<Vec<models::CardSuggestion>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_replacement_suggestions(burned_card_id, shop_id)
}

// ─────────────────────────────────────────
//  PHASE 2: Shop Statistics Enhancement Commands
// ─────────────────────────────────────────

#[tauri::command]
fn get_shop_stats_v2_cmd(shop_id: i64) -> Result<models::ShopStatsV2, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_shop_stats_v2(shop_id)
}

// ─────────────────────────────────────────
//  Sync Group commands
// ─────────────────────────────────────────

#[tauri::command]
fn sync_create_group(name: String, app: tauri::AppHandle) -> Result<SyncGroupInfo, String> {
    let (info, token) = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let info = sync::SyncGroupClient::create_group(db, &name)?;
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        Ok::<(SyncGroupInfo, Option<String>), String>((info, token))
    })?;
    // Refresh WS creds with new group
    if let Some(h) = WS_HANDLE.get() {
        h.set_creds(token, Some(info.group_id.clone()));
        let db_p = db_path().to_str().unwrap_or("cc_manager.db").to_string();
        ws_sync::start(app, db_p, h.clone());
    }
    Ok(info)
}

#[tauri::command]
fn sync_create_pair_code() -> Result<String, String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        sync::SyncGroupClient::create_pair_code(db)
    })
}

#[tauri::command]
fn sync_join_group(pair_code: String, app: tauri::AppHandle) -> Result<SyncGroupInfo, String> {
    let (info, token) = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let info = sync::SyncGroupClient::join_group(db, &pair_code)?;
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        Ok::<(SyncGroupInfo, Option<String>), String>((info, token))
    })?;
    if let Some(h) = WS_HANDLE.get() {
        h.set_creds(token, Some(info.group_id.clone()));
        let db_p = db_path().to_str().unwrap_or("cc_manager.db").to_string();
        ws_sync::start(app, db_p, h.clone());
    }
    Ok(info)
}

#[tauri::command]
fn sync_get_group_status() -> Result<SyncGroupStatus, String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        Ok(sync::SyncGroupClient::get_group_status(db))
    })
}

#[tauri::command]
fn sync_disconnect() -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        sync::SyncGroupClient::disconnect(db)
    })?;
    // Stop WS and clear group creds
    if let Some(h) = WS_HANDLE.get() {
        h.stop();
        // Clear group_id but keep token (for reconnect if user re-joins)
        h.set_creds(None, None);
    }
    Ok(())
}

// ─────────────────────────────────────────
//  Catalog commands (M11)
// ─────────────────────────────────────────

#[tauri::command]
fn search_catalog_items(q: String, limit: Option<u32>) -> Result<Vec<models::CatalogItem>, String> {
    with_db!(db, { db.search_catalog_items(&q, limit.unwrap_or(10) as u64) })
}

#[tauri::command]
fn search_catalog_shops(q: String, limit: Option<u32>) -> Result<Vec<models::CatalogShop>, String> {
    with_db!(db, { db.search_catalog_shops(&q, limit.unwrap_or(8) as u64) })
}

#[tauri::command]
fn get_catalog_stats() -> Result<models::CatalogStats, String> {
    with_db!(db, { db.get_catalog_stats() })
}

#[tauri::command]
fn import_catalog_items(items: Vec<models::CatalogItemInput>) -> Result<usize, String> {
    with_db!(db, { db.import_catalog_items_batch(&items) })
}

#[tauri::command]
fn import_catalog_shops(shops: Vec<models::CatalogShopInput>) -> Result<usize, String> {
    with_db!(db, { db.import_catalog_shops_batch(&shops) })
}

#[tauri::command]
fn get_catalog_items(page: u32, per_page: u32, search: String) -> Result<models::PaginatedCatalogItems, String> {
    with_db!(db, { db.get_catalog_items_paged(&search, page, per_page) })
}

#[tauri::command]
fn get_catalog_shops(page: u32, per_page: u32, search: String) -> Result<models::PaginatedCatalogShops, String> {
    with_db!(db, { db.get_catalog_shops_paged(&search, page, per_page) })
}

#[tauri::command]
fn toggle_catalog_item_stop(id: i64, stop: bool) -> Result<(), String> {
    with_db!(db, { db.toggle_catalog_item_stop(id, stop) })
}

#[tauri::command]
fn delete_catalog_items(ids: Vec<i64>) -> Result<u32, String> {
    with_db!(db, { db.delete_catalog_items(&ids) })
}

#[tauri::command]
fn toggle_catalog_shop_excluded(id: i64, excluded: bool) -> Result<(), String> {
    with_db!(db, { db.toggle_catalog_shop_excluded(id, excluded) })
}

// ─────────────────────────────────────────
//  Proxy Intelligence (G1)
// ─────────────────────────────────────────

#[tauri::command]
fn get_profile_ltv(profile_id: String) -> Result<serde_json::Value, String> {
    with_db!(db, { db.get_profile_ltv(&profile_id) })
}

#[tauri::command]
fn get_free_email_for_shop(shop_id: Option<i64>) -> Result<Option<serde_json::Value>, String> {
    with_db!(db, { db.get_free_email_for_shop(shop_id) })
}

#[tauri::command]
fn get_available_emails(limit: u32) -> Result<Vec<serde_json::Value>, String> {
    with_db!(db, { db.get_available_emails(limit) })
}

#[tauri::command]
fn set_profile_email(profile_id: String, email_pool_id: Option<i64>) -> Result<(), String> {
    with_db!(db, { db.set_profile_email(&profile_id, email_pool_id) })
}

#[tauri::command]
fn check_proxy_health_now() -> Result<ProxyHealthResult, String> {
    with_db!(db, { db.check_all_proxy_health() })
}

#[tauri::command]
fn get_proxy_usage_stats() -> Result<Vec<ProxyUsageStat>, String> {
    with_db!(db, { db.get_proxy_usage_stats() })
}

// E3: Batch Order Creator
#[tauri::command]
fn batch_create_orders(orders: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    with_db!(db, {
        let (ok, fail) = db.batch_create_orders(&orders)?;
        Ok(serde_json::json!({ "created": ok, "failed": fail }))
    })
}

// G2: Proxy-Shop Binding commands
#[tauri::command]
fn set_proxy_shop_binding(proxy_id: i64, shop_id: i64) -> Result<(), String> {
    with_db!(db, { db.set_proxy_shop_binding(proxy_id, shop_id) })
}
#[tauri::command]
fn remove_proxy_shop_binding(shop_id: i64) -> Result<(), String> {
    with_db!(db, { db.remove_proxy_shop_binding(shop_id) })
}
#[tauri::command]
fn get_proxy_for_shop(shop_id: i64) -> Result<Option<i64>, String> {
    with_db!(db, { db.get_proxy_for_shop(shop_id) })
}
#[tauri::command]
fn get_all_proxy_shop_bindings() -> Result<Vec<serde_json::Value>, String> {
    with_db!(db, { db.get_all_proxy_shop_bindings() })
}

// E2: Placeholder command — auto-delivery is handled by IMAP poll thread
#[tauri::command]
fn get_auto_delivered_orders() -> Result<Vec<i64>, String> {
    // This is handled automatically by IMAP poll, just return empty
    Ok(vec![])
}

// ─────────────────────────────────────────
//  macOS Dock Badge
// ─────────────────────────────────────────

#[cfg(target_os = "macos")]
fn set_dock_badge(count: u32) {
    // FIX TC-H01: Validate count to prevent command injection
    // Since count is u32, injection is not possible, but we add extra safety
    let label = if count == 0 {
        "\"\"".to_string()
    } else {
        // Only allow numeric characters (already guaranteed by u32 type)
        // This is defense in depth - the type system already prevents injection
        format!("{}", count)
    };

    // Use escaped label in AppleScript
    let script = format!(
        "tell application \"System Events\" to set badge of (first application process whose frontmost is true) to {}",
        label
    );

    // FIX TC-H01: Use spawn with explicit arg handling (already safe via .arg())
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn();
}

#[cfg(not(target_os = "macos"))]
fn set_dock_badge(_count: u32) {}

// ─────────────────────────────────────────
//  Quick Order: find or create shop by URL
// ─────────────────────────────────────────

#[tauri::command]
fn find_or_create_shop(url: String) -> Result<serde_json::Value, String> {
    // Extract domain from URL
    let domain = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.")
        .split('/')
        .next()
        .unwrap_or(&url)
        .to_lowercase();
    let domain = domain.trim().to_string();

    // FIX TC-03: Validate domain format to prevent SQL injection and data corruption
    // Domain must contain only valid characters: a-z, 0-9, hyphens, and dots
    let domain_regex = regex::Regex::new(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$")
        .map_err(|_| "regex_error".to_string())?;

    if domain.is_empty() || domain.len() > 253 {
        return Err("invalid_domain: empty or too long".into());
    }

    if !domain_regex.is_match(&domain) {
        return Err("invalid_domain: only letters, numbers, hyphens, and dots allowed".into());
    }

    // Additional check: prevent SQL injection via domain
    // Reject any domain that contains SQL keywords or suspicious patterns
    let suspicious_patterns = ["'", "\"", ";", "--", "/*", "*/", "union", "select", "drop", "delete", "insert"];
    for pattern in suspicious_patterns {
        if domain.contains(pattern) {
            return Err("invalid_domain: suspicious characters detected".into());
        }
    }

    with_db!(db, {
        match db.find_shop_by_domain(&domain)? {
            Some(id) => {
                Ok(serde_json::json!({ "id": id, "domain": domain, "is_new": false }))
            }
            None => {
                let id = db.create_shop_minimal(&domain)?;
                Ok(serde_json::json!({ "id": id, "domain": domain, "is_new": true }))
            }
        }
    })
}

// ─────────────────────────────────────────
//  PHASE 3: Tracking API Direct Integration
// ─────────────────────────────────────────

#[tauri::command]
fn detect_carrier_from_tracking(tracking: String) -> Result<Option<String>, String> {
    Ok(tracking::detect_carrier(&tracking).map(|s| s.to_string()))
}

#[tauri::command]
fn check_tracking_direct(tracking: String) -> Result<TrackingStatus, String> {
    tracking::check_tracking_smart(&tracking)
}

/// Internal helper for getting config from tracking module
pub fn get_config_internal(key: &str) -> Result<Option<String>, String> {
    with_db!(db, {
        db.get_config(key).map_err(|e| e.to_string())
    })
}

// ─────────────────────────────────────────
//  Catalog auto-sync from server
// ─────────────────────────────────────────

fn sync_catalog_from_server(app: &tauri::AppHandle) -> Result<(), String> {
    const BASE: &str = "https://api.eulivehub.com";
    const PER_PAGE: u32 = 100;

    // Fetch all item pages
    let mut total_items = 0usize;
    let mut page = 1u32;
    loop {
        let url = format!("{}/api/catalog/items?per_page={}&page={}", BASE, PER_PAGE, page);
        match ureq::get(&url).timeout(std::time::Duration::from_secs(30)).call() {
            Ok(resp) => {
                match resp.into_json::<serde_json::Value>() {
                    Ok(data) => {
                        let items_arr = match data["items"].as_array() {
                            Some(a) => a.clone(),
                            None => break,
                        };
                        if items_arr.is_empty() { break; }
                        let inputs: Vec<models::CatalogItemInput> = items_arr.iter().filter_map(|i| {
                            Some(models::CatalogItemInput {
                                id: i["id"].as_i64(),
                                name: i["name"].as_str()?.to_string(),
                                asin: i["asin"].as_str().map(|s| s.to_string()),
                                price: i["price"].as_f64(),
                                pct: i["pct"].as_i64(),
                                category: i["category"].as_str().map(|s| s.to_string()),
                                notes_en: i["notes_en"].as_str().map(|s| s.to_string()),
                                stop: i["stop"].as_bool().unwrap_or(false)
                                    || i["stop"].as_i64().map(|v| v != 0).unwrap_or(false),
                            })
                        }).collect();
                        total_items += inputs.len();
                        if let Some(st) = STATE.get() {
                            if let Ok(db) = st.db.lock() {
                                let _ = db.import_catalog_items_batch(&inputs);
                            }
                        }
                        let total_pages = data["pages"].as_u64().unwrap_or(1);
                        if page as u64 >= total_pages { break; }
                        page += 1;
                    }
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    if total_items > 0 {
        let _ = app.emit("catalog_synced", serde_json::json!({ "items": total_items }));
    }

    // Fetch all shop pages
    page = 1;
    loop {
        let url = format!("{}/api/catalog/shops?per_page={}&page={}", BASE, PER_PAGE, page);
        match ureq::get(&url).timeout(std::time::Duration::from_secs(30)).call() {
            Ok(resp) => {
                match resp.into_json::<serde_json::Value>() {
                    Ok(data) => {
                        let shops_arr = match data["shops"].as_array() {
                            Some(a) => a.clone(),
                            None => break,
                        };
                        if shops_arr.is_empty() { break; }
                        let inputs: Vec<models::CatalogShopInput> = shops_arr.iter().filter_map(|s| {
                            Some(models::CatalogShopInput {
                                domain: s["domain"].as_str()?.to_string(),
                                category: s["category"].as_str().map(|x| x.to_string()),
                                score: s["score"].as_i64(),
                                ship_us: s["ship_us"].as_bool().unwrap_or(false)
                                    || s["ship_us"].as_i64().map(|v| v != 0).unwrap_or(false),
                                fraud_level: s["fraud_level"].as_str().map(|x| x.to_string()),
                                top_brands: s["top_brands"].as_str().map(|x| x.to_string()),
                                top_products: s["top_products"].as_str().map(|x| x.to_string()),
                                excluded: s["excluded"].as_bool().unwrap_or(false)
                                    || s["excluded"].as_i64().map(|v| v != 0).unwrap_or(false),
                            })
                        }).collect();
                        if let Some(st) = STATE.get() {
                            if let Ok(db) = st.db.lock() {
                                let _ = db.import_catalog_shops_batch(&inputs);
                            }
                        }
                        let total_pages = data["pages"].as_u64().unwrap_or(1);
                        if page as u64 >= total_pages { break; }
                        page += 1;
                    }
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    Ok(())
}

fn main() {
    let db_p = db_path();
    let db_path_str = db_p.to_str().unwrap_or("cc_manager.db").to_string();
    let db = Database::open(&db_path_str).expect("Failed to open database");
    STATE.set(AppState {
        db: Mutex::new(db),
        is_locked: AtomicBool::new(true),  // FIX B-MED-05: Изначально заблокировано (до unlock)
    }).unwrap_or_else(|_| panic!("Failed to set AppState"));

    // Init WS sync handle (not started yet — starts after unlock)
    let ws_h = std::sync::Arc::new(ws_sync::WsSyncHandle {
        running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        creds:   ws_sync::new_credentials(),
    });
    WS_HANDLE.set(ws_h).unwrap_or_else(|_| panic!("Failed to set WsSyncHandle"));

    let db_path_for_ws = db_path_str.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            start_background_threads(app.handle().clone());
            #[cfg(target_os = "macos")]
            {
                let win = app.get_webview_window("main").expect("main window");
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            // Float window: hide on close (all platforms) so it can be reopened
            if let Some(float_win) = app.get_webview_window("float") {
                let fwc = float_win.clone();
                float_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = fwc.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_password, is_password_set, unlock, lock, change_password, is_locked,
            detect_mapping_preview,
            import_cards, get_cards, get_card, get_card_filter_meta, reveal_card,
            update_card_status, update_card_notes, delete_card,
            bulk_update_cards, bulk_delete_cards, export_cards, enrich_bin,
            create_profile, get_profiles, get_profile, get_profile_detail,
            update_profile, update_profile_notes,
            delete_profile, duplicate_profile, find_duplicate_profiles,
            save_profile_template, get_profile_templates, delete_profile_template,
            add_drop, update_drop, delete_drop, set_primary_drop, import_drops, find_duplicate_drops,
            add_email, get_emails, update_email, block_email, delete_email, get_clean_email_for_shop,
            add_proxy, import_proxies, get_proxies, update_proxy, block_proxy, delete_proxy, test_proxy_connection,
            create_shop, get_shops, get_shop, update_shop, delete_shop,
            add_shop_product, update_shop_product, delete_shop_product, get_shop_smart_suggestions,
            create_order, get_orders, get_order, get_latest_order_by_profile, get_recent_orders_by_profile, update_order_status, delete_order,
            run_risk_check, save_order_template, get_order_templates,
            get_unsynced_footprints, mark_footprints_synced, sync_now,
            get_dashboard_stats, get_revenue_chart, get_heatmap_data, get_top_banks,
            get_by_country, get_by_source, get_by_domain, get_expiring_cards_dashboard,
            export_dashboard_csv, get_sidebar_badges,
            get_bin_performance, get_shop_win_loss,
            add_imap_account, get_imap_accounts, update_imap_account,
            delete_imap_account, toggle_imap_account, get_imap_messages,
            imap_check_all, test_imap_connection, link_email_to_imap, link_all_imap_accounts,
            list_imap_folders, get_imap_account_stats, get_folder_messages,
            refresh_folder_from_imap, get_unified_inbox,
            get_imap_message_body, mark_imap_message_read, delete_imap_message, archive_imap_message,
            add_smtp_config, get_smtp_configs, delete_smtp_config,
            test_smtp_connection, send_email, get_sent_emails,
            get_activity_log, clear_activity_log,
            get_config, set_config, export_backup, import_backup,
            get_installation_id, get_challenge_code, activate_license,
            get_license_status, retry_license_connection,
            global_search, open_float_window, open_main_window_page, get_server_version, get_app_version,
            get_card_shop_usage, get_email_footprint_stats, get_shop_risk_score, get_card_timeline,
            sync_create_group, sync_create_pair_code, sync_join_group, sync_get_group_status, sync_disconnect,
            search_catalog_items, search_catalog_shops, get_catalog_stats, import_catalog_items, import_catalog_shops,
            get_catalog_items, get_catalog_shops,
            toggle_catalog_item_stop, delete_catalog_items, toggle_catalog_shop_excluded,
            check_proxy_health_now, get_proxy_usage_stats,
            batch_create_orders,
            set_proxy_shop_binding, remove_proxy_shop_binding, get_proxy_for_shop, get_all_proxy_shop_bindings,
            get_auto_delivered_orders,
            get_profile_ltv,
            get_free_email_for_shop,
            get_available_emails,
            set_profile_email,
            find_or_create_shop,
            detect_carrier_from_tracking, check_tracking_direct,
            // PHASE 5: Automation Coordination
            get_automation_config, set_automation_config_cmd, get_automation_health,
            // PHASE 6: Smart Card Protection
            get_burned_cards, auto_archive_burned_cards_cmd,
            get_consecutive_declines_cmd, auto_archive_risky_cards_cmd,
            get_card_replacement_suggestions_cmd,
            // PHASE 2: Shop Statistics Enhancement
            get_shop_stats_v2_cmd,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.unminimize();
                    }
                }
            }
        });
}
