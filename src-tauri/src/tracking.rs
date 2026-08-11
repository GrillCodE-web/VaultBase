//! Direct carrier tracking API integration (UPS, FedEx, USPS)
//! Fallback to 17track for unknown carriers

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

use crate::models::{TrackingStatus, TrackingEvent};

// ─────────────────────────────────────────
//  Cache for tracking results (avoid repeated API calls)
// ─────────────────────────────────────────

static TRACKING_CACHE: Lazy<Mutex<HashMap<String, (TrackingStatus, i64)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// FIX CONFIG: Use centralized constants instead of local magic numbers
use crate::constants::{TRACKING_CACHE_TTL_SECS, TRACKING_CACHE_MAX_SIZE, TRACKING_CACHE_CLEANUP_INTERVAL};

fn get_cached_tracking(tracking: &str) -> Option<TrackingStatus> {
    let guard = TRACKING_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((status, timestamp)) = guard.get(tracking) {
        let now = chrono::Utc::now().timestamp();
        if now - timestamp < TRACKING_CACHE_TTL_SECS {
            return Some(status.clone());
        }
    }
    None
}

fn cache_tracking_result(tracking: &str, status: TrackingStatus) {
    if let Ok(mut guard) = TRACKING_CACHE.lock().or_else(|e| Ok::<_, ()>(e.into_inner())) {
        let now = chrono::Utc::now().timestamp();
        
        // FINAL-003: Fixed cache cleanup — always check when exceeding threshold
        if guard.len() >= TRACKING_CACHE_CLEANUP_INTERVAL {
            let max_age = TRACKING_CACHE_TTL_SECS * 2;
            guard.retain(|_, (_, timestamp)| now - *timestamp < max_age);
        }
        
        if guard.len() >= TRACKING_CACHE_MAX_SIZE {
            // Find and remove oldest entry
            if let Some(oldest_key) = guard.iter()
                .min_by_key(|(_, (_, ts))| ts)
                .map(|(k, _)| k.clone())
            {
                guard.remove(&oldest_key);
            }
        }
        
        guard.insert(tracking.to_string(), (status, now));
    }
}

// ─────────────────────────────────────────
//  Carrier Detection
// ─────────────────────────────────────────

pub fn detect_carrier(tracking: &str) -> Option<&'static str> {
    let t = tracking.trim();

    // UPS: 1ZXXXXXXXXXXXXXXXX (1Z + 16 chars = 18 total)
    if t.starts_with("1Z") && t.len() == 18 {
        return Some("UPS");
    }

    // FedEx: 12 digits
    if t.len() == 12 && t.chars().all(|c| c.is_ascii_digit()) {
        return Some("FedEx");
    }

    // FedEx: 15 digits
    if t.len() == 15 && t.chars().all(|c| c.is_ascii_digit()) {
        return Some("FedEx");
    }

    // USPS: 9400/9405/9407/9409 + 18 digits (total 22)
    if (t.starts_with("9400") || t.starts_with("9405") ||
        t.starts_with("9407") || t.starts_with("9409")) &&
        t.len() == 22 {
        return Some("USPS");
    }

    // USPS Alternative: 20-22 digits starting with 9
    if t.len() >= 20 && t.len() <= 22 && t.starts_with('9') && t.chars().all(|c| c.is_ascii_digit()) {
        return Some("USPS");
    }

    None
}

// ─────────────────────────────────────────
//  USPS API (Simplest - only requires User ID)
// ─────────────────────────────────────────

pub fn check_usps_tracking(tracking: &str) -> Result<TrackingStatus, String> {
    let user_id = std::env::var("USPS_API_USER_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            // Try to get from config via STATE if available
            crate::state::get_config_internal("usps_api_user_id").ok().flatten()
                .filter(|s| !s.is_empty())
        })
        .ok_or_else(|| "USPS_API_USER_ID not configured".to_string())?;

    // USPS Web Tools Track API v2 (XML based)
    // URL encode the XML request
    let xml_request = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
        <TrackRequest>
            <UserId>{}</UserId>
            <TrackID ID="{}">
                <TrackSummary>true</TrackSummary>
            </TrackID>
        </TrackRequest>"#,
        user_id, tracking
    );

    // FIX CRITICAL: Use constant for USPS tracking URL
    // FINAL-008: Use replacen to only replace first occurrence
    let encoded_xml = urlencoding::encode(&xml_request);
    let url = crate::constants::TRACKING_USPS_URL.replacen("{}", &encoded_xml, 1);

    let resp = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .call();

    match resp {
        Ok(r) => {
            let xml = r.into_string().unwrap_or_default();
            parse_usps_response(&xml, tracking)
        }
        Err(e) => Err(format!("USPS API error: {}", e)),
    }
}

