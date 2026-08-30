// Tauri commands: auth domain.
// Extracted from main.rs during module refactor.

use crate::state::*;
use crate::models::*;
use crate::database::{Database, fetch_bin_info};
use crate::models;
use crate::encryption::{FieldEncryption, PasswordValidation, generate_salt, derive_db_key};
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
            restore_policy_quiet();
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
        restore_policy_quiet();
    }
    Ok(result)
}

/// MGR-005: после установки текущего пользователя подтягиваем персистированную
/// политику (бан/override/квоты переживают рестарт до первого heartbeat).
fn restore_policy_quiet() {
    if let Ok(guard) = state().db.lock() {
        crate::commands::telemetry::restore_policy_from_config(&guard);
    }
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
    let expires_at = match u.as_ref().map(|x| x.token.clone()) {
        Some(t) => with_db!(db, { Ok::<Option<String>, String>(db.get_session_expiry(&t)) }).ok().flatten(),
        None => None,
    };
    Ok(u.as_ref().map(|u| LoginResult {
        token: u.token.clone(),
        user_id: u.user_id,
        username: u.username.clone(),
        display_name: None,
        role: u.role.clone(),
        permissions: u.permissions.clone(),
        expires_at: expires_at.clone(),
    }))
}

#[tauri::command]
pub(crate) fn resume_session(token: String) -> Result<LoginResult, String> {
    let result = with_db!(db, {
        db.get_active_user_by_token(&token).ok_or("session_expired".to_string())
    })?;
    let expires_at = with_db!(db, { Ok::<Option<String>, String>(db.get_session_expiry(&token)) }).ok().flatten();
    let login = LoginResult {
        token: result.token.clone(),
        user_id: result.user_id,
        username: result.username.clone(),
        display_name: None,
        role: result.role.clone(),
        permissions: result.permissions.clone(),
        expires_at,
    };
    if let Ok(mut u) = state().current_user.lock() { *u = Some(result); }
    restore_policy_quiet();
    Ok(login)
}

/// FEAT-016: sliding-refresh сессии — продлевает expires_at до +30 дней,
/// если до истечения осталось меньше недели. Идемпотентно.
#[tauri::command]
pub(crate) fn refresh_session(token: String) -> Result<LoginResult, String> {
    let new_expiry = with_db!(db, {
        db.refresh_session(&token).ok_or("session_expired".to_string())
    })?;
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
        expires_at: Some(new_expiry.0),
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
    // FEAT-014: soft delete — деактивация + отзыв сессий, запись остаётся
    with_db!(db, {
        db.delete_user(id)?;
        let _ = db.log_event("user.deactivated", &format!("User {} deactivated", id), Some("user"), None);
        Ok(())
    })
}

/// FEAT-014: полное удаление — только после деактивации
#[tauri::command]
pub(crate) fn hard_delete_user_cmd(id: i64) -> Result<(), String> {
    let admin = require_admin()?;
    if admin.user_id == id { return Err("cannot_delete_self".into()); }
    with_db!(db, {
        db.hard_delete_user(id)?;
        let _ = db.log_event("user.hard_deleted", &format!("User {} permanently deleted", id), Some("user"), None);
        Ok(())
    })
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
        crate::commands::telemetry::enforce_daily_quota(db, crate::commands::telemetry::DailyQuota::Cards)?;
        crate::commands::telemetry::enforce_decline_cooldown(db)?;
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
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
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
        let db_path = crate::state::db_path();
        let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
        // SEC-001: шифруем файл БД сразу при создании пароля — не оставляем
        // plaintext-копию на диске до следующего unlock.
        // SEC-005: DEK случайный (envelope v2), sidecar хранит соль + обёртку.
        if !Database::is_encrypted(db_path_str) {
            let dek = crate::encryption::generate_group_key();
            let blob = crate::encryption::wrap_dek(&dek, &password, &salt)?;
            Database::save_sidecar(db_path_str, &salt_b64, &blob)?;
            db.close_connections();
            Database::migrate_to_encrypted(db_path_str, &dek)?;
            db.reopen_with_key(db_path_str, &dek)?;
        }
        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.password_created", "Master password created", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn is_password_set() -> Result<bool, String> {
    // SEC-001: зашифрованный файл БД возможен только после установки пароля.
    // Проверяем заголовок файла, т.к. locked-shell соединение не может читать config.
    let db_path = crate::state::db_path();
    if let Some(p) = db_path.to_str() {
        if std::path::Path::new(p).exists() && Database::is_encrypted(p) {
            return Ok(true);
        }
    }
    with_db!(db, {
        Ok(db.get_config("master_password_hash")
            .map_err(|e| e.to_string())?
            .map(|v| !v.is_empty())
            .unwrap_or(false))
    })
}

