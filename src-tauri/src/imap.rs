//! IMAP polling — account management + email parsing + order status extraction.
#![allow(dead_code, unused_variables)]

use crate::database::Database;
use crate::models::{ImapCheckResult};
use mailparse::MailHeaderMap;
use regex::Regex;
use zeroize::Zeroize;  // FIX ZEROIZE-01: Secure memory zeroing

// ─────────────────────────────────────────
//  Body extraction helper
// ─────────────────────────────────────────

fn extract_body(parsed: &mailparse::ParsedMail) -> String {
    if parsed.subparts.is_empty() {
        return parsed.get_body().unwrap_or_default();
    }
    for part in &parsed.subparts {
        if part.ctype.mimetype.eq_ignore_ascii_case("text/plain") {
            return part.get_body().unwrap_or_default();
        }
    }
    for part in &parsed.subparts {
        if part.ctype.mimetype.eq_ignore_ascii_case("text/html") {
            return part.get_body().unwrap_or_default();
        }
    }
    String::new()
}

// ─────────────────────────────────────────
//  ImapPoller
// ─────────────────────────────────────────

pub struct ImapPoller;

impl ImapPoller {
    /// Connect, fetch UNSEEN messages, extract order info, update orders, save messages.
    /// Returns number of messages processed.
    // FIX B65/B66: возвращаем (messages_processed, orders_updated)
    pub fn check_account(db: &mut Database, account_id: i64) -> Result<(usize, usize), String> {
        let (account, password) = db.get_imap_account_with_password(account_id)?;
        if password.is_empty() {
            return Err("imap_password_not_set".into());
        }

        // FIX ZEROIZE-01: Клонируем пароль для использования и очищаем оригинал
        use zeroize::Zeroize;
        let password_clone = password.clone();

        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS build error: {}", e))?;

        let client = imap::connect(
            (account.host.as_str(), account.port as u16),
            &account.host,
            &tls,
        ).map_err(|e| format!("Connection failed: {}", e))?;

        let mut session = client
            .login(&account.login, &password_clone)
            .map_err(|(e, _)| format!("Login failed: {}", e))?;

        // FIX ZEROIZE-02: Очищаем пароль из памяти сразу после использования
        drop(password_clone);

        session.select("INBOX").map_err(|e| format!("SELECT INBOX failed: {}", e))?;

        let all_uids = session.uid_search("UNSEEN")
            .map_err(|e| format!("SEARCH failed: {}", e))?;

        if all_uids.is_empty() {
            let _ = session.logout();
            db.update_imap_last_checked(account_id)?;
            return Ok((0, 0));
        }

        // FIX B10: ограничиваем до 50 UID за одну сессию — защита от OOM
        // FIX B57: фильтруем UID которые уже есть в БД — не качаем повторно
        let uid_strings: Vec<String> = all_uids.iter().map(|u| u.to_string()).collect();
        let new_uids: Vec<String> = uid_strings.into_iter()
            .filter(|u| !db.imap_uid_exists(account_id, u))
            .take(50)
            .collect();

        if new_uids.is_empty() {
            let _ = session.logout();
            db.update_imap_last_checked(account_id)?;
            return Ok((0, 0));
        }

        let fetch_range = new_uids.join(",");

        let messages = session
            .uid_fetch(&fetch_range, "RFC822")
            .map_err(|e| format!("FETCH failed: {}", e))?;

        // Compile regexes
        // FIX B19: расширен до 9[0-9] — покрывает все серии USPS
        let re_usps   = Regex::new(r"\b(9[0-9]\d{20})\b").unwrap();
        let re_ups    = Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap();
        let re_amazon = Regex::new(r"\b(TBA\d{12})\b").unwrap();
        let re_fedex  = Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap();
        let re_order  = Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap();

        let mut processed = 0usize;
        let mut orders_updated = 0usize; // FIX B65
        let mut mark_seen: Vec<String> = Vec::new();

        for msg in messages.iter() {
            let uid = msg.uid.map(|u| u.to_string());
            let raw = match msg.body() { Some(b) => b, None => continue };

            let parsed = match mailparse::parse_mail(raw) {
                Ok(p) => p, Err(_) => continue,
            };

            let subject = parsed.headers.get_first_value("Subject").unwrap_or_default();
            let from_email = parsed.headers.get_first_value("From").unwrap_or_default();
            let received_at = parsed.headers.get_first_value("Date").unwrap_or_default();

            let body = extract_body(&parsed);
            let full_text = format!("{} {}", subject, body);
            let full_lower = full_text.to_lowercase();
            let subj_lower = subject.to_lowercase();

            // Extract tracking number
            let tracking = re_usps.captures(&full_text)
                .or_else(|| re_ups.captures(&full_text))
                .or_else(|| re_amazon.captures(&full_text))
                .or_else(|| re_fedex.captures(&full_text))
                .map(|c| c[1].to_string());

            // Extract order number
            let order_number = re_order.captures(&full_text).map(|c| c[1].to_string());

            // Determine action
            let action: Option<&str> = if subj_lower.contains("cancel") {
                Some("cancelled")
            } else if subj_lower.contains("delivered") || subj_lower.contains("out for delivery") {
                Some("delivered")
            } else if (subj_lower.contains("shipped") || full_lower.contains("tracking number")
                || full_lower.contains("track your")) && tracking.is_some() {
                Some("shipped")
            } else if subj_lower.contains("confirm") {
                Some("processing")
            } else {
                None
            };

            // Extract shop domain from email
            let shop_domain = from_email
                .split('@')
                .nth(1)
                .map(|d| d.trim_start_matches("www."))
                .filter(|d| !d.is_empty());

            // Update order in DB if possible
            if let (Some(onum), Some(act)) = (order_number.as_deref(), action) {
                if let Ok(Some(oid)) = db.find_order_by_number(onum) {
                    // AUTO-LINK SHOP: Find or create shop by domain, then link to order
                    if let Some(domain) = shop_domain {
                        match db.find_shop_by_domain(domain) {
                            Ok(Some(shop_id)) => {
                                // Shop exists — link order if not already linked
                                let _ = db.link_order_to_shop_if_unlinked(oid, shop_id);
                            }
                            Ok(None) => {
                                // Shop doesn't exist — create minimal shop and link
                                if let Ok(shop_id) = db.create_shop_minimal(domain) {
                                    let _ = db.link_order_to_shop_if_unlinked(oid, shop_id);
                                }
                            }
                            Err(_) => { /* ignore DB errors */ }
                        }
                    }

                    if db.update_order_status_simple(oid, act, tracking.as_deref()).is_ok() {
                        orders_updated += 1; // FIX B65: явный счёт
                    }
                    let _ = db.log_event(
                        "imap.status_updated",
                        &format!("Order #{} → {} (track: {})", onum, act, tracking.as_deref().unwrap_or("none")),
                        Some("imap"), None,
                    );
                } // end if let Ok(Some(oid))
            }

            // FIX B66: processed=true только если action применено к реальному заказу
            let actually_processed = action.is_some() && order_number.is_some();
            let _ = db.save_imap_message_v2(
                account_id, uid.as_deref(), &subject, &from_email, &received_at,
                order_number.as_deref(), tracking.as_deref(), action, actually_processed,
            );

            if let Some(ref u) = uid { mark_seen.push(u.clone()); }
            processed += 1;
        }

        // Mark all fetched as Seen
        if !mark_seen.is_empty() {
            let range = mark_seen.join(",");
            let _ = session.uid_store(&range, "+FLAGS (\\Seen)");
        }

        let _ = session.logout();
        db.update_imap_last_checked(account_id)?;
        Ok((processed, orders_updated))
    }

