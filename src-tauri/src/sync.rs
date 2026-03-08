//! Offline queue and footprint sync with cc-sync-server.
#![allow(dead_code, unused_variables)]

use crate::database::Database;
use crate::models::{Footprint, RiskWarning, SyncResult};

const SERVER_URL: &str = "https://api.eulivehub.com";

pub struct SyncClient;

impl SyncClient {
    /// Quick TCP-level check if server is reachable.
    pub fn check_server_online() -> bool {
        ureq::get(&format!("{}/health", SERVER_URL))
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .map(|_| true)
            .unwrap_or_else(|e| matches!(e, ureq::Error::Status(_, _)))
    }

    /// Send unsynced footprints to server in batches of 100.
    pub fn sync_footprints(db: &mut Database) -> Result<SyncResult, String> {
        let token = match db.get_config("license_token").map_err(|e| e.to_string())? {
            Some(t) if !t.is_empty() => {
                // Decrypt if enc is available
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

        let mut total_synced = 0u32;
        let mut total_failed = 0u32;
        let mut server_reached = false;

        for chunk in footprints.chunks(100) {
            let ids: Vec<i64> = chunk.iter().map(|f| f.id).collect();
            let body = serde_json::json!({ "footprints": chunk });

            match ureq::post(&format!("{}/footprint", SERVER_URL))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .send_string(&body.to_string())
            {
                Ok(_) => {
                    server_reached = true;
                    let _ = db.mark_footprints_synced_db(&ids);
                    total_synced += ids.len() as u32;
                }
                Err(ureq::Error::Status(_, _)) => {
                    // Got an HTTP response (server is up, but returned an error)
                    server_reached = true;
                    total_failed += ids.len() as u32;
                }
                Err(_) => {
                    // Connection error — server unreachable
                    total_failed += ids.len() as u32;
                }
            }
        }

        let msg = format!("Synced {} footprints", total_synced);
        if total_synced > 0 {
            let _ = db.log_event("sync.footprints_sent", &msg, Some("sync"), None);
        }

        Ok(SyncResult { synced: total_synced, failed: total_failed, message: msg, server_reached })
    }

    /// Check global footprint collision risk for a profile+shop combo.
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

        let body = serde_json::json!({
            "shop_id": shop_id,
            "email_hash":  fp.email_hash,
            "ip_hash":     fp.ip_hash,
            "drop_hash":   fp.drop_hash,
            "bin":         fp.bin,
            "phone_hash":  fp.phone_hash,
        });

        let resp = ureq::post(&format!("{}/check", SERVER_URL))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(5))
            .send_string(&body.to_string());

        match resp {
            Ok(r) => {
                if let Ok(json) = r.into_json::<serde_json::Value>() {
                    let hits = json["hits"].as_u64().unwrap_or(0);
                    if hits > 0 {
                        return vec![RiskWarning {
                            kind: "global_footprint".into(),
                            severity: if hits >= 3 { "high" } else { "warning" }.into(),
                            message: format!("Footprint seen {} time(s) globally at this shop", hits),
                            related_order_id: None,
                            related_order_status: None,
                        }];
                    }
                }
                vec![]
            }
            Err(_) => vec![], // offline — graceful degradation
        }
    }
}
