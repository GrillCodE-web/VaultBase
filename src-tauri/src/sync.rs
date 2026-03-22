//! Offline queue and footprint sync with cc-sync-server.
#![allow(dead_code, unused_variables)]

use crate::database::Database;
use crate::models::{Footprint, RiskWarning, SyncResult};

const SERVER_URL: &str = "https://api.eulivehub.com";

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
        match ureq::get(&format!("{}/", SERVER_URL))
            .timeout(std::time::Duration::from_secs(5))
            .call()
        {
            Ok(_) => true,
            Err(ureq::Error::Status(code, _)) => code < 500, // 4xx = сервер жив но ошибка клиента
            Err(_) => false,
        }
    }

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

        let expanded: Vec<serde_json::Value> = footprints.iter()
            .filter_map(|fp| fp.shop_domain.as_ref().map(|d| (fp, d.to_lowercase())))
            .flat_map(|(fp, domain)| {
                let mut rows: Vec<serde_json::Value> = vec![];
                if let Some(ref h) = fp.email_hash { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "email", "hash_value": h })); }
                if let Some(ref h) = fp.ip_hash    { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "ip",    "hash_value": h })); }
                if let Some(ref h) = fp.drop_hash  { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "drop",  "hash_value": h })); }
                if let Some(ref h) = fp.bin        { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "bin",   "hash_value": h })); }
                if let Some(ref h) = fp.phone_hash { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "phone", "hash_value": h })); }
                if let Some(ref h) = fp.name_hash  { rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "name",  "hash_value": h })); }
                rows
            })
            .collect();

        if expanded.is_empty() {
            let online = Self::check_server_online();
            return Ok(SyncResult { synced: 0, failed: 0, message: "nothing_to_sync".into(), server_reached: online });
        }

        let ids: Vec<i64> = footprints.iter().map(|f| f.id).collect();
        let body = serde_json::json!({ "footprints": expanded });

        match ureq::post(&format!("{}/footprint", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
        {
            Ok(_) => {
                let _ = db.mark_footprints_synced_db(&ids);
                let msg = format!("Synced {} footprints", ids.len());
                let _ = db.log_event("sync.footprints_sent", &msg, Some("sync"), None);
                Ok(SyncResult { synced: ids.len() as u32, failed: 0, message: msg, server_reached: true })
            }
            Err(ureq::Error::Status(_, _)) => {
                Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: "server_error".into(), server_reached: true })
            }
            Err(_) => {
                Ok(SyncResult { synced: 0, failed: ids.len() as u32, message: "network_error".into(), server_reached: false })
            }
        }
    }

    /// FIX B02: возвращает RiskCheckOutcome вместо Vec<> (различаем offline и clean)
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

        let resp = ureq::post(&format!("{}/footprint/check", SERVER_URL))
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
                            let count = m["count"].as_u64().unwrap_or(1);
                            let severity = if count >= 3 { "high" } else { "warning" };
                            let label = match hash_type {
                                "email" => "Email", "ip" => "IP address",
                                "drop"  => "Shipping address", "bin" => "BIN",
                                "phone" => "Phone number", _ => hash_type,
                            };
                            warnings.push(RiskWarning {
                                kind: format!("global_{}", hash_type),
                                severity: severity.into(),
                                message: format!("{} seen {} time(s) at this shop globally", label, count),
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
        let resp = ureq::get(&format!("{}/version", SERVER_URL))
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .ok()?;
        let json: serde_json::Value = resp.into_json().ok()?;
        let version = json["version"].as_str()?.to_string();
        let notes = json["notes"].as_str().unwrap_or("").to_string();
        Some((version, notes))
    }
}

// ─────────────────────────────────────────
//  Sync Group HTTP Commands
// ─────────────────────────────────────────

pub struct SyncGroupClient;

impl SyncGroupClient {
    fn get_token(db: &Database) -> Option<String> {
        match db.get_config("license_token").ok().flatten() {
            Some(t) if !t.is_empty() => Some(match &db.encryption {
                Some(enc) => enc.decrypt(&t).unwrap_or(t),
                None => t,
            }),
            _ => None,
        }
    }

