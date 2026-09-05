// Tauri commands: smtp domain.
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
pub(crate) fn add_smtp_config(input: SmtpConfigInput) -> Result<SmtpConfig, String> {
    require_user()?;
    with_db!(db, { db.add_smtp_config(&input) })
}

#[tauri::command]
pub(crate) fn get_smtp_configs() -> Result<Vec<SmtpConfig>, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_smtp_configs()
}

#[tauri::command]
pub(crate) fn delete_smtp_config(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_smtp_config(id) })
}

#[tauri::command]
pub(crate) fn test_smtp_connection(id: i64) -> Result<String, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    let cfg = guard.get_smtp_configs()?.into_iter().find(|c| c.id == id)
        .ok_or_else(|| "smtp_config_not_found".to_string())?;
    let pw = guard.get_smtp_config_password(id)?;
    drop(guard);
    crate::smtp::EmailSender::test(&cfg.host, cfg.port as u16, &cfg.login, &pw, cfg.use_tls)
}

#[tauri::command]
pub(crate) fn send_email(smtp_config_id: i64, to: String, subject: String, body: String) -> Result<(), String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    crate::smtp::EmailSender::send(&*guard, smtp_config_id, &to, &subject, &body)
}

#[tauri::command]
pub(crate) fn get_sent_emails(page: u32) -> Result<PaginatedSentEmails, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_sent_emails(page, 50)
}