fn parse_usps_response(xml: &str, tracking: &str) -> Result<TrackingStatus, String> {
    // Simple XML parsing for USPS response
    // Check for error first
    if xml.contains("<Error>") {
        let error_desc = extract_xml_element(xml, "Description")
            .unwrap_or_else(|| "Unknown USPS error".to_string());
        return Err(format!("USPS error: {}", error_desc));
    }

    // Extract TrackSummary
    let track_summary = extract_xml_element(xml, "TrackSummary")
        .unwrap_or_default();

    let status_detail = extract_xml_element(&track_summary, "Event")
        .unwrap_or_else(|| "No tracking information".to_string());

    let status_time = extract_xml_element(&track_summary, "EventTime")
        .unwrap_or_default();

    let status_date = extract_xml_element(&track_summary, "EventDate")
        .unwrap_or_default();

    // Map USPS status to our status
    let status = map_usps_status(&status_detail);

    // Extract Expected Delivery Date if available
    let estimated_delivery = extract_xml_element(xml, "ExpectedDeliveryDate")
        .filter(|s| !s.is_empty())
        .or_else(|| extract_xml_element(xml, "ExpectedDeliveryTime")
            .filter(|s| !s.is_empty()));

    // Parse tracking events
    let mut events = Vec::new();

    // Find all TrackDetail sections
    let mut search_pos = 0;
    while let Some(start) = xml[search_pos..].find("<TrackDetail>") {
        let abs_start = search_pos + start;
        if let Some(end) = xml[abs_start..].find("</TrackDetail>") {
            let detail = &xml[abs_start..abs_start + end + 14];

            let event_time = extract_xml_element(detail, "EventTime").unwrap_or_default();
            let event_date = extract_xml_element(detail, "EventDate").unwrap_or_default();
            let event = extract_xml_element(detail, "Event").unwrap_or_default();
            let event_city: Option<String> = extract_xml_element(detail, "EventCity");
            let event_state: Option<String> = extract_xml_element(detail, "EventState");
            let event_country: Option<String> = extract_xml_element(detail, "EventCountry");

            let location = [event_city.as_ref(), event_state.as_ref(), event_country.as_ref()]
                .iter()
                .filter_map(|s| s.as_ref().filter(|s| !s.is_empty()))
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ");

            let timestamp = format!("{} {}", event_date, event_time);

            events.push(TrackingEvent {
                timestamp,
                status: map_usps_status(&event),
                location: if location.is_empty() { None } else { Some(location) },
                description: event,
            });

            search_pos = abs_start + end + 14;
        } else {
            break;
        }
    }

    // Reverse events to get chronological order (USPS returns newest first)
    events.reverse();

    Ok(TrackingStatus {
        status,
        status_detail: if status_detail.is_empty() { "No updates".to_string() } else { status_detail },
        carrier: "USPS".to_string(),
        tracking_number: tracking.to_string(),
        estimated_delivery,
        events,
    })
}

fn map_usps_status(usps_status: &str) -> String {
    let lower = usps_status.to_lowercase();
    if lower.contains("deliver") {
        "delivered".to_string()
    } else if lower.contains("accept") || lower.contains("in transit") ||
              lower.contains("depart") || lower.contains("arrive") ||
              lower.contains("out for delivery") {
        "in_transit".to_string()
    } else if lower.contains("exception") || lower.contains("delay") ||
              lower.contains("alert") {
        "exception".to_string()
    } else if lower.contains("pre-shipment") || lower.contains("label created") {
        "pre_transit".to_string()
    } else {
        "unknown".to_string()
    }
}

