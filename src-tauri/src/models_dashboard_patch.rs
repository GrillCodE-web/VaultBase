// ============================================================
// PATCH — append these structs to src-tauri/src/models.rs
// ============================================================

use serde::{Deserialize, Serialize};

// ── Alert ────────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Alert {
    pub level: String,   // "warn" | "error"
    pub message: String,
    pub action: String,  // route hint for frontend: "orders", "cards", "profiles"
    pub count: i64,
}

// ── Dashboard stats ──────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct DashboardStats {
    // Row 1 — absolute counts (period-independent)
    pub total_cc: i64,
    pub free_cc: i64,
    pub in_use_cc: i64,
    pub dead_cc: i64,
    pub total_profiles: i64,
    pub no_drop_profiles: i64,

    // Row 2 — period-scoped order metrics
    pub total_orders: i64,
    pub pending: i64,
    pub shipped: i64,
    pub delivered: i64,
    pub declined: i64,
    pub revenue: f64,
    pub net_profit: f64,

    // Trends vs previous equal-length period (percentage points)
    pub orders_trend: f64,
    pub revenue_trend: f64,
    pub delivered_trend: f64,

    pub alerts: Vec<Alert>,
}

// ── Revenue chart ────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct RevenuePoint {
    pub date: String,    // "HH:00" for today, "YYYY-MM-DD" otherwise
    pub revenue: f64,
    pub profit: f64,
}

// ── Heatmap ──────────────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct HeatmapCell {
    pub bank: String,
    pub shop: String,
    pub total: i64,
    pub shipped: i64,
    pub success_rate: f64, // -1.0 = not enough data (<3 orders)
}

// ── Analytics tables ─────────────────────────────────────────
#[derive(Debug, Serialize, Deserialize)]
pub struct BankStats {
    pub bank_name: String,
    pub total_cards: i64,
    pub free_cards: i64,
    pub dead_cards: i64,
    pub total_orders: i64,
    pub shipped: i64,
    pub declined: i64,
    pub revenue: f64,
    pub success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CountryStats {
    pub country: String,
    pub total_cards: i64,
    pub free_cards: i64,
    pub total_orders: i64,
    pub revenue: f64,
    pub success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SourceStats {
    pub source: String,
    pub total_cards: i64,
    pub free_cards: i64,
    pub dead_cards: i64,
    pub total_orders: i64,
    pub revenue: f64,
    pub success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpiringCard {
    pub id: String,
    pub last4: String,
    pub holder_name: String, // masked
    pub expiry_date: String,
    pub days_left: i64,
    pub has_profile: bool,
    pub profile_id: Option<String>,
}

// ── Sidebar badge counts ─────────────────────────────────────
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SidebarBadges {
    pub pending_orders: i64,
    pub expiring_cards: i64,     // < 30 days
    pub no_drop_profiles: i64,
    pub clean_emails: i64,
    pub unread_imap: i64,        // stub: 0 for now
    pub unsynced_footprints: i64,
}
