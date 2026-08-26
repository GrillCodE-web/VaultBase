use aes_gcm::aead::rand_core::OsRng;
use aes_gcm::aead::rand_core::RngCore;
use sha2::{Digest, Sha256};

pub fn generate_installation_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    format!("MGR-{}", hex::encode(bytes))
}

pub fn generate_challenge() -> String {
    let epoch_hour = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 3600;

    let mut random_bytes = [0u8; 8];
    OsRng.fill_bytes(&mut random_bytes);

    let mut hasher = Sha256::new();
    hasher.update(b"vaultbase-manager|");
    hasher.update(epoch_hour.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(&random_bytes);
    let result = hasher.finalize();
    let hex: String = result.iter().map(|b| format!("{:02X}", b)).collect();
    hex[..32].to_string()
}

pub struct ActivationResult {
    pub token: String,
    pub role: String,
}

pub fn activate(base: &str, installation_id: &str, challenge: &str, activation_key: &str) -> Result<ActivationResult, String> {
    let body = serde_json::json!({
        "installation_id": installation_id,
        "challenge": challenge,
        "activation_key": activation_key,
    })
    .to_string();

    let resp = crate::http::request(base, "POST", "/activate", None, Some(&body))?;
    if resp.status != 200 {
        let err = serde_json::from_str::<serde_json::Value>(&resp.body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("http_{}", resp.status));
        return Err(err);
    }

    let parsed: serde_json::Value = serde_json::from_str(&resp.body).map_err(|e| format!("parse: {e}"))?;
    let token = parsed
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("missing_token")?
        .to_string();
    let role = parsed
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("manager")
        .to_string();
    Ok(ActivationResult { token, role })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_32_uppercase_hex() {
        let c = generate_challenge();
        assert_eq!(c.len(), 32);
        assert!(c.chars().all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_lowercase()));
    }

    #[test]
    fn installation_id_prefixed() {
        let iid = generate_installation_id();
        assert!(iid.starts_with("MGR-"));
        assert_eq!(iid.len(), 36);
    }
}