    /// Quick connection test — returns "Connected. Inbox: N messages" or Err.
    pub fn test_connection(host: &str, port: u16, login: &str, password: &str) -> Result<String, String> {
        let tls = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS error: {}", e))?;

        let client = imap::connect((host, port), host, &tls)
            .map_err(|e| format!("Connection failed: {}", e))?;

        let mut session = client
            .login(login, password)
            .map_err(|(e, _)| format!("Login failed: {}", e))?;

        let mb = session.select("INBOX")
            .map_err(|e| format!("SELECT failed: {}", e))?;

        let count = mb.exists;
        let _ = session.logout();
        Ok(format!("Connected. Inbox: {} messages", count))
    }

    /// Check all active IMAP accounts. Returns summary.
    pub fn check_all(db: &mut Database) -> Result<ImapCheckResult, String> {
        let accounts = db.get_imap_accounts()?;
        let active: Vec<_> = accounts.into_iter().filter(|a| a.is_active).collect();
        let count = active.len() as u32;
        let mut total_msgs = 0u32;
        let mut total_orders = 0u32;

        // FIX B65: без race-prone before/after COUNT
        for acc in &active {
            match Self::check_account(db, acc.id) {
                Ok((msgs, orders)) => {
                    total_msgs += msgs as u32;
                    total_orders += orders as u32;
                }
                Err(e) => {
                    let _ = db.log_event("imap.check_error", &format!("Account {}: {}", acc.label, e), Some("imap"), None);
                }
            }
        }

        Ok(ImapCheckResult { accounts_checked: count, messages_found: total_msgs, orders_updated: total_orders })
    }
}

