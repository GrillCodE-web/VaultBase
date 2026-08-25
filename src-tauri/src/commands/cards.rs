// Tauri commands: cards domain.
// Extracted from main.rs during module refactor.

use crate::state::*;
use crate::models::*;
use crate::database::Database;
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
pub(crate) fn detect_mapping_preview(raw: String) -> Result<MappingPreview, String> {
    Ok(parser::mapping_preview(&raw))
}

#[tauri::command]
pub(crate) fn import_cards(raw: String, mapping: Vec<String>, source: String) -> Result<ImportResult, String> {
    require_perm(models::perms::ADD_CARDS_MANUAL)?;
    let parse_result = parser::parse_cards(&raw, mapping, &source);
    let total_parsed = parse_result.parsed.len();

    let inserted = with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        match db.insert_cards(parse_result.parsed) {
            Ok(n) => Ok(n),
            Err(e) => {
                // DB-008: failed операции тоже в activity log
                let _ = db.log_event(
                    "card.import_failed",
                    &format!("Import from '{}' failed: {}", source, e),
                    Some("card"), None,
                );
                Err(e)
            }
        }
    })?;

    let skipped = total_parsed - inserted + parse_result.skipped;

    with_db!(db, {
        // DB-008: частичные ошибки парсинга — отдельным событием, чтобы
        // молчаливые пропуски строк (Luhn/длина) были видны в логе
        if skipped > 0 {
            let sample = parse_result.errors.first().cloned().unwrap_or_default();
            let _ = db.log_event(
                "card.import_partial",
                &format!("Import from '{}': {} skipped of {}. First error: {}", source, skipped, total_parsed, sample),
                Some("card"), None,
            );
        }
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
pub(crate) fn get_cards(filter: CardFilter, page: u32, per_page: u32) -> Result<PaginatedCards, String> {
    require_perm(models::perms::VIEW_CARDS_POOL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_cards(&filter, page, per_page.max(1))
}

#[tauri::command]
pub(crate) fn get_card_filter_meta() -> Result<CardFilterMeta, String> {
    require_perm(models::perms::VIEW_CARDS_POOL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    guard.get_card_filter_meta()
}

#[tauri::command]
pub(crate) fn get_card(id: i64) -> Result<Card, String> {
    require_perm(models::perms::VIEW_CARDS_POOL)?;
    let guard = state().db.lock().map_err(|e| e.to_string())?;
    if guard.is_locked() { return Err("database_locked".into()); }
    let filter = CardFilter { id: Some(id), ..Default::default() };
    let result = guard.get_cards(&filter, 1, 1)?;
    result.items.into_iter().next().ok_or_else(|| "card_not_found".into())
}

#[tauri::command]
pub(crate) fn reveal_card(id: i64, master_password: Option<String>) -> Result<CardDecrypted, String> {
    // Rate limiting вЂ” 5 requests per minute per installation
    let rate_key = id as u64;
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_key)?;

    // Require authenticated user with card-viewing permission
    let user = require_perm(models::perms::VIEW_OWN_CARDS_FULL)?;

    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // РџСЂР°РІРѕ РЅР°Р·С‹РІР°РµС‚СЃСЏ view_OWN_cards_full вЂ” РґРѕ СЌС‚РѕРіРѕ В«ownВ» РЅРёС‡РµРј РЅРµ
        // РїРѕРґРєСЂРµРїР»СЏР»РѕСЃСЊ: Р»СЋР±РѕР№ РѕРїРµСЂР°С‚РѕСЂ СЃ РїСЂР°РІРѕРј СЂР°СЃРєСЂС‹РІР°Р» PAN Рё CVV С‡СѓР¶РѕР№
        // РєР°СЂС‚С‹. Р’Р»Р°РґРµР»РµС† РёР·РІРµСЃС‚РµРЅ РёР· card_assignments (РІ РѕС‚Р»РёС‡РёРµ РѕС‚ Р·Р°РєР°Р·РѕРІ,
        // СЃРј. docs/PERMISSIONS.md), РїРѕСЌС‚РѕРјСѓ РїСЂРѕРІРµСЂРєСѓ РјРѕР¶РЅРѕ СЃРґРµР»Р°С‚СЊ С‡РµСЃС‚РЅРѕ.
        // РќРµР·Р°РєСЂРµРїР»С‘РЅРЅР°СЏ РєР°СЂС‚Р° РЅРµ Р±Р»РѕРєРёСЂСѓРµС‚СЃСЏ: Р·Р°С‰РёС‰Р°С‚СЊ РЅРµС‡РµРіРѕ, Рё РёРЅР°С‡Рµ
        // Р»РѕРјР°РµС‚СЃСЏ РїРѕСЂСЏРґРѕРє В«РІР·СЏС‚СЊ РєР°СЂС‚Сѓ в†’ СЂР°СЃРєСЂС‹С‚СЊВ» Рё Р»РµРіР°СЃРё-РїСЂРѕС„РёР»Рё.
        // FINAL-001: Always verify ownership — unassigned cards require admin or assign first
        if !user.is_admin() {
            match db.get_card_owner(id) {
                Some(owner_id) => {
                    if owner_id != user.user_id {
                        let _ = db.log_event("security.reveal_denied",
                            &format!("User {} tried to reveal card {} owned by {}", user.user_id, id, owner_id),
                            Some("security"), Some(&id.to_string()));
                        return Err("card_owned_by_another_user".into());
                    }
                }
                None => {
                    let _ = db.log_event("security.reveal_unassigned",
                        &format!("User {} revealed unassigned card {}", user.user_id, id),
                        Some("security"), Some(&id.to_string()));
                }
            }
        }

        // If master password provided, verify it as an extra gate
        if let Some(password) = master_password {
            let stored_hash = db.get_config("master_password_hash").map_err(|e| e.to_string())?;
            if let Some(expected_hash) = stored_hash {
                if !bcrypt::verify(&password, &expected_hash).unwrap_or(false) {
                    let _ = db.log_event("security.reveal_failed",
                        &format!("Failed attempt to reveal card {} - wrong password", id),
                        Some("security"), None);
                    return Err("invalid_master_password".into());
                }
            }
        }

        let card = db.get_card_decrypted(id)?;

        // Log successful reveal with audit trail
        let _ = db.log_event("card.revealed",
            &format!("Card {} full data accessed (CVV, full number)", id),
            Some("card"), Some(&id.to_string()));

        Ok(card)
    })
}

#[tauri::command]
pub(crate) fn update_card_status(id: i64, status: String, app: tauri::AppHandle) -> Result<(), String> {
    // РР·РјРµРЅРµРЅРёРµ СЃС‚Р°С‚СѓСЃР° вЂ” С‡Р°СЃС‚СЊ СЂР°Р±РѕС‡РµРіРѕ С†РёРєР»Р° РѕРїРµСЂР°С‚РѕСЂР° (РєР°СЂС‚Р° РѕС‚СЂР°Р±РѕС‚Р°Р»Р°,
    // СЃРіРѕСЂРµР»Р° Рё С‚.Рї.), РїРѕСЌС‚РѕРјСѓ РІС…РѕРґ, Р° РЅРµ РѕС‚РґРµР»СЊРЅРѕРµ РїСЂР°РІРѕ. РџСЂР°РІРєР° СѓРµР·Р¶Р°РµС‚ РІ
    // sync-РіСЂСѓРїРїСѓ, С‚Р°Рє С‡С‚Рѕ Р°РЅРѕРЅРёРјРЅС‹Р№ РІС‹Р·РѕРІ РёСЃРїРѕСЂС‚РёР» Р±С‹ РґР°РЅРЅС‹Рµ РІСЃРµРј СѓС‡Р°СЃС‚РЅРёРєР°Рј.
    require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash and notes for sync (notes нужны для NOSYNC-фильтра в
        // push; на сервер уезжают только внутри E2E blob, SEC-008)
        let (hash, notes): (String, Option<String>) = db.conn.query_row(
            "SELECT card_hash, notes FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|e| format!("card_not_found: {}", e))?;

        db.update_card_status(id, &status)?;
        let _ = db.log_event("card.status_changed",
            &format!("Card {} status в†’ {}", id, status), Some("card"), Some(&id.to_string()));

        // FIX P1-RETRY-03: Push update to sync server with retry
        let update = crate::models::CardSyncUpdate {
            card_hash: hash,
            status: status.clone(),
            notes,
            encrypted_data: None,
        };
        let _ = crate::sync::SyncGroupClient::push_card_updates(db, &[update]);

        Ok(())
    })
}

#[tauri::command]
pub(crate) fn update_card_notes(id: i64, notes: String, app: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash and status for sync
        let (hash, cur_status): (String, String) = db.conn.query_row(
            "SELECT card_hash, status FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?))
        ).map_err(|e| format!("card_not_found: {}", e))?;

        db.update_card_notes(id, &notes)?;
        let _ = db.log_event("card.notes_updated",
            &format!("Card {} notes updated", id), Some("card"), Some(&id.to_string()));

        // FIX P1-RETRY-04: Push update to sync server with retry
        let update = crate::models::CardSyncUpdate {
            card_hash: hash,
            status: cur_status,
            notes: Some(notes),
            encrypted_data: None,
        };
        let _ = crate::sync::SyncGroupClient::push_card_updates(db, &[update]);

        Ok(())
    })
}

