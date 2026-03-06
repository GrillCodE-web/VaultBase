#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod encryption;
mod imap;
mod license;
mod models;
mod parser;
mod sync;

use database::{Database, fetch_bin_info};
use encryption::{FieldEncryption, PasswordValidation, generate_salt};
use models::*;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::Mutex;
use std::path::PathBuf;

// ─────────────────────────────────────────
//  Global state
// ─────────────────────────────────────────

struct AppState { db: Mutex<Database> }
static STATE: OnceCell<AppState> = OnceCell::new();
fn state() -> &'static AppState { STATE.get().expect("AppState not initialized") }

fn db_path() -> PathBuf {
    let mut p = std::env::current_dir().unwrap_or_default();
    p.push("cc_manager.db");
    p
}

macro_rules! ni { () => { Err("not_implemented".to_string()) }; }

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
        Ok(())
    })
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
//  Profile commands (stubs)
// ─────────────────────────────────────────

#[tauri::command] fn create_profile(_card_id: i64, _notes: String) -> Result<Profile, String> { ni!() }
#[tauri::command] fn get_profiles(_filter: ProfileFilter, _page: u32, _per_page: u32) -> Result<PaginatedProfiles, String> { ni!() }
#[tauri::command] fn get_profile(_id: String) -> Result<ProfileDetail, String> { ni!() }
#[tauri::command] fn update_profile(_id: String, _notes: String) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_profile(_id: String) -> Result<(), String> { ni!() }
#[tauri::command] fn duplicate_profile(_id: String) -> Result<Profile, String> { ni!() }
#[tauri::command] fn find_duplicate_profiles() -> Result<Vec<Vec<Profile>>, String> { ni!() }

// Drop stubs
#[tauri::command] fn add_drop(_profile_id: String, _drop: DropInput) -> Result<Drop, String> { ni!() }
#[tauri::command] fn update_drop(_id: i64, _drop: DropInput) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_drop(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn set_primary_drop(_id: i64, _profile_id: String) -> Result<(), String> { ni!() }
#[tauri::command] fn import_drops(_profile_id: String, _raw: String, _mapping: Vec<String>) -> Result<ImportResult, String> { ni!() }
#[tauri::command] fn find_duplicate_drops() -> Result<Vec<Vec<Drop>>, String> { ni!() }

// Email Pool stubs
#[tauri::command] fn add_email(_email: String, _label: String, _notes: String) -> Result<EmailPoolEntry, String> { ni!() }
#[tauri::command] fn get_emails(_page: u32, _per_page: u32) -> Result<PaginatedEmails, String> { ni!() }
#[tauri::command] fn update_email(_id: i64, _label: String, _notes: String) -> Result<(), String> { ni!() }
#[tauri::command] fn block_email(_id: i64, _blocked: bool) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_email(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn get_clean_email_for_shop(_shop_id: i64) -> Result<Option<EmailPoolEntry>, String> { ni!() }

// Proxy stubs
#[tauri::command] fn add_proxy(_input: ProxyInput) -> Result<Proxy, String> { ni!() }
#[tauri::command] fn import_proxies(_raw: String) -> Result<ImportResult, String> { ni!() }
#[tauri::command] fn get_proxies(_page: u32, _per_page: u32) -> Result<PaginatedProxies, String> { ni!() }
#[tauri::command] fn update_proxy(_id: i64, _input: ProxyInput) -> Result<(), String> { ni!() }
#[tauri::command] fn block_proxy(_id: i64, _blocked: bool) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_proxy(_id: i64) -> Result<(), String> { ni!() }

// Shop stubs
#[tauri::command] fn create_shop(_input: ShopInput) -> Result<Shop, String> { ni!() }
#[tauri::command] fn get_shops(_page: u32, _per_page: u32, _search: String) -> Result<PaginatedShops, String> { ni!() }
#[tauri::command] fn get_shop(_id: i64) -> Result<ShopDetail, String> { ni!() }
#[tauri::command] fn update_shop(_id: i64, _input: ShopInput) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_shop(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn add_shop_product(_shop_id: i64, _product: ProductInput) -> Result<Product, String> { ni!() }
#[tauri::command] fn delete_shop_product(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn get_shop_smart_suggestions(_shop_id: i64, _card_id: i64) -> Result<Vec<Suggestion>, String> { ni!() }

// Order stubs
#[tauri::command] fn create_order(_input: OrderInput) -> Result<Order, String> { ni!() }
#[tauri::command] fn get_orders(_filter: OrderFilter, _page: u32, _per_page: u32) -> Result<PaginatedOrders, String> { ni!() }
#[tauri::command] fn get_order(_id: i64) -> Result<OrderDetail, String> { ni!() }
#[tauri::command] fn update_order_status(_id: i64, _status: String, _meta: Option<StatusMeta>) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_order(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn run_risk_check(_profile_id: String, _shop_id: i64, _drop_id: Option<i64>, _email_pool_id: Option<i64>, _proxy_id: Option<i64>) -> Result<RiskCheckResult, String> { ni!() }
#[tauri::command] fn save_order_template(_name: String, _shop_tag: String, _items: String) -> Result<(), String> { ni!() }
#[tauri::command] fn get_order_templates(_shop_tag: Option<String>) -> Result<Vec<OrderTemplate>, String> { ni!() }

