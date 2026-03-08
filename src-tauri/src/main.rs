#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unused_imports, unused_variables, dead_code, unused_mut)]

mod database;
mod encryption;
mod imap;
mod license;
mod models;
mod parser;
mod sync;

use database::{Database, fetch_bin_info};
use encryption::{FieldEncryption, PasswordValidation, generate_salt};
use license::LicenseStatus;
use models::*;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::{Manager, Emitter};

// ─────────────────────────────────────────
//  Global state
// ─────────────────────────────────────────

struct AppState { db: Mutex<Database> }
static STATE: OnceCell<AppState> = OnceCell::new();
fn state() -> &'static AppState { STATE.get().expect("AppState not initialized") }

fn db_path() -> PathBuf {
    // Place DB in project root (parent of src-tauri/) to avoid
    // Tauri dev watcher triggering rebuilds on every DB write
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut p = if cwd.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
        let mut parent = cwd.clone();
        parent.pop();
        parent
    } else {
        cwd
    };
    p.push("cc_manager.db");
    p
}

macro_rules! with_db {
    ($db:ident, $body:block) => {{
        let mut guard = state().db.lock().map_err(|e| e.to_string())?;
        let $db = &mut *guard;
        $body
    }};
}

// ─────────────────────────────────────────
//  Auth
// ─────────────────────────────────────────

#[tauri::command]
fn setup_password(password: String) -> Result<(), String> {
    let v = PasswordValidation::check(&password);
    if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
    with_db!(db, {
        if db.get_config("master_password_hash").map_err(|e| e.to_string())?.is_some() {
            return Err("password_already_set".into());
        }
        let salt = generate_salt();
        let salt_b64 = B64.encode(&salt);
        let hash = bcrypt::hash(&password, 12).map_err(|e| e.to_string())?;
        db.set_config("master_password_hash", &hash).map_err(|e| e.to_string())?;
        db.set_config("encryption_salt", &salt_b64).map_err(|e| e.to_string())?;
        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.password_created", "Master password created", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn unlock(password: String) -> Result<(), String> {
    with_db!(db, {
        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&password, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }
        let salt_b64 = db.get_config("encryption_salt").map_err(|e| e.to_string())?
            .ok_or("encryption_salt_missing")?;
        let salt = B64.decode(&salt_b64).map_err(|e| e.to_string())?;
        db.set_encryption(FieldEncryption::new(&password, &salt));
        db.log_event("system.unlocked", "Database unlocked", Some("system"), None)
            .map_err(|e| e.to_string())?;
        // Auto-backup on unlock
        let _ = auto_backup(db);
        Ok(())
    })
}

fn auto_backup(db: &Database) -> Result<(), String> {
    let src = match db.conn.path() {
        Some(p) => p.to_string(),
        None => return Ok(()),
    };
    let backup_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("cc-manager")
        .join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let dest = backup_dir.join(format!("backup_{ts}.db"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    // Keep only last 30 backups
    let mut entries: Vec<_> = std::fs::read_dir(&backup_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default();
    entries.sort_by_key(|e| e.file_name());
    if entries.len() > 30 {
        for old in &entries[..entries.len() - 30] {
            let _ = std::fs::remove_file(old.path());
        }
    }
    let _ = db.log_event("system.backup_created", &format!("Auto-backup: {}", dest.display()), Some("system"), None);
    Ok(())
}

#[tauri::command]
fn lock() -> Result<(), String> {
    with_db!(db, {
        db.clear_encryption();
        let _ = db.log_event("system.locked", "Database locked", Some("system"), None);
        Ok(())
    })
}

#[tauri::command]
fn is_locked() -> Result<bool, String> {
    Ok(state().db.lock().map_err(|e| e.to_string())?.is_locked())
}

#[tauri::command]
fn change_password(old: String, new: String) -> Result<(), String> {
    let v = PasswordValidation::check(&new);
    if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
    with_db!(db, {
        let hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?
            .ok_or("setup_required")?;
        if !bcrypt::verify(&old, &hash).map_err(|e| e.to_string())? {
            return Err("wrong_password".into());
        }
        let salt_b64 = db.get_config("encryption_salt").map_err(|e| e.to_string())?
            .ok_or("encryption_salt_missing")?;
        let old_salt = B64.decode(&salt_b64).map_err(|e| e.to_string())?;
        let old_enc  = FieldEncryption::new(&old, &old_salt);
        let new_salt = generate_salt();
        let new_enc  = FieldEncryption::new(&new, &new_salt);
        db.reencrypt_all(&old_enc, &new_enc)?;
        let new_hash     = bcrypt::hash(&new, 12).map_err(|e| e.to_string())?;
        let new_salt_b64 = B64.encode(&new_salt);
        db.set_config("master_password_hash", &new_hash).map_err(|e| e.to_string())?;
        db.set_config("encryption_salt", &new_salt_b64).map_err(|e| e.to_string())?;
        db.set_encryption(new_enc);
        db.log_event("system.password_changed", "Password changed", Some("system"), None)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ─────────────────────────────────────────
//  Card commands — IMPLEMENTED
// ─────────────────────────────────────────

#[tauri::command]
fn detect_mapping_preview(raw: String) -> Result<MappingPreview, String> {
    Ok(parser::mapping_preview(&raw))
}

#[tauri::command]
fn import_cards(raw: String, mapping: Vec<String>, source: String) -> Result<ImportResult, String> {
    let parse_result = parser::parse_cards(&raw, mapping, &source);
    let total_parsed = parse_result.parsed.len();

    let inserted = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.insert_cards(parse_result.parsed)
    })?;

    let skipped = total_parsed - inserted + parse_result.skipped;

    with_db!(db, {
        let _ = db.log_event(
            "card.imported",
            &format!("Imported {} cards from source '{}'", inserted, source),
            Some("card"), None,
        );
        Ok(ImportResult {
            total:    total_parsed as u32,
            imported: inserted as u32,
            skipped:  skipped as u32,
            errors:   parse_result.errors,
        })
    })
}

#[tauri::command]
fn get_cards(filter: CardFilter, page: u32, per_page: u32) -> Result<PaginatedCards, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_cards(&filter, page, per_page.max(1))
}

#[tauri::command]
fn get_card(_id: i64) -> Result<Card, String> {
    // Returns masked card (same as list but single item)
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    let result = guard.get_cards(
        &CardFilter { ..Default::default() },
        1, 1,
    )?;
    result.items.into_iter().next().ok_or("card_not_found".into())
}

#[tauri::command]
fn reveal_card(id: i64) -> Result<CardDecrypted, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_decrypted(id)
}

#[tauri::command]
fn update_card_status(id: i64, status: String) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.update_card_status(id, &status)?;
        let _ = db.log_event("card.status_changed",
            &format!("Card {} status → {}", id, status), Some("card"), Some(&id.to_string()));
        Ok(())
    })
}

