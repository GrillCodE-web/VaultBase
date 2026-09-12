// SWAT provider — клиент панели StockHub (dash.stockhubdeal.com).
// Docs: docs/archive/API_STUFFER.md (актуальная схема — апдейт панели
// 2026-09: методы package/add_track, депозитные поля packages,
// labels[].carrier вместо label_carrier, tracks — объекты {track, carrier}).
//
// The single entry point is `{base_url}?json=<method>&api_key=<key>`. All
// responses are JSON. Errors come back either as an HTTP 4xx/5xx status or as
// an `{"error": "..."}` field in a 200 body. The API key is a secret and is
// never logged nor returned to the frontend.

use serde::{Deserialize, Serialize};

use super::{Provider, ProviderCapabilities};

// FIX CRITICAL: Use constant instead of hardcoded URL
pub const DEFAULT_BASE_URL: &str = crate::constants::STUFFER_BASE_URL;
const TIMEOUT_SECS: u64 = crate::constants::TRACKING_REQUEST_TIMEOUT_SECS;

/// Допустимые pay_option панели SWAT (docs/archive/API_STUFFER.md, «new_package»).
/// Панель жёстко валидирует значения: произвольные -> 400 Invalid pay_option.
pub const PAY_OPTIONS: &[&str] = &["%", "forwarding", "test", "50/50_admin", "50/50_stuffer", "sale"];

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

/// Лейбл внутри объекта `packages` (не путать с файлами метода `labels`).
/// Апдейт панели 2026-09 переименовал `label_carrier` в `carrier` — принимаем
/// оба ключа (alias), наружу отдаём только `carrier`. Плейсхолдерные треки
/// приходят как `[HIDDEN TRACK]` (сдача без удалённого лейбла).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageLabel {
    #[serde(default)]
    pub track: String,
    #[serde(default, alias = "label_carrier")]
    pub carrier: String,
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

/// Десериализация `tracks`: панель меняла формат — старый `["1Z...", "N/A"]`
/// (строки), актуальный `[{"track": "1Z...", "carrier": "UPS"}]` (объекты,
/// docs/archive/API_STUFFER.md). Принимаем оба; у строк перевозчик пустой.
fn de_tracks<'de, D>(deserializer: D) -> Result<Vec<TrackInput>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RawTrack {
        Text(String),
        Obj {
            #[serde(default)]
            track: String,
            #[serde(default)]
            carrier: String,
        },
    }

    let raw = Option::<Vec<Option<RawTrack>>>::deserialize(deserializer)?;
    Ok(raw
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .map(|t| match t {
            RawTrack::Text(track) => TrackInput { track, carrier: String::new() },
            RawTrack::Obj { track, carrier } => TrackInput { track, carrier },
        })
        .collect())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Package {
    pub id: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    // Поля панели (docs/archive/API_STUFFER.md, «packages»/«package»).
    #[serde(default)]
    pub price: f64,
    // Депозитные поля (апдейт панели 2026-09). is_deposited=false →
    // deposit_amount/deposited_date приходят null.
    #[serde(default)]
    pub percent: f64,
    #[serde(default)]
    pub is_deposited: bool,
    #[serde(default)]
    pub deposit_amount: Option<f64>,
    #[serde(default)]
    pub deposited_date: Option<String>,
    // Лейблы и их хеш — снова часть актуальной схемы «packages»
    // (skip_serializing_if — наружу уходят только непустые).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<PackageLabel>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub labels_hash: String,
    /// Трек-номера с перевозчиками ({track, carrier}); у плейсхолдера —
    /// track "N/A". Старый строковый формат тоже принимается (de_tracks).
    #[serde(default, deserialize_with = "de_tracks")]
    pub tracks: Vec<TrackInput>,
    #[serde(default)]
    pub comments: Vec<PackageComment>,
    // Поля прошлой схемы «packages» (форма создания): апдейт 2026-09 их не
    // документирует, но декодируем с дефолтами на случай смешанных панелей.
    // courier_id — Option: отсутствие поля не должно затирать снапшот связи
    // заказ↔посылка (COALESCE в refresh_package_snapshots).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub courier_id: Option<i64>,
    #[serde(default)]
    pub holder_name: String,
    #[serde(default)]
    pub weight: String,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub shop: String,
    #[serde(default)]
    pub delivery_date: String,
    #[serde(default)]
    pub pay_option: String,
    #[serde(default)]
    pub pickup: i64,
    #[serde(default)]
    pub asin: String,
    #[serde(default)]
    pub upc: String,
    #[serde(default)]
    pub created_date: String,
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

/// Трек-номер с перевозчиком. Используется в обе стороны: элемент
/// `PackageInput.tracks` (new_package) и нормализованный элемент
/// `Package.tracks` / ответ `add_track` (панель нормализует: трек — trim +
/// upper, carrier — lower).
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct TrackInput {
    #[serde(default)]
    pub track: String,
    #[serde(default)]
    pub carrier: String,
}

/// Ответ метода `add_track`: только что добавленный трек и полный список
/// треков пакета после добавления (docs/archive/API_STUFFER.md).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AddTrackResult {
    #[serde(default)]
    pub track: TrackInput,
    #[serde(default)]
    pub tracks: Vec<TrackInput>,
}

