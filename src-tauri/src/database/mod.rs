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

include!("imp.core.rs");
include!("imp.cards.rs");
include!("imp.analytics.rs");
include!("imp.imap.rs");
include!("imp.profiles.rs");
include!("imp.upanel.rs");
include!("imp.shops.rs");
include!("imp.orders.rs");
include!("imp.chat.rs");
include!("imp.stuffer.rs");
include!("imp.misc.rs");
include!("imp.automation.rs");
include!("imp.users.rs");
include!("imp.helpers.rs");
include!("imp.seed.rs");
include!("imp.migrations.rs");
