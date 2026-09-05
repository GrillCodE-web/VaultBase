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
    pub(crate) key: [u8; 32],
}

impl FieldEncryption {
    /// PBKDF2-SHA256 with iterations from constants (OWASP high-security).
    /// Makes brute-force attacks on database dumps computationally prohibitive.
    /// Password bytes are zeroed after key derivation.
    pub fn new(password: &str, salt: &[u8]) -> Self {
        let mut key = [0u8; 32];

        let mut password_bytes = password.as_bytes().to_vec();

        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
            &password_bytes,
            salt,
            crate::constants::PBKDF2_ITERATIONS,
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

/// HMAC-SHA256 с явным ключом (32 байта).
/// Ключ деривируется из DEK (мастер-пароля) через FieldEncryption::derive_hmac_key().
/// Никаких env-переменных, никаких panic в production.
pub fn hash_value_with_key(value: &str, key: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    type HmacSha256 = Hmac<sha2::Sha256>;

    // FIX CRITICAL: Graceful error handling instead of panic
    let mut mac = match <HmacSha256 as Mac>::new_from_slice(key) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("❌ ОШИБКА: Неверная длина HMAC ключа");
            eprintln!("   Ожидается: 32 байта, получено: {}", key.len());
            eprintln!("   Ошибка: {:?}", e);
            // Fallback: использовать пустой хеш (лучше чем паника)
            return format!("{:0>64}", "");
        }
    };
    mac.update(value.as_bytes());
    format!("{:x}", mac.finalize().into_bytes())
}

impl FieldEncryption {
    /// Деривирует подключ для HMAC footprints из DEK.
    /// Уникален для каждой установки (т.к. DEK уникален), не требует env-переменной.
    pub fn derive_hmac_key(&self) -> [u8; 32] {
        use sha2::{Sha256, Digest};
        let mut h = Sha256::new();
        h.update(b"vaultbase-footprint-hmac-v2:");
        h.update(self.key);
        h.finalize().into()
    }
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
            exceeds_bcrypt_limit: password.len() > 72,
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

// ─────────────────────────────────────────
//  SEC-001: Database Encryption Key (DEK) derivation
// ─────────────────────────────────────────

/// Derives a separate 32-byte key for SQLCipher database-level encryption.
/// Uses a different domain separator from FieldEncryption so the two keys
/// are cryptographically independent even though both come from the master password.
pub fn derive_db_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    let mut password_bytes = password.as_bytes().to_vec();

    let mut db_salt = Vec::with_capacity(salt.len() + 16);
    db_salt.extend_from_slice(b"vaultbase-dek-v1");
    db_salt.extend_from_slice(salt);

    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(
        &password_bytes,
        &db_salt,
        crate::constants::PBKDF2_ITERATIONS,
        &mut key,
    );

    password_bytes.zeroize();
    key
}

// ─────────────────────────────────────────
//  Random 32-byte key generation
// ─────────────────────────────────────────

/// Generates a random 32-byte key. MGR-018 (этап E1): групповой E2E-sync
/// выпилен вместе с encrypt/decrypt/resolve_group_key и pair-кодами —
/// функция остаётся источником DEK для envelope-шифрования БД (SEC-005,
/// commands/auth.rs) и ключевого материала тестов.
pub fn generate_group_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

/// SEC-005: Wrap a random DB encryption key (DEK) with a password-derived KEK
/// (PBKDF2-SHA256). Envelope scheme: the DEK is random and never changes on
/// password change — only the sidecar wrap is rewritten. This makes master
/// password change atomic and crash-safe (no PRAGMA rekey, no brick window).
pub fn wrap_dek(dek: &[u8; 32], password: &str, salt: &[u8]) -> Result<String, String> {
    let kek = FieldEncryption::new(password, salt);
    kek.encrypt(&hex::encode(dek))
}

