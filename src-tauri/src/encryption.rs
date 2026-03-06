//! AES-256-GCM field encryption + password-derived key management.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use aes_gcm::aead::rand_core::RngCore;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256};

// ─────────────────────────────────────────
//  FieldEncryption
// ─────────────────────────────────────────

#[derive(Clone)]
pub struct FieldEncryption {
    key: [u8; 32],
}

impl FieldEncryption {
    /// Derive key: SHA-256(password || salt || "cc-manager-field-v2")
    pub fn new(password: &str, salt: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hasher.update(salt);
        hasher.update(b"cc-manager-field-v2");
        let result = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&result);
        Self { key }
    }

    /// Encrypt plaintext → Base64(nonce[12] || ciphertext)
    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let k = Key::<Aes256Gcm>::from_slice(&self.key);
        let cipher = Aes256Gcm::new(k);

        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("encrypt: {e}"))?;

        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(B64.encode(combined))
    }

    /// Decrypt Base64(nonce[12] || ciphertext) → plaintext
    pub fn decrypt(&self, encoded: &str) -> Result<String, String> {
        let data = B64.decode(encoded).map_err(|e| format!("base64: {e}"))?;
        if data.len() < 13 {
            return Err("ciphertext too short".into());
        }
        let (nonce_bytes, ct) = data.split_at(12);
        let k = Key::<Aes256Gcm>::from_slice(&self.key);
        let cipher = Aes256Gcm::new(k);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plain = cipher
            .decrypt(nonce, ct)
            .map_err(|_| "decrypt failed — wrong password or corrupted data".to_string())?;

        String::from_utf8(plain).map_err(|e| format!("utf8: {e}"))
    }

    /// Re-encrypt a field from an old key to self (new key).
    pub fn reencrypt_from(&self, old: &FieldEncryption, encoded: &str) -> Result<String, String> {
        let plain = old.decrypt(encoded)?;
        self.encrypt(&plain)
    }

    pub fn key_bytes(&self) -> &[u8; 32] {
        &self.key
    }
}

// ─────────────────────────────────────────
//  One-way hash for footprints
// ─────────────────────────────────────────

pub fn hash_value(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ─────────────────────────────────────────
//  Password validation
// ─────────────────────────────────────────

pub struct PasswordValidation {
    pub min_length: bool,
    pub has_upper: bool,
    pub has_lower: bool,
    pub has_digit: bool,
}

impl PasswordValidation {
    pub fn check(password: &str) -> Self {
        Self {
            min_length: password.len() >= 12,
            has_upper:  password.chars().any(|c| c.is_uppercase()),
            has_lower:  password.chars().any(|c| c.is_lowercase()),
            has_digit:  password.chars().any(|c| c.is_ascii_digit()),
        }
    }

    pub fn is_valid(&self) -> bool {
        self.min_length && self.has_upper && self.has_lower && self.has_digit
    }

    pub fn error_message(&self) -> Option<String> {
        if self.is_valid() { return None; }
        let mut msgs = Vec::new();
        if !self.min_length { msgs.push("minimum 12 characters"); }
        if !self.has_upper  { msgs.push("uppercase letter required"); }
        if !self.has_lower  { msgs.push("lowercase letter required"); }
        if !self.has_digit  { msgs.push("digit required"); }
        Some(msgs.join(", "))
    }
}

// ─────────────────────────────────────────
//  Random salt generator
// ─────────────────────────────────────────

pub fn generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}
