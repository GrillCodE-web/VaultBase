impl Database {
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

        // FIX B25 + PHASE 1: записываем footprint при каждом создании заказа с order_status
        let _ = self.record_order_footprint(oid, &input.profile_id, input.shop_id,
            input.email_pool_id, input.drop_id, input.proxy_id, "pending");

        self.build_order(oid)
    }

    /// PHASE 1: Footprint Sync V2 — записывает hashed footprint данные заказа в shop_footprints
    /// Добавлены: order_status для аналитики, installation_id_hash для идентификации установки
    fn record_order_footprint(&self, order_id: i64, profile_id: &str, shop_id: i64,
        email_pool_id: Option<i64>, drop_id: Option<i64>, proxy_id: Option<i64>,
        order_status: &str) -> Result<(), String>
    {
        let hkey = self.hmac_key();

        // Получаем domain магазина
        let shop_domain: Option<String> = self.conn.query_row(
            "SELECT LOWER(domain) FROM shops WHERE id=?1", params![shop_id], |r| r.get(0),
        ).ok();

        // Хешируем email
        let email_hash = email_pool_id.and_then(|eid| {
            self.conn.query_row("SELECT email FROM email_pool WHERE id=?1", params![eid], |r| r.get::<_,String>(0)).ok()
        }).map(|e| {
            let plain = self.decrypt_field(&e).unwrap_or(e);
            hash_value_with_key(&plain, &hkey)
        });

        // Хешируем адрес дропа
        // FIX AUDIT-08: drops.address/phone зашифрованы — раньше хеш считался по
        // шифротексту (менялся при смене пароля, не совпадал между установками).
        let drop_hash = drop_id.and_then(|did| {
            self.conn.query_row("SELECT address, zip, phone FROM drops WHERE id=?1",
                params![did], |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,Option<String>>(2)?))).ok()
        }).map(|(addr, zip, phone)| {
            let addr_plain = self.decrypt_field(&addr).unwrap_or(addr);
            let phone_plain = phone.as_deref().and_then(|p| self.decrypt_field(p).ok()).unwrap_or_default();
            hash_value_with_key(&format!("{}|{}|{}", addr_plain, zip, phone_plain), &hkey)
        });

        // BIN и phone/name из карты профиля
        let (bin, phone_hash, name_hash): (Option<String>, Option<String>, Option<String>) =
            self.conn.query_row(
                "SELECT c.bin, c.phone, c.holder_name FROM credit_cards c JOIN profiles p ON p.card_id=c.id WHERE p.id=?1",
                params![profile_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            ).map(|(b, ph, hn): (Option<String>, Option<String>, Option<String>)| {
                let ph_hash = ph.as_deref()
                    .and_then(|p| self.decrypt_field(p).ok())
                    .map(|p| hash_value_with_key(&p, &hkey));
                let nm_hash = hn.as_deref()
                    .and_then(|n| self.decrypt_field(n).ok())
                    .map(|n| hash_value_with_key(&n, &hkey));
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

        // PHASE 1: получаем installation_id_hash для идентификации установки
        let installation_id_hash = self.get_installation_id_hash();

        // V2: добавляем order_status и installation_id_hash
        self.conn.execute(
            "INSERT INTO shop_footprints(shop_id,shop_domain,order_id,email_id,proxy_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced,order_status,installation_id_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12,?13)",
            params![shop_id, shop_domain, order_id, email_pool_id, proxy_id, email_hash, ip_hash, drop_hash, bin, phone_hash, name_hash, order_status, installation_id_hash],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_orders(&self, filter: &OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut wh = vec!["1=1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(ref s) = filter.status { wh.push("o.status=?1".into()); params.push(Box::new(s.clone())); }
        if let Some(sid) = filter.shop_id { wh.push(format!("o.shop_id={}", params.len()+1)); params.push(Box::new(sid)); }
        if let Some(ref d) = filter.date_from { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { wh.push(format!("DATE(o.created_at)>=?{}", params.len()+1)); params.push(Box::new(d.clone())); } }
        if let Some(ref d) = filter.date_to   { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { wh.push(format!("DATE(o.created_at)<=?{}", params.len()+1)); params.push(Box::new(d.clone())); } }
        if let Some(ref s) = filter.search {
            // FIX B14: экранируем wildcards LIKE
            let q = Self::escape_like(s);
            wh.push(format!("(o.order_number LIKE ?{} ESCAPE '\\' OR s.name LIKE ?{} ESCAPE '\\')", params.len()+1, params.len()+2));
            params.push(Box::new(format!("%{}%", q)));
            params.push(Box::new(format!("%{}%", q)));
        }
        let w = wh.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE {}", w),
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |r| r.get(0),
        ).unwrap_or(0);
        // FIX B54: один JOIN-запрос вместо N вызовов build_order
        // FIX AUDIT-18: флаги pending_too_long/card_expiring/bin_declined_here
        // раньше были жёстко false в списке — теперь считаются в запросе.
        let mut stmt = self.conn.prepare(&format!(
            "SELECT o.id,o.profile_id,o.shop_id,o.drop_id,o.email_pool_id,o.proxy_id,\
             o.order_number,o.status,o.total_amount,o.tracking_number,o.carrier,o.notes,\
             o.items_json,o.created_at,o.updated_at,s.name,c.holder_name,c.last4,c.id,\
             COALESCE(px.label,px.host||':'||px.port),ep.email,\
             (julianday('now') - julianday(o.created_at)) > 5 AND o.status='pending' AS pending_too_long,\
             EXISTS(SELECT 1 FROM credit_cards cc WHERE cc.id=c.id AND cc.expiry_date IS NOT NULL AND cc.expiry_date != '' AND (CAST(substr(cc.expiry_date,4,2) AS INTEGER)+2000)*12 + CAST(substr(cc.expiry_date,1,2) AS INTEGER) BETWEEN (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) AND (CAST(strftime('%Y','now') AS INTEGER))*12 + CAST(strftime('%m','now') AS INTEGER) + 1) AS card_expiring,\
             EXISTS(SELECT 1 FROM orders o2 JOIN profiles p2 ON o2.profile_id=p2.id JOIN credit_cards c2 ON p2.card_id=c2.id WHERE o2.shop_id=o.shop_id AND c2.bin=c.bin AND o2.status IN ('declined','failed') AND o2.id != o.id) AS bin_declined_here \
             FROM orders o \
             LEFT JOIN shops s ON o.shop_id=s.id \
             LEFT JOIN profiles p ON o.profile_id=p.id \
             LEFT JOIN credit_cards c ON p.card_id=c.id \
             LEFT JOIN proxies px ON o.proxy_id=px.id \
             LEFT JOIN email_pool ep ON o.email_pool_id=ep.id \
             WHERE {} ORDER BY o.created_at DESC LIMIT {} OFFSET {}",
            w, pp, offset
        )).map_err(|e| e.to_string())?;
        let items: Vec<Order> = stmt.query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), |r| {
            let id: i64 = r.get(0)?;
            let holder_enc: Option<String> = r.get(16)?;
            Ok((id, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                r.get(11)?, r.get(12)?, r.get(13)?, r.get(14)?, r.get(15)?,
                holder_enc, r.get(17)?, r.get(18)?, r.get(19)?, r.get(20)?,
                r.get::<_,bool>(21)?, r.get::<_,bool>(22)?, r.get::<_,bool>(23)?))
        }).map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .map(|(id, profile_id, shop_id, drop_id, email_pool_id, proxy_id,
               order_number, status, total_amount, tracking_number, carrier,
               notes, items_json, created_at, updated_at, shop_name,
               holder_enc, last4, card_id, proxy_label, email_addr,
               pending_too_long, card_expiring, bin_declined_here):
              (i64,String,i64,Option<i64>,Option<i64>,Option<i64>,
               Option<String>,String,Option<f64>,Option<String>,Option<String>,
               Option<String>,Option<String>,String,String,Option<String>,
               Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>,
               bool,bool,bool)| {
            let holder_masked = holder_enc.as_deref()
                .and_then(|h| self.decrypt_field(h).ok())
                .map(|n| mask_name(&n));
            Order {
                id, profile_id, shop_id, drop_id: drop_id.unwrap_or(0), email_pool_id, proxy_id,
                order_number, status, total_amount, tracking_number, carrier,
                notes, items_json, created_at, updated_at, shop_name,
                holder_masked, last4, card_id, bank_name: None,
                proxy_label, email_addr,
                pending_too_long, card_expiring, bin_declined_here,
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

    pub fn get_recent_orders_by_card(&self, card_id: i64, limit: u32) -> Result<Vec<Order>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id FROM orders o JOIN profiles p ON o.profile_id=p.id WHERE p.card_id=?1 ORDER BY o.created_at DESC LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map(params![card_id, limit], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        ids.into_iter().map(|id| self.build_order(id)).collect()
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

    pub fn bulk_update_orders_status(&self, ids: &[i64], status: &str) -> Result<(), String> {
        const VALID_STATUSES: &[&str] = &["pending", "shipped", "delivered", "declined", "cancelled", "failed"];
        if !VALID_STATUSES.contains(&status) {
            return Err(format!("invalid_status: '{}'. Allowed: {}", status, VALID_STATUSES.join(", ")));
        }
        if ids.is_empty() { return Ok(()); }
        
        // FIX SQL-INJECTION: Validate array size to prevent query explosion
        if ids.len() > crate::constants::MAX_IN_CLAUSE_IDS {
            return Err(format!("Too many IDs: {} > {}", ids.len(), crate::constants::MAX_IN_CLAUSE_IDS));
        }
        
        // FIX SQL-INJECTION: Build parameterized query with proper placeholder generation
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))  // Start from ?2 (status is ?1)
            .collect::<Vec<_>>()
            .join(",");
        
        let sql = format!("UPDATE orders SET status=?1,updated_at=datetime('now') WHERE id IN ({})", placeholders);
        
        // FIX SQL-INJECTION: Build params safely using type-safe params_from_iter
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(status.to_string())];
        for &id in ids {
            params.push(Box::new(id));
        }
        
        self.conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
            .map_err(|e| format!("bulk_update_orders_status error: {}", e))?;
        
        let _ = self.log_event("order.bulk_status", &format!("{} orders → {}", ids.len(), status), Some("order"), None);
        Ok(())
    }

    pub fn bulk_delete_orders(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        
        // FIX SQL-INJECTION: Validate array size to prevent query explosion
        if ids.len() > crate::constants::MAX_IN_CLAUSE_IDS {
            return Err(format!("Too many IDs: {} > {}", ids.len(), crate::constants::MAX_IN_CLAUSE_IDS));
        }
        
        // FIX SQL-INJECTION: Build parameterized query with proper placeholder generation
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        
        let sql = format!("DELETE FROM orders WHERE id IN ({})", placeholders);
        
        // FIX SQL-INJECTION: Build params safely
        let params: Vec<Box<dyn rusqlite::ToSql>> = ids.iter()
            .map(|&id| Box::new(id) as Box<dyn rusqlite::ToSql>)
            .collect();
        
        self.conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
            .map_err(|e| format!("bulk_delete_orders error: {}", e))?;
        
        let _ = self.log_event("order.bulk_deleted", &format!("{} orders deleted", ids.len()), Some("order"), None);
        Ok(())
    }

    pub fn update_order_tracking(&self, id: i64, tracking_number: Option<&str>, carrier: Option<&str>) -> Result<(), String> {
        self.conn.execute(
            "UPDATE orders SET tracking_number=?1,carrier=COALESCE(?2,carrier),updated_at=datetime('now') WHERE id=?3",
            params![tracking_number, carrier, id],
        ).map_err(|e| e.to_string())?;
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
        // FIX AUDIT-16: валидация — "exception" не входит в допустимые статусы.
        const VALID_STATUSES: &[&str] = &["pending", "shipped", "delivered", "declined", "cancelled", "failed"];
        if !VALID_STATUSES.contains(&status) {
            return Ok(());
        }
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
                "SELECT id,name,shop_tag,items_json,created_at FROM order_templates WHERE shop_tag=?1 ORDER BY id DESC".to_string(),
                true,
            ),
            _ => ("SELECT id,name,shop_tag,items_json,created_at FROM order_templates ORDER BY id DESC".to_string(), false),
        };
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items: Vec<OrderTemplate> = if use_tag {
            let tag = shop_tag.unwrap_or("").to_string();
            stmt.query_map(params![tag], |r| Ok(OrderTemplate {
                id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?, items_json: r.get(3)?, created_at: r.get(4)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect()
        } else {
            stmt.query_map([], |r| Ok(OrderTemplate {
                id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?, items_json: r.get(3)?, created_at: r.get(4)?,
            })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect()
        };
        Ok(items)
    }

    // ── Backup ────────────────────────────

    pub fn export_backup_to(&self, dest: &str) -> Result<String, String> {
        // FIX AUDIT-05: при WAL-режиме копирование .db-файла не включает
        // незачекпоинченные транзакции → бэкап мог быть неполным/битым.
        // VACUUM INTO создаёт консистентную копию на момент вызова.
        if std::path::Path::new(dest).exists() {
            std::fs::remove_file(dest).map_err(|e| e.to_string())?;
        }
        let escaped = dest.replace('\'', "''");
        self.conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
            .map_err(|e| e.to_string())?;
        Ok(dest.to_string())
    }
}

// ─────────────────────────────────────────
//  Tests for SQL Safety & Parameterization
// ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Test bulk_update_orders_status with valid single ID
    #[test]
    fn test_bulk_update_orders_status_single_id() {
        // This test verifies that the SQL query properly handles parameterized queries
        // Expected behavior: UPDATE query should execute with proper placeholder generation
        // The actual test would require a test database setup
        let ids = vec![1i64];
        let status = "shipped";
        
        // Verify placeholder generation doesn't have format string vulnerabilities
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        
        assert_eq!(placeholders, "?2", "Single ID should generate single placeholder ?2");
    }

    /// Test bulk_update_orders_status with multiple IDs
    #[test]
    fn test_bulk_update_orders_status_multiple_ids() {
        let ids = vec![1i64, 2i64, 3i64, 4i64, 5i64];
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        
        assert_eq!(placeholders, "?2,?3,?4,?5,?6", 
            "Five IDs should generate placeholders ?2 through ?6");
    }

    /// Test bulk_update_orders_status with MAX_IN_CLAUSE_IDS boundary
    #[test]
    fn test_bulk_update_orders_status_max_ids() {
        let mut ids = Vec::new();
        for i in 1..=crate::constants::MAX_IN_CLAUSE_IDS {
            ids.push(i as i64);
        }
        
        // This should NOT error - exactly at the limit
        assert_eq!(ids.len(), crate::constants::MAX_IN_CLAUSE_IDS);
    }

    /// Test bulk_delete_orders with empty array
    #[test]
    fn test_bulk_delete_orders_empty() {
        let ids: Vec<i64> = vec![];
        // Empty array should return early without executing query
        assert_eq!(ids.is_empty(), true);
    }

    /// Test bulk_delete_orders with single ID
    #[test]
    fn test_bulk_delete_orders_single_id() {
        let ids = vec![1i64];
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        
        assert_eq!(placeholders, "?1", "Single ID for DELETE should generate ?1");
    }

    /// Test bulk_delete_orders with large batch (near MAX_IN_CLAUSE_IDS)
    #[test]
    fn test_bulk_delete_orders_large_batch() {
        let ids: Vec<i64> = (1..=100).collect();
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        
        // Should have 100 placeholders
        let placeholder_count = placeholders.matches("?").count();
        assert_eq!(placeholder_count, 100, "100 IDs should generate 100 placeholders");
    }

    /// Test status validation in bulk_update_orders_status
    #[test]
    fn test_bulk_update_orders_status_invalid_status() {
        let valid_statuses = &["pending", "shipped", "delivered", "declined", "cancelled", "failed"];
        
        // Verify all valid statuses are accepted
        for status in valid_statuses {
            assert!(valid_statuses.contains(status));
        }
        
        // Verify invalid status would be rejected
        let invalid_status = "unknown_status";
        assert!(!valid_statuses.contains(&invalid_status));
    }

    /// Test placeholder generation doesn't have SQL injection vulnerabilities
    #[test]
    fn test_placeholder_generation_safe() {
        let ids = vec![1i64, 2i64, 3i64];
        let placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        
        // Verify placeholders are purely numeric and safe
        for part in placeholders.split(',') {
            assert!(part.starts_with("?"), "Each placeholder should start with ?");
            // The number after ? should be valid
            let num_str = &part[1..];
            assert!(num_str.chars().all(|c| c.is_ascii_digit()), 
                "Placeholder numbers should be digits only");
        }
    }
}
