//! 7rn: certificate pinning (SPKI, SHA-256) для TLS к боевому sync-серверу.
//!
//! Пины — на корни Let's Encrypt (ISRG Root X1 / X2), НЕ на leaf: leaf
//! перевыпускается каждые ~60-90 дней (certbot), а промежуточные (YE2/R10)
//! ротируются по расписанию LE. Корни валидны до 2030-х, их SPKI посчитаны
//! по реальным сертификатам и совпадают с публично опубликованными pinset'ами:
//!   ISRG Root X2 (ECDSA P-384): diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=
//!   ISRG Root X1 (RSA 4096):    C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=
//!
//! Полный PKI-контроль сохраняется: сначала стандартный WebPki-верификатор
//! (цепочка, сроки, hostname), потом проверка пина по любому сертификату
//! цепочки. Пин — дополнительный барьер против rogue-CA/MITM, а не замена PKI.
//!
//! Режимы (env VAULTBASE_PIN_MODE):
//!   shadow (по умолчанию) — mismatch только логируется. Первый релиз идёт
//!                           так: откат не требуется, если пин вдруг не совпал
//!                           у какого-то пользователя (редкий middlebox).
//!   enforce               — mismatch рвёт handshake.
//!
//! Пиннинг отключается целиком, если серверный URL переопределён через
//! VAULTBASE_SERVER_URL (self-hosted/стенд): там чужой сертификат и пины
//! неприменимы.

use std::sync::Arc;

use rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme};
use rustls::client::WebPkiServerVerifier;
use sha2::{Digest, Sha256};

/// base64(SHA-256(SPKI)) — ISRG Root X2 (ECDSA) и ISRG Root X1 (RSA).
/// Порядок не важен: проверяем «любой из».
const PINNED_SPKI_B64: [&str; 2] = [
    "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=",
    "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PinMode {
    Shadow,
    Enforce,
}

fn pin_mode() -> PinMode {
    match std::env::var("VAULTBASE_PIN_MODE").as_deref() {
        Ok("enforce") => PinMode::Enforce,
        _ => PinMode::Shadow,
    }
}

#[derive(Debug)]
struct PinnedVerifier {
    inner: Arc<WebPkiServerVerifier>,
    pins: Vec<[u8; 32]>,
    mode: PinMode,
}

