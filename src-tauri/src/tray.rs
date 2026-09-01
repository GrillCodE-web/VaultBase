// REDESIGN-05-6: системный трей + быстрые действия.
// Меню статичное (RU — основной язык приложения); локализация живёт на фронте,
// а трей рендерится ОС до загрузки веб-вида.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

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
