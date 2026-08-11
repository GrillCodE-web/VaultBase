# VaultBase Configuration Guide

**Version:** 2.11.2  
**Last Updated:** 2026-08-11

## Quick Start

### Default Configuration

VaultBase works out-of-the-box with sensible defaults. All configuration values are in:

```
src-tauri/src/constants.rs
```

No configuration file is required to run the application.

### Changing Constants

To modify any configuration value:

1. **Open** `src-tauri/src/constants.rs`
2. **Find** the constant you want to change (use search)
3. **Update** the value
4. **Rebuild**: `cargo build --release`

Example:

```rust
// BEFORE:
pub const PBKDF2_ITERATIONS: u32 = 600_000;

// AFTER (stronger security):
pub const PBKDF2_ITERATIONS: u32 = 1_000_000;
```

---

## Configuration Categories

### 1. Security Configuration

**Location:** `src-tauri/src/constants.rs` (Security section)

#### Password Hashing Strength

```rust
pub const PBKDF2_ITERATIONS: u32 = 600_000;
```

**Current Setting:** 600,000 iterations  
**Recommended For:**

- **Standard deployments:** 600,000 (default)
- **High-security environments:** 1,000,000
- **Legacy systems:** 310,000 (minimum OWASP)

**Change Impact:** Medium

- More iterations = slower login (~200ms per 100k iterations)
- Affects all password hashing

**Testing:**

```bash
# Test login time before/after
time cargo test --lib database::tests
```

#### Encryption Key Derivation

```rust
pub const ENCRYPTION_KEY_ITERATIONS: u32 = 100_000;
```

**Current Setting:** 100,000 iterations  
**Used For:** Field-level encryption (credit card numbers, IMAP passwords)

**Change Impact:** Low

- Only affects encryption/decryption speed
- Default is balanced between security and performance

### 2. API Configuration

**Location:** `src-tauri/src/constants.rs` (External API URLs section)

#### Sync Server

```rust
pub const SYNC_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
```

**When to Change:** Only if migrating to different server

**Before Changing:**

1. Verify server is accessible: `curl https://sec201-www.otpmanager.pro/health`
2. Check API compatibility
3. Test in staging first

**After Changing:**

1. Verify sync works: Check Sync Status in UI
2. Test footprint upload
3. Monitor logs for errors

#### Stuffer API

```rust
pub const STUFFER_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";
```

**Requires:** `STUFFER_API_KEY` environment variable

**To Configure:**

```bash
export STUFFER_API_KEY="your_api_key_here"
# Then run VaultBase
./target/release/vaultbase
```

#### Tracking APIs

**USPS:**

```rust
pub const TRACKING_USPS_URL: &str = "https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML={}";
```

Requires: `USPS_API_USER_ID`

**UPS:**

```rust
pub const TRACKING_UPS_URL: &str = "https://ontrack.ups.com/api/tracking/{}";
pub const TRACKING_UPS_TOKEN_URL: &str = "https://ontrack.ups.com/security/v1/oauth/token";
```