// ── MGR-013: panic-пароль (duress) ─────────────────────────────────────────
// Хеш живёт в sidecar v3 рядом с обёрнутым DEK (bcrypt-хеш не секрет).
// Установка возможна только на уже зашифрованной БД и только из
// разблокированной сессии (Settings). При вводе panic-пароля на unlock БД
// стирается, а ответ неотличим от «неверный пароль».

#[tauri::command]
pub(crate) fn set_panic_password(password: String) -> Result<(), String> {
    rate_limiter::check_rate_limit(
        rate_limiter::RateLimitCategory::Strict,
        rate_limiter::get_rate_limit_key("set_panic_password"),
    )?;
    let v = PasswordValidation::check(&password);
    if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
    with_db!(db, {
        // Panic-пароль не должен совпадать с мастер-паролем — иначе
        // срабатывало бы при каждом входе.
        let master_hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if bcrypt::verify(&password, &master_hash).unwrap_or(false) {
            return Err("panic_equals_master".into());
        }
        let db_path = crate::state::db_path();
        let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
        if !Database::is_encrypted(db_path_str) {
            return Err("encrypt_db_first".into());
        }
        let sc = Database::read_sidecar(db_path_str)
            .ok_or("salt_file_missing: cannot set panic password")?;
        let dek = sc.wrapped_dek.ok_or("sidecar_v1_upgrade_required")?;
        // FIX CRY-H02: тот же bcrypt cost 14, что и у мастер-пароля.
        let hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
        Database::save_sidecar_v3(db_path_str, &sc.salt_b64, &dek, &hash)?;
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn remove_panic_password() -> Result<(), String> {
    with_db!(db, {
        let db_path = crate::state::db_path();
        let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
        if let Some(sc) = Database::read_sidecar(db_path_str) {
            if sc.panic_hash.is_some() {
                let dek = sc.wrapped_dek.ok_or("sidecar_v1_upgrade_required")?;
                Database::save_sidecar(db_path_str, &sc.salt_b64, &dek)?;
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn has_panic_password() -> Result<bool, String> {
    let db_path = crate::state::db_path();
    let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
    Ok(Database::read_sidecar(db_path_str)
        .map(|sc| sc.panic_hash.is_some())
        .unwrap_or(false))
}

#[tauri::command]
pub(crate) fn unlock(password: String, app: tauri::AppHandle) -> Result<(), String> {
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_limiter::get_rate_limit_key("unlock"))?;
    let (token, group_id, group_key) = with_db!(db, {
        let db_path = crate::state::db_path();
        let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
        let is_encrypted_db = Database::is_encrypted(db_path_str);

        // MGR-013: panic-пароль проверяется ДО любой попытки открытия БД.
        // Совпадение → криптостирание (sidecar с DEK + файлы БД) и та же
        // ошибка, что дал бы неверный пароль в этом состоянии: снаружи
        // срабатывание неотличимо от опечатки. Без логов и audit.
        if let Some(panic_hash) = Database::read_sidecar(db_path_str)
            .or_else(|| Database::read_sidecar_bak(db_path_str))
            .and_then(|sc| sc.panic_hash)
        {
            if bcrypt::verify(&password, &panic_hash).unwrap_or(false) {
                db.close_connections();
                crate::wipe::wipe_local_data(db_path_str);
                return Err(if db.pool.is_none() {
                    "salt_file_missing: cannot unlock encrypted database".into()
                } else {
                    "wrong_password".into()
                });
            }
        }

        if is_encrypted_db && db.pool.is_none() {
            // SEC-005: envelope-sidecar. Пробуем основной, потом .bak —
            // покрывает прерванную запись sidecar при смене пароля.
            let mut last_err = "salt_file_missing: cannot unlock encrypted database".to_string();
            let mut opened = false;
            for sc in [Database::read_sidecar(db_path_str), Database::read_sidecar_bak(db_path_str)]
                .into_iter().flatten()
            {
                let salt = match B64.decode(&sc.salt_b64) { Ok(s) => s, Err(_) => continue };
                let dek = match &sc.wrapped_dek {
                    Some(blob) => match crate::encryption::unwrap_dek(blob, &password, &salt) {
                        Ok(d) => d,
                        Err(_) => continue,
                    },
                    None => derive_db_key(&password, &salt),
                };
                match db.reopen_with_key(db_path_str, &dek) {
                    Ok(()) => {
                        // Legacy v1 (голая соль) → сразу апгрейдим до v2 envelope
                        if sc.wrapped_dek.is_none() {
                            if let Ok(blob) = crate::encryption::wrap_dek(&dek, &password, &salt) {
                                let _ = Database::save_sidecar(db_path_str, &sc.salt_b64, &blob);
                            }
                        }
                        opened = true;
                        break;
                    }
                    Err(e) => { last_err = e; }
                }
            }
            if !opened {
                return Err(last_err);
            }
        }

        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&password, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }

        let parsed_cost = if hash.starts_with("$2b$") && hash.len() > 7 {
            hash[4..6].parse::<u32>().ok()
        } else {
            None
        };
        if parsed_cost.is_none() && hash.starts_with("$2b$") {
            eprintln!("[bcrypt] cannot parse cost from hash prefix, upgrade skipped");
        }
        if parsed_cost.is_some_and(|c| c < 14) {
            let new_hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
            db.set_config("master_password_hash", &new_hash).map_err(|e| e.to_string())?;
            eprintln!("[bcrypt] Upgraded cost factor to 14");
        }

        let salt_b64 = db.get_config("encryption_salt").map_err(|e| e.to_string())?
            .ok_or("encryption_salt_missing")?;
        let salt = B64.decode(&salt_b64).map_err(|e| e.to_string())?;

        if !is_encrypted_db {
            // SEC-005: DEK случайный и в дальнейшем не меняется; в sidecar
            // пишем v2-envelope (соль + DEK, обёрнутый ключом из пароля).
            let dek = crate::encryption::generate_group_key();
            let blob = crate::encryption::wrap_dek(&dek, &password, &salt)?;
            Database::save_sidecar(db_path_str, &salt_b64, &blob)?;
            // На Windows rename файла невозможен, пока его держит открытый
            // SQLite handle — закрываем conn+pool перед sqlcipher_export.
            db.close_connections();
            Database::migrate_to_encrypted(db_path_str, &dek)?;
            db.reopen_with_key(db_path_str, &dek)?;
            let _ = db.log_event("security.db_encrypted", "Database migrated to SQLCipher", Some("system"), None);
        }

        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.unlocked", "Database unlocked", Some("system"), None)
            .map_err(|e| e.to_string())?;
        let _ = auto_backup(db);
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        let group_id = db.get_config("sync_group_id").ok().flatten();
        let group_key: Option<[u8; 32]> = db.get_config("sync_group_key").ok().flatten()
            .and_then(|gk| db.encryption.as_ref()
                .and_then(|enc| crate::encryption::resolve_group_key(&gk, enc)));
        Ok::<(Option<String>, Option<String>, Option<[u8; 32]>), String>((token, group_id, group_key))
    })?;

    // FIX B-MED-05: Сбрасываем атомарный флаг после успешного unlock
    if let Some(st) = STATE.get() {
        st.is_locked.store(false, Ordering::Relaxed);
    }

    // Start WS sync in background (non-blocking)
    if let Some(h) = WS_HANDLE.get() {
        h.set_group_key(group_key);
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
        h.set_group_key(None);
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
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
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
        let db_path = crate::state::db_path();
        let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
        if Database::is_encrypted(db_path_str) {
            // SEC-005: envelope-схема — DEK НЕ меняется при смене пароля.
            // Достаём текущий DEK (из v2-обёртки старым паролем, либо
            // derive из v1-соли) и перезаписываем sidecar новой обёрткой.
            // Никакого PRAGMA rekey → смена пароля атомарна и crash-safe.
            let sc = Database::read_sidecar(db_path_str)
                .ok_or("salt_file_missing")?;
            let old_salt = B64.decode(&sc.salt_b64).map_err(|e| e.to_string())?;
            let dek = match &sc.wrapped_dek {
                Some(blob) => crate::encryption::unwrap_dek(blob, &old, &old_salt)?,
                None => derive_db_key(&old, &old_salt),
            };
            let new_blob = crate::encryption::wrap_dek(&dek, &new, &new_salt)?;
            // .bak со старой обёрткой — fallback если запись прервётся
            let salt_path = Database::salt_file_path(db_path_str);
            let _ = std::fs::copy(&salt_path, format!("{}.bak", salt_path));
            Database::save_sidecar(db_path_str, &new_salt_b64, &new_blob)?;
            let _ = std::fs::remove_file(format!("{}.bak", salt_path));
        } else {
            Database::save_salt_file(db_path_str, &new_salt_b64)?;
        }

        db.set_encryption(new_enc);
        db.log_event("system.password_changed", "Password changed", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}