#[tauri::command]
fn update_card_notes(id: i64, notes: String) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.update_card_notes(id, &notes)
    })
}

#[tauri::command]
fn delete_card(id: i64) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.delete_card(id)?;
        let _ = db.log_event("card.deleted", &format!("Card {} deleted", id),
            Some("card"), Some(&id.to_string()));
        Ok(())
    })
}

#[tauri::command]
fn bulk_update_cards(ids: Vec<i64>, status: String) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_update_status(&ids, &status)?;
        let _ = db.log_event("card.bulk_status",
            &format!("{} cards → {}", ids.len(), status), Some("card"), None);
        Ok(())
    })
}

#[tauri::command]
fn bulk_delete_cards(ids: Vec<i64>) -> Result<(), String> {
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_delete(&ids)?;
        let _ = db.log_event("card.bulk_deleted",
            &format!("{} cards deleted", ids.len()), Some("card"), None);
        Ok(())
    })
}

#[tauri::command]
fn export_cards(ids: Vec<i64>, format: String) -> Result<String, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.export_cards(&ids, &format)
}

#[tauri::command]
fn enrich_bin(bin: String) -> Result<BinInfo, String> {
    let guard  = state().db.lock().map_err(|e| e.to_string())?;
    let api_key = guard.get_config("bin_api_key")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    drop(guard);
    fetch_bin_info(&bin, &api_key)
}

