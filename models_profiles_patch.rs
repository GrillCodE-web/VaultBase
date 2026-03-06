// ============================================================
// PATCH: models.rs — Profile / Drop structs
// Add these to the existing models.rs file
// ============================================================

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DropInput {
    pub recipient_name: String,
    pub address: String,
    pub city: String,
    pub state: String,
    pub zip: String,
    pub country: String,
    pub phone: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProfileFilter {
    pub has_drop: Option<bool>,
    pub search: Option<String>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct OrderSummary {
    pub id: i64,
    pub status: String,
    pub shop_name: Option<String>,
    pub total_amount: Option<f64>,
    pub tracking_number: Option<String>,
    pub created_at: String,
}
