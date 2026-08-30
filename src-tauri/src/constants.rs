//! Global constants for VaultBase application
//! 
//! Contains URLs, timeouts, limits, and other configuration values
//! that were previously hardcoded in the source code.
//!
//! FIX CRITICAL: Centralized configuration for easy maintenance and security

// ─────────────────────────────────────────────────────────────────────
//  External API URLs
// ─────────────────────────────────────────────────────────────────────

/// VaultBase sync server URL
/// FIX B-CONFIG: Was hardcoded in sync.rs, now configurable
pub const SYNC_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";

/// Default server URL for HTTP sync
pub const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";

/// Base URL for Stuffer API integration
pub const STUFFER_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";

/// IIN/BIN lookup API - Iinapi service
pub const IINAPI_BASE_URL: &str = "https://api.iinapi.com/api/v1/";

/// Track17 API for package tracking
pub const TRACK17_API_URL: &str = "https://api.17track.net/track/v2.2/gettrackinfo";

/// FEAT-018: base URL of the uPanel REST API (PPTP servers). The Bearer
/// token is issued in the uPanel profile and is stored encrypted
/// (AES-256-GCM) per connection.
pub const UPANEL_API_BASE_URL: &str = "https://upanel.ushubpulse.com/api/v1";

/// FEAT-018: timeout for a regular uPanel request (list/take), seconds.
pub const UPANEL_REQUEST_TIMEOUT_SECS: u64 = 15;

/// FEAT-018: shorter timeout for Online/Offline status pings (`GET /me`)
/// so a dead node does not stall the dashboard refresh.
pub const UPANEL_STATUS_TIMEOUT_SECS: u64 = 6;

// ─────────────────────────────────────────────────────────────────────
//  Tracking APIs (Carrier Detection)
// ─────────────────────────────────────────────────────────────────────

/// USPS Tracking API
pub const TRACKING_USPS_URL: &str = "https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML={}";

/// UPS Tracking API
pub const TRACKING_UPS_URL: &str = "https://ontrack.ups.com/api/tracking/{}";

/// UPS OAuth token endpoint
pub const TRACKING_UPS_TOKEN_URL: &str = "https://ontrack.ups.com/security/v1/oauth/token";

/// FedEx Tracking API
pub const TRACKING_FEDEX_URL: &str = "https://apis.fedex.com/track/v2/trackingnumbers";

// ─────────────────────────────────────────────────────────────────────
//  Background Thread Intervals (in seconds)
// ─────────────────────────────────────────────────────────────────────

/// Autolock check interval (30 seconds)
/// FIX B-CONFIG: Was hardcoded to 30s in background.rs
pub const AUTOLOCK_CHECK_INTERVAL_SECS: u64 = 30;

/// Default autolock timeout if not configured (5 minutes)
pub const DEFAULT_AUTOLOCK_TIMEOUT_SECS: u64 = 300;

/// IMAP sync check interval (5 seconds)
pub const IMAP_CHECK_INTERVAL_SECS: u64 = 5;

/// IMAP failure pause (10 minutes before retry)
pub const IMAP_FAILURE_PAUSE_SECS: u64 = 600;

/// IMAP recovery interval (2 minutes)
pub const IMAP_RECOVERY_INTERVAL_SECS: u64 = 120;

/// Sync initial startup delay (5 seconds - allow app unlock)
pub const SYNC_STARTUP_DELAY_SECS: u64 = 5;

/// Sync check interval between attempts (2 minutes)
pub const SYNC_CHECK_INTERVAL_SECS: u64 = 120;

/// Sync pause after failures (10 minutes)
pub const SYNC_FAILURE_PAUSE_SECS: u64 = 600;

/// License check interval (1 minute)
pub const LICENSE_CHECK_INTERVAL_SECS: u64 = 60;

/// Risk check interval (5 minutes)
pub const RISK_CHECK_INTERVAL_SECS: u64 = 300;

/// Order fulfillment check interval (30 minutes)
pub const FULFILLMENT_CHECK_INTERVAL_SECS: u64 = 1800;

/// Quarantine cleanup check interval (30 minutes)
pub const QUARANTINE_CHECK_INTERVAL_SECS: u64 = 1800;

/// Couriers stuffer sync start delay (1 minute)
pub const STUFFER_SYNC_START_DELAY_SECS: u64 = 60;

/// FEAT-006/007: напоминания проверяются раз в сутки
pub const REMINDER_CHECK_INTERVAL_SECS: u64 = 24 * 3600;

/// FEAT-006/007: стартовая задержка напоминаний (даём разблокировать БД)
pub const REMINDER_START_DELAY_SECS: u64 = 300;

/// FEAT-006: за сколько дней предупреждать об истечении карты (дефолт)
pub const REMINDER_CARD_EXPIRY_DAYS_DEFAULT: i64 = 14;

/// FEAT-007: через сколько дней без обновления shipped-заказ «застоялся» (дефолт)
pub const REMINDER_TRACKING_STALE_DAYS_DEFAULT: i64 = 5;

/// REDESIGN-05-5B3: delivered старше стольких часов и не перебит → алерт
pub const REWORK_OVERDUE_HOURS: i64 = 24;

/// Couriers stuffer sync interval (5 minutes)
pub const STUFFER_SYNC_INTERVAL_SECS: u64 = 300;

