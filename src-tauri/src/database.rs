//! SQLite database layer — migration runner + Database struct with all CC operations.

use rusqlite::{Connection, Result as SqlResult, params};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use crate::encryption::FieldEncryption;
use crate::models::*;
use crate::parser::{extract_bin_last4, luhn_valid};

pub const CURRENT_MIGRATION_VERSION: u32 = 1;

// ─────────────────────────────────────────
//  Database struct
// ─────────────────────────────────────────

pub struct Database {
    pub conn: Connection,
    pub encryption: Option<Arc<FieldEncryption>>,
    pub last_activity: Arc<Mutex<Instant>>,
    pub autolock_timeout: Option<Duration>,
}

impl Database {
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        init_db(&conn)?;
        Ok(Self {
            conn,
            encryption: None,
            last_activity: Arc::new(Mutex::new(Instant::now())),
            autolock_timeout: None,
        })
    }

    pub fn set_encryption(&mut self, enc: FieldEncryption) {
        self.encryption = Some(Arc::new(enc));
        self.touch_activity();
    }

    pub fn clear_encryption(&mut self) { self.encryption = None; }
    pub fn is_locked(&self) -> bool { self.encryption.is_none() }

    pub fn touch_activity(&self) {
        if let Ok(mut t) = self.last_activity.lock() { *t = Instant::now(); }
    }

    pub fn encrypt_field(&self, val: &str) -> Result<String, String> {
        match &self.encryption {
            Some(enc) => enc.encrypt(val),
            None      => Err("database_locked".into()),
        }
    }

    pub fn decrypt_field(&self, val: &str) -> Result<String, String> {
        match &self.encryption {
            Some(enc) => enc.decrypt(val),
            None      => Err("database_locked".into()),
        }
    }

    fn opt_encrypt(&self, val: Option<&str>) -> Result<Option<String>, String> {
        match val {
            Some(v) if !v.is_empty() => Ok(Some(self.encrypt_field(v)?)),
            _ => Ok(None),
        }
    }

    fn opt_decrypt(&self, val: Option<&str>) -> Result<Option<String>, String> {
        match val {
            Some(v) if !v.is_empty() => Ok(Some(self.decrypt_field(v)?)),
            _ => Ok(None),
        }
    }

    // ─────────────────────────────────────────
    //  Config helpers
    // ─────────────────────────────────────────

    pub fn get_config(&self, key: &str) -> SqlResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM config WHERE key=?1")?;
        let mut rows = stmt.query(params![key])?;
        Ok(if let Some(row) = rows.next()? { row.get(0)? } else { None })
    }

    pub fn set_config(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO config(key,value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn log_event(&self, event_type: &str, description: &str,
                     entity_type: Option<&str>, entity_id: Option<&str>) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO activity_log(event_type,description,entity_type,entity_id)
             VALUES(?1,?2,?3,?4)",
            params![event_type, description, entity_type, entity_id],
        )?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  CC Insert (bulk, transaction)
    // ─────────────────────────────────────────

    pub fn insert_cards(&self, cards: Vec<CardInput>) -> Result<usize, String> {
        let mut inserted = 0usize;

        // We run in a transaction but need to check for duplicate card_numbers.
        // Strategy: insert OR IGNORE on a unique index on card_number.
        // Since card_number is stored encrypted we can't use DB unique — 
        // instead we maintain a set of existing last4+expiry pairs and skip known hashes.
        // For simplicity: insert each card, ignore SQLITE_CONSTRAINT on the card_hash column.

        for card in cards {
            let (bin, last4) = extract_bin_last4(&card.card_number);

            let enc_number  = self.encrypt_field(&card.card_number)?;
            let enc_cvv     = self.opt_encrypt(card.cvv.as_deref())?;
            let enc_holder  = self.opt_encrypt(card.holder_name.as_deref())?;
            let enc_address = self.opt_encrypt(card.billing_address.as_deref())?;
            let enc_phone   = self.opt_encrypt(card.phone.as_deref())?;
            let enc_email   = self.opt_encrypt(card.email.as_deref())?;
            let enc_ip      = self.opt_encrypt(card.ip_address.as_deref())?;

            // Use a plaintext hash for duplicate detection (SHA-256 of raw number)
            let card_hash = {
                use sha2::{Digest, Sha256};
                let mut h = Sha256::new();
                h.update(card.card_number.as_bytes());
                format!("{:x}", h.finalize())
            };

            let result = self.conn.execute(
                "INSERT OR IGNORE INTO credit_cards
                 (card_number, expiry_date, cvv, holder_name, billing_address,
                  city, state, zip, country, phone, email, ip_address,
                  bin, last4, source, card_hash)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
                params![
                    enc_number, card.expiry_date, enc_cvv, enc_holder, enc_address,
                    card.city, card.state, card.zip, card.country,
                    enc_phone, enc_email, enc_ip,
                    bin, last4, card.source, card_hash
                ],
            ).map_err(|e| e.to_string())?;

            if result > 0 { inserted += 1; }
        }

        Ok(inserted)
    }

    // ─────────────────────────────────────────
    //  CC List
    // ─────────────────────────────────────────

    pub fn get_cards(&self, filter: &CardFilter, page: u32, per_page: u32) -> Result<PaginatedCards, String> {
        self.touch_activity();

        let offset = (page.saturating_sub(1)) * per_page;
        let mut conditions: Vec<String> = Vec::new();
        let mut params_list: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref s) = filter.status {
            conditions.push(format!("status = ?{}", params_list.len()+1));
            params_list.push(Box::new(s.clone()));
        }
        if let Some(ref s) = filter.country {
            conditions.push(format!("country = ?{}", params_list.len()+1));
            params_list.push(Box::new(s.clone()));
        }
        if let Some(ref s) = filter.bank_name {
            conditions.push(format!("bank_name = ?{}", params_list.len()+1));
            params_list.push(Box::new(s.clone()));
        }
        if let Some(ref s) = filter.source {
            conditions.push(format!("source = ?{}", params_list.len()+1));
            params_list.push(Box::new(s.clone()));
        }
        if let Some(ref s) = filter.card_type {
            conditions.push(format!("card_type = ?{}", params_list.len()+1));
            params_list.push(Box::new(s.clone()));
        }
        // search by last4 or bin (plaintext)
        if let Some(ref s) = filter.search {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                let cond_idx = params_list.len() + 1;
                conditions.push(format!(
                    "(last4 LIKE ?{0} OR bin LIKE ?{0} OR holder_name LIKE ?{0})",
                    cond_idx
                ));
                params_list.push(Box::new(format!("%{}%", trimmed)));
            }
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let count_sql = format!("SELECT COUNT(*) FROM credit_cards {}", where_clause);
        let data_sql  = format!(
            "SELECT id, bin, last4, expiry_date, holder_name, bank_name,
                    card_type, card_level, status, source, notes,
                    city, state, zip, country, created_at
             FROM credit_cards {} ORDER BY created_at DESC LIMIT ?{} OFFSET ?{}",
            where_clause,
            params_list.len() + 1,
            params_list.len() + 2,
        );

        // Build rusqlite param slices
        let sql_params: Vec<&dyn rusqlite::ToSql> = params_list.iter().map(|p| p.as_ref()).collect();

        // Count total
        let total: u32 = {
            let mut stmt = self.conn.prepare(&count_sql).map_err(|e| e.to_string())?;
            stmt.query_row(rusqlite::params_from_iter(sql_params.iter().copied()), |r| r.get(0))
                .map_err(|e| e.to_string())?
        };

        // Fetch rows
        let mut params_with_page = params_list;
        params_with_page.push(Box::new(per_page as i64));
        params_with_page.push(Box::new(offset as i64));
        let page_params: Vec<&dyn rusqlite::ToSql> = params_with_page.iter().map(|p| p.as_ref()).collect();

        let mut stmt = self.conn.prepare(&data_sql).map_err(|e| e.to_string())?;
        let items = stmt.query_map(rusqlite::params_from_iter(page_params.iter().copied()), |row| {
            Ok(Card {
                id:         row.get(0)?,
                bin:        row.get(1)?,
                last4:      row.get(2)?,
                expiry_date: row.get(3)?,
                holder_name: row.get(4)?,  // still encrypted here — masked in response
                bank_name:  row.get(5)?,
                card_type:  row.get(6)?,
                card_level: row.get(7)?,
                status:     row.get::<_, String>(8).unwrap_or_else(|_| "free".into()),
                source:     row.get::<_, String>(9).unwrap_or_default(),
                notes:      row.get(10)?,
                city:       row.get(11)?,
                state:      row.get(12)?,
                zip:        row.get(13)?,
                country:    row.get(14)?,
                created_at: row.get::<_, String>(15).unwrap_or_default(),
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .map(|mut c| {
              // Mask holder_name: decrypt → show only initials, else keep encrypted
              if let Some(ref enc) = c.holder_name {
                  c.holder_name = self.decrypt_field(enc)
                      .ok()
                      .map(|name| mask_name(&name))
                      .or(c.holder_name.clone());
              }
              c
          })
          .collect();

        let pages = (total + per_page - 1) / per_page;
        Ok(PaginatedCards { items, total, page, per_page })
    }

    // ─────────────────────────────────────────
    //  CC Reveal (full decryption)
    // ─────────────────────────────────────────

    pub fn get_card_decrypted(&self, id: i64) -> Result<CardDecrypted, String> {
        self.touch_activity();

        let row = self.conn.query_row(
            "SELECT id, card_number, expiry_date, cvv, holder_name, billing_address,
                    city, state, zip, country, phone, email, ip_address,
                    bin, last4, bank_name, card_type, card_level, status, source, notes, created_at
             FROM credit_cards WHERE id=?1",
            params![id],
            |r| Ok((
                r.get::<_,i64>(0)?,
                r.get::<_,Option<String>>(1)?,
                r.get::<_,Option<String>>(2)?,
                r.get::<_,Option<String>>(3)?,
                r.get::<_,Option<String>>(4)?,
                r.get::<_,Option<String>>(5)?,
                r.get::<_,Option<String>>(6)?,
                r.get::<_,Option<String>>(7)?,
                r.get::<_,Option<String>>(8)?,
                r.get::<_,Option<String>>(9)?,
                r.get::<_,Option<String>>(10)?,
                r.get::<_,Option<String>>(11)?,
                r.get::<_,Option<String>>(12)?,
                r.get::<_,Option<String>>(13)?,
                r.get::<_,Option<String>>(14)?,
                r.get::<_,Option<String>>(15)?,
                r.get::<_,Option<String>>(16)?,
                r.get::<_,Option<String>>(17)?,
                r.get::<_,String>(18)?,
                r.get::<_,String>(19)?,
                r.get::<_,Option<String>>(20)?,
                r.get::<_,String>(21)?,
            ))
        ).map_err(|e| e.to_string())?;

        Ok(CardDecrypted {
            id:              row.0,
            card_number:     row.1.as_deref().map(|v| self.decrypt_field(v)).transpose()?.unwrap_or_default(),
            expiry_date:     row.2.unwrap_or_default(),
            cvv:             row.3.as_deref().map(|v| self.decrypt_field(v)).transpose()?.unwrap_or_default(),
            holder_name:     row.4.as_deref().map(|v| self.decrypt_field(v)).transpose()?.unwrap_or_default(),
            billing_address: self.opt_decrypt(row.5.as_deref())?,
            city:            row.6,
            state:           row.7,
            zip:             row.8,
            country:         row.9,
            phone:           self.opt_decrypt(row.10.as_deref())?,
            email:           self.opt_decrypt(row.11.as_deref())?,
            ip_address:      self.opt_decrypt(row.12.as_deref())?,
            bin:             row.13,
            last4:           row.14,
            bank_name:       row.15,
            card_type:       row.16,
            card_level:      row.17,
            status:          row.18,
            source:          row.19,
            notes:           row.20,
            created_at:      row.21,
        })
    }

    // ─────────────────────────────────────────
    //  CC Mutations
    // ─────────────────────────────────────────

    pub fn update_card_status(&self, id: i64, status: &str) -> Result<(), String> {
        self.conn.execute(
            "UPDATE credit_cards SET status=?1 WHERE id=?2",
            params![status, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_card_notes(&self, id: i64, notes: &str) -> Result<(), String> {
        self.conn.execute(
            "UPDATE credit_cards SET notes=?1 WHERE id=?2",
            params![notes, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_card(&self, id: i64) -> Result<(), String> {
        // Guard: cannot delete in_use card
        let status: String = self.conn.query_row(
            "SELECT status FROM credit_cards WHERE id=?1",
            params![id],
            |r| r.get(0),
        ).map_err(|_| "card_not_found".to_string())?;

        if status == "in_use" {
            return Err("card_in_use".into());
        }

        self.conn.execute("DELETE FROM credit_cards WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn bulk_update_status(&self, ids: &[i64], status: &str) -> Result<(), String> {
        for &id in ids {
            self.conn.execute(
                "UPDATE credit_cards SET status=?1 WHERE id=?2",
                params![status, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn bulk_delete(&self, ids: &[i64]) -> Result<(), String> {
        for &id in ids {
            let status: Option<String> = self.conn.query_row(
                "SELECT status FROM credit_cards WHERE id=?1",
                params![id],
                |r| r.get(0),
            ).ok();
            if status.as_deref() != Some("in_use") {
                self.conn.execute("DELETE FROM credit_cards WHERE id=?1", params![id])
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    // ─────────────────────────────────────────
    //  BIN enrichment
    // ─────────────────────────────────────────

    pub fn enrich_card_bin(&self, card_id: i64, api_key: &str) -> Result<BinInfo, String> {
        if api_key.is_empty() { return Err("no_api_key".into()); }

        let bin: Option<String> = self.conn.query_row(
            "SELECT bin FROM credit_cards WHERE id=?1",
            params![card_id],
            |r| r.get(0),
        ).map_err(|_| "card_not_found".to_string())?;

        let bin = bin.ok_or("no_bin")?;
        fetch_bin_info(&bin, api_key)
            .map(|info| {
                // Update the card's meta fields
                let _ = self.conn.execute(
                    "UPDATE credit_cards SET bank_name=?1, card_type=?2, card_level=?3 WHERE id=?4",
                    params![info.bank_name, info.card_type, info.card_level, card_id],
                );
                info
            })
    }

    // ─────────────────────────────────────────
    //  Export
    // ─────────────────────────────────────────

    pub fn export_cards(&self, ids: &[i64], format: &str) -> Result<String, String> {
        let mut output = String::new();
        if format == "csv" {
            output.push_str("card_number,expiry_date,cvv,holder_name,email,phone,billing_address,city,state,country,zip\n");
        }

        for &id in ids {
            let c = self.get_card_decrypted(id)?;
            let row = format!(
                "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
                c.card_number,
                c.expiry_date,
                c.cvv,
                c.holder_name,
                c.email.as_deref().unwrap_or(""),
                c.phone.as_deref().unwrap_or(""),
                c.billing_address.as_deref().unwrap_or(""),
                c.city.as_deref().unwrap_or(""),
                c.state.as_deref().unwrap_or(""),
                c.country.as_deref().unwrap_or(""),
                c.zip.as_deref().unwrap_or(""),
            );
            if format == "csv" {
                output.push_str(&row.replace('|', ","));
            } else {
                output.push_str(&row);
            }
            output.push('\n');
        }

        Ok(output)
    }

    // ─────────────────────────────────────────
    //  Re-encrypt all on password change
    // ─────────────────────────────────────────

    pub fn reencrypt_all(&mut self, old_enc: &FieldEncryption, new_enc: &FieldEncryption) -> Result<(), String> {
        let reenc = |val: Option<&str>| -> Result<Option<String>, String> {
            match val {
                Some(v) if !v.is_empty() => Ok(Some(new_enc.reencrypt_from(old_enc, v)?)),
                _ => Ok(None),
            }
        };

        // credit_cards
        let rows: Vec<(i64, Option<String>, Option<String>, Option<String>, Option<String>,
                        Option<String>, Option<String>, Option<String>)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, card_number, cvv, holder_name, billing_address, phone, email, ip_address
                 FROM credit_cards"
            ).map_err(|e| e.to_string())?;
            stmt.query_map([], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
            ))).map_err(|e| e.to_string())?
               .filter_map(|r| r.ok())
               .collect()
        };
        for (id, cn, cvv, hn, ba, ph, em, ip) in rows {
            self.conn.execute(
                "UPDATE credit_cards SET card_number=?1, cvv=?2, holder_name=?3,
                 billing_address=?4, phone=?5, email=?6, ip_address=?7 WHERE id=?8",
                params![reenc(cn.as_deref())?, reenc(cvv.as_deref())?, reenc(hn.as_deref())?,
                         reenc(ba.as_deref())?, reenc(ph.as_deref())?,
                         reenc(em.as_deref())?, reenc(ip.as_deref())?, id],
            ).map_err(|e| e.to_string())?;
        }

        // email_pool
        let ep_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, email FROM email_pool").map_err(|e| e.to_string())?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect()
        };
        for (id, em) in ep_rows {
            self.conn.execute("UPDATE email_pool SET email=?1 WHERE id=?2",
                params![reenc(em.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        // proxies
        let pr_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, password FROM proxies").map_err(|e| e.to_string())?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect()
        };
        for (id, pw) in pr_rows {
            self.conn.execute("UPDATE proxies SET password=?1 WHERE id=?2",
                params![reenc(pw.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        // imap_accounts
        let im_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, password FROM imap_accounts").map_err(|e| e.to_string())?;
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect()
        };
        for (id, pw) in im_rows {
            self.conn.execute("UPDATE imap_accounts SET password=?1 WHERE id=?2",
                params![reenc(pw.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

// ─────────────────────────────────────────
//  BIN API fetch (standalone)
// ─────────────────────────────────────────

pub fn fetch_bin_info(bin: &str, api_key: &str) -> Result<BinInfo, String> {
    if api_key.is_empty() { return Err("no_api_key".into()); }

    let url = format!("https://api.iinapi.com/api/v1/{}?api_key={}", bin, api_key);
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("bin_api_error: {e}"))?;

    let json: serde_json::Value = resp.into_json()
        .map_err(|e| format!("bin_api_parse: {e}"))?;

    Ok(BinInfo {
        bin: bin.to_string(),
        bank_name:  json["bank"]["name"].as_str().map(String::from),
        card_type:  json["type"].as_str().map(String::from),
        card_level: json["brand"].as_str().map(String::from),
        country:    json["country"]["alpha2"].as_str().map(String::from),
        brand:      json["brand"].as_str().map(String::from),
    })
}

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

fn mask_name(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    parts.iter().enumerate().map(|(i, w)| {
        if i == 0 { w.to_string() }
        else { format!("{}.", &w[..1.min(w.len())]) }
    }).collect::<Vec<_>>().join(" ")
}

// ─────────────────────────────────────────
//  init_db — migration runner
// ─────────────────────────────────────────

pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 { migration_v1(conn)?; conn.execute_batch("PRAGMA user_version = 1")?; }
    Ok(())
}

fn migration_v1(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS credit_cards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number     TEXT,
            expiry_date     TEXT,
            cvv             TEXT,
            holder_name     TEXT,
            billing_address TEXT,
            city            TEXT,
            state           TEXT,
            zip             TEXT,
            country         TEXT,
            phone           TEXT,
            email           TEXT,
            ip_address      TEXT,
            bin             TEXT,
            last4           TEXT,
            bank_name       TEXT,
            card_type       TEXT,
            card_level      TEXT,
            status          TEXT NOT NULL DEFAULT 'free',
            source          TEXT NOT NULL DEFAULT 'dump',
            notes           TEXT,
            card_hash       TEXT UNIQUE,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_cards_status  ON credit_cards(status);
        CREATE INDEX IF NOT EXISTS idx_cards_bin     ON credit_cards(bin);
        CREATE INDEX IF NOT EXISTS idx_cards_last4   ON credit_cards(last4);
        CREATE INDEX IF NOT EXISTS idx_cards_country ON credit_cards(country);
        CREATE INDEX IF NOT EXISTS idx_cards_source  ON credit_cards(source);

        CREATE TABLE IF NOT EXISTS profiles (
            id         TEXT PRIMARY KEY,
            card_id    INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
            notes      TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_card ON profiles(card_id);

        CREATE TABLE IF NOT EXISTS drops (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
            recipient_name TEXT, address TEXT, city TEXT, state TEXT,
            zip TEXT, country TEXT, phone TEXT,
            is_primary     BOOLEAN NOT NULL DEFAULT 0,
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_drops_profile ON drops(profile_id);

        CREATE TABLE IF NOT EXISTS imap_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
            host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 993,
            login TEXT NOT NULL, password TEXT,
            poll_interval INTEGER NOT NULL DEFAULT 5,
            is_active BOOLEAN NOT NULL DEFAULT 1, last_checked DATETIME
        );

        CREATE TABLE IF NOT EXISTS email_pool (
            id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, label TEXT,
            imap_account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL,
            is_blocked BOOLEAN NOT NULL DEFAULT 0, notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS proxies (
            id INTEGER PRIMARY KEY AUTOINCREMENT, host TEXT NOT NULL, port INTEGER NOT NULL,
            username TEXT, password TEXT, type TEXT NOT NULL DEFAULT 'socks5',
            label TEXT, is_blocked BOOLEAN NOT NULL DEFAULT 0, notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shops (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            domain TEXT UNIQUE NOT NULL, url TEXT, category TEXT, notes TEXT,
            requires_cvv_match BOOLEAN NOT NULL DEFAULT 0,
            blocks_vpn BOOLEAN NOT NULL DEFAULT 0,
            phone_must_match BOOLEAN NOT NULL DEFAULT 0,
            accepts_amex BOOLEAN NOT NULL DEFAULT 0,
            requires_avs BOOLEAN NOT NULL DEFAULT 0,
            high_cancel_risk BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shop_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
            name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
            sku TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
            shop_id INTEGER REFERENCES shops(id) ON DELETE SET NULL,
            drop_id INTEGER REFERENCES drops(id) ON DELETE SET NULL,
            email_pool_id INTEGER REFERENCES email_pool(id) ON DELETE SET NULL,
            proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            order_number TEXT, status TEXT NOT NULL DEFAULT 'pending',
            items TEXT, total_amount REAL,
            tracking_number TEXT, carrier TEXT, notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_orders_profile ON orders(profile_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_shop    ON orders(shop_id);

        CREATE TABLE IF NOT EXISTS shop_footprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
            shop_domain TEXT, order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            email_hash TEXT, ip_hash TEXT, drop_hash TEXT, bin TEXT,
            phone_hash TEXT, name_hash TEXT, synced BOOLEAN NOT NULL DEFAULT 0,
            user_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_footprints_synced ON shop_footprints(synced);
        CREATE INDEX IF NOT EXISTS idx_footprints_shop   ON shop_footprints(shop_domain);

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
            description TEXT, entity_type TEXT, entity_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_log_event  ON activity_log(event_type);
        CREATE INDEX IF NOT EXISTS idx_log_entity ON activity_log(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS order_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            shop_tag TEXT, items TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    "#)?;
    Ok(())
}
