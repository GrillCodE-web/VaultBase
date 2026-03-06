// ============================================================
// PATCH for src-tauri/src/main.rs — Dashboard commands
// Add these #[tauri::command] functions and register them
// in invoke_handler!
// ============================================================

#[tauri::command]
async fn get_dashboard_stats(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<crate::models::DashboardStats, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_dashboard_stats(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_revenue_chart(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<crate::models::RevenuePoint>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_revenue_chart(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_heatmap_data(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<crate::models::HeatmapCell>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_heatmap_data(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_top_banks(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<crate::models::BankStats>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_top_banks(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_by_country(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<crate::models::CountryStats>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_by_country(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_by_source(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<Vec<crate::models::SourceStats>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_by_source(&period, from.as_deref(), to.as_deref())
}

#[tauri::command]
async fn get_expiring_cards_dashboard(days: u32) -> Result<Vec<crate::models::ExpiringCard>, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_expiring_cards(days)
}

#[tauri::command]
async fn get_sidebar_badges() -> Result<crate::models::SidebarBadges, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.get_sidebar_badges()
}

#[tauri::command]
async fn export_dashboard_csv(
    period: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<String, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    if db.is_locked() { return Err("locked".into()); }
    db.export_dashboard_csv(&period, from.as_deref(), to.as_deref())
}

// ── invoke_handler! additions ─────────────────────────────────
// Add to the existing invoke_handler![ ... ] list:
//   get_dashboard_stats,
//   get_revenue_chart,
//   get_heatmap_data,
//   get_top_banks,
//   get_by_country,
//   get_by_source,
//   get_expiring_cards_dashboard,
//   get_sidebar_badges,
//   export_dashboard_csv,
