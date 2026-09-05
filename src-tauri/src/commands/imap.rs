// Tauri commands: imap domain.
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
use std::collections::HashMap;

#[tauri::command]
pub(crate) fn add_imap_account(input: ImapInput) -> Result<ImapAccount, String> {
    require_user()?;
    with_db!(db, { db.add_imap_account(&input) })
}

#[tauri::command]
pub(crate) fn get_imap_accounts() -> Result<Vec<ImapAccount>, String> {
    require_user()?;
    with_db!(db, { db.get_imap_accounts() })
}

#[tauri::command]
pub(crate) fn update_imap_account(id: i64, input: ImapInput) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.update_imap_account(id, &input) })
}

#[tauri::command]
pub(crate) fn delete_imap_account(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_imap_account(id) })
}

#[tauri::command]
pub(crate) fn toggle_imap_account(id: i64, active: bool) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.toggle_imap_account(id, active) })
}

#[tauri::command]
pub(crate) fn get_imap_messages(filter: ImapMsgFilter, page: u32) -> Result<PaginatedMessages, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_messages(&filter, page, 50)
}

#[tauri::command]
pub(crate) fn test_imap_connection(id: i64) -> Result<String, String> {
    require_user()?;
    let (acc, pw) = with_db!(db, { db.get_imap_account_with_password(id) })?;
    crate::imap::ImapPoller::test_connection(&acc.host, acc.port as u16, &acc.login, &pw)
}

#[tauri::command]
pub(crate) fn link_all_imap_accounts() -> Result<u32, String> {
    require_user()?;
    with_db!(db, { db.link_all_imap_to_email_pool() })
}

#[tauri::command]
pub(crate) fn link_email_to_imap(email_id: i64, imap_account_id: Option<i64>) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        db.conn.execute("UPDATE email_pool SET imap_account_id=?1 WHERE id=?2",
            rusqlite::params![imap_account_id, email_id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ── IMAP-ROUTING: маршруты «домен = почта» ─────────────────────────────

#[tauri::command]
pub(crate) fn add_domain_route(domain: String, imap_account_id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.add_domain_route(&domain, imap_account_id) })
}

#[tauri::command]
pub(crate) fn remove_domain_route(domain: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.remove_domain_route(&domain) })
}

#[tauri::command]
pub(crate) fn list_domain_routes() -> Result<Vec<crate::models::DomainRoute>, String> {
    require_user()?;
    with_db!(db, { db.list_domain_routes() })
}

#[tauri::command]
pub(crate) fn get_account_for_domain(domain: String) -> Result<Option<i64>, String> {
    require_user()?;
    with_db!(db, { db.get_account_for_domain(&domain) })
}

#[tauri::command]
pub(crate) fn get_folder_messages(account_id: i64, folder: String, page: u32, search: Option<String>) -> Result<PaginatedMessages, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_folder_messages(account_id, &folder, page, 30, search.as_deref())
}

#[tauri::command]
pub(crate) fn refresh_folder_from_imap(account_id: i64, folder: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    let (acc, pw) = {
        let g = state().db.lock().map_err(|e| e.to_string())?;
        match g.get_imap_account_with_password(account_id) {
            Ok((a, p)) if !p.is_empty() => (a, p),
            _ => return Ok(()),
        }
    };
    crate::state::spawn_task(move || {
        let known_uids: std::collections::HashSet<String> = {
            let Ok(g) = state().db.lock() else { return };
            g.get_known_imap_uids(account_id).unwrap_or_default().into_iter().collect()
        };
        match crate::imap::fetch_account_messages(&acc, &pw, &known_uids) {
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

#[tauri::command]
pub(crate) fn get_unified_inbox(page: u32, search: Option<String>) -> Result<PaginatedMessages, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_all_inbox_messages(page, 30, search.as_deref())
}

#[tauri::command]
pub(crate) fn archive_imap_message(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.archive_imap_message(id) })
}

#[tauri::command]
pub(crate) fn get_imap_message_body(account_id: i64, message_id: i64) -> Result<String, String> {
    require_user()?;
    with_db!(db, { crate::imap::get_message_body_from_server(db, account_id, message_id) })
}

#[tauri::command]
pub(crate) fn get_imap_folders(id: i64, app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    require_user()?;
    let cached = {
        let guard = state().db.lock().map_err(|e| e.to_string())?;
        guard.get_cached_imap_folders(id)
    };
    crate::state::spawn_task(move || {
        let creds = {
            let Ok(g) = state().db.lock() else { return };
            g.get_imap_account_with_password(id)
        };
        let (acc, pw) = match creds {
            Ok((a, p)) if !p.is_empty() => (a, p),
            _ => return,
        };
        let folders = crate::imap::list_imap_folders(&acc, &pw).unwrap_or_else(|_| vec!["INBOX".into()]);
        if let Ok(g) = state().db.lock() {
            let _ = g.save_cached_imap_folders(id, &folders);
        }
        let _ = app_handle.emit("imap_folders_refreshed", serde_json::json!({
            "account_id": id, "folders": folders,
        }));
    });
    Ok(if cached.is_empty() { vec!["INBOX".into()] } else { cached })
}

#[tauri::command]
pub(crate) fn get_imap_stats(id: i64) -> Result<ImapAccountStats, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_account_stats(id)
}

#[tauri::command]
pub(crate) fn check_all_imap(app_handle: tauri::AppHandle) -> Result<ImapCheckResult, String> {
    require_user()?;
    let accounts: Vec<_> = {
        let guard = state().db.lock().map_err(|e| e.to_string())?;
        guard.get_imap_accounts()?.into_iter().filter(|a| a.is_active).collect()
    };
    let count = accounts.len() as u32;
    for acc in accounts {
        let app = app_handle.clone();
        crate::state::spawn_task(move || {
            let result = {
                let Ok(mut g) = state().db.lock() else { return };
                crate::imap::ImapPoller::check_account(&mut g, acc.id)
            };
            let (msgs, orders) = result.unwrap_or((0, 0));
            let _ = app.emit("imap_check_progress", serde_json::json!({
                "account_id": acc.id, "account_label": acc.label,
                "messages": msgs, "orders": orders,
            }));
        });
    }
    Ok(ImapCheckResult { accounts_checked: count, messages_found: 0, orders_updated: 0 })
}

#[tauri::command]
pub(crate) fn mark_imap_read(id: i64) -> Result<(), String> {
    require_user()?;
    let account_id = {
        let guard = state().db.lock().map_err(|e| e.to_string())?;
        guard.get_imap_message_account_id(id)?.ok_or("message_not_found")?
    };
    with_db!(db, { crate::imap::mark_message_read_on_server(db, account_id, id) })
}

#[tauri::command]
pub(crate) fn delete_imap_message(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_imap_message(id) })
}