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

        // FIX DB-H01: Single query with JOIN instead of N+1 queries
        // Fetch all profile data in one query with aggregated drop/order counts
        let sql = format!(
            r#"SELECT p.id, p.card_id, p.notes, p.created_at, p.updated_at,
                      c.bin, c.last4, c.bank_name, c.card_type, c.country, c.status, c.holder_name,
                      COALESCE((SELECT COUNT(*) FROM drops WHERE profile_id=p.id), 0) AS dc,
                      COALESCE((SELECT COUNT(*) FROM orders WHERE profile_id=p.id), 0) AS oc
               FROM profiles p
               LEFT JOIN credit_cards c ON p.card_id=c.id
               WHERE {}
               ORDER BY p.created_at DESC
               LIMIT {} OFFSET {}"#,
            wh, pp, offset
        );

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items: Vec<Profile> = stmt.query_map([], |r| {
            let holder_enc: Option<String> = r.get(11)?;
            Ok((
                r.get::<_,String>(0)?, r.get::<_,i64>(1)?, r.get::<_,Option<String>>(2)?,
                r.get::<_,String>(3)?, r.get::<_,String>(4)?,
                r.get::<_,Option<String>>(5)?, r.get::<_,Option<String>>(6)?,
                r.get::<_,Option<String>>(7)?, r.get::<_,Option<String>>(8)?,
                r.get::<_,Option<String>>(9)?, r.get::<_,Option<String>>(10)?,
                holder_enc, r.get::<_,i64>(12)?, r.get::<_,i64>(13)?,
            ))
        }).map_err(|e| e.to_string())?
            .filter_map(|row| row.ok())
            .map(|(pid, card_id, notes, ca, ua, bin, last4, bank, ctype, country, cstatus, holder_enc, dc, oc)| {
                let holder_masked = holder_enc.as_deref()
                    .and_then(|h| self.decrypt_field(h).ok())
                    .map(|n| mask_name(&n));
                Profile {
                    id: pid, card_id, notes, created_at: ca, updated_at: ua,
                    bin, last4, bank_name: bank, card_type: ctype, country, card_status: cstatus,
                    holder_masked, drop_count: dc, order_count: oc,
                }
            })
            .collect();

        let total_pages = (total as u32 + per_page - 1) / per_page.max(1);
        Ok(PaginatedProfiles { items, total: total as u32, page, per_page, total_pages })
    }

    pub fn get_profile_detail(&self, id: &str) -> Result<ProfileDetail, String> {
        if self.is_locked() { return Err("database_locked".into()); }

        // FIX DB-H02: Single query with JOINs instead of 3 separate queries
        // Fetch profile, card, drops count, and orders count in one query
        let sql = r#"
            SELECT p.id, p.card_id, p.notes, p.created_at, p.updated_at,
                   c.bin, c.last4, c.bank_name, c.card_type, c.country, c.status, c.holder_name,
                   COALESCE((SELECT COUNT(*) FROM drops WHERE profile_id=p.id), 0) AS drop_count,
                   COALESCE((SELECT COUNT(*) FROM orders WHERE profile_id=p.id), 0) AS order_count
            FROM profiles p
            LEFT JOIN credit_cards c ON p.card_id = c.id
            WHERE p.id = ?1
        "#;

        let (profile, card) = self.conn.query_row(sql, params![id], |row| {
            let pid: String = row.get(0)?;
            let card_id: i64 = row.get(1)?;
            let notes: Option<String> = row.get(2)?;
            let created_at: String = row.get(3)?;
            let updated_at: String = row.get(4)?;
            let bin: Option<String> = row.get(5)?;
            let last4: Option<String> = row.get(6)?;
            let bank_name: Option<String> = row.get(7)?;
            let card_type: Option<String> = row.get(8)?;
            let country: Option<String> = row.get(9)?;
            let cstatus: Option<String> = row.get(10)?;
            let holder_enc: Option<String> = row.get(11)?;
            let drop_count: i64 = row.get(12)?;
            let order_count: i64 = row.get(13)?;

            // Decrypt holder name if present
            let holder_masked = holder_enc.as_ref()
                .and_then(|h| self.decrypt_field(h).ok())
                .map(|n| mask_name(&n));

            let profile = Profile {
                id: pid,
                card_id,
                notes,
                created_at,
                updated_at,
                bin: bin.clone(),
                last4: last4.clone(),
                bank_name: bank_name.clone(),
                card_type: card_type.clone(),
                country: country.clone(),
                card_status: cstatus.clone(),
                holder_masked,
                drop_count,
                order_count,
            };

            // Build CardDecrypted from joined data
            let card = if card_id > 0 && bin.is_some() {
                CardDecrypted {
                    id: card_id,
                    card_number: String::new(),  // Not fetched in this query
                    expiry_date: String::new(),
                    cvv: String::new(),
                    holder_name: String::new(),
                    billing_address: None, city: None, state: None, zip: None,
                    country, phone: None, email: None, ip_address: None,
                    bin, last4, bank_name, card_type,
                    card_level: None, status: cstatus.unwrap_or_default(),
                    source: String::new(), notes: None, created_at: String::new(),
                }
            } else {
                CardDecrypted {
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
                }
            };

            Ok((profile, card))
        }).map_err(|e| e.to_string())?;

        // Fetch full drops list (required for detail view)
        let drops = self.get_drops_for_profile(id)?;

        // Fetch orders summary (required for detail view)
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
}