/// SEC-005: Unwrap the DEK from the sidecar blob with the password-derived KEK.
pub fn unwrap_dek(blob: &str, password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let kek = FieldEncryption::new(password, salt);
    let hex_str = kek.decrypt(blob)?;
    let bytes = hex::decode(hex_str).map_err(|e| e.to_string())?;
    if bytes.len() != 32 { return Err("invalid dek length".into()); }
    let mut k = [0u8; 32];
    k.copy_from_slice(&bytes);
    Ok(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrap_unwrap_dek_roundtrip() {
        let dek = generate_group_key();
        let salt = generate_salt();
        let blob = wrap_dek(&dek, "correct horse battery staple", &salt).unwrap();
        let back = unwrap_dek(&blob, "correct horse battery staple", &salt).unwrap();
        assert_eq!(dek, back);
    }

    #[test]
    fn test_unwrap_dek_wrong_password_fails() {
        let dek = generate_group_key();
        let salt = generate_salt();
        let blob = wrap_dek(&dek, "right", &salt).unwrap();
        assert!(unwrap_dek(&blob, "wrong", &salt).is_err());
    }

    // ── TEST-008: edge cases ──

    fn test_enc() -> FieldEncryption {
        FieldEncryption::new("pw123456789012", &generate_salt())
    }

    #[test]
    fn test_encrypt_decrypt_empty_string() {
        let enc = test_enc();
        let blob = enc.encrypt("").unwrap();
        assert_eq!(enc.decrypt(&blob).unwrap(), "");
    }

    #[test]
    fn test_encrypt_unique_nonces() {
        // Один и тот же plaintext дважды → разный шифротекст (случайный nonce)
        let enc = test_enc();
        let a = enc.encrypt("same plaintext").unwrap();
        let b = enc.encrypt("same plaintext").unwrap();
        assert_ne!(a, b);
        assert_eq!(enc.decrypt(&a).unwrap(), "same plaintext");
        assert_eq!(enc.decrypt(&b).unwrap(), "same plaintext");
    }

    #[test]
    fn test_decrypt_invalid_base64() {
        let enc = test_enc();
        assert!(enc.decrypt("!!!not-base64!!!").is_err());
        assert!(enc.decrypt("").is_err());
    }

    #[test]
    fn test_decrypt_too_short_ciphertext() {
        // Валидный base64, но < 13 байт (nonce[12] + минимум 1 байт)
        let enc = test_enc();
        let short = B64.encode([0u8; 12]);
        let err = enc.decrypt(&short).unwrap_err();
        assert!(err.contains("too short"), "got: {err}");
    }

    #[test]
    fn test_decrypt_corrupted_ciphertext() {
        let enc = test_enc();
        let blob = enc.encrypt("sensitive data").unwrap();
        let mut raw = B64.decode(&blob).unwrap();
        // Портим байт в середине ciphertext (после nonce)
        let idx = raw.len() - 1;
        raw[idx] ^= 0xFF;
        let corrupted = B64.encode(raw);
        let err = enc.decrypt(&corrupted).unwrap_err();
        assert!(err.contains("decrypt failed"), "got: {err}");
    }

    #[test]
    fn test_decrypt_truncated_ciphertext() {
        let enc = test_enc();
        let blob = enc.encrypt("sensitive data").unwrap();
        let raw = B64.decode(&blob).unwrap();
        let truncated = B64.encode(&raw[..raw.len() - 5]);
        assert!(enc.decrypt(&truncated).is_err());
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let enc1 = test_enc();
        let enc2 = test_enc(); // другой salt → другой ключ
        let blob = enc1.encrypt("secret").unwrap();
        assert!(enc2.decrypt(&blob).is_err());
    }

    #[test]
    fn test_decrypt_non_utf8_ciphertext() {
        // Шифруем сырые байты, не являющиеся UTF-8, напрямую через cipher
        let enc = test_enc();
        let k = Key::<Aes256Gcm>::from_slice(enc.key_bytes());
        let cipher = Aes256Gcm::new(k);
        let nonce_bytes = [7u8; 12];
        let nonce = Nonce::from_slice(&nonce_bytes);
        let bad_utf8 = vec![0xFF, 0xFE, 0xFD, 0x80];
        let ct = cipher.encrypt(nonce, bad_utf8.as_slice()).unwrap();
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ct);
        let blob = B64.encode(combined);
        let err = enc.decrypt(&blob).unwrap_err();
        assert!(err.contains("utf8"), "got: {err}");
    }

    #[test]
    fn test_unicode_roundtrip() {
        let enc = test_enc();
        let s = "Карта №4111 — держатель: Иван Иванов 💳";
        let blob = enc.encrypt(s).unwrap();
        assert_eq!(enc.decrypt(&blob).unwrap(), s);
    }

    #[test]
    fn test_password_validation_edge_cases() {
        assert!(!PasswordValidation::check("").is_valid());
        assert!(!PasswordValidation::check("Short1!").is_valid()); // < 12
        assert!(!PasswordValidation::check("alllowercase1!").is_valid());
        assert!(!PasswordValidation::check("ALLUPPERCASE1!").is_valid());
        assert!(!PasswordValidation::check("NoDigitsHere!!").is_valid());
        assert!(!PasswordValidation::check("NoSpecialChar123").is_valid());
        // 73 ASCII-байта → превышен bcrypt-лимит
        let long = format!("{}A1!", "a".repeat(70));
        let v = PasswordValidation::check(&long);
        assert!(v.exceeds_bcrypt_limit);
        assert!(!v.is_valid());
        assert!(PasswordValidation::check("ValidPass123!").is_valid());
    }
}
