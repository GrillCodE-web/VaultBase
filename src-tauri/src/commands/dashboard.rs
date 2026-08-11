// Tauri commands: dashboard domain.
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
pub(crate) fn get_dashboard_stats(period: String, from: Option<String>, to: Option<String>) -> Result<DashboardStats, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_dashboard_stats(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_revenue_chart(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<RevenuePoint>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_revenue_chart(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_heatmap_data(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<HeatmapCell>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_heatmap_data(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_top_banks(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<BankStats>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_top_banks(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_by_country(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<CountryStats>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_country(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_by_source(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<SourceStats>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_source(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_by_domain(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<DomainStats>, String> {
    require_perm(models::perms::VIEW_STATS_GLOBAL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_domain(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_expiring_cards_dashboard(days: u32) -> Result<Vec<ExpiringCard>, String> {
    require_perm(models::perms::VIEW_CARDS_POOL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_expiring_cards_dashboard(days)
}

#[tauri::command]
pub(crate) fn export_dashboard_csv(period: String, from: Option<String>, to: Option<String>) -> Result<String, String> {
    require_perm(models::perms::EXPORT_DATA)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_dashboard_csv(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
pub(crate) fn get_sidebar_badges() -> Result<SidebarBadges, String> {
    require_user()?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_sidebar_badges()
}

#[tauri::command]
pub(crate) fn get_bin_performance() -> Result<Vec<models::BinPerf>, String> {
    require_user()?;
    with_db!(db, { db.get_bin_performance() })
}

#[tauri::command]
pub(crate) fn get_shop_win_loss() -> Result<Vec<models::ShopWinLoss>, String> {
    require_user()?;
    with_db!(db, { db.get_shop_win_loss() })
}