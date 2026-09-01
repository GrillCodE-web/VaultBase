// REDESIGN-05-6: десктоп-натив команды — конфиг трея/окон, пресеты,
// panic-хоткей и panic-wipe по пину. Сами настройки и логика — в crate::desktop,
// трей — в crate::tray. Хранение вне БД (desktop.json): нужно до разблокировки.

use crate::desktop;
use crate::rate_limiter;
use crate::state::*;
use tauri::Manager;

#[tauri::command]
pub(crate) fn desktop_get_config() -> Result<desktop::DesktopConfig, String> {
    require_user()?;
    Ok(desktop::load_config())
}

#[tauri::command]
pub(crate) fn desktop_set_start_minimized(flag: bool) -> Result<(), String> {
    require_user()?;
    desktop::update_config(|c| c.start_minimized = flag)
}

#[tauri::command]
pub(crate) fn desktop_set_float_aot(flag: bool, app: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    if let Some(float_win) = app.get_webview_window("float") {
        let _ = float_win.set_always_on_top(flag);
    }
    desktop::update_config(|c| c.float_aot = Some(flag))
}

/// None/пустая строка — снять хоткей. Возвращает нормализованную форму,
/// которая реально зарегистрирована (для отображения в Settings).
#[tauri::command]
pub(crate) fn desktop_set_panic_hotkey(
    hotkey: Option<String>,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    require_user()?;
    let raw = hotkey.as_deref().map(str::trim).unwrap_or("");
    match desktop::normalize_hotkey(raw)? {
        None => {
            desktop::unregister_panic_hotkey(&app);
            desktop::update_config(|c| c.panic_hotkey = None)?;
            Ok(None)
        }
        Some(norm) => {
            desktop::register_panic_hotkey(&app, &norm)?;
            desktop::update_config(|c| c.panic_hotkey = Some(norm.clone()))?;
            Ok(Some(norm))
        }
    }
}

/// Пресет размера главного окна: compact / standard / large.
#[tauri::command]
pub(crate) fn window_apply_preset(preset: String, app: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    desktop::apply_preset(&app, &preset)
}

#[tauri::command]
pub(crate) fn window_reset_layout(app: tauri::AppHandle) -> Result<(), String> {
    require_user()?;
    desktop::update_config(|c| {
        c.main_bounds = None;
        c.float_bounds = None;
    })?;
    desktop::apply_preset(&app, "standard")
}

/// REDESIGN-05-6: wipe по хоткею/из трея. Пин — это panic-пароль (MGR-013):
/// та же bcrypt-проверка по sidecar, что и на unlock, и тот же беззвучный
/// криптостир (без логов и audit). require_user НЕТ специально: panic должен
/// срабатывать и с экрана блокировки. Ответ при неверном пине неотличим от
/// «panic-пароль не задан» — как в unlock.
#[tauri::command]
pub(crate) fn panic_wipe(pin: String) -> Result<(), String> {
    rate_limiter::check_rate_limit(
        rate_limiter::RateLimitCategory::Strict,
        rate_limiter::get_rate_limit_key("panic_wipe"),
    )?;
    let db_path = crate::state::db_path();
    let db_path_str = db_path.to_str().unwrap_or("vaultbase.db");
    let panic_hash = crate::database::Database::read_sidecar(db_path_str)
        .or_else(|| crate::database::Database::read_sidecar_bak(db_path_str))
        .and_then(|sc| sc.panic_hash);
    let Some(hash) = panic_hash else {
        return Err("invalid_credentials".into());
    };
    if !bcrypt::verify(&pin, &hash).unwrap_or(false) {
        return Err("invalid_credentials".into());
    }
    if let Ok(mut db) = state().db.lock() {
        db.close_connections();
    }
    crate::wipe::wipe_local_data(db_path_str);
    std::process::exit(0);
}