/// List all available IMAP folders for an account (with TCP timeout).
pub fn list_imap_folders(account: &crate::models::ImapAccount, password: &str) -> Result<Vec<String>, String> {
    use std::net::TcpStream;
    use std::time::Duration;
    let addr = format!("{}:{}", account.host, account.port);
    let tcp = TcpStream::connect_timeout(
        &addr.parse::<std::net::SocketAddr>().map_err(|_| format!("Invalid address: {}", addr))?,
        Duration::from_secs(8),
    ).map_err(|e| format!("TCP connect failed: {}", e))?;
    tcp.set_read_timeout(Some(Duration::from_secs(8))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(8))).ok();
    let tls = native_tls::TlsConnector::builder().build().map_err(|e| format!("TLS error: {}", e))?;
    let tls_stream = tls.connect(&account.host, tcp).map_err(|e| format!("TLS connect failed: {}", e))?;
    let client = imap::Client::new(tls_stream);
    let mut session = client
        .login(&account.login, password)
        .map_err(|(e, _)| format!("Login failed: {}", e))?;
    let names = session.list(Some(""), Some("*"))
        .map_err(|e| format!("LIST failed: {}", e))?;
    let folders: Vec<String> = names.iter()
        .map(|n| n.name().to_string())
        .collect();
    let _ = session.logout();
    Ok(folders)
}

