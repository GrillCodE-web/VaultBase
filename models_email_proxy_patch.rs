// ============================================================
// PATCH: models.rs — Email Pool + Proxy structs
// ============================================================

use serde::{Deserialize, Serialize};

// Shared reference type used in EmailPoolEntry.shops_used / Proxy.shops_used
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShopRef {
    pub id: i64,
    pub name: String,
}

// ─── Email Pool ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailPoolEntry {
    pub id: i64,
    pub email: String,           // decrypted for display
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedEmails {
    pub items: Vec<EmailPoolEntry>,
    pub total: u32,
    pub page: u32,
    pub per_page: u32,
    pub total_pages: u32,
}

// ─── Proxies ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Proxy {
    pub id: i64,
    pub host: String,
    pub port: i64,
    pub proxy_type: String,       // "http" | "socks5" | "socks4"
    pub username: Option<String>,
    pub password: Option<String>, // decrypted for display
    pub label: Option<String>,
    pub notes: Option<String>,
    pub is_blocked: bool,
    pub shops_used: Vec<ShopRef>,
    pub created_at: String,
    pub updated_at: String,
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
