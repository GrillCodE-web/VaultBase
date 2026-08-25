#![allow(dead_code)]
use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────
//  Cards (M02)
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
    // FIX P2-DOMAIN: Domain and IP from log parsing
    pub domain: Option<String>,
    pub ip_address: Option<String>,
    // Количество заказов по этой карте (через профиль)
    pub orders_count: u32,
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

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CardFilter {
    // FIX B01: добавлено поле id для get_card(id)
    pub id: Option<i64>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub country: Option<String>,
    pub state: Option<String>,
    pub zip_prefix: Option<String>,
    pub search: Option<String>,
    pub bin: Option<String>,
    pub expiring_soon: Option<bool>,
    // P2-DOMAIN: Filter by domain
    pub domain: Option<String>,
    // P2-QUARANTINE: Filter by quarantine status (cards < 14 days old)
    pub quarantine_status: Option<String>, // "all" | "available" | "quarantined"
    // ROLES: restrict to cards assigned to specific user (None = all cards for admin)
    pub owner_user_id: Option<i64>,
}

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
    // FIX P2-DOMAIN: Fields for log parsing
    pub domain: Option<String>,        // Shop domain from log (e.g., "tristatecamera.com")
    pub acquired_at: Option<String>,   // Timestamp when card was acquired (from log)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedCards {
    pub items: Vec<Card>,
    pub total: u32,
    pub free_total: u32,
    pub page: u32,
    pub per_page: u32,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CardFilterMeta {
    pub countries: Vec<String>,
    pub banks:     Vec<String>,
    pub sources:   Vec<String>,
    // P2-DOMAIN: List of unique domains for filter dropdown
    pub domains:   Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MappingPreview {
    pub preview_rows: Vec<Vec<String>>,
    pub detected_mapping: Vec<String>,
}

// ─────────────────────────────────────────
//  Profiles + Drops (M03)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub id: String,
    pub card_id: i64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Joined from credit_cards
    pub bin: Option<String>,
    pub last4: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub country: Option<String>,
    pub card_status: Option<String>,
    pub holder_masked: Option<String>,
    // Aggregates
    pub drop_count: i64,
    pub order_count: i64,
}