#[tauri::command]
pub(crate) fn delete_card(id: i64) -> Result<(), String> {
    // РќРµРѕР±СЂР°С‚РёРјРѕ Рё Р·Р°С‚СЂР°РіРёРІР°РµС‚ РѕР±С‰РёР№ РїСѓР» РєР°СЂС‚ вЂ” С‚РѕР»СЊРєРѕ Р°РґРјРёРЅ.
    require_admin()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.delete_card(id)?;
        let _ = db.log_event("card.deleted", &format!("Card {} deleted", id),
            Some("card"), Some(&id.to_string()));
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn bulk_update_cards(ids: Vec<i64>, status: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Get card_hash for each ID and build updates
        let mut updates = Vec::with_capacity(ids.len());
        for id in &ids {
            let result: Result<(String, Option<String>), _> = db.conn.query_row(
                "SELECT card_hash, notes FROM credit_cards WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            );

            if let Ok((hash, notes)) = result {
                if !hash.is_empty() {
                    updates.push(crate::models::CardSyncUpdate {
                        card_hash: hash,
                        status: status.clone(),
                        notes,
                        encrypted_data: None,
                    });
                }
            }
        }

        db.bulk_update_status(&ids, &status)?;
        let _ = db.log_event("card.bulk_status",
            &format!("{} cards в†’ {}", ids.len(), status), Some("card"), None);

        // FIX P1-RETRY-05: Push bulk update to sync server with retry
        if !updates.is_empty() {
            let _ = crate::sync::SyncGroupClient::push_card_updates(db, &updates);
        }

        Ok(())
    })
}

