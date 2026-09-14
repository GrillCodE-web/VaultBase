use aes_gcm::aead::rand_core::OsRng;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const PBKDF2_ITERATIONS: u32 = 1_000_000; // LEGACY: расшифровка данных до Argon2id
const HKDF_INFO: &[u8] = b"vb-mgr-telemetry-v1";

// ─────────────────────────────────────────────────────────────────────
//  SEC ETAP-A P.1: Argon2id — ЕДИНЫЙ КОНТРАКТ С ВОРКЕРОМ.
//  Значения ОБЯЗАНЫ совпадать с worker `constants.rs` (ARGON2_*), иначе
//  ключи, деривированные на разных компонентах, не совпадут.
// ─────────────────────────────────────────────────────────────────────
pub const ARGON2_MEMORY_KIB: u32 = 256 * 1024; // 256 МиБ
pub const ARGON2_TIME_COST: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const KDF_VERSION_ARGON2ID: u8 = 2;

/// Деривирует 32-байтный ключ через Argon2id (memory-hard). Идентична
/// worker `encryption::derive_key_argon2id` — единый крипто-контракт (П.34).
/// `domain` — доменный разделитель (b"vaultbase-dek-v2" и т.п.).
pub fn derive_key_argon2id(password: &str, salt: &[u8], domain: &[u8]) -> Result<[u8; 32], String> {
    use argon2::{Argon2, Algorithm, Params, Version};

    let params = Params::new(ARGON2_MEMORY_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM, Some(32))
        .map_err(|e| format!("argon2 params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut derived_salt = Vec::with_capacity(domain.len() + salt.len());
    derived_salt.extend_from_slice(domain);
    derived_salt.extend_from_slice(salt);

    let mut password_bytes = password.as_bytes().to_vec();
    let mut key = [0u8; 32];
    let result = argon
        .hash_password_into(&password_bytes, &derived_salt, &mut key)
        .map_err(|e| format!("argon2 derive: {e}"));
    password_bytes.zeroize();
    result?;
    Ok(key)
}

#[derive(Clone, ZeroizeOnDrop)]
pub struct FieldEncryption {
    pub key: [u8; 32],
}

impl FieldEncryption {
    pub fn new(password: &str, salt: &[u8]) -> Self {
        let mut key = [0u8; 32];
        let mut password_bytes = password.as_bytes().to_vec();
        pbkdf2::pbkdf2_hmac::<Sha256>(&password_bytes, salt, PBKDF2_ITERATIONS, &mut key);
        password_bytes.zeroize();
        Self { key }
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
            .map_err(|e| format!("encrypt: {e}"))?;
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(B64.encode(combined))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<String, String> {
        let data = B64.decode(encoded).map_err(|e| format!("base64: {e}"))?;
        if data.len() < 13 {
            return Err("ciphertext too short".into());
        }
        let (nonce_bytes, ct) = data.split_at(12);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&self.key));
        cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ct)
            .map_err(|_| "decrypt failed — wrong password or corrupted data".to_string())
            .and_then(|plain| String::from_utf8(plain).map_err(|e| format!("utf8: {e}")))
    }
}

pub fn generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn generate_random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

pub struct PasswordValidation {
    pub min_length: bool,
    pub has_upper: bool,
    pub has_lower: bool,
    pub has_digit: bool,
    pub has_special: bool,
}

impl PasswordValidation {
    pub fn check(password: &str) -> Self {
        Self {
            min_length: password.len() >= 12,
            has_upper: password.chars().any(|c| c.is_uppercase()),
            has_lower: password.chars().any(|c| c.is_lowercase()),
            has_digit: password.chars().any(|c| c.is_ascii_digit()),
            has_special: password.chars().any(|c| !c.is_alphanumeric()),
        }
    }

    pub fn is_valid(&self) -> bool {
        self.min_length && self.has_upper && self.has_lower && self.has_digit && self.has_special
    }

