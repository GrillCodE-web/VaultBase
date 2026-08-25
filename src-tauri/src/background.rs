// Background threads and platform helpers invoked from main().

use crate::state::*;
use crate::models::*;
use crate::models;
use crate::database::Database;
use crate::endpoints;
use crate::parser;
use crate::tracking;
use crate::sync;
use crate::imap;
use crate::stuffer;
use crate::smtp;
use crate::license;
use crate::rate_limiter;
use crate::ws_sync;
use once_cell::sync::OnceCell;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::path::PathBuf;
use tauri::{Manager, Emitter};
use bcrypt;
use chrono;
use serde_json;
use std::collections::HashMap;

pub(crate) fn start_background_threads(handle: tauri::AppHandle) {
    // ── Autolock thread ──
    // SPRINT3-DAY4: Use autolock_timeout from config
    let h = handle.clone();
    std::thread::spawn(move || loop {
        if let Some(st) = STATE.get() {
            let autolock_timeout = st.config.security.autolock_timeout as u64;
            std::thread::sleep(std::time::Duration::from_secs(autolock_timeout));
        } else {
            std::thread::sleep(std::time::Duration::from_secs(30)); // fallback
        }
        if let Some(st) = STATE.get() {
            // Быстрая проверка атомарного флага без lock
            if st.is_locked.load(Ordering::Relaxed) {
                continue; // Уже заблокировано, пропускаем
            }

            // FIX CRITICAL: Hold lock for entire check-and-lock operation to prevent TOCTOU
            let mut db = match st.db.lock() {
                Ok(d) => d,
                Err(_) => continue,
            };

            // Check if should lock while holding the lock
            if !db.is_locked() {
                let timeout_secs = db.get_config("autolock_timeout").ok().flatten()
                    .and_then(|v| if v == "never" { None } else { v.parse::<u64>().ok() })
                    // FIX CRITICAL: Use constant for default timeout
                    .unwrap_or(crate::constants::DEFAULT_AUTOLOCK_TIMEOUT_SECS);
                
                let should_lock = db.last_activity.lock()
                    .map(|t| t.elapsed().as_secs() >= timeout_secs)
                    .unwrap_or(false);

                if should_lock {
                    // Clear encryption while still holding db lock
                    db.clear_encryption();
                    // Release db lock before setting atomic flag
                    drop(db);
                    // FIX CRITICAL: Use SeqCst for cross-thread synchronization
                    st.is_locked.store(true, Ordering::SeqCst);
                    let _ = h.emit("app_locked", ());
                }
            }
        }
    });

    // ── Sync thread (every 2 min) ──
    // FIX P3-FOOTPRINT-AUTO-01: Periodic footprint sync с retry и логированием
    let h = handle.clone();
    std::thread::spawn(move || {
        let mut last_online: Option<bool> = None;
        let mut consecutive_failures = 0u32;
        const MAX_FAILURES_BEFORE_PAUSE: u32 = 5; // Pause after 5 consecutive failures

        // Небольшая стартовая пауза, чтобы приложение успело разблокироваться
        // (ввод мастер-пароля), а sleep(120) перенесён в КОНЕЦ цикла — иначе
        // первая проверка online была только через 2 минуты, и всё это время
        // в UI висел OFFLINE при живом сервере.
        // FIX CONFIG: Use constant for sync startup delay
        std::thread::sleep(std::time::Duration::from_secs(crate::constants::SYNC_STARTUP_DELAY_SECS));
        loop {
            if let Some(st) = STATE.get() {
                let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
                if !db_locked {
                    let online = sync::SyncClient::check_server_online();
                    if last_online != Some(online) {
                        last_online = Some(online);
                        if online {
                            eprintln!("[sync] Server online detected");
                            let _ = h.emit("server_online", ());
                        } else {
                            eprintln!("[sync] Server offline detected");
                            let _ = h.emit("server_offline", ());
                        }
                    }

                    if online {
                        if let Ok(mut db) = st.db.lock() {
                            match sync::SyncClient::sync_footprints(&mut db) {
                                Ok(res) => {
                                    if res.synced > 0 {
                                        eprintln!("[sync] Successfully synced {} footprints", res.synced);
                                        let _ = h.emit("sync_completed", serde_json::json!({
                                            "type": "footprints",
                                            "sent": res.synced,
                                            "message": res.message
                                        }));
                                        consecutive_failures = 0; // Reset on success
                                    } else if res.failed > 0 {
                                        eprintln!("[sync] Footprint sync failed: {} (server_reached: {})", res.message, res.server_reached);
                                        consecutive_failures += 1;
                                    }
                                    // nothing to sync — don't increment failures
                                }
                                Err(e) => {
                                    eprintln!("[sync] Footprint sync error: {}", e);
                                    let _ = db.log_event("sync.footprints_error", &e, Some("sync"), None);
                                    consecutive_failures += 1;
                                }
                            }

                            // Pause syncing after consecutive failures to avoid spam
                            if consecutive_failures >= MAX_FAILURES_BEFORE_PAUSE {
                                eprintln!("[sync] Pausing footprint sync after {} consecutive failures", consecutive_failures);
                                consecutive_failures = 0;
                                // FIX CONFIG: Use constant for sync failure pause
                                std::thread::sleep(std::time::Duration::from_secs(crate::constants::SYNC_FAILURE_PAUSE_SECS));
                            }
                        }
                    } else {
                        // Server offline — reset failures but don't attempt sync
                        consecutive_failures = 0;
                    }
                }
            }
            // Пауза между проверками — в конце цикла, чтобы первая проверка
            // онлайна прошла сразу после старта (см. коммент выше).
            // FIX CONFIG: Use constant for sync check interval
            std::thread::sleep(std::time::Duration::from_secs(crate::constants::SYNC_CHECK_INTERVAL_SECS));
        }
    });

    // SPRINT3-DAY4: License check thread - use config interval
    let h = handle.clone();
    std::thread::spawn(move || {
        // SEC-018: счётчик подряд идущих ошибок поллинга по каждому аккаунту,
        // чтобы алертить UI только при устойчивом отвале, а не при единичном сбое.
        let mut imap_fail_counts: std::collections::HashMap<i64, u32> = std::collections::HashMap::new();
        loop {
        if let Some(st) = STATE.get() {
            let interval = st.config.background.license_check_interval as u64;
            std::thread::sleep(std::time::Duration::from_secs(interval));
        } else {
            std::thread::sleep(std::time::Duration::from_secs(60)); // fallback
        }
        if let Some(st) = STATE.get() {
            let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
            if db_locked { continue; }

            let accounts = match st.db.lock() {
                Ok(d) => d.get_imap_accounts().unwrap_or_default(),
                Err(_) => continue,
            };

            for acc in accounts.into_iter().filter(|a| a.is_active) {
                let should_poll = acc.last_checked.as_ref().map(|lc| {
                    chrono::DateTime::parse_from_rfc3339(lc)
                        .map(|t| chrono::Utc::now().signed_duration_since(t).num_minutes() >= acc.poll_interval)
                        .unwrap_or(true)
                }).unwrap_or(true);

                if !should_poll { continue; }

                // FIX B22: lock → получить данные аккаунта → RELEASE → сетевой IMAP → lock → сохранить
                let fetch_data = {
                    let Ok(db) = st.db.lock() else { continue };
                    let Ok((account, password)) = db.get_imap_account_with_password(acc.id) else { continue };
                    // Собираем уже известные UID пока держим lock
                    let known_uids: std::collections::HashSet<String> = db
                        .get_known_imap_uids(acc.id)
                        .unwrap_or_default()
                        .into_iter().collect();
                    (account, password, known_uids)
                }; // Mutex освобождён здесь — до сетевого вызова

                // Сетевая операция без lock
                match imap::fetch_account_messages(&fetch_data.0, &fetch_data.1, &fetch_data.2) {
                    Ok(result) => {
                        if let Ok(mut db) = st.db.lock() {
                            for msg in &result.messages {
                                if let (Some(onum), Some(act)) = (msg.order_number.as_deref(), msg.action.as_deref()) {
                                    match db.find_order_by_number(onum) {
                                        Ok(Some(oid)) => {
                                            let _ = db.update_order_status_simple(oid, act, msg.tracking.as_deref());
                                        }
                                        Ok(None) => {
                                            tracing::debug!("[IMAP] No matching order for number '{}' from email '{}'", onum, msg.subject);
                                        }
                                        Err(e) => {
                                            tracing::warn!("[IMAP] Error looking up order '{}': {}", onum, e);
                                        }
                                    }
                                }
                                let _ = db.save_imap_message(
                                    acc.id, msg.uid.as_deref(), &msg.subject,
                                    &msg.from_email, &msg.received_at,
                                    msg.order_number.as_deref(), msg.tracking.as_deref(),
                                    msg.action.as_deref(),
                                );
                                // E2: Auto-mark orders as Delivered when email contains "delivered"
                                let body_lower = ""; // body not available here; check subject only
                                let subject_lower = msg.subject.to_lowercase();
                                if subject_lower.contains("delivered") || msg.action.as_deref() == Some("delivered") {
                                    let _ = db.auto_mark_delivered_by_account(acc.id);
                                }
                                // B5: Emit event for new email notification
                                let _ = h.emit("new_imap_message", serde_json::json!({
                                    "account_id": acc.id,
                                    "subject": &msg.subject,
                                    "from": &msg.from_email,
                                }));
                            }
                            let _ = db.update_imap_last_checked(acc.id);
                            // FIX AUDIT-09: логируем успешный опрос — иначе
                            // get_automation_health всегда показывает OFFLINE.
                            let _ = db.log_event("imap.poll_completed",
                                &format!("IMAP poll completed for {}", acc.label), Some("imap"), None);
                            // SEC-018: сбрасываем счётчик ошибок при успешном опросе.
                            imap_fail_counts.remove(&acc.id);
                        }
                    }
                    Err(e) => {
                        if let Ok(db) = st.db.lock() {
                            let _ = db.log_event("imap.poll_error", &e, Some("imap"), None);
                        }
                        // SEC-018: алертим UI только после 3 подряд идущих ошибок
                        // на одном аккаунте, чтобы не сыпать шумом из-за единичных сбоев.
                        let count = imap_fail_counts.entry(acc.id).and_modify(|c| *c += 1).or_insert(1);
                        if *count >= 3 {
                            let _ = h.emit("imap_connection_alert", serde_json::json!({
                                "account_id": acc.id,
                                "error": &e,
                            }));
                        }
                    }
                }

                if let Some(badges) = st.db.lock().ok().and_then(|d| d.get_sidebar_badges().ok()) {
                    let _ = h.emit("badge_update", badges.clone());
                    // Update macOS Dock badge based on user prefs
                    let notify_imap = st.db.lock().ok()
                        .and_then(|d| d.get_config("badge_notify_imap").ok().flatten())
                        .map(|v| v != "0").unwrap_or(true);
                    let notify_tracking = st.db.lock().ok()
                        .and_then(|d| d.get_config("badge_notify_tracking").ok().flatten())
                        .map(|v| v != "0").unwrap_or(true);
                    let mut badge_count = 0u32;
                    if notify_imap { badge_count += badges.unread_imap as u32; }
                    set_dock_badge(badge_count);
                }
            }
        }
        }
    });

    // FIX B30: 17track батчинг по 40 номеров
    std::thread::spawn(move || {
        // FIX CONFIG: Use constant for risk check initial delay
        std::thread::sleep(std::time::Duration::from_secs(
        if let Some(st) = STATE.get() {
            st.config.background.risk_check_interval as u64
        } else {
            300
        }
    ));
        loop {
            if let Some(st) = STATE.get() {
                let api_key = st.db.lock().ok()
                    .and_then(|d| d.get_config("tracking_api_key").ok().flatten())
                    .filter(|k| !k.is_empty());
                if let Some(key) = api_key {
                    run_tracking_update(&key);
                }
            }
            // FIX CONFIG: Use constant for fulfillment check interval
            std::thread::sleep(std::time::Duration::from_secs(
        if let Some(st) = STATE.get() {
            st.config.background.fulfillment_check_interval as u64
        } else {
            1800
        }
    ));
        }
    });

    // ── Proxy health check thread (every 30 minutes) ──
    std::thread::spawn(move || loop {
        // FIX CONFIG: Use constant for quarantine check interval
        std::thread::sleep(std::time::Duration::from_secs(
        if let Some(st) = STATE.get() {
            st.config.background.quarantine_cleanup_interval as u64
        } else {
            1800
        }
    ));
        if let Some(st) = STATE.get() {
            let db_locked = st.db.lock().map(|d| d.is_locked()).unwrap_or(true);
            if !db_locked {
                if let Ok(db) = st.db.lock() {
                    let _ = db.check_all_proxy_health();
                }
            }
        }
    });

    // ── PHASE 6: Smart Card Protection thread (every 5 minutes) ──
    let h_card_protection = handle.clone();
    std::thread::spawn(move || {
        // FIX CONFIG: Use constant for stuffer sync start delay
        std::thread::sleep(std::time::Duration::from_secs(crate::constants::STUFFER_SYNC_START_DELAY_SECS));
        loop {
            if let Some(st) = STATE.get() {
                let config = st.db.lock().ok()
                    .and_then(|d| d.get_automation_config().ok());
                if let Some(cfg) = config {
                    if cfg.auto_archive_enabled {
                        // Auto-archive burned cards
                        let burned_count = st.db.lock().ok()
                            .and_then(|mut d| d.auto_archive_burned_cards(cfg.burned_card_threshold).ok())
                            .unwrap_or(0);

                        // Auto-archive cards with consecutive declines
                        let risky_count = st.db.lock().ok()
                            .and_then(|mut d| d.auto_archive_risky_cards(cfg.decline_threshold).ok())
                            .unwrap_or(0);

                        if burned_count > 0 || risky_count > 0 {
                            let _ = h_card_protection.emit("card_protection_action", serde_json::json!({
                                "burned_archived": burned_count,
                                "risky_archived": risky_count,
                            }));
                        }
                    }
                }
            }
            // FIX CONFIG: Use constant for stuffer sync interval
            std::thread::sleep(std::time::Duration::from_secs(
        if let Some(st) = STATE.get() {
            st.config.background.stuffer_poll_interval as u64
        } else {
            300
        }
    ));
        }
    });

    // ── Auto-fetch catalog on first run if empty ──
    let h_catalog = handle.clone();
    std::thread::spawn(move || {
        // FIX CONFIG: Use constant for catalog startup delay
        std::thread::sleep(std::time::Duration::from_secs(crate::constants::CATALOG_STARTUP_DELAY_SECS));
        let needs_catalog = STATE.get()
            .and_then(|st| st.db.lock().ok())
            .and_then(|db| db.get_catalog_stats().ok())
            .map(|stats| stats.items == 0)
            .unwrap_or(true);
        if needs_catalog {
            let _ = sync_catalog_from_server(&h_catalog);
        }
    });
}

