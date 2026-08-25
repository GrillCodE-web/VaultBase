// Tauri commands: orders domain.
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
pub(crate) fn create_order(input: OrderInput) -> Result<Order, String> {
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, { db.create_order(&input) })
}

#[tauri::command]
pub(crate) fn get_orders(filter: OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
    require_user()?;
    with_db!(db, { db.get_orders(&filter, page, per_page) })
}

#[tauri::command]
pub(crate) fn get_order(id: i64) -> Result<OrderDetail, String> {
    require_user()?;
    with_db!(db, { db.get_order(id) })
}

#[tauri::command]
pub(crate) fn get_latest_order_by_profile(profile_id: String) -> Result<Option<Order>, String> {
    require_user()?;
    with_db!(db, { db.get_latest_order_by_profile(&profile_id) })
}

#[tauri::command]
pub(crate) fn get_recent_orders_by_profile(profile_id: String, limit: u32) -> Result<Vec<Order>, String> {
    require_user()?;
    with_db!(db, { db.get_recent_orders_by_profile(&profile_id, limit) })
}

#[tauri::command]
pub(crate) fn get_recent_orders_by_card(card_id: i64, limit: u32) -> Result<Vec<Order>, String> {
    require_user()?;
    with_db!(db, { db.get_recent_orders_by_card(card_id, limit) })
}

#[tauri::command]
pub(crate) fn update_order_status(id: i64, status: String, meta: Option<StatusMeta>) -> Result<(), String> {
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, { db.update_order_status(id, &status, meta.as_ref()) })
}

#[tauri::command]
pub(crate) fn delete_order(id: i64) -> Result<(), String> {
    // Удаление — необратимо и затрагивает чужие заказы (владельца у заказа нет),
    // поэтому только админ, а не CREATE_ORDERS.
    require_admin()?;
    with_db!(db, { db.delete_order(id) })
}

#[tauri::command]
pub(crate) fn bulk_update_orders(ids: Vec<i64>, status: String) -> Result<(), String> {
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_update_orders_status(&ids, &status)
    })
}

#[tauri::command]
pub(crate) fn bulk_delete_orders(ids: Vec<i64>) -> Result<(), String> {
    require_admin()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_delete_orders(&ids)
    })
}

#[tauri::command]
pub(crate) fn update_order_tracking(id: i64, tracking_number: Option<String>, carrier: Option<String>) -> Result<(), String> {
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, { db.update_order_tracking(id, tracking_number.as_deref(), carrier.as_deref()) })
}

#[tauri::command]
pub(crate) fn run_risk_check(profile_id: String, shop_id: i64, drop_id: Option<i64>, email_pool_id: Option<i64>, proxy_id: Option<i64>) -> Result<RiskCheckResult, String> {
    require_user()?;
    with_db!(db, {
        // FIX B31: передаём все факторы риска в БД-функцию
        let mut result = db.run_risk_check(&profile_id, shop_id, drop_id, email_pool_id, proxy_id)?;
        let server_result = sync::SyncClient::check_risk_detailed(&db, &profile_id, shop_id);
        match server_result {
            sync::RiskCheckOutcome::Offline => {
                result.offline = true;
                // BUG-018: offline-режим раньше был невидим пользователю —
                // добавляем явное предупреждение, что серверная проверка
                // не выполнена и результат только локальный
                result.warnings.push(crate::models::RiskWarning {
                    kind: "server_offline".into(),
                    severity: "info".into(),
                    message: "Risk server unreachable — only local checks applied".into(),
                    related_order_id: None,
                    related_order_status: None,
                });
            }
            sync::RiskCheckOutcome::Clean => {
                result.offline = false;
            }
            sync::RiskCheckOutcome::Warnings(server_warnings) => {
                result.offline = false;
                result.score = result.score.saturating_add(30);
                result.warnings.extend(server_warnings);
                result.level = if result.score >= 40 { "high" } else if result.score >= 20 { "warning" } else { "safe" }.into();
            }
        }
        Ok(result)
    })
}

#[tauri::command]
pub(crate) fn save_order_template(input: SaveTemplateInput) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.save_order_template(&input) })
}

#[tauri::command]
pub(crate) fn get_order_templates(shop_tag: Option<String>) -> Result<Vec<OrderTemplate>, String> {
    require_user()?;
    with_db!(db, { db.get_order_templates(shop_tag.as_deref()) })
}

#[tauri::command]
pub(crate) fn batch_create_orders(orders: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, {
        let (ok, fail) = db.batch_create_orders(&orders)?;
        Ok(serde_json::json!({ "created": ok, "failed": fail }))
    })
}