impl PinnedVerifier {
    fn chain_pinned(&self, end_entity: &CertificateDer<'_>, intermediates: &[CertificateDer<'_>]) -> bool {
        std::iter::once(end_entity)
            .chain(intermediates.iter())
            .filter_map(|c| extract_spki(c.as_ref()))
            .any(|spki| {
                let digest: [u8; 32] = Sha256::digest(&spki).into();
                self.pins.contains(&digest)
            })
    }
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        // Сначала полная PKI-проверка (цепочка/сроки/hostname).
        let verified = self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)?;
        if self.chain_pinned(end_entity, intermediates) {
            return Ok(verified);
        }
        let msg = format!("tls pin mismatch for {server_name:?}");
        match self.mode {
            PinMode::Enforce => Err(TlsError::General(msg)),
            PinMode::Shadow => {
                tracing::warn!("{msg} — продолжаю (shadow mode)");
                Ok(verified)
            }
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

/// Прочитать DER TLV: (tag, полный срез TLV с заголовком, срез контента,
/// смещение следующего элемента). None при битой структуре.
fn read_tlv(der: &[u8], off: usize) -> Option<(u8, usize, usize, usize)> {
    let tag = *der.get(off)?;
    let len_byte = *der.get(off + 1)? as usize;
    let (content_len, header_len) = if len_byte < 0x80 {
        (len_byte, 2)
    } else {
        let n = len_byte & 0x7f;
        if n == 0 || n > 4 || der.len() < off + 2 + n {
            return None;
        }
        let mut l = 0usize;
        for i in 0..n {
            l = (l << 8) | der[off + 2 + i] as usize;
        }
        (l, 2 + n)
    };
    let content_start = off.checked_add(header_len)?;
    let content_end = content_start.checked_add(content_len)?;
    if content_end > der.len() {
        return None;
    }
    Some((tag, content_start, content_end, content_end))
}

/// Извлечь SubjectPublicKeyInfo (полный TLV) из DER-сертификата X.509.
/// Certificate → SEQUENCE { tbsCertificate, ... };
/// внутри tbs: [0] version (опц.), serial, signature, issuer, validity,
/// subject, далее SPKI. Никаких внешних парсеров — 30 строк ходьбы по TLV.
fn extract_spki(der: &[u8]) -> Option<Vec<u8>> {
    let (tag, cert_content_start, _cert_end, _) = read_tlv(der, 0)?;
    if tag != 0x30 {
        return None;
    }
    let (tag, tbs_content_start, _tbs_end, _) = read_tlv(der, cert_content_start)?;
    if tag != 0x30 {
        return None;
    }
    let mut off = tbs_content_start;
    // version [0] EXPLICIT — есть у v3, может отсутствовать у v1.
    let (tag, _cs, _ce, next) = read_tlv(der, off)?;
    if tag == 0xa0 {
        off = next;
    }
    // serial, signature, issuer, validity, subject — пропускаем 5 TLV.
    for _ in 0..5 {
        let (_tag, _cs, _ce, next) = read_tlv(der, off)?;
        off = next;
    }
    // Следующий элемент — subjectPublicKeyInfo; возвращаем ВЕСЬ TLV
    // (хэш SPKI считается по полной DER-кодировке, включая заголовок).
    let (tag, _content_start, _content_end, next) = read_tlv(der, off)?;
    if tag != 0x30 {
        return None;
    }
    Some(der[off..next].to_vec())
}

fn decode_pins() -> Option<Vec<[u8; 32]>> {
    use base64::Engine;
    PINNED_SPKI_B64
        .iter()
        .map(|b64| {
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .ok()
                .and_then(|v| <[u8; 32]>::try_from(v.as_slice()).ok())
        })
        .collect()
}

/// rustls ClientConfig с пиннингом — только для дефолтного боевого URL.
/// При переопределённом сервере (self-hosted) возвращает None: вызывающий
/// код тогда использует дефолтный TLS ureq.
pub fn pinned_client_config() -> Option<Arc<ClientConfig>> {
    if crate::endpoints::server_base() != crate::constants::DEFAULT_SERVER_URL {
        return None;
    }
    let pins = decode_pins()?;
    let provider: Arc<rustls::crypto::CryptoProvider> = rustls::crypto::ring::default_provider().into();
    let verifier = PinnedVerifier {
        inner: WebPkiServerVerifier::builder_with_provider(
            Arc::new(rustls::RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            }),
            provider.clone(),
        )
        .build()
        .ok()?,
        pins,
        mode: pin_mode(),
    };
    let config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
        .ok()?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Some(Arc::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Собирает минимальный валидный X.509 DER-каркас с заданным SPKI.
    fn make_cert(spki: &[u8]) -> Vec<u8> {
        fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
            let mut out = vec![tag];
            if content.len() < 0x80 {
                out.push(content.len() as u8);
            } else {
                out.push(0x82);
                out.push((content.len() >> 8) as u8);
                out.push((content.len() & 0xff) as u8);
            }
            out.extend_from_slice(content);
            out
        }
        let mut tbs = Vec::new();
        tbs.extend(tlv(0xa0, &tlv(0x02, &[2]))); // version v3
        tbs.extend(tlv(0x02, &[1]));             // serial
        tbs.extend(tlv(0x30, &[0x05, 0x00]));    // signature alg
        tbs.extend(tlv(0x30, &[0x05, 0x00]));    // issuer
        tbs.extend(tlv(0x30, &[0x05, 0x00]));    // validity
        tbs.extend(tlv(0x30, &[0x05, 0x00]));    // subject
        tbs.extend_from_slice(spki);             // SPKI (уже TLV)
        tlv(0x30, &tlv(0x30, &tbs))              // Certificate { tbs }
    }

    #[test]
    fn extract_spki_roundtrip() {
        // SPKI как SEQUENCE из фиктивного контента.
        let spki = {
            let mut v = vec![0x30, 0x06];
            v.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
            v
        };
        let cert = make_cert(&spki);
        assert_eq!(extract_spki(&cert).as_deref(), Some(spki.as_slice()));
    }

    #[test]
    fn extract_spki_without_version_field() {
        let spki = vec![0x30, 0x03, 9, 9, 9];
        // v1-сертификат: без [0]-версии — serial идёт первым.
        fn tlv(tag: u8, content: &[u8]) -> Vec<u8> {
            let mut out = vec![tag, content.len() as u8];
            out.extend_from_slice(content);
            out
        }
        let mut tbs = Vec::new();
        tbs.extend(tlv(0x02, &[7]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend_from_slice(&spki);
        let cert = tlv(0x30, &tlv(0x30, &tbs));
        assert_eq!(extract_spki(&cert).as_deref(), Some(spki.as_slice()));
    }

    #[test]
    fn extract_spki_rejects_garbage() {
        assert!(extract_spki(&[]).is_none());
        assert!(extract_spki(&[0x30]).is_none());
        assert!(extract_spki(&[0x05, 0x00]).is_none());
        // усечённая длина
        assert!(extract_spki(&[0x30, 0x82, 0xff]).is_none());
    }

    #[test]
    fn pins_decode_to_32_bytes() {
        let pins = decode_pins().expect("pins must decode");
        assert_eq!(pins.len(), 2);
        assert!(pins.iter().all(|p| p.len() == 32));
    }
}