pub(crate) fn run_tracking_update(api_key: &str) {
    let orders = match STATE.get() {
        Some(st) => st.db.lock().ok()
            .and_then(|db| db.get_orders_with_tracking().ok())
            .unwrap_or_default(),
        None => return,
    };
    if orders.is_empty() { return; }

    let tracking_numbers: Vec<String> = orders.iter()
        .filter_map(|(_, num)| num.clone())
        .collect();
    if tracking_numbers.is_empty() { return; }

    // Group tracking numbers by carrier
    let mut ups: Vec<&str> = Vec::new();
    let mut fedex: Vec<&str> = Vec::new();
    let mut usps: Vec<&str> = Vec::new();
    let mut unknown: Vec<&str> = Vec::new();

    for t in &tracking_numbers {
        match tracking::detect_carrier(t) {
            Some("UPS") => ups.push(t),
            Some("FedEx") => fedex.push(t),
            Some("USPS") => usps.push(t),
            _ => unknown.push(t),
        }
    }

    // FINAL-012: DRY — unified carrier status mapping helper
    fn map_carrier_status(raw: &str) -> Option<&'static str> {
        match raw {
            "delivered" => Some("delivered"),
            "in_transit" | "pre_transit" => Some("shipped"),
            "exception" => Some("exception"),
            _ => None,
        }
    }
    fn apply_tracking_update(tracking: &str, status: &str) {
        if let Some(st) = STATE.get() {
            if let Ok(mut db) = st.db.lock() {
                let _ = db.update_order_status_by_tracking(tracking, status);
            }
        }
    }

    // Process direct carrier APIs first
    for tracking in &ups {
        if let Ok(status) = tracking::check_ups_tracking(tracking) {
            if let Some(s) = map_carrier_status(&status.status) {
                apply_tracking_update(tracking, s);
            }
        }
    }

    for tracking in &fedex {
        if let Ok(status) = tracking::check_fedex_tracking(tracking) {
            if let Some(s) = map_carrier_status(&status.status) {
                apply_tracking_update(tracking, s);
            }
        }
    }

    for tracking in &usps {
        if let Ok(status) = tracking::check_usps_tracking(tracking) {
            if let Some(s) = map_carrier_status(&status.status) {
                apply_tracking_update(tracking, s);
            }
        }
    }

    // Fallback to 17track for unknown carriers (batch by 40)
    if !unknown.is_empty() && !api_key.is_empty() {
        for chunk in unknown.chunks(40) {
            let body: Vec<serde_json::Value> = chunk.iter()
                .map(|n| serde_json::json!({ "number": n }))
                .collect();

            let resp = ureq::post("https://api.17track.net/track/v2.2/gettrackinfo")
                .set("17token", api_key)
                .set("Content-Type", "application/json")
                // FIX CONFIG: Use constant for tracking request timeout
                .timeout(std::time::Duration::from_secs(crate::constants::TRACKING_REQUEST_TIMEOUT_SECS))
                .send_string(&serde_json::json!(body).to_string());

            let data = match resp {
                Ok(r) => match r.into_json::<serde_json::Value>() { Ok(j) => j, Err(_) => continue },
                Err(_) => continue,
            };

            let accepted = match data["data"]["accepted"].as_array() {
                Some(a) => a.clone(),
                None => continue,
            };

            for item in accepted {
                let number = match item["number"].as_str() { Some(n) => n, None => continue };
                let status_str = item["track_info"]["latest_status"]["status"].as_str().unwrap_or("");
                let new_status = match status_str {
                    "Delivered"                               => Some("delivered"),
                    "InTransit" | "Pickup" | "OutForDelivery" => Some("shipped"),
                    "Expired"                                 => Some("failed"),
                    _                                         => None,
                };
                if let Some(status) = new_status {
                    if let Some(st) = STATE.get() {
                        if let Ok(mut db) = st.db.lock() {
                            let _ = db.update_order_status_by_tracking(number, status);
                        }
                    }
                }
            }
        }
    }

    // FIX AUDIT-09: логируем проход tracking-обновления — иначе
    // get_automation_health всегда показывает OFFLINE.
    if let Some(st) = STATE.get() {
        if let Ok(db) = st.db.lock() {
            let _ = db.log_event("tracking.updated", "Tracking update pass completed", Some("tracking"), None);
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn set_dock_badge(count: u32) {
    // FIX TC-H01: Validate count to prevent command injection
    // Since count is u32, injection is not possible, but we add extra safety
    let label = if count == 0 {
        "\"\"".to_string()
    } else {
        // Only allow numeric characters (already guaranteed by u32 type)
        // This is defense in depth - the type system already prevents injection
        format!("{}", count)
    };

    // Use escaped label in AppleScript
    let script = format!(
        "tell application \"System Events\" to set badge of (first application process whose frontmost is true) to {}",
        label
    );

    // FIX TC-H01: Use spawn with explicit arg handling (already safe via .arg())
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn();
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_dock_badge(_count: u32) {}

pub(crate) fn sync_catalog_from_server(app: &tauri::AppHandle) -> Result<(), String> {
    let base = endpoints::server_base();
    const PER_PAGE: u32 = 100;

    // Fetch all item pages
    let mut total_items = 0usize;
    let mut page = 1u32;
    loop {
        let url = format!("{}/api/catalog/items?per_page={}&page={}", base, PER_PAGE, page);
        // FIX CONFIG: Use constant for HTTP request timeout
        match ureq::get(&url).timeout(std::time::Duration::from_secs(crate::constants::HTTP_REQUEST_TIMEOUT_SECS)).call() {
            Ok(resp) => {
                match resp.into_json::<serde_json::Value>() {
                    Ok(data) => {
                        let items_arr = match data["items"].as_array() {
                            Some(a) => a.clone(),
                            None => break,
                        };
                        if items_arr.is_empty() { break; }
                        let inputs: Vec<models::CatalogItemInput> = items_arr.iter().filter_map(|i| {
                            Some(models::CatalogItemInput {
                                id: i["id"].as_i64(),
                                name: i["name"].as_str()?.to_string(),
                                asin: i["asin"].as_str().map(|s| s.to_string()),
                                price: i["price"].as_f64(),
                                pct: i["pct"].as_i64(),
                                category: i["category"].as_str().map(|s| s.to_string()),
                                notes_en: i["notes_en"].as_str().map(|s| s.to_string()),
                                stop: i["stop"].as_bool().unwrap_or(false)
                                    || i["stop"].as_i64().map(|v| v != 0).unwrap_or(false),
                            })
                        }).collect();
                        total_items += inputs.len();
                        if let Some(st) = STATE.get() {
                            if let Ok(db) = st.db.lock() {
                                let _ = db.import_catalog_items_batch(&inputs);
                            }
                        }
                        let total_pages = data["pages"].as_u64().unwrap_or(1);
                        if page as u64 >= total_pages { break; }
                        page += 1;
                    }
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    if total_items > 0 {
        let _ = app.emit("catalog_synced", serde_json::json!({ "items": total_items }));
    }

    // Fetch all shop pages
    page = 1;
    loop {
        let url = format!("{}/api/catalog/shops?per_page={}&page={}", base, PER_PAGE, page);
        // FIX CONFIG: Use constant for HTTP request timeout
        match ureq::get(&url).timeout(std::time::Duration::from_secs(crate::constants::HTTP_REQUEST_TIMEOUT_SECS)).call() {
            Ok(resp) => {
                match resp.into_json::<serde_json::Value>() {
                    Ok(data) => {
                        let shops_arr = match data["shops"].as_array() {
                            Some(a) => a.clone(),
                            None => break,
                        };
                        if shops_arr.is_empty() { break; }
                        let inputs: Vec<models::CatalogShopInput> = shops_arr.iter().filter_map(|s| {
                            Some(models::CatalogShopInput {
                                domain: s["domain"].as_str()?.to_string(),
                                category: s["category"].as_str().map(|x| x.to_string()),
                                score: s["score"].as_i64(),
                                ship_us: s["ship_us"].as_bool().unwrap_or(false)
                                    || s["ship_us"].as_i64().map(|v| v != 0).unwrap_or(false),
                                fraud_level: s["fraud_level"].as_str().map(|x| x.to_string()),
                                top_brands: s["top_brands"].as_str().map(|x| x.to_string()),
                                top_products: s["top_products"].as_str().map(|x| x.to_string()),
                                excluded: s["excluded"].as_bool().unwrap_or(false)
                                    || s["excluded"].as_i64().map(|v| v != 0).unwrap_or(false),
                            })
                        }).collect();
                        if let Some(st) = STATE.get() {
                            if let Ok(db) = st.db.lock() {
                                let _ = db.import_catalog_shops_batch(&inputs);
                            }
                        }
                        let total_pages = data["pages"].as_u64().unwrap_or(1);
                        if page as u64 >= total_pages { break; }
                        page += 1;
                    }
                    Err(_) => break,
                }
            }
            Err(_) => break,
        }
    }

    Ok(())
}

/// Windows: перед инициализацией WebView2 удаляем его HTTP disk-кеш если
/// версия приложения сменилась.
///
/// ПРОБЛЕМА: WebView2 кеширует ответы tauri://-протокола (включая index.html
/// и CSS-ассеты) в %LOCALAPPDATA%\com.vaultbase.app\EBWebView.  Этот кеш
/// ПЕРЕЖИВАЕТ переустановку приложения — деинсталлятор его не трогает.
/// JS-сторона (cacheBuster.js) работает с Cache Storage API (SW-кеш),
/// который ДРУГОЙ слой; HTTP disk-кеш из JS недоступен вообще.
/// Единственный надёжный вариант — удалить папку из Rust ДО того как
/// WebView2 её залочил.  После удаления WebView2 создаёт свежую структуру
/// и запрашивает все ассеты у Tauri заново → пользователь видит новый CSS.
///
/// Безопасность: все данные VaultBase хранятся в SQLite, а не в WebView2-
/// хранилищах (localStorage/IndexedDB).  Очистка EBWebView не затрагивает БД.
#[cfg(target_os = "windows")]
pub(crate) fn purge_old_webview_cache() {
    let Ok(localappdata) = std::env::var("LOCALAPPDATA") else { return };
    let app_dir = std::path::PathBuf::from(&localappdata).join("com.vaultbase.app");
    let version_file = app_dir.join(".build_version");
    let eb_dir = app_dir.join("EBWebView");

    let current = env!("CARGO_PKG_VERSION");
    let stored = std::fs::read_to_string(&version_file).unwrap_or_default();

    if stored.trim() == current {
        return; // версия не изменилась — трогать кеш не нужно
    }

    // Версия сменилась (или первый запуск) — сносим HTTP disk-кеш.
    if eb_dir.exists() {
        let _ = std::fs::remove_dir_all(&eb_dir);
    }

    // Сохраняем новую версию чтобы не чистить при следующем запуске.
    let _ = std::fs::create_dir_all(&app_dir);
    let _ = std::fs::write(&version_file, current);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn purge_old_webview_cache() {}

// PERF-012: Run VACUUM if not done in last 7 days
pub(crate) fn maybe_vacuum_db() {
    if let Some(st) = STATE.get() {
        if let Ok(db) = st.db.lock() {
            let should_vacuum = db.conn.query_row(
                "SELECT value FROM _maintenance WHERE key = 'last_vacuum'",
                [],
                |r| r.get::<_, String>(0),
            ).map(|v| {
                if v.is_empty() { return true; }
                chrono::NaiveDateTime::parse_from_str(&v, "%Y-%m-%d %H:%M:%S")
                    .map(|dt| {
                        let days = (chrono::Utc::now().naive_utc() - dt).num_days();
                        days >= 7
                    })
                    .unwrap_or(true)
            }).unwrap_or(false);

            if should_vacuum {
                eprintln!("[maintenance] Running VACUUM...");
                let _ = db.conn.execute_batch("VACUUM");
                let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
                let _ = db.conn.execute(
                    "INSERT OR REPLACE INTO _maintenance (key, value) VALUES ('last_vacuum', ?1)",
                    [&now],
                );
                eprintln!("[maintenance] VACUUM complete");
            }
        }
    }
}