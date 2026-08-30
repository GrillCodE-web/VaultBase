#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unused_imports, unused_variables, dead_code, unused_mut)]

mod background;
mod commands;
mod config;  // SPRINT3-DAY3: TOML configuration management
mod constants;  // FIX CRITICAL: Centralized configuration (URLs, timeouts, limits)
mod database;
mod encryption;
mod endpoints;
mod imap;
mod license;
mod logging;  // SPRINT3-DAY2: Structured logging with tracing
mod models;
mod parser;
mod rate_limiter;  // FIX TC-H03: Rate limiting infrastructure
mod smtp;
mod state;
mod stuffer;
mod sync;
mod tracking;
mod wipe; // MGR-013: локальное криптостирание (panic-пароль / remote wipe)
mod ws_sync;

use background::*;
use database::Database;
use std::sync::{Mutex, atomic::AtomicBool};
use tauri::Manager;
use state::*;
// ─────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────

// Все Tauri-команды вынесены в модуль `commands/` (по доменам), общее
// состояние и хелперы — в `state.rs`, фоновые потоки — в `background.rs`.
// Здесь остаётся только инициализация приложения и регистрация команд.


fn main() {
    // SPRINT3-DAY2: Initialize structured logging first
    let log_dir = logging::get_default_log_dir();
    let log_level = if cfg!(debug_assertions) {
        logging::LogLevel::Debug
    } else {
        logging::LogLevel::Info
    };
    
    if let Err(e) = logging::init_logging(log_dir, log_level, true) {
        eprintln!("⚠️  Failed to initialize logging: {}", e);
        eprintln!("   Continuing without structured logging...");
    }
    
    tracing::info!("🚀 VaultBase v2.11.3 starting...");
    
    // Должно быть первым: WebView2 ещё не создан, папка не залочена.
    purge_old_webview_cache();

    let db_p = db_path();
    let db_path_str = db_p.to_str().unwrap_or("vaultbase.db").to_string();
    
    // FIX CRITICAL: Graceful error handling instead of panic
    let db = match Database::open(&db_path_str) {
        Ok(d) => {
            tracing::info!(
                db_path = %db_path_str,
                "Database opened successfully"
            );
            d
        },
        Err(e) => {
            tracing::error!(
                db_path = %db_path_str,
                error = %e,
                "Failed to open database - critical error"
            );
            eprintln!("❌ КРИТИЧЕСКАЯ ОШИБКА: Не удалось открыть базу данных");
            eprintln!("   Путь: {}", db_path_str);
            eprintln!("   Ошибка: {}", e);
            eprintln!("\nВозможные причины:");
            eprintln!("  - База данных повреждена");
            eprintln!("  - Недостаточно прав доступа");
            eprintln!("  - Файл занят другим процессом");
            eprintln!("\nПриложение будет закрыто.");
            std::process::exit(1);
        }
    };
    
    // SPRINT3-DAY4: Load application configuration
    // DEVOPS-005: в release-сборках всегда production — VAULTBASE_PROFILE
    // читается только из debug-сборок (разработка), чтобы релиз нельзя было
    // случайно запустить с ослабленным dev-профилем (PBKDF2 600k, debug=true).
    let profile = if cfg!(debug_assertions) {
        std::env::var("VAULTBASE_PROFILE").unwrap_or_else(|_| "dev".to_string())
    } else {
        "production".to_string()
    };
    
    let app_config = {
        let toml_name = format!("VaultBase.{}.toml", profile);

        // 1) явно заданная директория через переменную окружения
        let explicit = std::env::var("VAULTBASE_CONFIG_DIR")
            .ok()
            .map(|d| std::path::PathBuf::from(d).join(&toml_name));

        // 2) рядом с исполняемым файлом (работает для инсталлированного продукта)
        let beside_exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join(&toml_name)));

        // 3) текущая рабочая директория (dev-режим)
        let cwd = std::env::current_dir()
            .ok()
            .map(|d| d.join(&toml_name));

        let candidates = [explicit, beside_exe, cwd];
        let mut loaded = None;

        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                match config::load_config(&candidate) {
                    Ok(cfg) => {
                        tracing::info!(
                            profile = %profile,
                            path = %candidate.display(),
                            "Loaded configuration from TOML file"
                        );
                        loaded = Some(cfg);
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            path = %candidate.display(),
                            "Failed to parse TOML config, trying next location"
                        );
                    }
                }
            }
        }

        loaded.unwrap_or_else(|| {
            // BUG-020: в production отсутствие конфига — не тихий fallback, а warning
            if profile == "production" {
                tracing::warn!(
                    profile = %profile,
                    toml = %toml_name,
                    "Production config NOT FOUND (checked VAULTBASE_CONFIG_DIR, exe dir, cwd) — using built-in defaults"
                );
                eprintln!(
                    "WARNING: {} не найден ни в одном из мест (VAULTBASE_CONFIG_DIR, рядом с exe, cwd) — встроенные дефолты",
                    toml_name
                );
            } else {
                tracing::info!(profile = %profile, "No TOML config found, using built-in defaults");
            }
            config::get_default_config(&profile)
        })
    };
    
    // DEVOPS-003: crash-reporting (Sentry). Опт-ин через конфиг: DSN берётся из
    // env SENTRY_DSN, иначе из [sentry] dsn в TOML. Без DSN SDK не поднимается
    // вообще — приложение ничего никуда не отправляет.
    // send_default_pii = false: приложение хранит чувствительные данные,
    // в репорты не должны уходить IP/юзернеймы/данные сессии.
    #[cfg(not(target_os = "ios"))]
    let mut _minidump_guard: Option<tauri_plugin_sentry::minidump::Handle> = None;
    let sentry_client: Option<sentry::ClientInitGuard> = {
        let dsn = std::env::var("SENTRY_DSN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| app_config.sentry.dsn.trim().to_string());
        if dsn.is_empty() {
            tracing::info!("Sentry disabled (no DSN configured)");
            None
        } else {
            match dsn.parse::<sentry::types::Dsn>() {
                Ok(_) => {
                    tracing::info!(environment = %profile, "Sentry crash-reporting enabled");
                    let mut opts = sentry::ClientOptions::default();
                    opts.release = sentry::release_name!();
                    opts.environment = Some(profile.clone().into());
                    opts.auto_session_tracking = true;
                    opts.send_default_pii = false;
                    let client = sentry::init((dsn.as_str(), opts));
                    // Нативные краши (segfault/abort в Rust/Си) — minidump.
                    // На iOS minidump не поддерживается.
                    #[cfg(not(target_os = "ios"))]
                    {
                        match tauri_plugin_sentry::minidump::init(&client) {
                            Ok(handle) => _minidump_guard = Some(handle),
                            Err(e) => tracing::warn!(error = %e, "minidump init failed — native crashes won't be captured"),
                        }
                    }
                    Some(client)
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Invalid Sentry DSN — crash-reporting disabled");
                    None
                }
            }
        }
    };

    // Создаём дефолтного admin если пользователей ещё нет
    let _ = db.ensure_admin_exists();
    STATE.set(AppState {
        config: app_config,
        db: Mutex::new(db),
        is_locked: AtomicBool::new(true),
        current_user: Mutex::new(None),
        policy: Mutex::new(state::PolicyState::default()),
    }).unwrap_or_else(|_| eprintln!("[warn] AppState already initialized (main called twice)"));

    // Init WS sync handle (not started yet — starts after unlock)
    let ws_h = std::sync::Arc::new(ws_sync::WsSyncHandle {
        running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        creds:   ws_sync::new_credentials(),
    });
    WS_HANDLE.set(ws_h).unwrap_or_else(|_| eprintln!("[warn] WsSyncHandle already initialized (main called twice)"));

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    // DEVOPS-003: плагин инжектит @sentry/browser в webview (JS-ошибки/promise
    // rejections тоже попадают в Sentry) и шлёт конверты через Rust-транспорт.
    if let Some(client) = sentry_client.as_ref() {
        builder = builder.plugin(tauri_plugin_sentry::init(client));
    }

    builder
        .setup(move |app| {
            // FIX AUDIT-20: установить installation_id для rate limiter (иначе
            // все установки делят один bucket на команду).
            if let Some(st) = STATE.get() {
                if let Ok(db) = st.db.lock() {
                    if let Ok(id) = license::get_or_create_installation_id(&db) {
                        rate_limiter::set_installation_id(id);
                    }
                }
            }
            // PERF-012: VACUUM по расписанию — в отдельном потоке, чтобы не
            // блокировать запуск (может занять секунды на большой БД).
            std::thread::spawn(|| {
                maybe_vacuum_db();
            });
            start_background_threads(app.handle().clone());
            #[cfg(target_os = "macos")]
            {
                // FIX CRITICAL: Graceful error handling instead of panic
                if let Some(win) = app.get_webview_window("main") {
                    let win_clone = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win_clone.hide();
                        }
                    });
                } else {
                    eprintln!("⚠️  WARNING: Main window not found (macOS close handler skipped)");
                }
            }
            // Float window: hide on close (all platforms) so it can be reopened
            if let Some(float_win) = app.get_webview_window("float") {
                let fwc = float_win.clone();
                float_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = fwc.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::user_login, commands::auth::try_auto_login, commands::auth::user_logout, commands::auth::get_current_user, commands::auth::resume_session, commands::auth::refresh_session,
            commands::auth::get_users, commands::auth::create_user, commands::auth::update_user_cmd, commands::auth::delete_user_cmd, commands::auth::hard_delete_user_cmd,
            commands::auth::set_user_password_cmd, commands::auth::get_user_with_permissions,
            commands::auth::set_user_permission_cmd, commands::auth::reset_user_permissions_cmd,
            commands::auth::get_users_stats, commands::auth::get_user_period_stats, commands::auth::get_user_activity_log,
            commands::auth::get_admin_overview, commands::auth::take_card, commands::auth::transfer_card_cmd, commands::auth::get_my_card_assignments,
            commands::auth::setup_password, commands::auth::is_password_set, commands::auth::unlock, commands::auth::lock, commands::auth::change_password, commands::auth::change_own_password, commands::auth::is_locked,
            commands::auth::set_panic_password, commands::auth::remove_panic_password, commands::auth::has_panic_password,
            commands::auth::get_full_audit_log, commands::auth::get_online_sessions, commands::auth::revoke_session,
            commands::cards::detect_mapping_preview,
            commands::cards::import_cards, commands::cards::get_cards, commands::cards::get_card, commands::cards::get_card_filter_meta, commands::cards::reveal_card,
    commands::slices::worker_key_register, commands::slices::slices_fetch,
            commands::cards::update_card_status, commands::cards::update_card_notes, commands::cards::delete_card,
            commands::cards::bulk_update_cards, commands::cards::bulk_delete_cards, commands::cards::export_cards, commands::cards::enrich_bin,
            commands::cards::archive_dead_cards,
            commands::cards::create_profile, commands::cards::get_profiles, commands::cards::get_profile, commands::cards::get_profile_detail,
            commands::cards::update_profile, commands::cards::update_profile_notes,
            commands::cards::delete_profile, commands::cards::duplicate_profile, commands::cards::find_duplicate_profiles,
            commands::cards::save_profile_template, commands::cards::get_profile_templates, commands::cards::delete_profile_template,
            commands::cards::add_drop, commands::cards::update_drop, commands::cards::delete_drop, commands::cards::set_primary_drop, commands::cards::import_drops, commands::cards::find_duplicate_drops,
            commands::cards::add_email, commands::cards::get_emails, commands::cards::update_email, commands::cards::block_email, commands::cards::delete_email, commands::cards::get_clean_email_for_shop,
            commands::cards::add_proxy, commands::cards::import_proxies, commands::cards::get_proxies, commands::cards::update_proxy, commands::cards::block_proxy, commands::cards::delete_proxy, commands::cards::test_proxy_connection,
            commands::cards::create_shop, commands::cards::get_shops, commands::cards::get_shop, commands::cards::update_shop, commands::cards::delete_shop,
            commands::cards::add_shop_product, commands::cards::update_shop_product, commands::cards::delete_shop_product, commands::cards::get_shop_smart_suggestions,
            commands::orders::create_order, commands::orders::get_orders, commands::orders::get_order, commands::orders::get_latest_order_by_profile, commands::orders::get_recent_orders_by_profile, commands::orders::get_recent_orders_by_card, commands::orders::update_order_status, commands::orders::delete_order, commands::orders::update_order_tracking, commands::orders::bulk_update_orders, commands::orders::bulk_delete_orders,
            commands::orders::run_risk_check, commands::orders::save_order_template, commands::orders::get_order_templates,
            commands::sync::get_unsynced_footprints, commands::sync::mark_footprints_synced, commands::sync::sync_now,
            commands::dashboard::get_dashboard_stats, commands::dashboard::get_revenue_chart, commands::dashboard::get_heatmap_data, commands::dashboard::get_top_banks,
            commands::dashboard::get_by_country, commands::dashboard::get_by_source, commands::dashboard::get_by_domain, commands::dashboard::get_expiring_cards_dashboard,
            commands::dashboard::export_dashboard_csv, commands::dashboard::get_sidebar_badges,
            commands::dashboard::get_bin_performance, commands::dashboard::get_shop_win_loss,
            commands::dashboard::get_sla_stats,
            commands::imap::add_imap_account, commands::imap::get_imap_accounts, commands::imap::update_imap_account,
            commands::imap::delete_imap_account, commands::imap::toggle_imap_account, commands::imap::get_imap_messages,
            commands::imap::test_imap_connection, commands::imap::link_email_to_imap, commands::imap::link_all_imap_accounts,
            commands::imap::get_folder_messages,
            commands::imap::refresh_folder_from_imap, commands::imap::get_unified_inbox,
            commands::imap::get_imap_message_body, commands::imap::mark_imap_read, commands::imap::delete_imap_message, commands::imap::archive_imap_message,
            commands::imap::get_imap_folders, commands::imap::get_imap_stats, commands::imap::check_all_imap,
            commands::imap::add_domain_route, commands::imap::remove_domain_route,
            commands::imap::list_domain_routes, commands::imap::get_account_for_domain,
            commands::smtp::add_smtp_config, commands::smtp::get_smtp_configs, commands::smtp::delete_smtp_config,
            commands::smtp::test_smtp_connection, commands::smtp::send_email, commands::smtp::get_sent_emails,
            commands::misc::get_activity_log, commands::misc::clear_activity_log,
            commands::config::get_config, commands::config::set_config, commands::config::export_backup, commands::config::import_backup,
            commands::stuffer::stuffer_get_config, commands::stuffer::stuffer_set_config,
            commands::config::seed_test_data, commands::config::has_any_data,
            commands::stuffer::stuffer_list_couriers, commands::stuffer::stuffer_list_available_couriers, commands::stuffer::stuffer_add_courier,
            commands::stuffer::stuffer_list_packages, commands::stuffer::stuffer_get_labels, commands::stuffer::stuffer_create_package,
            commands::stuffer::stuffer_test_write,
            commands::stuffer::stuffer_list_accounts, commands::stuffer::stuffer_add_account,
            commands::stuffer::stuffer_delete_account, commands::stuffer::stuffer_list_all_couriers,
            // FEAT-009: привязка посылок панели к заказам
            commands::stuffer::stuffer_link_order_package,
            commands::stuffer::stuffer_unlink_order_package,
            commands::stuffer::stuffer_list_order_packages,
            commands::stuffer::stuffer_list_profile_packages,
            commands::stuffer::stuffer_refresh_package_snapshots,
            commands::stuffer::stuffer_add_courier_tag,
            commands::stuffer::stuffer_remove_courier_tag,
            commands::stuffer::stuffer_list_courier_tags,
            commands::telemetry::telemetry_send_heartbeat,
            commands::telemetry::telemetry_send_daily_stats,
            commands::telemetry::telemetry_tick,
            commands::telemetry::telemetry_get_policy,
            commands::telemetry::manager_refresh_feeds,
            commands::telemetry::get_manager_news,
            commands::telemetry::mark_manager_news_read,
            commands::telemetry::get_shop_priorities,
            commands::license::get_installation_id, commands::license::get_challenge_code, commands::license::activate_license,
            commands::license::get_license_status, commands::license::retry_license_connection,
            commands::misc::global_search, commands::misc::open_float_window, commands::misc::open_main_window_page, commands::misc::get_server_version, commands::misc::get_app_version,
            commands::automation::get_card_shop_usage, commands::automation::get_email_footprint_stats, commands::automation::get_shop_risk_score, commands::automation::get_card_timeline,
            commands::sync::sync_create_group, commands::sync::sync_create_pair_code, commands::sync::sync_join_group, commands::sync::sync_get_group_status, commands::sync::sync_disconnect,
            commands::catalog::search_catalog_items, commands::catalog::search_catalog_shops, commands::catalog::get_catalog_stats, commands::catalog::import_catalog_items, commands::catalog::import_catalog_shops,
            commands::catalog::get_catalog_items, commands::catalog::get_catalog_shops,
            commands::catalog::toggle_catalog_item_stop, commands::catalog::delete_catalog_items, commands::catalog::toggle_catalog_shop_excluded,
            commands::catalog::check_proxy_health_now, commands::catalog::get_proxy_usage_stats,
            // FEAT-018: uPanel API (PPTP servers) — connections + live proxies
            commands::upanel::upanel_connections_list, commands::upanel::upanel_connection_add,
            commands::upanel::upanel_connection_update, commands::upanel::upanel_connection_delete,
            commands::upanel::upanel_connection_test, commands::upanel::upanel_check_all_apis,
            commands::upanel::upanel_live_list, commands::upanel::upanel_live_stats,
            commands::upanel::upanel_live_credentials, commands::upanel::upanel_live_take,
            commands::upanel::upanel_map_states,
            commands::orders::batch_create_orders,
            commands::catalog::set_proxy_shop_binding, commands::catalog::remove_proxy_shop_binding, commands::catalog::get_proxy_for_shop, commands::catalog::get_all_proxy_shop_bindings,
            commands::misc::get_auto_delivered_orders,
            commands::catalog::get_profile_ltv,
            commands::catalog::get_free_email_for_shop,
            commands::catalog::get_available_emails,
            commands::catalog::set_profile_email,
            commands::catalog::find_or_create_shop,
            commands::catalog::detect_carrier_from_tracking, commands::catalog::check_tracking_direct,
            // PHASE 5: Automation Coordination
            commands::automation::get_automation_config, commands::automation::set_automation_config_cmd, commands::automation::get_automation_health,
            // PHASE 6: Smart Card Protection
            commands::automation::get_burned_cards, commands::automation::auto_archive_burned_cards_cmd,
            commands::automation::get_consecutive_declines_cmd, commands::automation::auto_archive_risky_cards_cmd,
            commands::automation::get_card_replacement_suggestions_cmd,
            // FEAT-004: IF-THEN правила автоматизации
            commands::automation::create_automation_rule, commands::automation::list_automation_rules,
            commands::automation::update_automation_rule, commands::automation::delete_automation_rule,
            commands::automation::get_automation_rule_runs,
            // PHASE 2: Shop Statistics Enhancement
            commands::automation::get_shop_stats_v2_cmd,
        ])
        .build(tauri::generate_context!())
        // FIX CRITICAL: Graceful error handling instead of panic
        .unwrap_or_else(|err| {
            eprintln!("❌ КРИТИЧЕСКАЯ ОШИБКА: Не удалось собрать Tauri приложение");
            eprintln!("   Ошибка: {}", err);
            eprintln!("\nПриложение будет закрыто.");
            std::process::exit(1);
        })
        .run(|app_handle, event| {
            // BUG-010/011: корректное завершение — уничтожить float-окно
            // (иначе его webview-процесс висит в памяти после выхода) и
            // освободить пул соединений БД (иначе на Windows остаются
            // file locks на .db/-wal до смерти процесса).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(float_win) = app_handle.get_webview_window("float") {
                    let _ = float_win.destroy();
                }
                if let Some(st) = STATE.get() {
                    if let Ok(mut db) = st.db.lock() {
                        db.close_connections();
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                        let _ = win.unminimize();
                    }
                }
            }
        });
}