// ─────────────────────────────────────────
//  Profiles + Drops
// ─────────────────────────────────────────

#[tauri::command]
fn create_profile(card_id: i64, notes: Option<String>) -> Result<Profile, String> {
    with_db!(db, { db.create_profile(card_id, notes) })
}
#[tauri::command]
fn get_profiles(filter: ProfileFilter, page: u32, per_page: u32) -> Result<PaginatedProfiles, String> {
    with_db!(db, { db.get_profiles(&filter, page, per_page) })
}
#[tauri::command]
fn get_profile(id: String) -> Result<ProfileDetail, String> {
    with_db!(db, { db.get_profile_detail(&id) })
}
#[tauri::command]
fn get_profile_detail(id: String) -> Result<ProfileDetail, String> {
    with_db!(db, { db.get_profile_detail(&id) })
}
#[tauri::command]
fn update_profile(id: String, notes: String) -> Result<(), String> {
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}
#[tauri::command]
fn update_profile_notes(id: String, notes: String) -> Result<(), String> {
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}
#[tauri::command]
fn delete_profile(id: String) -> Result<(), String> {
    with_db!(db, { db.delete_profile(&id) })
}
#[tauri::command]
fn duplicate_profile(id: String) -> Result<Profile, String> {
    with_db!(db, { db.duplicate_profile(&id) })
}
#[tauri::command]
fn find_duplicate_profiles() -> Result<Vec<Vec<Profile>>, String> {
    with_db!(db, { db.find_duplicate_profiles() })
}

#[tauri::command]
fn add_drop(profile_id: String, drop: DropInput) -> Result<Drop, String> {
    with_db!(db, { db.add_drop(&profile_id, &drop) })
}
#[tauri::command]
fn update_drop(id: i64, drop: DropInput) -> Result<(), String> {
    with_db!(db, { db.update_drop(id, &drop) })
}
#[tauri::command]
fn delete_drop(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_drop(id) })
}
#[tauri::command]
fn set_primary_drop(id: i64, profile_id: String) -> Result<(), String> {
    with_db!(db, { db.set_primary_drop(id, &profile_id) })
}
#[tauri::command]
fn import_drops(profile_id: String, raw: String, mapping: Vec<String>) -> Result<ImportResult, String> {
    // Parse raw lines using column mapping
    let cols = mapping.clone();
    let rows: Vec<DropInput> = raw.lines().filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let get = |key: &str| -> String {
                cols.iter().position(|c| c == key)
                    .and_then(|i| parts.get(i))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            };
            Some(DropInput {
                recipient_name: get("recipient_name"),
                address: get("address"),
                city: get("city"),
                state: get("state"),
                zip: get("zip"),
                country: get("country"),
                phone: get("phone"),
            })
        }).collect();
    with_db!(db, { db.import_drops(&profile_id, rows) })
}
#[tauri::command]
fn find_duplicate_drops() -> Result<Vec<Vec<Drop>>, String> {
    with_db!(db, { db.find_duplicate_drops() })
}

// ─────────────────────────────────────────
//  Email Pool
// ─────────────────────────────────────────

#[tauri::command]
fn add_email(email: String, label: String, notes: String) -> Result<EmailPoolEntry, String> {
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.add_email(&email, label, notes) })
}
#[tauri::command]
fn get_emails(filter: EmailFilter, page: u32, per_page: u32) -> Result<PaginatedEmails, String> {
    with_db!(db, { db.get_emails(&filter, page, per_page) })
}
#[tauri::command]
fn update_email(id: i64, label: String, notes: String) -> Result<(), String> {
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.update_email(id, label, notes) })
}
#[tauri::command]
fn block_email(id: i64, blocked: bool) -> Result<(), String> {
    with_db!(db, { db.block_email(id, blocked) })
}
#[tauri::command]
fn delete_email(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_email(id) })
}
#[tauri::command]
fn get_clean_email_for_shop(shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
    with_db!(db, { db.get_clean_email_for_shop(shop_id) })
}

// ─────────────────────────────────────────
//  Proxies
// ─────────────────────────────────────────