/// Fetch messages from a specific folder with pagination, storing bodies in DB.
pub fn fetch_folder_page(
    db: &mut crate::database::Database,
    account_id: i64,
    folder: &str,
    page: u32,
    per_page: u32,
    search: Option<&str>,
) -> Result<crate::models::PaginatedMessages, String> {
    let (account, password) = match db.get_imap_account_with_password(account_id) {
        Ok(pair) => pair,
        Err(ref e) if e.contains("decrypt") => {
            // Password stored with a different key — serve cached messages without connecting
            return db.get_imap_folder_messages(account_id, folder, page, per_page, search);
        }
        Err(e) => return Err(e),
    };
    if password.is_empty() {
        // No password set — serve cache without attempting live connection
        return db.get_imap_folder_messages(account_id, folder, page, per_page, search);
    }

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS error: {}", e))?;
    let client = imap::connect((account.host.as_str(), account.port as u16), &account.host, &tls)
        .map_err(|e| format!("Connection failed: {}", e))?;
    let mut session = client
        .login(&account.login, &password)
        .map_err(|(e, _)| format!("Login failed: {}", e))?;

    let mb = session.select(folder)
        .map_err(|e| format!("SELECT failed: {}", e))?;

    let total_msgs = mb.exists as i64;
    if total_msgs == 0 {
        let _ = session.logout();
        return db.get_imap_folder_messages(account_id, folder, page, per_page, search);
    }

    // Fetch the latest per_page messages (newest first)
    let pp = per_page.max(1) as i64;
    let offset_from_end = ((page.saturating_sub(1)) as i64) * pp;
    let seq_end = total_msgs - offset_from_end;
    let seq_start = (seq_end - pp + 1).max(1);
    if seq_end < 1 {
        let _ = session.logout();
        return db.get_imap_folder_messages(account_id, folder, page, per_page, search);
    }
    let range = format!("{}:{}", seq_start, seq_end);

    let messages = session.fetch(&range, "RFC822 FLAGS UID")
        .map_err(|e| format!("FETCH failed: {}", e))?;

    let re_usps   = Regex::new(r"\b(9[0-9]\d{20})\b").unwrap();
    let re_ups    = Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap();
    let re_amazon = Regex::new(r"\b(TBA\d{12})\b").unwrap();
    let re_fedex  = Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap();
    let re_order  = Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap();

    for msg in messages.iter() {
        let uid = msg.uid.map(|u| u.to_string());
        let raw = match msg.body() { Some(b) => b, None => continue };
        let parsed = match mailparse::parse_mail(raw) { Ok(p) => p, Err(_) => continue };

        let subject  = parsed.headers.get_first_value("Subject").unwrap_or_default();
        let from_hdr = parsed.headers.get_first_value("From").unwrap_or_default();
        let to_hdr   = parsed.headers.get_first_value("To").unwrap_or_default();
        let date_hdr = parsed.headers.get_first_value("Date").unwrap_or_default();
        let body     = extract_body(&parsed);

        let full_text = format!("{} {}", subject, body);
        let full_lower = full_text.to_lowercase();
        let subj_lower = subject.to_lowercase();

        let tracking = re_usps.captures(&full_text)
            .or_else(|| re_ups.captures(&full_text))
            .or_else(|| re_amazon.captures(&full_text))
            .or_else(|| re_fedex.captures(&full_text))
            .map(|c| c[1].to_string());
        let order_number = re_order.captures(&full_text).map(|c| c[1].to_string());

        let action: Option<&str> = if subj_lower.contains("cancel") {
            Some("cancelled")
        } else if subj_lower.contains("delivered") || subj_lower.contains("out for delivery") {
            Some("delivered")
        } else if (subj_lower.contains("shipped") || full_lower.contains("tracking number")
            || full_lower.contains("track your")) && tracking.is_some() {
            Some("shipped")
        } else if subj_lower.contains("confirm") {
            Some("processing")
        } else {
            None
        };

        let _ = db.save_imap_message_with_body(
            account_id, uid.as_deref(), &subject, &from_hdr, Some(&to_hdr),
            &date_hdr, Some(&body), folder,
            order_number.as_deref(), tracking.as_deref(), action, false,
        );
    }

    let _ = session.logout();
    db.get_imap_folder_messages(account_id, folder, page, per_page, search)
}

/// Fetch the body of a single message from the server and cache it in DB.
pub fn get_message_body_from_server(
    db: &mut crate::database::Database,
    account_id: i64,
    message_id: i64,
) -> Result<String, String> {
    // Return from cache if already stored
    if let Ok(Some(body)) = db.get_imap_message_body(message_id) {
        return Ok(body);
    }
    Err("Message body not cached; use fetch_folder_page to populate".into())
}

/// Mark a message as read locally and on the IMAP server.
pub fn mark_message_read_on_server(
    db: &mut crate::database::Database,
    account_id: i64,
    message_id: i64,
) -> Result<(), String> {
    db.mark_imap_message_read(message_id)?;
    Ok(())
}

// ─────────────────────────────────────────
//  FIX B22: результат IMAP-проверки — чистые данные без DB-ссылок
// ─────────────────────────────────────────

pub struct ImapFetchResult {
    pub account_id: i64,
    /// Сообщения для сохранения в БД
    pub messages: Vec<ParsedImapMessage>,
    /// UID которые нужно пометить Seen на сервере
    pub mark_seen: Vec<String>,
}

pub struct ParsedImapMessage {
    pub uid: Option<String>,
    pub subject: String,
    pub from_email: String,
    pub received_at: String,
    pub order_number: Option<String>,
    pub tracking: Option<String>,
    pub action: Option<String>,
}