    pub fn error_code(&self) -> Option<String> {
        if self.is_valid() {
            return None;
        }
        if !self.min_length {
            return Some("pwd_min_length".into());
        }
        if !self.has_upper {
            return Some("pwd_upper".into());
        }
        if !self.has_lower {
            return Some("pwd_lower".into());
        }
        if !self.has_digit {
            return Some("pwd_digit".into());
        }
        Some("pwd_special".into())
    }
}

/// Legacy KEK-соль (KEK на PBKDF2, до Argon2id). Оставлена для чтения старых
/// сайдкаров до миграции при первом входе.
fn kek_salt(salt: &[u8]) -> Vec<u8> {
    let mut s = Vec::with_capacity(salt.len() + 20);
    s.extend_from_slice(b"vaultbase-mgr-dek-v1");
    s.extend_from_slice(salt);
    s
}

/// Префикс версии обёртки DEK: KEK деривирован через Argon2id (memory-hard).
/// Блоб без префикса — legacy (KEK на PBKDF2), апгрейдится при первом входе.
pub const DEK_WRAP_ARGON2_PREFIX: &str = "a2:";

/// Домен-разделитель для KEK менеджера (отдельная БД → отдельный домен).
const DEK_KEK_DOMAIN: &[u8] = b"vaultbase-mgr-dek-v2";

/// `true`, если обёртка DEK — legacy (PBKDF2) и подлежит апгрейду до Argon2id.
pub fn dek_wrap_is_legacy(blob: &str) -> bool {
    !blob.starts_with(DEK_WRAP_ARGON2_PREFIX)
}

/// ЭТАП-A П.1: KEK деривируется через Argon2id (memory-hard), блоб помечается
/// префиксом `a2:`. DEK случайный и не меняется — переобёртка без rekey БД.
pub fn wrap_dek(dek: &[u8; 32], password: &str, salt: &[u8]) -> Result<String, String> {
    let kek = FieldEncryption { key: derive_key_argon2id(password, salt, DEK_KEK_DOMAIN)? };
    let blob = kek.encrypt(&hex::encode(dek))?;
    Ok(format!("{DEK_WRAP_ARGON2_PREFIX}{blob}"))
}

pub fn unwrap_dek(blob: &str, password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let (kek, payload) = if let Some(rest) = blob.strip_prefix(DEK_WRAP_ARGON2_PREFIX) {
        (FieldEncryption { key: derive_key_argon2id(password, salt, DEK_KEK_DOMAIN)? }, rest)
    } else {
        (FieldEncryption::new(password, &kek_salt(salt)), blob)
    };
    let bytes = hex::decode(kek.decrypt(payload)?).map_err(|e| format!("hex: {e}"))?;
    if bytes.len() != 32 {
        return Err("invalid dek length".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

// ─────────────────────────────────────────────────────────────────────
//  SEC ETAP-A P.10: Ed25519 — подпись данных синка (anti-tamper).
//  Единый контракт с воркером (worker commands/telemetry.rs): один и тот же
//  примитив, сериализация подписи — hex(64 байта), ключей — hex(32 байта).
//  Ключ устройства (seed) хранится в config-KV, публичный публикуется на
//  сервер вместе с X25519-пубключом; приёмник проверяет подпись payload.
// ─────────────────────────────────────────────────────────────────────

/// Сгенерировать Ed25519-ключ устройства. Возвращает (seed_hex, pub_hex),
/// оба по 32 байта в hex. Seed хранить как секрет, pub — публиковать.
pub fn generate_ed25519() -> (String, String) {
    use ed25519_dalek::SigningKey;
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    let sk = SigningKey::from_bytes(&seed);
    let pub_hex = hex::encode(sk.verifying_key().to_bytes());
    (hex::encode(seed), pub_hex)
}

/// Публичный Ed25519-ключ (hex) из seed (hex).
pub fn ed25519_pub_from_seed(seed_hex: &str) -> Result<String, String> {
    use ed25519_dalek::SigningKey;
    let seed: [u8; 32] = hex::decode(seed_hex.trim())
        .map_err(|e| format!("ed25519 seed hex: {e}"))?
        .try_into()
        .map_err(|_| "ed25519 seed length".to_string())?;
    let sk = SigningKey::from_bytes(&seed);
    Ok(hex::encode(sk.verifying_key().to_bytes()))
}

/// Подписать `msg` seed'ом устройства (hex). Возвращает подпись hex(64 байта).
pub fn ed25519_sign(seed_hex: &str, msg: &[u8]) -> Result<String, String> {
    use ed25519_dalek::{Signer, SigningKey};
    let seed: [u8; 32] = hex::decode(seed_hex.trim())
        .map_err(|e| format!("ed25519 seed hex: {e}"))?
        .try_into()
        .map_err(|_| "ed25519 seed length".to_string())?;
    let sk = SigningKey::from_bytes(&seed);
    Ok(hex::encode(sk.sign(msg).to_bytes()))
}

/// Проверить подпись `sig_hex` (64 байта) сообщения `msg` пубключом `pub_hex`.
pub fn ed25519_verify(pub_hex: &str, msg: &[u8], sig_hex: &str) -> Result<bool, String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let pk: [u8; 32] = hex::decode(pub_hex.trim())
        .map_err(|e| format!("ed25519 pub hex: {e}"))?
        .try_into()
        .map_err(|_| "ed25519 pub length".to_string())?;
    let sig: [u8; 64] = hex::decode(sig_hex.trim())
        .map_err(|e| format!("ed25519 sig hex: {e}"))?
        .try_into()
        .map_err(|_| "ed25519 sig length".to_string())?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|e| format!("ed25519 pub: {e}"))?;
    Ok(vk.verify(msg, &Signature::from_bytes(&sig)).is_ok())
}

pub fn generate_x25519() -> ([u8; 32], [u8; 32]) {
    let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let public = PublicKey::from(&secret);
    (secret.to_bytes(), *public.as_bytes())
}

fn derive_envelope_key(shared: &[u8; 32], recipient_pub: &[u8; 32], ephemeral_pub: &[u8; 32]) -> [u8; 32] {
    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(recipient_pub);
    salt.extend_from_slice(ephemeral_pub);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm).expect("hkdf expand 32 bytes");
    okm
}

