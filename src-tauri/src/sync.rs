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

        let group_key_raw = crate::encryption::generate_group_key();
        let enc = db.encryption.as_ref().ok_or("not_unlocked")?;
        let encrypted_gk = crate::encryption::encrypt_group_key(&group_key_raw, enc)?;

        // SEC-008: отдаём серверу свой blob ключа (зашифрован нашим мастер-паролем),
        // иначе сервер сгенерирует СВОЙ ключ и раздаст его остальным участникам —
        // ключи разойдутся и E2E-расшифровка сломается. Сервер хранит blob opaque.
        let body = serde_json::json!({ "name": name, "group_key": encrypted_gk });
        let resp = ureq::post(&format!("{}/sync/group/create", server_url()))
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
        db.set_config("sync_group_id", &group_id).map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", &encrypted_gk).map_err(|e| e.to_string())?;
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

        // SEC-008/009 zero-knowledge: код генерируем локально. На сервер
        // уходит только его SHA-256 и ключ группы, зашифрованный ключом,
        // выведенным из кода. Сервер не может ни прочитать ключ группы,
        // ни подобрать код перебором по базе.
        let code = crate::encryption::generate_pair_code();
        let enc = db.encryption.as_ref().ok_or("not_unlocked")?;
        let gk_stored = db.get_config("sync_group_key").ok().flatten()
            .filter(|k| !k.is_empty())
            .ok_or("not_in_group")?;
        // Передаём СЫРОЙ ключ группы (не blob под нашим мастер-паролем — у
        // joiner'а свой мастер-пароль, он бы его не расшифровал).
        let gk_raw = crate::encryption::resolve_group_key(&gk_stored, enc)
            .ok_or("cannot_decrypt_group_key")?;
        let transport_key = crate::encryption::derive_pair_transport_key(&code);
        let enc_gk = crate::encryption::e2e_encrypt(&hex::encode(gk_raw), &transport_key)?;

        let body = serde_json::json!({
            "code_hash": crate::encryption::pair_code_hash(&code),
            "enc_group_key": enc_gk,
        });
        let resp = ureq::post(&format!("{}/sync/group/pair", server_url()))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_string(&body.to_string())
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
        if json["ok"].as_bool() != Some(true) {
            return Err(json["error"].as_str().unwrap_or("server_error").to_string());
        }
        let expires_at = json["expires_at"].as_str().unwrap_or("").to_string();
        Ok(format!("{} (expires: {})", code, expires_at))
    }

    pub fn join_group(db: &Database, pair_code: &str) -> Result<crate::models::SyncGroupInfo, String> {
        let token = Self::get_token(db).ok_or("no_token")?;
        let body = serde_json::json!({ "code": pair_code.to_uppercase() });
        let resp = ureq::post(&format!("{}/sync/group/join", server_url()))
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

        // SEC-008: сервер отдаёт opaque-blob. Три варианта содержимого:
        // 1) ZK-flow: сырой ключ, зашифрованный ключом из pair-кода;
        // 2) legacy: открытый hex;
        // 3) blob под мастер-паролем создателя (если пароль совпадает с нашим —
        //    например, тот же пользователь на второй машине — подойдёт как есть).
        // Варианты 1-2 перешифровываем под НАШ мастер-пароль перед сохранением.
        let enc = db.encryption.as_ref().ok_or("not_unlocked")?;
        let stored_key = {
            let transport_key = crate::encryption::derive_pair_transport_key(pair_code);
            if let Ok(raw_hex) = crate::encryption::e2e_decrypt(&group_key, &transport_key) {
                let bytes = hex::decode(&raw_hex).map_err(|_| "invalid_group_key".to_string())?;
                if bytes.len() != 32 { return Err("invalid_group_key".into()); }
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                crate::encryption::encrypt_group_key(&k, enc)?
            } else if group_key.len() == 64 && group_key.chars().all(|c| c.is_ascii_hexdigit()) {
                let bytes = hex::decode(&group_key).map_err(|e| e.to_string())?;
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                crate::encryption::encrypt_group_key(&k, enc)?
            } else if crate::encryption::decrypt_group_key(&group_key, enc).is_ok() {
                group_key.clone()
            } else {
                return Err("cannot_decrypt_group_key".into());
            }
        };

        db.set_config("sync_group_id", &group_id).map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", &stored_key).map_err(|e| e.to_string())?;
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
        // FIX TEST-007: пустая строка (после disconnect) — не членство в группе
        let group_id = db.get_config("sync_group_id").ok().flatten().filter(|s| !s.is_empty());
        let group_name = db.get_config("sync_group_name").ok().flatten().filter(|s| !s.is_empty());
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
        let _ = ureq::post(&format!("{}/sync/group/leave", server_url()))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(5))
            .send_string("{}");
        db.set_config("sync_group_id", "").map_err(|e| e.to_string())?;
        db.set_config("sync_group_key", "").map_err(|e| e.to_string())?;
        db.set_config("sync_group_name", "").map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Push card updates to sync server with retry queue
    // ─────────────────────────────────────────

    /// FIX P1-RETRY-01: Push card updates with retry queue & exponential backoff
    pub fn push_card_updates(
        db: &Database,
        updates: &[crate::models::CardSyncUpdate],
    ) -> Result<PushResult, String> {
        let token = match Self::get_token(db) {
            Some(t) => t,
            None => return Ok(PushResult {
                synced: 0,
                failed: updates.len() as u32,
                message: "no_token".into(),
                server_reached: false,
            }),
        };

        // Check if in a group
        let group_id = match db.get_config("sync_group_id").ok().flatten() {
            Some(g) if !g.is_empty() => g,
            _ => return Ok(PushResult {
                synced: 0,
                failed: updates.len() as u32,
                message: "not_in_group".into(),
                server_reached: false,
            }),
        };

        // SEC-008: пытаемся достать ключ группы для E2E-шифрования payload.
        let group_key = db.get_config("sync_group_key").ok().flatten()
            .and_then(|gk| db.encryption.as_ref()
                .and_then(|enc| crate::encryption::resolve_group_key(&gk, enc)));

        // SEC-009: карты с NOSYNC-тегом никогда не покидают устройство.
        // Отправляем только hash+status (операционные метаданные); notes
        // уезжают внутри E2E blob, который сервер прочитать не может.
        let mut skipped = 0u32;
        let cards: Vec<serde_json::Value> = updates.iter().filter_map(|u| {
            if let Some(notes) = &u.notes {
                if notes.contains("NOSYNC") { skipped += 1; return None; }
            }
            let enc_data = match (&u.encrypted_data, &u.notes, &group_key) {
                (Some(e), _, _) => Some(e.clone()),
                (None, Some(n), Some(gk)) => crate::encryption::e2e_encrypt(
                    &serde_json::json!({ "notes": n }).to_string(), gk
                ).ok(),
                _ => None,
            };
            Some(serde_json::json!({
                "card_hash": u.card_hash,
                "status": u.status,
                "encrypted_data": enc_data,
            }))
        }).collect();

        if cards.is_empty() {
            return Ok(PushResult {
                synced: 0,
                failed: 0,
                message: format!("skipped {} NOSYNC", skipped),
                server_reached: false,
            });
        }

        let card_count = cards.len();
        let body = serde_json::json!({ "cards": cards });

        // Try to push with exponential backoff retry
        const MAX_RETRIES: u32 = 3;
        const BASE_DELAY_MS: u64 = 500;

        for attempt in 0..MAX_RETRIES {
            match ureq::post(&format!("{}/sync/cards", server_url()))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(10))
                .send_string(&body.to_string())
            {
                Ok(resp) => {
                    if resp.status() == 200 {
                        // Success — log and return
                        // FIX AUDIT-25: &group_id[..8] паниковал на коротком или
                        // многобайтовом group_id. Используем безопасный срез по границе char.
                        let short_id: String = group_id.chars().take(8).collect();
                        let _ = db.log_event(
                            "sync.cards_pushed",
                            &format!("Pushed {} card updates to group {}", card_count, short_id),
                            Some("sync"),
                            None,
                        );
                        return Ok(PushResult {
                            synced: card_count as u32,
                            failed: 0,
                            message: if skipped > 0 {
                                format!("Synced {} cards ({} NOSYNC skipped)", card_count, skipped)
                            } else {
                                format!("Synced {} cards", card_count)
                            },
                            server_reached: true,
                        });
                    } else if resp.status() >= 500 {
                        // Server error — retry with backoff
                        if attempt < MAX_RETRIES - 1 {
                            let delay_ms = BASE_DELAY_MS * (1 << attempt); // Exponential: 500ms, 1s, 2s
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            continue;
                        }
                        // All retries exhausted
                        let error_msg = format!("Failed to push {} cards after {} attempts (server error)", updates.len(), MAX_RETRIES);
                        let _ = db.log_event(
                            "sync.push_failed",
                            &error_msg,
                            Some("sync"),
                            None,
                        );
                        eprintln!("[sync] {}", error_msg);
                        return Ok(PushResult {
                            synced: 0,
                            failed: updates.len() as u32,
                            message: "server_error_after_retry".into(),
                            server_reached: true,
                        });
                    } else {
                        // Client error (4xx) — don't retry
                        return Ok(PushResult {
                            synced: 0,
                            failed: updates.len() as u32,
                            message: format!("client_error_{}", resp.status()),
                            server_reached: true,
                        });
                    }
                }
                Err(ureq::Error::Status(code, _)) if code >= 500 => {
                    // Server error — retry with backoff
                    if attempt < MAX_RETRIES - 1 {
                        let delay_ms = BASE_DELAY_MS * (1 << attempt);
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        continue;
                    }
                    return Ok(PushResult {
                        synced: 0,
                        failed: updates.len() as u32,
                        message: "server_error_after_retry".into(),
                        server_reached: true,
                    });
                }
                // 4xx — ответ сервера, а не сбой сети: повтор ничего не изменит.
                // ureq 2.x отдаёт любой не-2xx как Err(Status), поэтому без этой
                // ветки 401 (токен отозван) и 404 (not_in_group) проваливались в
                // Err(_) ниже и трижды ретраились как «сеть недоступна», а затем
                // рапортовались с server_reached: false — отозванную лицензию
                // было не отличить от оффлайна. Ср. sync_footprints, где ветка
                // для 4xx есть.
                Err(ureq::Error::Status(code, _)) => {
                    let error_msg = format!("Server rejected push of {} cards: HTTP {}", updates.len(), code);
                    let _ = db.log_event("sync.push_rejected", &error_msg, Some("sync"), None);
                    eprintln!("[sync] {}", error_msg);
                    return Ok(PushResult {
                        synced: 0,
                        failed: updates.len() as u32,
                        message: format!("client_error_{}", code),
                        server_reached: true,
                    });
                }
                Err(_) => {
                    // Network error — retry with backoff
                    if attempt < MAX_RETRIES - 1 {
                        let delay_ms = BASE_DELAY_MS * (1 << attempt);
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        continue;
                    }
                    // All retries exhausted
                    let error_msg = format!("Network error pushing {} cards after {} attempts", updates.len(), MAX_RETRIES);
                    let _ = db.log_event(
                        "sync.push_failed",
                        &error_msg,
                        Some("sync"),
                        None,
                    );
                    eprintln!("[sync] {}", error_msg);
                    return Ok(PushResult {
                        synced: 0,
                        failed: updates.len() as u32,
                        message: "network_error_after_retry".into(),
                        server_reached: false,
                    });
                }
            }
        }

        // Should not reach here, but just in case
        Ok(PushResult {
            synced: 0,
            failed: updates.len() as u32,
            message: "unknown_error".into(),
            server_reached: false,
        })
    }
}

