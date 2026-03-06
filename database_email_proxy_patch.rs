// ============================================================
// PATCH: database.rs — Email Pool + Proxy operations
// Append inside impl Database { ... }
// ============================================================

use crate::models::{EmailPoolEntry, PaginatedEmails, ProxyInput, Proxy, PaginatedProxies, ImportResult};

// ─── Email Pool ───────────────────────────────────────────────

pub fn add_email(&self, email: &str, label: &str, notes: &str) -> Result<EmailPoolEntry, String> {
    if email.trim().is_empty() {
        return Err("email_required".to_string());
    }

    // Dedup via hash
    let email_hash = crate::encryption::hash_value(email);
    let exists: bool = self.conn
        .query_row(
            "SELECT COUNT(*) FROM email_pool WHERE email_hash = ?1",
            params![email_hash],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;

    if exists {
        return Err("email_duplicate".to_string());
    }

    let enc = self.encryption.as_ref().ok_or("locked")?;
    let email_enc = enc.encrypt(email).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    self.conn.execute(
        "INSERT INTO email_pool (email, email_hash, label, notes, is_blocked, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![email_enc, email_hash, label, notes, now],
    ).map_err(|e| e.to_string())?;

    let id = self.conn.last_insert_rowid();
    self.log_event("email.added", Some(&format!("id={}", id)))?;

    self.get_email_by_id(id)
}

fn get_email_by_id(&self, id: i64) -> Result<EmailPoolEntry, String> {
    let enc = self.encryption.as_ref().ok_or("locked")?;

    let (email_enc, label, notes, is_blocked, imap_id, created_at, updated_at): (
        String, Option<String>, Option<String>, bool, Option<i64>, String, String,
    ) = self.conn.query_row(
        "SELECT email, label, notes, is_blocked, imap_account_id, created_at, updated_at
         FROM email_pool WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    ).map_err(|e| e.to_string())?;

    let email = enc.decrypt(&email_enc).map_err(|e| e.to_string())?;

    let shops_used = self.get_shops_for_email(id)?;

    Ok(EmailPoolEntry {
        id,
        email,
        label,
        notes,
        is_blocked,
        imap_account_id: imap_id,
        shops_used,
        created_at,
        updated_at,
    })
}

fn get_shops_for_email(&self, email_id: i64) -> Result<Vec<ShopRef>, String> {
    let mut stmt = self.conn.prepare(
        "SELECT DISTINCT s.id, s.name FROM shop_footprints sf
         JOIN shops s ON s.id = sf.shop_id
         WHERE sf.email_id = ?1"
    ).map_err(|e| e.to_string())?;

    stmt.query_map(params![email_id], |r| {
        Ok(ShopRef { id: r.get(0)?, name: r.get(1)? })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn get_emails(&self, filter: EmailFilter, page: u32, per_page: u32) -> Result<PaginatedEmails, String> {
    let enc = self.encryption.as_ref().ok_or("locked")?;
    let offset = (page.saturating_sub(1)) * per_page;

    let mut conditions: Vec<String> = Vec::new();
    let mut bind_vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(blocked) = filter.is_blocked {
        conditions.push(format!("e.is_blocked = ?{}", bind_vals.len() + 1));
        bind_vals.push(Box::new(blocked as i64));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total: u32 = {
        let sql = format!("SELECT COUNT(*) FROM email_pool e {}", where_clause);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
        stmt.query_row(refs.as_slice(), |r| r.get(0)).map_err(|e| e.to_string())?
    };

    let sql = format!(
        "SELECT e.id, e.email, e.label, e.notes, e.is_blocked, e.imap_account_id, e.created_at, e.updated_at
         FROM email_pool e
         {}
         ORDER BY e.created_at DESC
         LIMIT ?{lim} OFFSET ?{off}",
        where_clause,
        lim = bind_vals.len() + 1,
        off = bind_vals.len() + 2
    );

    bind_vals.push(Box::new(per_page as i64));
    bind_vals.push(Box::new(offset as i64));

    let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();

    let rows = stmt.query_map(refs.as_slice(), |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, bool>(4)?,
            r.get::<_, Option<i64>>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
        ))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    let mut items: Vec<EmailPoolEntry> = Vec::with_capacity(rows.len());
    for (id, email_enc, label, notes, is_blocked, imap_id, created_at, updated_at) in rows {
        let email = match enc.decrypt(&email_enc) {
            Ok(v) => v,
            Err(_) => "<decrypt_error>".to_string(),
        };
        let shops_used = self.get_shops_for_email(id).unwrap_or_default();
        items.push(EmailPoolEntry {
            id,
            email,
            label,
            notes,
            is_blocked,
            imap_account_id: imap_id,
            shops_used,
            created_at,
            updated_at,
        });
    }

    Ok(PaginatedEmails {
        items,
        total,
        page,
        per_page,
        total_pages: ((total as f64) / (per_page as f64)).ceil() as u32,
    })
}

pub fn get_clean_email_for_shop(&self, shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
    // Find email IDs that have been used in this shop
    let used_id: Option<i64> = self.conn.query_row(
        "SELECT e.id FROM email_pool e
         WHERE e.is_blocked = 0
           AND e.id NOT IN (
               SELECT sf.email_id FROM shop_footprints sf WHERE sf.shop_id = ?1 AND sf.email_id IS NOT NULL
           )
         ORDER BY e.created_at ASC
         LIMIT 1",
        params![shop_id],
        |r| r.get(0),
    ).ok();

    match used_id {
        Some(id) => Ok(Some(self.get_email_by_id(id)?)),
        None => Ok(None),
    }
}

pub fn update_email(&self, id: i64, label: &str, notes: &str) -> Result<EmailPoolEntry, String> {
    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "UPDATE email_pool SET label = ?1, notes = ?2, updated_at = ?3 WHERE id = ?4",
        params![label, notes, now, id],
    ).map_err(|e| e.to_string())?;
    self.get_email_by_id(id)
}

pub fn block_email(&self, id: i64, blocked: bool) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "UPDATE email_pool SET is_blocked = ?1, updated_at = ?2 WHERE id = ?3",
        params![blocked, now, id],
    ).map_err(|e| e.to_string())?;
    self.log_event(
        if blocked { "email.blocked" } else { "email.unblocked" },
        Some(&format!("id={}", id)),
    )
}

pub fn delete_email(&self, id: i64) -> Result<(), String> {
    self.conn.execute("DELETE FROM email_pool WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.log_event("email.deleted", Some(&format!("id={}", id)))
}

// ─── Proxies ──────────────────────────────────────────────────

pub fn add_proxy(&self, input: ProxyInput) -> Result<Proxy, String> {
    if input.host.trim().is_empty() {
        return Err("host_required".to_string());
    }

    let enc = self.encryption.as_ref().ok_or("locked")?;
    let password_enc = if input.password.is_empty() {
        None
    } else {
        Some(enc.encrypt(&input.password).map_err(|e| e.to_string())?)
    };

    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "INSERT INTO proxies (host, port, proxy_type, username, password, label, notes, is_blocked, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
        params![
            input.host.trim(),
            input.port,
            input.proxy_type,
            if input.username.is_empty() { None } else { Some(input.username.clone()) },
            password_enc,
            if input.label.is_empty() { None } else { Some(input.label.clone()) },
            if input.notes.is_empty() { None } else { Some(input.notes.clone()) },
            now
        ],
    ).map_err(|e| {
        if e.to_string().contains("UNIQUE") { "proxy_duplicate".to_string() } else { e.to_string() }
    })?;

    let id = self.conn.last_insert_rowid();
    self.log_event("proxy.added", Some(&format!("id={}", id)))?;
    self.get_proxy_by_id(id)
}

fn get_proxy_by_id(&self, id: i64) -> Result<Proxy, String> {
    let enc = self.encryption.as_ref().ok_or("locked")?;

    let row: (String, i64, String, Option<String>, Option<String>, Option<String>, Option<String>, bool, String, String) =
        self.conn.query_row(
            "SELECT host, port, proxy_type, username, password, label, notes, is_blocked, created_at, updated_at
             FROM proxies WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
        ).map_err(|e| e.to_string())?;

    let password_dec = row.4.as_deref().and_then(|p| enc.decrypt(p).ok());
    let shops_used = self.get_shops_for_proxy(id).unwrap_or_default();

    Ok(Proxy {
        id,
        host: row.0,
        port: row.1,
        proxy_type: row.2,
        username: row.3,
        password: password_dec,
        label: row.5,
        notes: row.6,
        is_blocked: row.7,
        shops_used,
        created_at: row.8,
        updated_at: row.9,
    })
}

fn get_shops_for_proxy(&self, proxy_id: i64) -> Result<Vec<ShopRef>, String> {
    let mut stmt = self.conn.prepare(
        "SELECT DISTINCT s.id, s.name FROM shop_footprints sf
         JOIN shops s ON s.id = sf.shop_id
         WHERE sf.proxy_id = ?1"
    ).map_err(|e| e.to_string())?;

    stmt.query_map(params![proxy_id], |r| {
        Ok(ShopRef { id: r.get(0)?, name: r.get(1)? })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn import_proxies(&self, raw: &str) -> Result<ImportResult, String> {
    let mut parsed = 0u32;
    let mut skipped = 0u32;
    let mut errors: Vec<String> = Vec::new();

    for (line_no, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match parse_proxy_line(trimmed) {
            Ok(input) => {
                match self.add_proxy(input) {
                    Ok(_) => parsed += 1,
                    Err(e) if e == "proxy_duplicate" => skipped += 1,
                    Err(e) => {
                        skipped += 1;
                        errors.push(format!("line {}: {}", line_no + 1, e));
                    }
                }
            }
            Err(e) => {
                skipped += 1;
                errors.push(format!("line {}: {}", line_no + 1, e));
            }
        }
    }

    Ok(ImportResult { parsed, skipped, errors })
}

pub fn get_proxies(&self, filter: ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
    let offset = (page.saturating_sub(1)) * per_page;

    let mut conditions: Vec<String> = Vec::new();
    let mut bind_vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(blocked) = filter.is_blocked {
        conditions.push(format!("p.is_blocked = ?{}", bind_vals.len() + 1));
        bind_vals.push(Box::new(blocked as i64));
    }
    if let Some(ref ptype) = filter.proxy_type {
        conditions.push(format!("p.proxy_type = ?{}", bind_vals.len() + 1));
        bind_vals.push(Box::new(ptype.clone()));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total: u32 = {
        let sql = format!("SELECT COUNT(*) FROM proxies p {}", where_clause);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
        stmt.query_row(refs.as_slice(), |r| r.get(0)).map_err(|e| e.to_string())?
    };

    let sql = format!(
        "SELECT p.id FROM proxies p {} ORDER BY p.created_at DESC LIMIT ?{lim} OFFSET ?{off}",
        where_clause,
        lim = bind_vals.len() + 1,
        off = bind_vals.len() + 2
    );

    bind_vals.push(Box::new(per_page as i64));
    bind_vals.push(Box::new(offset as i64));

    let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();

    let ids: Vec<i64> = stmt.query_map(refs.as_slice(), |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let items: Vec<Proxy> = ids.iter()
        .filter_map(|id| self.get_proxy_by_id(*id).ok())
        .collect();

    Ok(PaginatedProxies {
        items,
        total,
        page,
        per_page,
        total_pages: ((total as f64) / (per_page as f64)).ceil() as u32,
    })
}

pub fn get_clean_proxy_for_shop(&self, shop_id: i64) -> Result<Option<Proxy>, String> {
    let id: Option<i64> = self.conn.query_row(
        "SELECT p.id FROM proxies p
         WHERE p.is_blocked = 0
           AND p.id NOT IN (
               SELECT sf.proxy_id FROM shop_footprints sf WHERE sf.shop_id = ?1 AND sf.proxy_id IS NOT NULL
           )
         ORDER BY p.created_at ASC
         LIMIT 1",
        params![shop_id],
        |r| r.get(0),
    ).ok();

    match id {
        Some(pid) => Ok(Some(self.get_proxy_by_id(pid)?)),
        None => Ok(None),
    }
}

pub fn update_proxy(&self, id: i64, input: ProxyInput) -> Result<Proxy, String> {
    let enc = self.encryption.as_ref().ok_or("locked")?;
    let password_enc = if input.password.is_empty() {
        None
    } else {
        Some(enc.encrypt(&input.password).map_err(|e| e.to_string())?)
    };
    let now = Utc::now().to_rfc3339();

    self.conn.execute(
        "UPDATE proxies SET host=?1, port=?2, proxy_type=?3, username=?4, password=?5,
         label=?6, notes=?7, updated_at=?8 WHERE id=?9",
        params![
            input.host.trim(),
            input.port,
            input.proxy_type,
            if input.username.is_empty() { None } else { Some(input.username) },
            password_enc,
            if input.label.is_empty() { None } else { Some(input.label) },
            if input.notes.is_empty() { None } else { Some(input.notes) },
            now,
            id
        ],
    ).map_err(|e| e.to_string())?;

    self.get_proxy_by_id(id)
}

pub fn block_proxy(&self, id: i64, blocked: bool) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "UPDATE proxies SET is_blocked = ?1, updated_at = ?2 WHERE id = ?3",
        params![blocked, now, id],
    ).map_err(|e| e.to_string())?;
    self.log_event(
        if blocked { "proxy.blocked" } else { "proxy.unblocked" },
        Some(&format!("id={}", id)),
    )
}

pub fn delete_proxy(&self, id: i64) -> Result<(), String> {
    self.conn.execute("DELETE FROM proxies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.log_event("proxy.deleted", Some(&format!("id={}", id)))
}

// ─── Proxy line parser ────────────────────────────────────────

fn parse_proxy_line(line: &str) -> Result<ProxyInput, String> {
    // Handle scheme://user:pass@host:port or scheme://host:port
    let (scheme, rest) = if let Some(pos) = line.find("://") {
        let s = &line[..pos];
        (s.to_lowercase(), line[pos + 3..].to_string())
    } else {
        ("".to_string(), line.to_string())
    };

    // Split user:pass@host:port
    let (auth, hostport) = if let Some(at_pos) = rest.rfind('@') {
        let auth_part = &rest[..at_pos];
        let hp = rest[at_pos + 1..].to_string();
        (Some(auth_part.to_string()), hp)
    } else {
        (None, rest)
    };

    // host:port:user:pass format (no scheme, no @)
    let parts: Vec<&str> = hostport.splitn(2, ':').collect();
    if parts.len() < 2 {
        return Err(format!("cannot parse proxy: {}", line));
    }

    let host = parts[0].to_string();
    let port: i64 = {
        // port might have more colons if hostport came with user:pass appended
        let port_str = parts[1].split(':').next().unwrap_or("");
        port_str.parse().map_err(|_| format!("invalid port in: {}", line))?
    };

    // username / password
    let (username, password) = if let Some(auth_str) = auth {
        let ap: Vec<&str> = auth_str.splitn(2, ':').collect();
        (ap[0].to_string(), ap.get(1).unwrap_or(&"").to_string())
    } else {
        // try host:port:user:pass format
        let all_parts: Vec<&str> = line.split(':').collect();
        if all_parts.len() >= 4 {
            (all_parts[2].to_string(), all_parts[3..].join(":"))
        } else {
            (String::new(), String::new())
        }
    };

    let proxy_type = match scheme.as_str() {
        "socks5" | "socks4" => scheme.clone(),
        "http" | "https" => "http".to_string(),
        _ => {
            if port == 1080 || port == 1081 { "socks5".to_string() } else { "http".to_string() }
        }
    };

    Ok(ProxyInput {
        host,
        port,
        proxy_type,
        username,
        password,
        label: String::new(),
        notes: String::new(),
    })
}