pub fn seal_envelope(key_id: i64, plaintext: &str, recipient_pub: &[u8; 32]) -> Result<serde_json::Value, String> {
    let eph_secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let eph_pub = PublicKey::from(&eph_secret);
    let recipient = PublicKey::from(*recipient_pub);
    let shared = eph_secret.diffie_hellman(&recipient);
    let okm = derive_envelope_key(shared.as_bytes(), recipient_pub, eph_pub.as_bytes());

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm));
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|e| format!("seal: {e}"))?;

    Ok(serde_json::json!({
        "key_id": key_id,
        "ephemeral": hex::encode(eph_pub.as_bytes()),
        "nonce": hex::encode(nonce),
        "ct": B64.encode(ct),
    }))
}

pub fn unseal_envelope(secret: &[u8; 32], envelope: &serde_json::Value) -> Result<String, String> {
    let eph_hex = envelope
        .get("ephemeral")
        .and_then(|v| v.as_str())
        .ok_or("envelope missing ephemeral")?;
    let nonce_hex = envelope
        .get("nonce")
        .and_then(|v| v.as_str())
        .ok_or("envelope missing nonce")?;
    let ct_b64 = envelope
        .get("ct")
        .and_then(|v| v.as_str())
        .ok_or("envelope missing ct")?;

    let eph_bytes: [u8; 32] = hex::decode(eph_hex)
        .map_err(|e| format!("ephemeral hex: {e}"))?
        .try_into()
        .map_err(|_| "ephemeral length".to_string())?;
    let nonce_bytes: [u8; 12] = hex::decode(nonce_hex)
        .map_err(|e| format!("nonce hex: {e}"))?
        .try_into()
        .map_err(|_| "nonce length".to_string())?;

    let sec = StaticSecret::from(*secret);
    let own_pub = PublicKey::from(&sec);
    let shared = sec.diffie_hellman(&PublicKey::from(eph_bytes));
    let okm = derive_envelope_key(shared.as_bytes(), own_pub.as_bytes(), &eph_bytes);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&okm));
    let ct = B64.decode(ct_b64).map_err(|e| format!("ct base64: {e}"))?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_slice())
        .map_err(|_| "unseal failed — wrong key or corrupted envelope".to_string())?;
    String::from_utf8(plain).map_err(|e| format!("utf8: {e}"))
}

