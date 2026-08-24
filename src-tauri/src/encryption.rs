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
        h.update(&self.key);
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
//  SEC-008: Group encryption key for E2E sync
// ─────────────────────────────────────────

/// Generates a random 32-byte group master key for E2E sync encryption.
pub fn generate_group_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

/// Encrypts a group key with a user's DEK so it can be stored on the server.
/// Returns Base64(nonce[12] || ciphertext).
pub fn encrypt_group_key(group_key: &[u8; 32], user_field_enc: &FieldEncryption) -> Result<String, String> {
    user_field_enc.encrypt(&hex::encode(group_key))
}

/// Decrypts a group key that was encrypted with encrypt_group_key().
pub fn decrypt_group_key(encrypted: &str, user_field_enc: &FieldEncryption) -> Result<[u8; 32], String> {
    let hex_str = user_field_enc.decrypt(encrypted)?;
    let bytes = hex::decode(&hex_str).map_err(|e| format!("hex decode: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("invalid group key length: {}", bytes.len()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// E2E encrypt a sync payload with the group key.
pub fn e2e_encrypt(payload: &str, group_key: &[u8; 32]) -> Result<String, String> {
    let enc = FieldEncryption { key: *group_key };
    enc.encrypt(payload)
}

/// E2E decrypt a sync payload with the group key.
pub fn e2e_decrypt(encrypted: &str, group_key: &[u8; 32]) -> Result<String, String> {
    let enc = FieldEncryption { key: *group_key };
    enc.decrypt(encrypted)
}

/// SEC-008/009: Generate a pair code locally (6 chars, unambiguous alphabet —
/// same charset the sync server used historically). The server never sees the
/// code itself, only its SHA-256 hash.
pub fn generate_pair_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 6];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char).collect()
}

/// SEC-008/009: Derive the transport key for group-key handover from a pair
/// code. The joiner re-derives the same key from the typed code, so the group
/// key crosses the server only as an E2E blob (PBKDF2-SHA256, 100k rounds).
pub fn derive_pair_transport_key(code: &str) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(
        code.trim().to_uppercase().as_bytes(),
        b"vaultbase-gk-transport-v1",
        100_000,
        &mut key,
    );
    key
}

/// SEC-008/009: SHA-256 hex of a normalized pair code — the only code-related
/// value the sync server is allowed to store.
pub fn pair_code_hash(code: &str) -> String {
    hex::encode(Sha256::digest(code.trim().to_uppercase().as_bytes()))
}

/// SEC-008: Resolve the raw group key from its stored representation:
/// FieldEncryption blob (current) or raw 64-char hex (legacy groups).
pub fn resolve_group_key(stored: &str, enc: &FieldEncryption) -> Option<[u8; 32]> {
    if stored.is_empty() {
        return None;
    }
    if stored.len() == 64 && stored.chars().all(|c| c.is_ascii_hexdigit()) {
        let bytes = hex::decode(stored).ok()?;
        if bytes.len() != 32 { return None; }
        let mut k = [0u8; 32];
        k.copy_from_slice(&bytes);
        return Some(k);
    }
    decrypt_group_key(stored, enc).ok()
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

    #[test]
    fn test_group_key_encrypt_decrypt() {
        let gk = generate_group_key();
        let salt = generate_salt();
        let enc = FieldEncryption::new("pw123456789012", &salt);
        let blob = encrypt_group_key(&gk, &enc).unwrap();
        let back = decrypt_group_key(&blob, &enc).unwrap();
        assert_eq!(gk, back);
    }

    #[test]
    fn test_resolve_group_key_hex_legacy() {
        let salt = generate_salt();
        let enc = FieldEncryption::new("pw123456789012", &salt);
        let hex_key = hex::encode([42u8; 32]);
        let back = resolve_group_key(&hex_key, &enc).unwrap();
        assert_eq!(back, [42u8; 32]);
    }

    #[test]
    fn test_resolve_group_key_encrypted_blob() {
        let gk = generate_group_key();
        let salt = generate_salt();
        let enc = FieldEncryption::new("pw123456789012", &salt);
        let blob = encrypt_group_key(&gk, &enc).unwrap();
        let back = resolve_group_key(&blob, &enc).unwrap();
        assert_eq!(gk, back);
    }

    #[test]
    fn test_pair_code_deterministic_hash_and_key() {
        // Normalization = trim + uppercase. Interior characters are preserved.
        let c = "abc123";
        let h1 = pair_code_hash(c);
        let h2 = pair_code_hash("  ABC123  ");
        assert_eq!(h1, h2);
        let k1 = derive_pair_transport_key(c);
        let k2 = derive_pair_transport_key("  abc123 ");
        assert_eq!(k1, k2);
        // Different interior content must NOT collide
        assert_ne!(pair_code_hash("abc123"), pair_code_hash("abc-123"));
    }

    #[test]
    fn test_pair_transport_e2e_roundtrip() {
        // Simulates the join flow: creator encrypts the group key with the
        // pair-code transport key; joiner re-derives and decrypts.
        let gk = generate_group_key();
        let code = generate_pair_code();
        let tk = derive_pair_transport_key(&code);
        let blob = e2e_encrypt(&hex::encode(gk), &tk).unwrap();
        // Joiner side: re-derive from typed code (mixed case/whitespace)
        let tk2 = derive_pair_transport_key(&format!(" {} ", code.to_lowercase()));
        let plain = e2e_decrypt(&blob, &tk2).unwrap();
        let back: [u8; 32] = hex::decode(plain).unwrap().try_into().unwrap();
        assert_eq!(gk, back);
    }

    #[test]
    fn test_pair_code_charset_no_ambiguous() {
        for _ in 0..50 {
            let c = generate_pair_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|ch| "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(ch)));
        }
    }
}