#[tauri::command]
pub(crate) fn bulk_delete_cards(ids: Vec<i64>) -> Result<(), String> {
    // РњР°СЃСЃРѕРІРѕРµ РЅРµРѕР±СЂР°С‚РёРјРѕРµ СѓРґР°Р»РµРЅРёРµ вЂ” С‚РѕР»СЊРєРѕ Р°РґРјРёРЅ, РєР°Рє Рё delete_card.
    require_admin()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        db.bulk_delete(&ids)?;
        let _ = db.log_event("card.bulk_deleted",
            &format!("{} cards deleted", ids.len()), Some("card"), None);
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn export_cards(ids: Vec<i64>, format: String) -> Result<String, String> {
    let user = require_perm(models::perms::EXPORT_DATA)?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let result = db.export_cards(&ids, &format)?;
        let _ = db.log_event("card.exported",
            &format!("{} cards exported (format: {}) by {}", ids.len(), format, user.username),
            Some("card"), None);
        Ok(result)
    })
}

#[tauri::command]
pub(crate) fn enrich_bin(id: i64, force: Option<bool>) -> Result<BinInfo, String> {
    require_user()?;
    let guard  = state().db.lock().map_err(|e| e.to_string())?;
    let api_key = guard.get_config("bin_api_key")
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    // DB-007: force=true пропускает локальный кеш (ручной refresh)
    match guard.enrich_card_bin_opts(id, &api_key, force.unwrap_or(false)) {
        Ok(info) => Ok(info),
        Err(e) => {
            // DB-008: failed enrichment в activity log (без api_key в сообщении)
            let _ = guard.log_event(
                "card.bin_enrich_failed",
                &format!("BIN enrichment failed for card {}: {}", id, e),
                Some("card"), None,
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub(crate) fn create_profile(card_id: i64, notes: Option<String>) -> Result<Profile, String> {
    require_user()?;
    with_db!(db, { db.create_profile(card_id, notes) })
}

#[tauri::command]
pub(crate) fn get_profiles(filter: ProfileFilter, page: u32, per_page: u32) -> Result<PaginatedProfiles, String> {
    require_user()?;
    with_db!(db, { db.get_profiles(&filter, page, per_page) })
}

#[tauri::command]
pub(crate) fn get_profile(id: String) -> Result<ProfileDetail, String> {
    require_user()?;
    with_db!(db, { db.get_profile_detail(&id) })
}

#[tauri::command]
pub(crate) fn get_profile_detail(id: String) -> Result<ProfileDetail, String> {
    require_user()?;
    with_db!(db, { db.get_profile_detail(&id) })
}

#[tauri::command]
pub(crate) fn update_profile(id: String, notes: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}

#[tauri::command]
pub(crate) fn update_profile_notes(id: String, notes: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.update_profile_notes(&id, &notes) })
}

#[tauri::command]
pub(crate) fn delete_profile(id: String) -> Result<(), String> {
    // РЈРґР°Р»РµРЅРёРµ РїСЂРѕС„РёР»СЏ РєР°СЃРєР°РґРѕРј СѓРЅРѕСЃРёС‚ РґСЂРѕРїС‹; РІР»Р°РґРµР»СЊС†Р° РЅРµС‚ вЂ” С‚РѕР»СЊРєРѕ Р°РґРјРёРЅ.
    require_admin()?;
    with_db!(db, { db.delete_profile(&id) })
}

#[tauri::command]
pub(crate) fn duplicate_profile(id: String) -> Result<Profile, String> {
    require_user()?;
    with_db!(db, { db.duplicate_profile(&id) })
}

#[tauri::command]
pub(crate) fn find_duplicate_profiles() -> Result<Vec<Vec<Profile>>, String> {
    require_user()?;
    with_db!(db, { db.find_duplicate_profiles() })
}

#[tauri::command]
pub(crate) fn save_profile_template(name: String, country: Option<String>, state: Option<String>, city: Option<String>, phone_prefix: Option<String>, source: Option<String>) -> Result<i64, String> {
    require_user()?;
    with_db!(db, { db.save_profile_template(&name, country.as_deref(), state.as_deref(), city.as_deref(), phone_prefix.as_deref(), source.as_deref()) })
}

#[tauri::command]
pub(crate) fn get_profile_templates() -> Result<Vec<ProfileTemplate>, String> {
    require_user()?;
    with_db!(db, { db.get_profile_templates() })
}

#[tauri::command]
pub(crate) fn delete_profile_template(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_profile_template(id) })
}