#[tauri::command]
fn add_proxy(input: ProxyInput) -> Result<Proxy, String> {
    with_db!(db, { db.add_proxy(&input) })
}
#[tauri::command]
fn import_proxies(raw: String) -> Result<ImportResult, String> {
    with_db!(db, { db.import_proxies(&raw) })
}
#[tauri::command]
fn get_proxies(filter: ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
    with_db!(db, { db.get_proxies(&filter, page, per_page) })
}
#[tauri::command]
fn update_proxy(id: i64, input: ProxyInput) -> Result<(), String> {
    with_db!(db, { db.update_proxy(id, &input) })
}
#[tauri::command]
fn block_proxy(id: i64, blocked: bool) -> Result<(), String> {
    with_db!(db, { db.block_proxy(id, blocked) })
}
#[tauri::command]
fn delete_proxy(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_proxy(id) })
}

#[tauri::command]
fn test_proxy_connection(host: String, port: u16) -> Result<bool, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    let addr = format!("{}:{}", host, port);
    let addrs: Vec<_> = addr.to_socket_addrs().map_err(|e| e.to_string())?.collect();
    for a in addrs {
        if TcpStream::connect_timeout(&a, std::time::Duration::from_secs(5)).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

// ─────────────────────────────────────────
//  Shops
// ─────────────────────────────────────────

#[tauri::command]
fn create_shop(input: ShopInput) -> Result<Shop, String> {
    with_db!(db, { db.create_shop(&input) })
}
#[tauri::command]
fn get_shops(page: u32, per_page: u32, search: String) -> Result<PaginatedShops, String> {
    with_db!(db, { db.get_shops(page, per_page, &search) })
}
#[tauri::command]
fn get_shop(id: i64) -> Result<ShopDetail, String> {
    with_db!(db, { db.get_shop_detail(id) })
}
#[tauri::command]
fn update_shop(id: i64, input: ShopInput) -> Result<(), String> {
    with_db!(db, { db.update_shop(id, &input) })
}
#[tauri::command]
fn delete_shop(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_shop(id) })
}
#[tauri::command]
fn add_shop_product(shop_id: i64, product: ProductInput) -> Result<Product, String> {
    with_db!(db, { db.add_shop_product(shop_id, &product) })
}
#[tauri::command]
fn update_shop_product(id: i64, product: ProductInput) -> Result<(), String> {
    with_db!(db, { db.update_shop_product(id, &product) })
}
#[tauri::command]
fn delete_shop_product(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_shop_product(id) })
}
#[tauri::command]
fn get_shop_smart_suggestions(shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
    with_db!(db, { db.get_shop_smart_suggestions(shop_id, card_id) })
}

// ─────────────────────────────────────────
//  Orders
// ─────────────────────────────────────────

#[tauri::command]
fn create_order(input: OrderInput) -> Result<Order, String> {
    with_db!(db, { db.create_order(&input) })
}
#[tauri::command]
fn get_orders(filter: OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
    with_db!(db, { db.get_orders(&filter, page, per_page) })
}
#[tauri::command]
fn get_order(id: i64) -> Result<OrderDetail, String> {
    with_db!(db, { db.get_order(id) })
}
#[tauri::command]
fn get_latest_order_by_profile(profile_id: String) -> Result<Option<Order>, String> {
    with_db!(db, { db.get_latest_order_by_profile(&profile_id) })
}
#[tauri::command]
fn update_order_status(id: i64, status: String, meta: Option<StatusMeta>) -> Result<(), String> {
    with_db!(db, { db.update_order_status(id, &status, meta.as_ref()) })
}
#[tauri::command]
fn delete_order(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_order(id) })
}
#[tauri::command]
fn run_risk_check(profile_id: String, shop_id: i64, drop_id: Option<i64>, email_pool_id: Option<i64>, proxy_id: Option<i64>) -> Result<RiskCheckResult, String> {
    with_db!(db, {
        let mut result = db.run_risk_check(&profile_id, shop_id)?;
        // Merge global footprint check from server (gracefully skipped if offline/no token)
        let server_warnings = sync::SyncClient::check_risk(&db, &profile_id, shop_id);
        if server_warnings.is_empty() {
            result.offline = true;
        } else {
            result.offline = false;
            result.score = result.score.saturating_add(30);
            result.warnings.extend(server_warnings);
            result.level = if result.score >= 40 { "high" } else if result.score >= 20 { "warning" } else { "safe" }.into();
        }
        Ok(result)
    })
}
#[tauri::command]
fn save_order_template(input: SaveTemplateInput) -> Result<(), String> {
    with_db!(db, { db.save_order_template(&input) })
}
#[tauri::command]
fn get_order_templates(shop_tag: Option<String>) -> Result<Vec<OrderTemplate>, String> {
    with_db!(db, { db.get_order_templates(shop_tag.as_deref()) })
}

