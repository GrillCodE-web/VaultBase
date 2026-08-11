// Tauri commands: catalog domain.
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
pub(crate) fn search_catalog_items(q: String, limit: Option<u32>) -> Result<Vec<models::CatalogItem>, String> {
    require_user()?;
    with_db!(db, { db.search_catalog_items(&q, limit.unwrap_or(10) as u64) })
}

#[tauri::command]
pub(crate) fn search_catalog_shops(q: String, limit: Option<u32>) -> Result<Vec<models::CatalogShop>, String> {
    require_user()?;
    with_db!(db, { db.search_catalog_shops(&q, limit.unwrap_or(8) as u64) })
}

#[tauri::command]
pub(crate) fn get_catalog_stats() -> Result<models::CatalogStats, String> {
    require_user()?;
    with_db!(db, { db.get_catalog_stats() })
}

#[tauri::command]
pub(crate) fn import_catalog_items(items: Vec<models::CatalogItemInput>) -> Result<usize, String> {
    require_user()?;
    with_db!(db, { db.import_catalog_items_batch(&items) })
}

#[tauri::command]
pub(crate) fn import_catalog_shops(shops: Vec<models::CatalogShopInput>) -> Result<usize, String> {
    require_user()?;
    with_db!(db, { db.import_catalog_shops_batch(&shops) })
}

#[tauri::command]
pub(crate) fn get_catalog_items(page: u32, per_page: u32, search: String) -> Result<models::PaginatedCatalogItems, String> {
    require_user()?;
    with_db!(db, { db.get_catalog_items_paged(&search, page, per_page) })
}

#[tauri::command]
pub(crate) fn get_catalog_shops(page: u32, per_page: u32, search: String) -> Result<models::PaginatedCatalogShops, String> {
    require_user()?;
    with_db!(db, { db.get_catalog_shops_paged(&search, page, per_page) })
}

#[tauri::command]
pub(crate) fn toggle_catalog_item_stop(id: i64, stop: bool) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.toggle_catalog_item_stop(id, stop) })
}

#[tauri::command]
pub(crate) fn delete_catalog_items(ids: Vec<i64>) -> Result<u32, String> {
    require_user()?;
    with_db!(db, { db.delete_catalog_items(&ids) })
}

#[tauri::command]
pub(crate) fn toggle_catalog_shop_excluded(id: i64, excluded: bool) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.toggle_catalog_shop_excluded(id, excluded) })
}

#[tauri::command]
pub(crate) fn get_profile_ltv(profile_id: String) -> Result<serde_json::Value, String> {
    require_user()?;
    with_db!(db, { db.get_profile_ltv(&profile_id) })
}

#[tauri::command]
pub(crate) fn get_free_email_for_shop(shop_id: Option<i64>) -> Result<Option<serde_json::Value>, String> {
    require_user()?;
    with_db!(db, { db.get_free_email_for_shop(shop_id) })
}

#[tauri::command]
pub(crate) fn get_available_emails(limit: u32) -> Result<Vec<serde_json::Value>, String> {
    require_user()?;
    with_db!(db, { db.get_available_emails(limit) })
}

#[tauri::command]
pub(crate) fn set_profile_email(profile_id: String, email_pool_id: Option<i64>) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.set_profile_email(&profile_id, email_pool_id) })
}

#[tauri::command]
pub(crate) fn check_proxy_health_now() -> Result<ProxyHealthResult, String> {
    require_user()?;
    with_db!(db, { db.check_all_proxy_health() })
}

#[tauri::command]
pub(crate) fn get_proxy_usage_stats() -> Result<Vec<ProxyUsageStat>, String> {
    require_user()?;
    with_db!(db, { db.get_proxy_usage_stats() })
}

#[tauri::command]
pub(crate) fn set_proxy_shop_binding(proxy_id: i64, shop_id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.set_proxy_shop_binding(proxy_id, shop_id) })
}

#[tauri::command]
pub(crate) fn remove_proxy_shop_binding(shop_id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.remove_proxy_shop_binding(shop_id) })
}

#[tauri::command]
pub(crate) fn get_proxy_for_shop(shop_id: i64) -> Result<Option<i64>, String> {
    require_user()?;
    with_db!(db, { db.get_proxy_for_shop(shop_id) })
}

#[tauri::command]
pub(crate) fn get_all_proxy_shop_bindings() -> Result<Vec<serde_json::Value>, String> {
    require_user()?;
    with_db!(db, { db.get_all_proxy_shop_bindings() })
}

#[tauri::command]
pub(crate) fn find_or_create_shop(url: String) -> Result<serde_json::Value, String> {
    require_user()?;
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

#[tauri::command]
pub(crate) fn detect_carrier_from_tracking(tracking: String) -> Result<Option<String>, String> {
    require_user()?;
    Ok(crate::tracking::detect_carrier(&tracking).map(|s| s.to_string()))
}

#[tauri::command]
pub(crate) fn check_tracking_direct(tracking: String) -> Result<TrackingStatus, String> {
    require_user()?;
    crate::tracking::check_tracking_smart(&tracking)
}