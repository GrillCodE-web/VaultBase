// Tauri commands: automation domain.
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
pub(crate) fn get_card_shop_usage(card_id: i64) -> Result<Vec<CardShopUsage>, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_shop_usage(card_id)
}

#[tauri::command]
pub(crate) fn get_email_footprint_stats(email_id: i64) -> Result<EmailFootprintStats, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_email_footprint_stats(email_id)
}

#[tauri::command]
pub(crate) fn get_shop_risk_score(shop_id: i64) -> Result<ShopRiskScore, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_shop_risk_score(shop_id)
}

#[tauri::command]
pub(crate) fn get_card_timeline(card_id: i64) -> Result<Vec<CardTimelineEvent>, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_timeline(card_id)
}

#[tauri::command]
pub(crate) fn get_automation_config() -> Result<models::AutomationConfig, String> {
    require_user()?;
    with_db!(db, { db.get_automation_config() })
}

#[tauri::command]
pub(crate) fn set_automation_config_cmd(key: String, value: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.set_automation_config(&key, &value) })
}

#[tauri::command]
pub(crate) fn get_automation_health() -> Result<models::AutomationHealth, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_automation_health()
}

#[tauri::command]
pub(crate) fn get_burned_cards(threshold: u32) -> Result<Vec<models::BurnedCard>, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_burned_cards(threshold)
}

#[tauri::command]
pub(crate) fn auto_archive_burned_cards_cmd(threshold: u32) -> Result<u32, String> {
    require_user()?;
    with_db!(db, { db.auto_archive_burned_cards(threshold) })
}

#[tauri::command]
pub(crate) fn get_consecutive_declines_cmd(card_id: i64) -> Result<u32, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_consecutive_declines(card_id)
}

#[tauri::command]
pub(crate) fn auto_archive_risky_cards_cmd(decline_threshold: u32) -> Result<u32, String> {
    require_user()?;
    with_db!(db, { db.auto_archive_risky_cards(decline_threshold) })
}

#[tauri::command]
pub(crate) fn get_card_replacement_suggestions_cmd(burned_card_id: i64, shop_id: i64) -> Result<Vec<models::CardSuggestion>, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_replacement_suggestions(burned_card_id, shop_id)
}

#[tauri::command]
pub(crate) fn get_shop_stats_v2_cmd(shop_id: i64) -> Result<models::ShopStatsV2, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_shop_stats_v2(shop_id)
}

// ─────────────────────────────────────────
//  FEAT-004: IF-THEN правила автоматизации
// ─────────────────────────────────────────

#[tauri::command]
pub(crate) fn create_automation_rule(
    name: String,
    description: Option<String>,
    conditions_json: String,
    actions_json: String,
    enabled: Option<bool>,
) -> Result<i64, String> {
    require_user()?;
    with_db!(db, {
        db.create_automation_rule(&name, description.as_deref(), &conditions_json, &actions_json, enabled.unwrap_or(true))
    })
}

#[tauri::command]
pub(crate) fn list_automation_rules() -> Result<Vec<models::AutomationRule>, String> {
    require_user()?;
    with_db!(db, { db.list_automation_rules() })
}

#[tauri::command]
pub(crate) fn update_automation_rule(
    id: i64,
    name: Option<String>,
    description: Option<String>,
    conditions_json: Option<String>,
    actions_json: Option<String>,
    enabled: Option<bool>,
) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        db.update_automation_rule(id, name.as_deref(), description.as_deref(), conditions_json.as_deref(), actions_json.as_deref(), enabled)
    })
}

#[tauri::command]
pub(crate) fn delete_automation_rule(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_automation_rule(id) })
}

#[tauri::command]
pub(crate) fn get_automation_rule_runs(rule_id: Option<i64>, limit: Option<u32>) -> Result<Vec<models::AutomationRuleRun>, String> {
    require_user()?;
    with_db!(db, { db.get_automation_rule_runs(rule_id, limit.unwrap_or(50)) })
}