/// Тело `new_package`: незаполненные Optional-поля НЕ сериализуем вовсе
/// (а не null) — так панель применяет свои дефолты из
/// docs/archive/API_STUFFER.md (pay_option "%", price 1, вес "0",
/// трек-плейсхолдер "N/A"/"unknown"). Раньше null полей приводил к жёсткой
/// валидации после смены схемы на панели. Треки проходят ту же серверную
/// нормализацию/валидацию, что и add_track.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PackageInput {
    pub courier_id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shop: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pay_option: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pickup: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pickup_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pickup_holder_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracks: Option<Vec<TrackInput>>,
}

// ─────────────────────────────────────────
//  SWAT provider
// ─────────────────────────────────────────

pub struct SwatProvider {
    base_url: String,
    api_key: String,
}

impl SwatProvider {
    pub fn new(base_url: &str, api_key: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
            api_key: api_key.to_string(),
        }
    }
}

impl Provider for SwatProvider {
    fn id(&self) -> &'static str {
        "swat"
    }

    fn display_name(&self) -> &'static str {
        "SWAT"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            pay_options: PAY_OPTIONS.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn list_couriers(&self) -> Result<Vec<CourierFull>, String> {
        list_couriers(&self.base_url, &self.api_key)
    }

    fn list_available_couriers(&self) -> Result<Vec<CourierAvailable>, String> {
        list_available_couriers(&self.base_url, &self.api_key)
    }

    fn add_courier(&self, courier_id: i64) -> Result<CourierFull, String> {
        add_courier(&self.base_url, &self.api_key, courier_id)
    }

    fn list_packages(&self) -> Result<Vec<Package>, String> {
        list_packages(&self.base_url, &self.api_key)
    }

    fn get_package(&self, package_id: i64) -> Result<Package, String> {
        get_package(&self.base_url, &self.api_key, package_id)
    }

    fn get_labels(&self, package_id: i64) -> Result<Vec<LabelFile>, String> {
        get_labels(&self.base_url, &self.api_key, package_id)
    }

    fn create_package(&self, package: &PackageInput) -> Result<i64, String> {
        create_package(&self.base_url, &self.api_key, package)
    }

    fn add_track(
        &self,
        package_id: i64,
        track: &str,
        carrier: &str,
    ) -> Result<AddTrackResult, String> {
        add_track(&self.base_url, &self.api_key, package_id, track, carrier)
    }
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

