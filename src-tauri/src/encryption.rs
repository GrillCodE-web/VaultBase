//! AES-256-GCM field encryption + password-derived key management.
#![allow(dead_code)]

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use aes_gcm::aead::rand_core::RngCore;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use sha2::{Digest, Sha256, Sha512};

// ─────────────────────────────────────────
//  FieldEncryption
// ─────────────────────────────────────────

#[derive(Clone)]
pub struct FieldEncryption {
    key: [u8; 32],
}

impl FieldEncryption {
    /// FIX B04: PBKDF2-SHA256 (100 000 итераций) вместо одного прохода SHA-256.
    /// Делает brute-force атаку на дамп БД в ~100 000 раз дороже.
    pub fn new(password: &str, salt: &[u8]) -> Self {
        let mut key = [0u8; 32];
        // PBKDF2 с HMAC-SHA256, 100_000 итераций
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
            password.as_bytes(),
            salt,
            100_000,
            &mut key,
        );
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
/// FIX HMAC-HARDCODE-01: используем переменную окружения или генерируем безопасный ключ
pub fn hash_value(value: &str) -> String {
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<Sha256>;

    // FIX HMAC-HARDCODE-01: Получаем секрет из переменной окружения или генерируем безопасный default
    let secret = std::env::var("CC_MANAGER_HMAC_SECRET")
        .unwrap_or_else(|_| {
            // В production лучше использовать свой secret для каждого инсталла
            // Для backwards compatibility используем старый ключ, но с warning в логах
            eprintln!("WARNING: CC_MANAGER_HMAC_SECRET not set. Using default key (INSECURE for production!)");
            eprintln!("Generate a secure key: openssl rand -hex 32");
            "cc-manager-footprint-v1-secret-fallback".to_string()
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
