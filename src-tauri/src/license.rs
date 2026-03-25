// src-tauri/src/license.rs
#![allow(unused_imports, unused_variables, dead_code)]

use crate::database::Database;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::OsRng;

const ACTIVATE_URL: &str = "https://api.eulivehub.com/activate";
const VERIFY_URL: &str = "https://api.eulivehub.com/verify";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseStatus {
    NotActivated,
    Active,
    Revoked,
    Offline,
}

#[derive(Debug, Serialize)]
struct ActivateRequest<'a> {
    installation_id: &'a str,
    challenge: &'a str,
    activation_key: &'a str,
}

#[derive(Debug, Deserialize)]
struct ActivateResponse {
    token: String,
}

#[derive(Debug, Serialize)]
struct VerifyRequest {
    token: String,
}

#[derive(Debug, Deserialize)]
struct VerifyResponse {
    valid: bool,
}

// ─────────────────────────────────────────────
// Installation ID
// ─────────────────────────────────────────────

pub fn get_or_create_installation_id(db: &Database) -> Result<String, String> {
    if let Some(id) = db.get_config("installation_id").map_err(|e| e.to_string())? {
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    db.set_config("installation_id", &id).map_err(|e| e.to_string())?;
    Ok(id)
}

// ─────────────────────────────────────────────
// Challenge code  A3F9-BE21-44DC-7720
// ─────────────────────────────────────────────

/// FIX CRY-05: Use full 32 hex characters (128 bits) instead of 16 (64 bits)
/// FIX CRY-06: Add random component to prevent time-based prediction attacks
pub fn format_as_challenge(installation_id: &str) -> String {
    // Use current time component (hour) for time-binding
    let epoch_hour = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() / 3600;

    // FIX CRY-06: Add random nonce to prevent prediction attacks
    // Even if attacker knows the time, they cannot predict the challenge
    let mut random_bytes = [0u8; 8];
    use aes_gcm::aead::rand_core::RngCore;
    OsRng.fill_bytes(&mut random_bytes);

    let mut hasher = Sha256::new();
    hasher.update(installation_id.as_bytes());
    hasher.update(b"|");
    hasher.update(epoch_hour.to_string().as_bytes());
    hasher.update(&random_bytes); // Add randomness to prevent prediction
    let result = hasher.finalize();

    // FIX CRY-05: Use 32 hex characters (128 bits of entropy) instead of 16
    let hex: String = result.iter().map(|b| format!("{:02X}", b)).collect();
    let raw = &hex[..32]; // Full 32 chars = 128 bits
    format!("{}-{}-{}-{}", &raw[0..8], &raw[8..16], &raw[16..24], &raw[24..32])
}

// Convenience wrapper used by `get_challenge_code` command
pub fn get_challenge_code(db: &Database) -> Result<String, String> {
    let id = get_or_create_installation_id(db)?;
    Ok(format_as_challenge(&id))
}

// ─────────────────────────────────────────────
// Activate
// ─────────────────────────────────────────────

pub fn activate(db: &Database, activation_key: &str) -> Result<(), String> {
    let installation_id = get_or_create_installation_id(db)?;
    let challenge = format_as_challenge(&installation_id);

    let body = ActivateRequest {
        installation_id: &installation_id,
        challenge: &challenge,
        activation_key,
    };

    let resp = ureq::post(ACTIVATE_URL)
        .set("Content-Type", "application/json")
        .send_json(serde_json::to_value(&body).map_err(|e| e.to_string())?)
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "invalid_key".to_string(),
            ureq::Error::Status(403, _) => "already_activated".to_string(),
            ureq::Error::Status(code, _) => format!("server_error_{}", code),
            ureq::Error::Transport(_) => "network_error".to_string(),
        })?;

    let activate_resp: ActivateResponse = resp
        .into_json()
        .map_err(|_| "invalid_server_response".to_string())?;

    // Encrypt token if encryption is active; otherwise store plaintext.
    let token_to_store = match &db.encryption {
        Some(enc) => enc.encrypt(&activate_resp.token)
            .map_err(|e| format!("encrypt_error: {}", e))?,
        None => activate_resp.token,
    };

    db.set_config("license_token", &token_to_store).map_err(|e| e.to_string())?;
    db.log_event("system.activated", "License activated", Some("system"), None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ─────────────────────────────────────────────
// Verify at startup
// ─────────────────────────────────────────────

pub fn verify_at_startup(db: &Database) -> Result<LicenseStatus, String> {
    // In debug builds, skip license check entirely
    #[cfg(debug_assertions)]
    {
        let _ = db;
        return Ok(LicenseStatus::Active);
    }

    #[cfg(not(debug_assertions))]
    {
        let raw_token = match db.get_config("license_token").map_err(|e| e.to_string())? {
            Some(t) if !t.is_empty() => t,
            _ => return Ok(LicenseStatus::NotActivated),
        };

        let token = match &db.encryption {
            Some(enc) => enc.decrypt(&raw_token).unwrap_or(raw_token),
            None => raw_token,
        };

        do_verify(token)
    }
}

// Retry variant called from the Settings "Retry Connection" button
pub fn retry_verify(db: &Database) -> Result<LicenseStatus, String> {
    verify_at_startup(db)
}

fn do_verify(token: String) -> Result<LicenseStatus, String> {
    let body = VerifyRequest { token };

    match ureq::post(VERIFY_URL)
        .set("Content-Type", "application/json")
        .send_json(serde_json::to_value(&body).map_err(|e| e.to_string())?)
    {
        Ok(resp) => {
            let verify_resp: VerifyResponse = resp
                .into_json()
                .map_err(|_| "invalid_server_response".to_string())?;

            if verify_resp.valid {
                Ok(LicenseStatus::Active)
            } else {
                Ok(LicenseStatus::Revoked)
            }
        }
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            Ok(LicenseStatus::Revoked)
        }
        Err(ureq::Error::Transport(_)) => Ok(LicenseStatus::Offline),
        Err(e) => {
            eprintln!("[license] verify transport error: {:?}", e);
            Ok(LicenseStatus::Offline)
        }
    }
}
