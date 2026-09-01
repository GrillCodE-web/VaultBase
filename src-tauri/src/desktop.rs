// REDESIGN-05-6: десктоп-натив — пресеты окон, запуск свёрнутым, глобальная
// panic-клавиша. Настройки лежат в plaintext-файле desktop.json РЯДОМ с БД,
// а не в config-таблице: они нужны ДО разблокировки SQLCipher (bounds окон
// применяются в setup(), panic-хоткей регистрируется до ввода мастер-пароля).
// Секретов здесь нет — хоткей без panic-пароля ничего не стирает.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub(crate) struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct DesktopConfig {
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub panic_hotkey: Option<String>,
    // None = дефолт из tauri.conf.json (float всегда поверх)
    #[serde(default)]
    pub float_aot: Option<bool>,
    #[serde(default)]
    pub main_bounds: Option<WindowBounds>,
    #[serde(default)]
    pub float_bounds: Option<WindowBounds>,
}

fn config_path() -> PathBuf {
    crate::state::db_path()
        .parent()
        .map(|d| d.join("desktop.json"))
        .unwrap_or_else(|| PathBuf::from("desktop.json"))
}

pub(crate) fn load_config() -> DesktopConfig {
    let Ok(text) = std::fs::read_to_string(config_path()) else {
        return DesktopConfig::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_config_to(path: &PathBuf, cfg: &DesktopConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

pub(crate) fn update_config(f: impl FnOnce(&mut DesktopConfig)) -> Result<(), String> {
    let mut cfg = load_config();
    f(&mut cfg);
    save_config_to(&config_path(), &cfg)
}

// ── Panic-хоткей ─────────────────────────────────────────────────────────

static PANIC_SHORTCUT: Mutex<Option<Shortcut>> = Mutex::new(None);

fn push_mod(mods: &mut Vec<&'static str>, m: &'static str) {
    if !mods.contains(&m) {
        mods.push(m);
    }
}

fn normalize_key(token: &str) -> String {
    let low = token.to_ascii_lowercase();
    if low.chars().count() == 1 {
        return low.to_ascii_uppercase();
    }
    if let Some(rest) = low.strip_prefix('f') {
        if let Ok(n) = rest.parse::<u32>() {
            if (1..=24).contains(&n) {
                return format!("F{n}");
            }
        }
    }
    match low.as_str() {
        "space" => "Space".into(),
        "esc" | "escape" => "Escape".into(),
        "enter" | "return" => "Enter".into(),
        "tab" => "Tab".into(),
        "backspace" => "Backspace".into(),
        "delete" | "del" => "Delete".into(),
        "insert" | "ins" => "Insert".into(),
        "home" => "Home".into(),
        "end" => "End".into(),
        "pageup" => "PageUp".into(),
        "pagedown" => "PageDown".into(),
        "up" => "Up".into(),
        "down" => "Down".into(),
        "left" => "Left".into(),
        "right" => "Right".into(),
        _ => {
            let mut chars = low.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => low,
            }
        }
    }
}

/// «Ctrl+Shift+F12» → «CmdOrControl+Shift+F12» (формат tauri Shortcut).
/// None — пустой ввод (хоткей снят). Err — не валидно (без модификатора/ключа).
pub(crate) fn normalize_hotkey(raw: &str) -> Result<Option<String>, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let mut mods: Vec<&'static str> = Vec::new();
    let mut key: Option<String> = None;
    for part in raw.split('+') {
        let token = part.trim();
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "cmd" | "command" | "cmdorcontrol" => {
                push_mod(&mut mods, "CmdOrControl")
            }
            "alt" | "option" => push_mod(&mut mods, "Alt"),
            "shift" => push_mod(&mut mods, "Shift"),
            "super" | "win" | "meta" => push_mod(&mut mods, "Super"),
            "" => return Err(format!("hotkey_invalid: {raw}")),
            _ => {
                if key.is_some() {
                    return Err(format!("hotkey_two_keys: {raw}"));
                }
                key = Some(normalize_key(token));
            }
        }
    }
    // panic-клавиша обязана содержать модификатор и клавишу — иначе слишком
    // легко задеть случайно.
    let Some(k) = key else {
        return Err("hotkey_no_key".into());
    };
    if mods.is_empty() {
        return Err("hotkey_no_modifier".into());
    }
    Ok(Some(format!("{}+{}", mods.join("+"), k)))
}

