// Tauri commands: cards domain.
// Extracted from main.rs during module refactor.

use crate::state::*;
use crate::models::*;
use crate::database::Database;
use crate::models;
use crate::encryption::{FieldEncryption, PasswordValidation, generate_salt};
use crate::license::LicenseStatus;
use crate::rate_limiter;
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
use std::collections::HashMap;

// detect_mapping_preview остаётся: используется импортом дропов
// (Profiles/ImportDropsModal → import_drops). Ручной импорт КАРТ выпилен
// (MGR-018): карты создаёт только менеджер, воркер принимает запечатанные
// срезы (commands/slices.rs).
#[tauri::command]
pub(crate) fn detect_mapping_preview(raw: String) -> Result<MappingPreview, String> {
    Ok(parser::mapping_preview(&raw))
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
    // Rate limiting — 5 requests per minute per installation
    let rate_key = id as u64;
    rate_limiter::check_rate_limit(rate_limiter::RateLimitCategory::Strict, rate_key)?;

    // Require authenticated user with card-viewing permission
    let user = require_perm(models::perms::VIEW_OWN_CARDS_FULL)?;

    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Право называется view_OWN_cards_full — до этого «own» ничем не
        // подкреплялось: любой оператор с правом раскрывал PAN и CVV чужой
        // карты. Владелец известен из card_assignments (в отличие от заказов,
        // см. docs/PERMISSIONS.md), поэтому проверку можно сделать честно.
        // Незакреплённая карта не блокируется: защищать нечего, и иначе
        // ломается порядок «взять карту → раскрыть» и легаси-профили.
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
pub(crate) fn update_card_status(id: i64, status: String, reason: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    // Изменение статуса — часть рабочего цикла оператора (карта отработала,
    // сгорела и т.п.), поэтому вход, а не отдельное право. Правка уезжает в
    // sync-группу, так что анонимный вызов испортил бы данные всем участникам.
    let user = require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Проверка существования карты (404-семантика). MGR-018 (этап E1):
        // пуш в sync-группу выпилен — карты/статусы менеджеру возвращаются
        // отчётами, а не групповым sync'ом; NOSYNC-фильтр ушёл вместе с ним.
        db.conn.query_row(
            "SELECT 1 FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |_| Ok(())
        ).map_err(|e| format!("card_not_found: {}", e))?;

        // MGR-014: причина деклайна — необязательный ручной ввод оператора,
        // структурно пишется в card_status_events (пул №2 менеджера).
        db.update_card_status(id, &status, Some(user.user_id), reason.as_deref())?;
        let _ = db.log_event("card.status_changed",
            &format!("Card {} status → {}", id, status), Some("card"), Some(&id.to_string()));

        Ok(())
    })
}

#[tauri::command]
pub(crate) fn update_card_notes(id: i64, notes: String, app: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // Проверка существования карты (404-семантика, как у update_card_status)
        db.conn.query_row(
            "SELECT 1 FROM credit_cards WHERE id = ?1",
            rusqlite::params![id],
            |_| Ok(())
        ).map_err(|e| format!("card_not_found: {}", e))?;

        db.update_card_notes(id, &notes)?;
        let _ = db.log_event("card.notes_updated",
            &format!("Card {} notes updated", id), Some("card"), Some(&id.to_string()));

        Ok(())
    })
}

#[tauri::command]
pub(crate) fn delete_card(id: i64) -> Result<(), String> {
    // Необратимо и затрагивает общий пул карт — только админ.
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
    let user = require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }

        // MGR-018 (этап E1): групповой push выпилен — просто меняем статусы.
        db.bulk_update_status(&ids, &status, Some(user.user_id))?;
        let _ = db.log_event("card.bulk_status",
            &format!("{} cards → {}", ids.len(), status), Some("card"), None);

        Ok(())
    })
}

/// FEAT-001: авто-архив dead-карт по нажатию пользователя. В отличие от
/// bulk_update_cards по выбранным id, одной командой переводит ВЕСЬ пул
/// dead → archive. Возвращает число архивированных карт.
#[tauri::command]
pub(crate) fn archive_dead_cards() -> Result<u32, String> {
    let user = require_user()?;
    with_db!(db, {
        if db.is_locked() { return Err("database_locked".into()); }
        let count = db.archive_dead_cards(Some(user.user_id))?;
        if count > 0 {
            let _ = db.log_event(
                "card.dead_archived",
                &format!("{} dead cards archived (user-triggered)", count),
                Some("card"), None,
            );
        }
        Ok(count)
    })
}