// Dashboard — implemented
#[tauri::command]
fn get_dashboard_stats(period: String, from: Option<String>, to: Option<String>) -> Result<DashboardStats, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_dashboard_stats(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_revenue_chart(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<RevenuePoint>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_revenue_chart(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_heatmap_data(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<HeatmapCell>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_heatmap_data(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_top_banks(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<BankStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_top_banks(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_by_country(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<CountryStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_country(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_by_source(period: String, from: Option<String>, to: Option<String>) -> Result<Vec<SourceStats>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_by_source(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_expiring_cards_dashboard(days: u32) -> Result<Vec<ExpiringCard>, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_expiring_cards_dashboard(days)
}

#[tauri::command]
fn export_dashboard_csv(period: String, from: Option<String>, to: Option<String>) -> Result<String, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_dashboard_csv(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
fn get_sidebar_badges() -> Result<SidebarBadges, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_sidebar_badges()
}

// IMAP — implemented
#[tauri::command]
fn add_imap_account(input: ImapInput) -> Result<ImapAccount, String> {
    with_db!(db, { db.add_imap_account(&input) })
}
#[tauri::command]
fn get_imap_accounts() -> Result<Vec<ImapAccount>, String> {
    with_db!(db, { db.get_imap_accounts() })
}
#[tauri::command]
fn update_imap_account(id: i64, input: ImapInput) -> Result<(), String> {
    with_db!(db, { db.update_imap_account(id, &input) })
}
#[tauri::command]
fn delete_imap_account(id: i64) -> Result<(), String> {
    with_db!(db, { db.delete_imap_account(id) })
}
#[tauri::command]
fn toggle_imap_account(id: i64, active: bool) -> Result<(), String> {
    with_db!(db, { db.toggle_imap_account(id, active) })
}
#[tauri::command]
fn get_imap_messages(filter: ImapMsgFilter, page: u32) -> Result<PaginatedMessages, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_imap_messages(&filter, page, 50)
}
#[tauri::command]
fn imap_check_all() -> Result<ImapCheckResult, String> {
    with_db!(db, { imap::ImapPoller::check_all(db) })
}
#[tauri::command]
fn test_imap_connection(id: i64) -> Result<String, String> {
    let (acc, pw) = with_db!(db, { db.get_imap_account_with_password(id) })?;
    imap::ImapPoller::test_connection(&acc.host, acc.port as u16, &acc.login, &pw)
}
#[tauri::command]
fn link_all_imap_accounts() -> Result<u32, String> {
    with_db!(db, { db.link_all_imap_to_email_pool() })
}
#[tauri::command]
fn link_email_to_imap(email_id: i64, imap_account_id: Option<i64>) -> Result<(), String> {
    with_db!(db, {
        db.conn.execute("UPDATE email_pool SET imap_account_id=?1 WHERE id=?2",
            rusqlite::params![imap_account_id, email_id]).map_err(|e| e.to_string())?;
        Ok(())
    })
}

// Activity Log
#[tauri::command]
fn get_activity_log(filter: LogFilter, page: u32) -> Result<PaginatedLog, String> {
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.get_activity_log(&filter, page, 100)
}
#[tauri::command]
fn clear_activity_log() -> Result<(), String> {
    with_db!(db, { db.clear_activity_log() })
}

// Sync
#[tauri::command]
fn get_unsynced_footprints() -> Result<Vec<Footprint>, String> {
    with_db!(db, { db.get_unsynced_footprints_db() })
}
#[tauri::command]
fn mark_footprints_synced(ids: Vec<i64>) -> Result<(), String> {
    with_db!(db, { db.mark_footprints_synced_db(&ids) })
}
#[tauri::command]
fn sync_now() -> Result<SyncResult, String> {
    with_db!(db, { sync::SyncClient::sync_footprints(db) })
}

// Version check
#[tauri::command]
fn get_server_version() -> Result<Option<serde_json::Value>, String> {
    Ok(sync::SyncClient::check_version().map(|(version, notes)| {
        serde_json::json!({ "version": version, "notes": notes })
    }))
}

// Config
#[tauri::command]
fn get_config(key: String) -> Result<Option<String>, String> {
    with_db!(db, { db.get_config(&key).map_err(|e| e.to_string()) })
}
#[tauri::command]
fn set_config(key: String, value: String) -> Result<(), String> {
    with_db!(db, { db.set_config(&key, &value).map_err(|e| e.to_string()) })
}
#[tauri::command]
fn export_backup() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let backup_dir = format!("{}/.config/cc-manager/backups", home);
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let dest = format!("{}/backup_{}.db", backup_dir, now);
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.export_backup_to(&dest)
}
#[tauri::command]
fn import_backup(path: String) -> Result<(), String> {
    // Validate file exists
    if !std::path::Path::new(&path).exists() { return Err("file_not_found".into()); }
    // Just confirm — actual restore requires app restart
    Err("restart_required: Copy the backup file manually and restart".into())
}

// License
#[tauri::command]
fn get_installation_id() -> Result<String, String> {
    with_db!(db, { license::get_or_create_installation_id(db) })
}
#[tauri::command]
fn get_challenge_code() -> Result<String, String> {
    with_db!(db, { license::get_challenge_code(db) })
}
#[tauri::command]
fn activate_license(activation_key: String) -> Result<(), String> {
    with_db!(db, { license::activate(db, &activation_key) })
}
#[tauri::command]
fn get_license_status() -> Result<LicenseStatus, String> {
    with_db!(db, { license::verify_at_startup(db) })
}
#[tauri::command]
fn retry_license_connection() -> Result<LicenseStatus, String> {
    with_db!(db, { license::retry_verify(db) })
}

// Search
#[tauri::command]
fn global_search(query: String) -> Result<SearchResults, String> {
    if query.len() < 2 { return Ok(SearchResults { cards: vec![], profiles: vec![], orders: vec![], shops: vec![], emails: vec![], proxies: vec![] }); }
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    guard.global_search(&query)
}

// Float Window
#[tauri::command]
fn open_float_window(profile_id: String, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("float") {
        let url = format!("float.html?id={}", profile_id);
        let _ = win.eval(&format!("window.location.href='/{}'", url));
        let _ = win.show();
        let _ = win.set_focus();
        with_db!(db, {
            let _ = db.log_event("profile.float_opened", &format!("Profile {} float opened", profile_id), Some("profile"), None);
            Ok(())
        })
    } else {
        Err("float_window_not_found".into())
    }
}

// ─────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────

fn start_background_threads(handle: tauri::AppHandle) {
    // ── Autolock thread (every 30s) ──────────────────────────
    let h = handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if let Some(st) = STATE.get() {
            let should_lock = {
                let db = match st.db.lock() { Ok(d) => d, Err(_) => continue };
                if db.is_locked() { false } else {
                    let timeout_secs = db.get_config("autolock_timeout").ok().flatten()
                        .and_then(|v| if v == "never" { None } else { v.parse::<u64>().ok() })
                        .unwrap_or(300);
                    db.last_activity.lock().map(|t| t.elapsed().as_secs() >= timeout_secs).unwrap_or(false)
                }
            };
            if should_lock {
                if let Ok(mut db) = st.db.lock() { db.clear_encryption(); }
                let _ = h.emit("app_locked", ());
            }
        }
    });

    // ── Sync thread (every 2 min) ────────────────────────────
    let h = handle.clone();
    std::thread::spawn(move || {
        let mut last_online: Option<bool> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(120));
            if let Some(st) = STATE.get() {
                let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
                if !db_locked {
                    // Check server reachability
                    let online = sync::SyncClient::check_server_online();
                    if last_online != Some(online) {
                        last_online = Some(online);
                        if online {
                            let _ = h.emit("server_online", ());
                        } else {
                            let _ = h.emit("server_offline", ());
                        }
                    }

                    if online {
                        if let Ok(mut db) = st.db.lock() {
                            if let Ok(res) = sync::SyncClient::sync_footprints(&mut db) {
                                if res.synced > 0 {
                                    let _ = h.emit("sync_completed", serde_json::json!({ "sent": res.synced }));
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // ── IMAP thread (checks every 60s, polls per account interval) ──
    let h = handle.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        if let Some(st) = STATE.get() {
            let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
            if !db_locked {
                let accounts = st.db.lock().ok().and_then(|d| d.get_imap_accounts().ok()).unwrap_or_default();
                for acc in accounts.into_iter().filter(|a| a.is_active) {
                    let should_poll = acc.last_checked.as_ref().map(|lc| {
                        chrono::DateTime::parse_from_rfc3339(lc)
                            .map(|t| chrono::Utc::now().signed_duration_since(t).num_minutes() >= acc.poll_interval)
                            .unwrap_or(true)
                    }).unwrap_or(true);

                    if should_poll {
                        if let Ok(mut db) = st.db.lock() {
                            let _ = imap::ImapPoller::check_account(&mut db, acc.id);
                        }
                        // Emit badge update
                        if let Some(badges) = st.db.lock().ok().and_then(|d| d.get_sidebar_badges().ok()) {
                            let _ = h.emit("badge_update", badges);
                        }
                    }
                }
            }
        }
    });

    // ── Tracking thread (every 30 min, no-op if no API key) ──
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1800));
        if let Some(st) = STATE.get() {
            let api_key = st.db.lock().ok()
                .and_then(|d| d.get_config("tracking_api_key").ok().flatten())
                .filter(|k| !k.is_empty());
            if api_key.is_some() {
                // Tracking API integration would go here
                // (AfterShip/Track17 — requires separate implementation)
            }
        }
    });
}

fn main() {
    let db_p = db_path();
    let db_path_str = db_p.to_str().unwrap_or("cc_manager.db").to_string();
    let db = Database::open(&db_path_str).expect("Failed to open database");
    STATE.set(AppState { db: Mutex::new(db) }).unwrap_or_else(|_| panic!("Failed to set AppState"));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            start_background_threads(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_password, unlock, lock, change_password, is_locked,
            detect_mapping_preview,
            import_cards, get_cards, get_card, reveal_card,
            update_card_status, update_card_notes, delete_card,
            bulk_update_cards, bulk_delete_cards, export_cards, enrich_bin,
            create_profile, get_profiles, get_profile, get_profile_detail,
            update_profile, update_profile_notes,
            delete_profile, duplicate_profile, find_duplicate_profiles,
            add_drop, update_drop, delete_drop, set_primary_drop, import_drops, find_duplicate_drops,
            add_email, get_emails, update_email, block_email, delete_email, get_clean_email_for_shop,
            add_proxy, import_proxies, get_proxies, update_proxy, block_proxy, delete_proxy, test_proxy_connection,
            create_shop, get_shops, get_shop, update_shop, delete_shop,
            add_shop_product, update_shop_product, delete_shop_product, get_shop_smart_suggestions,
            create_order, get_orders, get_order, get_latest_order_by_profile, update_order_status, delete_order,
            run_risk_check, save_order_template, get_order_templates,
            get_unsynced_footprints, mark_footprints_synced, sync_now,
            get_dashboard_stats, get_revenue_chart, get_heatmap_data, get_top_banks,
            get_by_country, get_by_source, get_expiring_cards_dashboard,
            export_dashboard_csv, get_sidebar_badges,
            add_imap_account, get_imap_accounts, update_imap_account,
            delete_imap_account, toggle_imap_account, get_imap_messages,
            imap_check_all, test_imap_connection, link_email_to_imap, link_all_imap_accounts,
            get_activity_log, clear_activity_log,
            get_config, set_config, export_backup, import_backup,
            get_installation_id, get_challenge_code, activate_license,
            get_license_status, retry_license_connection,
            global_search, open_float_window, get_server_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