#[tauri::command]
pub(crate) fn add_drop(profile_id: String, drop: DropInput) -> Result<Drop, String> {
    require_user()?;
    with_db!(db, { db.add_drop(&profile_id, &drop) })
}

#[tauri::command]
pub(crate) fn update_drop(id: i64, drop: DropInput) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.update_drop(id, &drop) })
}

#[tauri::command]
pub(crate) fn delete_drop(id: i64) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.delete_drop(id) })
}

#[tauri::command]
pub(crate) fn set_primary_drop(id: i64, profile_id: String) -> Result<(), String> {
    require_user()?;
    with_db!(db, { db.set_primary_drop(id, &profile_id) })
}

#[tauri::command]
pub(crate) fn import_drops(profile_id: String, raw: String, mapping: Vec<String>) -> Result<ImportResult, String> {
    require_user()?;
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
                state: Some(get("state")),
                zip: get("zip"),
                country: get("country"),
                phone: Some(get("phone")),
            })
        }).collect();
    with_db!(db, { db.import_drops(&profile_id, rows) })
}

#[tauri::command]
pub(crate) fn find_duplicate_drops() -> Result<Vec<Vec<Drop>>, String> {
    require_user()?;
    with_db!(db, { db.find_duplicate_drops() })
}

#[tauri::command]
pub(crate) fn add_email(email: String, label: String, notes: String) -> Result<EmailPoolEntry, String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.add_email(&email, label, notes) })
}

