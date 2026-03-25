//! AES-256-GCM field encryption + password-derived key management.
#![allow(dead_code)]

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use aes_gcm::aead::rand_core::RngCore;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256, Sha512};
use zeroize::{Zeroize, ZeroizeOnDrop};

// ─────────────────────────────────────────
//  FieldEncryption
// ─────────────────────────────────────────

/// FIX CRY-02: Added ZeroizeOnDrop to ensure encryption keys are wiped from memory on drop
#[derive(Clone, ZeroizeOnDrop)]
pub struct FieldEncryption {
    key: [u8; 32],
}

impl FieldEncryption {
    /// FIX CRY-01: PBKDF2-SHA256 with 600,000 iterations (OWASP recommendation for 2026).
    /// Makes brute-force attacks on database dumps computationally prohibitive.
    /// FIX CRY-03: Password bytes are zeroed after key derivation
    pub fn new(password: &str, salt: &[u8]) -> Self {
        let mut key = [0u8; 32];

        // Convert password to bytes for zeroing after use
        let mut password_bytes = password.as_bytes().to_vec();

        // PBKDF2 с HMAC-SHA256, 600_000 итераций (OWASP 2026 recommendation)
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
            &password_bytes,
            salt,
            600_000,
            &mut key,
        );

        // Zero out password bytes after key derivation
        password_bytes.zeroize();

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

/// FIX B36: используем HMAC-SHA256 с application secret вместо чистого SHA-256.
/// Делает rainbow-table атаку на хранимые хеши нецелесообразной.
/// FIX CRY-04/MED-03: Secure HMAC secret handling with no weak fallbacks
pub fn hash_value(value: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;

    // FIX CRY-04/MED-03: Get secret from environment variable
    // NO fallback to installation_id — each installation must have unique secret
    let secret = std::env::var("CC_MANAGER_HMAC_SECRET")
        .unwrap_or_else(|_| {
            // In production, panic to force proper configuration
            if !cfg!(debug_assertions) {
                panic!(
                    "CRITICAL: CC_MANAGER_HMAC_SECRET environment variable is not set. \
                     This is a critical security requirement for production deployments. \
                     Generate with: openssl rand -hex 32"
                );
            }

            // In development only: generate a random key for this session
            // This prevents rainbow tables while allowing dev without manual setup
            eprintln!("[dev] CC_MANAGER_HMAC_SECRET not set. Generating random session key.");
            eprintln!("[dev] Add CC_MANAGER_HMAC_SECRET=$(openssl rand -hex 32) to .env for persistence.");

            // Generate 32 random bytes for this session only
            use rand::RngCore;
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let hash = Sha256::new_with_prefix(key);
            format!("{:x}", hash.finalize())
        });

    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes())
        .expect("HMAC key init");
    mac.update(value.as_bytes());
    format!("{:x}", mac.finalize().into_bytes())
}

// ─────────────────────────────────────────
//  Password validation
// ─────────────────────────────────────────

pub struct PasswordValidation {
    pub min_length: bool,
    pub has_upper: bool,
    pub has_lower: bool,
    pub has_digit: bool,
    // FIX B39: добавлена проверка спецсимволов
    pub has_special: bool,
    // FIX B38: предупреждение о bcrypt 72-байт лимите
    pub exceeds_bcrypt_limit: bool,
}

impl PasswordValidation {
    pub fn check(password: &str) -> Self {
        Self {
            min_length: password.len() >= 12,
            has_upper:  password.chars().any(|c| c.is_uppercase()),
            has_lower:  password.chars().any(|c| c.is_lowercase()),
            has_digit:  password.chars().any(|c| c.is_ascii_digit()),
            // FIX B39: требуем хотя бы один спецсимвол
            has_special: password.chars().any(|c| !c.is_alphanumeric()),
            // FIX B38: bcrypt обрезает пароли > 72 байт
            exceeds_bcrypt_limit: password.as_bytes().len() > 72,
        }
    }

    pub fn is_valid(&self) -> bool {
        self.min_length && self.has_upper && self.has_lower && self.has_digit && self.has_special
            && !self.exceeds_bcrypt_limit
    }

    pub fn error_message(&self) -> Option<String> {
        if self.is_valid() { return None; }
        let mut msgs = Vec::new();
        if !self.min_length  { msgs.push("minimum 12 characters"); }
        if !self.has_upper   { msgs.push("uppercase letter required"); }
        if !self.has_lower   { msgs.push("lowercase letter required"); }
        if !self.has_digit   { msgs.push("digit required"); }
        if !self.has_special { msgs.push("special character required (!@#$%^&* etc.)"); }
        if self.exceeds_bcrypt_limit { msgs.push("password too long (max 72 bytes for bcrypt)"); }
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
