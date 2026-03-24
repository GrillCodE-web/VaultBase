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

pub const CURRENT_MIGRATION_VERSION: u32 = 6;

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
    /// FIX B14: экранирует wildcards % и _ для LIKE запросов
    fn escape_like(s: &str) -> String {
        s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    }

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
        // FIX B47: авто-ротация лога — держим последние 10 000 записей
        let _ = self.conn.execute(
            "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 10000)",
            [],
        );
        Ok(())
    }

    // ─────────────────────────────────────────
    //  CC Insert (bulk, with transaction) — FIX B05/B20
    // ─────────────────────────────────────────

    pub fn insert_cards(&self, cards: Vec<CardInput>) -> Result<usize, String> {
        let mut inserted = 0usize;

        // FIX B05: используем явную транзакцию для атомарности и производительности
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = (|| -> Result<usize, String> {
        for card in cards {
            let (bin, last4) = extract_bin_last4(&card.card_number);

            let enc_number  = self.encrypt_field(&card.card_number)?;
            let enc_cvv     = self.opt_encrypt(card.cvv.as_deref())?;
            let enc_holder  = self.opt_encrypt(card.holder_name.as_deref())?;
            let enc_address = self.opt_encrypt(card.billing_address.as_deref())?;
            let enc_phone   = self.opt_encrypt(card.phone.as_deref())?;
            let enc_email   = self.opt_encrypt(card.email.as_deref())?;
            let enc_ip      = self.opt_encrypt(card.ip_address.as_deref())?;

            let card_hash = {
                use sha2::{Digest, Sha256};
                let mut h = Sha256::new();
                h.update(card.card_number.as_bytes());
                format!("{:x}", h.finalize())
            };

            let n = self.conn.execute(
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

            if n > 0 { inserted += 1; }
        }
        Ok(inserted)
        })();
        match result {
            Ok(n) => { self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(n) }
            Err(e) => { let _ = self.conn.execute_batch("ROLLBACK"); Err(e) }
        }
    }

    // ─────────────────────────────────────────
    //  CC List
    // ─────────────────────────────────────────

    pub fn get_cards(&self, filter: &CardFilter, page: u32, per_page: u32) -> Result<PaginatedCards, String> {
        self.touch_activity();

        let offset = (page.saturating_sub(1)) * per_page;
        let mut conditions: Vec<String> = Vec::new();
        let mut params_list: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        // FIX B01: фильтр по конкретному id
        if let Some(id) = filter.id {
            conditions.push(format!("id = ?{}", params_list.len()+1));
            params_list.push(Box::new(id));
        }
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
            // FIX B15: считаем через julianday для точных 60 дней вместо +2 месяца
            // expiry_date формат MM/YY → строим дату последнего дня месяца для сравнения
            conditions.push("expiry_date IS NOT NULL AND expiry_date != '' AND \
                date('20'||substr(expiry_date,4,2)||'-'||substr(expiry_date,1,2)||'-01','+1 month','-1 day') \
                BETWEEN date('now') AND date('now','+60 days')".to_string());
        }
        // search by last4 or bin (plaintext)
        if let Some(ref s) = filter.search {
            let trimmed = s.trim().to_string();
            if !trimmed.is_empty() {
                let cond_idx = params_list.len() + 1;
                // FIX B13: holder_name зашифрован — поиск по нему бессмысленен, убираем
                conditions.push(format!(
                    "(last4 LIKE ?{0} OR bin LIKE ?{0} OR bank_name LIKE ?{0})",
                    cond_idx
                ));
                params_list.push(Box::new(format!("%{}%", Self::escape_like(&trimmed))));
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

    pub fn get_card_filter_meta(&self) -> Result<crate::models::CardFilterMeta, String> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT country FROM credit_cards WHERE country IS NOT NULL AND country != '' ORDER BY country LIMIT 80"
        ).map_err(|e| e.to_string())?;
        let countries: Vec<String> = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT bank_name FROM credit_cards WHERE bank_name IS NOT NULL AND bank_name != '' ORDER BY bank_name LIMIT 80"
        ).map_err(|e| e.to_string())?;
        let banks: Vec<String> = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT source FROM credit_cards WHERE source IS NOT NULL AND source != '' ORDER BY source LIMIT 40"
        ).map_err(|e| e.to_string())?;
        let sources: Vec<String> = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

        Ok(crate::models::CardFilterMeta { countries, banks, sources })
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
        // FIX B68: нельзя установить статус отличный от in_use если карта in_use
        // (это обходит защиту delete_card). Статус in_use управляется только через профили.
        if status != "in_use" {
            let current: String = self.conn.query_row(
                "SELECT status FROM credit_cards WHERE id=?1",
                params![id], |r| r.get(0),
            ).unwrap_or_default();
            if current == "in_use" {
                // Проверяем не остались ли активные профили
                let profile_count: i64 = self.conn.query_row(
                    "SELECT COUNT(*) FROM profiles WHERE card_id=?1",
                    params![id], |r| r.get(0),
                ).unwrap_or(0);
                if profile_count > 0 {
                    return Err("card_in_use: cannot change status while card is linked to a profile".into());
                }
            }
        }
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

    // FIX B06: bulk операции обёрнуты в транзакцию
    pub fn bulk_update_status(&self, ids: &[i64], status: &str) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for &id in ids {
                self.conn.execute(
                    "UPDATE credit_cards SET status=?1 WHERE id=?2",
                    params![status, id],
                ).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => { self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(()) }
            Err(e) => { let _ = self.conn.execute_batch("ROLLBACK"); Err(e) }
        }
    }

    // FIX B06: bulk_delete с транзакцией
    pub fn bulk_delete(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for &id in ids {
                let status: Option<String> = self.conn.query_row(
                    "SELECT status FROM credit_cards WHERE id=?1",
                    params![id], |r| r.get(0),
                ).ok();
                if status.as_deref() != Some("in_use") {
                    self.conn.execute("DELETE FROM credit_cards WHERE id=?1", params![id])
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => { self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(()) }
            Err(e) => { let _ = self.conn.execute_batch("ROLLBACK"); Err(e) }
        }
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

        // 1. Check local bin_cache (30-day TTL)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let cutoff = now - (30 * 24 * 3600i64);
        if let Ok(row) = self.conn.query_row(
            "SELECT data_json FROM bin_cache WHERE bin = ?1 AND cached_at > ?2",
            rusqlite::params![&bin, cutoff],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(cached) = serde_json::from_str::<BinInfo>(&row) {
                return Ok(cached);
            }
        }

        // 2. Check server-side BIN cache (populated by other users)
        let server_cached = ureq::get(&format!("https://api.eulivehub.com/api/bin/{}", bin))
            .timeout(std::time::Duration::from_secs(4))
            .call()
            .ok()
            .and_then(|r| r.into_json::<BinInfo>().ok());
        if let Some(info) = server_cached {
            // Save to local cache
            if let Ok(json) = serde_json::to_string(&info) {
                let _ = self.conn.execute(
                    "INSERT OR REPLACE INTO bin_cache(bin,data_json,cached_at) VALUES(?1,?2,?3)",
                    rusqlite::params![&bin, json, now],
                );
            }
            let _ = self.conn.execute(
                "UPDATE credit_cards SET bank_name=?1, card_type=?2, card_level=?3 WHERE id=?4",
                params![info.bank_name, info.card_type, info.card_level, card_id],
            );
            return Ok(info);
        }

        // 3. Fall back to iinapi.com API
        fetch_bin_info(&bin, api_key)
            .map(|info| {
                // Save to local cache
                if let Ok(json) = serde_json::to_string(&info) {
                    let _ = self.conn.execute(
                        "INSERT OR REPLACE INTO bin_cache (bin, data_json, cached_at) VALUES (?1, ?2, ?3)",
                        rusqlite::params![&bin, json, now],
                    );
                }
                // Push to server cache (fire-and-forget)
                if let Ok(payload) = serde_json::to_string(&serde_json::json!({ "bin": &bin, "data": &info })) {
                    let _ = ureq::post("https://api.eulivehub.com/api/bin")
                        .set("Content-Type", "application/json")
                        .timeout(std::time::Duration::from_secs(4))
                        .send_string(&payload);
                }
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
        // FIX B45: вся операция в одной транзакции — partial failure не оставит БД в смешанном состоянии
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = self.reencrypt_all_inner(old_enc, new_enc);
        match result {
            Ok(()) => { self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(()) }
            Err(e) => { let _ = self.conn.execute_batch("ROLLBACK"); Err(e) }
        }
    }

    fn reencrypt_all_inner(&self, old_enc: &FieldEncryption, new_enc: &FieldEncryption) -> Result<(), String> {
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

        // FIX B03: drops таблица содержит PII (имена, адреса) — перешифровываем
        let dr_rows: Vec<(i64, String, String, Option<String>)> = {
            let mut s = self.conn.prepare(
                "SELECT id, recipient_name, address, phone FROM drops"
            ).map_err(|e| e.to_string())?;
            let c: Vec<_> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            c
        };
        for (id, name, addr, phone) in dr_rows {
            self.conn.execute(
                "UPDATE drops SET recipient_name=?1, address=?2, phone=?3 WHERE id=?4",
                params![
                    reenc(Some(name.as_str()))?.unwrap_or(name),
                    reenc(Some(addr.as_str()))?.unwrap_or(addr),
                    reenc(phone.as_deref())?,
                    id
                ],
            ).map_err(|e| e.to_string())?;
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
        // FIX B55: net_profit = delivered revenue - cost_of_goods (amazon_price * qty из items_json)
        // Поскольку amazon_price хранится в shop_products, а не в orders.items_json напрямую,
        // используем total_amount как proxy для revenue, а для реальной прибыли — отдельный запрос
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

    pub fn get_bin_performance(&self) -> Result<Vec<crate::models::BinPerf>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT c.bin,
                    MAX(c.bank_name) as bank_name,
                    COUNT(o.id) as total_orders,
                    SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) as delivered,
                    SUM(CASE WHEN o.status='declined' THEN 1 ELSE 0 END) as declined,
                    COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total_amount ELSE 0 END), 0) as revenue
             FROM cards c
             JOIN profiles p ON p.card_id = c.id
             JOIN orders o ON o.profile_id = p.id
             WHERE c.bin IS NOT NULL AND c.bin != ''
             GROUP BY c.bin
             HAVING total_orders >= 2
             ORDER BY total_orders DESC
             LIMIT 20"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |r| {
            let total: u32 = r.get::<_, u32>(2).unwrap_or(0);
            let delivered: u32 = r.get::<_, u32>(3).unwrap_or(0);
            let rate = if total > 0 { (delivered as f64 / total as f64) * 100.0 } else { 0.0 };
            Ok(crate::models::BinPerf {
                bin: r.get(0)?,
                bank_name: r.get(1)?,
                total_orders: total,
                delivered,
                declined: r.get::<_, u32>(4).unwrap_or(0),
                total_revenue: r.get::<_, f64>(5).unwrap_or(0.0),
                delivery_rate: rate,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_shop_win_loss(&self) -> Result<Vec<crate::models::ShopWinLoss>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name,
                    COUNT(o.id) as total,
                    SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) as delivered,
                    SUM(CASE WHEN o.status='declined' THEN 1 ELSE 0 END) as declined,
                    COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total_amount ELSE 0 END),0) as revenue,
                    COALESCE(AVG(CASE WHEN o.status='delivered' THEN o.total_amount END),0) as avg_order
             FROM shops s
             JOIN orders o ON o.shop_id = s.id
             GROUP BY s.id
             HAVING total >= 2
             ORDER BY total DESC
             LIMIT 30"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |r| {
            let total: u32 = r.get::<_, u32>(2).unwrap_or(0);
            let delivered: u32 = r.get::<_, u32>(3).unwrap_or(0);
            let pct = if total > 0 { (delivered as f64 / total as f64) * 100.0 } else { 0.0 };
            let avg_order: f64 = r.get::<_, f64>(6).unwrap_or(0.0);
            Ok(crate::models::ShopWinLoss {
                shop_id: r.get(0)?,
                shop_name: r.get(1)?,
                total,
                delivered,
                declined: r.get::<_, u32>(4).unwrap_or(0),
                net_revenue: r.get::<_, f64>(5).unwrap_or(0.0),
                delivery_pct: pct,
                expected_value: avg_order * (pct / 100.0),
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
            unread_imap: self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE is_read=0",
                [], |r| r.get(0),
            ).unwrap_or(0),
            unsynced_footprints,
        })
    }

}

