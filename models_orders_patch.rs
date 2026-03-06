// ============================================================
// PATCH: models.rs — Orders + Footprints + Risk Check structs
// ============================================================

use serde::{Deserialize, Serialize};

// ─── Order ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OrderInput {
    pub profile_id: String,
    pub shop_id: i64,
    pub drop_id: i64,
    pub email_pool_id: Option<i64>,
    pub proxy_id: Option<i64>,
    pub order_number: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<OrderItemInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OrderItemInput {
    pub name: String,
    pub sku: String,
    pub qty: i64,
    pub price: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Order {
    pub id: i64,
    pub profile_id: String,
    pub shop_id: i64,
    pub drop_id: i64,
    pub email_pool_id: Option<i64>,
    pub proxy_id: Option<i64>,
    pub order_number: Option<String>,
    pub status: String,
    pub total_amount: Option<f64>,
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,
    pub notes: Option<String>,
    pub items_json: Option<String>,
    // Joined
    pub shop_name: Option<String>,
    pub holder_masked: Option<String>,
    pub last4: Option<String>,
    pub bank_name: Option<String>,
    // Flags
    pub pending_too_long: bool,
    pub card_expiring: bool,
    pub bin_declined_here: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedOrders {
    pub items: Vec<Order>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct OrderFilter {
    pub status: Option<String>,
    pub shop_id: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct StatusMeta {
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,
    pub order_number: Option<String>,
}

// ─── Risk Check ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct RiskCheckResult {
    pub level: String,          // "safe" | "warning" | "high_risk"
    pub score: u32,             // 0..N matches
    pub warnings: Vec<RiskWarning>,
    pub offline: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RiskWarning {
    pub kind: String,           // "email" | "ip" | "drop" | "bin"
    pub severity: String,       // "medium" | "high"
    pub message: String,
    pub related_order_id: Option<i64>,
    pub related_order_status: Option<String>,
}

// ─── Templates ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderTemplate {
    pub id: i64,
    pub name: String,
    pub shop_tag: Option<String>,
    pub items_json: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTemplateInput {
    pub name: String,
    pub shop_tag: Option<String>,
    pub items_json: String,
}
