#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod alerts;
mod commands;
mod crypto;
mod db;
mod http;
mod license;
mod state;
mod telemetry;
mod vault;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::set_server_url,
            commands::activate_license,
            commands::setup_master_password,
            commands::unlock_app,
            commands::lock_app,
            commands::server_request,
            commands::sync_telemetry,
            commands::get_analytics,
            commands::get_fleet_comparison,
            commands::get_fleet_bin_shop,
            commands::get_worker_snapshots,
            commands::get_worker_stats,
            commands::evaluate_alerts,
            commands::get_local_alerts,
            commands::local_alert_action,
            commands::get_config_values,
            commands::set_config_value,
            commands::wipe_local_data,
commands::vault_import,
commands::vault_list,
commands::vault_stats,
commands::vault_issue,
commands::vault_sync_issue_status,
commands::vault_recall,
commands::vault_burn,
commands::vault_export,
commands::vault_export_log,
            commands::check_app_update,
            commands::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VaultBase Manager");
}
