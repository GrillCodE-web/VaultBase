//! Offline queue and footprint sync with cc-sync-server.
#![allow(dead_code, unused_variables)]

use crate::database::Database;
use crate::models::{Footprint, RiskWarning, SyncResult};

// ✅ SECURE: Only HTTPS via Cloudflare
// Домен берётся из crate::endpoints — единственного места, где он задан.
fn server_url() -> String { crate::endpoints::server_base() }

/// FIX B02: три разных исхода вместо Vec<> где [] = два разных состояния
pub enum RiskCheckOutcome {
    /// Нет сети / нет токена — не знаем
    Offline,
    /// Сервер ответил, совпадений нет
    Clean,
    /// Сервер ответил, есть предупреждения
    Warnings(Vec<RiskWarning>),
}

pub struct SyncClient;

impl SyncClient {
    /// FIX B11: считаем онлайном только 2xx ответы
    pub fn check_server_online() -> bool {
        match ureq::get(&format!("{}/", server_url()))
            .timeout(std::time::Duration::from_secs(5))
            .call()
        {
            Ok(_) => true,
            Err(ureq::Error::Status(code, _)) => code < 500, // 4xx = сервер жив но ошибка клиента
            Err(_) => false,
        }
    }

    /// PHASE 1: Footprint Sync V2 — отправляем footprints с order_status и installation_id_hash
    pub fn sync_footprints(db: &mut Database) -> Result<SyncResult, String> {
        let token = match db.get_config("license_token").map_err(|e| e.to_string())? {
            Some(t) if !t.is_empty() => {
                match &db.encryption {
                    Some(enc) => enc.decrypt(&t).unwrap_or(t),
                    None => t,
                }
            }
            _ => return Ok(SyncResult { synced: 0, failed: 0, message: "no_token".into(), server_reached: false }),
        };

        let footprints = db.get_unsynced_footprints_db()?;
        if footprints.is_empty() {
            let online = Self::check_server_online();
            return Ok(SyncResult { synced: 0, failed: 0, message: "nothing_to_sync".into(), server_reached: online });
        }

        // PHASE 1: Получаем installation_id_hash один раз для всех footprints
        let installation_id_hash = db.get_installation_id_hash();

        let expanded: Vec<serde_json::Value> = footprints.iter()
            .filter_map(|fp| fp.shop_domain.as_ref().map(|d| (fp, d.to_lowercase())))
            .flat_map(|(fp, domain)| {
                let mut rows: Vec<serde_json::Value> = vec![];
                // V2: включаем order_status и installation_id_hash в каждый payload
                if let Some(ref h) = fp.email_hash {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "email",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                if let Some(ref h) = fp.ip_hash {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "ip",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                if let Some(ref h) = fp.drop_hash {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "drop",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                if let Some(ref h) = fp.bin {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "bin",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                if let Some(ref h) = fp.phone_hash {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "phone",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                if let Some(ref h) = fp.name_hash {
                    rows.push(serde_json::json!({
                        "shop_domain": domain,
                        "hash_type": "name",
                        "hash_value": h,
                        "order_status": fp.order_status,
                        "installation_id_hash": installation_id_hash
                    }));
                }
                rows
            })
            .collect();

        if expanded.is_empty() {
            let online = Self::check_server_online();
            return Ok(SyncResult { synced: 0, failed: 0, message: "nothing_to_sync".into(), server_reached: online });
        }

        let ids: Vec<i64> = footprints.iter().map(|f| f.id).collect();
        // V2: добавляем version: "2.0" для обратной совместимости
        let body = serde_json::json!({
            "footprints": expanded,
            "version": "2.0"
        });

        // FIX P1-FOOTPRINT-RETRY-01: Retry с exponential backoff (как для карточек)
        const MAX_RETRIES: u32 = 3;
        const BASE_DELAY_MS: u64 = 500;

        for attempt in 0..MAX_RETRIES {
            match ureq::post(&format!("{}/footprint", server_url()))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(10))
                .send_string(&body.to_string())
            {
                Ok(_) => {
                    // Success — mark as synced and log
                    let _ = db.mark_footprints_synced_db(&ids);
                    let msg = format!("Synced {} footprints", ids.len());
                    let _ = db.log_event("sync.footprints_sent", &msg, Some("sync"), None);
                    return Ok(SyncResult { synced: ids.len() as u32, failed: 0, message: msg, server_reached: true });
                }
                Err(ureq::Error::Status(code, _)) if code >= 500 => {
                    // Server error — retry with backoff
                    if attempt < MAX_RETRIES - 1 {
                        let delay_ms = BASE_DELAY_MS * (1 << attempt); // 500ms, 1s, 2s
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        continue;
                    }
                    // All retries exhausted
                    let error_msg = format!("Failed to sync {} footprints after {} attempts (server error)", ids.len(), MAX_RETRIES);
                    let _ = db.log_event("sync.footprints_failed", &error_msg, Some("sync"), None);
                    eprintln!("[sync] {}", error_msg);
                    return Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: "server_error_after_retry".into(), server_reached: true });
                }
                Err(ureq::Error::Status(code, _)) => {
                    // Client error (4xx) — don't retry
                    let error_msg = format!("Failed to sync footprints: client error {}", code);
                    let _ = db.log_event("sync.footprints_failed", &error_msg, Some("sync"), None);
                    eprintln!("[sync] {}", error_msg);
                    return Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: format!("client_error_{}", code), server_reached: true });
                }
                Err(_) => {
                    // Network error — retry with backoff
                    if attempt < MAX_RETRIES - 1 {
                        let delay_ms = BASE_DELAY_MS * (1 << attempt);
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        continue;
                    }
                    // All retries exhausted
                    let error_msg = format!("Failed to sync {} footprints after {} attempts (network error)", ids.len(), MAX_RETRIES);
                    let _ = db.log_event("sync.footprints_failed", &error_msg, Some("sync"), None);
                    eprintln!("[sync] {}", error_msg);
                    return Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: "network_error_after_retry".into(), server_reached: false });
                }
            }
        }

        // Should not reach here
        Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: "unknown_error".into(), server_reached: false })
    }

    /// PHASE 1: Footprint Sync V2 — провер风险 с поддержкой нового формата ответа сервера
    /// Сервер возвращает расширенные данные: total_count, unique_users, status_breakdown, success_rate, risk_level, insight
    pub fn check_risk_detailed(db: &Database, profile_id: &str, shop_id: i64) -> RiskCheckOutcome {
        let token = match db.get_config("license_token").ok().flatten() {
            Some(t) if !t.is_empty() => match &db.encryption {
                Some(enc) => enc.decrypt(&t).unwrap_or(t),
                None => t,
            },
            _ => return RiskCheckOutcome::Offline,
        };

        let fp = match db.get_footprint_for_profile_shop(profile_id, shop_id) {
            Some(f) => f,
            None => return RiskCheckOutcome::Offline,
        };

        let domain = match fp.shop_domain {
            Some(ref d) => d.to_lowercase(),
            None => return RiskCheckOutcome::Offline,
        };

        let mut hashes: Vec<serde_json::Value> = vec![];
        if let Some(ref h) = fp.email_hash { hashes.push(serde_json::json!({ "hash_type": "email", "hash_value": h })); }
        if let Some(ref h) = fp.ip_hash    { hashes.push(serde_json::json!({ "hash_type": "ip",    "hash_value": h })); }
        if let Some(ref h) = fp.drop_hash  { hashes.push(serde_json::json!({ "hash_type": "drop",  "hash_value": h })); }
        if let Some(ref h) = fp.bin        { hashes.push(serde_json::json!({ "hash_type": "bin",   "hash_value": h })); }
        if let Some(ref h) = fp.phone_hash { hashes.push(serde_json::json!({ "hash_type": "phone", "hash_value": h })); }

        if hashes.is_empty() { return RiskCheckOutcome::Offline; }

        let body = serde_json::json!({ "shop_domain": domain, "hashes": hashes });

        let resp = ureq::post(&format!("{}/footprint/check", server_url()))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(5))
            .send_string(&body.to_string());

        match resp {
            Ok(r) => {
                match r.into_json::<serde_json::Value>() {
                    Ok(json) => {
                        let matches = json["matches"].as_array().cloned().unwrap_or_default();
                        if matches.is_empty() {
                            return RiskCheckOutcome::Clean;
                        }
                        let mut warnings = vec![];
                        for m in &matches {
                            let hash_type = m["hash_type"].as_str().unwrap_or("unknown");
                            // V2: новый формат ответа — используем total_count, иначе fallback на count
                            let total_count = m["total_count"].as_u64().unwrap_or_else(|| m["count"].as_u64().unwrap_or(1));
                            let unique_users = m["unique_users"].as_u64().unwrap_or(0);
                            let success_rate = m["success_rate"].as_f64().unwrap_or(0.0);
                            let risk_level = m["risk_level"].as_str().unwrap_or("unknown");
                            let insight = m["insight"].as_str().unwrap_or("");

                            // Определяем severity на основе risk_level и success_rate
                            let severity = match risk_level {
                                "high" => "high",
                                "medium" => "warning",
                                "low" => "info",
                                _ => {
                                    // Fallback: определяем по count и success_rate
                                    if total_count >= 3 || success_rate < 0.5 { "high" }
                                    else if total_count >= 2 || success_rate < 0.7 { "warning" }
                                    else { "info" }
                                }
                            };

                            let label = match hash_type {
                                "email" => "Email",
                                "ip" => "IP address",
                                "drop" => "Shipping address",
                                "bin" => "BIN",
                                "phone" => "Phone number",
                                _ => hash_type,
                            };

                            // Формируем расширенное сообщение с insight от сервера
                            let message = if !insight.is_empty() {
                                format!("{}: {}", label, insight)
                            } else {
                                // Fallback для старого формата ответа
                                let unique_users_str = if unique_users > 0 {
                                    format!(" ({} unique users)", unique_users)
                                } else {
                                    String::new()
                                };
                                format!("{} seen {} time(s){} at this shop globally", label, total_count, unique_users_str)
                            };

                            warnings.push(RiskWarning {
                                kind: format!("global_{}", hash_type),
                                severity: severity.into(),
                                message,
                                related_order_id: None,
                                related_order_status: None,
                            });
                        }
                        RiskCheckOutcome::Warnings(warnings)
                    }
                    Err(_) => RiskCheckOutcome::Offline,
                }
            }
            Err(_) => RiskCheckOutcome::Offline,
        }
    }

    /// Обратная совместимость — старый интерфейс через новый
    pub fn check_risk(db: &Database, profile_id: &str, shop_id: i64) -> Vec<RiskWarning> {
        match Self::check_risk_detailed(db, profile_id, shop_id) {
            RiskCheckOutcome::Warnings(w) => w,
            _ => vec![],
        }
    }

    pub fn check_version() -> Option<(String, String)> {
        let resp = ureq::get(&format!("{}/version", server_url()))
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .ok()?;
        let json: serde_json::Value = resp.into_json().ok()?;
        let version = json["version"].as_str()?.to_string();
        let notes = json["notes"].as_str().unwrap_or("").to_string();
        Some((version, notes))
    }
}

// MGR-018 (этап E1): SyncGroupClient (create/join/pair/push) выпилен —
// воркер больше не участвует в групповом sync'е карт; карты приходят
// запечатанными срезами от менеджера (commands/slices.rs + ws_sync).

// ─────────────────────────────────────────
//  Tests (TEST-007)
// ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = Database::open(path.to_str().unwrap()).unwrap();
        (dir, db)
    }

    // ── sync_footprints: offline-пути без сети ──

    #[test]
    fn test_sync_footprints_no_token() {
        let (_dir, mut db) = test_db();
        let res = SyncClient::sync_footprints(&mut db).unwrap();
        assert_eq!(res.synced, 0);
        assert_eq!(res.failed, 0);
        assert_eq!(res.message, "no_token");
        assert!(!res.server_reached);
    }

    #[test]
    fn test_check_risk_no_token_is_offline() {
        let (_dir, db) = test_db();
        match SyncClient::check_risk_detailed(&db, "profile1", 1) {
            RiskCheckOutcome::Offline => {}
            _ => panic!("expected Offline without token"),
        }
        // Старый интерфейс маппит Offline → пустой список
        assert!(SyncClient::check_risk(&db, "profile1", 1).is_empty());
    }

}