Requires: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`

**FedEx:**

```rust
pub const TRACKING_FEDEX_URL: &str = "https://apis.fedex.com/track/v2/trackingnumbers";
```

Requires: `FEDEX_API_KEY`

### 3. Performance Tuning

#### Database Connection Pool

```rust
pub const DB_POOL_SIZE: u32 = 5;
```

**When to Change:**

- High concurrency: Increase to 10-20
- Single-user desktop: Keep at 1-5 (default)
- Shared server: Increase to 20

**Monitoring:**

```sql
-- Monitor active connections
.tables  -- List all tables
-- VaultBase uses SQLite, max 1 writer at a time
```

#### HTTP Request Timeouts

```rust
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 30;
pub const TRACKING_REQUEST_TIMEOUT_SECS: u64 = 15;
```

**When to Change:**

- **Slow network:** Increase HTTP timeout to 60
- **Fast local network:** Decrease to 15
- **Tracking is critical:** Increase tracking timeout to 30

**Testing:**

```bash
# Simulate slow network
curl --max-time 30 https://sec201-www.otpmanager.pro/health
```

#### Cache Configuration

```rust
pub const TRACKING_CACHE_TTL_SECS: i64 = 300;        // 5 minutes
pub const TRACKING_CACHE_MAX_SIZE: usize = 1000;     // 1000 items
```

**When to Change:**

- **Frequently updated tracking:** Reduce TTL to 60 seconds
- **Rare tracking updates:** Increase TTL to 600 seconds (10 min)
- **Limited memory:** Reduce max size to 500
- **Large workload:** Increase to 5000

**Memory Impact:**

- 1000 items × ~1KB per entry = ~1MB total
- Acceptable for desktop app

### 4. Background Thread Timing

#### License Verification

```rust
pub const LICENSE_CHECK_INTERVAL_SECS: u64 = 60;
```

**Current:** Every 60 seconds  
**When to Change:**

- Frequent license changes: Keep at 60
- Fixed license: Increase to 300

#### IMAP Synchronization

```rust
pub const IMAP_CHECK_INTERVAL_SECS: u64 = 5;
pub const IMAP_FAILURE_PAUSE_SECS: u64 = 600;
```

**IMAP_CHECK_INTERVAL_SECS:**

- Current: 5 seconds (quick status updates)
- Min: 1 second (more responsive)
- Max: 30 seconds (less CPU usage)

**IMAP_FAILURE_PAUSE_SECS:**

- Current: 600 seconds (10 minute pause after failure)
- Decrease to: 300 for faster recovery
- Increase to: 1800 to reduce spam on server errors

#### Sync Server Checks

```rust
pub const SYNC_STARTUP_DELAY_SECS: u64 = 5;
pub const SYNC_CHECK_INTERVAL_SECS: u64 = 120;
```

**SYNC_STARTUP_DELAY_SECS:**

- Waits for user to unlock
- Keep at 5 seconds (reasonable time)

**SYNC_CHECK_INTERVAL_SECS:**

- Current: 120 seconds (2 minutes)
- Desktop users: Keep at 120
- Server deployments: Decrease to 30

### 5. Rate Limiting

```rust
pub const RATE_LIMIT_STRICT_COUNT: u32 = 5;              // 5/min for login
pub const RATE_LIMIT_MODERATE_COUNT: u32 = 30;           // 30/min for normal ops
pub const RATE_LIMIT_LENIENT_COUNT: u32 = 100;           // 100/min for reads
```

**When to Change:**

- Brute force protection: Reduce to 3, 20, 50
- High-load server: Increase to 10, 60, 200
- API-heavy workload: Adjust based on usage

**Security Impact:**

- Lower limits = better brute force protection
- Higher limits = better throughput
- Default is balanced

### 6. Data Limits

#### Bulk Operation Size

```rust
pub const MAX_BULK_OPERATION_SIZE: usize = 500;
pub const MAX_IN_CLAUSE_IDS: usize = 500;
```

**When to Change:**

- Large batch operations: Increase to 1000
- Memory constraints: Decrease to 100
- Database constraints: Adjust based on performance

**Testing:**

```rust
// Test with maximum size
let mut ids = Vec::new();
for i in 1..=500 {
    ids.push(i as i64);
}
db.bulk_delete_orders(&ids)?;
```

#### IMAP Email Fetch Size

```rust
pub const MAX_IMAP_FETCH_SIZE: usize = 100;
```

**When to Change:**

- Large mailboxes: Increase to 200 (slower but fewer calls)
- Memory limited: Decrease to 50 (more calls but faster response)

---

## Environment Variables

### API Keys (Recommended)

Instead of hardcoding API keys, use environment variables:

```bash
# .env file (not checked into git)
export USPS_API_USER_ID="your_user_id"
export UPS_CLIENT_ID="your_client_id"
export UPS_CLIENT_SECRET="your_secret"
export FEDEX_API_KEY="your_api_key"
export STUFFER_API_KEY="your_stuffer_key"
export TRACKING_API_KEY="your_17track_key"

