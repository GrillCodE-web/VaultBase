//! SQLite database layer — migration runner + Database struct with all CC operations.
#![allow(unused_imports, unused_variables, dead_code)]

use rusqlite::{Connection, Result as SqlResult, params};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use chrono::{Utc, Local};
use uuid::Uuid;
use crate::encryption::{FieldEncryption, hash_value};
use crate::models::*;
use crate::parser::{extract_bin_last4, luhn_valid};

pub const CURRENT_MIGRATION_VERSION: u32 = 2;

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

    pub fn log_event(&self, event_type: &str, description: &str, _category: Option<&str>, _entity_id: Option<&str>) -> Result<(), String> {
        self.conn.execute(
            "INSERT INTO activity_log(event_type,description) VALUES(?1,?2)",
            params![event_type, description],
        ).map_err(|e| e.to_string())?;
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
        if let Some(ref s) = filter.state {
            if !s.is_empty() {
                conditions.push(format!("state = ?{}", params_list.len()+1));
                params_list.push(Box::new(s.to_uppercase()));
            }
        }
        if let Some(ref s) = filter.zip_prefix {
            if !s.is_empty() {
                conditions.push(format!("zip LIKE ?{}", params_list.len()+1));
                params_list.push(Box::new(format!("{}%", s)));
            }
        }
        if filter.expiring_soon == Some(true) {
            // Cards expiring within 60 days
            conditions.push("expiry_date IS NOT NULL AND expiry_date != '' AND \
                (CAST(substr(expiry_date,4,2) AS INTEGER)+2000)*12 + CAST(substr(expiry_date,1,2) AS INTEGER) \
                BETWEEN \
                (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) \
                AND \
                (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) + 2".to_string());
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
        let free_total: u32 = self.conn
            .query_row("SELECT COUNT(*) FROM credit_cards WHERE status='free'", [], |r| r.get(0))
            .unwrap_or(0);
        Ok(PaginatedCards { items, total, free_total, page, per_page })
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
            let c: Vec<_> = stmt.query_map([], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
            ))).map_err(|e| e.to_string())?
               .filter_map(|r| r.ok())
               .collect();
            c
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
            let c: Vec<_> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect();
            c
        };
        for (id, em) in ep_rows {
            self.conn.execute("UPDATE email_pool SET email=?1 WHERE id=?2",
                params![reenc(em.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        // proxies
        let pr_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, password FROM proxies").map_err(|e| e.to_string())?;
            let c: Vec<_> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect();
            c
        };
        for (id, pw) in pr_rows {
            self.conn.execute("UPDATE proxies SET password=?1 WHERE id=?2",
                params![reenc(pw.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        // imap_accounts
        let im_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, password FROM imap_accounts").map_err(|e| e.to_string())?;
            let c: Vec<_> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect();
            c
        };
        for (id, pw) in im_rows {
            self.conn.execute("UPDATE imap_accounts SET password=?1 WHERE id=?2",
                params![reenc(pw.as_deref())?, id]).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    // ─────────────────────────────────────────
    //  Dashboard
    // ─────────────────────────────────────────

    pub fn get_dashboard_stats(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<DashboardStats, String> {
        let (start, end) = period_dates(period, from, to);

        // ── static counters ──
        let total_cc: i64 = self.conn.query_row("SELECT COUNT(*) FROM credit_cards", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let free_cc:  i64 = self.conn.query_row("SELECT COUNT(*) FROM credit_cards WHERE status='free'",   [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let in_use_cc:i64 = self.conn.query_row("SELECT COUNT(*) FROM credit_cards WHERE status='in_use'", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let dead_cc:  i64 = self.conn.query_row("SELECT COUNT(*) FROM credit_cards WHERE status='dead'",   [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let total_profiles: i64 = self.conn.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let no_drop_profiles: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM drops d WHERE d.profile_id=p.id)",
            [], |r| r.get(0),
        ).map_err(|e| e.to_string())?;

        // ── period order stats ──
        let (date_and, p_strs) = date_and_clause(&start, &end, "created_at");
        let sql = format!(
            "SELECT COUNT(*),\
             SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END),\
             SUM(CASE WHEN status='shipped'   THEN 1 ELSE 0 END),\
             SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),\
             SUM(CASE WHEN status='declined'  THEN 1 ELSE 0 END),\
             SUM(COALESCE(total_amount,0)),\
             SUM(CASE WHEN status='delivered' THEN COALESCE(total_amount,0) ELSE 0 END)\
             FROM orders{}",
            if date_and.is_empty() { String::new() } else { format!(" WHERE {}", date_and) }
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let (total_orders, pending, shipped, delivered, declined, revenue, net_profit): (i64, i64, i64, i64, i64, f64, f64) =
            self.conn.query_row(&sql, p_refs.as_slice(), |r| Ok((
                r.get::<_,i64>(0).unwrap_or(0),
                r.get::<_,i64>(1).unwrap_or(0),
                r.get::<_,i64>(2).unwrap_or(0),
                r.get::<_,i64>(3).unwrap_or(0),
                r.get::<_,i64>(4).unwrap_or(0),
                r.get::<_,f64>(5).unwrap_or(0.0),
                r.get::<_,f64>(6).unwrap_or(0.0),
            ))).map_err(|e| e.to_string())?;

        // ── trend: previous period ──
        let (orders_trend, revenue_trend, delivered_trend) = {
            let (ps, pe) = prev_period_dates(period);
            if ps.is_none() && pe.is_none() {
                (None, None, None)
            } else {
                let (da2, p2) = date_and_clause(&ps, &pe, "created_at");
                let sql2 = format!(
                    "SELECT COUNT(*),\
                     SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),\
                     SUM(COALESCE(total_amount,0))\
                     FROM orders{}",
                    if da2.is_empty() { String::new() } else { format!(" WHERE {}", da2) }
                );
                let p2r: Vec<&dyn rusqlite::ToSql> = p2.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                let (po, pd, pr): (i64, i64, f64) = self.conn.query_row(&sql2, p2r.as_slice(), |r| Ok((
                    r.get(0).unwrap_or(0),
                    r.get(1).unwrap_or(0),
                    r.get(2).unwrap_or(0.0),
                ))).map_err(|e| e.to_string())?;
                (
                    trend_pct(total_orders as f64, po as f64),
                    trend_pct(revenue, pr),
                    trend_pct(delivered as f64, pd as f64),
                )
            }
        };

        // ── alerts ──
        let mut alerts: Vec<Alert> = Vec::new();

        let stale: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE status='pending' AND created_at < datetime('now','-5 days')",
            [], |r| r.get(0),
        ).unwrap_or(0);
        if stale > 0 {
            alerts.push(Alert {
                level: "warn".into(),
                message: format!("{} pending orders older than 5 days", stale),
                action: "orders".into(),
                count: stale,
            });
        }

        if no_drop_profiles > 0 {
            alerts.push(Alert {
                level: "warn".into(),
                message: format!("{} profiles have no drop address", no_drop_profiles),
                action: "profiles".into(),
                count: no_drop_profiles,
            });
        }

        let bin_declined: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM (\
             SELECT cc.bin, o.shop_id FROM orders o\
             JOIN profiles p ON p.id=o.profile_id\
             JOIN credit_cards cc ON cc.id=p.card_id\
             WHERE o.status='declined' AND cc.bin IS NOT NULL AND o.shop_id IS NOT NULL\
             GROUP BY cc.bin, o.shop_id HAVING COUNT(*)>=3)",
            [], |r| r.get(0),
        ).unwrap_or(0);
        if bin_declined > 0 {
            alerts.push(Alert {
                level: "error".into(),
                message: format!("{} BIN/shop combinations with ≥3 declines", bin_declined),
                action: "orders".into(),
                count: bin_declined,
            });
        }

        Ok(DashboardStats {
            total_cc, free_cc, in_use_cc, dead_cc,
            total_profiles, no_drop_profiles,
            total_orders, pending, shipped, delivered, declined,
            revenue, net_profit,
            orders_trend, revenue_trend, delivered_trend,
            alerts,
        })
    }

    pub fn get_revenue_chart(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<RevenuePoint>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "created_at");
        let fmt = if period == "today" { "%H:00" } else { "%Y-%m-%d" };
        let sql = format!(
            "SELECT strftime('{}',created_at) as d,\
             SUM(COALESCE(total_amount,0)),\
             SUM(CASE WHEN status='delivered' THEN COALESCE(total_amount,0) ELSE 0 END)\
             FROM orders{}\
             GROUP BY d ORDER BY d",
            fmt,
            if date_and.is_empty() { String::new() } else { format!(" WHERE {}", date_and) }
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(RevenuePoint {
                date:    r.get(0)?,
                revenue: r.get::<_,f64>(1).unwrap_or(0.0),
                profit:  r.get::<_,f64>(2).unwrap_or(0.0),
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_heatmap_data(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<HeatmapCell>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let extra = if date_and.is_empty() { String::new() } else { format!(" AND {}", date_and) };
        let sql = format!(
            "SELECT cc.bank_name, s.name, COUNT(*) as tot,\
             SUM(CASE WHEN o.status IN ('shipped','delivered') THEN 1 ELSE 0 END) as ok\
             FROM orders o\
             JOIN profiles pr ON pr.id=o.profile_id\
             JOIN credit_cards cc ON cc.id=pr.card_id\
             JOIN shops s ON s.id=o.shop_id\
             WHERE cc.bank_name IS NOT NULL AND s.name IS NOT NULL{}\
             GROUP BY cc.bank_name, s.id HAVING tot>=3\
             ORDER BY tot DESC LIMIT 64",
            extra
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            let tot: i64 = r.get(2)?;
            let ok:  i64 = r.get(3)?;
            Ok(HeatmapCell {
                bank:         r.get(0)?,
                shop:         r.get(1)?,
                total:        tot,
                shipped:      ok,
                success_rate: if tot == 0 { 0.0 } else { ok as f64 / tot as f64 * 100.0 },
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_top_banks(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<BankStats>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let os_where = if date_and.is_empty() {
            "WHERE cc.bank_name IS NOT NULL".into()
        } else {
            format!("WHERE cc.bank_name IS NOT NULL AND {}", date_and)
        };
        let sql = format!(
            "WITH os AS (\
             SELECT cc.bank_name,COUNT(*) as to_,\
             SUM(CASE WHEN o.status IN('shipped','delivered')THEN 1 ELSE 0 END) as sh,\
             SUM(CASE WHEN o.status='declined' THEN 1 ELSE 0 END) as de,\
             SUM(COALESCE(o.total_amount,0)) as re\
             FROM orders o JOIN profiles p ON p.id=o.profile_id\
             JOIN credit_cards cc ON cc.id=p.card_id {} GROUP BY cc.bank_name),\
             cs AS (SELECT bank_name,COUNT(*) as tc,\
             SUM(CASE WHEN status='free' THEN 1 ELSE 0 END) as fc,\
             SUM(CASE WHEN status='dead' THEN 1 ELSE 0 END) as dc\
             FROM credit_cards WHERE bank_name IS NOT NULL GROUP BY bank_name)\
             SELECT cs.bank_name,cs.tc,cs.fc,cs.dc,\
             COALESCE(os.to_,0),COALESCE(os.sh,0),COALESCE(os.de,0),COALESCE(os.re,0.0),\
             CASE WHEN COALESCE(os.to_,0)=0 THEN 0.0 ELSE\
             CAST(COALESCE(os.sh,0) AS REAL)*100/CAST(COALESCE(os.to_,0) AS REAL) END\
             FROM cs LEFT JOIN os USING(bank_name)\
             ORDER BY COALESCE(os.to_,0) DESC LIMIT 20",
            os_where
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(BankStats {
                bank_name:    r.get(0)?,
                total_cards:  r.get(1)?,
                free_cards:   r.get(2)?,
                dead_cards:   r.get(3)?,
                total_orders: r.get(4)?,
                shipped:      r.get(5)?,
                declined:     r.get(6)?,
                revenue:      r.get::<_,f64>(7).unwrap_or(0.0),
                success_rate: r.get::<_,f64>(8).unwrap_or(0.0),
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_country(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<CountryStats>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let os_where = if date_and.is_empty() {
            "WHERE cc.country IS NOT NULL".into()
        } else {
            format!("WHERE cc.country IS NOT NULL AND {}", date_and)
        };
        let sql = format!(
            "WITH os AS (\
             SELECT cc.country,COUNT(*) as to_,\
             SUM(CASE WHEN o.status IN('shipped','delivered')THEN 1 ELSE 0 END) as sh,\
             SUM(COALESCE(o.total_amount,0)) as re\
             FROM orders o JOIN profiles p ON p.id=o.profile_id\
             JOIN credit_cards cc ON cc.id=p.card_id {} GROUP BY cc.country),\
             cs AS (SELECT country,COUNT(*) as tc,\
             SUM(CASE WHEN status='free' THEN 1 ELSE 0 END) as fc\
             FROM credit_cards WHERE country IS NOT NULL GROUP BY country)\
             SELECT cs.country,cs.tc,cs.fc,\
             COALESCE(os.to_,0),COALESCE(os.re,0.0),\
             CASE WHEN COALESCE(os.to_,0)=0 THEN 0.0 ELSE\
             CAST(COALESCE(os.sh,0) AS REAL)*100/CAST(COALESCE(os.to_,0) AS REAL) END\
             FROM cs LEFT JOIN os USING(country)\
             ORDER BY COALESCE(os.to_,0) DESC LIMIT 20",
            os_where
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(CountryStats {
                country:      r.get(0)?,
                total_cards:  r.get(1)?,
                free_cards:   r.get(2)?,
                total_orders: r.get(3)?,
                revenue:      r.get::<_,f64>(4).unwrap_or(0.0),
                success_rate: r.get::<_,f64>(5).unwrap_or(0.0),
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_by_source(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<SourceStats>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let os_where = if date_and.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", date_and)
        };
        let sql = format!(
            "WITH os AS (\
             SELECT p.card_id as cid,COUNT(*) as to_,\
             SUM(CASE WHEN o.status IN('shipped','delivered')THEN 1 ELSE 0 END) as sh,\
             SUM(COALESCE(o.total_amount,0)) as re\
             FROM orders o JOIN profiles p ON p.id=o.profile_id {} GROUP BY p.card_id),\
             cs AS (SELECT source,id,\
             CASE WHEN status='free' THEN 1 ELSE 0 END as is_free,\
             CASE WHEN status='dead' THEN 1 ELSE 0 END as is_dead\
             FROM credit_cards)\
             SELECT cs.source,COUNT(*) as tc,\
             SUM(cs.is_free) as fc,SUM(cs.is_dead) as dc,\
             COALESCE(SUM(os.to_),0),COALESCE(SUM(os.re),0.0),\
             CASE WHEN COALESCE(SUM(os.to_),0)=0 THEN 0.0 ELSE\
             CAST(COALESCE(SUM(os.sh),0) AS REAL)*100/CAST(COALESCE(SUM(os.to_),0) AS REAL) END\
             FROM cs LEFT JOIN os ON os.cid=cs.id\
             GROUP BY cs.source ORDER BY COALESCE(SUM(os.to_),0) DESC LIMIT 20",
            os_where
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(SourceStats {
                source:       r.get::<_,Option<String>>(0)?.unwrap_or_else(|| "—".into()),
                total_cards:  r.get(1)?,
                free_cards:   r.get(2)?,
                dead_cards:   r.get(3)?,
                total_orders: r.get(4)?,
                revenue:      r.get::<_,f64>(5).unwrap_or(0.0),
                success_rate: r.get::<_,f64>(6).unwrap_or(0.0),
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_expiring_cards_dashboard(&self, days: u32) -> Result<Vec<ExpiringCard>, String> {
        // holder_name is encrypted — decrypt it
        let rows: Vec<(i64, Option<String>, String, Option<String>)> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, last4, expiry_date, holder_name FROM credit_cards WHERE status != 'dead' AND expiry_date IS NOT NULL"
            ).map_err(|e| e.to_string())?;
            let collected: Vec<_> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            collected
        };

        let mut result = Vec::new();
        for (id, last4, expiry_date, enc_holder) in rows {
            if let Some(days_left) = parse_expiry_days_left(&expiry_date) {
                if days_left >= 0 && days_left <= days as i64 {
                    let holder_name = enc_holder.as_deref()
                        .and_then(|v| self.opt_decrypt(Some(v)).ok().flatten());
                    let has_profile: bool = self.conn.query_row(
                        "SELECT COUNT(*)>0 FROM profiles WHERE card_id=?1",
                        params![id], |r| r.get(0),
                    ).unwrap_or(false);
                    result.push(ExpiringCard { id, last4, expiry_date, holder_name, days_left, has_profile });
                }
            }
        }
        result.sort_by_key(|c| c.days_left);
        Ok(result)
    }

    pub fn export_dashboard_csv(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<String, String> {
        let stats = self.get_dashboard_stats(period, from, to)?;
        let banks = self.get_top_banks(period, from, to)?;

        let mut csv = String::from("CC Manager Dashboard Export\r\n\r\n");
        csv.push_str("Summary\r\n");
        csv.push_str(&format!("Total CC,{}\r\nFree CC,{}\r\nIn Use CC,{}\r\nDead CC,{}\r\n",
            stats.total_cc, stats.free_cc, stats.in_use_cc, stats.dead_cc));
        csv.push_str(&format!("Total Profiles,{}\r\nNo Drop,{}\r\n", stats.total_profiles, stats.no_drop_profiles));
        csv.push_str(&format!("Orders,{}\r\nPending,{}\r\nShipped,{}\r\nDelivered,{}\r\nDeclined,{}\r\n",
            stats.total_orders, stats.pending, stats.shipped, stats.delivered, stats.declined));
        csv.push_str(&format!("Revenue,{:.2}\r\nNet Profit,{:.2}\r\n\r\n", stats.revenue, stats.net_profit));

        csv.push_str("Top Banks\r\nBank,Cards,Free,Dead,Orders,Shipped,Declined,Revenue,Success%\r\n");
        for b in &banks {
            csv.push_str(&format!("{},{},{},{},{},{},{},{:.2},{:.1}\r\n",
                b.bank_name, b.total_cards, b.free_cards, b.dead_cards,
                b.total_orders, b.shipped, b.declined, b.revenue, b.success_rate));
        }
        Ok(csv)
    }

    pub fn get_sidebar_badges(&self) -> Result<SidebarBadges, String> {
        let pending_orders: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE status='pending'", [], |r| r.get(0),
        ).unwrap_or(0);

        let no_drop_profiles: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM drops d WHERE d.profile_id=p.id)",
            [], |r| r.get(0),
        ).unwrap_or(0);

        let clean_emails: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM email_pool WHERE is_blocked=0", [], |r| r.get(0),
        ).unwrap_or(0);

        let unsynced_footprints: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM shop_footprints WHERE synced=0", [], |r| r.get(0),
        ).unwrap_or(0);

        // expiring cards — cards expiring within 30 days
        let expiring_cards = self.get_expiring_cards_dashboard(30)
            .map(|v| v.len() as i64)
            .unwrap_or(0);

        Ok(SidebarBadges {
            pending_orders,
            expiring_cards,
            no_drop_profiles,
            clean_emails,
            unread_imap: 0, // placeholder until M10
            unsynced_footprints,
        })
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
    //  Dashboard helpers
    // ─────────────────────────────────────────

    fn period_dates(period: &str, from: Option<&str>, to: Option<&str>) -> (Option<String>, Option<String>) {
    use chrono::{Local, Duration};
    match period {
        "today" => {
            let now = Local::now();
            (Some(now.format("%Y-%m-%d 00:00:00").to_string()),
             Some(now.format("%Y-%m-%d 23:59:59").to_string()))
        }
        "7d" => {
            let now = Local::now();
            (Some((now - Duration::days(7)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some(now.format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "30d" => {
            let now = Local::now();
            (Some((now - Duration::days(30)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some(now.format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "custom" => {
            (from.map(|s| format!("{} 00:00:00", s)),
             to.map(|s| format!("{} 23:59:59", s)))
        }
        _ => (None, None), // "all"
    }
    }

    fn prev_period_dates(period: &str) -> (Option<String>, Option<String>) {
    use chrono::{Local, Duration};
    match period {
        "today" => {
            let yesterday = Local::now() - Duration::days(1);
            (Some(yesterday.format("%Y-%m-%d 00:00:00").to_string()),
             Some(yesterday.format("%Y-%m-%d 23:59:59").to_string()))
        }
        "7d" => {
            let now = Local::now();
            (Some((now - Duration::days(14)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some((now - Duration::days(7)).format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "30d" => {
            let now = Local::now();
            (Some((now - Duration::days(60)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some((now - Duration::days(30)).format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        _ => (None, None),
    }
    }

    /// Returns (WHERE conditions string, param values) for date range on `col`.
    /// The conditions string uses ?1/?2 placeholders starting from index 1.
    fn date_and_clause(start: &Option<String>, end: &Option<String>, col: &str) -> (String, Vec<String>) {
    let mut conds = Vec::new();
    let mut p = Vec::new();
    if let Some(s) = start {
        conds.push(format!("{}>= ?{}", col, p.len() + 1));
        p.push(s.clone());
    }
    if let Some(e) = end {
        conds.push(format!("{}<= ?{}", col, p.len() + 1));
        p.push(e.clone());
    }
    (conds.join(" AND "), p)
    }

    fn parse_expiry_days_left(expiry: &str) -> Option<i64> {
    use chrono::{Local, NaiveDate};
    let parts: Vec<&str> = expiry.split('/').collect();
    if parts.len() != 2 { return None; }
    let month: u32 = parts[0].trim().parse().ok()?;
    let year_str = parts[1].trim();
    let year: i32 = if year_str.len() == 2 {
        2000 + year_str.parse::<i32>().ok()?
    } else {
        year_str.parse().ok()?
    };
    let last_day = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?.pred_opt()?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?.pred_opt()?
    };
    let today = Local::now().date_naive();
    Some((last_day - today).num_days())
    }

    fn trend_pct(current: f64, prev: f64) -> Option<f64> {
    if prev == 0.0 { return None; }
    Some((current - prev) / prev * 100.0)
    }

impl Database {
    // ─────────────────────────────────────────
    //  IMAP Accounts
    // ─────────────────────────────────────────

    pub fn get_imap_accounts(&self) -> Result<Vec<ImapAccount>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,label,host,port,login,poll_interval,is_active,last_checked FROM imap_accounts ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(ImapAccount {
            id: r.get(0)?, label: r.get(1)?, host: r.get(2)?, port: r.get(3)?,
            login: r.get(4)?, poll_interval: r.get(5)?,
            is_active: r.get::<_,i64>(6).unwrap_or(1) != 0,
            last_checked: r.get(7)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_imap_account(&self, input: &ImapInput) -> Result<ImapAccount, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let enc_pw = self.encrypt_field(&input.password)?;
        self.conn.execute(
            "INSERT INTO imap_accounts(label,host,port,login,password,poll_interval,is_active) VALUES(?1,?2,?3,?4,?5,?6,1)",
            params![input.label, input.host, input.port, input.login, enc_pw, input.poll_interval],
        ).map_err(|e| e.to_string())?;
        let imap_id = self.conn.last_insert_rowid();

        // Auto-create Email Pool entry for this IMAP login if it doesn't already exist
        let existing: Option<i64> = self.conn.query_row(
            "SELECT id FROM email_pool WHERE email=?1", params![input.login], |r| r.get(0),
        ).ok();
        if let Some(email_id) = existing {
            // Link existing email pool entry to this IMAP account
            let _ = self.conn.execute(
                "UPDATE email_pool SET imap_account_id=?1 WHERE id=?2",
                params![imap_id, email_id],
            );
        } else {
            // Create new email pool entry and link it
            let _ = self.conn.execute(
                "INSERT INTO email_pool(email,label,imap_account_id,is_blocked,created_at,updated_at) VALUES(?1,?2,?3,0,datetime('now'),datetime('now'))",
                params![input.login, input.label, imap_id],
            );
        }

        Ok(ImapAccount {
            id: imap_id,
            label: input.label.clone(), host: input.host.clone(),
            port: input.port, login: input.login.clone(),
            poll_interval: input.poll_interval, is_active: true, last_checked: None,
        })
    }

    pub fn update_imap_account(&self, id: i64, input: &ImapInput) -> Result<(), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        if !input.password.is_empty() {
            let enc_pw = self.encrypt_field(&input.password)?;
            self.conn.execute(
                "UPDATE imap_accounts SET label=?1,host=?2,port=?3,login=?4,password=?5,poll_interval=?6 WHERE id=?7",
                params![input.label, input.host, input.port, input.login, enc_pw, input.poll_interval, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE imap_accounts SET label=?1,host=?2,port=?3,login=?4,poll_interval=?5 WHERE id=?6",
                params![input.label, input.host, input.port, input.login, input.poll_interval, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_imap_account(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM imap_accounts WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Link all existing IMAP accounts to Email Pool entries (create or update).
    /// Returns number of accounts processed.
    pub fn link_all_imap_to_email_pool(&self) -> Result<u32, String> {
        let accounts = self.get_imap_accounts()?;
        let mut count = 0u32;
        for acc in &accounts {
            let existing: Option<i64> = self.conn.query_row(
                "SELECT id FROM email_pool WHERE email=?1", params![acc.login], |r| r.get(0),
            ).ok();
            if let Some(email_id) = existing {
                let _ = self.conn.execute(
                    "UPDATE email_pool SET imap_account_id=?1 WHERE id=?2 AND (imap_account_id IS NULL OR imap_account_id != ?1)",
                    params![acc.id, email_id],
                );
            } else {
                let _ = self.conn.execute(
                    "INSERT INTO email_pool(email,label,imap_account_id,is_blocked,created_at,updated_at) VALUES(?1,?2,?3,0,datetime('now'),datetime('now'))",
                    params![acc.login, acc.label, acc.id],
                );
            }
            count += 1;
        }
        Ok(count)
    }

    pub fn toggle_imap_account(&self, id: i64, active: bool) -> Result<(), String> {
        self.conn.execute("UPDATE imap_accounts SET is_active=?1 WHERE id=?2", params![active as i64, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_imap_account_with_password(&self, id: i64) -> Result<(ImapAccount, String), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let (acc, enc_pw) = self.conn.query_row(
            "SELECT id,label,host,port,login,password,poll_interval,is_active,last_checked FROM imap_accounts WHERE id=?1",
            params![id],
            |r| Ok((ImapAccount {
                id: r.get(0)?, label: r.get(1)?, host: r.get(2)?, port: r.get(3)?,
                login: r.get(4)?, poll_interval: r.get(6)?,
                is_active: r.get::<_,i64>(7).unwrap_or(1) != 0,
                last_checked: r.get(8)?,
            }, r.get::<_,Option<String>>(5)?.unwrap_or_default())),
        ).map_err(|e| e.to_string())?;
        let pw = if enc_pw.is_empty() { String::new() } else { self.decrypt_field(&enc_pw)? };
        Ok((acc, pw))
    }

    pub fn update_imap_last_checked(&self, account_id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_accounts SET last_checked=datetime('now') WHERE id=?1", params![account_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  IMAP Messages
    // ─────────────────────────────────────────

    pub fn save_imap_message(&self, account_id: i64, uid: Option<&str>, subject: &str,
        from_email: &str, received_at: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>) -> Result<(), String>
    {
        // Skip if UID already saved for this account
        if let Some(u) = uid {
            let exists: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND message_uid=?2",
                params![account_id, u], |r| r.get(0),
            ).unwrap_or(0);
            if exists > 0 { return Ok(()); }
        }
        self.conn.execute(
            "INSERT INTO imap_messages(account_id,message_uid,subject,from_email,received_at,extracted_order_number,extracted_tracking,action_taken,processed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![account_id, uid, subject, from_email, received_at, order_num, tracking, action, action.is_some() as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_imap_messages(&self, filter: &ImapMsgFilter, page: u32, per_page: u32) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut w = vec!["1=1".to_string()];
        if let Some(aid) = filter.account_id { w.push(format!("account_id={}", aid)); }
        if let Some(p) = filter.processed { w.push(format!("processed={}", p as i64)); }
        if let Some(ref d) = filter.date_from { w.push(format!("DATE(received_at)>='{}'", d)); }
        if let Some(ref d) = filter.date_to   { w.push(format!("DATE(received_at)<='{}'", d)); }
        let where_clause = w.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM imap_messages WHERE {}", where_clause), [], |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!("SELECT id,account_id,message_uid,subject,from_email,received_at,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE {} ORDER BY id DESC LIMIT {} OFFSET {}", where_clause, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items: Vec<ImapMessage> = stmt.query_map([], |r| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, received_at: r.get(5)?,
            extracted_order_number: r.get(6)?, extracted_tracking: r.get(7)?,
            action_taken: r.get(8)?,
            processed: r.get::<_,i64>(9).unwrap_or(0) != 0,
            created_at: r.get(10)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let pages = ((total as u32) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    // ─────────────────────────────────────────
    //  Order helpers for IMAP
    // ─────────────────────────────────────────

    pub fn find_order_by_number(&self, order_number: &str) -> Result<Option<i64>, String> {
        let res = self.conn.query_row(
            "SELECT id FROM orders WHERE order_number=?1 LIMIT 1", params![order_number], |r| r.get(0),
        );
        match res {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn update_order_status_simple(&self, id: i64, status: &str, tracking: Option<&str>) -> Result<(), String> {
        if let Some(t) = tracking {
            self.conn.execute(
                "UPDATE orders SET status=?1, tracking_number=?2, updated_at=datetime('now') WHERE id=?3",
                params![status, t, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE orders SET status=?1, updated_at=datetime('now') WHERE id=?2",
                params![status, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Activity Log
    // ─────────────────────────────────────────

    pub fn get_activity_log(&self, filter: &LogFilter, page: u32, per_page: u32) -> Result<PaginatedLog, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut w = vec!["1=1".to_string()];
        if let Some(ref et) = filter.event_type {
            if et != "all" { w.push(format!("event_type LIKE '{}%'", et.replace('\'', "''"))); }
        }
        if let Some(ref d) = filter.from_date { w.push(format!("DATE(created_at)>='{}'", d)); }
        if let Some(ref d) = filter.to_date   { w.push(format!("DATE(created_at)<='{}'", d)); }
        if let Some(ref s) = filter.entity_type {
            if !s.is_empty() { w.push(format!("(event_type LIKE '%{}%' OR description LIKE '%{}%')", s, s)); }
        }
        let wh = w.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM activity_log WHERE {}", wh), [], |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!("SELECT id,event_type,description,entity_type,entity_id,created_at FROM activity_log WHERE {} ORDER BY id DESC LIMIT {} OFFSET {}", wh, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items = stmt.query_map([], |r| Ok(ActivityLog {
            id: r.get(0)?, event_type: r.get(1)?, description: r.get(2)?,
            entity_type: r.get(3)?, entity_id: r.get(4)?, created_at: r.get(5)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(PaginatedLog { items, total: total as u32, page, per_page })
    }

    pub fn clear_activity_log(&self) -> Result<(), String> {
        self.conn.execute("DELETE FROM activity_log", []).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Unsynced Footprints
    // ─────────────────────────────────────────

    pub fn get_unsynced_footprints_db(&self) -> Result<Vec<Footprint>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,shop_id,shop_domain,order_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced,user_token,created_at FROM shop_footprints WHERE synced=0 LIMIT 500"
        ).map_err(|e| e.to_string())?;
        let items = stmt.query_map([], |r| Ok(Footprint {
            id: r.get(0)?, shop_id: r.get(1)?, shop_domain: r.get(2)?, order_id: r.get(3)?,
            email_hash: r.get(4)?, ip_hash: r.get(5)?, drop_hash: r.get(6)?, bin: r.get(7)?,
            phone_hash: r.get(8)?, name_hash: r.get(9)?,
            synced: r.get::<_,i64>(10).unwrap_or(0) != 0,
            user_token: r.get(11)?, created_at: r.get(12)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    pub fn mark_footprints_synced_db(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        let placeholders = ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
        self.conn.execute_batch(&format!("UPDATE shop_footprints SET synced=1 WHERE id IN ({})", placeholders))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Global Search
    // ─────────────────────────────────────────

    pub fn global_search(&self, query: &str) -> Result<SearchResults, String> {
        use serde_json::json;
        let q = format!("%{}%", query.to_lowercase());
        let ql = format!("%{}%", query);

        // Cards — search by last4, bin
        let mut cards = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,last4,bin,bank_name,card_type,status FROM credit_cards WHERE last4 LIKE ?1 OR bin LIKE ?2 LIMIT 8"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![ql, ql], |r| {
            Ok(json!({
                "id": r.get::<_,i64>(0)?, "last4": r.get::<_,Option<String>>(1)?,
                "bin": r.get::<_,Option<String>>(2)?, "bank_name": r.get::<_,Option<String>>(3)?,
                "card_type": r.get::<_,Option<String>>(4)?, "status": r.get::<_,String>(5)?,
                "_type": "card",
            }))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { cards.push(v); } }

        // Orders — search by order_number
        let mut orders = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT o.id,o.order_number,o.status,s.name FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE o.order_number LIKE ?1 LIMIT 6"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![ql], |r| {
            Ok(json!({
                "id": r.get::<_,i64>(0)?, "order_number": r.get::<_,Option<String>>(1)?,
                "status": r.get::<_,String>(2)?, "shop_name": r.get::<_,Option<String>>(3)?,
                "_type": "order",
            }))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { orders.push(v); } }

        // Shops
        let mut shops = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,name,domain FROM shops WHERE LOWER(name) LIKE ?1 OR LOWER(domain) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "name": r.get::<_,String>(1)?, "domain": r.get::<_,String>(2)?, "_type": "shop"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { shops.push(v); } }

        // Emails
        let mut emails = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,email_hash,label FROM email_pool WHERE LOWER(label) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "label": r.get::<_,Option<String>>(2)?, "_type": "email"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { emails.push(v); } }

        // Proxies
        let mut proxies = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,host,port,label FROM proxies WHERE LOWER(label) LIKE ?1 OR LOWER(host) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "host": r.get::<_,String>(1)?, "port": r.get::<_,i64>(2)?, "label": r.get::<_,Option<String>>(3)?, "_type": "proxy"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { proxies.push(v); } }

        Ok(SearchResults { cards, profiles: vec![], orders, shops, emails, proxies })
    }
} // impl Database (IMAP/activity/search)

// ─────────────────────────────────────────
//  Profiles + Drops + Emails + Proxies + Shops + Orders
// ─────────────────────────────────────────
impl Database {

    // ── Profiles ──────────────────────────

    pub fn create_profile(&self, card_id: i64, notes: Option<String>) -> Result<Profile, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "INSERT INTO profiles(id,card_id,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",
            params![id, card_id, notes, now],
        ).map_err(|e| e.to_string())?;
        // Update card status to in_use
        let _ = self.conn.execute("UPDATE credit_cards SET status='in_use' WHERE id=?1 AND status='free'", params![card_id]);
        self.build_profile(&id)
    }

    fn build_profile(&self, id: &str) -> Result<Profile, String> {
        self.conn.query_row(
            "SELECT p.id,p.card_id,p.notes,p.created_at,p.updated_at,
                    c.bin,c.last4,c.bank_name,c.card_type,c.country,c.status,c.holder_name,
                    (SELECT COUNT(*) FROM drops WHERE profile_id=p.id) AS dc,
                    (SELECT COUNT(*) FROM orders WHERE profile_id=p.id) AS oc
             FROM profiles p LEFT JOIN credit_cards c ON p.card_id=c.id WHERE p.id=?1",
            params![id],
            |r| {
                let holder_enc: Option<String> = r.get(11)?;
                Ok((
                    r.get::<_,String>(0)?, r.get::<_,i64>(1)?, r.get::<_,Option<String>>(2)?,
                    r.get::<_,String>(3)?, r.get::<_,String>(4)?,
                    r.get::<_,Option<String>>(5)?, r.get::<_,Option<String>>(6)?,
                    r.get::<_,Option<String>>(7)?, r.get::<_,Option<String>>(8)?,
                    r.get::<_,Option<String>>(9)?, r.get::<_,Option<String>>(10)?,
                    holder_enc, r.get::<_,i64>(12)?, r.get::<_,i64>(13)?,
                ))
            },
        ).map_err(|e| e.to_string())
        .map(|(pid,card_id,notes,ca,ua,bin,last4,bank,ctype,country,cstatus,holder_enc,dc,oc)| {
            let holder_masked = holder_enc.as_deref()
                .and_then(|h| self.decrypt_field(h).ok())
                .map(|n| mask_name(&n));
            Profile { id: pid, card_id, notes, created_at: ca, updated_at: ua,
                bin, last4, bank_name: bank, card_type: ctype, country, card_status: cstatus,
                holder_masked, drop_count: dc, order_count: oc }
        })
    }

    pub fn get_profiles(&self, filter: &ProfileFilter, page: u32, per_page: u32) -> Result<PaginatedProfiles, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut where_parts = vec!["1=1".to_string()];
        if let Some(true) = filter.has_drop {
            where_parts.push("(SELECT COUNT(*) FROM drops WHERE profile_id=p.id)>0".into());
        }
        if let Some(false) = filter.has_drop {
            where_parts.push("(SELECT COUNT(*) FROM drops WHERE profile_id=p.id)=0".into());
        }
        if let Some(ref s) = filter.search {
            let escaped = s.replace('\'', "''");
            where_parts.push(format!(
                "(c.last4 LIKE '%{0}%' OR c.bin LIKE '%{0}%' OR c.bank_name LIKE '%{0}%')", escaped
            ));
        }
        if let Some(ref cs) = filter.card_status {
            let escaped = cs.replace('\'', "''");
            where_parts.push(format!("c.status = '{}'", escaped));
        }
        let wh = where_parts.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM profiles p LEFT JOIN credit_cards c ON p.card_id=c.id WHERE {}", wh), [], |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!(
            "SELECT p.id FROM profiles p LEFT JOIN credit_cards c ON p.card_id=c.id WHERE {} ORDER BY p.created_at DESC LIMIT {} OFFSET {}",
            wh, pp, offset
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let items: Vec<Profile> = ids.iter().filter_map(|id| self.build_profile(id).ok()).collect();
        let total_pages = ((total as u32).saturating_sub(1) / per_page.max(1)) + 1;
        Ok(PaginatedProfiles { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn get_profile_detail(&self, id: &str) -> Result<ProfileDetail, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let profile = self.build_profile(id)?;
        let card = self.get_card_decrypted(profile.card_id)?;
        let drops = self.get_drops_for_profile(id)?;
        let orders = self.get_orders_summary_for_profile(id)?;
        Ok(ProfileDetail { profile, card, drops, orders })
    }

    fn get_drops_for_profile(&self, profile_id: &str) -> Result<Vec<Drop>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at FROM drops WHERE profile_id=?1 ORDER BY is_primary DESC,id ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![profile_id], |r| Ok(Drop {
            id: r.get(0)?, profile_id: r.get(1)?, recipient_name: r.get(2)?,
            address: r.get(3)?, city: r.get(4)?, state: r.get(5)?,
            zip: r.get(6)?, country: r.get(7)?, phone: r.get(8)?,
            is_primary: r.get::<_,i64>(9)? != 0,
            created_at: r.get(10)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    fn get_orders_summary_for_profile(&self, profile_id: &str) -> Result<Vec<OrderSummary>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id,o.status,s.name,o.total_amount,o.tracking_number,o.created_at FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE o.profile_id=?1 ORDER BY o.created_at DESC LIMIT 20"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![profile_id], |r| Ok(OrderSummary {
            id: r.get(0)?, status: r.get(1)?, shop_name: r.get(2)?,
            total_amount: r.get(3)?, tracking_number: r.get(4)?, created_at: r.get(5)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn update_profile_notes(&self, id: &str, notes: &str) -> Result<(), String> {
        self.conn.execute(
            "UPDATE profiles SET notes=?1,updated_at=datetime('now') WHERE id=?2",
            params![notes, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_profile(&self, id: &str) -> Result<(), String> {
        let active_order_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE profile_id=?1 AND status NOT IN ('delivered', 'declined', 'cancelled')",
            params![id],
            |r| r.get(0),
        ).unwrap_or(0);
        if active_order_count > 0 {
            return Err("Cannot delete profile: it has active orders".to_string());
        }
        self.conn.execute("DELETE FROM profiles WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn duplicate_profile(&self, id: &str) -> Result<Profile, String> {
        let src = self.build_profile(id)?;
        self.create_profile(src.card_id, src.notes.map(|n| format!("{} (copy)", n)))
    }

    pub fn find_duplicate_profiles(&self) -> Result<Vec<Vec<Profile>>, String> {
        // Profiles sharing the same card_id
        let mut stmt = self.conn.prepare(
            "SELECT p1.id, p2.id FROM profiles p1 JOIN profiles p2 ON p1.card_id=p2.card_id AND p1.id<p2.id LIMIT 50"
        ).map_err(|e| e.to_string())?;
        let mut pairs: Vec<(String,String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let mut groups: Vec<Vec<Profile>> = vec![];
        for (a, b) in pairs {
            if let (Ok(pa), Ok(pb)) = (self.build_profile(&a), self.build_profile(&b)) {
                groups.push(vec![pa, pb]);
            }
        }
        Ok(groups)
    }

    // ── Drops ─────────────────────────────

    pub fn add_drop(&self, profile_id: &str, drop: &DropInput) -> Result<Drop, String> {
        // Make first drop primary automatically
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM drops WHERE profile_id=?1", params![profile_id], |r| r.get(0),
        ).unwrap_or(0);
        let is_primary = count == 0;
        self.conn.execute(
            "INSERT INTO drops(profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,datetime('now'))",
            params![profile_id, drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country, drop.phone, is_primary as i64],
        ).map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid();
        Ok(Drop {
            id, profile_id: profile_id.to_string(),
            recipient_name: drop.recipient_name.clone(), address: drop.address.clone(),
            city: drop.city.clone(), state: Some(drop.state.clone()), zip: drop.zip.clone(),
            country: drop.country.clone(), phone: Some(drop.phone.clone()),
            is_primary, created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        })
    }

    pub fn update_drop(&self, id: i64, drop: &DropInput) -> Result<(), String> {
        self.conn.execute(
            "UPDATE drops SET recipient_name=?1,address=?2,city=?3,state=?4,zip=?5,country=?6,phone=?7 WHERE id=?8",
            params![drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country, drop.phone, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_drop(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM drops WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_primary_drop(&self, id: i64, profile_id: &str) -> Result<(), String> {
        self.conn.execute("UPDATE drops SET is_primary=0 WHERE profile_id=?1", params![profile_id]).map_err(|e| e.to_string())?;
        self.conn.execute("UPDATE drops SET is_primary=1 WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn import_drops(&self, profile_id: &str, rows: Vec<DropInput>) -> Result<ImportResult, String> {
        let total = rows.len() as u32;
        let mut imported = 0u32;
        for row in rows {
            if let Ok(_) = self.add_drop(profile_id, &row) { imported += 1; }
        }
        Ok(ImportResult { total, imported, skipped: total - imported, errors: vec![] })
    }

    pub fn find_duplicate_drops(&self) -> Result<Vec<Vec<Drop>>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at FROM drops WHERE address IN (SELECT address FROM drops GROUP BY LOWER(address) HAVING COUNT(*)>1) ORDER BY LOWER(address)"
        ).map_err(|e| e.to_string())?;
        let drops: Vec<Drop> = stmt.query_map([], |r| Ok(Drop {
            id: r.get(0)?, profile_id: r.get(1)?, recipient_name: r.get(2)?,
            address: r.get(3)?, city: r.get(4)?, state: r.get(5)?, zip: r.get(6)?,
            country: r.get(7)?, phone: r.get(8)?,
            is_primary: r.get::<_,i64>(9)? != 0, created_at: r.get(10)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        // Group by address
        let mut groups: std::collections::HashMap<String, Vec<Drop>> = Default::default();
        for d in drops { groups.entry(d.address.to_lowercase()).or_default().push(d); }
        Ok(groups.into_values().filter(|v| v.len() > 1).collect())
    }

    // ── Email Pool ────────────────────────

    fn email_hash(email: &str) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(email.to_lowercase().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn build_email_entry(&self, id: i64) -> Result<EmailPoolEntry, String> {
        let (email_enc, label, notes, is_blocked, imap_id, created_at, updated_at): (String, Option<String>, Option<String>, i64, Option<i64>, String, String) =
            self.conn.query_row(
                "SELECT email,label,notes,is_blocked,imap_account_id,created_at,updated_at FROM email_pool WHERE id=?1",
                params![id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))
            ).map_err(|e| e.to_string())?;
        let email = if email_enc.is_empty() { String::new() } else {
            self.decrypt_field(&email_enc).unwrap_or_else(|_| email_enc.clone())
        };
        let shops_used = self.email_shops_used(id)?;
        Ok(EmailPoolEntry { id, email, label, notes, is_blocked: is_blocked != 0,
            imap_account_id: imap_id, shops_used, created_at, updated_at })
    }

    fn email_shops_used(&self, email_id: i64) -> Result<Vec<ShopRef>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT s.id,s.name FROM orders o JOIN shops s ON o.shop_id=s.id WHERE o.email_pool_id=?1 LIMIT 10"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![email_id], |r| Ok(ShopRef { id: r.get(0)?, name: r.get(1)? }))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_email(&self, email: &str, label: Option<String>, notes: Option<String>) -> Result<EmailPoolEntry, String> {
        let hash = Self::email_hash(email);
        let enc = self.encrypt_field(email)?;
        self.conn.execute(
            "INSERT INTO email_pool(email,email_hash,label,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,datetime('now'),datetime('now'))",
            params![enc, hash, label, notes],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "email_already_exists".to_string() } else { e.to_string() }
        })?;
        self.build_email_entry(self.conn.last_insert_rowid())
    }

    pub fn get_emails(&self, filter: &EmailFilter, page: u32, per_page: u32) -> Result<PaginatedEmails, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut wheres: Vec<String> = Vec::new();
        if let Some(blocked) = filter.is_blocked {
            wheres.push(format!("e.is_blocked={}", blocked as i64));
        }
        if let Some(used) = filter.is_used {
            if used {
                wheres.push("EXISTS (SELECT 1 FROM orders o WHERE o.email_pool_id=e.id)".to_string());
            } else {
                wheres.push("NOT EXISTS (SELECT 1 FROM orders o WHERE o.email_pool_id=e.id)".to_string());
            }
        }
        let where_clause = if wheres.is_empty() { String::new() } else { format!("WHERE {}", wheres.join(" AND ")) };
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM email_pool e {}", where_clause), [], |r| r.get(0)
        ).unwrap_or(0);
        let mut stmt = self.conn.prepare(
            &format!("SELECT e.id FROM email_pool e {} ORDER BY e.created_at DESC LIMIT {} OFFSET {}", where_clause, pp, offset)
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let items: Vec<EmailPoolEntry> = ids.iter().filter_map(|&id| self.build_email_entry(id).ok()).collect();
        let total_pages = ((total as u32).saturating_sub(1) / per_page.max(1)) + 1;
        Ok(PaginatedEmails { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn update_email(&self, id: i64, label: Option<String>, notes: Option<String>) -> Result<(), String> {
        self.conn.execute(
            "UPDATE email_pool SET label=?1,notes=?2,updated_at=datetime('now') WHERE id=?3",
            params![label, notes, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn block_email(&self, id: i64, blocked: bool) -> Result<(), String> {
        self.conn.execute("UPDATE email_pool SET is_blocked=?1,updated_at=datetime('now') WHERE id=?2",
            params![blocked as i64, id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_email(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM email_pool WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_clean_email_for_shop(&self, shop_id: i64) -> Result<Option<EmailPoolEntry>, String> {
        // Email that is not blocked AND not used in any order for this shop
        let id: Option<i64> = self.conn.query_row(
            "SELECT e.id FROM email_pool e WHERE e.is_blocked=0 AND e.id NOT IN (SELECT email_pool_id FROM orders WHERE shop_id=?1 AND email_pool_id IS NOT NULL) ORDER BY RANDOM() LIMIT 1",
            params![shop_id], |r| r.get(0),
        ).ok();
        match id {
            Some(i) => Ok(Some(self.build_email_entry(i)?)),
            None => Ok(None),
        }
    }

    pub fn link_email_to_imap(&self, email_id: i64, account_id: i64) -> Result<(), String> {
        self.conn.execute("UPDATE email_pool SET imap_account_id=?1 WHERE id=?2", params![account_id, email_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Proxies ───────────────────────────

    fn build_proxy(&self, id: i64) -> Result<Proxy, String> {
        let (host, port, ptype, username, pw_enc, label, notes, is_blocked, created_at, updated_at):
            (String, i64, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, String, String) =
            self.conn.query_row(
                "SELECT host,port,proxy_type,username,password,label,notes,is_blocked,created_at,updated_at FROM proxies WHERE id=?1",
                params![id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?))
            ).map_err(|e| e.to_string())?;
        let password = pw_enc.as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| self.decrypt_field(s).ok());
        let shops_used = self.proxy_shops_used(id)?;
        Ok(Proxy { id, host, port, proxy_type: ptype, username, password, label, notes,
            is_blocked: is_blocked != 0, shops_used, created_at, updated_at })
    }

    fn proxy_shops_used(&self, proxy_id: i64) -> Result<Vec<ShopRef>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT s.id,s.name FROM orders o JOIN shops s ON o.shop_id=s.id WHERE o.proxy_id=?1 LIMIT 10"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![proxy_id], |r| Ok(ShopRef { id: r.get(0)?, name: r.get(1)? }))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_proxy(&self, input: &ProxyInput) -> Result<Proxy, String> {
        let enc_pw = if input.password.is_empty() { String::new() } else { self.encrypt_field(&input.password)? };
        self.conn.execute(
            "INSERT INTO proxies(host,port,proxy_type,username,password,label,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,datetime('now'),datetime('now'))",
            params![input.host, input.port, input.proxy_type, input.username, enc_pw, input.label, input.notes],
        ).map_err(|e| e.to_string())?;
        self.build_proxy(self.conn.last_insert_rowid())
    }

    pub fn import_proxies(&self, raw: &str) -> Result<ImportResult, String> {
        let mut imported = 0u32;
        let mut skipped = 0u32;
        let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
        let total = lines.len() as u32;
        for line in lines {
            // Format: host:port or host:port:user:pass
            let parts: Vec<&str> = line.trim().splitn(4, ':').collect();
            if parts.len() < 2 { skipped += 1; continue; }
            let host = parts[0].to_string();
            let port: i64 = parts[1].parse().unwrap_or(0);
            if port == 0 { skipped += 1; continue; }
            let username = parts.get(2).map(|s| s.to_string()).unwrap_or_default();
            let password = parts.get(3).map(|s| s.to_string()).unwrap_or_default();
            let input = ProxyInput {
                host, port, proxy_type: "http".into(), username, password,
                label: String::new(), notes: String::new(),
            };
            match self.add_proxy(&input) {
                Ok(_) => imported += 1,
                Err(_) => skipped += 1,
            }
        }
        Ok(ImportResult { total, imported, skipped, errors: vec![] })
    }

    pub fn get_proxies(&self, filter: &ProxyFilter, page: u32, per_page: u32) -> Result<PaginatedProxies, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut wheres: Vec<String> = Vec::new();
        if let Some(b) = filter.is_blocked { wheres.push(format!("is_blocked={}", b as i64)); }
        if let Some(u) = filter.is_used {
            if u { wheres.push("EXISTS(SELECT 1 FROM orders o WHERE o.proxy_id=proxies.id)".into()); }
            else  { wheres.push("NOT EXISTS(SELECT 1 FROM orders o WHERE o.proxy_id=proxies.id)".into()); }
        }
        if let Some(ref t) = filter.proxy_type { wheres.push(format!("proxy_type='{}'", t.replace('\'', "''"))); }
        let where_clause = if wheres.is_empty() { String::new() } else { format!("WHERE {}", wheres.join(" AND ")) };
        let count_sql = format!("SELECT COUNT(*) FROM proxies {}", where_clause);
        let total: i64 = self.conn.query_row(&count_sql, [], |r| r.get(0)).unwrap_or(0);
        let sql = format!("SELECT id FROM proxies {} ORDER BY created_at DESC LIMIT {} OFFSET {}", where_clause, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let items: Vec<Proxy> = ids.iter().filter_map(|&id| self.build_proxy(id).ok()).collect();
        let total_pages = ((total as u32).saturating_sub(1) / per_page.max(1)) + 1;
        Ok(PaginatedProxies { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn update_proxy(&self, id: i64, input: &ProxyInput) -> Result<(), String> {
        let enc_pw = if input.password.is_empty() { String::new() } else { self.encrypt_field(&input.password)? };
        self.conn.execute(
            "UPDATE proxies SET host=?1,port=?2,proxy_type=?3,username=?4,password=?5,label=?6,notes=?7,updated_at=datetime('now') WHERE id=?8",
            params![input.host, input.port, input.proxy_type, input.username, enc_pw, input.label, input.notes, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn block_proxy(&self, id: i64, blocked: bool) -> Result<(), String> {
        self.conn.execute("UPDATE proxies SET is_blocked=?1,updated_at=datetime('now') WHERE id=?2",
            params![blocked as i64, id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_proxy(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM proxies WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Shops ─────────────────────────────

    fn extract_domain(url: &str) -> String {
        let s = url.trim_start_matches("https://").trim_start_matches("http://");
        s.split('/').next().unwrap_or(s).to_lowercase()
    }

    fn build_shop(&self, id: i64) -> Result<Shop, String> {
        let (name,domain,url,cat,notes,rcvv,bvpn,pmatch,amex,avs,hcr,ca,ua): (String,String,String,Option<String>,Option<String>,i64,i64,i64,i64,i64,i64,String,String) =
            self.conn.query_row(
                "SELECT name,domain,url,category,notes,requires_cvv_match,blocks_vpn,phone_must_match,accepts_amex,requires_avs,high_cancel_risk,created_at,updated_at FROM shops WHERE id=?1",
                params![id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?))
            ).map_err(|e| e.to_string())?;
        let (total_orders, delivered, declined, total_amount): (i64,i64,i64,f64) =
            self.conn.query_row(
                "SELECT COUNT(*),SUM(status='delivered'),SUM(status IN ('declined','failed')),COALESCE(SUM(total_amount),0) FROM orders WHERE shop_id=?1",
                params![id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1).unwrap_or(0),r.get::<_,i64>(2).unwrap_or(0),r.get::<_,f64>(3)?))
            ).unwrap_or((0,0,0,0.0));
        let success_rate = if total_orders > 0 { delivered as f64 / total_orders as f64 * 100.0 } else { 0.0 };
        let avg_order_value = if total_orders > 0 { total_amount / total_orders as f64 } else { 0.0 };
        Ok(Shop { id, name, domain, url, category: cat, notes, success_rate, avg_order_value,
            requires_cvv_match: rcvv!=0, blocks_vpn: bvpn!=0, phone_must_match: pmatch!=0,
            accepts_amex: amex!=0, requires_avs: avs!=0, high_cancel_risk: hcr!=0,
            total_orders, delivered, declined, created_at: ca, updated_at: ua })
    }

    pub fn create_shop(&self, input: &ShopInput) -> Result<Shop, String> {
        let domain = Self::extract_domain(&input.url);
        if domain.is_empty() { return Err("invalid_url".into()); }
        self.conn.execute(
            "INSERT INTO shops(name,domain,url,category,notes,requires_cvv_match,blocks_vpn,phone_must_match,accepts_amex,requires_avs,high_cancel_risk,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,datetime('now'),datetime('now'))",
            params![input.name, domain, input.url, input.category, input.notes,
                    input.requires_cvv_match as i64, input.blocks_vpn as i64, input.phone_must_match as i64,
                    input.accepts_amex as i64, input.requires_avs as i64, input.high_cancel_risk as i64],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "domain_already_exists".to_string() } else { e.to_string() }
        })?;
        self.build_shop(self.conn.last_insert_rowid())
    }

    pub fn get_shops(&self, page: u32, per_page: u32, search: &str) -> Result<PaginatedShops, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let wh = if search.is_empty() { "1=1".to_string() } else {
            format!("(LOWER(name) LIKE '%{}%' OR LOWER(domain) LIKE '%{}%')",
                search.to_lowercase().replace('\'', "''"), search.to_lowercase().replace('\'', "''"))
        };
        let total: i64 = self.conn.query_row(&format!("SELECT COUNT(*) FROM shops WHERE {}", wh), [], |r| r.get(0)).unwrap_or(0);
        let mut stmt = self.conn.prepare(&format!("SELECT id FROM shops WHERE {} ORDER BY created_at DESC LIMIT {} OFFSET {}", wh, pp, offset)).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let items: Vec<Shop> = ids.iter().filter_map(|&id| self.build_shop(id).ok()).collect();
        let total_pages = ((total as u32).saturating_sub(1) / per_page.max(1)) + 1;
        Ok(PaginatedShops { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn get_shop_detail(&self, id: i64) -> Result<ShopDetail, String> {
        let shop = self.build_shop(id)?;
        let stats = self.get_shop_stats(id)?;
        let recent_orders = self.get_orders_summary_for_shop(id)?;
        let products = self.get_shop_products(id)?;
        Ok(ShopDetail { shop, stats, recent_orders, products })
    }

    fn get_shop_stats(&self, shop_id: i64) -> Result<ShopStats, String> {
        let r: (i64,i64,i64,i64,i64,i64,i64,f64) = self.conn.query_row(
            "SELECT COUNT(*), SUM(status='pending'), SUM(status='processing'), SUM(status='shipped'), SUM(status='delivered'), SUM(status IN ('declined','failed')), SUM(status='cancelled'), COALESCE(AVG(total_amount),0) FROM orders WHERE shop_id=?1",
            params![shop_id], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1).unwrap_or(0),r.get::<_,i64>(2).unwrap_or(0),r.get::<_,i64>(3).unwrap_or(0),r.get::<_,i64>(4).unwrap_or(0),r.get::<_,i64>(5).unwrap_or(0),r.get::<_,i64>(6).unwrap_or(0),r.get::<_,f64>(7)?))
        ).unwrap_or((0,0,0,0,0,0,0,0.0));
        let total = r.0; let delivered = r.4; let declined = r.5;
        let success_rate = if total > 0 { delivered as f64 / total as f64 * 100.0 } else { 0.0 };
        let decline_rate = if total > 0 { declined as f64 / total as f64 * 100.0 } else { 0.0 };
        Ok(ShopStats { total, pending: r.1, processing: r.2, shipped: r.3, delivered, declined, cancelled: r.6, success_rate, decline_rate, avg_order_value: r.7 })
    }

    fn get_orders_summary_for_shop(&self, shop_id: i64) -> Result<Vec<OrderSummary>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,status,total_amount,tracking_number,created_at FROM orders WHERE shop_id=?1 ORDER BY created_at DESC LIMIT 10"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![shop_id], |r| Ok(OrderSummary {
            id: r.get(0)?, status: r.get(1)?, shop_name: None,
            total_amount: r.get(2)?, tracking_number: r.get(3)?, created_at: r.get(4)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    fn get_shop_products(&self, shop_id: i64) -> Result<Vec<Product>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,shop_id,asin,name,amazon_price,shop_price,url,notes,created_at FROM shop_products WHERE shop_id=?1 ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![shop_id], |r| {
            let amazon: Option<f64> = r.get(4)?;
            let shop: Option<f64> = r.get(5)?;
            let margin = match (amazon, shop) {
                (Some(a), Some(s)) if a > 0.0 => Some((a - s) / a * 100.0),
                _ => None,
            };
            Ok(Product { id: r.get(0)?, shop_id: r.get(1)?, asin: r.get(2)?, name: r.get(3)?,
                amazon_price: amazon, shop_price: shop, margin, url: r.get(6)?, notes: r.get(7)?, created_at: r.get(8)? })
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn update_shop(&self, id: i64, input: &ShopInput) -> Result<(), String> {
        let domain = Self::extract_domain(&input.url);
        self.conn.execute(
            "UPDATE shops SET name=?1,domain=?2,url=?3,category=?4,notes=?5,requires_cvv_match=?6,blocks_vpn=?7,phone_must_match=?8,accepts_amex=?9,requires_avs=?10,high_cancel_risk=?11,updated_at=datetime('now') WHERE id=?12",
            params![input.name, domain, input.url, input.category, input.notes,
                    input.requires_cvv_match as i64, input.blocks_vpn as i64, input.phone_must_match as i64,
                    input.accepts_amex as i64, input.requires_avs as i64, input.high_cancel_risk as i64, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_shop(&self, id: i64) -> Result<(), String> {
        let order_count: i64 = self.conn.query_row("SELECT COUNT(*) FROM orders WHERE shop_id=?1", params![id], |r| r.get(0)).unwrap_or(0);
        if order_count > 0 { return Err(format!("Cannot delete shop: {} linked order{}", order_count, if order_count == 1 { "" } else { "s" })); }
        self.conn.execute("DELETE FROM shops WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_shop_product(&self, shop_id: i64, product: &ProductInput) -> Result<Product, String> {
        self.conn.execute(
            "INSERT INTO shop_products(shop_id,asin,name,amazon_price,shop_price,url,notes,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,datetime('now'))",
            params![shop_id, product.asin, product.name, product.amazon_price, product.shop_price, product.url, product.notes],
        ).map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid();
        let margin = match (product.amazon_price, product.shop_price) {
            (Some(a), Some(s)) if a > 0.0 => Some((a - s) / a * 100.0),
            _ => None,
        };
        Ok(Product { id, shop_id, asin: if product.asin.is_empty() { None } else { Some(product.asin.clone()) },
            name: product.name.clone(), amazon_price: product.amazon_price, shop_price: product.shop_price,
            margin, url: if product.url.is_empty() { None } else { Some(product.url.clone()) },
            notes: if product.notes.is_empty() { None } else { Some(product.notes.clone()) },
            created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string() })
    }

    pub fn update_shop_product(&self, id: i64, product: &ProductInput) -> Result<(), String> {
        self.conn.execute(
            "UPDATE shop_products SET asin=?1,name=?2,amazon_price=?3,shop_price=?4,url=?5,notes=?6 WHERE id=?7",
            params![product.asin, product.name, product.amazon_price, product.shop_price, product.url, product.notes, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_shop_product(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM shop_products WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_shop_smart_suggestions(&self, shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = vec![];
        // Check if BIN was declined at this shop
        let declined: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id JOIN credit_cards c ON p.card_id=c.id WHERE o.shop_id=?1 AND c.id=?2 AND o.status IN ('declined','failed')",
            params![shop_id, card_id], |r| r.get(0),
        ).unwrap_or(0);
        if declined > 0 {
            suggestions.push(Suggestion { level: "warning".into(), message: format!("This card was declined {} time(s) at this shop", declined) });
        }
        // Check shop flags vs card country
        let shop = self.build_shop(shop_id)?;
        if shop.requires_avs {
            suggestions.push(Suggestion { level: "info".into(), message: "This shop requires AVS — ensure billing address matches exactly".into() });
        }
        if shop.blocks_vpn {
            suggestions.push(Suggestion { level: "warning".into(), message: "This shop blocks VPN — use residential proxy".into() });
        }
        Ok(suggestions)
    }

    // ── Orders ────────────────────────────

    fn build_order(&self, id: i64) -> Result<Order, String> {
        let row: (String,i64,i64,Option<i64>,Option<i64>,Option<String>,String,Option<f64>,Option<String>,Option<String>,Option<String>,Option<String>,String,String,Option<String>,Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>) =
            self.conn.query_row(
                "SELECT o.profile_id,o.shop_id,o.drop_id,o.email_pool_id,o.proxy_id,o.order_number,o.status,o.total_amount,o.tracking_number,o.carrier,o.notes,o.items_json,o.created_at,o.updated_at,s.name,c.holder_name,c.last4,c.id,COALESCE(px.label,px.host||':'||px.port),ep.email FROM orders o LEFT JOIN shops s ON o.shop_id=s.id LEFT JOIN profiles p ON o.profile_id=p.id LEFT JOIN credit_cards c ON p.card_id=c.id LEFT JOIN proxies px ON o.proxy_id=px.id LEFT JOIN email_pool ep ON o.email_pool_id=ep.id WHERE o.id=?1",
                params![id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?,r.get(11)?,r.get(12)?,r.get(13)?,r.get(14)?,r.get(15)?,r.get(16)?,r.get(17)?,r.get(18)?,r.get(19)?))
            ).map_err(|e| e.to_string())?;
        let holder_masked = row.15.as_deref()
            .and_then(|h| self.decrypt_field(h).ok())
            .map(|n| mask_name(&n));
        // Check flags
        let pending_too_long: bool = self.conn.query_row(
            "SELECT (julianday('now') - julianday(created_at)) > 5 FROM orders WHERE id=?1 AND status='pending'",
            params![id], |r| r.get::<_,bool>(0),
        ).unwrap_or(false);
        Ok(Order {
            id, profile_id: row.0, shop_id: row.1, drop_id: row.2,
            email_pool_id: row.3, proxy_id: row.4, order_number: row.5,
            status: row.6, total_amount: row.7, tracking_number: row.8,
            carrier: row.9, notes: row.10, items_json: row.11,
            created_at: row.12, updated_at: row.13,
            card_id: row.17, shop_name: row.14, holder_masked, last4: row.16,
            bank_name: None, proxy_label: row.18, email_addr: row.19,
            pending_too_long, card_expiring: false, bin_declined_here: false,
        })
    }

    pub fn create_order(&self, input: &OrderInput) -> Result<Order, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let items = serde_json::to_string(&input.items).unwrap_or_default();
        let total: f64 = input.items.iter().map(|i| i.price * i.qty as f64).sum();
        self.conn.execute(
            "INSERT INTO orders(profile_id,shop_id,drop_id,email_pool_id,proxy_id,order_number,status,items_json,total_amount,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9,datetime('now'),datetime('now'))",
            params![input.profile_id, input.shop_id, input.drop_id, input.email_pool_id, input.proxy_id, input.order_number, items, total, input.notes],
        ).map_err(|e| e.to_string())?;
        let oid = self.conn.last_insert_rowid();
        let _ = self.log_event("order.created", &format!("Order created for profile {}", input.profile_id), Some("order"), None);
        self.build_order(oid)
    }

    pub fn get_orders(&self, filter: &OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut wh = vec!["1=1".to_string()];
        if let Some(ref s) = filter.status { wh.push(format!("o.status='{}'", s.replace('\'', "''"))); }
        if let Some(sid) = filter.shop_id { wh.push(format!("o.shop_id={}", sid)); }
        if let Some(ref d) = filter.date_from { wh.push(format!("DATE(o.created_at)>='{}'", d)); }
        if let Some(ref d) = filter.date_to   { wh.push(format!("DATE(o.created_at)<='{}'", d)); }
        if let Some(ref s) = filter.search {
            let q = s.replace('\'', "''");
            wh.push(format!("(o.order_number LIKE '%{0}%' OR s.name LIKE '%{0}%')", q));
        }
        let w = wh.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE {}", w), [], |r| r.get(0),
        ).unwrap_or(0);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT o.id FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE {} ORDER BY o.created_at DESC LIMIT {} OFFSET {}",
            w, pp, offset
        )).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let items: Vec<Order> = ids.iter().filter_map(|&id| self.build_order(id).ok()).collect();
        let total_pages = ((total as u32).saturating_sub(1) / per_page.max(1)) + 1;
        Ok(PaginatedOrders { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn get_order(&self, id: i64) -> Result<Order, String> {
        self.build_order(id)
    }

    pub fn get_latest_order_by_profile(&self, profile_id: &str) -> Result<Option<Order>, String> {
        let id: Option<i64> = self.conn.query_row(
            "SELECT id FROM orders WHERE profile_id=?1 ORDER BY created_at DESC LIMIT 1",
            params![profile_id],
            |r| r.get(0),
        ).ok();
        match id {
            Some(oid) => self.build_order(oid).map(Some),
            None => Ok(None),
        }
    }

    pub fn update_order_status(&self, id: i64, status: &str, meta: Option<&StatusMeta>) -> Result<(), String> {
        if let Some(m) = meta {
            self.conn.execute(
                "UPDATE orders SET status=?1,tracking_number=COALESCE(?2,tracking_number),carrier=COALESCE(?3,carrier),order_number=COALESCE(?4,order_number),updated_at=datetime('now') WHERE id=?5",
                params![status, m.tracking_number, m.carrier, m.order_number, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE orders SET status=?1,updated_at=datetime('now') WHERE id=?2",
                params![status, id],
            ).map_err(|e| e.to_string())?;
        }
        let _ = self.log_event("order.status_changed", &format!("Order {} → {}", id, status), Some("order"), Some(&id.to_string()));
        Ok(())
    }

    pub fn delete_order(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM orders WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn run_risk_check(&self, profile_id: &str, shop_id: i64) -> Result<RiskCheckResult, String> {
        let mut warnings = vec![];
        let mut score = 0u32;

        // BIN declined at this shop
        let bin_declined: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id JOIN credit_cards c ON p.card_id=c.id WHERE o.shop_id=?1 AND p.id=?2 AND o.status IN ('declined','failed')",
            params![shop_id, profile_id], |r| r.get(0),
        ).unwrap_or(0);
        if bin_declined > 0 {
            score += 40;
            warnings.push(RiskWarning { kind: "bin_declined".into(), severity: "high".into(),
                message: format!("Card declined {} time(s) at this shop", bin_declined),
                related_order_id: None, related_order_status: None });
        }

        // Drop address reused at this shop
        let drop_reused: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders o WHERE o.shop_id=?1 AND o.profile_id=?2 AND o.status NOT IN ('declined','failed','cancelled')",
            params![shop_id, profile_id], |r| r.get(0),
        ).unwrap_or(0);
        if drop_reused > 1 {
            score += 20;
            warnings.push(RiskWarning { kind: "drop_reused".into(), severity: "warning".into(),
                message: format!("This profile has {} previous orders at this shop", drop_reused),
                related_order_id: None, related_order_status: None });
        }

        // Card expiring soon
        let expiring: bool = self.conn.query_row(
            "SELECT (SELECT COUNT(*) FROM credit_cards c JOIN profiles p ON p.card_id=c.id WHERE p.id=?1 AND c.expiry_date IS NOT NULL) > 0",
            params![profile_id], |r| r.get::<_,bool>(0),
        ).unwrap_or(false);

        let level = if score >= 40 { "high" } else if score >= 20 { "warning" } else { "safe" };
        Ok(RiskCheckResult { level: level.into(), score, warnings, offline: false })
    }

    pub fn save_order_template(&self, input: &SaveTemplateInput) -> Result<(), String> {
        self.conn.execute(
            "INSERT INTO order_templates(name,shop_tag,items_json,created_at) VALUES(?1,?2,?3,datetime('now'))",
            params![input.name, input.shop_tag, input.items_json],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_order_templates(&self, shop_tag: Option<&str>) -> Result<Vec<OrderTemplate>, String> {
        let (sql, use_tag) = match shop_tag {
            Some(t) if !t.is_empty() => (
                format!("SELECT id,name,shop_tag,items_json,created_at FROM order_templates WHERE shop_tag='{}' ORDER BY id DESC", t.replace('\'', "''")),
                true,
            ),
            _ => ("SELECT id,name,shop_tag,items_json,created_at FROM order_templates ORDER BY id DESC".into(), false),
        };
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(OrderTemplate {
            id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?, items_json: r.get(3)?, created_at: r.get(4)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ── Backup ────────────────────────────

    pub fn export_backup_to(&self, dest: &str) -> Result<String, String> {
        let src = self.conn.path().unwrap_or("cc_manager.db");
        std::fs::copy(src, dest).map_err(|e| e.to_string())?;
        Ok(dest.to_string())
    }

} // impl Database (M03-M06)

// ─────────────────────────────────────────
//  Auto-backup helper
// ─────────────────────────────────────────

pub fn create_backup(db_path: &str) -> Result<String, String> {
        let home = std::env::var("HOME").unwrap_or_default();
        let backup_dir = format!("{}/.config/cc-manager/backups", home);
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let dest = format!("{}/backup_{}.db", backup_dir, now);
        std::fs::copy(db_path, &dest).map_err(|e| e.to_string())?;
        // Keep only last 10 backups
        let mut entries: Vec<_> = std::fs::read_dir(&backup_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("backup_"))
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for old in entries.iter().rev().skip(10) {
            let _ = std::fs::remove_file(old.path());
        }
        Ok(dest)
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
    conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;")?;
    let version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 { migration_v1(conn)?; conn.execute_batch("PRAGMA user_version = 1")?; }
    if version < 2 { migration_v2(conn)?; conn.execute_batch("PRAGMA user_version = 2")?; }
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_card ON profiles(card_id);

        CREATE TABLE IF NOT EXISTS drops (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
            recipient_name TEXT NOT NULL DEFAULT '',
            address        TEXT NOT NULL DEFAULT '',
            city           TEXT NOT NULL DEFAULT '',
            state          TEXT,
            zip            TEXT NOT NULL DEFAULT '',
            country        TEXT NOT NULL DEFAULT '',
            phone          TEXT,
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
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            email           TEXT,
            email_hash      TEXT UNIQUE,
            label           TEXT,
            imap_account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL,
            is_blocked      BOOLEAN NOT NULL DEFAULT 0,
            notes           TEXT,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS proxies (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            host       TEXT NOT NULL,
            port       INTEGER NOT NULL,
            proxy_type TEXT NOT NULL DEFAULT 'http',
            username   TEXT,
            password   TEXT,
            label      TEXT,
            is_blocked BOOLEAN NOT NULL DEFAULT 0,
            notes      TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shops (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT NOT NULL,
            domain             TEXT UNIQUE NOT NULL,
            url                TEXT NOT NULL DEFAULT '',
            category           TEXT,
            notes              TEXT,
            requires_cvv_match BOOLEAN NOT NULL DEFAULT 0,
            blocks_vpn         BOOLEAN NOT NULL DEFAULT 0,
            phone_must_match   BOOLEAN NOT NULL DEFAULT 0,
            accepts_amex       BOOLEAN NOT NULL DEFAULT 0,
            requires_avs       BOOLEAN NOT NULL DEFAULT 0,
            high_cancel_risk   BOOLEAN NOT NULL DEFAULT 0,
            created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shop_products (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id      INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
            asin         TEXT,
            name         TEXT NOT NULL,
            amazon_price REAL,
            shop_price   REAL,
            url          TEXT,
            notes        TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
            shop_id       INTEGER REFERENCES shops(id) ON DELETE SET NULL,
            drop_id       INTEGER REFERENCES drops(id) ON DELETE SET NULL,
            email_pool_id INTEGER REFERENCES email_pool(id) ON DELETE SET NULL,
            proxy_id      INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            order_number  TEXT,
            status        TEXT NOT NULL DEFAULT 'pending',
            items_json    TEXT,
            total_amount  REAL,
            tracking_number TEXT,
            carrier       TEXT,
            notes         TEXT,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_orders_profile ON orders(profile_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_shop    ON orders(shop_id);

        CREATE TABLE IF NOT EXISTS shop_footprints (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id     INTEGER REFERENCES shops(id) ON DELETE CASCADE,
            shop_domain TEXT,
            order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            email_id    INTEGER REFERENCES email_pool(id) ON DELETE SET NULL,
            proxy_id    INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            email_hash  TEXT,
            ip_hash     TEXT,
            drop_hash   TEXT,
            bin         TEXT,
            phone_hash  TEXT,
            name_hash   TEXT,
            synced      BOOLEAN NOT NULL DEFAULT 0,
            user_token  TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
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
            shop_tag TEXT, items_json TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    "#)?;
    Ok(())
    }

    fn migration_v2(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS imap_messages (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id              INTEGER REFERENCES imap_accounts(id) ON DELETE CASCADE,
            message_uid             TEXT,
            subject                 TEXT,
            from_email              TEXT,
            received_at             DATETIME,
            extracted_order_number  TEXT,
            extracted_tracking      TEXT,
            action_taken            TEXT,
            processed               BOOLEAN NOT NULL DEFAULT 0,
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_imap_msg_account ON imap_messages(account_id);
        CREATE INDEX IF NOT EXISTS idx_imap_msg_uid     ON imap_messages(account_id, message_uid);
    "#)?;
    Ok(())
    }