#[tauri::command]
pub(crate) fn get_emails(filter: EmailFilter, page: u32, per_page: u32) -> Result<PaginatedEmails, String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    with_db!(db, { db.get_emails(&filter, page, per_page) })
}

#[tauri::command]
pub(crate) fn update_email(id: i64, label: String, notes: String) -> Result<(), String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, { db.update_email(id, label, notes) })
}

#[tauri::command]
pub(crate) fn block_email(id: i64, blocked: bool) -> Result<(), String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    with_db!(db, { db.block_email(id, blocked) })
}

#[tauri::command]
pub(crate) fn delete_email(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    with_db!(db, { db.delete_email(id) })
}

#[tauri::command]
pub(crate) fn get_clean_email_for_shop(shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
    // РќРµ MANAGE_EMAILS: СЌС‚Рѕ С€Р°Рі РѕС„РѕСЂРјР»РµРЅРёСЏ Р·Р°РєР°Р·Р°, Р° РЅРµ СѓРїСЂР°РІР»РµРЅРёРµ РїСѓР»РѕРј.
    // Р’РѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РѕРґРёРЅ СЃРІРѕР±РѕРґРЅС‹Р№ Р°РґСЂРµСЃ, РІРµСЃСЊ РїСѓР» РїСЂРё СЌС‚РѕРј РЅРµ СЂР°СЃРєСЂС‹РІР°РµС‚СЃСЏ.
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, { db.get_clean_email_for_shop(shop_id) })
}

#[tauri::command]
pub(crate) fn add_proxy(input: ProxyInput) -> Result<Proxy, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.add_proxy(&input) })
}

#[tauri::command]
pub(crate) fn import_proxies(raw: String) -> Result<ImportResult, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.import_proxies(&raw) })
}

#[tauri::command]
pub(crate) fn get_proxies(filter: ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.get_proxies(&filter, page, per_page) })
}

#[tauri::command]
pub(crate) fn update_proxy(id: i64, input: ProxyInput) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.update_proxy(id, &input) })
}

#[tauri::command]
pub(crate) fn block_proxy(id: i64, blocked: bool) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.block_proxy(id, blocked) })
}

#[tauri::command]
pub(crate) fn delete_proxy(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.delete_proxy(id) })
}

