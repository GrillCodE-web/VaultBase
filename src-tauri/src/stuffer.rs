// Stuffer API client — integration with the external stuffer panel.
// Docs: manager-work/docs/API_STUFFER.md
//
// The single entry point is `{base_url}?json=<method>&api_key=<key>`. All
// responses are JSON. Errors come back either as an HTTP 4xx/5xx status or as
// an `{"error": "..."}` field in a 200 body. The API key is a secret and is
// never logged nor returned to the frontend.

use serde::{Deserialize, Serialize};

pub const DEFAULT_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";
const TIMEOUT_SECS: u64 = 15;

// ─────────────────────────────────────────
//  Data structures
// ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PackagesCount {
    #[serde(default)]
    pub new: i64,
    #[serde(default)]
    pub shipped: i64,
    #[serde(default)]
    pub sent: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CourierFull {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub address1: String,
    #[serde(default)]
    pub address2: String,
    #[serde(default)]
    pub gender: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub zip: String,
    #[serde(default)]
    pub expired_date: String,
    #[serde(default)]
    pub packages: PackagesCount,
    #[serde(default)]
    pub public_description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CourierAvailable {
    pub id: i64,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub zip: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub packages: PackagesCount,
    #[serde(default)]
    pub public_description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageLabel {
    #[serde(default)]
    pub track: String,
    #[serde(default)]
    pub label_carrier: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageComment {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub comment_text: String,
    #[serde(default)]
    pub sender: String,
    #[serde(default)]
    pub access: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Package {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub labels: Vec<PackageLabel>,
    #[serde(default)]
    pub labels_hash: String,
    #[serde(default)]
    pub tracks: Vec<String>,
    #[serde(default)]
    pub comments: Vec<PackageComment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LabelFile {
    #[serde(default)]
    pub track: String,
    #[serde(default)]
    pub carrier: String,
    #[serde(default)]
    pub file: String, // base64-encoded PDF (may be empty)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrackInput {
    pub track: String,
    pub carrier: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageInput {
    pub courier_id: i64,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub holder_name: Option<String>,
    #[serde(default)]
    pub weight: Option<String>,
    #[serde(default)]
    pub quantity: Option<i64>,
    #[serde(default)]
    pub shop: Option<String>,
    #[serde(default)]
    pub price: Option<f64>,
    #[serde(default)]
    pub delivery_date: Option<String>,
    #[serde(default)]
    pub pay_option: Option<String>,
    #[serde(default)]
    pub pickup: Option<i64>,
    #[serde(default)]
    pub asin: Option<String>,
    #[serde(default)]
    pub upc: Option<String>,
    #[serde(default)]
    pub pickup_address: Option<String>,
    #[serde(default)]
    pub pickup_holder_name: Option<String>,
    #[serde(default)]
    pub tracks: Option<Vec<TrackInput>>,
}

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

/// Build the endpoint URL for a given `json` method. Extra query pairs may be
/// appended (already url-safe keys, values are encoded here).
fn build_url(base_url: &str, method: &str, api_key: &str, extra: &[(&str, String)]) -> String {
    let mut url = format!(
        "{}?json={}&api_key={}",
        base_url.trim_end_matches(char::is_whitespace),
        method,
        urlencoding::encode(api_key)
    );
    for (k, v) in extra {
        url.push_str(&format!("&{}={}", k, urlencoding::encode(v)));
    }
    url
}

/// Turn a ureq result into a parsed JSON value, mapping HTTP + transport errors
/// to friendly strings and surfacing `{"error": ...}` bodies as Err.
fn read_json(resp: Result<ureq::Response, ureq::Error>) -> Result<serde_json::Value, String> {
    let body = match resp {
        Ok(r) => r.into_string().map_err(|e| format!("stuffer_read_error: {}", e))?,
        Err(ureq::Error::Status(code, r)) => {
            // Error bodies are usually JSON like {"error":"..."}.
            let text = r.into_string().unwrap_or_default();
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                    return Err(format!("stuffer_api_error:{}: {}", code, err));
                }
            }
            return Err(format!("stuffer_http_{}", code));
        }
        Err(ureq::Error::Transport(_)) => return Err("stuffer_network_error".to_string()),
    };

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("stuffer_parse_error: {}", e))?;

    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("stuffer_api_error: {}", err));
    }
    Ok(json)
}

fn get(url: &str) -> Result<serde_json::Value, String> {
    read_json(
        ureq::get(url)
            .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
            .call(),
    )
}

fn post_json(url: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    read_json(
        ureq::post(url)
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
            .send_string(&payload.to_string()),
    )
}

fn extract<T: for<'de> Deserialize<'de>>(
    json: serde_json::Value,
    field: &str,
) -> Result<T, String> {
    let val = json
        .get(field)
        .cloned()
        .ok_or_else(|| format!("stuffer_missing_field: {}", field))?;
    serde_json::from_value(val).map_err(|e| format!("stuffer_decode_error: {}", e))
}

// ─────────────────────────────────────────
//  API methods
// ─────────────────────────────────────────

pub fn list_couriers(base_url: &str, api_key: &str) -> Result<Vec<CourierFull>, String> {
    let url = build_url(base_url, "couriers", api_key, &[]);
    extract(get(&url)?, "couriers")
}

pub fn list_available_couriers(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<CourierAvailable>, String> {
    let url = build_url(base_url, "available_couriers", api_key, &[]);
    extract(get(&url)?, "couriers")
}

pub fn add_courier(base_url: &str, api_key: &str, courier_id: i64) -> Result<CourierFull, String> {
    let url = build_url(base_url, "add_courier", api_key, &[]);
    let payload = serde_json::json!({ "courier_id": courier_id });
    extract(post_json(&url, &payload)?, "courier")
}

pub fn list_packages(base_url: &str, api_key: &str) -> Result<Vec<Package>, String> {
    let url = build_url(base_url, "packages", api_key, &[]);
    extract(get(&url)?, "packages")
}

pub fn get_labels(base_url: &str, api_key: &str, package_id: i64) -> Result<Vec<LabelFile>, String> {
    let url = build_url(
        base_url,
        "labels",
        api_key,
        &[("package_id", package_id.to_string())],
    );
    extract(get(&url)?, "labels")
}

pub fn create_package(base_url: &str, api_key: &str, package: &PackageInput) -> Result<i64, String> {
    let url = build_url(base_url, "new_package", api_key, &[]);
    let payload = serde_json::json!({ "package": package });
    let json = post_json(&url, &payload)?;
    json.get("package_id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "stuffer_missing_field: package_id".to_string())
}