pub(crate) fn register_panic_hotkey(app: &AppHandle, normalized: &str) -> Result<(), String> {
    let shortcut: Shortcut = normalized
        .parse()
        .map_err(|e| format!("hotkey_invalid: {e}"))?;
    let mut guard = PANIC_SHORTCUT.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("hotkey_register_failed: {e}"))?;
    *guard = Some(shortcut);
    Ok(())
}

pub(crate) fn unregister_panic_hotkey(app: &AppHandle) {
    if let Ok(mut guard) = PANIC_SHORTCUT.lock() {
        if let Some(old) = guard.take() {
            let _ = app.global_shortcut().unregister(old);
        }
    }
}

pub(crate) fn on_panic_shortcut(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    // Handler общий для плагина — сверяем, что сработал именно panic-хоткей.
    let is_panic = PANIC_SHORTCUT
        .lock()
        .ok()
        .and_then(|g| *g)
        .map(|s| s == *shortcut)
        .unwrap_or(false);
    if !is_panic {
        return;
    }
    panic_request(app);
}

/// Хоткей / пункт трея: показать окно и попросить фронт открыть PIN-модалку.
pub(crate) fn panic_request(app: &AppHandle) {
    show_main(app);
    let _ = app.emit("panic:request", ());
}

pub(crate) fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub(crate) fn toggle_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => show_main(app),
        }
    }
}

// ── Геометрия окон ───────────────────────────────────────────────────────

pub(crate) fn current_bounds(win: &WebviewWindow) -> Option<WindowBounds> {
    let scale = win.scale_factor().ok()?;
    let pos = win.outer_position().ok()?;
    let size = win.inner_size().ok()?;
    Some(WindowBounds {
        x: (pos.x as f64 / scale).round() as i32,
        y: (pos.y as f64 / scale).round() as i32,
        w: (size.width as f64 / scale).round() as u32,
        h: (size.height as f64 / scale).round() as u32,
    })
}

pub(crate) fn save_bounds_for(win: &WebviewWindow, label: &str) {
    let Some(b) = current_bounds(win) else { return };
    // Свёрнутое/нулевое окно не запоминаем — восстановится мусор.
    if b.w < 200 || b.h < 200 {
        return;
    }
    let _ = update_config(|cfg| {
        if label == "float" {
            cfg.float_bounds = Some(b);
        } else {
            cfg.main_bounds = Some(b);
        }
    });
}

fn apply_bounds(win: &WebviewWindow, b: &WindowBounds, min_w: u32, min_h: u32) {
    let w = b.w.max(min_w);
    let h = b.h.max(min_h);
    let _ = win.set_size(tauri::LogicalSize::new(w as f64, h as f64));
    // Позицию применяем, только если она заведомо видна на главном мониторе —
    // иначе (монитор отключили) окно уедет за экран.
    let on_screen = win
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let mw = m.size().width as f64 / scale;
            let mh = m.size().height as f64 / scale;
            let mx = m.position().x as f64 / scale;
            let my = m.position().y as f64 / scale;
            b.x as f64 + 80.0 > mx
                && (b.x as f64) < mx + mw - 80.0
                && b.y as f64 + 40.0 > my
                && (b.y as f64) < my + mh - 40.0
        })
        .unwrap_or(false);
    if on_screen {
        let _ = win.set_position(tauri::LogicalPosition::new(b.x as f64, b.y as f64));
    } else {
        let _ = win.center();
    }
}