// Internal row used during query_map before masking
pub(crate) struct ProfileRow {
    pub id: String,
    pub card_id: i64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub bin: Option<String>,
    pub last4: Option<String>,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub country: Option<String>,
    pub card_status: Option<String>,
    pub holder_name_enc: Option<String>,
    pub drop_count: i64,
    pub order_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Drop {
    pub id: i64,
    pub profile_id: String,
    pub recipient_name: String,
    pub address: String,
    pub city: String,
    pub state: Option<String>,
    pub zip: String,
    pub country: String,
    pub phone: Option<String>,
    pub is_primary: bool,
    pub created_at: String,
}

// FIX B71: state и phone — Option<String> как в Drop (было String, несоответствие типов)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DropInput {
    pub recipient_name: String,
    pub address: String,
    pub city: String,
    pub state: Option<String>,
    pub zip: String,
    pub country: String,
    pub phone: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProfileFilter {
    pub has_drop: Option<bool>,
    pub search: Option<String>,
    pub card_status: Option<String>,  // "free" | "in_use" | "dead" | "archive"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedProfiles {
    pub items: Vec<Profile>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileDetail {
    pub profile: Profile,
    pub card: CardDecrypted,
    pub drops: Vec<Drop>,
    pub orders: Vec<OrderSummary>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderSummary {
    pub id: i64,
    pub status: String,
    pub shop_name: Option<String>,
    pub total_amount: Option<f64>,
    pub tracking_number: Option<String>,
    pub created_at: String,
}

// ─────────────────────────────────────────
//  Email Pool + Proxies (M04)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopRef {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailPoolEntry {
    pub id: i64,
    pub email: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub is_blocked: bool,
    pub imap_account_id: Option<i64>,
    pub shops_used: Vec<ShopRef>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct EmailFilter {
    pub is_blocked: Option<bool>,
    pub is_used: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedEmails {
    pub items: Vec<EmailPoolEntry>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Proxy {
    pub id: i64,
    pub host: String,
    pub port: i64,
    pub proxy_type: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub is_blocked: bool,
    pub shops_used: Vec<ShopRef>,
    pub created_at: String,
    pub updated_at: String,
    pub last_checked: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProxyInput {
    pub host: String,
    pub port: i64,
    pub proxy_type: String,
    pub username: String,
    pub password: String,
    pub label: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProxyFilter {
    pub is_blocked: Option<bool>,
    pub is_used: Option<bool>,
    pub proxy_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedProxies {
    pub items: Vec<Proxy>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

// ─────────────────────────────────────────
//  uPanel API connections (FEAT-018)
// ─────────────────────────────────────────

/// Сохранённое подключение к uPanel API (PPTP-серверы). Токен наружу не
/// отдаётся — только маска `token_preview`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpanelConnection {
    pub id: i64,
    pub name: String,
    pub base_url: String,
    pub is_active: bool,
    /// Маска токена вида `upl_…4f2a` (сам токен не покидает бэкенд).
    pub token_preview: String,
    #[serde(default)]
    pub last_check_at: Option<String>,
    /// online | offline | error | NULL (не проверялся)
    #[serde(default)]
    pub last_check_status: Option<String>,
    #[serde(default)]
    pub last_check_error: Option<String>,
    #[serde(default)]
    pub last_http_code: Option<u16>,
    #[serde(default)]
    pub last_latency_ms: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpanelConnectionInput {
    pub name: String,
    /// Пустая строка — использовать дефолтный URL uPanel.
    pub base_url: String,
    /// Пустая строка при редактировании = не менять токен.
    pub api_token: String,
    pub is_active: Option<bool>,
}

/// Фильтры /live-запроса (пробрасываются в uPanel как query-параметры).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UpanelLiveFilter {
    pub country_code: Option<String>,
    pub state: Option<String>,
    pub city: Option<String>,
    pub ip: Option<String>,
    pub fraud_min: Option<i64>,
    pub fraud_max: Option<i64>,
    pub mtu_min: Option<i64>,
    pub mtu_max: Option<i64>,
    pub order_by: Option<String>,
    pub order_dir: Option<String>,
}

/// Результат live-проверки соединения (виджет Online/Offline на дашборде).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpanelApiStatus {
    pub connection_id: i64,
    pub name: String,
    pub base_url: String,
    pub online: bool,
    /// online | offline | error | disabled
    pub status: String,
    pub http_code: Option<u16>,
    #[serde(default)]
    pub error: Option<String>,
    pub latency_ms: Option<u64>,
    pub checked_at: String,
}

// ─────────────────────────────────────────
//  Shops + Products (M05)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ShopInput {
    pub name: String,
    pub url: String,
    pub category: String,
    pub notes: String,
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
    pub requires_cvv_match: bool,
    pub blocks_vpn: bool,
    pub phone_must_match: bool,
    pub accepts_amex: bool,
    pub requires_avs: bool,
    pub high_cancel_risk: bool,
    // Computed stats
    pub total_orders: i64,
    pub delivered: i64,
    pub declined: i64,
    pub success_rate: f64,
    pub avg_order_value: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
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

// ─────────────────────────────────────────
//  PHASE 2: Shop Statistics Enhancement
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CarrierStats {
    pub carrier: String,
    pub total_orders: i64,
    pub delivered: i64,
    pub declined: i64,
    pub success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeriodStats {
    pub days: u32,
    pub total: i64,
    pub delivered: i64,
    pub declined: i64,
    pub success_rate: f64,
    pub revenue: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopStatsV2 {
    pub base_stats: ShopStats,
    pub carrier_stats: Vec<CarrierStats>,
    pub period_7d: PeriodStats,
    pub period_30d: PeriodStats,
    pub unique_users_30d: i64,
    pub avg_delivery_days: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShopDetail {
    pub shop: Shop,
    pub stats: ShopStats,
    pub recent_orders: Vec<OrderSummary>,
    pub products: Vec<Product>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedShops {
    pub items: Vec<Shop>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Product {
    pub id: i64,
    pub shop_id: i64,
    pub asin: Option<String>,
    pub name: String,
    pub amazon_price: Option<f64>,
    pub shop_price: Option<f64>,
    pub margin: Option<f64>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Suggestion {
    pub level: String,
    pub message: String,
}

// ─────────────────────────────────────────
//  Orders + Risk (M06)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OrderItemInput {
    pub name: String,
    pub sku: String,
    pub qty: i64,
    pub price: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct OrderInput {
    pub profile_id: String,
    pub shop_id: i64,
    pub drop_id: Option<i64>,
    pub email_pool_id: Option<i64>,
    pub proxy_id: Option<i64>,
    pub order_number: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<OrderItemInput>,
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
    pub card_id: Option<i64>,
    pub shop_name: Option<String>,
    pub holder_masked: Option<String>,
    pub last4: Option<String>,
    pub bank_name: Option<String>,
    // Joined extras
    pub proxy_label: Option<String>,
    pub email_addr: Option<String>,
    // Flags
    pub pending_too_long: bool,
    pub card_expiring: bool,
    pub bin_declined_here: bool,
    pub created_at: String,
    pub updated_at: String,
}

pub type OrderDetail = Order;

/// FEAT-009: связь заказа с посылкой внешней панели (stuffer).
/// Сама посылка живёт на панели; локально — связь + снапшот
/// (courier/track/status) для офлайн-отображения.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OrderPackageLink {
    pub id: i64,
    pub order_id: i64,
    pub provider: String,
    pub package_id: i64,
    pub courier_id: Option<i64>,
    pub track: Option<String>,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// FEAT-009: посылки всех заказов профиля — звено цепочки
/// карта → профиль → заказ → посылка → курьер.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfilePackageLink {
    pub link: OrderPackageLink,
    pub order_number: Option<String>,
    pub order_status: String,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct RiskCheckResult {
    pub level: String,
    pub score: u32,
    pub warnings: Vec<RiskWarning>,
    pub offline: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RiskWarning {
    pub kind: String,
    pub severity: String,
    pub message: String,
    pub related_order_id: Option<i64>,
    pub related_order_status: Option<String>,
}

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

// ─────────────────────────────────────────
//  IMAP (M10)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapFolderInfo {
    pub name: String,
    pub unread: i64,
    pub total: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapAccountStats {
    pub total: i64,
    pub unread: i64,
    pub folders: Vec<ImapFolderInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SmtpConfig {
    pub id: i64,
    pub label: String,
    pub host: String,
    pub port: i64,
    pub login: String,
    pub use_tls: bool,
    pub use_starttls: bool,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SmtpConfigInput {
    pub label: String,
    pub host: String,
    pub port: i64,
    pub login: String,
    pub password: String,
    pub use_tls: bool,
    pub use_starttls: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SentEmail {
    pub id: i64,
    pub smtp_config_id: Option<i64>,
    pub from_email: Option<String>,
    pub to_email: String,
    pub subject: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub sent_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedSentEmails {
    pub items: Vec<SentEmail>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub pages: u32,
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
    // IMAP-HEALTH: здоровье аккаунта (почта общая — разграничение по доменам,
    // см. DomainOwnership). fail_count >= 3 = почта «умерла», нужен ручной вход.
    #[serde(default)]
    pub fail_count: i64,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_ok: Option<String>,
}

impl ImapAccount {
    /// Аккаунт «здоров»: активен и без накопленных ошибок
    pub fn is_healthy(&self) -> bool {
        self.is_active && self.fail_count < 3
    }
}

/// IMAP-ROUTING: маршрут домена. Домен (zoro.com) жёстко закреплён за ОДНИМ
/// IMAP-ящиком — UNIQUE на domain это гарантирует (запрет на повторы).
/// Письма с этого домена собираются только с указанного ящика.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DomainRoute {
    pub domain: String,
    pub imap_account_id: i64,
    pub account_label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImapMessage {
    pub id: i64,
    pub account_id: i64,
    pub message_uid: Option<String>,
    pub subject: Option<String>,
    pub from_email: Option<String>,
    pub to_email: Option<String>,
    pub received_at: Option<String>,
    pub body: Option<String>,
    pub folder: Option<String>,
    pub is_read: bool,
    pub extracted_order_number: Option<String>,
    pub extracted_tracking: Option<String>,
    pub action_taken: Option<String>,
    pub processed: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImapInput {
    pub label: String,
    pub host: String,
    pub port: i64,
    pub login: String,
    pub password: String,
    pub poll_interval: i64,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ImapMsgFilter {
    pub account_id: Option<i64>,
    pub processed: Option<bool>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImapCheckResult {
    pub accounts_checked: u32,
    pub messages_found: u32,
    pub orders_updated: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedMessages {
    pub items: Vec<ImapMessage>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub pages: u32,
}

// ─────────────────────────────────────────
//  Footprints + Activity Log
// ─────────────────────────────────────────

/// Footprint — данные для синхронизации с сервером (PHASE 1: Footprint Sync V2)
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
    /// V2: статус заказа для аналитики
    pub order_status: Option<String>,
    /// V2: хеш installation_id для идентификации установки
    pub installation_id_hash: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LogFilter {
    pub event_type: Option<String>,
    pub entity_type: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedLog {
    pub items: Vec<ActivityLog>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
}

// ─────────────────────────────────────────
//  Advanced Analytics (D2/D3)
// ─────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct BinPerf {
    pub bin: String,
    pub bank_name: Option<String>,
    pub total_orders: u32,
    pub delivered: u32,
    pub declined: u32,
    pub total_revenue: f64,
    pub delivery_rate: f64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ShopWinLoss {
    pub shop_id: i64,
    pub shop_name: String,
    pub total: u32,
    pub delivered: u32,
    pub declined: u32,
    pub delivery_pct: f64,
    pub net_revenue: f64,
    pub expected_value: f64,
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
//  Import result
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub total: u32,
    pub imported: u32,
    pub skipped: u32,
    pub errors: Vec<String>,
}

// ─────────────────────────────────────────
//  Sync
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncResult {
    pub synced: u32,
    pub failed: u32,
    pub message: String,
    pub server_reached: bool,
}

// ─────────────────────────────────────────
//  Sync Groups
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncGroupMember {
    pub installation_id: String,
    pub joined_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncGroupInfo {
    pub group_id: String,
    pub name: String,
    pub card_count: u32,
    pub members: Vec<SyncGroupMember>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncGroupStatus {
    pub in_group: bool,
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    pub connected: bool,
    pub last_sync: Option<String>,
}

// ─────────────────────────────────────────
//  Footprint — Card/Email/Shop analytics
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardShopUsage {
    pub shop_id: i64,
    pub shop_name: String,
    pub shop_domain: String,
    pub order_count: i64,
    pub last_order_date: Option<String>,
    pub last_status: Option<String>,
}

// ─────────────────────────────────────────
//  PHASE 6: Smart Card Protection
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BurnedCard {
    pub card_id: i64,
    pub shop_id: i64,
    pub shop_name: String,
    pub order_count: u32,
    pub last_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardSuggestion {
    pub card_id: i64,
    pub last4: String,
    pub bank_name: Option<String>,
    pub card_type: Option<String>,
    pub country: Option<String>,
    pub match_score: f64, // 0-100
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopUsageBrief {
    pub shop_id: i64,
    pub shop_name: String,
    pub order_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailFootprintStats {
    pub total_orders: i64,
    pub unique_shops: i64,
    pub shops: Vec<ShopUsageBrief>,
    pub is_burned: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopRiskScore {
    pub shop_id: i64,
    pub decline_rate: f64,
    pub unique_emails: i64,
    pub unique_ips: i64,
    pub risk_level: String,  // "low" | "medium" | "high"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardTimelineEvent {
    pub event_type: String,   // "imported" | "status_changed" | "order_created" | "order_status_changed"
    pub description: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub created_at: String,
}

// ─────────────────────────────────────────
//  Global Search
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResults {
    pub cards: Vec<serde_json::Value>,
    pub profiles: Vec<serde_json::Value>,
    pub orders: Vec<serde_json::Value>,
    pub shops: Vec<serde_json::Value>,
    pub emails: Vec<serde_json::Value>,
    pub proxies: Vec<serde_json::Value>,
}

// ─────────────────────────────────────────
//  Analytics / Dashboard (M09)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Alert {
    pub level: String,
    pub message: String,
    pub action: String,
    pub count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_cc: i64,
    pub free_cc: i64,
    pub in_use_cc: i64,
    pub dead_cc: i64,
    pub total_profiles: i64,
    pub no_drop_profiles: i64,
    pub total_orders: i64,
    pub pending: i64,
    pub shipped: i64,
    pub delivered: i64,
    pub declined: i64,
    pub revenue: f64,
    pub net_profit: f64,
    pub orders_trend: Option<f64>,
    pub revenue_trend: Option<f64>,
    pub delivered_trend: Option<f64>,
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RevenuePoint {
    pub date: String,
    pub revenue: f64,
    pub profit: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HeatmapCell {
    pub bank: String,
    pub shop: String,
    pub total: i64,
    pub shipped: i64,
    pub success_rate: f64,
}

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

// P2-DOMAIN: Statistics by domain
#[derive(Debug, Serialize, Deserialize)]
pub struct DomainStats {
    pub domain: String,
    pub total_cards: i64,
    pub free_cards: i64,
    pub dead_cards: i64,
    pub quarantined_cards: i64,  // Cards < 14 days old
    pub total_orders: i64,
    pub revenue: f64,
    pub success_rate: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpiringCard {
    pub id: i64,
    pub last4: Option<String>,
    pub expiry_date: String,
    pub holder_name: Option<String>,
    pub days_left: i64,
    pub has_profile: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidebarBadges {
    pub pending_orders: i64,
    pub expiring_cards: i64,
    pub no_drop_profiles: i64,
    pub clean_emails: i64,
    pub unread_imap: i64,
    pub unsynced_footprints: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileTemplate {
    pub id: i64,
    pub name: String,
    pub country: Option<String>,
    pub state: Option<String>,
    pub city: Option<String>,
    pub phone_prefix: Option<String>,
    pub source: Option<String>,
    pub created_at: Option<String>,
}

// ─────────────────────────────────────────
//  Proxy Intelligence (G1)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyHealthResult {
    pub checked: u32,
    pub online: u32,
    pub offline: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxyUsageStat {
    pub proxy_id: i64,
    pub total_orders: u32,
    pub success_count: u32,
    pub decline_count: u32,
}

// ─────────────────────────────────────────
//  Catalog (M11)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogItem {
    pub id: i64,
    pub name: String,
    pub asin: Option<String>,
    pub price: Option<f64>,
    pub pct: Option<i64>,
    pub category: Option<String>,
    pub notes_en: Option<String>,
    pub stop: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogShop {
    pub id: i64,
    pub domain: String,
    pub category: Option<String>,
    pub score: Option<i64>,
    pub ship_us: bool,
    pub fraud_level: Option<String>,
    pub top_brands: Option<String>,
    pub top_products: Option<String>,
    pub excluded: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogStats {
    pub items: i64,
    pub shops: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogItemInput {
    pub id: Option<i64>,
    pub name: String,
    pub asin: Option<String>,
    pub price: Option<f64>,
    pub pct: Option<i64>,
    pub category: Option<String>,
    pub notes_en: Option<String>,
    pub stop: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogShopInput {
    pub domain: String,
    pub category: Option<String>,
    pub score: Option<i64>,
    pub ship_us: bool,
    pub fraud_level: Option<String>,
    pub top_brands: Option<String>,
    pub top_products: Option<String>,
    pub excluded: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedCatalogItems {
    pub items: Vec<CatalogItem>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub pages: u32,
}

// ─────────────────────────────────────────
//  PHASE 5: Automation Coordination
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutomationConfig {
    pub autolock_timeout: u64,
    pub sync_interval: u64,
    pub imap_poll_interval: u64,
    pub tracking_interval: u64,
    pub proxy_check_interval: u64,
    pub max_sync_failures: u32,
    pub auto_archive_enabled: bool,
    pub burned_card_threshold: u32,
    pub decline_threshold: u32,
    pub eco_mode: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutomationHealth {
    pub is_online: bool,
    pub db_locked: bool,
    pub eco_mode: bool,
    pub pause_all: bool,
    pub sync_last_success: u64,
    pub imap_last_success: u64,
    pub tracking_last_success: u64,
    pub proxy_last_success: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedCatalogShops {
    pub items: Vec<CatalogShop>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub pages: u32,
}

// ─────────────────────────────────────────
//  Users & Roles
// ─────────────────────────────────────────

/// Все доступные права (ключи для user_permissions)
pub mod perms {
    pub const VIEW_STATS_GLOBAL:   &str = "view_stats_global";
    pub const VIEW_CARDS_POOL:     &str = "view_cards_pool";
    pub const TAKE_CARDS:          &str = "take_cards";
    pub const ADD_CARDS_MANUAL:    &str = "add_cards_manual";
    pub const TRANSFER_CARDS:      &str = "transfer_cards";
    pub const VIEW_OWN_CARDS_FULL: &str = "view_own_cards_full";
    pub const CREATE_ORDERS:       &str = "create_orders";
    pub const VIEW_ALL_ORDERS:     &str = "view_all_orders";
    pub const MANAGE_USERS:        &str = "manage_users";
    pub const MANAGE_PERMISSIONS:  &str = "manage_permissions";
    pub const EXPORT_DATA:         &str = "export_data";
    pub const VIEW_REPORTS:        &str = "view_reports";
    pub const MANAGE_SHOPS:        &str = "manage_shops";
    pub const MANAGE_EMAILS:       &str = "manage_emails";
    pub const MANAGE_PROXIES:      &str = "manage_proxies";
    pub const VIEW_COURIERS:       &str = "view_couriers";
    pub const MANAGE_COURIERS:     &str = "manage_couriers";
    pub const VIEW_PACKAGES:       &str = "view_packages";
    pub const CREATE_PACKAGES:     &str = "create_packages";

    /// Права оператора по умолчанию (без явного назначения)
    pub const OPERATOR_DEFAULTS: &[&str] = &[
        VIEW_CARDS_POOL,
        TAKE_CARDS,
        ADD_CARDS_MANUAL,
        VIEW_OWN_CARDS_FULL,
        CREATE_ORDERS,
        VIEW_COURIERS,
        VIEW_PACKAGES,
        CREATE_PACKAGES,
        // Настройка Stuffer (API-ключ и base_url) — это подключение СВОЕЙ
        // интеграции, а не привилегия над чужими данными. Без этого права
        // раздел Stuffer в настройках не показывался вообще, а выдать право
        // было неоткуда: роль приходит из лицензии, и оператор оставался без
        // возможности ввести ключ — интеграция была недоступна навсегда.
        MANAGE_COURIERS,
    ];

    /// Все возможные права (для UI редактора)
    pub const ALL: &[(&str, &str)] = &[
        (VIEW_STATS_GLOBAL,   "Общая статистика"),
        (VIEW_CARDS_POOL,     "Просмотр пула карт"),
        (TAKE_CARDS,          "Брать карты из пула"),
        (ADD_CARDS_MANUAL,    "Добавлять карты вручную"),
        (TRANSFER_CARDS,      "Передавать карты"),
        (VIEW_OWN_CARDS_FULL, "Полные данные своих карт"),
        (CREATE_ORDERS,       "Создавать заказы"),
        (VIEW_ALL_ORDERS,     "Видеть заказы всех"),
        (MANAGE_USERS,        "Управление пользователями"),
        (MANAGE_PERMISSIONS,  "Управление правами"),
        (EXPORT_DATA,         "Экспорт данных"),
        (VIEW_REPORTS,        "Аналитика и отчёты"),
        (MANAGE_SHOPS,        "Управление магазинами"),
        (MANAGE_EMAILS,       "Управление email-пулом"),
        (MANAGE_PROXIES,      "Управление прокси"),
        (VIEW_COURIERS,       "Просмотр курьеров (Stuffer)"),
        (MANAGE_COURIERS,     "Добавление курьеров (Stuffer)"),
        (VIEW_PACKAGES,       "Просмотр посылок (Stuffer)"),
        (CREATE_PACKAGES,     "Создание посылок (Stuffer)"),
    ];
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,     // "admin" | "operator"
    pub is_active: bool,
    pub created_at: String,
    pub last_seen: Option<String>,
    pub created_by: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserSession {
    pub id: i64,
    pub user_id: i64,
    pub token: String,
    pub ip_address: Option<String>,
    pub device_info: Option<String>,
    pub created_at: String,
    pub last_seen: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPermissionEntry {
    pub permission_key: String,
    pub granted: bool,
    pub is_default: bool, // true = из дефолтов роли, false = явно задано
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserWithPermissions {
    pub user: User,
    pub permissions: Vec<UserPermissionEntry>,
    pub sessions: Vec<UserSession>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserActivity {
    pub id: i64,
    pub user_id: i64,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub action_type: String,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub details: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserStats {
    pub user_id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub cards_taken: i64,
    pub orders_created: i64,
    pub orders_delivered: i64,
    pub orders_declined: i64,
    pub total_spent: f64,
    pub tracking_count: i64,
    pub cards_added_manual: i64,
    pub last_seen: Option<String>,
    pub active_sessions: i64,
    pub last_ip: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPeriodStats {
    pub period: String,      // "today" | "7d" | "30d"
    pub orders_created: i64,
    pub orders_delivered: i64,
    pub total_spent: f64,
    pub cards_taken: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdminOverview {
    pub users: Vec<UserStats>,
    pub today_orders: i64,
    pub today_delivered: i64,
    pub today_spent: f64,
    pub total_cards_in_pool: i64,
    pub total_cards_assigned: i64,
    pub online_sessions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardAssignment {
    pub card_id: i64,
    pub user_id: i64,
    pub username: String,
    pub assigned_at: String,
    pub assigned_by: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
    pub ip_address: Option<String>,
    pub device_info: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginResult {
    pub token: String,
    pub user_id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub role: String,
    pub permissions: Vec<String>,
    /// FEAT-016: срок действия сессии (UTC, "YYYY-MM-DD HH:MM:SS").
    /// Клиент по нему решает, когда делать sliding-refresh.
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateUserInput {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
    pub role: String,
}

/// Активный пользователь в памяти (хранится в AppState)
#[derive(Debug, Clone)]
pub struct ActiveUser {
    pub user_id: i64,
    pub username: String,
    pub role: String,
    pub permissions: Vec<String>,
    pub token: String,
    pub ip_address: Option<String>,
}

impl ActiveUser {
    pub fn is_admin(&self) -> bool { self.role == "admin" }
    pub fn has_perm(&self, key: &str) -> bool {
        self.is_admin() || self.permissions.iter().any(|p| p == key)
    }
}

// ─────────────────────────────────────────
//  Sync Push Models
// ─────────────────────────────────────────

/// FIX P1-RETRY-02: Модель для отправки обновлений карт на sync сервер
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardSyncUpdate {
    pub card_hash: String,
    pub status: String,
    pub notes: Option<String>,
    pub encrypted_data: Option<String>,
}

// ─────────────────────────────────────────
//  Tracking (PHASE 3: Direct Carrier API)
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrackingStatus {
    pub status: String,        // delivered, in_transit, exception, etc.
    pub status_detail: String, // human readable
    pub carrier: String,
    pub tracking_number: String,
    pub estimated_delivery: Option<String>,
    pub events: Vec<TrackingEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrackingEvent {
    pub timestamp: String,
    pub status: String,
    pub location: Option<String>,
    pub description: String,
}
