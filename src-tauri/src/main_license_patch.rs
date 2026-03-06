// ============================================================
// PATCH for src-tauri/src/main.rs
// ============================================================
// 1. Replace the existing setup() / run() boot sequence with the one below.
// 2. Add the 4 new #[tauri::command] functions.
// 3. Add them to invoke_handler!
// ============================================================

// ── New commands (add alongside existing ones) ───────────────

#[tauri::command]
async fn get_challenge_code() -> Result<String, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    crate::license::get_challenge_code(&db)
}

#[tauri::command]
async fn activate_license(activation_key: String) -> Result<(), String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    crate::license::activate(&db, &activation_key)
}

#[tauri::command]
async fn get_license_status() -> Result<crate::license::LicenseStatus, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    crate::license::verify_at_startup(&db)
}

#[tauri::command]
async fn retry_license_connection() -> Result<crate::license::LicenseStatus, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    crate::license::retry_verify(&db)
}

#[tauri::command]
async fn get_installation_id() -> Result<String, String> {
    let db = DB.get().ok_or("db_not_initialized")?;
    let db = db.lock().map_err(|_| "lock_error")?;
    crate::license::get_or_create_installation_id(&db)
}

// ── Tauri setup hook (replace existing .setup() closure) ─────
//
// In tauri::Builder::default().setup(|app| { ... })  replace the body with:
//
//   let handle = app.handle().clone();
//
//   std::thread::spawn(move || {
//       // 1. Init DB (already done via OnceCell in main)
//       let db = DB.get().expect("db not initialized");
//       let db_guard = db.lock().expect("lock");
//
//       // 2. License check
//       match crate::license::verify_at_startup(&*db_guard) {
//           Ok(LicenseStatus::NotActivated) => {
//               let _ = handle.emit("show_activate", ());
//           }
//           Ok(LicenseStatus::Active) => {
//               let _ = handle.emit("show_auth", ());
//           }
//           Ok(LicenseStatus::Revoked) => {
//               let _ = handle.emit("license_revoked", ());
//           }
//           Ok(LicenseStatus::Offline) => {
//               // Allow entry — user may still unlock with password
//               let _ = handle.emit("show_auth", serde_json::json!({ "offline": true }));
//           }
//           Err(e) => {
//               eprintln!("License check error: {}", e);
//               let _ = handle.emit("show_auth", ());
//           }
//       }
//   });
//
//   Ok(())
//
// ── invoke_handler! additions ────────────────────────────────
//
// Add to the existing invoke_handler![ ... ] list:
//   get_challenge_code,
//   activate_license,
//   get_license_status,
//   retry_license_connection,
//   get_installation_id,