/// Пакет по ID (метод `package`, апдейт панели 2026-09). В отличие от
/// `packages` (до 500 свежих записей) находит и архивные пакеты стаффера.
pub fn get_package(base_url: &str, api_key: &str, package_id: i64) -> Result<Package, String> {
    let url = build_url(
        base_url,
        "package",
        api_key,
        &[("package_id", package_id.to_string())],
    );
    extract(get(&url)?, "package")
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

/// Добавить трек-номер к существующему пакету (метод `add_track`, апдейт
/// панели 2026-09). Плейсхолдер "N/A" при первом реальном треке удаляется
/// панелью; повторные треки дополняют список. Валидация длины/формата —
/// серверная (400 Invalid track / Invalid carrier / Invalid track format
/// for carrier), мы только прокидываем ошибку наверх.
pub fn add_track(
    base_url: &str,
    api_key: &str,
    package_id: i64,
    track: &str,
    carrier: &str,
) -> Result<AddTrackResult, String> {
    let url = build_url(base_url, "add_track", api_key, &[]);
    let payload = serde_json::json!({
        "package_id": package_id,
        "track": track,
        "carrier": carrier,
    });
    let json = post_json(&url, &payload)?;
    Ok(AddTrackResult {
        track: extract(json.clone(), "track")?,
        tracks: extract(json, "tracks")?,
    })
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
                    "labels": [{"track": "1Z999", "carrier": "UPS"}],
                    "labels_hash": "abc123",
                    "tracks": [{"track": "1Z999", "carrier": "UPS"}],
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
        assert_eq!(
            packages[0].tracks,
            vec![TrackInput { track: "1Z999".into(), carrier: "UPS".into() }]
        );
        assert_eq!(packages[0].labels[0].track, "1Z999");
        assert_eq!(packages[0].labels[0].carrier, "UPS");
        assert_eq!(packages[0].labels_hash, "abc123");
        assert_eq!(packages[0].comments[0].comment_text, "Hello");
    }

    /// Переходный период: старый ключ `label_carrier` принимаем как alias
    /// (апдейт панели переименовал его в `carrier`).
    #[test]
    fn test_package_label_carrier_alias() {
        let json = json!({
            "packages": [
                {"id": 1, "labels": [{"track": "1ZOLD", "label_carrier": "UPS"}]},
                {"id": 2, "labels": [{"track": "1ZNEW", "carrier": "fedex"}]}
            ]
        });
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        assert_eq!(packages[0].labels[0].carrier, "UPS");
        assert_eq!(packages[1].labels[0].carrier, "fedex");
    }

    /// Ответ панели по актуальной docs/archive/API_STUFFER.md (апдейт
    /// 2026-09): депозитные поля, labels с carrier, tracks — объекты
    /// {"track","carrier"}. Второй пакет — недепонированный: deposit_amount и
    /// deposited_date приходят null.
    #[test]
    fn test_extract_packages_current_schema() {
        let json = json!({
            "success": true,
            "packages": [
                {
                    "id": 11517,
                    "name": "Apple iPhone 13 Pro, QTY:2",
                    "status": "checked",
                    "price": 999.99,
                    "percent": 15,
                    "is_deposited": true,
                    "deposit_amount": 210.00,
                    "deposited_date": "2026-08-10 18:49:07",
                    "labels": [
                        {"track": "1Z999AA10123456784", "carrier": "UPS"},
                        {"track": "[HIDDEN TRACK]", "carrier": "FedEx"}
                    ],
                    "labels_hash": "abc123def456",
                    "tracks": [
                        {"track": "1Z999AA10123456784", "carrier": "ups"},
                        {"track": "6129999888777666555", "carrier": "fedex"}
                    ],
                    "comments": [
                        {"id": 1, "date": "11.08.2026 14:32", "comment_text": "Ок, принял", "sender": "admin", "access": "admin,support"}
                    ]
                },
                {
                    "id": 10809,
                    "name": "Apple iPad Pro, QTY:4",
                    "status": "received",
                    "price": 0,
                    "percent": 10,
                    "is_deposited": false,
                    "deposit_amount": null,
                    "deposited_date": null,
                    "labels": [],
                    "labels_hash": "",
                    "tracks": [{"track": "N/A", "carrier": "unknown"}],
                    "comments": []
                }
            ]
        });
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        assert_eq!(packages.len(), 2);
        let p = &packages[0];
        assert_eq!(p.id, 11517);
        assert_eq!(p.price, 999.99);
        assert_eq!(p.percent, 15.0);
        assert!(p.is_deposited);
        assert_eq!(p.deposit_amount, Some(210.0));
        assert_eq!(p.deposited_date.as_deref(), Some("2026-08-10 18:49:07"));
        assert_eq!(p.labels.len(), 2);
        assert_eq!(p.labels[1].track, "[HIDDEN TRACK]");
        assert_eq!(p.labels[1].carrier, "FedEx");
        assert_eq!(p.labels_hash, "abc123def456");
        assert_eq!(
            p.tracks,
            vec![
                TrackInput { track: "1Z999AA10123456784".into(), carrier: "ups".into() },
                TrackInput { track: "6129999888777666555".into(), carrier: "fedex".into() },
            ]
        );
        assert_eq!(p.comments[0].access, "admin,support");

        let p2 = &packages[1];
        assert!(!p2.is_deposited);
        assert_eq!(p2.deposit_amount, None);
        assert_eq!(p2.deposited_date, None);
        // Плейсхолдер панели — "N/A"/"unknown".
        assert_eq!(
            p2.tracks,
            vec![TrackInput { track: "N/A".into(), carrier: "unknown".into() }]
        );
        // Поля прошлой схемы не пришли — дефолты без ошибки декода.
        assert_eq!(p2.courier_id, None);
        assert_eq!(p2.shop, "");
        assert_eq!(p2.created_date, "");
    }

    /// Поля прошлой схемы «packages» (courier_id, holder_name, ...) больше не
    /// документированы, но если панель их отдаёт — декодируются как раньше.
    #[test]
    fn test_extract_packages_legacy_fields_still_decode() {
        let json = json!({
            "success": true,
            "packages": [
                {
                    "id": 11517,
                    "courier_id": 982,
                    "name": "Apple iPhone 13 Pro, QTY:2",
                    "status": "checked",
                    "holder_name": "Petr Vasichkin",
                    "weight": "1.5",
                    "quantity": 2,
                    "shop": "amazon",
                    "price": 999.99,
                    "delivery_date": "2026-08-10",
                    "pay_option": "%",
                    "pickup": 0,
                    "asin": "B09G9HD6PD",
                    "upc": "195949123456",
                    "created_date": "2026-08-11 14:32:15",
                    "tracks": [
                        {"track": "1Z999AA10123456784", "carrier": "UPS"}
                    ],
                    "comments": []
                }
            ]
        });
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        let p = &packages[0];
        assert_eq!(p.courier_id, Some(982));
        assert_eq!(p.holder_name, "Petr Vasichkin");
        assert_eq!(p.weight, "1.5");
        assert_eq!(p.quantity, 2);
        assert_eq!(p.shop, "amazon");
        assert_eq!(p.delivery_date, "2026-08-10");
        assert_eq!(p.pay_option, "%");
        assert_eq!(p.pickup, 0);
        assert_eq!(p.asin, "B09G9HD6PD");
        assert_eq!(p.upc, "195949123456");
        assert_eq!(p.created_date, "2026-08-11 14:32:15");
        assert_eq!(
            p.tracks,
            vec![TrackInput { track: "1Z999AA10123456784".into(), carrier: "UPS".into() }]
        );
        // Депозитные поля не пришли — дефолты.
        assert!(!p.is_deposited);
        assert_eq!(p.percent, 0.0);
        assert_eq!(p.deposit_amount, None);
    }

    /// Смесь старого и нового форматов, null-элементы и null-поле — всё
    /// декодируется без ошибок.
    #[test]
    fn test_package_tracks_mixed_and_null_formats() {
        let json = json!({
            "packages": [
                {"id": 1, "tracks": ["1ZOLD", {"track": "1ZNEW", "carrier": "UPS"}, null]}
            ]
        });
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        assert_eq!(
            packages[0].tracks,
            vec![
                TrackInput { track: "1ZOLD".into(), carrier: String::new() },
                TrackInput { track: "1ZNEW".into(), carrier: "UPS".into() },
            ]
        );

        let json = json!({"packages": [{"id": 2, "tracks": null}]});
        let packages: Vec<Package> = extract(json, "packages").unwrap();
        assert!(packages[0].tracks.is_empty());
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

    /// Метод `package` (апдейт панели 2026-09): одиночный объект под ключом
    /// "package" — та же схема, что у элемента `packages`.
    #[test]
    fn test_extract_single_package() {
        let json = json!({
            "success": true,
            "package": {
                "id": 11517,
                "name": "Apple iPhone 13 Pro, QTY:2",
                "status": "shipped",
                "price": 999.99,
                "percent": 15,
                "is_deposited": true,
                "deposit_amount": 210.00,
                "deposited_date": "2026-08-10 18:49:07",
                "labels": [{"track": "1Z999AA10123456784", "carrier": "UPS"}],
                "labels_hash": "abc123def456",
                "tracks": [{"track": "1Z999AA10123456784", "carrier": "ups"}],
                "comments": []
            }
        });
        let pkg: Package = extract(json, "package").unwrap();
        assert_eq!(pkg.id, 11517);
        assert_eq!(pkg.status, "shipped");
        assert!(pkg.is_deposited);
        assert_eq!(
            pkg.tracks,
            vec![TrackInput { track: "1Z999AA10123456784".into(), carrier: "ups".into() }]
        );
    }

    /// Ответ `add_track`: добавленный трек + полный список после добавления.
    #[test]
    fn test_add_track_result_decode() {
        let json = json!({
            "success": true,
            "track": {"track": "1Z999AA10123456784", "carrier": "ups"},
            "tracks": [
                {"track": "1Z999AA10123456784", "carrier": "ups"},
                {"track": "6129999888777666555", "carrier": "fedex"}
            ]
        });
        let result = AddTrackResult {
            track: extract(json.clone(), "track").unwrap(),
            tracks: extract(json, "tracks").unwrap(),
        };
        assert_eq!(result.track.track, "1Z999AA10123456784");
        assert_eq!(result.track.carrier, "ups");
        assert_eq!(result.tracks.len(), 2);
        assert_eq!(result.tracks[1].carrier, "fedex");
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
            pay_option: Some("forwarding".to_string()),
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
        // Незаполненные поля уходят в панель ОТСУТСТВУЮЩИМИ (не null):
        // панель применяет свои дефолты, а не валидирует null.
        assert!(json.get("comment").is_none());
        assert!(json.get("delivery_date").is_none());
        assert!(json.get("pickup").is_none());
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

    #[test]
    fn test_pay_options_match_doc() {
        // Жёсткий енум панели в docs/archive/API_STUFFER.md — метод new_package.
        assert_eq!(
            PAY_OPTIONS,
            &["%", "forwarding", "test", "50/50_admin", "50/50_stuffer", "sale"]
        );
    }
}
