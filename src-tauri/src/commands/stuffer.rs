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
        let provider_id = db
            .get_config("stuffer_provider")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "swat".to_string());
        // Capabilities не требуют кредов: конструируем провайдер пустыми
        // ключами только чтобы отдать фронтенду енумы панели (pay options).
        let pay_options = crate::stuffer::provider_by_id(&provider_id, "", "")?
            .capabilities()
            .pay_options;
        Ok(StufferConfigView {
            api_key_set,
            base_url,
            provider: provider_id,
            pay_options,
        })
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
    active_provider()?.list_couriers()
}

#[tauri::command]
pub(crate) fn stuffer_list_available_couriers() -> Result<Vec<crate::stuffer::CourierAvailable>, String> {
    require_perm(models::perms::VIEW_COURIERS)?;
    active_provider()?.list_available_couriers()
}

#[tauri::command]
pub(crate) fn stuffer_add_courier(courier_id: i64) -> Result<crate::stuffer::CourierFull, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let courier = active_provider()?.add_courier(courier_id)?;
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
    active_provider()?.list_packages()
}

#[tauri::command]
pub(crate) fn stuffer_get_labels(package_id: i64) -> Result<Vec<crate::stuffer::LabelFile>, String> {
    require_perm(models::perms::VIEW_PACKAGES)?;
    active_provider()?.get_labels(package_id)
}

#[tauri::command]
pub(crate) fn stuffer_create_package(package: crate::stuffer::PackageInput) -> Result<i64, String> {
    require_perm(models::perms::CREATE_PACKAGES)?;
    let package_id = active_provider()?.create_package(&package)?;
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

/// FEAT-012: live-тест пишущих методов провайдера (add_courier +
/// new_package). Возвращает отчёт по шагам — UI показывает, на каком шаге
/// панель отвалилась. Пишет на панель по-настоящему: тест-пакет с
/// pay_option «test».
#[tauri::command]
pub(crate) fn stuffer_test_write() -> Result<crate::stuffer::WriteTestReport, String> {
    require_perm(models::perms::MANAGE_COURIERS)?;
    let report = active_provider()?.test_write();
    with_db!(db, {
        let _ = db.log_event(
            "stuffer.write_tested",
            &format!(
                "Write test {}: {} step(s)",
                if report.ok { "ok" } else { "failed" },
                report.steps.len()
            ),
            Some("stuffer"),
            None,
        );
    });
    Ok(report)
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

/// Активный провайдер стаффинга. Сейчас доступен SWAT (панель StockHub);
/// переключение SWAT/CARGO — по конфигу `stuffer_provider` (FEAT-013:
/// CARGO добавляется реализацией trait Provider и регистрацией в
/// provider_by_id, команды и фронтенд при этом не меняются).
fn active_provider() -> Result<Box<dyn stuffer::Provider>, String> {
    let provider_id = with_db!(db, {
        Ok::<String, String>(db
            .get_config("stuffer_provider")
            .map_err(|e| e.to_string())?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "swat".to_string()))
    })?;
    let (base_url, api_key) = stuffer_creds()?;
    stuffer::provider_by_id(&provider_id, &base_url, &api_key)
}

#[derive(serde::Serialize)]
pub(crate) struct StufferConfigView {
    api_key_set: bool,
    base_url: String,
    provider: String,
    pay_options: Vec<String>,
}
