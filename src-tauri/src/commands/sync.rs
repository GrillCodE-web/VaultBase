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
use crate::parser;
use crate::endpoints;
use crate::license;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use tauri::{Manager, Emitter};
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

// MGR-018 (этап E1): sync-группы/pair-коды выпилены из воркера —
// карты едут только персональными срезами от менеджера (commands/slices.rs).
// Серверные endpoints create/pair/join отвечают 410 Gone ещё с MGR-016.
// Конфиг-ключи sync_group_id/name/key больше не пишутся; старые значения
// на апгрейде безвредны (их никто не читает).