// ─────────────────────────────────────────
//  BIN API fetch (standalone)
    // ─────────────────────────────────────────

    pub fn fetch_bin_info(bin: &str, api_key: &str) -> Result<BinInfo, String> {
    if api_key.is_empty() { return Err("no_api_key".into()); }

    // FIX B08: api_key передаётся в заголовке X-Api-Key, а не в URL (иначе попадает в логи сервера)
    let url = format!("https://api.iinapi.com/api/v1/{}", bin);
    let resp = ureq::get(&url)
        .set("X-Api-Key", api_key)
        .call()
        .map_err(|e| format!("bin_api_error: {e}"))?;

    let json: serde_json::Value = resp.into_json()
        .map_err(|e| format!("bin_api_parse: {e}"))?;

    Ok(BinInfo {
        bin: bin.to_string(),
        bank_name:  json["bank"]["name"].as_str().map(String::from),
        card_type:  json["type"].as_str().map(String::from),
        // FIX B46: card_level из поля "level", brand отдельно из "brand"
        card_level: json["level"].as_str().map(String::from),
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
        // FIX B63: добавляем предыдущие периоды для month, year
        "month" => {
            let now = Local::now();
            let this_month_start = now.date_naive().with_day(1).unwrap_or(now.date_naive());
            use chrono::Datelike;
            let (prev_year, prev_month) = if this_month_start.month() == 1 {
                (this_month_start.year() - 1, 12u32)
            } else {
                (this_month_start.year(), this_month_start.month() - 1)
            };
            let prev_start = chrono::NaiveDate::from_ymd_opt(prev_year, prev_month, 1)
                .map(|d| d.format("%Y-%m-%d 00:00:00").to_string());
            let prev_end = this_month_start.pred_opt()
                .map(|d| d.format("%Y-%m-%d 23:59:59").to_string());
            (prev_start, prev_end)
        }
        "year" => {
            let now = Local::now();
            use chrono::Datelike;
            let this_year = now.year();
            (Some(format!("{}-01-01 00:00:00", this_year - 1)),
             Some(format!("{}-12-31 23:59:59", this_year - 1)))
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
        self.save_imap_message_v2(account_id, uid, subject, from_email, received_at,
            order_num, tracking, action, action.is_some())
    }

    /// FIX B66: `processed` = true только если action реально применено к заказу
    pub fn save_imap_message_v2(&self, account_id: i64, uid: Option<&str>, subject: &str,
        from_email: &str, received_at: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>, processed: bool) -> Result<(), String>
    {
        if let Some(u) = uid {
            let exists: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND message_uid=?2",
                params![account_id, u], |r| r.get(0),
            ).unwrap_or(0);
            if exists > 0 { return Ok(()); }
        }
        self.conn.execute(
            "INSERT INTO imap_messages(account_id,message_uid,subject,from_email,received_at,extracted_order_number,extracted_tracking,action_taken,processed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![account_id, uid, subject, from_email, received_at, order_num, tracking, action, processed as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// FIX B57: проверяет наличие UID в БД для дедупликации до сетевого запроса
    pub fn imap_uid_exists(&self, account_id: i64, uid: &str) -> bool {
        self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND message_uid=?2",
            params![account_id, uid], |r| r.get::<_,i64>(0),
        ).unwrap_or(0) > 0
    }

    /// FIX B22: возвращает все известные UID аккаунта для фильтрации до сетевого запроса
    pub fn get_known_imap_uids(&self, account_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT message_uid FROM imap_messages WHERE account_id=?1 AND message_uid IS NOT NULL"
        ).map_err(|e| e.to_string())?;
        let uids: Vec<String> = stmt.query_map(params![account_id], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(uids)
    }

    pub fn get_imap_messages(&self, filter: &ImapMsgFilter, page: u32, per_page: u32) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;

        // FIX SQL-INJ-01: Строгая валидация всех входных данных перед использованием в SQL
        let mut w = vec!["1=1".to_string()];

        // account_id — только целые числа, никакие special characters
        if let Some(aid) = filter.account_id {
            // Дополнительная защита: проверяем, что aid — положительное число
            if aid > 0 {
                w.push(format!("account_id={}", aid));
            }
        }

        // processed — только boolean 0 или 1
        if let Some(p) = filter.processed {
            // Boolean уже валиден (true/false), конвертируем в 1/0
            w.push(format!("processed={}", if p { 1 } else { 0 }));
        }

        // Даты — строгая валидация формата YYYY-MM-DD
        if let Some(ref d) = filter.date_from {
            if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 && d.starts_with(|c: char| c.is_ascii_digit()) {
                // Дополнительная проверка: только цифры и дефисы в правильных позициях
                let parts: Vec<&str> = d.split('-').collect();
                if parts.len() == 3 && parts[0].len() == 4 && parts[1].len() == 2 && parts[2].len() == 2 {
                    w.push(format!("DATE(received_at)>='{}'", d));
                }
            }
        }
        if let Some(ref d) = filter.date_to {
            if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 && d.starts_with(|c: char| c.is_ascii_digit()) {
                let parts: Vec<&str> = d.split('-').collect();
                if parts.len() == 3 && parts[0].len() == 4 && parts[1].len() == 2 && parts[2].len() == 2 {
                    w.push(format!("DATE(received_at)<='{}'", d));
                }
            }
        }

        let where_clause = w.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM imap_messages WHERE {}", where_clause), [], |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!("SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE {} ORDER BY id DESC LIMIT {} OFFSET {}", where_clause, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items: Vec<ImapMessage> = stmt.query_map([], |r| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let pages = ((total as u32) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn get_imap_account_stats(&self, account_id: i64) -> Result<ImapAccountStats, String> {
        let total: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1", params![account_id], |r| r.get(0),
        ).unwrap_or(0);
        let unread: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND is_read=0", params![account_id], |r| r.get(0),
        ).unwrap_or(0);
        let mut stmt = self.conn.prepare(
            "SELECT folder, COUNT(*), SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END) FROM imap_messages WHERE account_id=?1 GROUP BY folder"
        ).map_err(|e| e.to_string())?;
        let folders: Vec<ImapFolderInfo> = stmt.query_map(params![account_id], |r| {
            Ok(ImapFolderInfo { name: r.get(0)?, total: r.get(1)?, unread: r.get::<_,Option<i64>>(2)?.unwrap_or(0) })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(ImapAccountStats { total, unread, folders })
    }

    pub fn get_imap_folder_messages(&self, account_id: i64, folder: &str, page: u32, per_page: u32, search: Option<&str>) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let search_active = search.map(|s| !s.trim().is_empty()).unwrap_or(false);
        let total: i64 = if search_active {
            self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND folder=?2 AND (LOWER(subject) LIKE '%' || LOWER(?3) || '%' OR LOWER(from_email) LIKE '%' || LOWER(?3) || '%')",
                params![account_id, folder, search.unwrap()], |r| r.get(0),
            ).unwrap_or(0)
        } else {
            self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND folder=?2",
                params![account_id, folder], |r| r.get(0),
            ).unwrap_or(0)
        };
        let row_map = |r: &rusqlite::Row| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        });
        let items: Vec<ImapMessage> = if search_active {
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE account_id=?1 AND folder=?2 AND (LOWER(subject) LIKE '%' || LOWER(?3) || '%' OR LOWER(from_email) LIKE '%' || LOWER(?3) || '%') ORDER BY id DESC LIMIT ?4 OFFSET ?5";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(params![account_id, folder, search.unwrap(), pp, offset], row_map)
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
        } else {
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE account_id=?1 AND folder=?2 ORDER BY id DESC LIMIT ?3 OFFSET ?4";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(params![account_id, folder, pp, offset], row_map)
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn get_imap_message_body(&self, id: i64) -> Result<Option<String>, String> {
        let res = self.conn.query_row(
            "SELECT body FROM imap_messages WHERE id=?1", params![id], |r| r.get(0),
        );
        match res {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn mark_imap_message_read(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_messages SET is_read=1 WHERE id=?1", params![id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_imap_message(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM imap_messages WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Cached folder list (stored in config table as JSON).
    pub fn get_cached_imap_folders(&self, account_id: i64) -> Vec<String> {
        let key = format!("imap_folders_{}", account_id);
        let val: Option<String> = self.conn.query_row(
            "SELECT value FROM config WHERE key=?1", params![key], |r| r.get(0),
        ).ok();
        val.and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok()).unwrap_or_default()
    }

    pub fn save_cached_imap_folders(&self, account_id: i64, folders: &[String]) -> Result<(), String> {
        let key = format!("imap_folders_{}", account_id);
        let val = serde_json::to_string(folders).unwrap_or_default();
        self.conn.execute(
            "INSERT OR REPLACE INTO config(key,value) VALUES(?1,?2)", params![key, val],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Unified inbox: messages from all accounts' INBOX sorted newest first.
    pub fn get_all_inbox_messages(&self, page: u32, per_page: u32, search: Option<&str>) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let search_active = search.map(|s| !s.trim().is_empty()).unwrap_or(false);
        let row_map = |r: &rusqlite::Row| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        });
        let (total, items): (i64, Vec<ImapMessage>) = if search_active {
            let q = search.unwrap();
            let t: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE folder='INBOX' AND (LOWER(subject) LIKE '%'||LOWER(?1)||'%' OR LOWER(from_email) LIKE '%'||LOWER(?1)||'%')",
                params![q], |r| r.get(0),
            ).unwrap_or(0);
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE folder='INBOX' AND (LOWER(subject) LIKE '%'||LOWER(?1)||'%' OR LOWER(from_email) LIKE '%'||LOWER(?1)||'%') ORDER BY id DESC LIMIT ?2 OFFSET ?3";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![q, pp, offset], row_map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (t, rows)
        } else {
            let t: i64 = self.conn.query_row("SELECT COUNT(*) FROM imap_messages WHERE folder='INBOX'", [], |r| r.get(0)).unwrap_or(0);
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE folder='INBOX' ORDER BY id DESC LIMIT ?1 OFFSET ?2";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![pp, offset], row_map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (t, rows)
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn archive_imap_message(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_messages SET folder='Archive' WHERE id=?1",
            params![id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_imap_message_with_body(&self, account_id: i64, uid: Option<&str>,
        subject: &str, from_email: &str, to_email: Option<&str>, received_at: &str,
        body: Option<&str>, folder: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>, processed: bool) -> Result<(), String>
    {
        if let Some(u) = uid {
            if self.imap_uid_exists(account_id, u) { return Ok(()); }
        }
        self.conn.execute(
            "INSERT INTO imap_messages(account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12)",
            params![account_id, uid, subject, from_email, to_email, received_at, body, folder, order_num, tracking, action, processed as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── SMTP ───────────────────────────────────────────────────

    pub fn add_smtp_config(&self, input: &SmtpConfigInput) -> Result<SmtpConfig, String> {
        self.conn.execute(
            "INSERT INTO smtp_configs(label,host,port,login,password,use_tls,use_starttls) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![input.label, input.host, input.port, input.login, input.password, input.use_tls as i64, input.use_starttls as i64],
        ).map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid();
        self.get_smtp_config(id)
    }

    fn get_smtp_config(&self, id: i64) -> Result<SmtpConfig, String> {
        self.conn.query_row(
            "SELECT id,label,host,port,login,use_tls,use_starttls,is_active,created_at FROM smtp_configs WHERE id=?1",
            params![id], |r| Ok(SmtpConfig {
                id: r.get(0)?, label: r.get(1)?, host: r.get(2)?,
                port: r.get(3)?, login: r.get(4)?,
                use_tls: r.get::<_,i64>(5)? != 0,
                use_starttls: r.get::<_,i64>(6)? != 0,
                is_active: r.get::<_,i64>(7)? != 0,
                created_at: r.get(8)?,
            }),
        ).map_err(|e| e.to_string())
    }

    pub fn get_smtp_configs(&self) -> Result<Vec<SmtpConfig>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,label,host,port,login,use_tls,use_starttls,is_active,created_at FROM smtp_configs ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let items: Vec<SmtpConfig> = stmt.query_map([], |r| Ok(SmtpConfig {
            id: r.get(0)?, label: r.get(1)?, host: r.get(2)?,
            port: r.get(3)?, login: r.get(4)?,
            use_tls: r.get::<_,i64>(5)? != 0,
            use_starttls: r.get::<_,i64>(6)? != 0,
            is_active: r.get::<_,i64>(7)? != 0,
            created_at: r.get(8)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    pub fn get_smtp_config_password(&self, id: i64) -> Result<String, String> {
        self.conn.query_row(
            "SELECT password FROM smtp_configs WHERE id=?1", params![id], |r| r.get(0),
        ).map_err(|e| e.to_string())
    }

    pub fn delete_smtp_config(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM smtp_configs WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn log_sent_email(&self, smtp_config_id: Option<i64>, from_email: Option<&str>,
        to_email: &str, subject: Option<&str>, body_text: Option<&str>,
        status: &str, error_message: Option<&str>) -> Result<(), String>
    {
        self.conn.execute(
            "INSERT INTO sent_emails(smtp_config_id,from_email,to_email,subject,body_text,status,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![smtp_config_id, from_email, to_email, subject, body_text, status, error_message],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_sent_emails(&self, page: u32, per_page: u32) -> Result<PaginatedSentEmails, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM sent_emails", [], |r| r.get(0)).unwrap_or(0);
        let mut stmt = self.conn.prepare(
            "SELECT id,smtp_config_id,from_email,to_email,subject,status,error_message,sent_at FROM sent_emails ORDER BY id DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;
        let items: Vec<SentEmail> = stmt.query_map(params![pp, offset], |r| Ok(SentEmail {
            id: r.get(0)?, smtp_config_id: r.get(1)?, from_email: r.get(2)?,
            to_email: r.get(3)?, subject: r.get(4)?,
            status: r.get(5)?, error_message: r.get(6)?, sent_at: r.get(7)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedSentEmails { items, total: total as u32, page, per_page, pages })
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
        if let Some(ref d) = filter.from_date { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { w.push(format!("DATE(created_at)>='{}'", d)); } }
        if let Some(ref d) = filter.to_date   { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { w.push(format!("DATE(created_at)<='{}'", d)); } }
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

    pub fn get_footprint_for_profile_shop(&self, profile_id: &str, shop_id: i64) -> Option<Footprint> {
        self.conn.query_row(
            "SELECT id,shop_id,shop_domain,order_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced,user_token,created_at \
             FROM shop_footprints WHERE shop_id=?1 AND order_id IN (SELECT id FROM orders WHERE profile_id=?2) \
             ORDER BY created_at DESC LIMIT 1",
            params![shop_id, profile_id],
            |r| Ok(Footprint {
                id: r.get(0)?, shop_id: r.get(1)?, shop_domain: r.get(2)?, order_id: r.get(3)?,
                email_hash: r.get(4)?, ip_hash: r.get(5)?, drop_hash: r.get(6)?, bin: r.get(7)?,
                phone_hash: r.get(8)?, name_hash: r.get(9)?,
                synced: r.get::<_,i64>(10).unwrap_or(0) != 0,
                user_token: r.get(11)?, created_at: r.get(12)?,
            }),
        ).ok()
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

        // Profiles — search by drop recipient_name or notes
        let mut profiles = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT p.id, d.recipient_name, d.city, d.country, p.notes              FROM profiles p LEFT JOIN drops d ON d.profile_id=p.id              WHERE LOWER(d.recipient_name) LIKE ?1 OR LOWER(p.notes) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({
                "id": r.get::<_,String>(0)?, "name": r.get::<_,Option<String>>(1)?,
                "city": r.get::<_,Option<String>>(2)?, "country": r.get::<_,Option<String>>(3)?,
                "notes": r.get::<_,Option<String>>(4)?, "_type": "profile",
            }))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { profiles.push(v); } }

        Ok(SearchResults { cards, profiles, orders, shops, emails, proxies })
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
            // FIX B14: экранируем % и _ чтобы не работали как wildcards
            let escaped = Self::escape_like(&s.replace('\'', "''"));
            where_parts.push(format!(
                "(c.last4 LIKE '%{0}%' ESCAPE '\\' OR c.bin LIKE '%{0}%' ESCAPE '\\' OR c.bank_name LIKE '%{0}%' ESCAPE '\\')", escaped
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
        let total_pages = (total as u32 + per_page - 1) / per_page.max(1); // FIX B16: единая формула ceil(total/per_page)
        Ok(PaginatedProfiles { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn get_profile_detail(&self, id: &str) -> Result<ProfileDetail, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let profile = self.build_profile(id)?;
        // FIX B34: card_id может быть 0 (NULL → i64) если карта удалена (ON DELETE SET NULL)
        let card = if profile.card_id > 0 {
            self.get_card_decrypted(profile.card_id).ok()
        } else {
            None
        };
        // Возвращаем пустую заглушку CardDecrypted если карта удалена
        let card = card.unwrap_or_else(|| CardDecrypted {
            id: 0,
            card_number: String::new(),
            expiry_date: String::new(),
            cvv: String::new(),
            holder_name: String::new(),
            billing_address: None, city: None, state: None, zip: None,
            country: None, phone: None, email: None, ip_address: None,
            bin: None, last4: None, bank_name: None, card_type: None,
            card_level: None, status: "deleted".into(), source: String::new(),
            notes: None, created_at: String::new(),
        });
        let drops = self.get_drops_for_profile(id)?;
        let orders = self.get_orders_summary_for_profile(id)?;
        Ok(ProfileDetail { profile, card, drops, orders })
    }

    fn get_drops_for_profile(&self, profile_id: &str) -> Result<Vec<Drop>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at FROM drops WHERE profile_id=?1 ORDER BY is_primary DESC,id ASC"
        ).map_err(|e| e.to_string())?;
        // FIX B21: дешифруем PII поля при чтении
        let rows: Vec<(i64,String,String,String,Option<String>,Option<String>,Option<String>,Option<String>,Option<String>,i64,String)> =
            stmt.query_map(params![profile_id], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                r.get(8)?, r.get::<_,i64>(9)?, r.get(10)?
            ))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(rows.into_iter().map(|(id, profile_id, enc_name, enc_addr, city, state, zip, country, enc_phone, is_pri, created_at)| {
            Drop {
                id, profile_id,
                recipient_name: self.decrypt_field(&enc_name).unwrap_or(enc_name),
                address: self.decrypt_field(&enc_addr).unwrap_or(enc_addr),
                city: city.unwrap_or_default(), state, zip: zip.unwrap_or_default(), country: country.unwrap_or_default(),
                phone: enc_phone.map(|p| self.decrypt_field(&p).unwrap_or(p)),
                is_primary: is_pri != 0,
                created_at,
            }
        }).collect())
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
        // FIX B33: освобождаем карту из статуса in_use при удалении профиля
        let card_id: Option<i64> = self.conn.query_row(
            "SELECT card_id FROM profiles WHERE id=?1",
            params![id], |r| r.get(0),
        ).ok();
        self.conn.execute("DELETE FROM profiles WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        if let Some(cid) = card_id {
            // Освобождаем карту только если других профилей на неё нет
            let remaining: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM profiles WHERE card_id=?1",
                params![cid], |r| r.get(0),
            ).unwrap_or(0);
            if remaining == 0 {
                let _ = self.conn.execute(
                    "UPDATE credit_cards SET status='free' WHERE id=?1 AND status='in_use'",
                    params![cid],
                );
            }
        }
        Ok(())
    }

    pub fn duplicate_profile(&self, id: &str) -> Result<Profile, String> {
        let src = self.build_profile(id)?;
        self.create_profile(src.card_id, src.notes.map(|n| format!("{} (copy)", n)))
    }

    pub fn find_duplicate_profiles(&self) -> Result<Vec<Vec<Profile>>, String> {
        // FIX B35: группируем все профили на одной карте, а не попарно
        let mut stmt = self.conn.prepare(
            "SELECT id, card_id FROM profiles WHERE card_id IN \
             (SELECT card_id FROM profiles GROUP BY card_id HAVING COUNT(*) > 1) \
             ORDER BY card_id, id"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

        let mut by_card: std::collections::BTreeMap<i64, Vec<String>> = Default::default();
        for (pid, cid) in rows {
            by_card.entry(cid).or_default().push(pid);
        }
        let mut groups = vec![];
        for (_cid, pids) in by_card {
            let profiles: Vec<Profile> = pids.iter()
                .filter_map(|pid| self.build_profile(pid).ok())
                .collect();
            if profiles.len() > 1 {
                groups.push(profiles);
            }
        }
        Ok(groups)
    }

    // ── Profile Templates ─────────────────

    pub fn save_profile_template(&self, name: &str, country: Option<&str>, state: Option<&str>, city: Option<&str>, phone_prefix: Option<&str>, source: Option<&str>) -> Result<i64, String> {
        self.conn.execute(
            "INSERT INTO profile_templates(name,country,state,city,phone_prefix,source) VALUES(?1,?2,?3,?4,?5,?6)",
            params![name, country, state, city, phone_prefix, source],
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_profile_templates(&self) -> Result<Vec<crate::models::ProfileTemplate>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,name,country,state,city,phone_prefix,source,created_at FROM profile_templates ORDER BY name"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(crate::models::ProfileTemplate {
            id: r.get(0)?,
            name: r.get(1)?,
            country: r.get(2)?,
            state: r.get(3)?,
            city: r.get(4)?,
            phone_prefix: r.get(5)?,
            source: r.get(6)?,
            created_at: r.get(7)?,
        })).map_err(|e| e.to_string())?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }

    pub fn delete_profile_template(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM profile_templates WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Drops ─────────────────────────────

    pub fn add_drop(&self, profile_id: &str, drop: &DropInput) -> Result<Drop, String> {
        // Make first drop primary automatically
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM drops WHERE profile_id=?1", params![profile_id], |r| r.get(0),
        ).unwrap_or(0);
        let is_primary = count == 0;
        // FIX B21: шифруем PII поля перед записью
        let enc_name = self.encrypt_field(&drop.recipient_name)?;
        let enc_addr = self.encrypt_field(&drop.address)?;
        let enc_phone = drop.phone.as_deref().map(|p| self.encrypt_field(p)).transpose()?;
        self.conn.execute(
            "INSERT INTO drops(profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,datetime('now'))",
            params![profile_id, enc_name, enc_addr, drop.city, drop.state, drop.zip, drop.country, enc_phone, is_primary as i64],
        ).map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid();
        Ok(Drop {
            id, profile_id: profile_id.to_string(),
            recipient_name: drop.recipient_name.clone(), address: drop.address.clone(),
            city: drop.city.clone(), state: drop.state.clone(), zip: drop.zip.clone(),
            country: drop.country.clone(), phone: drop.phone.clone(),
            is_primary, created_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        })
    }

    pub fn update_drop(&self, id: i64, drop: &DropInput) -> Result<(), String> {
        // FIX B21: шифруем PII перед обновлением
        let enc_name = self.encrypt_field(&drop.recipient_name)?;
        let enc_addr = self.encrypt_field(&drop.address)?;
        let enc_phone = drop.phone.as_deref().map(|p| self.encrypt_field(p)).transpose()?;
        self.conn.execute(
            "UPDATE drops SET recipient_name=?1,address=?2,city=?3,state=?4,zip=?5,country=?6,phone=?7 WHERE id=?8",
            params![enc_name, enc_addr, drop.city, drop.state, drop.zip, drop.country, enc_phone, id],
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
        // FIX B70: обёртка в транзакцию для атомарности
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = (|| -> Result<u32, String> {
            for row in rows {
                self.add_drop(profile_id, &row)?;
                imported += 1;
            }
            Ok(imported)
        })();
        match result {
            Ok(n) => {
                self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                Ok(ImportResult { total, imported: n, skipped: total - n, errors: vec![] })
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    pub fn find_duplicate_drops(&self) -> Result<Vec<Vec<Drop>>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,profile_id,recipient_name,address,city,state,zip,country,phone,is_primary,created_at FROM drops WHERE address IN (SELECT address FROM drops GROUP BY LOWER(address) HAVING COUNT(*)>1) ORDER BY LOWER(address)"
        ).map_err(|e| e.to_string())?;
        let drops: Vec<Drop> = stmt.query_map([], |r| Ok(Drop {
            id: r.get(0)?, profile_id: r.get(1)?, recipient_name: r.get(2)?,
            address: r.get(3)?,
            city: r.get::<_,Option<String>>(4)?.unwrap_or_default(),
            state: r.get(5)?,
            zip: r.get::<_,Option<String>>(6)?.unwrap_or_default(),
            country: r.get::<_,Option<String>>(7)?.unwrap_or_default(),
            phone: r.get(8)?,
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
        let total_pages = (total as u32 + per_page - 1) / per_page.max(1); // FIX B16: единая формула ceil(total/per_page)
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
        let (host, port, ptype, username, pw_enc, label, notes, is_blocked, created_at, updated_at, last_checked):
            (String, i64, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, String, String, Option<String>) =
            self.conn.query_row(
                "SELECT host,port,proxy_type,username,password,label,notes,is_blocked,created_at,updated_at,last_checked FROM proxies WHERE id=?1",
                params![id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?,r.get(8)?,r.get(9)?,r.get(10)?))
            ).map_err(|e| e.to_string())?;
        let password = pw_enc.as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| self.decrypt_field(s).ok());
        let shops_used = self.proxy_shops_used(id)?;
        Ok(Proxy { id, host, port, proxy_type: ptype, username, password, label, notes,
            is_blocked: is_blocked != 0, shops_used, created_at, updated_at, last_checked })
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
            let parts: Vec<&str> = line.trim().splitn(4, ':').collect();
            if parts.len() < 2 { skipped += 1; continue; }
            let host = parts[0].to_string();
            let port: i64 = parts[1].parse().unwrap_or(0);
            // FIX B41: валидируем диапазон порта 1-65535
            if port < 1 || port > 65535 { skipped += 1; continue; }
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
        let total_pages = (total as u32 + per_page - 1) / per_page.max(1); // FIX B16: единая формула ceil(total/per_page)
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

    pub fn check_all_proxy_health(&self) -> Result<crate::ProxyHealthResult, String> {
        // For now just mark all non-blocked proxies as needing recheck
        // Real HTTP check would happen here - for now update last_checked timestamp
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE proxies SET last_checked=?1 WHERE is_blocked=0",
            params![now],
        ).map_err(|e| e.to_string())?;

        let total: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM proxies WHERE is_blocked=0", [], |r| r.get(0)
        ).map_err(|e| e.to_string())?;

        // "online" = non-blocked proxies that have a last_checked timestamp
        let online: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM proxies WHERE is_blocked=0 AND last_checked IS NOT NULL", [], |r| r.get(0)
        ).map_err(|e| e.to_string())?;

        Ok(crate::ProxyHealthResult {
            checked: total,
            online,
            offline: total.saturating_sub(online),
        })
    }

    pub fn get_proxy_usage_stats(&self) -> Result<Vec<crate::ProxyUsageStat>, String> {
        // Check if proxy_id column exists on orders table
        let has_proxy = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('orders') WHERE name='proxy_id'",
            [], |r| r.get::<_, i64>(0)
        ).unwrap_or(0) > 0;

        if !has_proxy {
            return Ok(vec![]);
        }

        let mut stmt = self.conn.prepare(
            "SELECT p.id,
                    COUNT(o.id) as total,
                    SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) as success,
                    SUM(CASE WHEN o.status='declined' THEN 1 ELSE 0 END) as declined
             FROM proxies p
             LEFT JOIN orders o ON o.proxy_id = p.id
             GROUP BY p.id
             HAVING total > 0
             ORDER BY total DESC
             LIMIT 50"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |r| {
            Ok(crate::ProxyUsageStat {
                proxy_id: r.get(0)?,
                total_orders: r.get::<_, u32>(1).unwrap_or(0),
                success_count: r.get::<_, u32>(2).unwrap_or(0),
                decline_count: r.get::<_, u32>(3).unwrap_or(0),
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
        let total_pages = (total as u32 + per_page - 1) / per_page.max(1); // FIX B16: единая формула ceil(total/per_page)
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

    pub fn search_catalog_items(&self, q: &str, limit: u64) -> Result<Vec<CatalogItem>, String> {
        let pattern = format!("%{}%", q.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT id,name,asin,price,pct,category,notes_en,stop FROM catalog_items \
             WHERE stop=0 AND (LOWER(name) LIKE ?1 OR asin LIKE ?2) \
             ORDER BY CASE WHEN LOWER(name) LIKE ?3 THEN 0 ELSE 1 END, price DESC \
             LIMIT ?4"
        ).map_err(|e| e.to_string())?;
        let starts_pattern = format!("{}%", q.to_lowercase());
        let rows = stmt.query_map(
            rusqlite::params![&pattern, &format!("%{}%", q.to_uppercase()), &starts_pattern, limit as i64],
            |row| Ok(CatalogItem {
                id: row.get(0)?,
                name: row.get(1)?,
                asin: row.get(2)?,
                price: row.get(3)?,
                pct: row.get(4)?,
                category: row.get(5)?,
                notes_en: row.get(6)?,
                stop: row.get::<_, i64>(7).unwrap_or(0) != 0,
            })
        ).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn search_catalog_shops(&self, q: &str, limit: u64) -> Result<Vec<CatalogShop>, String> {
        let pattern = format!("%{}%", q.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT id,domain,category,score,ship_us,fraud_level,top_brands,top_products,excluded FROM catalog_shops \
             WHERE excluded=0 AND LOWER(domain) LIKE ?1 \
             ORDER BY score DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(
            rusqlite::params![&pattern, limit as i64],
            |row| Ok(CatalogShop {
                id: row.get(0)?,
                domain: row.get(1)?,
                category: row.get(2)?,
                score: row.get(3)?,
                ship_us: row.get::<_, i64>(4).unwrap_or(0) != 0,
                fraud_level: row.get(5)?,
                top_brands: row.get(6)?,
                top_products: row.get(7)?,
                excluded: row.get::<_, i64>(8).unwrap_or(0) != 0,
            })
        ).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_catalog_stats(&self) -> Result<CatalogStats, String> {
        let items: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE stop=0", [], |r| r.get(0)
        ).map_err(|e| e.to_string())?;
        let shops: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM catalog_shops WHERE excluded=0", [], |r| r.get(0)
        ).map_err(|e| e.to_string())?;
        Ok(CatalogStats { items, shops })
    }

    pub fn import_catalog_items_batch(&self, items: &[CatalogItemInput]) -> Result<usize, String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut count = 0usize;
        for item in items {
            self.conn.execute(
                "INSERT OR REPLACE INTO catalog_items(id,name,asin,price,pct,category,notes_en,stop) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![item.id, item.name, item.asin, item.price, item.pct, item.category, item.notes_en, item.stop as i64],
            ).map_err(|e| e.to_string())?;
            count += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn import_catalog_shops_batch(&self, shops: &[CatalogShopInput]) -> Result<usize, String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut count = 0usize;
        for shop in shops {
            self.conn.execute(
                "INSERT OR REPLACE INTO catalog_shops(domain,category,score,ship_us,fraud_level,top_brands,top_products,excluded) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![shop.domain, shop.category, shop.score, shop.ship_us as i64, shop.fraud_level, shop.top_brands, shop.top_products, shop.excluded as i64],
            ).map_err(|e| e.to_string())?;
            count += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }

    pub fn get_catalog_items_paged(&self, search: &str, page: u32, per_page: u32) -> Result<PaginatedCatalogItems, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let (total, items) = if search.is_empty() {
            let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM catalog_items", [], |r| r.get(0)).unwrap_or(0);
            let mut stmt = self.conn.prepare(
                "SELECT id,name,asin,price,pct,category,notes_en,stop FROM catalog_items ORDER BY name ASC LIMIT ?1 OFFSET ?2"
            ).map_err(|e| e.to_string())?;
            let items: Vec<CatalogItem> = stmt.query_map(params![pp, offset], |r| Ok(CatalogItem {
                id: r.get(0)?, name: r.get(1)?, asin: r.get(2)?, price: r.get(3)?,
                pct: r.get(4)?, category: r.get(5)?, notes_en: r.get(6)?,
                stop: r.get::<_, i64>(7).map(|v| v != 0)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (total, items)
        } else {
            let pattern = format!("%{}%", search.to_lowercase());
            let total: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM catalog_items WHERE LOWER(name) LIKE ?1 OR LOWER(COALESCE(asin,'')) LIKE ?1",
                params![pattern], |r| r.get(0)
            ).unwrap_or(0);
            let mut stmt = self.conn.prepare(
                "SELECT id,name,asin,price,pct,category,notes_en,stop FROM catalog_items \
                 WHERE LOWER(name) LIKE ?1 OR LOWER(COALESCE(asin,'')) LIKE ?1 \
                 ORDER BY name ASC LIMIT ?2 OFFSET ?3"
            ).map_err(|e| e.to_string())?;
            let items: Vec<CatalogItem> = stmt.query_map(params![pattern, pp, offset], |r| Ok(CatalogItem {
                id: r.get(0)?, name: r.get(1)?, asin: r.get(2)?, price: r.get(3)?,
                pct: r.get(4)?, category: r.get(5)?, notes_en: r.get(6)?,
                stop: r.get::<_, i64>(7).map(|v| v != 0)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (total, items)
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedCatalogItems { items, total: total as u32, page, per_page, pages })
    }

    pub fn get_catalog_shops_paged(&self, search: &str, page: u32, per_page: u32) -> Result<PaginatedCatalogShops, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let (total, items) = if search.is_empty() {
            let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM catalog_shops", [], |r| r.get(0)).unwrap_or(0);
            let mut stmt = self.conn.prepare(
                "SELECT id,domain,category,score,ship_us,fraud_level,top_brands,top_products,excluded FROM catalog_shops ORDER BY domain ASC LIMIT ?1 OFFSET ?2"
            ).map_err(|e| e.to_string())?;
            let items: Vec<CatalogShop> = stmt.query_map(params![pp, offset], |r| Ok(CatalogShop {
                id: r.get(0)?, domain: r.get(1)?, category: r.get(2)?, score: r.get(3)?,
                ship_us: r.get::<_, i64>(4).map(|v| v != 0)?,
                fraud_level: r.get(5)?, top_brands: r.get(6)?, top_products: r.get(7)?,
                excluded: r.get::<_, i64>(8).map(|v| v != 0)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (total, items)
        } else {
            let pattern = format!("%{}%", search.to_lowercase());
            let total: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM catalog_shops WHERE LOWER(domain) LIKE ?1",
                params![pattern], |r| r.get(0)
            ).unwrap_or(0);
            let mut stmt = self.conn.prepare(
                "SELECT id,domain,category,score,ship_us,fraud_level,top_brands,top_products,excluded FROM catalog_shops \
                 WHERE LOWER(domain) LIKE ?1 ORDER BY domain ASC LIMIT ?2 OFFSET ?3"
            ).map_err(|e| e.to_string())?;
            let items: Vec<CatalogShop> = stmt.query_map(params![pattern, pp, offset], |r| Ok(CatalogShop {
                id: r.get(0)?, domain: r.get(1)?, category: r.get(2)?, score: r.get(3)?,
                ship_us: r.get::<_, i64>(4).map(|v| v != 0)?,
                fraud_level: r.get(5)?, top_brands: r.get(6)?, top_products: r.get(7)?,
                excluded: r.get::<_, i64>(8).map(|v| v != 0)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (total, items)
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedCatalogShops { items, total: total as u32, page, per_page, pages })
    }

    pub fn toggle_catalog_item_stop(&self, id: i64, stop: bool) -> Result<(), String> {
        self.conn.execute("UPDATE catalog_items SET stop=?1 WHERE id=?2", params![stop as i64, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_catalog_items(&self, ids: &[i64]) -> Result<u32, String> {
        if ids.is_empty() { return Ok(0); }
        let placeholders: String = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM catalog_items WHERE id IN ({})", placeholders);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let count = stmt.execute(rusqlite::params_from_iter(ids.iter())).map_err(|e| e.to_string())?;
        Ok(count as u32)
    }

    pub fn toggle_catalog_shop_excluded(&self, id: i64, excluded: bool) -> Result<(), String> {
        self.conn.execute("UPDATE catalog_shops SET excluded=?1 WHERE id=?2", params![excluded as i64, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_shop_smart_suggestions(&self, shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
        let mut suggestions = vec![];

        // Карта отклонялась на этом магазине
        let declined: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id JOIN credit_cards c ON p.card_id=c.id WHERE o.shop_id=?1 AND c.id=?2 AND o.status IN ('declined','failed')",
            params![shop_id, card_id], |r| r.get(0),
        ).unwrap_or(0);
        if declined > 0 {
            suggestions.push(Suggestion { level: "warning".into(), message: format!("This card was declined {} time(s) at this shop", declined) });
        }

        let shop = self.build_shop(shop_id)?;

        // FIX B72: все флаги магазина учитываются
        if shop.requires_avs {
            suggestions.push(Suggestion { level: "info".into(), message: "This shop requires AVS — billing address must match exactly".into() });
        }
        if shop.blocks_vpn {
            suggestions.push(Suggestion { level: "warning".into(), message: "This shop blocks VPN/datacenter IPs — use residential proxy".into() });
        }
        if shop.requires_cvv_match {
            suggestions.push(Suggestion { level: "info".into(), message: "This shop verifies CVV — ensure card CVV is correct".into() });
        }
        if shop.phone_must_match {
            suggestions.push(Suggestion { level: "info".into(), message: "This shop requires phone number to match billing records".into() });
        }
        if shop.high_cancel_risk {
            suggestions.push(Suggestion { level: "warning".into(), message: "This shop has high cancel/fraud review rate — orders may be cancelled post-checkout".into() });
        }

        // Amex не принимается — проверяем тип карты
        if !shop.accepts_amex {
            let card_type: Option<String> = self.conn.query_row(
                "SELECT card_type FROM credit_cards WHERE id=?1", params![card_id], |r| r.get(0),
            ).ok().flatten();
            if card_type.as_deref().map(|t| t.to_lowercase().contains("amex") || t.to_lowercase().contains("american")).unwrap_or(false) {
                suggestions.push(Suggestion { level: "error".into(), message: "This shop does not accept American Express cards".into() });
            }
        }

        // Общий успех на магазине
        if shop.total_orders >= 5 && shop.success_rate < 30.0 {
            suggestions.push(Suggestion { level: "warning".into(), message: format!("Low success rate at this shop: {:.0}%", shop.success_rate) });
        }

        Ok(suggestions)
    }

    // ── Orders ────────────────────────────

    fn build_order(&self, id: i64) -> Result<Order, String> {
        let row: (String,i64,Option<i64>,Option<i64>,Option<i64>,Option<String>,String,Option<f64>,Option<String>,Option<String>,Option<String>,Option<String>,String,String,Option<String>,Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>) =
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
        // FIX B51: card_expiring — карта истекает в ближайшие 30 дней
        let card_expiring: bool = if let Some(card_id) = row.17 {
            self.conn.query_row(
                "SELECT COUNT(*) FROM credit_cards WHERE id=?1 AND expiry_date IS NOT NULL AND expiry_date != '' AND \
                 (CAST(substr(expiry_date,4,2) AS INTEGER)+2000)*12 + CAST(substr(expiry_date,1,2) AS INTEGER) \
                 BETWEEN \
                 (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) \
                 AND \
                 (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) + 1",
                params![card_id], |r| r.get::<_,i64>(0),
            ).unwrap_or(0) > 0
        } else { false };
        // FIX B51: bin_declined_here — этот BIN уже отклоняли в этом магазине
        let bin_declined_here: bool = self.conn.query_row(
            "SELECT COUNT(*) FROM orders o2 \
             JOIN profiles p2 ON o2.profile_id=p2.id \
             JOIN credit_cards c2 ON p2.card_id=c2.id \
             JOIN orders o_cur ON o_cur.id=?1 \
             WHERE o2.shop_id=o_cur.shop_id AND c2.bin=(SELECT bin FROM credit_cards WHERE id=p2.card_id LIMIT 1) \
             AND o2.status IN ('declined','failed') AND o2.id != ?1",
            params![id, id], |r| r.get::<_,i64>(0),
        ).unwrap_or(0) > 0;
        Ok(Order {
            id, profile_id: row.0, shop_id: row.1, drop_id: row.2.unwrap_or(0),
            email_pool_id: row.3, proxy_id: row.4, order_number: row.5,
            status: row.6, total_amount: row.7, tracking_number: row.8,
            carrier: row.9, notes: row.10, items_json: row.11,
            created_at: row.12, updated_at: row.13,
            card_id: row.17, shop_name: row.14, holder_masked, last4: row.16,
            bank_name: None, proxy_label: row.18, email_addr: row.19,
            pending_too_long, card_expiring, bin_declined_here,
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

        // FIX B25: записываем footprint при каждом создании заказа
        let _ = self.record_order_footprint(oid, &input.profile_id, input.shop_id,
            input.email_pool_id, input.drop_id, input.proxy_id);

        self.build_order(oid)
    }

    /// FIX B25: записывает hashed footprint данные заказа в shop_footprints
    fn record_order_footprint(&self, order_id: i64, profile_id: &str, shop_id: i64,
        email_pool_id: Option<i64>, drop_id: Option<i64>, proxy_id: Option<i64>) -> Result<(), String>
    {
        use crate::encryption::hash_value;

        // Получаем domain магазина
        let shop_domain: Option<String> = self.conn.query_row(
            "SELECT LOWER(domain) FROM shops WHERE id=?1", params![shop_id], |r| r.get(0),
        ).ok();

        // Хешируем email
        let email_hash = email_pool_id.and_then(|eid| {
            self.conn.query_row("SELECT email FROM email_pool WHERE id=?1", params![eid], |r| r.get::<_,String>(0)).ok()
        }).map(|e| hash_value(&e));

        // Хешируем адрес дропа
        let drop_hash = drop_id.and_then(|did| {
            self.conn.query_row("SELECT address||'|'||zip||'|'||COALESCE(phone,'') FROM drops WHERE id=?1",
                params![did], |r| r.get::<_,String>(0)).ok()
        }).map(|a| hash_value(&a));

        // BIN и phone/name из карты профиля
        let (bin, phone_hash, name_hash): (Option<String>, Option<String>, Option<String>) =
            self.conn.query_row(
                "SELECT c.bin, c.phone, c.holder_name FROM credit_cards c JOIN profiles p ON p.card_id=c.id WHERE p.id=?1",
                params![profile_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            ).map(|(b, ph, hn): (Option<String>, Option<String>, Option<String>)| {
                let ph_hash = ph.as_deref()
                    .and_then(|p| self.decrypt_field(p).ok())
                    .map(|p| hash_value(&p));
                let nm_hash = hn.as_deref()
                    .and_then(|n| self.decrypt_field(n).ok())
                    .map(|n| hash_value(&n));
                (b, ph_hash, nm_hash)
            }).unwrap_or((None, None, None));

        // Хешируем IP прокси
        let ip_hash = if let Some(pid) = proxy_id {
            self.conn.query_row(
                "SELECT host FROM proxies WHERE id = ?",
                [pid],
                |row| row.get::<_, String>(0)
            ).ok().map(|ip| {
                use sha2::{Sha256, Digest};
                let mut hasher = Sha256::new();
                hasher.update(ip.as_bytes());
                format!("{:x}", hasher.finalize())
            })
        } else {
            None
        };

        self.conn.execute(
            "INSERT INTO shop_footprints(shop_id,shop_domain,order_id,email_id,proxy_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0)",
            params![shop_id, shop_domain, order_id, email_pool_id, proxy_id, email_hash, ip_hash, drop_hash, bin, phone_hash, name_hash],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_orders(&self, filter: &OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut wh = vec!["1=1".to_string()];
        if let Some(ref s) = filter.status { wh.push(format!("o.status='{}'", s.replace('\'', "''"))); }
        if let Some(sid) = filter.shop_id { wh.push(format!("o.shop_id={}", sid)); }
        if let Some(ref d) = filter.date_from { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { wh.push(format!("DATE(o.created_at)>='{}'", d)); } }
        if let Some(ref d) = filter.date_to   { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { wh.push(format!("DATE(o.created_at)<='{}'", d)); } }
        if let Some(ref s) = filter.search {
            // FIX B14: экранируем wildcards LIKE
            let q = Self::escape_like(&s.replace('\'', "''"));
            wh.push(format!("(o.order_number LIKE '%{0}%' ESCAPE '\\' OR s.name LIKE '%{0}%' ESCAPE '\\')", q));
        }
        let w = wh.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE {}", w), [], |r| r.get(0),
        ).unwrap_or(0);
        // FIX B54: один JOIN-запрос вместо N вызовов build_order
        let mut stmt = self.conn.prepare(&format!(
            "SELECT o.id,o.profile_id,o.shop_id,o.drop_id,o.email_pool_id,o.proxy_id,\
             o.order_number,o.status,o.total_amount,o.tracking_number,o.carrier,o.notes,\
             o.items_json,o.created_at,o.updated_at,s.name,c.holder_name,c.last4,c.id,\
             COALESCE(px.label,px.host||':'||px.port),ep.email \
             FROM orders o \
             LEFT JOIN shops s ON o.shop_id=s.id \
             LEFT JOIN profiles p ON o.profile_id=p.id \
             LEFT JOIN credit_cards c ON p.card_id=c.id \
             LEFT JOIN proxies px ON o.proxy_id=px.id \
             LEFT JOIN email_pool ep ON o.email_pool_id=ep.id \
             WHERE {} ORDER BY o.created_at DESC LIMIT {} OFFSET {}",
            w, pp, offset
        )).map_err(|e| e.to_string())?;
        let items: Vec<Order> = stmt.query_map([], |r| {
            let id: i64 = r.get(0)?;
            let holder_enc: Option<String> = r.get(16)?;
            Ok((id, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?, r.get(15)?,
                holder_enc, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?))
        }).map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .map(|(id, profile_id, shop_id, drop_id, email_pool_id, proxy_id,
               order_number, status, total_amount, tracking_number, carrier,
               notes, items_json, created_at, updated_at, shop_name,
               holder_enc, last4, card_id, proxy_label, email_addr):
              (i64,String,i64,Option<i64>,Option<i64>,Option<i64>,
               Option<String>,String,Option<f64>,Option<String>,Option<String>,
               Option<String>,Option<String>,String,String,Option<String>,
               Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>)| {
            let holder_masked = holder_enc.as_deref()
                .and_then(|h| self.decrypt_field(h).ok())
                .map(|n| mask_name(&n));
            Order {
                id, profile_id, shop_id, drop_id: drop_id.unwrap_or(0), email_pool_id, proxy_id,
                order_number, status, total_amount, tracking_number, carrier,
                notes, items_json, created_at, updated_at, shop_name,
                holder_masked, last4, card_id, bank_name: None,
                proxy_label, email_addr,
                pending_too_long: false, card_expiring: false, bin_declined_here: false,
            }
        }).collect();
        let total_pages = (total as u32 + per_page - 1) / per_page.max(1); // FIX B16: единая формула ceil(total/per_page)
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

    pub fn get_recent_orders_by_profile(&self, profile_id: &str, limit: u32) -> Result<Vec<Order>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM orders WHERE profile_id=?1 ORDER BY created_at DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map(params![profile_id, limit], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        ids.into_iter().map(|id| self.build_order(id)).collect()
    }

    pub fn update_order_status(&self, id: i64, status: &str, meta: Option<&StatusMeta>) -> Result<(), String> {
        // FIX B64: валидация допустимых статусов
        const VALID_STATUSES: &[&str] = &["pending", "shipped", "delivered", "declined", "cancelled", "failed"];
        if !VALID_STATUSES.contains(&status) {
            return Err(format!("invalid_status: '{}'. Allowed: {}", status, VALID_STATUSES.join(", ")));
        }
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

    /// Returns (order_id, tracking_number) for active orders that have a tracking number
    pub fn get_orders_with_tracking(&self) -> Result<Vec<(i64, Option<String>)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, tracking_number FROM orders WHERE tracking_number IS NOT NULL AND tracking_number != '' \
             AND status NOT IN ('delivered','cancelled','failed') LIMIT 200"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,Option<String>>(1)?)))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }

    /// Update order status by tracking number (used by background tracking thread)
    pub fn update_order_status_by_tracking(&self, tracking: &str, status: &str) -> Result<(), String> {
        let id: Option<i64> = self.conn.query_row(
            "SELECT id FROM orders WHERE tracking_number=?1 AND status NOT IN ('delivered','cancelled','failed') LIMIT 1",
            params![tracking], |r| r.get(0),
        ).ok();
        if let Some(oid) = id {
            self.conn.execute(
                "UPDATE orders SET status=?1,updated_at=datetime('now') WHERE id=?2",
                params![status, oid],
            ).map_err(|e| e.to_string())?;
            let _ = self.log_event(
                "order.tracking_updated",
                &format!("Order {} → {} (Track17)", oid, status),
                Some("order"), Some(&oid.to_string()),
            );
        }
        Ok(())
    }

    // FIX B31: принимаем drop_id, email_pool_id, proxy_id и учитываем их в оценке риска
    pub fn run_risk_check(&self, profile_id: &str, shop_id: i64,
        drop_id: Option<i64>, email_pool_id: Option<i64>, proxy_id: Option<i64>
    ) -> Result<RiskCheckResult, String> {
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

        // FIX B32: реальная проверка — карта истекает в ближайшие 30 дней
        let expiring: bool = self.conn.query_row(
            "SELECT COUNT(*) FROM credit_cards c JOIN profiles p ON p.card_id=c.id \
             WHERE p.id=?1 AND c.expiry_date IS NOT NULL AND c.expiry_date != '' AND \
             date('20'||substr(c.expiry_date,4,2)||'-'||substr(c.expiry_date,1,2)||'-01','+1 month','-1 day') \
             BETWEEN date('now') AND date('now','+30 days')",
            params![profile_id], |r| r.get::<_,i64>(0),
        ).unwrap_or(0) > 0;
        if expiring {
            score += 10;
            warnings.push(RiskWarning { kind: "card_expiring".into(), severity: "warning".into(),
                message: "Card expires within 30 days".into(),
                related_order_id: None, related_order_status: None });
        }

        // FIX B31: проверяем email — использовался ли в других заказах на этот магазин
        if let Some(eid) = email_pool_id {
            let email_reused: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM orders WHERE shop_id=?1 AND email_pool_id=?2 AND profile_id!=?3 AND status NOT IN ('declined','failed','cancelled')",
                params![shop_id, eid, profile_id], |r| r.get(0),
            ).unwrap_or(0);
            if email_reused > 0 {
                score += 25;
                warnings.push(RiskWarning { kind: "email_reused_shop".into(), severity: "warning".into(),
                    message: format!("This email was used {} time(s) at this shop with other profiles", email_reused),
                    related_order_id: None, related_order_status: None });
            }
        }

        // FIX B31: проверяем прокси — заблокирован ли на этом магазине
        if let Some(pid) = proxy_id {
            let proxy_blocked: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM orders WHERE shop_id=?1 AND proxy_id=?2 AND status IN ('declined','failed')",
                params![shop_id, pid], |r| r.get(0),
            ).unwrap_or(0);
            if proxy_blocked > 0 {
                score += 20;
                warnings.push(RiskWarning { kind: "proxy_failed_shop".into(), severity: "warning".into(),
                    message: format!("This proxy had {} failure(s) at this shop", proxy_blocked),
                    related_order_id: None, related_order_status: None });
            }
        }

        // FIX B31: проверяем drop — адрес использовался на этом магазине
        if let Some(did) = drop_id {
            let drop_used: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM orders WHERE shop_id=?1 AND drop_id=?2 AND profile_id!=?3 AND status NOT IN ('declined','failed','cancelled')",
                params![shop_id, did, profile_id], |r| r.get(0),
            ).unwrap_or(0);
            if drop_used > 0 {
                score += 25;
                warnings.push(RiskWarning { kind: "drop_reused_shop".into(), severity: "warning".into(),
                    message: format!("This shipping address was used {} time(s) at this shop", drop_used),
                    related_order_id: None, related_order_status: None });
            }
        }

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

    // ─────────────────────────────────────────
    //  Card → Shops usage (Footprint)
    // ─────────────────────────────────────────

    pub fn get_card_shop_usage(&self, card_id: i64) -> Result<Vec<CardShopUsage>, String> {
        let mut stmt = self.conn.prepare("
            SELECT s.id, s.name, s.domain,
                   COUNT(o.id) AS order_count,
                   MAX(o.created_at) AS last_order_date,
                   (SELECT o2.status FROM orders o2
                    JOIN profiles p2 ON p2.id = o2.profile_id
                    WHERE p2.card_id = ?1 AND o2.shop_id = s.id
                    ORDER BY o2.created_at DESC LIMIT 1) AS last_status
            FROM shops s
            JOIN orders o ON o.shop_id = s.id
            JOIN profiles p ON p.id = o.profile_id
            WHERE p.card_id = ?1
            GROUP BY s.id, s.name, s.domain
            ORDER BY order_count DESC
        ").map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![card_id], |row| {
            Ok(CardShopUsage {
                shop_id:         row.get(0)?,
                shop_name:       row.get(1)?,
                shop_domain:     row.get(2)?,
                order_count:     row.get(3)?,
                last_order_date: row.get(4)?,
                last_status:     row.get(5)?,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        Ok(rows)
    }

    // ─────────────────────────────────────────
    //  Email footprint stats
    // ─────────────────────────────────────────

    pub fn get_email_footprint_stats(&self, email_id: i64) -> Result<EmailFootprintStats, String> {
        let total_orders: i64 = self.conn.query_row(
            "SELECT COUNT(o.id) FROM orders o
             WHERE o.email_pool_id = ?1",
            params![email_id],
            |r| r.get(0),
        ).unwrap_or(0);

        let unique_shops: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT o.shop_id) FROM orders o WHERE o.email_pool_id = ?1",
            params![email_id],
            |r| r.get(0),
        ).unwrap_or(0);

        let mut stmt = self.conn.prepare("
            SELECT s.id, s.name, COUNT(o.id) AS cnt
            FROM orders o
            JOIN shops s ON s.id = o.shop_id
            WHERE o.email_pool_id = ?1
            GROUP BY s.id, s.name
            ORDER BY cnt DESC
            LIMIT 10
        ").map_err(|e| e.to_string())?;

        let shops: Vec<ShopUsageBrief> = stmt.query_map(params![email_id], |row| {
            Ok(ShopUsageBrief {
                shop_id:    row.get(0)?,
                shop_name:  row.get(1)?,
                order_count: row.get(2)?,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        let is_burned = unique_shops >= 3;

        Ok(EmailFootprintStats { total_orders, unique_shops, shops, is_burned })
    }

    // ─────────────────────────────────────────
    //  Shop risk score
    // ─────────────────────────────────────────

    pub fn get_shop_risk_score(&self, shop_id: i64) -> Result<ShopRiskScore, String> {
        let total: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE shop_id = ?1",
            params![shop_id], |r| r.get(0),
        ).unwrap_or(0);

        let declined: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status = 'declined'",
            params![shop_id], |r| r.get(0),
        ).unwrap_or(0);

        let unique_emails: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT email_pool_id) FROM orders WHERE shop_id = ?1 AND email_pool_id IS NOT NULL",
            params![shop_id], |r| r.get(0),
        ).unwrap_or(0);

        let unique_ips: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT f.ip_hash) FROM footprints f WHERE f.shop_id = ?1 AND f.ip_hash IS NOT NULL",
            params![shop_id], |r| r.get(0),
        ).unwrap_or(0);

        let decline_rate = if total > 0 { declined as f64 / total as f64 } else { 0.0 };
        let risk_level = if decline_rate >= 0.5 || unique_emails >= 20 {
            "high".to_string()
        } else if decline_rate >= 0.25 || unique_emails >= 10 {
            "medium".to_string()
        } else {
            "low".to_string()
        };

        Ok(ShopRiskScore { shop_id, decline_rate, unique_emails, unique_ips, risk_level })
    }

    // ─────────────────────────────────────────
    //  Card timeline
    // ─────────────────────────────────────────

    pub fn get_card_timeline(&self, card_id: i64) -> Result<Vec<CardTimelineEvent>, String> {
        // From activity log for this card
        let mut events: Vec<CardTimelineEvent> = Vec::new();

        let mut stmt = self.conn.prepare(
            "SELECT event_type, description, entity_type, entity_id, created_at
             FROM activity_log
             WHERE (entity_type = 'card' AND entity_id = ?1)
                OR (entity_type = 'order' AND entity_id IN (
                    SELECT CAST(o.id AS TEXT) FROM orders o
                    JOIN profiles p ON p.id = o.profile_id
                    WHERE p.card_id = ?1
                ))
             ORDER BY created_at ASC
             LIMIT 100"
        ).map_err(|e| e.to_string())?;

        let log_events: Vec<CardTimelineEvent> = stmt.query_map(params![card_id], |row| {
            Ok(CardTimelineEvent {
                event_type:  row.get(0)?,
                description: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                entity_type: row.get(2)?,
                entity_id:   row.get(3)?,
                created_at:  row.get(4)?,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        events.extend(log_events);

        // Add orders as timeline events
        let mut stmt2 = self.conn.prepare(
            "SELECT o.id, o.status, s.name, o.order_number, o.created_at
             FROM orders o
             JOIN profiles p ON p.id = o.profile_id
             LEFT JOIN shops s ON s.id = o.shop_id
             WHERE p.card_id = ?1
             ORDER BY o.created_at ASC"
        ).map_err(|e| e.to_string())?;

        let order_events: Vec<CardTimelineEvent> = stmt2.query_map(params![card_id], |row| {
            let id: i64 = row.get(0)?;
            let status: String = row.get(1)?;
            let shop: Option<String> = row.get(2)?;
            let order_num: Option<String> = row.get(3)?;
            let created_at: String = row.get(4)?;
            let shop_str = shop.as_deref().unwrap_or("Unknown shop");
            let num_str = order_num.as_deref().map(|n| format!(" #{}", n)).unwrap_or_default();
            Ok(CardTimelineEvent {
                event_type: "order".to_string(),
                description: format!("Order{} at {} — {}", num_str, shop_str, status),
                entity_type: Some("order".to_string()),
                entity_id: Some(id.to_string()),
                created_at,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        events.extend(order_events);
        events.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        Ok(events)
    }

    pub fn get_profile_ltv(&self, profile_id: &str) -> Result<serde_json::Value, String> {
        let row = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CAST(amount AS REAL)),0), COALESCE(AVG(CAST(amount AS REAL)),0) FROM orders WHERE profile_id=?1",
            params![profile_id],
            |r| Ok((r.get::<_,i64>(0)?, r.get::<_,f64>(1)?, r.get::<_,f64>(2)?))
        ).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "orders": row.0, "total": row.1, "avg": row.2 }))
    }

    // E2: Auto-mark orders as Delivered when IMAP poll finds a delivery email
    pub fn auto_mark_delivered_by_account(&self, account_id: i64) -> Result<Vec<i64>, String> {
        // Find the email for this IMAP account
        let email: String = self.conn.query_row(
            "SELECT login FROM imap_accounts WHERE id=?1",
            params![account_id],
            |r| r.get(0)
        ).map_err(|e| e.to_string())?;
        // Find profiles that use email pool entries matching this email
        let mut stmt = self.conn.prepare(
            "SELECT o.id FROM orders o JOIN profiles p ON p.id=o.profile_id JOIN email_pool ep ON ep.id=p.email_id WHERE ep.email=?1 AND o.status='Shipped'"
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map(params![email], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for id in &ids {
            let _ = self.conn.execute(
                "UPDATE orders SET status='Delivered', updated_at=datetime('now') WHERE id=?1",
                params![id]
            );
        }
        Ok(ids)
    }

    // ─────────────────────────────────────────
    //  E3: Batch Order Creator
    // ─────────────────────────────────────────

    pub fn batch_create_orders(&self, orders: &[serde_json::Value]) -> Result<(usize, usize), String> {
        let mut ok = 0usize;
        let mut fail = 0usize;
        for o in orders {
            let profile_id = o["profile_id"].as_str().unwrap_or("");
            let shop_id = o["shop_id"].as_i64().unwrap_or(0);
            let item_name = o["item_name"].as_str().unwrap_or("");
            let item_sku = o["item_sku"].as_str().unwrap_or("");
            let amount = o["amount"].as_str().unwrap_or("0");
            if profile_id.is_empty() || shop_id == 0 {
                fail += 1;
                continue;
            }
            let amount_f: f64 = amount.parse().unwrap_or(0.0);
            let items_json = serde_json::json!([{"name": item_name, "sku": item_sku, "qty": 1, "price": amount_f}]).to_string();
            match self.conn.execute(
                "INSERT INTO orders (profile_id, shop_id, items_json, total_amount, status, created_at, updated_at) VALUES (?1,?2,?3,?4,'pending',datetime('now'),datetime('now'))",
                params![profile_id, shop_id, items_json, amount_f]
            ) {
                Ok(_) => ok += 1,
                Err(_) => fail += 1,
            }
        }
        Ok((ok, fail))
    }

    // ─────────────────────────────────────────
    //  G2: Proxy-Shop Binding
    // ─────────────────────────────────────────

    pub fn set_proxy_shop_binding(&self, proxy_id: i64, shop_id: i64) -> Result<(), String> {
        self.conn.execute(
            "INSERT OR REPLACE INTO proxy_shop_bindings (proxy_id, shop_id) VALUES (?1, ?2)",
            params![proxy_id, shop_id]
        ).map_err(|e: rusqlite::Error| e.to_string())?;
        Ok(())
    }

    pub fn remove_proxy_shop_binding(&self, shop_id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM proxy_shop_bindings WHERE shop_id=?1", params![shop_id])
            .map_err(|e: rusqlite::Error| e.to_string())?;
        Ok(())
    }

    pub fn get_proxy_for_shop(&self, shop_id: i64) -> Result<Option<i64>, String> {
        match self.conn.query_row(
            "SELECT proxy_id FROM proxy_shop_bindings WHERE shop_id=?1",
            params![shop_id],
            |r: &rusqlite::Row| r.get::<_,i64>(0)
        ) {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn get_all_proxy_shop_bindings(&self) -> Result<Vec<serde_json::Value>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT proxy_id, shop_id FROM proxy_shop_bindings"
        ).map_err(|e: rusqlite::Error| e.to_string())?;
        let rows = stmt.query_map([], |r: &rusqlite::Row| Ok(serde_json::json!({"proxy_id": r.get::<_,i64>(0)?, "shop_id": r.get::<_,i64>(1)?})))
            .map_err(|e: rusqlite::Error| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    // ─────────────────────────────────────────
    //  Quick Order: find/create shop by domain
    // ─────────────────────────────────────────

    pub fn find_shop_by_domain(&self, domain: &str) -> Result<Option<i64>, String> {
        let domain_clean = domain.trim_start_matches("www.").to_lowercase();
        match self.conn.query_row(
            "SELECT id FROM shops WHERE LOWER(TRIM(name)) LIKE ?1 OR LOWER(TRIM(domain)) LIKE ?1 LIMIT 1",
            params![format!("%{}%", domain_clean)],
            |r| r.get::<_, i64>(0)
        ) {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn create_shop_minimal(&self, domain: &str) -> Result<i64, String> {
        let name = domain.trim_start_matches("www.").to_string();
        self.conn.execute(
            "INSERT INTO shops (name, domain, url, created_at, updated_at) VALUES (?1, ?2, ?3, datetime('now'), datetime('now'))",
            params![name, domain, format!("https://{}", domain)]
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    // ── Auto-link order to shop ───────────

    /// Link an order to a shop if the order doesn't already have a shop_id.
    /// Returns Ok(()) regardless of whether the update happened (idempotent).
    pub fn link_order_to_shop_if_unlinked(&self, order_id: i64, shop_id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE orders SET shop_id=?1, updated_at=datetime('now') WHERE id=?2 AND shop_id IS NULL",
            params![shop_id, order_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Profile email assignment ───────────

    /// Set or clear the email_id FK on a profile row.
    pub fn set_profile_email(&self, profile_id: &str, email_pool_id: Option<i64>) -> Result<(), String> {
        self.conn.execute(
            "UPDATE profiles SET email_id=?1, updated_at=datetime('now') WHERE id=?2",
            params![email_pool_id, profile_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ── Email auto-assignment helpers ──────

    /// Find a free (unblocked, unused-by-any-profile) email from the pool.
    /// shop_id is currently unused but kept for future per-shop filtering.
    pub fn get_free_email_for_shop(&self, _shop_id: Option<i64>) -> Result<Option<serde_json::Value>, String> {
        // Collect email_pool ids already referenced by profiles via orders
        let used_ids: Vec<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT DISTINCT email_pool_id FROM orders WHERE email_pool_id IS NOT NULL"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<i64> = stmt.query_map([], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        let id: Option<i64> = if used_ids.is_empty() {
            self.conn.query_row(
                "SELECT id FROM email_pool WHERE is_blocked=0 ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            ).ok()
        } else {
            // Build NOT IN list
            let placeholders: String = used_ids.iter().enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT id FROM email_pool WHERE is_blocked=0 AND id NOT IN ({}) ORDER BY id ASC LIMIT 1",
                placeholders
            );
            let params_vec: Vec<Box<dyn rusqlite::ToSql>> = used_ids.iter()
                .map(|v| -> Box<dyn rusqlite::ToSql> { Box::new(*v) })
                .collect();
            let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
            self.conn.query_row(
                &sql,
                rusqlite::params_from_iter(params_refs.iter().copied()),
                |r| r.get(0),
            ).ok()
        };

        match id {
            None => Ok(None),
            Some(eid) => {
                let entry = self.build_email_entry(eid)?;
                Ok(Some(serde_json::json!({ "id": entry.id, "email": entry.email })))
            }
        }
    }

    /// Return up to `limit` email pool entries (id + email), not blocked, ordered by id.
    pub fn get_available_emails(&self, limit: u32) -> Result<Vec<serde_json::Value>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM email_pool WHERE is_blocked=0 ORDER BY id ASC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map(params![limit as i64], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut result = Vec::new();
        for eid in ids {
            if let Ok(entry) = self.build_email_entry(eid) {
                result.push(serde_json::json!({ "id": entry.id, "email": entry.email }));
            }
        }
        Ok(result)
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
    // FIX B53: используем chars() для Unicode-безопасного среза (кириллица, CJK и т.д.)
    let parts: Vec<&str> = name.split_whitespace().collect();
    parts.iter().enumerate().map(|(i, w)| {
        if i == 0 { w.to_string() }
        else {
            let first_char_len = w.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
            format!("{}.", &w[..first_char_len])
        }
    }).collect::<Vec<_>>().join(" ")
    }

    // ─────────────────────────────────────────
    //  init_db — migration runner
    // ─────────────────────────────────────────

    pub fn init_db(conn: &Connection) -> SqlResult<()> {
    // FIX B12: WAL mode — значительно быстрее для частой записи
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    // FIX B44: перечитываем version после каждой миграции чтобы не запускать лишние
    let mut version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 { migration_v1(conn)?; conn.execute_batch("PRAGMA user_version = 1")?; version = 1; }
    if version < 2 { migration_v2(conn)?; conn.execute_batch("PRAGMA user_version = 2")?; version = 2; }
    if version < 3 { migration_v3(conn)?; conn.execute_batch("PRAGMA user_version = 3")?; version = 3; }
    if version < 4 { migration_v4(conn)?; conn.execute_batch("PRAGMA user_version = 4")?; version = 4; }
    if version < 5 { migration_v5(conn)?; conn.execute_batch("PRAGMA user_version = 5")?; version = 5; }
        if version < 6 { migration_v6(conn)?; conn.execute_batch("PRAGMA user_version = 6")?; version = 6; }
        if version < 7 { migration_v7(conn)?; conn.execute_batch("PRAGMA user_version = 7")?; }
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

    fn migration_v4(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS profile_templates (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            country      TEXT,
            state        TEXT,
            city         TEXT,
            phone_prefix TEXT,
            source       TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    "#)?;
    Ok(())
    }

    fn migration_v5(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS bin_cache (
            bin       TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        );
    "#)?;
    Ok(())
    }

    fn migration_v3(conn: &Connection) -> SqlResult<()> {
    // Add new columns to imap_messages (ALTER TABLE is safe — SQLite ignores if column exists via IF NOT EXISTS workaround)
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN body TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN folder TEXT NOT NULL DEFAULT 'INBOX';");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN to_email TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN headers_json TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN message_id TEXT;");
    conn.execute_batch(r#"
        CREATE INDEX IF NOT EXISTS idx_imap_folder ON imap_messages(account_id, folder, is_read);

        CREATE TABLE IF NOT EXISTS smtp_configs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            label        TEXT NOT NULL,
            host         TEXT NOT NULL,
            port         INTEGER NOT NULL DEFAULT 587,
            login        TEXT NOT NULL,
            password     TEXT NOT NULL DEFAULT '',
            use_tls      INTEGER NOT NULL DEFAULT 0,
            use_starttls INTEGER NOT NULL DEFAULT 1,
            is_active    INTEGER NOT NULL DEFAULT 1,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sent_emails (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            smtp_config_id INTEGER REFERENCES smtp_configs(id) ON DELETE SET NULL,
            from_email     TEXT,
            to_email       TEXT NOT NULL,
            subject        TEXT,
            body_text      TEXT,
            status         TEXT NOT NULL DEFAULT 'sent',
            error_message  TEXT,
            sent_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sent_emails_config ON sent_emails(smtp_config_id);
    "#)?;
    Ok(())
    }

    fn migration_v6(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS catalog_items (
                id          INTEGER PRIMARY KEY,
                name        TEXT NOT NULL,
                asin        TEXT,
                price       REAL,
                pct         INTEGER DEFAULT 30,
                category    TEXT,
                notes_en    TEXT,
                stop        INTEGER DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_catalog_items_name ON catalog_items(name);
            CREATE INDEX IF NOT EXISTS idx_catalog_items_asin ON catalog_items(asin);

            CREATE TABLE IF NOT EXISTS catalog_shops (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                domain      TEXT UNIQUE NOT NULL,
                category    TEXT,
                score       INTEGER DEFAULT 0,
                ship_us     INTEGER DEFAULT 0,
                fraud_level TEXT,
                top_brands  TEXT,
                top_products TEXT,
                excluded    INTEGER DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_catalog_shops_domain ON catalog_shops(domain);
        ")
    }

    fn migration_v7(conn: &Connection) -> SqlResult<()> {
        // Add last_checked column to proxies table (ALTER TABLE is safe — SQLite ignores if column exists)
        let _ = conn.execute_batch("ALTER TABLE proxies ADD COLUMN last_checked DATETIME;");
        // G2: proxy-shop bindings table
        conn.execute_batch("CREATE TABLE IF NOT EXISTS proxy_shop_bindings (proxy_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, PRIMARY KEY(shop_id));")?;
        Ok(())
    }

