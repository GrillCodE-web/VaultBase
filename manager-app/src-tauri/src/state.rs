use crate::crypto::FieldEncryption;
use crate::db::Database;
use std::sync::Mutex;

pub enum DbState {
    Closed,
    Open { db: Database, enc: FieldEncryption },
}

pub struct AppState {
    pub db: Mutex<DbState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(DbState::Closed),
        }
    }
}

pub fn with_open<F, R>(state: &tauri::State<'_, AppState>, f: F) -> Result<R, String>
where
    F: FnOnce(&Database, &FieldEncryption) -> Result<R, String>,
{
    with_open_app(state, f)
}

/// То же, но от голого AppState — для фоновых потоков (ws.rs), у которых
/// есть только AppHandle, а не tauri::State из сигнатуры команды.
pub fn with_open_app<F, R>(state: &AppState, f: F) -> Result<R, String>
where
    F: FnOnce(&Database, &FieldEncryption) -> Result<R, String>,
{
    let guard = state.db.lock().map_err(|_| "state_poisoned".to_string())?;
    match &*guard {
        DbState::Open { db, enc } => f(db, enc),
        DbState::Closed => Err("locked".to_string()),
    }
}
