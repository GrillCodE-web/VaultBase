// REDESIGN-05-6: системный трей + быстрые действия.
// Меню статичное (RU — основной язык приложения); локализация живёт на фронте,
// а трей рендерится ОС до загрузки веб-вида.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

// 9ks: бейдж непрочитанных на трее (tooltip) и таскбаре/доке. Вызывается из
// chat.rs при изменении числа непрочитанных (fetch / mark_read / mute).
pub(crate) fn set_unread(app: &AppHandle, count: u32) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tip = if count > 0 {
            format!("VaultBase — {count} непрочитанных")
        } else {
            "VaultBase".to_string()
        };
        let _ = tray.set_tooltip(Some(tip.as_str()));
    }
    // Таскбар/док-бейдж: macOS Dock и Linux Unity показывают число; на Windows
    // — best-effort (оверлей не поддерживается этим API, ошибку глушим).
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_badge_count(if count > 0 { Some(count as i64) } else { None });
    }
}

pub(crate) fn setup_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let toggle = MenuItemBuilder::with_id("toggle", "Показать / скрыть").build(app)?;
    let sync = MenuItemBuilder::with_id("sync", "Синхронизация").build(app)?;
    let panic = MenuItemBuilder::with_id("panic", "Panic — стереть данные…").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Выход").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&toggle, &sync])
        .separator()
        .item(&panic)
        .separator()
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("VaultBase")
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => crate::desktop::toggle_main(app),
            // Синхронизацию выполняет фронт (там контекст сессии и тосты).
            "sync" => {
                crate::desktop::show_main(app);
                let _ = app.emit("tray:sync", ());
            }
            "panic" => crate::desktop::panic_request(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::desktop::toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