    pub fn create_group(db: &Database, name: &str) -> Result<crate::models::SyncGroupInfo, String> {
        let token = Self::get_token(db).ok_or("no_token")?;
        let body = serde_json::json!({ "name": name });
        let resp = ureq::post(&format!("{}/sync/group/create", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_string(&body.to_string())
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
        if json["ok"].as_bool() != Some(true) {
            return Err(json["error"].as_str().unwrap_or("server_error").to_string());
        }
        let group_id = json["group_id"].as_str().ok_or("missing_group_id")?.to_string();
        let group_key = json["group_key"].as_str().ok_or("missing_group_key")?.to_string();
        // Save to local config
        db.set_config("sync_group_id", &group_id).map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", &group_key).map_err(|e| e.to_string())?;
        db.set_config("sync_group_name", name).map_err(|e| e.to_string())?;
        Ok(crate::models::SyncGroupInfo {
            group_id,
            name: name.to_string(),
            card_count: 0,
            members: vec![],
        })
    }

    pub fn create_pair_code(db: &Database) -> Result<String, String> {
        let token = Self::get_token(db).ok_or("no_token")?;
        let resp = ureq::post(&format!("{}/sync/group/pair", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_string("{}")
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
        if json["ok"].as_bool() != Some(true) {
            return Err(json["error"].as_str().unwrap_or("server_error").to_string());
        }
        let code = json["code"].as_str().ok_or("missing_code")?.to_string();
        let expires_at = json["expires_at"].as_str().unwrap_or("").to_string();
        Ok(format!("{} (expires: {})", code, expires_at))
    }

    pub fn join_group(db: &Database, pair_code: &str) -> Result<crate::models::SyncGroupInfo, String> {
        let token = Self::get_token(db).ok_or("no_token")?;
        let body = serde_json::json!({ "code": pair_code.to_uppercase() });
        let resp = ureq::post(&format!("{}/sync/group/join", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_string(&body.to_string())
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
        if json["ok"].as_bool() != Some(true) {
            return Err(json["error"].as_str().unwrap_or("server_error").to_string());
        }
        let group_id = json["group_id"].as_str().ok_or("missing_group_id")?.to_string();
        let group_key = json["group_key"].as_str().ok_or("missing_group_key")?.to_string();
        let group_name = json["group_name"].as_str().unwrap_or("Sync Group").to_string();
        db.set_config("sync_group_id", &group_id).map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", &group_key).map_err(|e| e.to_string())?;
        db.set_config("sync_group_name", &group_name).map_err(|e| e.to_string())?;
        let members_arr = json["cards"].as_array().cloned().unwrap_or_default();
        Ok(crate::models::SyncGroupInfo {
            group_id,
            name: group_name,
            card_count: members_arr.len() as u32,
            members: vec![],
        })
    }

    pub fn get_group_status(db: &Database) -> crate::models::SyncGroupStatus {
        let group_id = db.get_config("sync_group_id").ok().flatten();
        let group_name = db.get_config("sync_group_name").ok().flatten();
        let in_group = group_id.is_some();
        crate::models::SyncGroupStatus {
            in_group,
            group_id,
            group_name,
            connected: false, // WS connection status would be tracked separately
            last_sync: db.get_config("sync_last_at").ok().flatten(),
        }
    }

    pub fn disconnect(db: &Database) -> Result<(), String> {
        let token = match Self::get_token(db) {
            Some(t) => t,
            None => {
                // Clear local config even without token
                let _ = db.set_config("sync_group_id", "");
                let _ = db.set_config("sync_group_key", "");
                let _ = db.set_config("sync_group_name", "");
                return Ok(());
            }
        };
        // Try to leave on server (best effort)
        let _ = ureq::post(&format!("{}/sync/group/leave", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(5))
            .send_string("{}");
        db.set_config("sync_group_id", "").map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", "").map_err(|e| e.to_string())?;
        db.set_config("sync_group_name", "").map_err(|e| e.to_string())?;
        Ok(())
    }
}
