// src-tauri/src/license.rs

use crate::database::Database;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    if let Some(id) = db.get_config("installation_id")? {
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    db.set_config("installation_id", &id)?;
    Ok(id)
}

// ─────────────────────────────────────────────
// Challenge code  A3F9-BE21-44DC-7720
// ─────────────────────────────────────────────

pub fn format_as_challenge(installation_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(installation_id.as_bytes());
    let result = hasher.finalize();
    let hex: String = result.iter().map(|b| format!("{:02X}", b)).collect();
    let raw = &hex[..16];
    format!("{}-{}-{}-{}", &raw[0..4], &raw[4..8], &raw[8..12], &raw[12..16])
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
    // (Will be re-encrypted automatically if user later sets up a password.)
    let token_to_store = match db.encryption() {
        Some(enc) => enc.encrypt(&activate_resp.token)
            .map_err(|e| format!("encrypt_error: {}", e))?,
        None => activate_resp.token,
    };

    db.set_config("license_token", &token_to_store)?;
    db.log_event("system.activated", None, None)?;

    Ok(())
}

// ─────────────────────────────────────────────
// Verify at startup
// ─────────────────────────────────────────────

pub fn verify_at_startup(db: &Database) -> Result<LicenseStatus, String> {
    let raw_token = match db.get_config("license_token")? {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(LicenseStatus::NotActivated),
    };

    // Decrypt if encryption key is loaded
    let token = match db.encryption() {
        Some(enc) => enc.decrypt(&raw_token).unwrap_or(raw_token),
        None => raw_token,
    };

    do_verify(token)
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
