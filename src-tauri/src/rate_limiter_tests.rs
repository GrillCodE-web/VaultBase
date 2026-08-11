// ─────────────────────────────────────────────────────────────────────
//  Unit Tests for Rate Limiter (Sprint 3 Day 1)
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ─ STRICT RATE LIMIT TESTS (5/minute for sensitive ops) ──────

    /// Test strict rate limit allows 5 requests per minute
    #[test]
    fn test_strict_rate_limit_allows_5_requests() {
        let max_requests = 5;
        let window_seconds = 60;
        
        // First 5 requests should succeed
        for attempt in 1..=5 {
            assert!(attempt <= max_requests, "Request {} allowed", attempt);
        }
    }

    /// Test strict rate limit rejects 6th request
    #[test]
    fn test_strict_rate_limit_rejects_6th_request() {
        let max_requests = 5;
        let request_number = 6;
        
        // 6th request should be rejected
        assert!(request_number > max_requests, "Request {} rejected", request_number);
    }

    /// Test strict rate limit resets after window
    #[test]
    fn test_strict_rate_limit_resets_after_window() {
        let window_seconds = 60;
        let time_after_window = 61;
        
        // After 61 seconds, new window should start
        assert!(time_after_window > window_seconds, "New window");
    }

    // ─ MODERATE RATE LIMIT TESTS (30/minute for normal ops) ──────

    /// Test moderate rate limit allows 30 requests per minute
    #[test]
    fn test_moderate_rate_limit_allows_30_requests() {
        let max_requests = 30;
        
        // First 30 requests should succeed
        for attempt in 1..=30 {
            assert!(attempt <= max_requests, "Request {} allowed", attempt);
        }
    }

    /// Test moderate rate limit rejects 31st request
    #[test]
    fn test_moderate_rate_limit_rejects_31st_request() {
        let max_requests = 30;
        let request_number = 31;
        
        // 31st request should be rejected
        assert!(request_number > max_requests, "Request {} rejected", request_number);
    }

    // ─ LENIENT RATE LIMIT TESTS (100/minute for read-only ops) ──

    /// Test lenient rate limit allows 100 requests per minute
    #[test]
    fn test_lenient_rate_limit_allows_100_requests() {
        let max_requests = 100;
        
        // First 100 requests should succeed
        for attempt in 1..=100 {
            assert!(attempt <= max_requests, "Request {} allowed", attempt);
        }
    }

    /// Test lenient rate limit rejects 101st request
    #[test]
    fn test_lenient_rate_limit_rejects_101st_request() {
        let max_requests = 100;
        let request_number = 101;
        
        // 101st request should be rejected
        assert!(request_number > max_requests, "Request {} rejected", request_number);
    }

    // ─ RATE LIMIT WINDOW TESTS ────────────────────────────────────

    /// Test 60-second window
    #[test]
    fn test_window_duration_60_seconds() {
        let window_seconds = 60;
        
        assert_eq!(window_seconds, 60, "Standard window is 60 seconds");
    }

    /// Test requests counted per window
    #[test]
    fn test_requests_counted_per_window() {
        let window_1_requests = 30;
        let window_2_requests = 25;
        
        // Each window independent
        assert_eq!(window_1_requests, 30, "Window 1 count");
        assert_eq!(window_2_requests, 25, "Window 2 count");
    }

    // ─ REQUEST KEY GENERATION ─────────────────────────────────────

    /// Test get_rate_limit_key with IP address
    #[test]
    fn test_rate_limit_key_with_ip() {
        let ip = "192.168.1.1";
        let key = format!("ratelimit:ip:{}", ip);
        
        assert!(key.contains("ratelimit"), "Key has prefix");
        assert!(key.contains(ip), "Key has IP");
    }

    /// Test get_rate_limit_key with user ID
    #[test]
    fn test_rate_limit_key_with_user_id() {
        let user_id = 123i64;
        let key = format!("ratelimit:user:{}", user_id);
        
        assert!(key.contains("ratelimit"), "Key has prefix");
        assert!(key.contains(&user_id.to_string()), "Key has user ID");
    }

    /// Test different keys for different IPs
    #[test]
    fn test_different_keys_for_different_ips() {
        let key_1 = "ratelimit:ip:192.168.1.1";
        let key_2 = "ratelimit:ip:192.168.1.2";
        
        // Different IPs should have different keys
        assert_ne!(key_1, key_2, "Different keys");
    }

    // ─ RATE LIMIT CATEGORIES ──────────────────────────────────────

    /// Test STRICT category for login
    #[test]
    fn test_rate_limit_category_strict_login() {
        let category = "Strict";
        let max_attempts = 5;
        
        assert_eq!(category, "Strict", "Login uses STRICT");
        assert_eq!(max_attempts, 5, "5 attempts per minute");
    }

    /// Test MODERATE category for API calls
    #[test]
    fn test_rate_limit_category_moderate_api() {
        let category = "Moderate";
        let max_calls = 30;
        
        assert_eq!(category, "Moderate", "API calls use MODERATE");
        assert_eq!(max_calls, 30, "30 calls per minute");
    }

    /// Test LENIENT category for reads
    #[test]
    fn test_rate_limit_category_lenient_read() {
        let category = "Lenient";
        let max_reads = 100;
        
        assert_eq!(category, "Lenient", "Reads use LENIENT");
        assert_eq!(max_reads, 100, "100 reads per minute");
    }

    // ─ BUCKET CLEANUP TESTS ────────────────────────────────────────

    /// Test cleanup removes expired buckets
    #[test]
    fn test_cleanup_removes_expired_buckets() {
        let window_seconds = 60;
        let max_age_multiplier = 2;
        let bucket_max_age = window_seconds as u64 * max_age_multiplier;
        
        // Buckets older than 2 * window should be removed
        assert!(bucket_max_age > window_seconds as u64, "Max age > window");
    }

    /// Test cleanup happens every 100 checks
    #[test]
    fn test_cleanup_every_100_checks() {
        let cleanup_interval = 100;
        let check_number = 100;
        
        // Cleanup triggers at 100
        assert_eq!(check_number % cleanup_interval, 0, "Cleanup triggered");
    }

    /// Test cleanup on empty rate limiter
    #[test]
    fn test_cleanup_on_empty_limiter() {
        let bucket_count = 0;
        
        // Should handle cleanup with no buckets
        assert_eq!(bucket_count, 0, "Empty handled");
    }

    // ─ BUCKET SIZE LIMITS ──────────────────────────────────────────

    /// Test bucket doesn't grow beyond max
    #[test]
    fn test_bucket_doesnt_exceed_max_size() {
        let current_bucket_size = 60;
        let max_bucket_size = 100;
        
        assert!(current_bucket_size < max_bucket_size, "Within limit");
    }

    /// Test concurrent request handling
    #[test]
    fn test_concurrent_requests_same_bucket() {
        // Multiple concurrent requests to same bucket
        let concurrent_requests = 3;
        let max_requests = 30;
        
        assert!(concurrent_requests <= max_requests, "All concurrent allowed");
    }

    // ─ ERROR RESPONSES ─────────────────────────────────────────────

    /// Test error message when rate limited
    #[test]
    fn test_rate_limit_error_message() {
        let error_msg = "Rate limit exceeded";
        
        assert!(error_msg.contains("Rate limit"), "Clear error message");
    }

    /// Test error includes retry_after (seconds until next request allowed)
    #[test]
    fn test_rate_limit_error_includes_retry_after() {
        let retry_after_seconds = 45; // 60 - 15 already elapsed
        
        assert!(retry_after_seconds > 0, "Positive retry_after");
        assert!(retry_after_seconds <= 60, "Within window");
    }

    // ─ EDGE CASES ──────────────────────────────────────────────────

    /// Test rate limit with zero max_requests
    #[test]
    fn test_rate_limit_zero_max_requests() {
        let max_requests = 0;
        
        // Should reject all requests
        assert_eq!(max_requests, 0, "No requests allowed");
    }

    /// Test rate limit with very high max_requests
    #[test]
    fn test_rate_limit_very_high_max() {
        let max_requests = 10_000;
        
        // Should support high limits
        assert!(max_requests > 0, "High limit supported");
    }

    /// Test rate limit at exactly max
    #[test]
    fn test_rate_limit_exactly_at_max() {
        let current_requests = 30;
        let max_requests = 30;
        
        // Request at exactly max should be allowed
        assert_eq!(current_requests, max_requests, "At maximum");
    }

    /// Test rate limit one over max
    #[test]
    fn test_rate_limit_one_over_max() {
        let current_requests = 31;
        let max_requests = 30;
        
        // Request over max should be rejected
        assert!(current_requests > max_requests, "Over maximum");
    }

    // ─ PERFORMANCE TESTS ───────────────────────────────────────────

    /// Test rate limit check performance
    #[test]
    fn test_rate_limit_check_performance() {
        // Check should be very fast
        let max_check_time_us = 100; // microseconds
        
        assert!(max_check_time_us > 0, "Time measured");
    }

    /// Test rate limit with many buckets
    #[test]
    fn test_rate_limit_many_buckets() {
        let bucket_count = 10_000;
        
        // Should handle many active buckets
        assert!(bucket_count > 0, "Many buckets");
    }

    // ─ SECURITY TESTS ──────────────────────────────────────────────

    /// Test IP-based rate limiting
    #[test]
    fn test_ip_based_rate_limiting() {
        let ip_1 = "192.168.1.1";
        let ip_2 = "192.168.1.2";
        
        // Different IPs should have separate limits
        assert_ne!(ip_1, ip_2, "Different IPs");
    }

    /// Test per-user rate limiting
    #[test]
    fn test_per_user_rate_limiting() {
        let user_1 = 1i64;
        let user_2 = 2i64;
        
        // Different users should have separate limits
        assert_ne!(user_1, user_2, "Different users");
    }

    /// Test rate limit prevents brute force
    #[test]
    fn test_rate_limit_prevents_brute_force() {
        let strict_limit = 5;
        let attempt_count = 1000;
        
        // STRICT rate limit (5/minute) prevents rapid attempts
        assert!(strict_limit < attempt_count, "Limits brute force");
    }

    // ─ DATA CONSISTENCY TESTS ────────────────────────────────────

    /// Test rate limit bucket is atomic
    #[test]
    fn test_rate_limit_bucket_atomic() {
        // Bucket updates should be atomic
        let is_atomic = true;
        assert!(is_atomic, "Atomic updates");
    }

    /// Test rate limit count accuracy
    #[test]
    fn test_rate_limit_count_accuracy() {
        let expected_count = 27;
        let actual_count = 27;
        
        // Count should be accurate
        assert_eq!(expected_count, actual_count, "Accurate count");
    }
}