fn extract_xml_element(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);

    if let Some(open_start) = xml.find(&open_tag) {
        // Handle both <Tag> and <Tag ...>
        if let Some(content_start) = xml[open_start..].find('>') {
            let abs_content_start = open_start + content_start + 1;
            if let Some(close_pos) = xml[abs_content_start..].find(&close_tag) {
                return Some(xml[abs_content_start..abs_content_start + close_pos].trim().to_string());
            }
        }
    }
    None
}

// ─────────────────────────────────────────
//  UPS API (Requires OAuth2)
// ─────────────────────────────────────────

pub fn check_ups_tracking(tracking: &str) -> Result<TrackingStatus, String> {
    // UPS Tracking API v2 — OAuth2 token flow
    let client_id = std::env::var("UPS_CLIENT_ID").ok().filter(|s| !s.is_empty());
    let client_secret = std::env::var("UPS_CLIENT_SECRET").ok().filter(|s| !s.is_empty());

    if client_id.is_none() || client_secret.is_none() {
        return Err("UPS API requires OAuth2 credentials (UPS_CLIENT_ID, UPS_CLIENT_SECRET)".into());
    }

    // Get OAuth2 token
    let token = get_ups_oauth_token(client_id.unwrap_or_default(), client_secret.unwrap_or_default())?;

    // FIX CRITICAL: Use constant for UPS tracking URL
    let url = crate::constants::TRACKING_UPS_URL.replacen("{}", tracking, 1);

    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .set("transId", "123")
        .set("transactionSrc", "vaultbase")
        .timeout(std::time::Duration::from_secs(10))
        .call();

    match resp {
        Ok(r) => {
            let json: serde_json::Value = r.into_json()
                .map_err(|e| format!("Failed to parse UPS response: {}", e))?;
            parse_ups_response(&json, tracking)
        }
        Err(e) => Err(format!("UPS API error: {}", e)),
    }
}

fn get_ups_oauth_token(client_id: String, client_secret: String) -> Result<String, String> {
    // FIX CRITICAL: Use constant for UPS OAuth token URL
    let url = crate::constants::TRACKING_UPS_TOKEN_URL;

    // FINAL-002: URL-encode credentials to prevent injection via special chars
    let encoded_id = urlencoding::encode(&client_id);
    let encoded_secret = urlencoding::encode(&client_secret);
    let body = format!(
        "grant_type=client_credentials&client_id={}&client_secret={}",
        encoded_id, encoded_secret
    );

    let resp = ureq::post(url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body);

    match resp {
        Ok(r) => {
            let json: serde_json::Value = r.into_json()
                .map_err(|e| format!("Failed to parse OAuth response: {}", e))?;

            json["access_token"].as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "No access_token in UPS OAuth response".to_string())
        }
        Err(e) => Err(format!("UPS OAuth error: {}", e)),
    }
}

