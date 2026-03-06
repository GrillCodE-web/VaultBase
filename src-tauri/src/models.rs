use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────
//  Core domain models
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Card {
    pub id: i64,
    pub bin: Option<String>,
    pub last4: Option<String>,
    pub expiry_date: Option<String>,
    pub holder_name: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub card_level: Option<String>,
    pub status: String,
    pub source: String,
    pub notes: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardDecrypted {
    pub id: i64,
    pub card_number: String,
    pub expiry_date: String,
    pub cvv: String,
    pub holder_name: String,
    pub billing_address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub ip_address: Option<String>,
    pub bin: Option<String>,
    pub last4: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub card_level: Option<String>,
    pub status: String,
    pub source: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub id: String,
    pub card_id: i64,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileDetail {
    pub id: String,
    pub card_id: i64,
    pub notes: Option<String>,
    pub created_at: String,
    pub card: Option<Card>,
    pub drops: Vec<Drop>,
    pub orders: Vec<Order>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Drop {
    pub id: i64,
    pub profile_id: String,
    pub recipient_name: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub phone: Option<String>,
    pub is_primary: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailPoolEntry {
    pub id: i64,
    pub email: String,
    pub label: Option<String>,
    pub imap_account_id: Option<i64>,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Proxy {
    pub id: i64,
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub proxy_type: String,
    pub label: Option<String>,
    pub is_blocked: bool,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Shop {
    pub id: i64,
    pub name: String,
    pub domain: String,
    pub url: Option<String>,
    pub category: Option<String>,
    pub notes: Option<String>,
    pub requires_cvv_match: bool,
    pub blocks_vpn: bool,
    pub phone_must_match: bool,
    pub accepts_amex: bool,
    pub requires_avs: bool,
    pub high_cancel_risk: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopDetail {
    pub shop: Shop,
    pub products: Vec<Product>,
    pub recent_orders: Vec<Order>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: i64,
    pub shop_id: i64,
    pub name: String,
    pub price: f64,
    pub sku: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Order {
    pub id: i64,
    pub profile_id: String,
    pub shop_id: Option<i64>,
    pub drop_id: Option<i64>,
    pub email_pool_id: Option<i64>,
    pub proxy_id: Option<i64>,
    pub order_number: Option<String>,
    pub status: String,
    pub items: Option<String>,
    pub total_amount: Option<f64>,
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderDetail {
    pub order: Order,
    pub profile: Option<Profile>,
    pub shop: Option<Shop>,
    pub drop: Option<Drop>,
    pub email: Option<EmailPoolEntry>,
    pub proxy: Option<Proxy>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapAccount {
    pub id: i64,
    pub label: String,
    pub host: String,
    pub port: i64,
    pub login: String,
    pub poll_interval: i64,
    pub is_active: bool,
    pub last_checked: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapMessage {
    pub id: i64,
    pub account_id: i64,
    pub subject: Option<String>,
    pub from_addr: Option<String>,
    pub body_preview: Option<String>,
    pub received_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Footprint {
    pub id: i64,
    pub shop_id: i64,
    pub shop_domain: Option<String>,
    pub order_id: Option<i64>,
    pub email_hash: Option<String>,
    pub ip_hash: Option<String>,
    pub drop_hash: Option<String>,
    pub bin: Option<String>,
    pub phone_hash: Option<String>,
    pub name_hash: Option<String>,
    pub synced: bool,
    pub user_token: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityLog {
    pub id: i64,
    pub event_type: String,
    pub description: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderTemplate {
    pub id: i64,
    pub name: String,
    pub shop_tag: Option<String>,
    pub items: Option<String>,
    pub created_at: String,
}

// ─────────────────────────────────────────
//  Input / DTO structures
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DropInput {
    pub recipient_name: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyInput {
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub password: Option<String>,
    pub proxy_type: String,
    pub label: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopInput {
    pub name: String,
    pub domain: String,
    pub url: Option<String>,
    pub category: Option<String>,
    pub notes: Option<String>,
    pub requires_cvv_match: bool,
    pub blocks_vpn: bool,
    pub phone_must_match: bool,
    pub accepts_amex: bool,
    pub requires_avs: bool,
    pub high_cancel_risk: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProductInput {
    pub name: String,
    pub price: f64,
    pub sku: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderInput {
    pub profile_id: String,
    pub shop_id: Option<i64>,
    pub drop_id: Option<i64>,
    pub email_pool_id: Option<i64>,
    pub proxy_id: Option<i64>,
    pub order_number: Option<String>,
    pub items: Option<String>,
    pub total_amount: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StatusMeta {
    pub tracking_number: Option<String>,
    pub carrier: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapInput {
    pub label: String,
    pub host: String,
    pub port: i64,
    pub login: String,
    pub password: String,
    pub poll_interval: i64,
}

// ─────────────────────────────────────────
//  Filter structures
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CardFilter {
    pub status: Option<String>,
    pub source: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub country: Option<String>,
    pub search: Option<String>,
    pub bin: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProfileFilter {
    pub search: Option<String>,
    pub has_orders: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OrderFilter {
    pub status: Option<String>,
    pub shop_id: Option<i64>,
    pub profile_id: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LogFilter {
    pub event_type: Option<String>,
    pub entity_type: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

// ─────────────────────────────────────────
//  Result / paginated structures
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub total: u32,
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedCards {
    pub items: Vec<Card>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedProfiles {
    pub items: Vec<Profile>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedEmails {
    pub items: Vec<EmailPoolEntry>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedProxies {
    pub items: Vec<Proxy>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedShops {
    pub items: Vec<Shop>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedOrders {
    pub items: Vec<Order>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedMessages {
    pub items: Vec<ImapMessage>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedLog {
    pub items: Vec<ActivityLog>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

// ─────────────────────────────────────────
//  Analytics / Dashboard
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardStats {
    pub total_cards: u32,
    pub cards_free: u32,
    pub cards_in_use: u32,
    pub cards_dead: u32,
    pub total_profiles: u32,
    pub total_orders: u32,
    pub orders_pending: u32,
    pub orders_success: u32,
    pub orders_failed: u32,
    pub total_shops: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HeatmapCell {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BankStats {
    pub bank_name: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CountryStats {
    pub country: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SourceStats {
    pub source: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExpiringCard {
    pub id: i64,
    pub last4: Option<String>,
    pub expiry_date: String,
    pub holder_name: Option<String>,
    pub days_remaining: i64,
}

// ─────────────────────────────────────────
//  Risk / Suggestions
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RiskCheckResult {
    pub score: u32,
    pub level: String, // low | medium | high | critical
    pub flags: Vec<RiskFlag>,
    pub recommendation: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RiskFlag {
    pub code: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Suggestion {
    pub suggestion_type: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

// ─────────────────────────────────────────
//  BIN lookup
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BinInfo {
    pub bin: String,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub card_level: Option<String>,
    pub country: Option<String>,
    pub brand: Option<String>,
}

// ─────────────────────────────────────────
//  Sync
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncResult {
    pub synced: u32,
    pub failed: u32,
    pub message: String,
}

// ─────────────────────────────────────────
//  License
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseStatus {
    pub is_active: bool,
    pub license_key: Option<String>,
    pub expires_at: Option<String>,
    pub plan: Option<String>,
    pub installation_id: String,
}

// ─────────────────────────────────────────
//  Global Search
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResults {
    pub cards: Vec<Card>,
    pub profiles: Vec<Profile>,
    pub orders: Vec<Order>,
    pub shops: Vec<Shop>,
}

// ─────────────────────────────────────────
//  Card import input
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CardInput {
    pub card_number: String,
    pub expiry_date: Option<String>,
    pub cvv: Option<String>,
    pub holder_name: Option<String>,
    pub billing_address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub ip_address: Option<String>,
    pub source: String,
}

// ─────────────────────────────────────────
//  Mapping preview
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MappingPreview {
    pub preview_rows: Vec<Vec<String>>,
    pub detected_mapping: Vec<String>,
}