# Run VaultBase
./target/release/vaultbase
```

### VaultBase-Specific Variables (Future)

Currently not supported, but planned:

```bash
export VAULTBASE_PBKDF2_ITERATIONS=1000000
export VAULTBASE_DB_POOL_SIZE=10
export VAULTBASE_HTTP_TIMEOUT=60
```

---

## Common Scenarios

### Scenario 1: High-Security Environment

**Goal:** Maximum security, accept slower performance

**Changes:**

```rust
pub const PBKDF2_ITERATIONS: u32 = 1_000_000;           // Very slow
pub const ENCRYPTION_KEY_ITERATIONS: u32 = 200_000;     // Slow
pub const RATE_LIMIT_STRICT_COUNT: u32 = 3;             // Very restrictive
pub const QUARANTINE_PERIOD_DAYS: i64 = 30;             // Longer quarantine
```

**Impact:** Login takes ~500ms, encryption slower, stricter rate limits

### Scenario 2: High-Performance Server

**Goal:** Maximum throughput, minimal latency

**Changes:**

```rust
pub const DB_POOL_SIZE: u32 = 20;                       // More connections
pub const MAX_BULK_OPERATION_SIZE: usize = 2000;        // Larger batches
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 60;          // Generous timeout
pub const RATE_LIMIT_MODERATE_COUNT: u32 = 100;         // Fewer restrictions
pub const TRACKING_CACHE_MAX_SIZE: usize = 5000;        // Larger cache
```

**Impact:** Fast operations, more memory usage, higher throughput

### Scenario 3: Slow Network Connection

**Goal:** Reliable operation on poor connectivity

**Changes:**

```rust
pub const HTTP_REQUEST_TIMEOUT_SECS: u64 = 60;          // Double timeout
pub const TRACKING_REQUEST_TIMEOUT_SECS: u64 = 30;      // Longer wait
pub const SYNC_CHECK_INTERVAL_SECS: u64 = 300;          // Less frequent checks
pub const IMAP_CHECK_INTERVAL_SECS: u64 = 10;           // Less frequent
pub const TRACKING_CACHE_TTL_SECS: i64 = 600;           // Cache longer
```

**Impact:** More resilient to timeouts, stale data okay

### Scenario 4: Limited Resources (Raspberry Pi, etc.)

**Goal:** Minimal memory, CPU usage

**Changes:**

```rust
pub const DB_POOL_SIZE: u32 = 1;                        // Single connection
pub const TRACKING_CACHE_MAX_SIZE: usize = 100;         // Tiny cache
pub const MAX_IMAP_FETCH_SIZE: usize = 10;              // Small batches
pub const PBKDF2_ITERATIONS: u32 = 310_000;             // Minimum
```

**Impact:** Slow but usable on limited hardware

---

## Verification

### After Changing Configuration

1. **Syntax Check:**

```bash
cd src-tauri
cargo check
```

2. **Unit Tests:**

```bash
cargo test --lib constants
```

3. **Build:**

```bash
cargo build --release
```

4. **Runtime Test:**

```bash
# Start application
./target/release/vaultbase

# Check logs for errors
# Test core functionality
```

---

## Monitoring

### What to Monitor After Changes

**Performance:**

- Login time (should be <1 second)
- Sync operations (should complete within timeout)
- IMAP connections (should stay connected)

**Security:**

- Failed login attempts (monitor rate limiter)
- Cache hit rate (check effectiveness)
- Quarantine cleanup (verify working)

**Resources:**

- Memory usage (database cache, tracking cache)
- CPU usage (background threads)
- Network connections (connection pool utilization)

---

## Rollback Procedure

If configuration change causes issues:

1. **Identify the problem:**

```bash
# Check logs
tail -f ~/.vaultbase/app.log
```

2. **Revert the constant:**

```bash
# Edit src-tauri/src/constants.rs
# Change back to default value
# Save file
```

3. **Rebuild:**

```bash
cargo build --release
```

4. **Restart:**

```bash
./target/release/vaultbase
```

---

## Advanced: Configuration File Support (Future)

Planned feature (not yet implemented):

```toml
# ~/.vaultbase/config.toml
[security]
pbkdf2_iterations = 600000
encryption_iterations = 100000

[performance]
db_pool_size = 5
http_timeout = 30
tracking_cache_size = 1000

[sync]
check_interval = 120
failure_pause = 600

[api]
sync_server = "https://sec201-www.otpmanager.pro"
stuffer_base = "https://dash.stockhubdeal.com/api/stuffer/"
```

---

## Configuration Validation

To validate your configuration before running:

```rust
// Add to main.rs for validation
fn validate_constants() {
    assert!(PBKDF2_ITERATIONS >= 310_000, "PBKDF2 too weak");
    assert!(RATE_LIMIT_STRICT_COUNT > 0, "Rate limit must be > 0");
    assert!(SYNC_CHECK_INTERVAL_SECS < 3600, "Sync interval too long");
    assert!(HTTP_REQUEST_TIMEOUT_SECS <= 300, "Timeout too high");
}
```

---

## Related Documentation

- [CONSTANTS.md](./CONSTANTS.md) - Detailed constant reference
- [SPRINT2_DAY3_MAGIC_NUMBERS_REPORT.md](./SPRINT2_DAY3_MAGIC_NUMBERS_REPORT.md) - Recent changes
- [src-tauri/src/constants.rs](./src-tauri/src/constants.rs) - Source code
- [README.md](./README.md) - Project overview
