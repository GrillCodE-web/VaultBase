//! 7rn: SPKI-пиннинг (SHA-256) корней Let's Encrypt для TLS к боевому
//! sync-серверу. Копия worker-модуля tls_pins.rs (крейты раздельные);
//! отличия: DEFAULT_SERVER_URL берётся из http.rs, warn — через eprintln
//! (в менеджере нет tracing). Подробности и режимы см. в worker-версии.

use std::sync::Arc;

use rustls::client::danger::{
    HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier,
};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};

const PINNED_SPKI_B64: [&str; 2] = [
    "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=", // ISRG Root X2 (ECDSA)
    "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=", // ISRG Root X1 (RSA)
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
        let verified = self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)?;
        if self.chain_pinned(end_entity, intermediates) {
            return Ok(verified);
        }
        let msg = format!("tls pin mismatch for {server_name:?}");
        match self.mode {
            PinMode::Enforce => Err(TlsError::General(msg)),
            PinMode::Shadow => {
                eprintln!("[tls_pins] {msg} — продолжаю (shadow mode)");
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

/// DER TLV: (tag, content_start, content_end, next_off). None при битой форме.
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

/// Извлечь SubjectPublicKeyInfo (полный TLV) из DER X.509-сертификата.
fn extract_spki(der: &[u8]) -> Option<Vec<u8>> {
    let (tag, cert_content_start, _ce, _) = read_tlv(der, 0)?;
    if tag != 0x30 {
        return None;
    }
    let (tag, tbs_content_start, _ce, _) = read_tlv(der, cert_content_start)?;
    if tag != 0x30 {
        return None;
    }
    let mut off = tbs_content_start;
    let (tag, _cs, _ce, next) = read_tlv(der, off)?;
    if tag == 0xa0 {
        off = next;
    }
    for _ in 0..5 {
        let (_t, _cs, _ce, next) = read_tlv(der, off)?;
        off = next;
    }
    let (tag, _cs, _ce, next) = read_tlv(der, off)?;
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

/// ClientConfig с пиннингом. Когда применять, решает вызывающий код
/// (http::agent_for — только для дефолтного боевого URL).
pub fn pinned_client_config() -> Option<Arc<ClientConfig>> {
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
        tbs.extend(tlv(0xa0, &tlv(0x02, &[2])));
        tbs.extend(tlv(0x02, &[1]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend(tlv(0x30, &[0x05, 0x00]));
        tbs.extend_from_slice(spki);
        tlv(0x30, &tlv(0x30, &tbs))
    }

    #[test]
    fn extract_spki_roundtrip() {
        let spki = {
            let mut v = vec![0x30, 0x06];
            v.extend_from_slice(&[1, 2, 3, 4, 5, 6]);
            v
        };
        let cert = make_cert(&spki);
        assert_eq!(extract_spki(&cert).as_deref(), Some(spki.as_slice()));
    }

    #[test]
    fn extract_spki_rejects_garbage() {
        assert!(extract_spki(&[]).is_none());
        assert!(extract_spki(&[0x30]).is_none());
        assert!(extract_spki(&[0x05, 0x00]).is_none());
        assert!(extract_spki(&[0x30, 0x82, 0xff]).is_none());
    }

    #[test]
    fn pins_decode_to_32_bytes() {
        let pins = decode_pins().expect("pins must decode");
        assert_eq!(pins.len(), 2);
        assert!(pins.iter().all(|p| p.len() == 32));
    }
}
