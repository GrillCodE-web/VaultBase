// Tauri commands: auth domain.
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
pub(crate) fn user_login(username: String, password: String, ip_address: Option<String>, device_info: Option<String>) -> Result<LoginResult, String> {
    let start_time = std::time::Instant::now();
    
    // SPRINT3-DAY2: Log login attempt
    tracing::debug!(
        event_type = "auth",
        action = "login_attempt",
        username = %username,
        ip_address = ?ip_address,
        "User login attempt"
    );
    
    // SPRINT3-DAY4: Use config-based rate limits
    let config = &state().config;
    let rate_limit_result = rate_limiter::check_rate_limit_with_config(
        rate_limiter::RateLimitCategory::Strict, 
        rate_limiter::get_rate_limit_key("user_login"),
        (config.security.rate_limit_strict, config.security.rate_limit_moderate, config.security.rate_limit_lenient)
    );
    
    if let Err(e) = rate_limit_result {
        // SPRINT3-DAY2: Log rate limit violation
        tracing::warn!(
            event_type = "security",
            action = "rate_limit_exceeded",
            username = %username,
            ip_address = ?ip_address,
            error = %e,
            rate_limit = config.security.rate_limit_strict,
            "Login rate limit exceeded"
        );
        return Err(e);
    }
    
    let result = with_db!(db, {
        db.user_login(&username, &password, ip_address.as_deref(), device_info.as_deref())
    });
    
    match result {
        Ok(login_result) => {
            let duration = start_time.elapsed();
            
            // SPRINT3-DAY2: Log successful login
            tracing::info!(
                event_type = "auth",
                action = "login_success",
                user_id = %login_result.user_id,
                username = %username,
                role = %login_result.role,
                ip_address = ?ip_address,
                duration_ms = duration.as_millis() as u64,
                "User logged in successfully"
            );
            
            // Save to AppState
            let active = ActiveUser {
                user_id: login_result.user_id,
                username: login_result.username.clone(),
                role: login_result.role.clone(),
                permissions: login_result.permissions.clone(),
                token: login_result.token.clone(),
                ip_address: ip_address.clone(),
            };
            if let Ok(mut u) = state().current_user.lock() { *u = Some(active); }
            Ok(login_result)
        },
        Err(e) => {
            let duration = start_time.elapsed();
            
            // SPRINT3-DAY2: Log failed login
            tracing::warn!(
                event_type = "security",
                action = "login_failed",
                username = %username,
                ip_address = ?ip_address,
                error = %e,
                duration_ms = duration.as_millis() as u64,
                "User login failed"
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub(crate) fn try_auto_login(ip_address: Option<String>, device_info: Option<String>) -> Result<Option<LoginResult>, String> {
    let result = with_db!(db, {
        db.try_auto_login(ip_address.as_deref(), device_info.as_deref())
    })?;
    if let Some(ref r) = result {
        let active = ActiveUser {
            user_id: r.user_id,
            username: r.username.clone(),
            role: r.role.clone(),
            permissions: r.permissions.clone(),
            token: r.token.clone(),
            ip_address: ip_address.clone(),
        };
        if let Ok(mut u) = state().current_user.lock() { *u = Some(active); }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn user_logout(token: String) -> Result<(), String> {
    with_db!(db, { db.user_logout(&token) })?;
    if let Ok(mut u) = state().current_user.lock() { *u = None; }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_current_user() -> Result<Option<LoginResult>, String> {
    let u = state().current_user.lock().map_err(|e| e.to_string())?;
    Ok(u.as_ref().map(|u| LoginResult {
        token: u.token.clone(),
        user_id: u.user_id,
        username: u.username.clone(),
        display_name: None,
        role: u.role.clone(),
        permissions: u.permissions.clone(),
    }))
}

#[tauri::command]
pub(crate) fn resume_session(token: String) -> Result<LoginResult, String> {
    let result = with_db!(db, {
        db.get_active_user_by_token(&token).ok_or("session_expired".to_string())
    })?;
    let login = LoginResult {
        token: result.token.clone(),
        user_id: result.user_id,
        username: result.username.clone(),
        display_name: None,
        role: result.role.clone(),
        permissions: result.permissions.clone(),
    };
    if let Ok(mut u) = state().current_user.lock() { *u = Some(result); }
    Ok(login)
}

#[tauri::command]
pub(crate) fn get_users() -> Result<Vec<User>, String> {
    require_admin()?;
    with_db!(db, { db.get_users() })
}

#[tauri::command]
pub(crate) fn create_user(input: CreateUserInput) -> Result<User, String> {
    let admin = require_admin()?;
    let new_user = with_db!(db, { db.create_user(&input, admin.user_id) })?;
    with_db!(db, {
        db.log_user_activity(admin.user_id, "user.created", Some("user"),
            Some(&new_user.id.to_string()), Some(&format!("username={}", new_user.username)), admin.ip_address.as_deref())
    })?;
    Ok(new_user)
}

#[tauri::command]
pub(crate) fn update_user_cmd(id: i64, display_name: Option<String>, is_active: bool, role: Option<String>) -> Result<(), String> {
    require_admin()?;
    with_db!(db, { db.update_user(id, display_name.as_deref(), is_active, role.as_deref()) })
}

#[tauri::command]
pub(crate) fn delete_user_cmd(id: i64) -> Result<(), String> {
    let admin = require_admin()?;
    if admin.user_id == id { return Err("cannot_delete_self".into()); }
    with_db!(db, { db.delete_user(id) })
}

#[tauri::command]
pub(crate) fn set_user_password_cmd(id: i64, new_password: String) -> Result<(), String> {
    require_admin()?;
    with_db!(db, { db.set_user_password(id, &new_password) })
}

#[tauri::command]
pub(crate) fn get_user_with_permissions(id: i64) -> Result<UserWithPermissions, String> {
    require_admin()?;
    with_db!(db, { db.get_user_with_permissions(id) })
}

#[tauri::command]
pub(crate) fn set_user_permission_cmd(user_id: i64, key: String, granted: bool) -> Result<(), String> {
    let admin = require_admin()?;
    with_db!(db, {
        db.set_user_permission(user_id, &key, granted)?;
        db.log_user_activity(admin.user_id, "user.permission_set", Some("user"),
            Some(&user_id.to_string()), Some(&format!("{}={}", key, granted)), None)
    })
}

#[tauri::command]
pub(crate) fn reset_user_permissions_cmd(user_id: i64) -> Result<(), String> {
    require_admin()?;
    with_db!(db, { db.reset_user_permissions(user_id) })
}

#[tauri::command]
pub(crate) fn get_users_stats() -> Result<Vec<UserStats>, String> {
    require_admin()?;
    with_db!(db, { db.get_users_stats() })
}

#[tauri::command]
pub(crate) fn get_user_period_stats(user_id: i64) -> Result<Vec<UserPeriodStats>, String> {
    require_admin()?;
    with_db!(db, { db.get_user_period_stats(user_id) })
}

#[tauri::command]
pub(crate) fn get_user_activity_log(user_id: Option<i64>, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<UserActivity>, String> {
    require_admin()?;
    with_db!(db, { db.get_user_activity_log(user_id, limit.unwrap_or(100), offset.unwrap_or(0)) })
}

#[tauri::command]
pub(crate) fn get_admin_overview() -> Result<AdminOverview, String> {
    require_admin()?;
    with_db!(db, { db.get_admin_overview() })
}

#[tauri::command]
#[allow(non_snake_case)]
pub(crate) fn change_own_password(currentPassword: String, newPassword: String) -> Result<(), String> {
    let user = require_user()?;
    with_db!(db, {
        db.change_own_password(user.user_id, &currentPassword, &newPassword)?;
        db.log_user_activity(user.user_id, "user.password_changed", Some("user"),
            Some(&user.user_id.to_string()), None, user.ip_address.as_deref())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub(crate) fn get_full_audit_log(userId: Option<i64>, actionType: Option<String>, limit: Option<u32>, offset: Option<u32>) -> Result<Vec<UserActivity>, String> {
    require_admin()?;
    with_db!(db, { db.get_user_activity_log_filtered(userId, actionType.as_deref(), limit.unwrap_or(100), offset.unwrap_or(0)) })
}

#[tauri::command]
pub(crate) fn get_online_sessions() -> Result<Vec<UserSession>, String> {
    require_admin()?;
    with_db!(db, { db.get_online_sessions() })
}

#[tauri::command]
#[allow(non_snake_case)]
pub(crate) fn revoke_session(sessionId: i64) -> Result<(), String> {
    let admin = require_admin()?;
    with_db!(db, {
        db.revoke_session(sessionId)?;
        db.log_user_activity(admin.user_id, "user.session_revoked", Some("session"),
            Some(&sessionId.to_string()), None, admin.ip_address.as_deref())
    })
}

#[tauri::command]
pub(crate) fn take_card(card_id: i64) -> Result<(), String> {
    let user = require_perm(models::perms::TAKE_CARDS)?;
    with_db!(db, {
        db.assign_card_to_user(card_id, user.user_id, Some(user.user_id))
    })
}

#[tauri::command]
pub(crate) fn transfer_card_cmd(card_id: i64, to_user_id: i64) -> Result<(), String> {
    let user = require_perm(models::perms::TRANSFER_CARDS)?;
    with_db!(db, {
        db.transfer_card(card_id, to_user_id, user.user_id)
    })
}

#[tauri::command]
pub(crate) fn get_my_card_assignments() -> Result<Vec<CardAssignment>, String> {
    let user = require_user()?;
    with_db!(db, { db.get_user_card_assignments(user.user_id) })
}

#[tauri::command]
pub(crate) fn setup_password(password: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting вЂ” 5 attempts per minute to prevent brute-force
    // SPRINT3-DAY4: Use config-based rate limits
    let config = &state().config;
    rate_limiter::check_rate_limit_with_config(
        rate_limiter::RateLimitCategory::Strict,
        rate_limiter::get_rate_limit_key("setup_password"),
        (config.security.rate_limit_strict, config.security.rate_limit_moderate, config.security.rate_limit_lenient)
    )?;
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
pub(crate) fn is_password_set() -> Result<bool, String> {
    with_db!(db, {
        Ok(db.get_config("master_password_hash")
            .map_err(|e| e.to_string())?
            .map(|v| !v.is_empty())
            .unwrap_or(false))
    })
}

#[tauri::command]
pub(crate) fn unlock(password: String, app: tauri::AppHandle) -> Result<(), String> {
    // FIX TC-H03: Rate limiting вЂ” 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_limiter::get_rate_limit_key("unlock"))?;
    let (token, group_id) = with_db!(db, {
        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&password, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }

        // FIX B-MED-07: РђРІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ РјРёРіСЂР°С†РёСЏ bcrypt cost factor.
        // Р¤РѕСЂРјР°С‚ С…РµС€Р°: `$2b$XX$...`, РіРґРµ XX вЂ” cost РёР· Р”Р’РЈРҐ С†РёС„СЂ РЅР° РїРѕР·РёС†РёСЏС… 4..6.
        // Р‘С‹Р» СЃСЂРµР· hash[4..7] вЂ” РѕРЅ Р·Р°С…РІР°С‚С‹РІР°Р» С‚СЂРµС‚РёР№ СЃРёРјРІРѕР» `$`, РґР°РІР°Р» "12$",
        // parse::<u32>() РїР°РґР°Р», Р° .unwrap_or(false)РіР°СЃРёР» РѕС€РёР±РєСѓ: СѓСЃР»РѕРІРёРµ РІСЃРµРіРґР°
        // Р±С‹Р»Рѕ false Рё РјРёРіСЂР°С†РёСЏ РЅРµ РѕС‚СЂР°Р±РѕС‚Р°Р»Р° РќР Р РђР—РЈ СЃ РјРѕРјРµРЅС‚Р° РЅР°РїРёСЃР°РЅРёСЏ.
        // РџРѕСЌС‚РѕРјСѓ Р¶Рµ СЃС‡С‘С‚ В«119 СѓСЏР·РІРёРјРѕСЃС‚РµР№ РёСЃРїСЂР°РІР»РµРЅРѕВ» Р·Р°РІС‹С€РµРЅ РјРёРЅРёРјСѓРј РЅР° РѕРґРЅСѓ.
        let parsed_cost = if hash.starts_with("$2b$") && hash.len() > 7 {
            hash[4..6].parse::<u32>().ok()
        } else {
            None
        };
        // РќРµСЂР°СЃРїРѕР·РЅР°РЅРЅС‹Р№ С„РѕСЂРјР°С‚ Р»РѕРіРёСЂСѓРµРј, Р° РЅРµ РїСЂРѕРіР»Р°С‚С‹РІР°РµРј: РјРѕР»С‡Р°Р»РёРІС‹Р№
        // .unwrap_or(false) Рё Р±С‹Р» РїСЂРёС‡РёРЅРѕР№ С‚РѕРіРѕ, С‡С‚Рѕ Р±Р°Рі Р¶РёР» РЅРµР·Р°РјРµС‡РµРЅРЅС‹Рј.
        if parsed_cost.is_none() && hash.starts_with("$2b$") {
            eprintln!("[bcrypt] cannot parse cost from hash prefix, upgrade skipped");
        }

        if parsed_cost.is_some_and(|c| c < 14) {
            // Р Рµ-С…РµС€РёСЂСѓРµРј СЃ РЅРѕРІС‹Рј cost factor
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

    // FIX B-MED-05: РЎР±СЂР°СЃС‹РІР°РµРј Р°С‚РѕРјР°СЂРЅС‹Р№ С„Р»Р°Рі РїРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕРіРѕ unlock
    if let Some(st) = STATE.get() {
        st.is_locked.store(false, Ordering::Relaxed);
    }

    // Start WS sync in background (non-blocking)
    if let Some(h) = WS_HANDLE.get() {
        h.set_creds(token, group_id);
        ws_sync::start(app, h.clone());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn lock() -> Result<(), String> {
    // SPRINT3-DAY2: Log lock event
    tracing::info!(
        event_type = "auth",
        action = "lock",
        "Database locked by user"
    );
    
    with_db!(db, {
        db.clear_encryption();
        let _ = db.log_event("system.locked", "Database locked", Some("system"), None);
        Ok::<(), String>(())
    })?;
    // FIX B-MED-05: Atomically set lock flag
    if let Some(st) = STATE.get() {
        st.is_locked.store(true, Ordering::Relaxed);
    }
    // Stop WS sync
    if let Some(h) = WS_HANDLE.get() {
        h.stop();
        h.set_creds(None, None);
    }
    
    tracing::info!("Lock completed successfully");
    Ok(())
}

#[tauri::command]
pub(crate) fn is_locked() -> Result<bool, String> {
    Ok(state().db.lock().map_err(|e| e.to_string())?.is_locked())
}

#[tauri::command]
pub(crate) fn change_password(old: String, new: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting вЂ” 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_limiter::get_rate_limit_key("change_password"))?;
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
        // РЎРЅР°С‡Р°Р»Р° РѕР±РЅРѕРІР»СЏРµРј РјРµС‚Р°РґР°РЅРЅС‹Рµ, РїРѕС‚РѕРј С€РёС„СЂСѓРµРј РґР°РЅРЅС‹Рµ.
        // РџСЂРё crash РїРѕСЃР»Рµ set_config РЅРѕ РґРѕ reencrypt_all вЂ” РґР°РЅРЅС‹Рµ РІСЃС‘ РµС‰С‘
        // С‡РёС‚Р°СЋС‚СЃСЏ СЃС‚Р°СЂС‹Рј РєР»СЋС‡РѕРј, РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РјРѕР¶РµС‚ Р·Р°Р»РѕРіРёРЅРёС‚СЊСЃСЏ СЃС‚Р°СЂС‹Рј РїР°СЂРѕР»РµРј.
        // Р­С‚Рѕ Р»СѓС‡С€Рµ С‡РµРј РѕР±СЂР°С‚РЅС‹Р№ РїРѕСЂСЏРґРѕРє РіРґРµ crash РѕСЃС‚Р°РІР»СЏРµС‚ Р‘Р” РЅРµС‡РёС‚Р°РµРјРѕР№.
        // FIX B24: РїРµСЂРµС€РёС„СЂРѕРІС‹РІР°РµРј license_token С‚РѕР¶Рµ (С‡РµСЂРµР· reencrypt_all)
        db.set_config("master_password_hash", &new_hash).map_err(|e| e.to_string())?;
        db.set_config("encryption_salt", &new_salt_b64).map_err(|e| e.to_string())?;
        db.reencrypt_all(&old_enc, &new_enc)?;
        // FIX B24: РїРµСЂРµС€РёС„СЂРѕРІР°С‚СЊ license_token
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