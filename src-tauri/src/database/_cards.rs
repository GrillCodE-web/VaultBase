impl Database {
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
                  bin, last4, source, card_hash, domain, acquired_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
                params![
                    enc_number, card.expiry_date, enc_cvv, enc_holder, enc_address,
                    card.city, card.state, card.zip, card.country,
                    enc_phone, enc_email, enc_ip,
                    bin, last4, card.source, card_hash,
                    card.domain, card.acquired_at
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

        // Check if domain and acquired_at columns exist (migration v9)
        let has_domain_column = self.conn.prepare("SELECT domain FROM credit_cards LIMIT 0").is_ok();
        let has_acquired_at_column = self.conn.prepare("SELECT acquired_at FROM credit_cards LIMIT 0").is_ok();

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
        // P2-DOMAIN: Filter by domain
        if let Some(ref domain) = filter.domain {
            if !domain.is_empty() {
                conditions.push(format!("domain = ?{}", params_list.len()+1));
                params_list.push(Box::new(domain.clone()));
            }
        }
        // P2-QUARANTINE: Filter by quarantine status (cards < 14 days old are quarantined)
        if let Some(ref q_status) = filter.quarantine_status {
            if q_status == "available" {
                // Cards older than 14 days OR without acquired_at (always available)
                conditions.push("(acquired_at IS NULL OR julianday('now') - julianday(acquired_at) >= 14)".to_string());
            } else if q_status == "quarantined" {
                // Cards less than 14 days old
                conditions.push("(acquired_at IS NOT NULL AND julianday('now') - julianday(acquired_at) < 14)".to_string());
            }
        }
        // ROLES: restrict to cards assigned to a specific user
        if let Some(uid) = filter.owner_user_id {
            let ca_exists = self.conn.prepare("SELECT 1 FROM card_assignments LIMIT 0").is_ok();
            if ca_exists {
                conditions.push(format!(
                    "c.id IN (SELECT card_id FROM card_assignments WHERE user_id = ?{})",
                    params_list.len() + 1
                ));
                params_list.push(Box::new(uid));
            }
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

        // FIX AUDIT-04: алиас c обязателен — фильтр owner_user_id использует c.id.
        let count_sql = format!("SELECT COUNT(*) FROM credit_cards c {}", where_clause);

        // FIX: Only select domain/acquired_at if columns exist (migration v9)
        // FIX AUDIT-03: добавлен c.ip_address — раньше парсер читал на его месте
        // c.acquired_at, из-за чего IP карты в списке никогда не показывался.
        let select_columns = if has_domain_column && has_acquired_at_column {
            "c.id, c.bin, c.last4, c.expiry_date, c.holder_name, c.bank_name,
             c.card_type, c.card_level, c.status, c.source, c.notes,
             c.city, c.state, c.zip, c.country, c.created_at, c.domain, c.ip_address, c.acquired_at,
             (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id WHERE p.card_id=c.id) as orders_count"
        } else if has_domain_column {
            "c.id, c.bin, c.last4, c.expiry_date, c.holder_name, c.bank_name,
             c.card_type, c.card_level, c.status, c.source, c.notes,
             c.city, c.state, c.zip, c.country, c.created_at, c.domain, c.ip_address,
             (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id WHERE p.card_id=c.id) as orders_count"
        } else {
            "c.id, c.bin, c.last4, c.expiry_date, c.holder_name, c.bank_name,
             c.card_type, c.card_level, c.status, c.source, c.notes,
             c.city, c.state, c.zip, c.country, c.created_at, c.ip_address,
             (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id WHERE p.card_id=c.id) as orders_count"
        };

        let num_columns = if has_domain_column && has_acquired_at_column {
            20
        } else if has_domain_column {
            19
        } else {
            18
        };

        let data_sql = format!(
            "SELECT {} FROM credit_cards c {} ORDER BY c.created_at DESC LIMIT ?{} OFFSET ?{}",
            select_columns,
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
            // FIX: Parse row based on available columns (migration v9 compatibility)
            // FIX AUDIT-03: ip_address теперь на своём месте (после domain, до acquired_at).
            let domain: Option<String> = if num_columns >= 19 { row.get(16)? } else { None };
            let ip_address: Option<String> = if num_columns >= 19 { row.get(17)? } else { row.get(16)? };
            let orders_col = num_columns - 1;
            let orders_count: u32 = row.get::<_, i64>(orders_col).unwrap_or(0) as u32;

            Ok(Card {
                id:         row.get(0)?,
                bin:        row.get(1)?,
                last4:      row.get(2)?,
                expiry_date: row.get(3)?,
                holder_name: row.get(4)?,
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
                domain,
                ip_address,
                orders_count,
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

        let pages = total.div_ceil(per_page);
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

        // P2-DOMAIN: Get unique domains for filter dropdown (safe — returns empty if column doesn't exist)
        let domains: Vec<String> = match self.conn.prepare(
            "SELECT DISTINCT domain FROM credit_cards WHERE domain IS NOT NULL AND domain != '' ORDER BY domain LIMIT 80"
        ) {
            Ok(mut stmt) => {
                match stmt.query_map([], |r| r.get(0)) {
                    Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                    Err(_) => Vec::new(),
                }
            }
            Err(_) => Vec::new(),
        };

        Ok(crate::models::CardFilterMeta { countries, banks, sources, domains })
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
        self.enrich_card_bin_opts(card_id, api_key, false)
    }

    /// DB-007: force=true — пропустить локальный кеш (ручной refresh из UI)
    pub fn enrich_card_bin_opts(&self, card_id: i64, api_key: &str, force: bool) -> Result<BinInfo, String> {
        if api_key.is_empty() { return Err("no_api_key".into()); }

        let bin: Option<String> = self.conn.query_row(
            "SELECT bin FROM credit_cards WHERE id=?1",
            params![card_id],
            |r| r.get(0),
        ).map_err(|_| "card_not_found".to_string())?;

        let bin = bin.ok_or("no_bin")?;

        // 1. Check local bin_cache (30-day TTL), unless forced refresh
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let cutoff = now - (30 * 24 * 3600i64);
        if !force {
            if let Ok(row) = self.conn.query_row(
                "SELECT data_json FROM bin_cache WHERE bin = ?1 AND cached_at > ?2",
                rusqlite::params![&bin, cutoff],
                |r| r.get::<_, String>(0),
            ) {
                if let Ok(cached) = serde_json::from_str::<BinInfo>(&row) {
                    return Ok(cached);
                }
            }
        }

        // 2. Check server-side BIN cache (populated by other users)
        let server_cached = ureq::get(&crate::endpoints::endpoint(&format!("/api/bin/{}", bin)))
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
                    let _ = ureq::post(&crate::endpoints::endpoint("/api/bin"))
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
            // FIX CRIT-02: Никогда не экспортируем CVV — только последние 4 цифры карты
            output.push_str("card_number,expiry_date,holder_name,email,phone,billing_address,city,state,country,zip\n");
        }

        for &id in ids {
            let c = self.get_card_decrypted(id)?;
            // FIX CRIT-02: Маскируем номер карты — показываем только последние 4 цифры
            let masked_card = if c.card_number.len() > 4 {
                format!("****{}", &c.card_number[c.card_number.len()-4..])
            } else {
                "****".to_string()
            };
            // FIX CRIT-02: CVV не экспортируется вообще
            let row = format!(
                "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
                masked_card,
                c.expiry_date,
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
        // FIX AUDIT-01: устойчивость к legacy plaintext. Некоторые поля (например,
        // email_pool.email, созданный из IMAP-логина) могли быть записаны открытым
        // текстом. Если расшифровка старым ключом не удаётся — считаем значение
        // plaintext и просто шифруем новым ключом, вместо того чтобы ронять всю
        // транзакцию смены мастер-пароля.
        let reenc = |val: Option<&str>| -> Result<Option<String>, String> {
            match val {
                Some(v) if !v.is_empty() => {
                    match old_enc.decrypt(v) {
                        Ok(plain) => Ok(Some(new_enc.encrypt(&plain)?)),
                        Err(_) => Ok(Some(new_enc.encrypt(v)?)),
                    }
                }
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

        // FIX AUDIT-02: smtp_configs.password — раньше не перешифровывался, из-за
        // чего после смены мастер-пароля get_smtp_config_password считал старый
        // шифротекст «legacy plaintext» и перешифровывал его повторно (двойное
        // шифрование → пароль навсегда сломан).
        let sm_rows: Vec<(i64, Option<String>)> = {
            let mut s = self.conn.prepare("SELECT id, password FROM smtp_configs").map_err(|e| e.to_string())?;
            let c: Vec<_> = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?
             .filter_map(|r| r.ok()).collect();
            c
        };
        for (id, pw) in sm_rows {
            self.conn.execute("UPDATE smtp_configs SET password=?1 WHERE id=?2",
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

        // FIX AUDIT-23: license_token — если лицензия активирована до установки
        // мастер-пароля, токен лежит plaintext. reenc устойчив к этому: decrypt
        // не удастся → зашифруем новым ключом. Если уже зашифрован — перешифруем.
        if let Some(raw) = self.get_config("license_token").map_err(|e| e.to_string())? {
            if !raw.is_empty() {
                let new_val = reenc(Some(&raw))?.unwrap_or(raw);
                self.set_config("license_token", &new_val).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    /// FEAT-006: живые карты (free/in_use; словарь статусов — миграция v14),
    /// у которых срок действия истекает в ближайшие `days` дней или уже истёк.
    /// expiry_date в формате MM/YY — plaintext, сравнение на стороне SQLite
    /// (паттерн FIX B15). Возвращает (id, bin, last4, expiry_date, days_left).
    pub fn cards_expiring_within(&self, days: i64) -> Result<Vec<(i64, String, String, String, i64)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, COALESCE(bin,''), COALESCE(last4,''), expiry_date, \
                    CAST(julianday(date('20'||substr(expiry_date,4,2)||'-'||substr(expiry_date,1,2)||'-01','+1 month','-1 day')) \
                         - julianday(date('now')) AS INTEGER) \
             FROM credit_cards \
             WHERE status IN ('free','in_use') AND expiry_date IS NOT NULL AND expiry_date != '' \
               AND date('20'||substr(expiry_date,4,2)||'-'||substr(expiry_date,1,2)||'-01','+1 month','-1 day') \
                   <= date('now', ?1) \
             ORDER BY date('20'||substr(expiry_date,4,2)||'-'||substr(expiry_date,1,2)||'-01')"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![format!("+{} days", days)], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

// ─────────────────────────────────────────
//  Tests (TEST-013: DB benchmark)
// ─────────────────────────────────────────

#[cfg(test)]
mod perf_tests {
    use crate::models::CardInput;

    fn test_db() -> (tempfile::TempDir, super::super::Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bench.db");
        let mut db = super::super::Database::open(path.to_str().unwrap()).unwrap();
        // insert_cards шифрует поля — нужна разблокированная БД
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("bench_pw_1234567890", &salt));
        (dir, db)
    }

    fn make_card(i: usize) -> CardInput {
        CardInput {
            card_number: format!("411111{:010}", i % 9_999_999_999),
            expiry_date: Some("12/29".into()),
            cvv: Some("123".into()),
            holder_name: Some(format!("Holder {}", i)),
            billing_address: None,
            city: None,
            state: None,
            zip: None,
            country: Some("US".into()),
            phone: None,
            email: None,
            ip_address: None,
            source: "bench".into(),
            domain: None,
            acquired_at: None,
        }
    }

    // FEAT-006: выборка карт с истекающим сроком
    #[test]
    fn test_cards_expiring_within() {
        let (_dir, db) = test_db();
        let now = chrono::Utc::now();
        // MM/YY текущего месяца — истекает через ≤31 день
        let this_month = now.format("%m/%y").to_string();

        let mut c_expiring = make_card(1);
        c_expiring.expiry_date = Some(this_month.clone());
        let mut c_far = make_card(2);
        c_far.expiry_date = Some("12/35".into());
        let mut c_expired = make_card(3);
        c_expired.expiry_date = Some("01/20".into());
        let mut c_noexp = make_card(4);
        c_noexp.expiry_date = None;
        let mut c_arch = make_card(5);
        c_arch.expiry_date = Some(this_month.clone());
        db.insert_cards(vec![c_expiring, c_far, c_expired, c_noexp, c_arch]).unwrap();
        // пятую карту — в архив (словарь статусов: free/in_use/archive/dead)
        db.conn.execute(
            "UPDATE credit_cards SET status='archive' WHERE expiry_date=?1 AND id=(SELECT MAX(id) FROM credit_cards)",
            rusqlite::params![this_month],
        ).unwrap();

        let got = db.cards_expiring_within(14).unwrap();
        assert_eq!(got.len(), 2, "только истекающая и просроченная, без архива и без expiry");
        // первая — самая старая (01/20), days_left отрицательный
        assert_eq!(got[0].3, "01/20");
        assert!(got[0].4 < 0);
        assert_eq!(got[1].3, this_month);
        assert!((0..=31).contains(&got[1].4));

        // узкое окно в 1 день может отсеять текущий месяц, но просроченная — всегда
        let narrow = db.cards_expiring_within(0).unwrap();
        assert!(narrow.iter().any(|c| c.3 == "01/20"));
        assert!(!narrow.iter().any(|c| c.3 == "12/35"));
    }

    // TEST-013: вставка 10k карт — замер времени (не ассерт, а регрессионный ориентир).
    // 100k на CI слишком долго для unit-теста; 10k ловит порядковые деградации
    // (например, потерю транзакции: 10k вне транзакции ≈ ×50 медленнее).
    #[test]
    fn bench_insert_10k_cards_under_transaction() {
        let (_dir, db) = test_db();
        let cards: Vec<CardInput> = (0..10_000).map(make_card).collect();

        let t0 = std::time::Instant::now();
        let inserted = db.insert_cards(cards).unwrap();
        let elapsed = t0.elapsed();

        assert_eq!(inserted, 10_000);
        // В транзакции: ~1-3 сек на шифрованной БД. Без транзакции: минуты.
        // Порог 60 сек — защита от случайной потери BEGIN/COMMIT.
        assert!(
            elapsed.as_secs() < 60,
            "insert 10k cards took {:?} — транзакция потеряна?",
            elapsed
        );
        println!("bench: insert 10k cards in {:?} ({:.0} cards/sec)",
            elapsed, 10_000.0 / elapsed.as_secs_f64());
    }

    // TEST-013: выборка с фильтром по статусу на 10k карт — индекс должен
    // держать запрос субсекундным
    #[test]
    fn bench_filter_query_10k_cards() {
        let (_dir, db) = test_db();
        let cards: Vec<CardInput> = (0..10_000).map(make_card).collect();
        db.insert_cards(cards).unwrap();

        let filter = crate::models::CardFilter {
            status: Some("free".into()),
            ..Default::default()
        };
        let t0 = std::time::Instant::now();
        let page = db.get_cards(&filter, 1, 50).unwrap();
        let elapsed = t0.elapsed();

        assert_eq!(page.total, 10_000);
        assert_eq!(page.items.len(), 50);
        assert!(
            elapsed.as_millis() < 2000,
            "filter query on 10k cards took {:?} — пропал индекс?",
            elapsed
        );
        println!("bench: filter 10k cards in {:?}", elapsed);
    }
}
