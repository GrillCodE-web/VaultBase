# VaultBase Configuration Constants Reference

**Version:** 2.11.2  
**Last Updated:** 2026-08-11

## Overview

This document describes all configurable constants in VaultBase. All values are defined in `src-tauri/src/constants.rs` and can be easily modified for different deployment scenarios.

---

## Table of Contents

1. [External API URLs](#external-api-urls)
2. [Tracking APIs](#tracking-apis)
3. [Background Thread Intervals](#background-thread-intervals)
4. [HTTP Request Timeouts](#http-request-timeouts)
5. [Cache Configuration](#cache-configuration)
6. [Rate Limiting](#rate-limiting)
7. [Quarantine Configuration](#quarantine-configuration)
8. [Database Configuration](#database-configuration)
9. [Security Configuration](#security-configuration)
10. [Data Limits](#data-limits)

---

## External API URLs

### SYNC_SERVER_URL

```rust
pub const SYNC_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
```

**Purpose:** Main VaultBase sync server for footprint synchronization  
**Usage:** Used in `sync.rs` for all sync operations  
**Environment:** Production URL  
**Change Impact:** Medium - requires server reachability test

### DEFAULT_SERVER_URL

```rust
pub const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
```

**Purpose:** Default server URL for HTTP sync fallback  
**Usage:** Backup endpoint when primary sync fails  
**Change Impact:** Low - used as fallback only

### STUFFER_BASE_URL

```rust
pub const STUFFER_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";
```

**Purpose:** Integration with Stuffer API for courier data  
**Usage:** `stuffer.rs` module  
**Note:** Requires API key configuration  
**Change Impact:** High - API provider change

### IINAPI_BASE_URL

```rust
pub const IINAPI_BASE_URL: &str = "https://api.iinapi.com/api/v1/";
```

**Purpose:** IIN/BIN lookup service for credit card validation  
**Usage:** Card type detection, validation  
**Note:** Requires API key configuration  
**Change Impact:** High - affects card detection

### TRACK17_API_URL

```rust
pub const TRACK17_API_URL: &str = "https://api.17track.net/track/v2.2/gettrackinfo";
```

**Purpose:** Package tracking API (fallback carrier)  
**Usage:** When carrier-specific APIs fail  
**Note:** Requires API key  
**Change Impact:** Medium - affects tracking accuracy

---

## Tracking APIs

### TRACKING_USPS_URL

```rust
pub const TRACKING_USPS_URL: &str = "https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML={}";
```

**Purpose:** USPS Web Tools Track API endpoint  
**Format:** XML-based, expects URL-encoded XML request  
**Auth:** Requires `USPS_API_USER_ID` environment variable  
**Timeout:** 10 seconds (hardcoded in tracking.rs)  
**Supported Patterns:**

- 9400/9405/9407/9409 + 18 digits
- 9 + 20-22 digits

### TRACKING_UPS_URL

```rust
pub const TRACKING_UPS_URL: &str = "https://ontrack.ups.com/api/tracking/{}";
```

**Purpose:** UPS package tracking API  
**Format:** REST JSON endpoint  
**Auth:** OAuth2 (requires `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`)  
**Timeout:** 10 seconds  
**Supported Patterns:**

- 1Z + 16 characters (18 total)

### TRACKING_UPS_TOKEN_URL

```rust
pub const TRACKING_UPS_TOKEN_URL: &str = "https://ontrack.ups.com/security/v1/oauth/token";
```

**Purpose:** OAuth2 token endpoint for UPS API  
**Method:** POST with client credentials  
**Token Expiry:** Varies (typically 1 hour)  
**Retry:** Yes, automatic on 401

### TRACKING_FEDEX_URL

```rust
pub const TRACKING_FEDEX_URL: &str = "https://apis.fedex.com/track/v2/trackingnumbers";
```

**Purpose:** FedEx package tracking API  
**Format:** REST JSON endpoint  
**Auth:** API key in header  
**Timeout:** 10 seconds  
**Supported Patterns:**

- 12 digits
- 15 digits

---

## Background Thread Intervals

### AUTOLOCK_CHECK_INTERVAL_SECS

```rust
pub const AUTOLOCK_CHECK_INTERVAL_SECS: u64 = 30;
```

**Purpose:** How often to check if app should auto-lock  
**Default:** 30 seconds  
**Min:** 5 seconds (for responsive locking)  
**Max:** 300 seconds (5 minutes)  
**Thread:** Main autolock thread  
**Change Impact:** Low - UX responsiveness

### DEFAULT_AUTOLOCK_TIMEOUT_SECS

```rust
pub const DEFAULT_AUTOLOCK_TIMEOUT_SECS: u64 = 300;
```

**Purpose:** Default auto-lock timeout if not configured by user  
**Default:** 300 seconds (5 minutes)  
**User Override:** Yes (via settings)  
**Change Impact:** Medium - affects security/UX balance

### IMAP_CHECK_INTERVAL_SECS

```rust
pub const IMAP_CHECK_INTERVAL_SECS: u64 = 5;
```

**Purpose:** How often to check for IMAP connectivity  
**Default:** 5 seconds  
**Note:** Lightweight check, doesn't fetch emails  
**Change Impact:** Low - status indicator only

### IMAP_FAILURE_PAUSE_SECS

```rust
pub const IMAP_FAILURE_PAUSE_SECS: u64 = 600;
```

**Purpose:** Pause after IMAP connection failure  
**Default:** 600 seconds (10 minutes)  
**Prevents:** Connection spam on server errors  
**Change Impact:** Medium - affects error recovery

### IMAP_RECOVERY_INTERVAL_SECS

```rust
pub const IMAP_RECOVERY_INTERVAL_SECS: u64 = 120;
```

**Purpose:** Time between recovery attempts  
**Default:** 120 seconds (2 minutes)  
**Context:** Resume after pause  
**Change Impact:** Low

### LICENSE_CHECK_INTERVAL_SECS

```rust
pub const LICENSE_CHECK_INTERVAL_SECS: u64 = 60;
```

**Purpose:** How often to verify license validity  
**Default:** 60 seconds (1 minute)  
**Note:** Lightweight check, doesn't block UI  
**Change Impact:** Low - background only

### RISK_CHECK_INTERVAL_SECS

```rust
pub const RISK_CHECK_INTERVAL_SECS: u64 = 300;
```

**Purpose:** How often to scan for risky/suspicious activity  
**Default:** 300 seconds (5 minutes)  
**Actions:** Auto-archive if configured  
**Change Impact:** Medium - affects fraud detection

### FULFILLMENT_CHECK_INTERVAL_SECS

```rust
pub const FULFILLMENT_CHECK_INTERVAL_SECS: u64 = 1800;
```

**Purpose:** How often to check order fulfillment status  
**Default:** 1800 seconds (30 minutes)  
**Network:** Checks with order fulfillment APIs  
**Change Impact:** Medium - affects tracking freshness

### QUARANTINE_CHECK_INTERVAL_SECS

```rust
pub const QUARANTINE_CHECK_INTERVAL_SECS: u64 = 1800;
```

**Purpose:** How often to clean up quarantined items  
**Default:** 1800 seconds (30 minutes)  
**Action:** Remove items past quarantine period  
**Change Impact:** Low

### SYNC_STARTUP_DELAY_SECS

```rust
pub const SYNC_STARTUP_DELAY_SECS: u64 = 5;
```

**Purpose:** Delay before first sync check (let app unlock)  
**Default:** 5 seconds  
**Note:** Prevents sync during password entry  
**Change Impact:** Low

### SYNC_CHECK_INTERVAL_SECS

```rust
pub const SYNC_CHECK_INTERVAL_SECS: u64 = 120;
```

**Purpose:** How often to check server connectivity  
**Default:** 120 seconds (2 minutes)  
**Lightweight:** Just ping, doesn't sync  
**Change Impact:** Low

### SYNC_FAILURE_PAUSE_SECS

```rust
pub const SYNC_FAILURE_PAUSE_SECS: u64 = 600;
```

**Purpose:** Pause sync after consecutive failures  
**Default:** 600 seconds (10 minutes)  
**Threshold:** 5 consecutive failures  
**Change Impact:** Medium

### STUFFER_SYNC_START_DELAY_SECS

```rust
pub const STUFFER_SYNC_START_DELAY_SECS: u64 = 60;
```

**Purpose:** Delay before first stuffer sync  
**Default:** 60 seconds (1 minute)  
**Reason:** Let database fully load first  
**Change Impact:** Low

### STUFFER_SYNC_INTERVAL_SECS

```rust
pub const STUFFER_SYNC_INTERVAL_SECS: u64 = 300;
```

**Purpose:** How often to sync courier stuffer data  
**Default:** 300 seconds (5 minutes)  
**Network:** Fetches updated tracking data  
**Change Impact:** Medium - affects data freshness

### CATALOG_STARTUP_DELAY_SECS

```rust
pub const CATALOG_STARTUP_DELAY_SECS: u64 = 5;
```

**Purpose:** Delay before auto-fetching catalog on startup  
**Default:** 5 seconds  
**Condition:** Only if local catalog is empty  
**Change Impact:** Low

---

## HTTP Request Timeouts

### HTTP_REQUEST_TIMEOUT_SECS

```rust
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 30;
```

**Purpose:** Default timeout for all HTTP requests  
**Default:** 30 seconds  
**Used By:**

- Catalog sync
- Server API calls
- General HTTP endpoints
  **Min:** 10 seconds (practical minimum)  
  **Max:** 60 seconds (avoid hanging)  
  **Change Impact:** Medium - affects reliability vs speed

### TRACKING_REQUEST_TIMEOUT_SECS

```rust
pub const TRACKING_REQUEST_TIMEOUT_SECS: u64 = 15;
```

**Purpose:** Shorter timeout for tracking APIs  
**Default:** 15 seconds  
**Reason:** Tracking is latency-sensitive  
**Used By:**

- USPS tracking
- UPS tracking
- FedEx tracking
- 17track fallback
  **Min:** 5 seconds  
  **Max:** 30 seconds  
  **Change Impact:** Medium - affects tracking reliability

---

## Cache Configuration

### TRACKING_CACHE_TTL_SECS

```rust
pub const TRACKING_CACHE_TTL_SECS: i64 = 300;
```

**Purpose:** How long to keep tracking results in cache  
**Default:** 300 seconds (5 minutes)  
**Logic:** `timestamp + TTL > now` = valid  
**Cleanup:** Entries removed when > 2x TTL  
**Min:** 60 seconds  
**Max:** 3600 seconds (1 hour)  
**Change Impact:** Low - UX only

### TRACKING_CACHE_MAX_SIZE

```rust
pub const TRACKING_CACHE_MAX_SIZE: usize = 1000;
```

**Purpose:** Maximum number of cached tracking results  
**Default:** 1000 items  
**LRU Eviction:** When cache full, remove oldest  
**Memory Impact:** ~1KB per tracking entry × 1000 = ~1MB  
**Min:** 100 items  
**Max:** 10000 items  
**Change Impact:** Low - memory only

### TRACKING_CACHE_CLEANUP_INTERVAL

```rust
pub const TRACKING_CACHE_CLEANUP_INTERVAL: usize = 100;
```

**Purpose:** How often to clean up expired cache  
**Default:** Every 100 inserts  
**Logic:** `cache.len() % 100 == 0` triggers cleanup  
**Min:** 10 inserts  
**Max:** 1000 inserts  
**Change Impact:** Low - performance only

---

## Rate Limiting

### RATE_LIMIT_STRICT_COUNT

```rust
pub const RATE_LIMIT_STRICT_COUNT: u32 = 5;
```

**Purpose:** Max requests in strict window (sensitive ops)  
**Default:** 5 requests per minute  
**Applied To:**

- Login attempts
- Password changes
- License verification
- Admin operations
  **Change Impact:** High - affects security

### RATE_LIMIT_STRICT_WINDOW_SECS

```rust
pub const RATE_LIMIT_STRICT_WINDOW_SECS: u64 = 60;
```

**Purpose:** Time window for strict rate limit  
**Default:** 60 seconds  
**Related:** `RATE_LIMIT_STRICT_COUNT`  
**Change Impact:** High - affects security

### RATE_LIMIT_MODERATE_COUNT

```rust
pub const RATE_LIMIT_MODERATE_COUNT: u32 = 30;
```

**Purpose:** Max requests in moderate window (normal ops)  
**Default:** 30 requests per minute  
**Applied To:**

- API calls
- Card operations
- Order management
  **Change Impact:** Medium

### RATE_LIMIT_MODERATE_WINDOW_SECS

```rust
pub const RATE_LIMIT_MODERATE_WINDOW_SECS: u64 = 60;
```

**Purpose:** Time window for moderate rate limit  
**Default:** 60 seconds  
**Related:** `RATE_LIMIT_MODERATE_COUNT`  
**Change Impact:** Medium

### RATE_LIMIT_LENIENT_COUNT

```rust
pub const RATE_LIMIT_LENIENT_COUNT: u32 = 100;
```

**Purpose:** Max requests in lenient window (read-only ops)  
**Default:** 100 requests per minute  
**Applied To:**

- List fetching
- Search
- Status checks
  **Change Impact:** Low

### RATE_LIMIT_LENIENT_WINDOW_SECS

```rust
pub const RATE_LIMIT_LENIENT_WINDOW_SECS: u64 = 60;
```

**Purpose:** Time window for lenient rate limit  
**Default:** 60 seconds  
**Related:** `RATE_LIMIT_LENIENT_COUNT`  
**Change Impact:** Low

### RATE_LIMITER_MAX_AGE_MULTIPLIER

```rust
pub const RATE_LIMITER_MAX_AGE_MULTIPLIER: u64 = 2;
```

**Purpose:** How long to keep rate limiter buckets  
**Formula:** `bucket_age_max = window × multiplier`  
**Default:** 2 (bucket lives for 2x window duration)  
**Change Impact:** Low

---

## Quarantine Configuration

### QUARANTINE_PERIOD_DAYS

```rust
pub const QUARANTINE_PERIOD_DAYS: i64 = 14;
```

**Purpose:** Standard quarantine period for suspicious items  
**Default:** 14 days  
**Applied To:**

- Suspicious cards
- Failed transactions
- Declined charges
  **Change Impact:** Medium - affects data retention

### QUARANTINE_PAYMENT_RECEIVED_DAYS

```rust
pub const QUARANTINE_PAYMENT_RECEIVED_DAYS: i64 = 2;
```

**Purpose:** Quarantine period for payment-received items  
**Default:** 2 days  
**Applied To:** Successfully completed transactions  
**Note:** Shorter than suspicious items  
**Change Impact:** Medium - affects data cleanup

---

## Database Configuration

### DB_POOL_SIZE

```rust
pub const DB_POOL_SIZE: u32 = 5;
```

**Purpose:** Number of SQLite connection pool slots  
**Default:** 5 connections  
**Min:** 1 (single connection)  
**Max:** 20 (avoid resource exhaustion)  
**Change Impact:** Medium - affects concurrency

### SQLITE_WAL_AUTO_CHECKPOINT

```rust
pub const SQLITE_WAL_AUTO_CHECKPOINT: i32 = 1000;
```

**Purpose:** Auto-checkpoint when WAL reaches N pages  
**Default:** 1000 pages (~4MB)  
**Min:** 100 pages  
**Max:** 10000 pages  
**Trade-off:** More frequent checkpoints = slower, safer  
**Change Impact:** Low - performance only

---

## Security Configuration

### PBKDF2_ITERATIONS

```rust
pub const PBKDF2_ITERATIONS: u32 = 600_000;
```

**Purpose:** Number of PBKDF2 iterations for password hashing  
**Default:** 600,000 iterations  
**Security Level:** High (OWASP recommendation)  
**Min:** 310,000 (OWASP minimum as of 2023)  
**Max:** 1,000,000 (practical limit)  
**Note:** Higher = slower password verification  
**Change Impact:** High - affects password security

### ENCRYPTION_KEY_ITERATIONS

```rust
pub const ENCRYPTION_KEY_ITERATIONS: u32 = 100_000;
```

**Purpose:** Iterations for encryption key derivation  
**Default:** 100,000  
**Used For:**

- AES key derivation from password
- Field-level encryption
  **Min:** 50,000  
  **Max:** 500,000  
  **Note:** Lower than PBKDF2 for speed  
  **Change Impact:** High - affects encryption time

---

## Data Limits

### MAX_BULK_OPERATION_SIZE

```rust
pub const MAX_BULK_OPERATION_SIZE: usize = 500;
```

**Purpose:** Maximum items in single bulk operation  
**Default:** 500 items  
**Applied To:**

- Bulk delete orders
- Bulk update status
- Batch operations
  **Prevents:** Memory overflow, query explosion  
  **Min:** 10 items  
  **Max:** 5000 items  
  **Change Impact:** Medium - affects API contracts

### MAX_IN_CLAUSE_IDS

```rust
pub const MAX_IN_CLAUSE_IDS: usize = 500;
```

**Purpose:** Max IDs in SQL IN clause  
**Default:** 500 items  
**Reason:** Prevent SQL query from becoming huge  
**Optimization:** Split large requests into batches  
**Min:** 10 items  
**Max:** 10000 items  
**Change Impact:** Medium - affects batch size

### MAX_IMAP_FETCH_SIZE

```rust
pub const MAX_IMAP_FETCH_SIZE: usize = 100;
```

**Purpose:** Maximum emails to fetch in one IMAP operation  
**Default:** 100 emails  
**Trade-off:** Fewer = faster but more network calls  
**Memory:** ~10KB per email × 100 = ~1MB  
**Min:** 10 emails  
**Max:** 500 emails  
**Change Impact:** Low - performance only

### RATE_LIMITER_CLEANUP_INTERVAL

```rust
pub const RATE_LIMITER_CLEANUP_INTERVAL: usize = 100;
```

**Purpose:** How often to clean expired rate limit buckets  
**Default:** Every 100 checks  
**Logic:** Removes buckets older than `max_age`  
**Min:** 10 checks  
**Max:** 1000 checks  
**Change Impact:** Low - memory management

---

## Recommended Configurations

### Conservative (High Security)

```rust
PBKDF2_ITERATIONS: 1_000_000
ENCRYPTION_KEY_ITERATIONS: 200_000
RATE_LIMIT_STRICT_COUNT: 3
QUARANTINE_PERIOD_DAYS: 30
```

### Performance (Optimized)

```rust
DB_POOL_SIZE: 10
TRACKING_CACHE_MAX_SIZE: 5000
MAX_BULK_OPERATION_SIZE: 1000
HTTP_REQUEST_TIMEOUT_SECS: 60
```

### Balanced (Default)

```rust
# All default values as shown above
```

---

## Environment Variables (Future)

Future versions will support environment variable overrides:

```bash
export VAULTBASE_PBKDF2_ITERATIONS=1000000
export VAULTBASE_DB_POOL_SIZE=10
export VAULTBASE_HTTP_TIMEOUT=60
```

---

## Migration Guide

When changing constants:

1. Test locally with new value first
2. Monitor system metrics (CPU, memory, network)
3. Check for timeout errors in logs
4. Gradually roll out to production
5. Update documentation with rationale

---

## Related Documentation

- [CONFIGURATION.md](./CONFIGURATION.md) - Setup guide
- [src-tauri/src/constants.rs](./src-tauri/src/constants.rs) - Source code
- [SPRINT2_DAY3_MAGIC_NUMBERS_REPORT.md](./SPRINT2_DAY3_MAGIC_NUMBERS_REPORT.md) - Recent changes