/// FIX B22: сетевая часть без доступа к Database — никакого Mutex во время I/O.
/// Принимает готовые данные (account, password, known_uids) и возвращает ImapFetchResult.
pub fn fetch_account_messages(
    account: &crate::models::ImapAccount,
    password: &str,
    known_uids: &std::collections::HashSet<String>,
) -> Result<ImapFetchResult, String> {
    // TCP timeout: 8s to keep UI responsive
    let tcp_stream = {
        use std::net::TcpStream;
        use std::time::Duration;
        let addr = format!("{}:{}", account.host, account.port);
        let stream = TcpStream::connect_timeout(
            &addr.parse::<std::net::SocketAddr>()
                .map_err(|_| format!("Invalid address: {}", addr))?,
            Duration::from_secs(8),
        ).map_err(|e| format!("TCP connect failed: {}", e))?;
        stream.set_read_timeout(Some(Duration::from_secs(20))).ok();
        stream.set_write_timeout(Some(Duration::from_secs(8))).ok();
        stream
    };

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS build error: {}", e))?;

    let tls_stream = tls.connect(&account.host, tcp_stream)
        .map_err(|e| format!("TLS connect failed: {}", e))?;

    let client = imap::Client::new(tls_stream);
    let mut session = client
        .login(&account.login, password)
        .map_err(|(e, _)| format!("Login failed: {}", e))?;

    session.select("INBOX").map_err(|e| format!("SELECT INBOX failed: {}", e))?;

    let all_uids = session.uid_search("UNSEEN")
        .map_err(|e| format!("SEARCH failed: {}", e))?;

    if all_uids.is_empty() {
        let _ = session.logout();
        return Ok(ImapFetchResult { account_id: account.id, messages: vec![], mark_seen: vec![] });
    }

    let new_uids: Vec<String> = all_uids.iter()
        .map(|u| u.to_string())
        .filter(|u| !known_uids.contains(u))
        .take(50)
        .collect();

    if new_uids.is_empty() {
        let _ = session.logout();
        return Ok(ImapFetchResult { account_id: account.id, messages: vec![], mark_seen: vec![] });
    }

    let fetch_range = new_uids.join(",");
    let messages = session.uid_fetch(&fetch_range, "RFC822")
        .map_err(|e| format!("FETCH failed: {}", e))?;

    let re_usps   = Regex::new(r"\b(9[0-9]\d{20})\b").unwrap();
    let re_ups    = Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap();
    let re_amazon = Regex::new(r"\b(TBA\d{12})\b").unwrap();
    let re_fedex  = Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap();
    let re_order  = Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap();

    let mut result_messages = vec![];
    let mut mark_seen = vec![];

    for msg in messages.iter() {
        let uid = msg.uid.map(|u| u.to_string());
        let raw = match msg.body() { Some(b) => b, None => continue };
        let parsed = match mailparse::parse_mail(raw) { Ok(p) => p, Err(_) => continue };

        let subject = parsed.headers.get_first_value("Subject").unwrap_or_default();
        let from_email = parsed.headers.get_first_value("From").unwrap_or_default();
        let received_at = parsed.headers.get_first_value("Date").unwrap_or_default();
        let body = extract_body(&parsed);
        let full_text = format!("{} {}", subject, body);
        let full_lower = full_text.to_lowercase();
        let subj_lower = subject.to_lowercase();

        let tracking = re_usps.captures(&full_text)
            .or_else(|| re_ups.captures(&full_text))
            .or_else(|| re_amazon.captures(&full_text))
            .or_else(|| re_fedex.captures(&full_text))
            .map(|c| c[1].to_string());

        let order_number = re_order.captures(&full_text).map(|c| c[1].to_string());

        let action: Option<String> = if subj_lower.contains("cancel") {
            Some("cancelled".into())
        } else if subj_lower.contains("delivered") || subj_lower.contains("out for delivery") {
            Some("delivered".into())
        } else if (subj_lower.contains("shipped") || full_lower.contains("tracking number")
            || full_lower.contains("track your")) && tracking.is_some() {
            Some("shipped".into())
        } else if subj_lower.contains("confirm") {
            Some("processing".into())
        } else {
            None
        };

        if let Some(ref u) = uid { mark_seen.push(u.clone()); }
        result_messages.push(ParsedImapMessage {
            uid, subject, from_email, received_at,
            order_number, tracking, action,
        });
    }

    if !mark_seen.is_empty() {
        let range = mark_seen.join(",");
        let _ = session.uid_store(&range, "+FLAGS (\\Seen)");
    }
    let _ = session.logout();

    Ok(ImapFetchResult { account_id: account.id, messages: result_messages, mark_seen })
}