pub(crate) fn apply_preset(app: &AppHandle, preset: &str) -> Result<(), String> {
    let (mut w, mut h): (f64, f64) = match preset {
        "compact" => (960.0, 620.0),
        "large" => (1600.0, 950.0),
        "standard" => (1280.0, 800.0),
        _ => return Err(format!("unknown_preset: {preset}")),
    };
    let win = app
        .get_webview_window("main")
        .ok_or("main_window_not_found")?;
    if let Ok(Some(m)) = win.primary_monitor() {
        let scale = m.scale_factor();
        w = w.min(m.size().width as f64 / scale - 40.0);
        h = h.min(m.size().height as f64 / scale - 80.0);
    }
    let _ = win.unmaximize();
    win.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    win.center().map_err(|e| e.to_string())?;
    save_bounds_for(&win, "main");
    Ok(())
}

/// Вызывается из setup(): восстановить геометрию/AOT, зарегистрировать
/// panic-хоткей, свернуть в трей если так настроено. Не падает никогда.
pub(crate) fn apply_startup(app: &tauri::App) {
    let cfg = load_config();
    if let Some(win) = app.get_webview_window("main") {
        if let Some(b) = &cfg.main_bounds {
            apply_bounds(&win, b, 960, 600);
        }
        if cfg.start_minimized {
            let _ = win.hide();
        }
    }
    if let Some(float_win) = app.get_webview_window("float") {
        if let Some(b) = &cfg.float_bounds {
            apply_bounds(&float_win, b, 340, 320);
        }
        if let Some(aot) = cfg.float_aot {
            let _ = float_win.set_always_on_top(aot);
        }
    }
    if let Some(hk) = cfg.panic_hotkey.as_deref() {
        match normalize_hotkey(hk) {
            Ok(Some(norm)) => {
                if let Err(e) = register_panic_hotkey(&app.handle().clone(), &norm) {
                    tracing::warn!(error = %e, "panic hotkey register failed");
                }
            }
            _ => tracing::warn!(hotkey = %hk, "panic hotkey invalid, skipped"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("desktop.json");
        let cfg = DesktopConfig {
            start_minimized: true,
            panic_hotkey: Some("CmdOrControl+Shift+F12".into()),
            float_aot: Some(false),
            main_bounds: Some(WindowBounds { x: 10, y: 20, w: 1280, h: 800 }),
            float_bounds: None,
        };
        save_config_to(&path, &cfg).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let loaded: DesktopConfig = serde_json::from_str(&text).unwrap();
        assert!(loaded.start_minimized);
        assert_eq!(loaded.panic_hotkey.as_deref(), Some("CmdOrControl+Shift+F12"));
        assert_eq!(loaded.float_aot, Some(false));
        assert_eq!(
            loaded.main_bounds,
            Some(WindowBounds { x: 10, y: 20, w: 1280, h: 800 })
        );
        assert_eq!(loaded.float_bounds, None);
    }

    #[test]
    fn config_missing_fields_default() {
        let cfg: DesktopConfig = serde_json::from_str("{}").unwrap();
        assert!(!cfg.start_minimized);
        assert!(cfg.panic_hotkey.is_none());
        assert!(cfg.main_bounds.is_none());
    }

    #[test]
    fn hotkey_normalization() {
        assert_eq!(
            normalize_hotkey("Ctrl+Shift+F12").unwrap(),
            Some("CmdOrControl+Shift+F12".into())
        );
        assert_eq!(
            normalize_hotkey("ctrl+alt+p").unwrap(),
            Some("CmdOrControl+Alt+P".into())
        );
        assert_eq!(
            normalize_hotkey("Cmd+Space").unwrap(),
            Some("CmdOrControl+Space".into())
        );
        assert_eq!(normalize_hotkey("  ").unwrap(), None);
        // без модификатора / без клавиши / два ключа — отказ
        assert!(normalize_hotkey("F12").is_err());
        assert!(normalize_hotkey("Ctrl+Shift").is_err());
        assert!(normalize_hotkey("Ctrl+A+B").is_err());
        assert!(normalize_hotkey("Ctrl++").is_err());
    }
}
