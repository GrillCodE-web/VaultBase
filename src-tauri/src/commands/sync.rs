// Tauri commands: sync domain.
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
pub(crate) fn get_unsynced_footprints() -> Result<Vec<Footprint>, String> {
    require_user()?;
    with_db!(db, { db.get_unsynced_footprints_db() })
}

#[tauri::command]
pub(crate) fn mark_footprints_synced(ids: Vec<i64>) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.mark_footprints_synced_db(&ids) })
}

#[tauri::command]
pub(crate) fn sync_now() -> Result<SyncResult, String> {
    require_user()?;
    with_db!(db, {
        let res = crate::sync::SyncClient::sync_footprints(db)?;
        // DB-008: неудачные/частичные синхронизации в activity log
        if res.failed > 0 || !res.server_reached {
            let _ = db.log_event(
                "sync.failed",
                &format!("Sync footprints: synced={}, failed={}, server_reached={}, msg={}",
                    res.synced, res.failed, res.server_reached, res.message),
                Some("sync"), None,
            );
        }
        Ok(res)
    })
}

#[tauri::command]
pub(crate) fn sync_create_group(name: String, app: tauri::AppHandle) -> Result<SyncGroupInfo, String> {
    let (info, token, group_key) = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let info = crate::sync::SyncGroupClient::create_group(db, &name)?;
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        let group_key = db.get_config("sync_group_key").ok().flatten()
            .and_then(|gk| db.encryption.as_ref()
                .and_then(|enc| crate::encryption::resolve_group_key(&gk, enc)));
        Ok::<(SyncGroupInfo, Option<String>, Option<[u8; 32]>), String>((info, token, group_key))
    })?;
    // Refresh WS creds with new group
    if let Some(h) = WS_HANDLE.get() {
        h.set_group_key(group_key);
        h.set_creds(token, Some(info.group_id.clone()));
        ws_sync::start(app, h.clone());
    }
    Ok(info)
}

#[tauri::command]
pub(crate) fn sync_create_pair_code() -> Result<String, String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        crate::sync::SyncGroupClient::create_pair_code(db)
    })
}

#[tauri::command]
pub(crate) fn sync_join_group(pair_code: String, app: tauri::AppHandle) -> Result<SyncGroupInfo, String> {
    let (info, token, group_key) = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let info = crate::sync::SyncGroupClient::join_group(db, &pair_code)?;
        let token = db.get_config("license_token").ok().flatten()
            .and_then(|t| if t.is_empty() { None } else {
                db.encryption.as_ref().and_then(|enc| enc.decrypt(&t).ok())
            });
        let group_key = db.get_config("sync_group_key").ok().flatten()
            .and_then(|gk| db.encryption.as_ref()
                .and_then(|enc| crate::encryption::resolve_group_key(&gk, enc)));
        Ok::<(SyncGroupInfo, Option<String>, Option<[u8; 32]>), String>((info, token, group_key))
    })?;
    if let Some(h) = WS_HANDLE.get() {
        h.set_group_key(group_key);
        h.set_creds(token, Some(info.group_id.clone()));
        ws_sync::start(app, h.clone());
    }
    Ok(info)
}

#[tauri::command]
pub(crate) fn sync_get_group_status() -> Result<SyncGroupStatus, String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        Ok(crate::sync::SyncGroupClient::get_group_status(db))
    })
}

#[tauri::command]
pub(crate) fn sync_disconnect() -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        crate::sync::SyncGroupClient::disconnect(db)
    })?;
    // Stop WS and clear group creds
    if let Some(h) = WS_HANDLE.get() {
        h.stop();
        // Clear group_id but keep token (for reconnect if user re-joins)
        h.set_creds(None, None);
        h.set_group_key(None);
    }
    Ok(())
}