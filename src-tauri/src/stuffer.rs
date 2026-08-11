// Stuffer API client — integration with the external stuffer panel.
// Docs: manager-work/docs/API_STUFFER.md
//
// The single entry point is `{base_url}?json=<method>&api_key=<key>`. All
// responses are JSON. Errors come back either as an HTTP 4xx/5xx status or as
// an `{"error": "..."}` field in a 200 body. The API key is a secret and is
// never logged nor returned to the frontend.

use serde::{Deserialize, Serialize};

// FIX CRITICAL: Use constant instead of hardcoded URL
pub const DEFAULT_BASE_URL: &str = crate::constants::STUFFER_BASE_URL;
const TIMEOUT_SECS: u64 = crate::constants::TRACKING_REQUEST_TIMEOUT_SECS;

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
///
/// SECURITY: the external Stuffer panel authenticates via the `api_key` query
/// parameter (server returns 403 "no api key" otherwise) — it cannot be moved
/// to an Authorization header without breaking the integration. To limit
/// exposure the key is URL-encoded here and the resulting URL is NEVER logged
/// nor returned to the frontend (see `read_json` and the command handlers).
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

const MAX_RETRIES: u32 = 3;
const RETRY_BASE_MS: u64 = 500;

fn is_retryable(err: &str) -> bool {
    err == "stuffer_network_error"
        || err.starts_with("stuffer_http_5")
        || err.starts_with("stuffer_read_error")
}

fn get(url: &str) -> Result<serde_json::Value, String> {
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        match read_json(
            ureq::get(url)
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
                .call(),
        ) {
            Ok(v) => return Ok(v),
            Err(e) if is_retryable(&e) && attempt + 1 < MAX_RETRIES => {
                let delay = RETRY_BASE_MS * 2u64.pow(attempt);
                std::thread::sleep(std::time::Duration::from_millis(delay));
                last_err = e;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err)
}

fn post_json(url: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let body = payload.to_string();
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        match read_json(
            ureq::post(url)
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
                .send_string(&body),
        ) {
            Ok(v) => return Ok(v),
            Err(e) if is_retryable(&e) && attempt + 1 < MAX_RETRIES => {
                let delay = RETRY_BASE_MS * 2u64.pow(attempt);
                std::thread::sleep(std::time::Duration::from_millis(delay));
                last_err = e;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err)
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


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_build_url_basic() {
        let url = build_url("https://example.com/api/", "couriers", "my_key", &[]);
        assert_eq!(url, "https://example.com/api/?json=couriers&api_key=my_key");
    }

    #[test]
    fn test_build_url_extra_params() {
        let url = build_url(
            "https://example.com/api/",
            "labels",
            "key123",
            &[("package_id", "42".to_string())],
        );
        assert!(url.contains("json=labels"));
        assert!(url.contains("api_key=key123"));
        assert!(url.contains("package_id=42"));
    }

    #[test]
    fn test_build_url_encodes_special_chars() {
        let url = build_url("https://ex.com/", "m", "key with spaces&stuff", &[]);
        assert!(!url.contains("key with spaces"));
        assert!(url.contains("key%20with%20spaces%26stuff"));
    }

    #[test]
    fn test_build_url_trims_trailing_whitespace() {
        let url = build_url("https://ex.com/api/  ", "test", "k", &[]);
        assert!(url.starts_with("https://ex.com/api/?"));
    }

    #[test]
    fn test_extract_couriers() {
        let json = json!({
            "success": true,
            "couriers": [
                {
                    "id": 1,
                    "name": "Test Courier",
                    "status": "active",
                    "address1": "123 Main St",
                    "city": "NYC",
                    "country": "US",
                    "state": "NY",
                    "zip": "10001",
                    "packages": {"new": 5, "shipped": 2, "sent": 1}
                }
            ]
        });
        let couriers: Vec<CourierFull> = extract(json, "couriers").unwrap();
        assert_eq!(couriers.len(), 1);
        assert_eq!(couriers[0].id, 1);
        assert_eq!(couriers[0].name, "Test Courier");
        assert_eq!(couriers[0].packages.new, 5);
    }

    #[test]
    fn test_extract_available_couriers() {
        let json = json!({
            "success": true,
            "couriers": [
                {"id": 10, "country": "US", "city": "LA", "state": "CA", "zip": "90001", "status": "available", "packages": {}}
            ]
        });
        let avail: Vec<CourierAvailable> = extract(json, "couriers").unwrap();
        assert_eq!(avail.len(), 1);
        assert_eq!(avail[0].id, 10);
        assert_eq!(avail[0].country, "US");
    }

    #[test]
    fn test_extract_packages() {
        let json = json!({
            "success": true,
            "packages": [
                {
                    "id": 100,
                    "name": "Test Pkg",
                    "status": "new",
                    "labels": [{"track": "1Z999", "label_carrier": "UPS"}],
                    "labels_hash": "abc123",
                    "tracks": ["1Z999"],
                    "comments": [
                        {"id": 1, "date": "2026-08-01", "comment_text": "Hello", "sender": "admin", "access": "public"}
                    ]
                }
            ]
        });
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].id, 100);
        assert_eq!(packages[0].name, "Test Pkg");
        assert_eq!(packages[0].tracks, vec!["1Z999"]);
        assert_eq!(packages[0].labels[0].track, "1Z999");
        assert_eq!(packages[0].comments[0].comment_text, "Hello");
    }

    #[test]
    fn test_extract_labels() {
        let json = json!({
            "labels": [
                {"track": "1Z111", "carrier": "UPS", "file": "dGVzdA=="}
            ]
        });
        let labels: Vec<LabelFile> = extract(json, "labels").unwrap();
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].track, "1Z111");
        assert_eq!(labels[0].file, "dGVzdA==");
    }

    #[test]
    fn test_extract_missing_field() {
        let json = json!({"other": "data"});
        let result: Result<Vec<CourierFull>, String> = extract(json, "couriers");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("stuffer_missing_field"));
    }

    #[test]
    fn test_package_input_serialization() {
        let input = PackageInput {
            courier_id: 5,
            name: Some("Test".to_string()),
            comment: None,
            holder_name: None,
            weight: Some("2.5".to_string()),
            quantity: Some(3),
            shop: Some("Amazon".to_string()),
            price: Some(29.99),
            delivery_date: None,
            pay_option: Some("prepaid".to_string()),
            pickup: None,
            asin: Some("B001TEST".to_string()),
            upc: None,
            pickup_address: None,
            pickup_holder_name: None,
            tracks: Some(vec![TrackInput { track: "1Z999".to_string(), carrier: "UPS".to_string() }]),
        };
        let json = serde_json::to_value(&input).unwrap();
        assert_eq!(json["courier_id"], 5);
        assert_eq!(json["shop"], "Amazon");
        assert_eq!(json["price"], 29.99);
        assert_eq!(json["tracks"][0]["track"], "1Z999");
        assert!(json["comment"].is_null());
    }

    #[test]
    fn test_package_deserialize_with_defaults() {
        let json = json!({"id": 1});
        let pkg: Package = serde_json::from_value(json).unwrap();
        assert_eq!(pkg.id, 1);
        assert_eq!(pkg.name, "");
        assert!(pkg.labels.is_empty());
        assert!(pkg.tracks.is_empty());
        assert!(pkg.comments.is_empty());
    }

    #[test]
    fn test_packages_count_defaults() {
        let json = json!({});
        let pc: PackagesCount = serde_json::from_value(json).unwrap();
        assert_eq!(pc.new, 0);
        assert_eq!(pc.shipped, 0);
        assert_eq!(pc.sent, 0);
    }
}