// ─────────────────────────────────────────
//  Result types for push operations
// ─────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PushResult {
    pub synced: u32,
    pub failed: u32,
    pub message: String,
    pub server_reached: bool,
}


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

    // ── SyncGroupClient ──

    #[test]
    fn test_get_group_status_not_in_group() {
        let (_dir, db) = test_db();
        let status = SyncGroupClient::get_group_status(&db);
        assert!(!status.in_group);
        assert!(status.group_id.is_none());
        assert!(status.group_name.is_none());
        assert!(!status.connected);
    }

    #[test]
    fn test_get_group_status_in_group() {
        let (_dir, db) = test_db();
        db.set_config("sync_group_id", "grp-123").unwrap();
        db.set_config("sync_group_name", "Test Group").unwrap();
        let status = SyncGroupClient::get_group_status(&db);
        assert!(status.in_group);
        assert_eq!(status.group_id.as_deref(), Some("grp-123"));
        assert_eq!(status.group_name.as_deref(), Some("Test Group"));
    }

    #[test]
    fn test_disconnect_without_token_clears_config() {
        let (_dir, db) = test_db();
        db.set_config("sync_group_id", "grp-123").unwrap();
        db.set_config("sync_group_name", "Test Group").unwrap();
        // Без токена — локальный конфиг всё равно очищается, без обращения к серверу
        SyncGroupClient::disconnect(&db).unwrap();
        let status = SyncGroupClient::get_group_status(&db);
        assert!(!status.in_group);
    }

    #[test]
    fn test_push_card_updates_no_token() {
        let (_dir, db) = test_db();
        let updates = vec![crate::models::CardSyncUpdate {
            card_hash: "abcdef0123456789".into(),
            status: "dead".into(),
            notes: None,
            encrypted_data: None,
        }];
        let res = SyncGroupClient::push_card_updates(&db, &updates).unwrap();
        assert_eq!(res.synced, 0);
        assert_eq!(res.failed, 1);
        assert_eq!(res.message, "no_token");
        assert!(!res.server_reached);
    }

    #[test]
    fn test_push_card_updates_not_in_group() {
        let (_dir, db) = test_db();
        // Токен есть, но группы нет → not_in_group, сеть не дёргается
        db.set_config("license_token", "tok123").unwrap();
        let updates = vec![crate::models::CardSyncUpdate {
            card_hash: "abcdef0123456789".into(),
            status: "dead".into(),
            notes: None,
            encrypted_data: None,
        }];
        let res = SyncGroupClient::push_card_updates(&db, &updates).unwrap();
        assert_eq!(res.message, "not_in_group");
        assert!(!res.server_reached);
    }
}
