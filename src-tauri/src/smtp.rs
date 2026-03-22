//! SMTP email sending via lettre.
#![allow(dead_code)]

use crate::database::Database;
use crate::models::SmtpConfigInput;
use lettre::{
    Message, SmtpTransport, Transport,
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
};

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
        let password = db.get_smtp_config_password(config_id)?;

        let from_addr = format!("{} <{}>", cfg.label, cfg.login);
        let email = Message::builder()
            .from(from_addr.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
            .to(to.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body.to_string())
            .map_err(|e| e.to_string())?;

        let creds = Credentials::new(cfg.login.clone(), password);

        let transport = if cfg.use_tls {
            SmtpTransport::relay(&cfg.host)
                .map_err(|e| e.to_string())?
                .port(cfg.port as u16)
                .credentials(creds)
                .build()
        } else {
            SmtpTransport::starttls_relay(&cfg.host)
                .map_err(|e| e.to_string())?
                .port(cfg.port as u16)
                .credentials(creds)
                .build()
        };

        transport.send(&email).map_err(|e| e.to_string())?;

        db.log_sent_email(
            Some(config_id), Some(&cfg.login), to,
            Some(subject), Some(body), "sent", None,
        )?;
        Ok(())
    }

    /// Test SMTP connection without sending a message.
    pub fn test(host: &str, port: u16, login: &str, password: &str, use_tls: bool) -> Result<String, String> {
        let creds = Credentials::new(login.to_string(), password.to_string());
        let transport = if use_tls {
            SmtpTransport::relay(host)
                .map_err(|e| e.to_string())?
                .port(port)
                .credentials(creds)
                .build()
        } else {
            SmtpTransport::starttls_relay(host)
                .map_err(|e| e.to_string())?
                .port(port)
                .credentials(creds)
                .build()
        };
        transport.test_connection().map_err(|e| e.to_string())?;
        Ok(format!("Connected to {}:{}", host, port))
    }
}
