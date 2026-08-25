// Tauri commands: stuffer domain.
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
pub(crate) fn stuffer_get_config() -> Result<StufferConfigView, String> {
    with_db!(db, {
        let api_key_set = db
            .get_config("stuffer_api_key")
            .map_err(|e| e.to_string())?
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let base_url = db
            .get_config("stuffer_base_url")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| crate::stuffer::DEFAULT_BASE_URL.to_string());
        Ok(StufferConfigView { api_key_set, base_url })
    })
}

#[tauri::command]
pub(crate) fn stuffer_set_config(api_key: Option<String>, base_url: String) -> Result<(), String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    with_db!(db, {
        let base = if base_url.trim().is_empty() {
            crate::stuffer::DEFAULT_BASE_URL.to_string()
        } else {
            base_url.trim().to_string()
        };
        db.set_config("stuffer_base_url", &base).map_err(|e| e.to_string())?;
        // Пустой api_key => не трогаем сохранённый ключ (поле оставили пустым).
        if let Some(key) = api_key {
            if !key.trim().is_empty() {
                db.set_config("stuffer_api_key", key.trim()).map_err(|e| e.to_string())?;
            }
        }
        db.log_event("stuffer.config_updated", "Stuffer API config saved", Some("stuffer"), None)?;
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn stuffer_list_couriers() -> Result<Vec<crate::stuffer::CourierFull>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    let (base_url, api_key) = stuffer_creds()?;
    crate::stuffer::list_couriers(&base_url, &api_key)
}

#[tauri::command]
pub(crate) fn stuffer_list_available_couriers() -> Result<Vec<crate::stuffer::CourierAvailable>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    let (base_url, api_key) = stuffer_creds()?;
    crate::stuffer::list_available_couriers(&base_url, &api_key)
}

#[tauri::command]
pub(crate) fn stuffer_add_courier(courier_id: i64) -> Result<crate::stuffer::CourierFull, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let (base_url, api_key) = stuffer_creds()?;
    let courier = crate::stuffer::add_courier(&base_url, &api_key, courier_id)?;
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.courier_added",
            &format!("Courier {} added", courier_id),
            Some("stuffer"),
            Some(&courier_id.to_string()),
        );
    });
    Ok(courier)
}

#[tauri::command]
pub(crate) fn stuffer_list_packages() -> Result<Vec<crate::stuffer::Package>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    let (base_url, api_key) = stuffer_creds()?;
    crate::stuffer::list_packages(&base_url, &api_key)
}

#[tauri::command]
pub(crate) fn stuffer_get_labels(package_id: i64) -> Result<Vec<crate::stuffer::LabelFile>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    let (base_url, api_key) = stuffer_creds()?;
    crate::stuffer::get_labels(&base_url, &api_key, package_id)
}

#[tauri::command]
pub(crate) fn stuffer_create_package(package: crate::stuffer::PackageInput) -> Result<i64, String> {
    require_perm(models::perms::CREATE_PACKAGES)?;
    let (base_url, api_key) = stuffer_creds()?;
    let package_id = crate::stuffer::create_package(&base_url, &api_key, &package)?;
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.package_created",
            &format!("Package {} created", package_id),
            Some("stuffer"),
            Some(&package_id.to_string()),
        );
    });
    Ok(package_id)
}

pub(crate) fn stuffer_creds() -> Result<(String, String), String> {
    with_db!(db, {
        let api_key = db
            .get_config("stuffer_api_key")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "stuffer_not_configured".to_string())?;
        let base_url = db
            .get_config("stuffer_base_url")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| crate::stuffer::DEFAULT_BASE_URL.to_string());
        Ok((base_url, api_key))
    })
}

#[derive(serde::Serialize)]
pub(crate) struct StufferConfigView {
    api_key_set: bool,
    base_url: String,
}