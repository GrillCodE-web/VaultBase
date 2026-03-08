//! Offline queue and footprint sync with cc-sync-server.
#![allow(dead_code, unused_variables)]

use crate::database::Database;
use crate::models::{Footprint, RiskWarning, SyncResult};

const SERVER_URL: &str = "https://api.eulivehub.com";

pub struct SyncClient;

impl SyncClient {
    /// Quick TCP-level check if server is reachable.
    pub fn check_server_online() -> bool {
        ureq::get(&format!("{}/", SERVER_URL))
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .map(|_| true)
            .unwrap_or_else(|e| matches!(e, ureq::Error::Status(_, _)))
    }

    /// Send unsynced footprints to server.
    /// Expands each Footprint record into individual hash rows: { shop_domain, hash_type, hash_value }
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
            return Ok(SyncResult { synced: 0, failed: 0, message: "nothing_to_sync".into(), server_reached: false });
        }

        // Expand each composite Footprint into individual { shop_domain, hash_type, hash_value } records
        let expanded: Vec<serde_json::Value> = footprints.iter()
            .filter_map(|fp| fp.shop_domain.as_ref().map(|d| (fp, d.to_lowercase())))
            .flat_map(|(fp, domain)| {
                let mut rows: Vec<serde_json::Value> = vec![];
                if let Some(ref h) = fp.email_hash {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "email", "hash_value": h }));
                }
                if let Some(ref h) = fp.ip_hash {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "ip", "hash_value": h }));
                }
                if let Some(ref h) = fp.drop_hash {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "drop", "hash_value": h }));
                }
                if let Some(ref h) = fp.bin {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "bin", "hash_value": h }));
                }
                if let Some(ref h) = fp.phone_hash {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "phone", "hash_value": h }));
                }
                if let Some(ref h) = fp.name_hash {
                    rows.push(serde_json::json!({ "shop_domain": domain, "hash_type": "name", "hash_value": h }));
                }
                rows
            })
            .collect();

        if expanded.is_empty() {
            return Ok(SyncResult { synced: 0, failed: 0, message: "nothing_to_sync".into(), server_reached: false });
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

    /// Check global footprint collision risk for a profile+shop combo.
    /// POST /footprint/check → { shop_domain, hashes: [{hash_type, hash_value}] }
    /// Response: { matches: [{hash_type, count}] }
    /// Returns server-side risk warnings, or empty vec if offline/no token.
    pub fn check_risk(db: &Database, profile_id: &str, shop_id: i64) -> Vec<RiskWarning> {
        let token = match db.get_config("license_token").ok().flatten() {
            Some(t) if !t.is_empty() => match &db.encryption {
                Some(enc) => enc.decrypt(&t).unwrap_or(t),
                None => t,
            },
            _ => return vec![],
        };

        let fp = match db.get_footprint_for_profile_shop(profile_id, shop_id) {
            Some(f) => f,
            None => return vec![],
        };

        let domain = match fp.shop_domain {
            Some(ref d) => d.to_lowercase(),
            None => return vec![],
        };

        // Build hashes array for server
        let mut hashes: Vec<serde_json::Value> = vec![];
        if let Some(ref h) = fp.email_hash {
            hashes.push(serde_json::json!({ "hash_type": "email", "hash_value": h }));
        }
        if let Some(ref h) = fp.ip_hash {
            hashes.push(serde_json::json!({ "hash_type": "ip", "hash_value": h }));
        }
        if let Some(ref h) = fp.drop_hash {
            hashes.push(serde_json::json!({ "hash_type": "drop", "hash_value": h }));
        }
        if let Some(ref h) = fp.bin {
            hashes.push(serde_json::json!({ "hash_type": "bin", "hash_value": h }));
        }
        if let Some(ref h) = fp.phone_hash {
            hashes.push(serde_json::json!({ "hash_type": "phone", "hash_value": h }));
        }

        if hashes.is_empty() { return vec![]; }

        let body = serde_json::json!({ "shop_domain": domain, "hashes": hashes });

        let resp = ureq::post(&format!("{}/footprint/check", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(5))
            .send_string(&body.to_string());

        match resp {
            Ok(r) => {
                if let Ok(json) = r.into_json::<serde_json::Value>() {
                    let matches = json["matches"].as_array().cloned().unwrap_or_default();
                    if matches.is_empty() { return vec![]; }

                    let mut warnings = vec![];
                    for m in &matches {
                        let hash_type = m["hash_type"].as_str().unwrap_or("unknown");
                        let count = m["count"].as_u64().unwrap_or(1);
                        let severity = if count >= 3 { "high" } else { "warning" };
                        let label = match hash_type {
                            "email" => "Email",
                            "ip"    => "IP address",
                            "drop"  => "Shipping address",
                            "bin"   => "BIN",
                            "phone" => "Phone number",
                            _       => hash_type,
                        };
                        warnings.push(RiskWarning {
                            kind: format!("global_{}", hash_type),
                            severity: severity.into(),
                            message: format!("{} seen {} time(s) at this shop globally", label, count),
                            related_order_id: None,
                            related_order_status: None,
                        });
                    }
                    warnings
                } else {
                    vec![]
                }
            }
            Err(_) => vec![], // offline — graceful degradation
        }
    }

    /// Check latest published version from server.
    /// Returns (version_string, release_notes) or None if offline.
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
