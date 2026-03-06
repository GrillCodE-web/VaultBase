// ============================================================
// PATCH: models.rs — Shops + Products structs
// ============================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ShopInput {
    pub name: String,
    pub url: String,
    pub category: String,
    pub notes: String,
    // Risk flags
    pub requires_cvv_match: bool,
    pub blocks_vpn: bool,
    pub phone_must_match: bool,
    pub accepts_amex: bool,
    pub requires_avs: bool,
    pub high_cancel_risk: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Shop {
    pub id: i64,
    pub name: String,
    pub domain: String,
    pub url: String,
    pub category: Option<String>,
    pub notes: Option<String>,
    // Flags
    pub requires_cvv_match: bool,
    pub blocks_vpn: bool,
    pub phone_must_match: bool,
    pub accepts_amex: bool,
    pub requires_avs: bool,
    pub high_cancel_risk: bool,
    // Stats (computed)
    pub total_orders: i64,
    pub delivered: i64,
    pub declined: i64,
    pub success_rate: f64,
    pub avg_order_value: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShopDetail {
    pub shop: Shop,
    pub stats: ShopStats,
    pub recent_orders: Vec<OrderSummary>,
    pub products: Vec<Product>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ShopStats {
    pub total: i64,
    pub pending: i64,
    pub processing: i64,
    pub shipped: i64,
    pub delivered: i64,
    pub declined: i64,
    pub cancelled: i64,
    pub success_rate: f64,
    pub decline_rate: f64,
    pub avg_order_value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedShops {
    pub items: Vec<Shop>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

// ─── Products ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: i64,
    pub shop_id: i64,
    pub asin: Option<String>,
    pub name: String,
    pub amazon_price: Option<f64>,
    pub shop_price: Option<f64>,
    pub margin: Option<f64>, // computed: shop_price - amazon_price
    pub url: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProductInput {
    pub asin: String,
    pub name: String,
    pub amazon_price: Option<f64>,
    pub shop_price: Option<f64>,
    pub url: String,
    pub notes: String,
}

// ─── Smart Suggestions ────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Suggestion {
    pub level: String, // "good" | "warn" | "info"
    pub message: String,
}