#[cfg(test)]
mod ed25519_tests {
    use super::{ed25519_pub_from_seed, ed25519_sign, ed25519_verify, generate_ed25519};

    #[test]
    fn sign_verify_roundtrip_and_tamper() {
        let (seed, pubk) = generate_ed25519();
        assert_eq!(ed25519_pub_from_seed(&seed).unwrap(), pubk);
        let msg = b"vaultbase-sync-payload-v1";
        let sig = ed25519_sign(&seed, msg).unwrap();
        assert!(ed25519_verify(&pubk, msg, &sig).unwrap());
        // tampered message → not valid
        assert!(!ed25519_verify(&pubk, b"vaultbase-sync-payload-v2", &sig).unwrap());
        // wrong key → not valid
        let (_s2, pub2) = generate_ed25519();
        assert!(!ed25519_verify(&pub2, msg, &sig).unwrap());
    }
}

#[cfg(test)]
mod argon2id_tests {
    use super::derive_key_argon2id;

    // Единый контракт с воркером: те же входы → тот же алгоритм/параметры.
    #[test]
    fn deterministic_and_domain_separated() {
        let salt = b"0123456789abcdef";
        let a = derive_key_argon2id("correct horse", salt, b"vaultbase-dek-v2").unwrap();
        let b = derive_key_argon2id("correct horse", salt, b"vaultbase-dek-v2").unwrap();
        assert_eq!(a, b, "детерминизм");
        let f = derive_key_argon2id("correct horse", salt, b"vaultbase-field-v2").unwrap();
        assert_ne!(a, f, "домен-разделение");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_encryption_roundtrip() {
        let enc = FieldEncryption::new("password123!", &generate_salt());
        let blob = enc.encrypt("secret data").unwrap();
        assert_eq!(enc.decrypt(&blob).unwrap(), "secret data");
    }

    #[test]
    fn wrong_password_fails() {
        let salt = generate_salt();
        let enc = FieldEncryption::new("right password!", &salt);
        let blob = enc.encrypt("data").unwrap();
        let wrong = FieldEncryption::new("wrong password!", &salt);
        assert!(wrong.decrypt(&blob).is_err());
    }

    #[test]
    fn wrap_unwrap_dek_roundtrip() {
        let dek = generate_random_key();
        let salt = generate_salt();
        let blob = wrap_dek(&dek, "master pass1!", &salt).unwrap();
        assert_eq!(unwrap_dek(&blob, "master pass1!", &salt).unwrap(), dek);
        assert!(unwrap_dek(&blob, "other pass1!", &salt).is_err());
    }

    #[test]
    fn seal_unseal_roundtrip() {
        let (secret, public) = generate_x25519();
        let payload = r#"{"orders":{"total":5}}"#;
        let envelope = seal_envelope(7, payload, &public).unwrap();
        assert_eq!(envelope.get("key_id").unwrap(), &serde_json::json!(7));
        let plaintext = unseal_envelope(&secret, &envelope).unwrap();
        assert_eq!(plaintext, payload);
    }

    #[test]
    fn unseal_with_wrong_key_fails() {
        let (_secret, public) = generate_x25519();
        let (other_secret, _other_pub) = generate_x25519();
        let envelope = seal_envelope(1, "hello", &public).unwrap();
        assert!(unseal_envelope(&other_secret, &envelope).is_err());
    }

    #[test]
    fn seal_unique_nonces() {
        let (_secret, public) = generate_x25519();
        let a = seal_envelope(1, "same", &public).unwrap();
        let b = seal_envelope(1, "same", &public).unwrap();
        assert_ne!(a.get("ct").unwrap(), b.get("ct").unwrap());
    }

    #[test]
    fn password_validation_rules() {
        assert!(!PasswordValidation::check("short1!").is_valid());
        assert!(!PasswordValidation::check("alllowercase1!").is_valid());
        assert!(PasswordValidation::check("Strong1!Passw0rd").is_valid());
    }
}
