//! SQLite database layer — migration runner + Database struct with all CC operations.
//! FIX B-MED-04: Connection pooling with r2d2 for better concurrent access
#![allow(unused_imports, unused_variables, dead_code)]

use rusqlite::{Connection, Result as SqlResult, params, params_from_iter, ToSql};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use chrono::{Utc, Local};
use uuid::Uuid;
use crate::encryption::{FieldEncryption, PasswordValidation, hash_value_with_key};
use crate::models::*;
use crate::parser::{extract_bin_last4, luhn_valid};

pub const CURRENT_MIGRATION_VERSION: u32 = 10;


// ─────────────────────────────────────────
//  Database struct
// ─────────────────────────────────────────

// FIX B-MED-04: Type alias for r2d2 connection pool
pub type DbPool = Pool<SqliteConnectionManager>;

pub struct Database {
    pub conn: Connection,  // Direct connection for single-user desktop mode
    pub pool: Option<DbPool>,  // Connection pool for concurrent access (optional)
    pub encryption: Option<Arc<FieldEncryption>>,
    pub last_activity: Arc<Mutex<Instant>>,
    pub autolock_timeout: Option<Duration>,
}

include!("_core.rs");
include!("_cards.rs");
include!("_analytics.rs");
include!("_imap.rs");
include!("_profiles.rs");
include!("_shops.rs");
include!("_orders.rs");
include!("_misc.rs");
include!("_users.rs");
include!("_helpers.rs");
include!("_seed.rs");
include!("_migrations.rs");