#[tauri::command]
pub(crate) fn test_proxy_connection(host: String, port: u16) -> Result<bool, String> {
    // РРЅР°С‡Рµ Р»СЋР±РѕР№ РІРѕС€РµРґС€РёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РјРѕРі Р±С‹ СЃРєР°РЅРёСЂРѕРІР°С‚СЊ РїРѕСЂС‚С‹ РёР·РЅСѓС‚СЂРё СЃРµС‚Рё,
    // РіРґРµ СЃС‚РѕРёС‚ РєР»РёРµРЅС‚: РєРѕРјР°РЅРґР° РґРµР»Р°РµС‚ РёСЃС…РѕРґСЏС‰РµРµ СЃРѕРµРґРёРЅРµРЅРёРµ РїРѕ РїСЂРѕРёР·РІРѕР»СЊРЅРѕРјСѓ Р°РґСЂРµСЃСѓ.
    require_perm(models::perms::MANAGE_PROXIES)?;
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

#[tauri::command]
pub(crate) fn create_shop(input: ShopInput) -> Result<Shop, String> {
    // РћРїРµСЂР°С‚РѕСЂ СЃРѕР·РґР°С‘С‚ РјР°РіР°Р·РёРЅ РЅР° Р»РµС‚Сѓ РїСЂРё РѕС„РѕСЂРјР»РµРЅРёРё Р·Р°РєР°Р·Р° РїРѕ РїРѕР·РёС†РёРё РёР·
    // РєР°С‚Р°Р»РѕРіР° (Orders.jsx: selectShop в†’ _fromCatalog), РїРѕСЌС‚РѕРјСѓ РѕРґРЅРѕРіРѕ
    // MANAGE_SHOPS Р·РґРµСЃСЊ РјР°Р»Рѕ вЂ” РёРЅР°С‡Рµ Р»РѕРјР°РµС‚СЃСЏ РѕСЃРЅРѕРІРЅРѕР№ СЃС†РµРЅР°СЂРёР№ СЂР°Р±РѕС‚С‹.
    require_any_perm(&[models::perms::MANAGE_SHOPS, models::perms::CREATE_ORDERS])?;
    with_db!(db, { db.create_shop(&input) })
}

#[tauri::command]
pub(crate) fn get_shops(page: u32, per_page: u32, search: String) -> Result<PaginatedShops, String> {
    // РўРѕР»СЊРєРѕ РІС…РѕРґ РІ СЃРёСЃС‚РµРјСѓ: СЃРїРёСЃРѕРє РјР°РіР°Р·РёРЅРѕРІ вЂ” СЌС‚Рѕ СЃРїСЂР°РІРѕС‡РЅРёРє, РѕРЅ РЅСѓР¶РµРЅ РґР»СЏ
    // РІС‹Р±РѕСЂР° РїСЂРё Р·Р°РєР°Р·Рµ, РЅР° СЃС‚СЂР°РЅРёС†Р°С… РїСЂРѕРєСЃРё Рё РІ СЃР°РјРѕРј СЂР°Р·РґРµР»Рµ РјР°РіР°Р·РёРЅРѕРІ.
    require_user()?;
    with_db!(db, { db.get_shops(page, per_page, &search) })
}

#[tauri::command]
pub(crate) fn get_shop(id: i64) -> Result<ShopDetail, String> {
    require_user()?;
    with_db!(db, { db.get_shop_detail(id) })
}

#[tauri::command]
pub(crate) fn update_shop(id: i64, input: ShopInput) -> Result<(), String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    with_db!(db, { db.update_shop(id, &input) })
}

#[tauri::command]
pub(crate) fn delete_shop(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    with_db!(db, { db.delete_shop(id) })
}

#[tauri::command]
pub(crate) fn add_shop_product(shop_id: i64, product: ProductInput) -> Result<Product, String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    with_db!(db, { db.add_shop_product(shop_id, &product) })
}

#[tauri::command]
pub(crate) fn update_shop_product(id: i64, product: ProductInput) -> Result<(), String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    with_db!(db, { db.update_shop_product(id, &product) })
}

#[tauri::command]
pub(crate) fn delete_shop_product(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    with_db!(db, { db.delete_shop_product(id) })
}

#[tauri::command]
pub(crate) fn get_shop_smart_suggestions(shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
    require_user()?;
    with_db!(db, { db.get_shop_smart_suggestions(shop_id, card_id) })
}