// Footprints stubs
#[tauri::command] fn get_unsynced_footprints() -> Result<Vec<Footprint>, String> { ni!() }
#[tauri::command] fn mark_footprints_synced(_ids: Vec<i64>) -> Result<(), String> { ni!() }
#[tauri::command] fn sync_now() -> Result<SyncResult, String> { ni!() }

// Dashboard stubs
#[tauri::command] fn get_dashboard_stats(_period: String, _from: Option<String>, _to: Option<String>) -> Result<DashboardStats, String> { ni!() }
#[tauri::command] fn get_heatmap_data(_period: String) -> Result<Vec<HeatmapCell>, String> { ni!() }
#[tauri::command] fn get_top_banks(_period: String) -> Result<Vec<BankStats>, String> { ni!() }
#[tauri::command] fn get_by_country(_period: String) -> Result<Vec<CountryStats>, String> { ni!() }
#[tauri::command] fn get_by_source(_period: String) -> Result<Vec<SourceStats>, String> { ni!() }
#[tauri::command] fn get_expiring_cards(_days: u32) -> Result<Vec<ExpiringCard>, String> { ni!() }

// IMAP stubs
#[tauri::command] fn add_imap_account(_input: ImapInput) -> Result<ImapAccount, String> { ni!() }
#[tauri::command] fn get_imap_accounts() -> Result<Vec<ImapAccount>, String> { ni!() }
#[tauri::command] fn update_imap_account(_id: i64, _input: ImapInput) -> Result<(), String> { ni!() }
#[tauri::command] fn delete_imap_account(_id: i64) -> Result<(), String> { ni!() }
#[tauri::command] fn toggle_imap_account(_id: i64, _active: bool) -> Result<(), String> { ni!() }
#[tauri::command] fn get_imap_messages(_account_id: i64, _page: u32) -> Result<PaginatedMessages, String> { ni!() }

// Activity Log stubs
#[tauri::command] fn get_activity_log(_filter: LogFilter, _page: u32) -> Result<PaginatedLog, String> { ni!() }
#[tauri::command] fn clear_activity_log() -> Result<(), String> { ni!() }

// Config
#[tauri::command]
fn get_config(key: String) -> Result<Option<String>, String> {
    with_db!(db, { db.get_config(&key).map_err(|e| e.to_string()) })
}
#[tauri::command]
fn set_config(key: String, value: String) -> Result<(), String> {
    with_db!(db, { db.set_config(&key, &value).map_err(|e| e.to_string()) })
}
#[tauri::command] fn export_backup() -> Result<String, String> { ni!() }
#[tauri::command] fn import_backup(_path: String) -> Result<(), String> { ni!() }

// License
#[tauri::command] fn get_installation_id() -> Result<String, String> { Ok(license::get_installation_id()) }
#[tauri::command] fn activate_license(_key: String) -> Result<(), String> { ni!() }
#[tauri::command] fn get_license_status() -> Result<LicenseStatus, String> { license::get_license_status() }

// Search / Float
#[tauri::command] fn global_search(_query: String) -> Result<SearchResults, String> { ni!() }
#[tauri::command] fn open_float_window(_profile_id: String) -> Result<(), String> { ni!() }

// ─────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────

fn main() {
    let db = Database::open(db_path().to_str().unwrap_or("cc_manager.db"))
        .expect("Failed to open database");
    STATE.set(AppState { db: Mutex::new(db) }).expect("Failed to set AppState");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            setup_password, unlock, lock, change_password, is_locked,
            detect_mapping_preview,
            import_cards, get_cards, get_card, reveal_card,
            update_card_status, update_card_notes, delete_card,
            bulk_update_cards, bulk_delete_cards, export_cards, enrich_bin,
            create_profile, get_profiles, get_profile, update_profile,
            delete_profile, duplicate_profile, find_duplicate_profiles,
            add_drop, update_drop, delete_drop, set_primary_drop, import_drops, find_duplicate_drops,
            add_email, get_emails, update_email, block_email, delete_email, get_clean_email_for_shop,
            add_proxy, import_proxies, get_proxies, update_proxy, block_proxy, delete_proxy,
            create_shop, get_shops, get_shop, update_shop, delete_shop,
            add_shop_product, delete_shop_product, get_shop_smart_suggestions,
            create_order, get_orders, get_order, update_order_status, delete_order,
            run_risk_check, save_order_template, get_order_templates,
            get_unsynced_footprints, mark_footprints_synced, sync_now,
            get_dashboard_stats, get_heatmap_data, get_top_banks,
            get_by_country, get_by_source, get_expiring_cards,
            add_imap_account, get_imap_accounts, update_imap_account,
            delete_imap_account, toggle_imap_account, get_imap_messages,
            get_activity_log, clear_activity_log,
            get_config, set_config, export_backup, import_backup,
            get_installation_id, activate_license, get_license_status,
            global_search, open_float_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
