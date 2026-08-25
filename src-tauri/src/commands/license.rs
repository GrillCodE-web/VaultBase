// Tauri commands: license domain.
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
pub(crate) fn get_installation_id() -> Result<String, String> {
    with_db!(db, { crate::license::get_or_create_installation_id(db) })
}

#[tauri::command]
pub(crate) fn get_challenge_code() -> Result<String, String> {
    with_db!(db, { crate::license::get_challenge_code(db) })
}

#[tauri::command]
pub(crate) fn activate_license(activation_key: String) -> Result<(), String> {
    // FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_limiter::get_rate_limit_key("activate_license"))?;
    with_db!(db, { crate::license::activate(db, &activation_key) })
}

#[tauri::command]
pub(crate) fn get_license_status() -> Result<LicenseStatus, String> {
    with_db!(db, { crate::license::verify_at_startup(db) })
}

#[tauri::command]
pub(crate) fn retry_license_connection() -> Result<LicenseStatus, String> {
    with_db!(db, { crate::license::retry_verify(db) })
}