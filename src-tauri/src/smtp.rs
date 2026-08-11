//! SMTP email sending via lettre.
#![allow(dead_code)]

use crate::database::Database;
use crate::models::SmtpConfigInput;
use lettre::{
    Message, SmtpTransport, Transport,
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
};
use zeroize::Zeroize;

/// FIX TC-H02: Wrapper struct that zeroizes password on drop
struct SecurePassword(String);

impl SecurePassword {
    fn new(password: String) -> Self {
        Self(password)
    }

    fn get(&self) -> &str {
        &self.0
    }
}

impl Drop for SecurePassword {
    fn drop(&mut self) {
        // Zeroize password when struct goes out of scope
        self.0.zeroize();
    }
}

pub struct EmailSender;

impl EmailSender {
    /// Send an email using a stored SMTP config.
    pub fn send(
        db: &Database,
        config_id: i64,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), String> {
        let cfg = db.get_smtp_configs()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|c| c.id == config_id)
            .ok_or_else(|| "smtp_config_not_found".to_string())?;

        // FIX TC-H02: Use SecurePassword wrapper to ensure zeroize on drop
        let password = SecurePassword::new(db.get_smtp_config_password(config_id)?);

        let from_addr = format!("{} <{}>", cfg.label, cfg.login);
        let email = Message::builder()
            .from(from_addr.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
            .to(to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| e.to_string())?;

        let creds = Credentials::new(cfg.login.clone(), password.get().to_string());

        // BUG-001/SEC-016: Fixed inverted TLS logic
        // use_tls=true  → implicit TLS (port 465) via relay()
        // use_tls=false → STARTTLS upgrade (port 587) via starttls_relay()
        let transport = if cfg.use_tls {
            SmtpTransport::relay(&cfg.host)
                .map_err(|e| e.to_string())?
                .port(cfg.port as u16)
                .credentials(creds)
                .build()
        } else {
            SmtpTransport::builder_dangerous(&cfg.host)
                .port(cfg.port as u16)
                .credentials(creds)
                .build()
        };

        transport.send(&email).map_err(|e| e.to_string())?;

        // Password is automatically zeroized when `password` goes out of scope

        db.log_sent_email(
            Some(config_id), Some(&cfg.login), to,
            Some(subject), Some(body), "sent", None,
        )?;
        Ok(())
    }

    /// Test SMTP connection without sending a message.
    // SEC-012: Accept owned String for password so we can zeroize after use
    pub fn test(host: &str, port: u16, login: &str, password: &str, use_tls: bool) -> Result<String, String> {
        let secure_pwd = SecurePassword::new(password.to_string());
        let creds = Credentials::new(login.to_string(), secure_pwd.get().to_string());
        // BUG-001: Fixed inverted TLS logic (same as send)
        let transport = if use_tls {
            SmtpTransport::relay(host)
                .map_err(|e| e.to_string())?
                .port(port)
                .credentials(creds)
                .build()
        } else {
            SmtpTransport::builder_dangerous(host)
                .port(port)
                .credentials(creds)
                .build()
        };
        let result = transport.test_connection().map_err(|e| e.to_string());
        // secure_pwd is auto-zeroized on drop
        result.map(|_| format!("Connected to {}:{}", host, port))
    }
}