/// Catalog initial fetch delay (5 seconds)
pub const CATALOG_STARTUP_DELAY_SECS: u64 = 5;

// ─────────────────────────────────────────────────────────────────────
//  HTTP Request Timeouts (in seconds)
// ─────────────────────────────────────────────────────────────────────

/// Default HTTP request timeout
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Tracking API request timeout (15 seconds for faster response)
pub const TRACKING_REQUEST_TIMEOUT_SECS: u64 = 15;

// ─────────────────────────────────────────────────────────────────────
//  Cache Configuration
// ─────────────────────────────────────────────────────────────────────

/// Tracking cache TTL (5 minutes)
pub const TRACKING_CACHE_TTL_SECS: i64 = 300;

/// Tracking cache max size (prevent unbounded growth)
pub const TRACKING_CACHE_MAX_SIZE: usize = 1000;

/// Tracking cache cleanup interval (every 100 inserts)
pub const TRACKING_CACHE_CLEANUP_INTERVAL: usize = 100;

/// Rate limiter bucket max age (window * 2)
pub const RATE_LIMITER_MAX_AGE_MULTIPLIER: u64 = 2;

// ─────────────────────────────────────────────────────────────────────
//  Rate Limiting Configuration
// ─────────────────────────────────────────────────────────────────────

/// Strict rate limit: 5 requests per minute (sensitive operations)
pub const RATE_LIMIT_STRICT_COUNT: u32 = 5;

/// Strict rate limit window (60 seconds)
pub const RATE_LIMIT_STRICT_WINDOW_SECS: u64 = 60;

/// Moderate rate limit: 30 requests per minute (normal operations)
pub const RATE_LIMIT_MODERATE_COUNT: u32 = 30;

/// Moderate rate limit window (60 seconds)
pub const RATE_LIMIT_MODERATE_WINDOW_SECS: u64 = 60;

/// Lenient rate limit: 100 requests per minute (read-only operations)
pub const RATE_LIMIT_LENIENT_COUNT: u32 = 100;

/// Lenient rate limit window (60 seconds)
pub const RATE_LIMIT_LENIENT_WINDOW_SECS: u64 = 60;

// ─────────────────────────────────────────────────────────────────────
//  Quarantine Configuration
// ─────────────────────────────────────────────────────────────────────

/// Standard quarantine period (14 days)
pub const QUARANTINE_PERIOD_DAYS: i64 = 14;

/// Payment received quarantine period (2 days)
pub const QUARANTINE_PAYMENT_RECEIVED_DAYS: i64 = 2;

// ─────────────────────────────────────────────────────────────────────
//  Database Configuration
// ─────────────────────────────────────────────────────────────────────

/// SQLite connection pool size
pub const DB_POOL_SIZE: u32 = 5;

/// SQLite WAL auto-checkpoint interval (1000 pages)
pub const SQLITE_WAL_AUTO_CHECKPOINT: i32 = 1000;

// ─────────────────────────────────────────────────────────────────────
//  Security Configuration
// ─────────────────────────────────────────────────────────────────────

/// PBKDF2 iterations for password hashing (OWASP high-security: 1M)
pub const PBKDF2_ITERATIONS: u32 = 1_000_000;

/// Default encryption key derivation iterations
pub const ENCRYPTION_KEY_ITERATIONS: u32 = 100_000;

// ─────────────────────────────────────────────────────────────────────
//  Data Limits
// ─────────────────────────────────────────────────────────────────────

/// Maximum number of items in bulk operations
pub const MAX_BULK_OPERATION_SIZE: usize = 500;

/// Maximum number of IDs for IN clause
pub const MAX_IN_CLAUSE_IDS: usize = 500;

/// Maximum IMAP message chunk size for processing
pub const MAX_IMAP_FETCH_SIZE: usize = 100;

/// Rate limiter bucket cleanup interval (every 100 checks)
pub const RATE_LIMITER_CLEANUP_INTERVAL: usize = 100;

// ─────────────────────────────────────────────────────────────────────
//  WebSocket Sync (CLEAN-004: magic numbers extracted)
// ─────────────────────────────────────────────────────────────────────

/// WS reconnect interval (seconds)
pub const WS_RECONNECT_SECS: u64 = 3;

/// WS keepalive ping interval (seconds)
pub const WS_PING_INTERVAL_SECS: u64 = 30;

/// WS max missed pings before reconnect
pub const WS_MAX_MISSED_PINGS: u32 = 2;

/// WS full_pull debounce window (seconds)
pub const WS_FULL_PULL_DEBOUNCE_SECS: u64 = 30;

/// Max cards in a single sync batch
pub const WS_MAX_BATCH_SIZE: usize = 100;

/// Max notes length in sync messages
pub const WS_MAX_NOTES_LEN: usize = 500;

// ─────────────────────────────────────────────────────────────────────
//  Frontend UI Constants (reference — actual values in JS)
// ─────────────────────────────────────────────────────────────────────

/// Card virtualizer threshold (enable virtual scroll above this count)
pub const CARDS_VIRTUALIZER_THRESHOLD: usize = 200;

/// Clipboard sensitive data auto-clear timeout (seconds)
pub const CLIPBOARD_SENSITIVE_CLEAR_SECS: u64 = 30;

/// BIN cache TTL (days)
pub const BIN_CACHE_TTL_DAYS: i64 = 30;