#[tauri::command]
pub(crate) fn bulk_delete_cards(ids: Vec<i64>) -> Result<(), String> {
    // Массовое необратимое удаление — только админ, как и delete_card.
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
    // MGR-018 (этап D): в managed-режиме обогащение выполняет менеджер при
    // выпуске среза — воркерский enrich по внешнему API отключён.
    if crate::commands::slices::is_managed(&guard) { return Err("bin_enrich_managed".into()); }
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
    with_db!(db, {
        crate::commands::telemetry::enforce_entity_limit(db, crate::commands::telemetry::EntityLimit::Profiles)?;
        db.create_profile(card_id, notes)
    })
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
    // Удаление профиля каскадом уносит дропы; владельца нет — только админ.
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
    with_db!(db, {
        crate::commands::telemetry::enforce_entity_limit(db, crate::commands::telemetry::EntityLimit::Drops)?;
        db.add_drop(&profile_id, &drop)
    })
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
        .map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            let get = |key: &str| -> String {
                cols.iter().position(|c| c == key)
                    .and_then(|i| parts.get(i))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            };
            DropInput {
                recipient_name: get("recipient_name"),
                address: get("address"),
                city: get("city"),
                state: Some(get("state")),
                zip: get("zip"),
                country: get("country"),
                phone: Some(get("phone")),
            }
        }).collect();
    with_db!(db, { db.import_drops(&profile_id, rows) })
}

#[tauri::command]
pub(crate) fn find_duplicate_drops() -> Result<Vec<Vec<Drop>>, String> {
    require_user()?;
    with_db!(db, { db.find_duplicate_drops() })
}

// MGR-018 (этап C): мутации пула прокси/email закрыты гейтом
// crate::commands::slices::enforce_pool_editable — в managed-режиме пул
// централизован у менеджера (read-only), solo-режим не затрагивается.
#[tauri::command]
pub(crate) fn add_email(email: String, label: String, notes: String) -> Result<EmailPoolEntry, String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    let label = if label.is_empty() { None } else { Some(label) };
    let notes = if notes.is_empty() { None } else { Some(notes) };
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.add_email(&email, label, notes)
    })
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
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.update_email(id, label, notes)
    })
}

#[tauri::command]
pub(crate) fn block_email(id: i64, blocked: bool) -> Result<(), String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    with_db!(db, { db.block_email(id, blocked) })
}

#[tauri::command]
pub(crate) fn delete_email(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_EMAILS)?;
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.delete_email(id)
    })
}

#[tauri::command]
pub(crate) fn get_clean_email_for_shop(shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
    // Не MANAGE_EMAILS: это шаг оформления заказа, а не управление пулом.
    // Возвращается один свободный адрес, весь пул при этом не раскрывается.
    require_perm(models::perms::CREATE_ORDERS)?;
    with_db!(db, { db.get_clean_email_for_shop(shop_id) })
}

#[tauri::command]
pub(crate) fn add_proxy(input: ProxyInput) -> Result<Proxy, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.add_proxy(&input)
    })
}

#[tauri::command]
pub(crate) fn import_proxies(raw: String) -> Result<ImportResult, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.import_proxies(&raw)
    })
}

#[tauri::command]
pub(crate) fn get_proxies(filter: ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.get_proxies(&filter, page, per_page) })
}

#[tauri::command]
pub(crate) fn update_proxy(id: i64, input: ProxyInput) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.update_proxy(id, &input)
    })
}

#[tauri::command]
pub(crate) fn block_proxy(id: i64, blocked: bool) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.block_proxy(id, blocked) })
}

#[tauri::command]
pub(crate) fn delete_proxy(id: i64) -> Result<(), String> {
    require_perm(models::perms::MANAGE_PROXIES)?;
    with_db!(db, {
        crate::commands::slices::enforce_pool_editable(db)?;
        db.delete_proxy(id)
    })
}

#[tauri::command]
pub(crate) fn test_proxy_connection(host: String, port: u16) -> Result<bool, String> {
    // Иначе любой вошедший пользователь мог бы сканировать порты изнутри сети,
    // где стоит клиент: команда делает исходящее соединение по произвольному адресу.
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
    // Оператор создаёт магазин на лету при оформлении заказа по позиции из
    // каталога (Orders.jsx: selectShop → _fromCatalog), поэтому одного
    // MANAGE_SHOPS здесь мало — иначе ломается основной сценарий работы.
    require_any_perm(&[models::perms::MANAGE_SHOPS, models::perms::CREATE_ORDERS])?;
    with_db!(db, { db.create_shop(&input) })
}

#[tauri::command]
pub(crate) fn get_shops(page: u32, per_page: u32, search: String) -> Result<PaginatedShops, String> {
    // Только вход в систему: список магазинов — это справочник, он нужен для
    // выбора при заказе, на страницах прокси и в самом разделе магазинов.
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

// q77: wiki магазина — читать может любой воркер, править любой участник.
// author = текущий пользователь, дата/время — в SQL (CURRENT_TIMESTAMP).
#[tauri::command]
pub(crate) fn get_shop_wiki(shop_id: i64) -> Result<Option<models::ShopWikiEntry>, String> {
    require_user()?;
    with_db!(db, { db.get_shop_wiki(shop_id) })
}

#[tauri::command]
pub(crate) fn set_shop_wiki(shop_id: i64, content: String) -> Result<(), String> {
    let user = require_user()?;
    with_db!(db, { db.set_shop_wiki(shop_id, &content, &user.username) })
}

#[tauri::command]
pub(crate) fn get_shop_wiki_history(shop_id: i64) -> Result<Vec<models::ShopWikiHistoryEntry>, String> {
    require_user()?;
    with_db!(db, { db.get_shop_wiki_history(shop_id) })
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