fn parse_ups_response(json: &serde_json::Value, tracking: &str) -> Result<TrackingStatus, String> {
    let shipment = json.as_object()
        .and_then(|o| o.get("shipment"))
        .ok_or_else(|| "No shipment data in UPS response".to_string())?;

    // Extract status
    let status_code = shipment
        .as_object()
        .and_then(|o| o.get("package"))
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.first())
        .and_then(|pkg| pkg.as_object())
        .and_then(|o| o.get("activity"))
        .and_then(|a| a.as_array())
        .and_then(|arr| arr.first())
        .and_then(|act| act.as_object())
        .and_then(|o| o.get("status"))
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("code"))
        .and_then(|c| c.as_str())
        .unwrap_or("");

    let status = match status_code {
        "D" => "delivered",
        "I" => "in_transit",
        "X" => "exception",
        _ => "unknown",
    }.to_string();

    let status_detail = shipment
        .as_object()
        .and_then(|o| o.get("package"))
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.first())
        .and_then(|pkg| pkg.as_object())
        .and_then(|o| o.get("activity"))
        .and_then(|a| a.as_array())
        .and_then(|arr| arr.first())
        .and_then(|act| act.as_object())
        .and_then(|o| o.get("status"))
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("description"))
        .and_then(|d| d.as_str())
        .unwrap_or("No status available")
        .to_string();

    // Extract events
    let mut events = Vec::new();
    if let Some(packages) = shipment
        .as_object()
        .and_then(|o| o.get("package"))
        .and_then(|p| p.as_array())
    {
        for pkg in packages {
            if let Some(activities) = pkg
                .as_object()
                .and_then(|o| o.get("activity"))
                .and_then(|a| a.as_array())
            {
                for act in activities {
                    if let Some(obj) = act.as_object() {
                        let timestamp = obj
                            .get("date")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string();

                        let description = obj
                            .get("status")
                            .and_then(|s| s.as_object())
                            .and_then(|st| st.get("description"))
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string();

                        let location = obj
                            .get("location")
                            .and_then(|l| l.as_object())
                            .map(|l| {
                                let city = l.get("city").and_then(|c| c.as_str()).unwrap_or("");
                                let state = l.get("stateProvince").and_then(|s| s.as_str()).unwrap_or("");
                                let country = l.get("country").and_then(|c| c.as_str()).unwrap_or("");
                                [city, state, country]
                                    .iter()
                                    .filter(|s| !s.is_empty())
                                    .map(|s| s.to_string())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            })
                            .filter(|s| !s.is_empty());

                        events.push(TrackingEvent {
                            timestamp,
                            status: map_ups_status_code(
                                obj.get("status")
                                    .and_then(|s| s.as_object())
                                    .and_then(|st| st.get("code"))
                                    .and_then(|c| c.as_str())
                                    .unwrap_or("")
                            ),
                            location,
                            description,
                        });
                    }
                }
            }
        }
    }

    // Estimated delivery
    let estimated_delivery = shipment
        .as_object()
        .and_then(|o| o.get("scheduledDeliveryDate"))
        .and_then(|d| d.as_str())
        .map(|s| s.to_string());

    Ok(TrackingStatus {
        status,
        status_detail,
        carrier: "UPS".to_string(),
        tracking_number: tracking.to_string(),
        estimated_delivery,
        events,
    })
}

fn map_ups_status_code(code: &str) -> String {
    match code {
        "D" => "delivered".to_string(),
        "I" => "in_transit".to_string(),
        "X" => "exception".to_string(),
        "P" => "pre_transit".to_string(),
        _ => "unknown".to_string(),
    }
}

// ─────────────────────────────────────────
//  FedEx API (Requires API Key)
// ─────────────────────────────────────────

pub fn check_fedex_tracking(tracking: &str) -> Result<TrackingStatus, String> {
    let api_key = std::env::var("FEDEX_API_KEY").ok().filter(|s| !s.is_empty());
    let account_number = std::env::var("FEDEX_ACCOUNT_NUMBER").ok().filter(|s| !s.is_empty());

    if api_key.is_none() || account_number.is_none() {
        return Err("FedEx API requires FEDEX_API_KEY and FEDEX_ACCOUNT_NUMBER".into());
    }

    let url = crate::constants::TRACKING_FEDEX_URL;
    let api_key = api_key.unwrap_or_default();

    let body = serde_json::json!({
        "trackingNumberInfo": [{
            "trackingNumber": tracking
        }]
    });

    // FIX CRITICAL: Use constant for FedEx tracking URL
    let resp = ureq::post(url)
        .set("Authorization", &format!("Bearer {}", &api_key))
        .set("client_api_key", &api_key)
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(10))
        .send_json(&body);

    match resp {
        Ok(r) => {
            let json: serde_json::Value = r.into_json()
                .map_err(|e| format!("Failed to parse FedEx response: {}", e))?;
            parse_fedex_response(&json, tracking)
        }
        Err(e) => Err(format!("FedEx API error: {}", e)),
    }
}

