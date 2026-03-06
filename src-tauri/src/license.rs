//! License validation stub.

use crate::models::LicenseStatus;

pub fn get_installation_id() -> String {
    // TODO: derive from machine UUID / hardware ID
    "INSTALL-0000-0000-0000-000000000000".to_string()
}

pub fn activate_license(_key: &str) -> Result<(), String> {
    Err("not_implemented".into())
}

pub fn get_license_status() -> Result<LicenseStatus, String> {
    Ok(LicenseStatus {
        is_active: false,
        license_key: None,
        expires_at: None,
        plan: None,
        installation_id: get_installation_id(),
    })
}
