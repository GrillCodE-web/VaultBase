// FIX TC-H03: Simple rate limiting for Tauri commands
// Uses a simple token bucket algorithm with thread-safe storage

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use once_cell::sync::Lazy;

/// Simple rate limiter using token bucket algorithm
struct SimpleRateLimiter {
    /// Max requests allowed in the window
    max_requests: u32,
    /// Window duration
    window: Duration,
    /// Per-key state: (request_count, window_start)
    buckets: Mutex<HashMap<u64, (u32, Instant)>>,
}

impl SimpleRateLimiter {
    fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            max_requests,
            window: Duration::from_secs(window_secs),
            buckets: Mutex::new(HashMap::new()),
        }
    }

    fn check(&self, key: u64) -> Result<(), String> {
        let mut buckets = self.buckets.lock().map_err(|e| format!("lock poisoned: {}", e))?;

        let now = Instant::now();
        let entry = buckets.entry(key).or_insert((0, now));

        // Reset if window has passed
        if now.duration_since(entry.1) > self.window {
            entry.0 = 0;
            entry.1 = now;
        }

        // Check if limit exceeded
        if entry.0 >= self.max_requests {
            return Err("rate_limit_exceeded: Too many requests. Please wait a moment.".to_string());
        }

        // Increment counter
        entry.0 += 1;
        Ok(())
    }
}

/// Rate limiter categories
pub enum RateLimitCategory {
    /// 5 requests per minute (sensitive operations)
    Strict,
    /// 30 requests per minute (normal operations)
    Moderate,
    /// 100 requests per minute (read-only operations)
    Lenient,
}

impl RateLimitCategory {
    fn limiter(&self) -> &'static SimpleRateLimiter {
        match self {
            RateLimitCategory::Strict => &STRICT_LIMITER,
            RateLimitCategory::Moderate => &MODERATE_LIMITER,
            RateLimitCategory::Lenient => &LENIENT_LIMITER,
        }
    }
}

// Global limiters
static STRICT_LIMITER: Lazy<SimpleRateLimiter> =
    Lazy::new(|| SimpleRateLimiter::new(5, 60));

static MODERATE_LIMITER: Lazy<SimpleRateLimiter> =
    Lazy::new(|| SimpleRateLimiter::new(30, 60));

static LENIENT_LIMITER: Lazy<SimpleRateLimiter> =
    Lazy::new(|| SimpleRateLimiter::new(100, 60));

/// Check rate limit for a command
/// Returns Ok(()) if allowed, Err if exceeded
pub fn check_rate_limit(category: RateLimitCategory, key: u64) -> Result<(), String> {
    category.limiter().check(key)
}

/// Get a unique key for rate limiting based on command
pub fn get_rate_limit_key(command: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;

    // Get installation ID for per-installation rate limiting
    let installation_id = std::env::var("CC_MANAGER_INSTALLATION_ID")
        .unwrap_or_else(|_| "unknown".to_string());

    let mut hasher = DefaultHasher::new();
    installation_id.hash(&mut hasher);
    command.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_blocks_after_limit() {
        let limiter = SimpleRateLimiter::new(3, 60);

        // First 3 requests should succeed
        assert!(limiter.check(1).is_ok());
        assert!(limiter.check(1).is_ok());
        assert!(limiter.check(1).is_ok());

        // 4th request should fail
        assert!(limiter.check(1).is_err());

        // Different key should succeed
        assert!(limiter.check(2).is_ok());
    }

    #[test]
    fn test_get_rate_limit_key() {
        let key1 = get_rate_limit_key("test_command");
        let key2 = get_rate_limit_key("test_command");
        let key3 = get_rate_limit_key("other_command");

        assert_eq!(key1, key2);
        assert_ne!(key1, key3);
    }
}