fn parse_fedex_response(json: &serde_json::Value, tracking: &str) -> Result<TrackingStatus, String> {
    let track_reply = json
        .as_object()
        .and_then(|o| o.get("trackReply"))
        .ok_or_else(|| "No trackReply in FedEx response".to_string())?;

    let status_code = track_reply
        .as_object()
        .and_then(|o| o.get("status"))
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("type"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    let status = match status_code {
        "DL" => "delivered",
        "IT" => "in_transit",
        "OC" => "exception",
        _ => "unknown",
    }.to_string();

    let status_detail = track_reply
        .as_object()
        .and_then(|o| o.get("status"))
        .and_then(|s| s.as_object())
        .and_then(|o| o.get("detail"))
        .and_then(|d| d.as_str())
        .unwrap_or("No status available")
        .to_string();

    // Extract events
    let mut events = Vec::new();
    if let Some(events_array) = track_reply
        .as_object()
        .and_then(|o| o.get("dateEvents"))
        .and_then(|e| e.as_array())
    {
        for event in events_array {
            if let Some(obj) = event.as_object() {
                let timestamp = obj
                    .get("date")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string();

                let description = obj
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string();

                let location = obj
                    .get("address")
                    .and_then(|a| a.as_object())
                    .map(|a| {
                        let city = a.get("city").and_then(|c| c.as_str()).unwrap_or("");
                        let state = a.get("stateOrProvinceCode").and_then(|s| s.as_str()).unwrap_or("");
                        let country = a.get("countryCode").and_then(|c| c.as_str()).unwrap_or("");
                        [city, state, country]
                            .iter()
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    })
                    .filter(|s| !s.is_empty());

                events.push(TrackingEvent {
                    timestamp,
                    status: status.clone(),
                    location,
                    description,
                });
            }
        }
    }

    // Estimated delivery
    let estimated_delivery = track_reply
        .as_object()
        .and_then(|o| o.get("estimatedDelivery"))
        .and_then(|e| e.as_str())
        .map(|s| s.to_string());

    Ok(TrackingStatus {
        status,
        status_detail,
        carrier: "FedEx".to_string(),
        tracking_number: tracking.to_string(),
        estimated_delivery,
        events,
    })
}

// ─────────────────────────────────────────
//  Smart Routing (with cache)
// ─────────────────────────────────────────

pub fn check_tracking_smart(tracking: &str) -> Result<TrackingStatus, String> {
    // Check cache first
    if let Some(cached) = get_cached_tracking(tracking) {
        return Ok(cached);
    }

    let carrier = detect_carrier(tracking);

    let result = match carrier {
        Some("USPS") => check_usps_tracking(tracking),
        Some("UPS") => check_ups_tracking(tracking),
        Some("FedEx") => check_fedex_tracking(tracking),
        _ => Err("Unknown carrier, use 17track fallback".into()),
    };

    // Cache successful results
    if let Ok(ref status) = result {
        cache_tracking_result(tracking, status.clone());
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ups_detection() {
        assert_eq!(detect_carrier("1Z999AA10123456784"), Some("UPS"));
        assert_eq!(detect_carrier("1Z999AA1012345678"), None); // Too short
    }

    #[test]
    fn test_fedex_detection() {
        assert_eq!(detect_carrier("123456789012"), Some("FedEx"));
        assert_eq!(detect_carrier("123456789012345"), Some("FedEx"));
        assert_eq!(detect_carrier("12345678901"), None); // Too short
    }

    #[test]
    fn test_usps_detection() {
        assert_eq!(detect_carrier("9400111899223456789012"), Some("USPS"));
        assert_eq!(detect_carrier("9405111899223456789012"), Some("USPS"));
        assert_eq!(detect_carrier("9407111899223456789012"), Some("USPS"));
        assert_eq!(detect_carrier("9409111899223456789012"), Some("USPS"));

        // 21 цифр — это ВАЛИДНЫЙ USPS: запасная ветка detect_carrier принимает
        // 20–22 цифры, начинающиеся с 9 (USPS Tracking Plus бывает и такой
        // длины). Тест раньше ждал здесь None с комментарием «Too short» и
        // падал: ошибочным было ожидание, а не код.
        assert_eq!(detect_carrier("940011189922345678901"), Some("USPS"));

        // Действительно коротко: 19 цифр не подходит ни под одну ветку.
        assert_eq!(detect_carrier("9400111899223456789"), None);
        // Начинается не с 9 — не USPS (и не подходит по длине под остальных).
        assert_eq!(detect_carrier("8400111899223456789012"), None);
    }
}
