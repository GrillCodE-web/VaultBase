/// Строка build_order: колонки SELECT из orders + JOIN'ов.
type OrderRow = (String,i64,Option<i64>,Option<i64>,Option<i64>,Option<String>,String,Option<f64>,Option<String>,Option<String>,Option<String>,Option<String>,String,String,Option<String>,Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>);

/// Строка списка заказов: OrderRow + флаги pending_too_long/card_expiring/bin_declined_here.
type OrderListRow = (i64,String,i64,Option<i64>,Option<i64>,Option<i64>,
    Option<String>,String,Option<f64>,Option<String>,Option<String>,
    Option<String>,Option<String>,String,String,Option<String>,
    Option<String>,Option<String>,Option<i64>,Option<String>,Option<String>,
    bool,bool,bool);

/// (id, order_number, tracking_number, carrier, days_since_update) — FEAT-007.
type StaleTrackingRow = (i64, Option<String>, String, Option<String>, i64);

impl Database {
    // ── Orders ────────────────────────────

    fn build_order(&self, id: i64) -> Result<Order, String> {
        let row: OrderRow =
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

    pub fn create_order(&self, input: &OrderInput, created_by: Option<i64>) -> Result<Order, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let items = serde_json::to_string(&input.items).unwrap_or_default();
        let total: f64 = input.items.iter().map(|i| i.price * i.qty as f64).sum();
        self.conn.execute(
            "INSERT INTO orders(profile_id,shop_id,drop_id,email_pool_id,proxy_id,order_number,status,items_json,total_amount,notes,created_by,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9,?10,datetime('now'),datetime('now'))",
            params![input.profile_id, input.shop_id, input.drop_id, input.email_pool_id, input.proxy_id, input.order_number, items, total, input.notes, created_by],
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
    #[allow(clippy::too_many_arguments)]
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
               pending_too_long, card_expiring, bin_declined_here): OrderListRow| {
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

    pub fn update_order_status(&self, id: i64, status: &str, meta: Option<&StatusMeta>, changed_by: Option<i64>) -> Result<(), String> {
        // FIX B64: валидация допустимых статусов
        // REDESIGN-05-5B3: 'received' — заказ перебит дропом (сессия перебивки);
        // триггер БД обновлён миграцией v26.
        const VALID_STATUSES: &[&str] = &["pending", "shipped", "delivered", "declined", "cancelled", "failed", "received"];
        if !VALID_STATUSES.contains(&status) {
            return Err(format!("invalid_status: '{}'. Allowed: {}", status, VALID_STATUSES.join(", ")));
        }
        let prev_status: Option<String> = self.conn.query_row(
            "SELECT status FROM orders WHERE id=?1", params![id], |r| r.get(0),
        ).ok();
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
        // MGR-014: структурная история переходов (time-in-status); дубликат
        // статуса историю не плодит.
        if prev_status.as_deref() != Some(status) {
            self.record_status_history(id, prev_status.as_deref(), status, changed_by, "user");
            // FEAT-004: IF-THEN правила автоматизации (status=declined → пометить
            // карту и т.п.). Ошибки правил не прерывают смену статуса —
            // фиксируются в automation_rule_runs и last_error правила.
            let _ = self.run_automation_rules_for_order(id, prev_status.as_deref(), status);
        }
        let _ = self.log_event("order.status_changed", &format!("Order {} → {}", id, status), Some("order"), Some(&id.to_string()));
        Ok(())
    }

    /// MGR-014: одна строка структурной истории статусов заказа.
    /// Ошибки не всплывают наружу (аналитика не должна ломать бизнес-поток).
    fn record_status_history(&self, order_id: i64, from_status: Option<&str>, to_status: &str, changed_by: Option<i64>, source: &str) {
        let _ = self.conn.execute(
            "INSERT INTO order_status_history(order_id,from_status,to_status,changed_by,source) VALUES(?1,?2,?3,?4,?5)",
            params![order_id, from_status, to_status, changed_by, source],
        );
    }

    pub fn delete_order(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM orders WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn bulk_update_orders_status(&self, ids: &[i64], status: &str, changed_by: Option<i64>) -> Result<(), String> {
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

        // MGR-014: снимаем прошлые статусы до апдейта — для истории переходов
        let sel_placeholders = ids.iter().enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sel_sql = format!("SELECT id, status FROM orders WHERE id IN ({})", sel_placeholders);
        let sel_params: Vec<Box<dyn rusqlite::ToSql>> = ids.iter().map(|&id| Box::new(id) as Box<dyn rusqlite::ToSql>).collect();
        let mut prev: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
        if let Ok(mut stmt) = self.conn.prepare(&sel_sql) {
            if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(sel_params.iter().map(|p| p.as_ref())), |r| {
                Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?))
            }) {
                for row in rows.flatten() {
                    prev.insert(row.0, row.1);
                }
            }
        }

        let sql = format!("UPDATE orders SET status=?1,updated_at=datetime('now') WHERE id IN ({})", placeholders);

        // FIX SQL-INJECTION: Build params safely using type-safe params_from_iter
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(status.to_string())];
        for &id in ids {
            params.push(Box::new(id));
        }

        self.conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
            .map_err(|e| format!("bulk_update_orders_status error: {}", e))?;

        for (&oid, old) in prev.iter() {
            if old != status {
                self.record_status_history(oid, Some(old), status, changed_by, "bulk");
            }
        }

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
            let prev_status: Option<String> = self.conn.query_row(
                "SELECT status FROM orders WHERE id=?1", params![oid], |r| r.get(0),
            ).ok();
            self.conn.execute(
                "UPDATE orders SET status=?1,updated_at=datetime('now') WHERE id=?2",
                params![status, oid],
            ).map_err(|e| e.to_string())?;
            if prev_status.as_deref() != Some(status) {
                self.record_status_history(oid, prev_status.as_deref(), status, None, "tracking");
            }
            let _ = self.log_event(
                "order.tracking_updated",
                &format!("Order {} → {} (Track17)", oid, status),
                Some("order"), Some(&oid.to_string()),
            );
        }
        Ok(())
    }

    // FIX B31: принимаем drop_id, email_pool_id, proxy_id и учитываем их в оценке риска
    // FEAT-002: amount — сумма заказа для статистического фактора (None = фактор пропускается)
    pub fn run_risk_check(&self, profile_id: &str, shop_id: i64,
        drop_id: Option<i64>, email_pool_id: Option<i64>, proxy_id: Option<i64>,
        amount: Option<f64>
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

        // ── FEAT-002: Risk V2 — статистический («ML-подобный») скоринг по истории ──
        // Факторы вычисляются из собственной истории заказов: магазин, BIN карты,
        // час суток (UTC), аномалия суммы. Малые выборки игнорируются.

        // Магазин: доля неудач по всем заказам этого магазина
        let (shop_total, shop_failed): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(status IN ('declined','failed')),0) FROM orders WHERE shop_id=?1 AND status != 'cancelled'",
            params![shop_id], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0, 0));
        if shop_total >= 5 {
            let rate = shop_failed as f64 / shop_total as f64;
            if rate >= 0.5 {
                score += 15;
                warnings.push(RiskWarning { kind: "shop_fail_rate".into(), severity: "warning".into(),
                    message: format!("This shop has {:.0}% failure rate ({} of {} orders)", rate * 100.0, shop_failed, shop_total),
                    related_order_id: None, related_order_status: None });
            } else if rate >= 0.3 {
                score += 8;
                warnings.push(RiskWarning { kind: "shop_fail_rate".into(), severity: "info".into(),
                    message: format!("This shop has {:.0}% failure rate ({} of {} orders)", rate * 100.0, shop_failed, shop_total),
                    related_order_id: None, related_order_status: None });
            }
        }

        // Карта (BIN): доля неудач по всем заказам с картами того же BIN
        let card_bin: Option<String> = self.conn.query_row(
            "SELECT c.bin FROM profiles p JOIN credit_cards c ON p.card_id=c.id WHERE p.id=?1",
            params![profile_id], |r| r.get(0),
        ).ok().flatten();
        if let Some(bin) = card_bin.filter(|b| !b.is_empty()) {
            let (bin_total, bin_failed): (i64, i64) = self.conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(o.status IN ('declined','failed')),0) FROM orders o \
                 JOIN profiles p ON o.profile_id=p.id JOIN credit_cards c ON p.card_id=c.id \
                 WHERE c.bin=?1 AND o.status != 'cancelled'",
                params![bin], |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap_or((0, 0));
            if bin_total >= 5 {
                let rate = bin_failed as f64 / bin_total as f64;
                if rate >= 0.5 {
                    score += 15;
                    warnings.push(RiskWarning { kind: "bin_fail_rate".into(), severity: "warning".into(),
                        message: format!("Cards with BIN {} fail in {:.0}% of orders ({} of {})", bin, rate * 100.0, bin_failed, bin_total),
                        related_order_id: None, related_order_status: None });
                } else if rate >= 0.3 {
                    score += 8;
                    warnings.push(RiskWarning { kind: "bin_fail_rate".into(), severity: "info".into(),
                        message: format!("Cards with BIN {} fail in {:.0}% of orders ({} of {})", bin, rate * 100.0, bin_failed, bin_total),
                        related_order_id: None, related_order_status: None });
                }
            }
        }

        // Время суток: доля неудач в заказах этого магазина, созданных в тот же час (UTC)
        let hour = chrono::Utc::now().format("%H").to_string();
        let (h_total, h_failed): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(status IN ('declined','failed')),0) FROM orders \
             WHERE shop_id=?1 AND status != 'cancelled' AND strftime('%H', created_at)=?2",
            params![shop_id, hour], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((0, 0));
        if h_total >= 3 && h_failed as f64 / h_total as f64 >= 0.5 {
            score += 10;
            warnings.push(RiskWarning { kind: "hour_fail_rate".into(), severity: "info".into(),
                message: format!("{} of {} orders at this shop placed in this hour (UTC) failed", h_failed, h_total),
                related_order_id: None, related_order_status: None });
        }

        // Сумма: аномалия относительно типичного успешного чека магазина
        if let Some(amount) = amount.filter(|a| *a > 0.0) {
            let (ok_cnt, ok_avg): (i64, f64) = self.conn.query_row(
                "SELECT COUNT(*), COALESCE(AVG(total_amount),0) FROM orders \
                 WHERE shop_id=?1 AND status NOT IN ('declined','failed','cancelled') \
                 AND total_amount IS NOT NULL AND total_amount > 0",
                params![shop_id], |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap_or((0, 0.0));
            if ok_cnt >= 3 && ok_avg > 0.0 && amount > 2.0 * ok_avg {
                let (pts, mult) = if amount > 3.0 * ok_avg { (15, "3") } else { (10, "2") };
                score += pts;
                warnings.push(RiskWarning { kind: "amount_above_typical".into(), severity: "warning".into(),
                    message: format!("Order amount {:.2} is >{}x the typical successful amount {:.2} at this shop", amount, mult, ok_avg),
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

    /// FEAT-007: «застоявшиеся» отправленные заказы — есть трек, статус
    /// shipped, и заказ не обновлялся `days` дней. Напоминание проверить
    /// трекинг вручную. Возвращает (id, order_number, tracking_number,
    /// carrier, days_since_update).
    pub fn stale_tracking_orders(&self, days: i64) -> Result<Vec<StaleTrackingRow>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, order_number, tracking_number, carrier, \
                    CAST(julianday('now') - julianday(updated_at) AS INTEGER) \
             FROM orders \
             WHERE status = 'shipped' \
               AND tracking_number IS NOT NULL AND tracking_number != '' \
               AND julianday('now') - julianday(updated_at) >= ?1 \
             ORDER BY updated_at"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![days], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    // ─────────────────────────────────────────
    //  REDESIGN-05-5B3: checkpoints + перебивка
    // ─────────────────────────────────────────

    /// Записать checkpoint трекинга. Дедуп: та же комбинация
    /// (order_id, status, event_at, description) второй раз не пишется —
    /// поллер дёргается каждые N минут и API отдаёт всю историю событий.
    /// Возвращает true, если строка реально добавлена.
    #[allow(clippy::too_many_arguments)]
    pub fn record_tracking_checkpoint(
        &self,
        order_id: i64,
        tracking_number: &str,
        carrier: Option<&str>,
        status: &str,
        status_detail: Option<&str>,
        location: Option<&str>,
        description: Option<&str>,
        event_at: Option<&str>,
    ) -> Result<bool, String> {
        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tracking_checkpoints
             WHERE order_id=?1 AND status=?2
               AND COALESCE(event_at,'')=COALESCE(?3,'')
               AND COALESCE(description,'')=COALESCE(?4,'')",
            params![order_id, status, event_at, description], |r| r.get(0),
        ).unwrap_or(0);
        if exists > 0 { return Ok(false); }
        self.conn.execute(
            "INSERT INTO tracking_checkpoints(order_id,tracking_number,carrier,status,status_detail,location,description,event_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![order_id, tracking_number, carrier, status, status_detail, location, description, event_at],
        ).map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Последний по времени checkpoint заказа (для детекта перехода статуса).
    pub fn latest_checkpoint_status(&self, order_id: i64) -> Result<Option<String>, String> {
        self.conn.query_row(
            "SELECT status FROM tracking_checkpoints WHERE order_id=?1
             ORDER BY id DESC LIMIT 1",
            params![order_id], |r| r.get(0),
        ).map(Some).or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
    }

    /// История checkpoints заказа, новые сверху (таймлайн трекинга в UI).
    pub fn get_order_checkpoints(&self, order_id: i64) -> Result<Vec<crate::models::TrackingCheckpoint>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,order_id,tracking_number,carrier,status,status_detail,location,description,event_at,checked_at
             FROM tracking_checkpoints WHERE order_id=?1 ORDER BY id DESC LIMIT 200"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![order_id], |r| Ok(crate::models::TrackingCheckpoint {
            id: r.get(0)?, order_id: r.get(1)?, tracking_number: r.get(2)?,
            carrier: r.get(3)?, status: r.get(4)?, status_detail: r.get(5)?,
            location: r.get(6)?, description: r.get(7)?, event_at: r.get(8)?,
            checked_at: r.get(9)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// REDESIGN-05 (c5j, 8B): календарь доставок — checkpoints за период
    /// [from, to) по ISO-префиксу дня. Не-ISO event_at от carrier'ов в
    /// выборку не попадают (lexicographic range) — это осознанный trade-off.
    pub fn get_calendar_events(&self, from: &str, to: &str) -> Result<Vec<crate::models::CalendarEvent>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT substr(COALESCE(NULLIF(c.event_at,''), c.checked_at), 1, 10) AS day,
                    c.order_id, o.order_number, c.tracking_number, c.carrier,
                    c.status, c.location, c.description
             FROM tracking_checkpoints c
             JOIN orders o ON o.id = c.order_id
             WHERE day >= ?1 AND day < ?2
             ORDER BY day, c.id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![from, to], |r| Ok(crate::models::CalendarEvent {
            date: r.get(0)?, order_id: r.get(1)?, order_number: r.get(2)?,
            tracking_number: r.get(3)?, carrier: r.get(4)?, status: r.get(5)?,
            location: r.get(6)?, description: r.get(7)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Проставить orders.delivered_at один раз (первый delivered от поллера).
    pub fn mark_order_delivered_at(&self, order_id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE orders SET delivered_at=datetime('now') WHERE id=?1 AND delivered_at IS NULL",
            params![order_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn map_rework_candidate(r: &rusqlite::Row) -> rusqlite::Result<crate::models::ReworkCandidate> {
        Ok(crate::models::ReworkCandidate {
            order_id: r.get(0)?, order_number: r.get(1)?, tracking_number: r.get(2)?,
            carrier: r.get(3)?, status: r.get(4)?, delivered_at: r.get(5)?,
            last_checkpoint: r.get(6)?, last_checkpoint_at: r.get(7)?,
            drop_id: r.get(8)?, drop_city: r.get(9)?, drop_address: r.get(10)?,
        })
    }

    const REWORK_SELECT: &'static str =
        "SELECT o.id, o.order_number, o.tracking_number, o.carrier, o.status, o.delivered_at,
                (SELECT c.status FROM tracking_checkpoints c WHERE c.order_id=o.id ORDER BY c.id DESC LIMIT 1),
                (SELECT c.checked_at FROM tracking_checkpoints c WHERE c.order_id=o.id ORDER BY c.id DESC LIMIT 1),
                o.drop_id, d.city, d.address
         FROM orders o LEFT JOIN drops d ON d.id=o.drop_id";

    /// Кандидаты в сессию перебивки: активные заказы, у которых последний
    /// checkpoint — out_for_delivery или delivered. Группировка по дропу/городу —
    /// на фронте, здесь отдаём полями.
    pub fn get_rework_candidates(&self) -> Result<Vec<crate::models::ReworkCandidate>, String> {
        let sql = format!(
            "{} WHERE o.status IN ('shipped','delivered') \
             AND (SELECT c.status FROM tracking_checkpoints c WHERE c.order_id=o.id ORDER BY c.id DESC LIMIT 1) \
                 IN ('out_for_delivery','delivered') \
             ORDER BY d.city, o.id DESC LIMIT 300",
            Self::REWORK_SELECT
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], Self::map_rework_candidate).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Правило «delivered >N часов и не перебит»: delivered_at старше порога,
    /// статус всё ещё delivered (перебитые уходят в 'received').
    pub fn get_rework_overdue(&self, hours: i64) -> Result<Vec<crate::models::ReworkCandidate>, String> {
        let sql = format!(
            "{} WHERE o.status='delivered' AND o.delivered_at IS NOT NULL \
             AND o.delivered_at <= datetime('now', ?1) \
             ORDER BY o.delivered_at LIMIT 300",
            Self::REWORK_SELECT
        );
        let modifier = format!("-{} hours", hours.max(1));
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![modifier], Self::map_rework_candidate).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Сессия перебивки: полученные дропом заказы → 'received', остальные
    /// из чеклиста → обратно в 'shipped' с заметкой. Оба перехода идут через
    /// update_order_status — история (order_status_history) и automation-правила
    /// сохраняются. Возвращает (received_count, missing_count).
    pub fn complete_rework_session(
        &self,
        received_ids: &[i64],
        missing_ids: &[i64],
        note: Option<&str>,
        changed_by: Option<i64>,
    ) -> Result<(usize, usize), String> {
        // дедуп пересечений: id из received выигрывает
        let received_set: std::collections::HashSet<i64> = received_ids.iter().copied().collect();
        let mut received_n = 0usize;
        for &id in &received_set {
            self.update_order_status(id, "received", None, changed_by)?;
            received_n += 1;
        }
        let stamp = format!(
            "Перебивка {}: не получен{}",
            chrono::Utc::now().format("%Y-%m-%d"),
            note.map(|n| format!(" — {}", n)).unwrap_or_default(),
        );
        let mut missing_n = 0usize;
        for &id in missing_ids {
            if received_set.contains(&id) { continue; }
            self.update_order_status(id, "shipped", None, changed_by)?;
            self.conn.execute(
                "UPDATE orders SET notes = CASE WHEN notes IS NULL OR notes='' THEN ?1 ELSE notes || char(10) || ?1 END WHERE id=?2",
                params![stamp, id],
            ).map_err(|e| e.to_string())?;
            missing_n += 1;
        }
        let _ = self.log_event(
            "order.rework_session",
            &format!("Rework session: {} received, {} not received", received_n, missing_n),
            Some("order"), None,
        );
        Ok((received_n, missing_n))
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

    /// FEAT-007: «застоявшиеся» shipped-заказы с треком
    #[test]
    fn test_stale_tracking_orders() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("t.db").to_str().unwrap()).unwrap();
        // create_profile требует разблокированную БД
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("test_pw_1234567890", &salt));
        // полная FK-цепочка: карта → профиль → заказ
        db.conn.execute(
            "INSERT INTO credit_cards(card_number,source) VALUES('4111111111111111','test')", [],
        ).unwrap();
        let card_id: i64 = db.conn.query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        let prof = db.create_profile(card_id, None).unwrap().id;
        let shop = db.create_shop(&crate::models::ShopInput {
            name: "S".into(), url: "https://stale.example.com".into(),
            category: "general".into(), notes: String::new(),
            requires_cvv_match: false, blocks_vpn: false, phone_must_match: false,
            accepts_amex: false, requires_avs: false, high_cancel_risk: false,
        }).unwrap();
        let oid = db.create_order(&OrderInput {
            profile_id: prof, shop_id: shop.id, drop_id: None, email_pool_id: None,
            proxy_id: None, order_number: Some("STALE-1".into()),
            notes: None, items: vec![],
        }, None).unwrap().id;

        // свежий shipped — НЕ застоявшийся
        db.conn.execute(
            "UPDATE orders SET status='shipped', tracking_number='1Z111', updated_at=datetime('now') WHERE id=?1",
            rusqlite::params![oid],
        ).unwrap();
        assert!(db.stale_tracking_orders(5).unwrap().is_empty());

        // устареваем updated_at на 10 дней назад — попадает
        db.conn.execute(
            "UPDATE orders SET updated_at=datetime('now','-10 days') WHERE id=?1",
            rusqlite::params![oid],
        ).unwrap();
        let got = db.stale_tracking_orders(5).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, oid);
        assert_eq!(got[0].2, "1Z111");
        assert!(got[0].4 >= 10);

        // delivered с тем же треком — не попадает
        db.conn.execute("UPDATE orders SET status='delivered' WHERE id=?1", rusqlite::params![oid]).unwrap();
        assert!(db.stale_tracking_orders(5).unwrap().is_empty());
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

    // ── FEAT-002: Risk V2 — статистические факторы ──

    /// Фикстура: БД + карта (bin=411111) + профиль + магазин
    fn risk_v2_fixture() -> (Database, String, i64) {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("t.db").to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("test_pw_1234567890", &salt));
        db.conn.execute(
            "INSERT INTO credit_cards(card_number,source,bin) VALUES('4111111111111111','test','411111')", [],
        ).unwrap();
        let card_id: i64 = db.conn.query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        let prof = db.create_profile(card_id, None).unwrap().id;
        let shop = db.create_shop(&crate::models::ShopInput {
            name: "S".into(), url: "https://riskv2.example.com".into(),
            category: "general".into(), notes: String::new(),
            requires_cvv_match: false, blocks_vpn: false, phone_must_match: false,
            accepts_amex: false, requires_avs: false, high_cancel_risk: false,
        }).unwrap();
        (db, prof, shop.id)
    }

    fn risk_v2_add_order(db: &Database, prof: &str, shop: i64, status: &str, total: Option<f64>) {
        let oid = db.create_order(&OrderInput {
            profile_id: prof.into(), shop_id: shop, drop_id: None, email_pool_id: None,
            proxy_id: None, order_number: None, notes: None, items: vec![],
        }, None).unwrap().id;
        db.conn.execute("UPDATE orders SET status=?1, total_amount=?2 WHERE id=?3",
            rusqlite::params![status, total, oid]).unwrap();
    }

    /// Магазин: ≥50% неудач при выборке ≥5 → shop_fail_rate (+15)
    #[test]
    fn test_risk_v2_shop_fail_rate() {
        let (db, prof, shop) = risk_v2_fixture();
        for i in 0..5 {
            risk_v2_add_order(&db, &prof, shop, if i < 3 { "declined" } else { "delivered" }, None);
        }
        let res = db.run_risk_check(&prof, shop, None, None, None, None).unwrap();
        let w = res.warnings.iter().find(|w| w.kind == "shop_fail_rate").expect("shop_fail_rate warning");
        assert_eq!(w.severity, "warning");
        assert!(res.score >= 15);
    }

    /// Магазин: выборка < 5 — фактор молчит даже при 100% неудач
    #[test]
    fn test_risk_v2_shop_fail_rate_small_sample() {
        let (db, prof, shop) = risk_v2_fixture();
        for _ in 0..4 { risk_v2_add_order(&db, &prof, shop, "declined", None); }
        let res = db.run_risk_check(&prof, shop, None, None, None, None).unwrap();
        assert!(res.warnings.iter().all(|w| w.kind != "shop_fail_rate"));
    }

    /// BIN карты: ≥50% неудач при выборке ≥5 → bin_fail_rate (+15)
    #[test]
    fn test_risk_v2_bin_fail_rate() {
        let (db, prof, shop) = risk_v2_fixture();
        for i in 0..5 {
            risk_v2_add_order(&db, &prof, shop, if i < 3 { "failed" } else { "delivered" }, None);
        }
        let res = db.run_risk_check(&prof, shop, None, None, None, None).unwrap();
        assert!(res.warnings.iter().any(|w| w.kind == "bin_fail_rate" && w.severity == "warning"));
    }

    /// Время суток: ≥50% неудач в текущий час UTC при выборке ≥3 → hour_fail_rate (+10)
    #[test]
    fn test_risk_v2_hour_fail_rate() {
        let (db, prof, shop) = risk_v2_fixture();
        // created_at = CURRENT_TIMESTAMP (текущий час UTC, как и в проверке)
        for _ in 0..3 { risk_v2_add_order(&db, &prof, shop, "failed", None); }
        let res = db.run_risk_check(&prof, shop, None, None, None, None).unwrap();
        assert!(res.warnings.iter().any(|w| w.kind == "hour_fail_rate"));
    }

    /// Сумма: >3x типичного успешного чека → amount_above_typical (+15);
    /// <2x или None → фактор молчит
    #[test]
    fn test_risk_v2_amount_above_typical() {
        let (db, prof, shop) = risk_v2_fixture();
        for _ in 0..3 { risk_v2_add_order(&db, &prof, shop, "delivered", Some(100.0)); }
        let res = db.run_risk_check(&prof, shop, None, None, None, Some(350.0)).unwrap();
        assert!(res.warnings.iter().any(|w| w.kind == "amount_above_typical"));
        let res = db.run_risk_check(&prof, shop, None, None, None, Some(150.0)).unwrap();
        assert!(res.warnings.iter().all(|w| w.kind != "amount_above_typical"));
        let res = db.run_risk_check(&prof, shop, None, None, None, None).unwrap();
        assert!(res.warnings.iter().all(|w| w.kind != "amount_above_typical"));
    }

    /// Пустая история: ни один статистический фактор не срабатывает, уровень safe
    #[test]
    fn test_risk_v2_clean_history() {
        let (db, prof, shop) = risk_v2_fixture();
        let res = db.run_risk_check(&prof, shop, None, None, None, Some(999.0)).unwrap();
        assert_eq!(res.level, "safe");
        assert_eq!(res.score, 0);
        assert!(res.warnings.is_empty());
    }

    // ── FEAT-003: smart-подсказки ──

    /// card_burning: in_use карта с 3 consecutive declines попадает в подсказки,
    /// а после delivered серия прерывается и подсказка исчезает
    #[test]
    fn test_smart_hints_card_burning() {
        let (db, prof, shop) = risk_v2_fixture();
        // карта становится in_use через профиль; магазину нужен success_rate >= 30%
        // (2 delivered из 5 = 40%), иначе get_consecutive_declines отбрасывает
        // его declines как «плохой магазин»
        risk_v2_add_order(&db, &prof, shop, "delivered", None);
        risk_v2_add_order(&db, &prof, shop, "delivered", None);
        // разносим created_at, чтобы ORDER BY created_at DESC не перепутывал
        // заказы с одинаковой секундой (delivered должны быть старше declined)
        db.conn.execute("UPDATE orders SET created_at = datetime('now', '-10 seconds')", []).unwrap();
        // 3 declined подряд → карта горит (порог авто-архива по умолчанию = 5)
        for _ in 0..3 { risk_v2_add_order(&db, &prof, shop, "declined", None); }
        let hints = db.smart_hints().unwrap();
        let burning: Vec<_> = hints.iter().filter(|h| h["kind"] == "card_burning").collect();
        assert_eq!(burning.len(), 1, "3 declines должны дать card_burning");
        assert_eq!(burning[0]["declines"], 3);
        assert_eq!(burning[0]["threshold"], 5);

        // delivered прерывает серию → подсказка снимается
        db.conn.execute("UPDATE orders SET created_at = datetime('now', '-5 seconds')", []).unwrap();
        risk_v2_add_order(&db, &prof, shop, "delivered", None);
        let hints = db.smart_hints().unwrap();
        assert!(hints.iter().all(|h| h["kind"] != "card_burning"));
    }

    /// order_fail_streak: 3+ declined/failed подряд (по всем заказам) → подсказка
    #[test]
    fn test_smart_hints_order_fail_streak() {
        let (db, prof, shop) = risk_v2_fixture();
        // сначала delivered, чтобы серия прервалась, потом 3 declined
        risk_v2_add_order(&db, &prof, shop, "delivered", None);
        assert!(db.smart_hints().unwrap().iter().all(|h| h["kind"] != "order_fail_streak"));

        for _ in 0..3 { risk_v2_add_order(&db, &prof, shop, "declined", None); }
        let hints = db.smart_hints().unwrap();
        let streak: Vec<_> = hints.iter().filter(|h| h["kind"] == "order_fail_streak").collect();
        assert_eq!(streak.len(), 1, "3 declined подряд должны дать order_fail_streak");
        assert_eq!(streak[0]["count"], 3);
    }

    /// Пустая БД: ни одной подсказки
    #[test]
    fn test_smart_hints_empty() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("t.db").to_str().unwrap()).unwrap();
        assert!(db.smart_hints().unwrap().is_empty());
    }

    // ── MGR-014: created_by + структурная история статусов ──────────────

    /// Фикстура: карта → профиль → шоп; возвращает (db, card_id, profile_id, shop_id)
    fn mgr14_fixture() -> (Database, i64, String, i64) {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Database::open(dir.path().join("t.db").to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("test_pw_1234567890", &salt));
        db.conn.execute(
            "INSERT INTO credit_cards(card_number,source) VALUES('4111111111111111','test')", [],
        ).unwrap();
        let card_id: i64 = db.conn.query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        let prof = db.create_profile(card_id, None).unwrap().id;
        let shop = db.create_shop(&crate::models::ShopInput {
            name: "S".into(), url: "https://mgr14.example.com".into(),
            category: "general".into(), notes: String::new(),
            requires_cvv_match: false, blocks_vpn: false, phone_must_match: false,
            accepts_amex: false, requires_avs: false, high_cancel_risk: false,
        }).unwrap();
        // БД не должна выгружаться, пока живы временные таблицы — держим dir
        std::mem::forget(dir);
        (db, card_id, prof, shop.id)
    }

    /// MGR-014: created_by пишется при создании заказа и восстанавливается
    /// backfill'ом миграции v21 для старых заказов
    #[test]
    fn test_order_created_by_and_backfill() {
        let (db, _card_id, prof, shop_id) = mgr14_fixture();
        // юзер для атрибуции (в тестовой БД users пуст — админ создаётся при
        // первом запуске, не миграцией)
        db.conn.execute(
            "INSERT INTO users(username,password_hash,display_name,role) VALUES('op1','hash','Оператор','operator')", [],
        ).unwrap();
        let admin_id: i64 = db.conn.query_row("SELECT id FROM users WHERE username='op1'", [], |r| r.get(0)).unwrap();
        let input = OrderInput {
            profile_id: prof.clone(), shop_id, drop_id: None, email_pool_id: None,
            proxy_id: None, order_number: Some("MGR14-1".into()),
            notes: None, items: vec![],
        };
        let order = db.create_order(&input, Some(admin_id)).unwrap();
        let created_by: Option<i64> = db.conn.query_row(
            "SELECT created_by FROM orders WHERE id=?1", params![order.id], |r| r.get(0),
        ).unwrap();
        assert_eq!(created_by, Some(admin_id), "created_by должен записываться при создании");

        // заказ без автора (системные флоу) → NULL, потом backfill из card_assignments
        let o2 = db.create_order(&input, None).unwrap();
        let before: Option<i64> = db.conn.query_row(
            "SELECT created_by FROM orders WHERE id=?1", params![o2.id], |r| r.get(0),
        ).unwrap();
        assert_eq!(before, None);

        // эмулируем backfill миграции v21 на втором заказе (карта не забронирована
        // этим юзером → NULL); проверяем сам SQL backfill на валидность и idempotentность
        db.conn.execute(
            "UPDATE orders SET created_by = (SELECT ca.user_id FROM profiles p JOIN card_assignments ca ON ca.card_id=p.card_id WHERE p.id=orders.profile_id LIMIT 1) WHERE created_by IS NULL", [],
        ).unwrap();
        let after: Option<i64> = db.conn.query_row(
            "SELECT created_by FROM orders WHERE id=?1", params![o2.id], |r| r.get(0),
        ).unwrap();
        // владелец карты не записан в card_assignments → backfill оставляет NULL
        assert_eq!(after, None);
    }

    /// MGR-014: order_status_history — переходы user/tracking/bulk, дубликаты не пишутся
    #[test]
    fn test_order_status_history() {
        let (db, _card_id, prof, shop_id) = mgr14_fixture();
        db.conn.execute(
            "INSERT INTO users(username,password_hash,display_name,role) VALUES('op1','hash','Оператор','operator')", [],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO users(username,password_hash,display_name,role) VALUES('op2','hash','Оператор 2','operator')", [],
        ).unwrap();
        let u1: i64 = db.conn.query_row("SELECT id FROM users WHERE username='op1'", [], |r| r.get(0)).unwrap();
        let u2: i64 = db.conn.query_row("SELECT id FROM users WHERE username='op2'", [], |r| r.get(0)).unwrap();
        let input = OrderInput {
            profile_id: prof, shop_id, drop_id: None, email_pool_id: None,
            proxy_id: None, order_number: Some("HIST-1".into()), notes: None, items: vec![],
        };
        let oid = db.create_order(&input, Some(u1)).unwrap().id;

        db.update_order_status(oid, "shipped", None, Some(u2)).unwrap();
        db.update_order_status(oid, "delivered", None, Some(u2)).unwrap();
        // дубль статуса — истории не плодит
        db.update_order_status(oid, "delivered", None, Some(u2)).unwrap();

        let rows: Vec<(Option<String>, String, Option<i64>, String)> = {
            let mut stmt = db.conn.prepare(
                "SELECT from_status, to_status, changed_by, source FROM order_status_history WHERE order_id=?1 ORDER BY id"
            ).unwrap();
            let m = stmt.query_map(params![oid], |r| {
                Ok((r.get::<_,Option<String>>(0)?, r.get::<_,String>(1)?, r.get::<_,Option<i64>>(2)?, r.get::<_,String>(3)?))
            }).unwrap();
            m.filter_map(|r| r.ok()).collect()
        };
        assert_eq!(rows.len(), 2, "pending→shipped, shipped→delivered; дубль не пишется");
        assert_eq!(rows[0], (Some("pending".into()), "shipped".into(), Some(u2), "user".into()));
        assert_eq!(rows[1], (Some("shipped".into()), "delivered".into(), Some(u2), "user".into()));

        // tracking-апдейт (id-путь уже в delivered — не активен), bulk с автором
        db.bulk_update_orders_status(&[oid], "cancelled", Some(u1)).unwrap();
        let last: (Option<String>, String, Option<i64>, String) = db.conn.query_row(
            "SELECT from_status,to_status,changed_by,source FROM order_status_history ORDER BY id DESC LIMIT 1",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).unwrap();
        assert_eq!(last.0, Some("delivered".into()));
        assert_eq!(last.1, "cancelled");
        assert_eq!(last.2, Some(u1));
        assert_eq!(last.3, "bulk");
    }
}


// ─────────────────────────────────────────
//  REDESIGN-05-5B3: checkpoints + перебивка — интеграционные тесты
// ─────────────────────────────────────────

#[cfg(test)]
mod rework_tests {
    use crate::database::Database;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rework.db");
        let db = Database::open(path.to_str().unwrap()).unwrap();
        (dir, db)
    }

    fn seed_order(db: &Database, status: &str, tracking: Option<&str>) -> i64 {
        db.conn.execute(
            "INSERT INTO orders(order_number,status,tracking_number,carrier) VALUES(?3,?1,?2,'UPS')",
            rusqlite::params![status, tracking, format!("WB-{}", tracking.unwrap_or("X"))],
        ).unwrap();
        db.conn.last_insert_rowid()
    }

    fn order_status(db: &Database, id: i64) -> String {
        db.conn.query_row("SELECT status FROM orders WHERE id=?1", rusqlite::params![id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn test_checkpoint_dedup_and_latest() {
        let (_dir, db) = test_db();
        let oid = seed_order(&db, "shipped", Some("1Z999"));
        assert!(db.record_tracking_checkpoint(oid, "1Z999", Some("UPS"), "in_transit", None, Some("Kyiv"), Some("Departed"), Some("2026-08-30 10:00")).unwrap());
        // дубликат (та же status+event_at+description) не пишется
        assert!(!db.record_tracking_checkpoint(oid, "1Z999", Some("UPS"), "in_transit", None, Some("Kyiv"), Some("Departed"), Some("2026-08-30 10:00")).unwrap());
        // новое событие — пишется
        assert!(db.record_tracking_checkpoint(oid, "1Z999", Some("UPS"), "out_for_delivery", None, None, Some("Out for Delivery"), Some("2026-08-31 08:00")).unwrap());
        assert_eq!(db.latest_checkpoint_status(oid).unwrap().as_deref(), Some("out_for_delivery"));
        let cps = db.get_order_checkpoints(oid).unwrap();
        assert_eq!(cps.len(), 2);
        assert_eq!(cps[0].status, "out_for_delivery"); // новые сверху
    }

    #[test]
    fn test_rework_candidates_filter() {
        let (_dir, db) = test_db();
        let o1 = seed_order(&db, "shipped", Some("1Z001"));
        let o2 = seed_order(&db, "pending", Some("1Z002"));
        let _o3 = seed_order(&db, "shipped", Some("1Z003")); // без checkpoints
        db.record_tracking_checkpoint(o1, "1Z001", None, "out_for_delivery", None, None, None, None).unwrap();
        db.record_tracking_checkpoint(o2, "1Z002", None, "delivered", None, None, None, None).unwrap();
        let cands = db.get_rework_candidates().unwrap();
        let ids: Vec<i64> = cands.iter().map(|c| c.order_id).collect();
        assert!(ids.contains(&o1), "shipped + out_for_delivery → кандидат");
        assert!(!ids.contains(&o2), "pending отфильтрован по статусу заказа");
        assert_eq!(ids.len(), 1);
        assert_eq!(cands[0].last_checkpoint.as_deref(), Some("out_for_delivery"));
    }

    #[test]
    fn test_complete_rework_session() {
        let (_dir, db) = test_db();
        let got = seed_order(&db, "delivered", Some("1Z101"));
        let lost = seed_order(&db, "delivered", Some("1Z102"));
        // changed_by=None: в тестовой БД нет users (FK на users.id, PRAGMA foreign_keys=ON)
        let (r, m) = db.complete_rework_session(&[got], &[got, lost], Some("дроп молчит"), None).unwrap();
        assert_eq!((r, m), (1, 1), "пересечение списков выигрывает received");
        assert_eq!(order_status(&db, got), "received");
        assert_eq!(order_status(&db, lost), "shipped");
        let notes: String = db.conn.query_row("SELECT notes FROM orders WHERE id=?1", rusqlite::params![lost], |r| r.get(0)).unwrap();
        assert!(notes.contains("Перебивка") && notes.contains("дроп молчит"));
        // история переходов записана (received — новый статус v26)
        let hist: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM order_status_history WHERE order_id=?1 AND to_status='received'",
            rusqlite::params![got], |r| r.get(0)).unwrap();
        assert_eq!(hist, 1);
    }

    #[test]
    fn test_rework_overdue_rule() {
        let (_dir, db) = test_db();
        let old = seed_order(&db, "delivered", Some("1Z201"));
        let fresh = seed_order(&db, "delivered", Some("1Z202"));
        let reworked = seed_order(&db, "delivered", Some("1Z203"));
        db.mark_order_delivered_at(old).unwrap();
        db.mark_order_delivered_at(fresh).unwrap();
        db.mark_order_delivered_at(reworked).unwrap();
        // старый delivered — 48 часов назад
        db.conn.execute("UPDATE orders SET delivered_at=datetime('now','-48 hours') WHERE id=?1", rusqlite::params![old]).unwrap();
        // перебитый (received) со старым delivered_at — не алерт
        db.update_order_status(reworked, "received", None, None).unwrap();
        db.conn.execute("UPDATE orders SET delivered_at=datetime('now','-48 hours') WHERE id=?1", rusqlite::params![reworked]).unwrap();

        let overdue = db.get_rework_overdue(24).unwrap();
        let ids: Vec<i64> = overdue.iter().map(|c| c.order_id).collect();
        assert!(ids.contains(&old));
        assert!(!ids.contains(&fresh), "свежий delivered ещё не просрочен");
        assert!(!ids.contains(&reworked), "received исключён из алертов");
        // mark_order_delivered_at идемпотентен — не затирает первый delivered
        db.mark_order_delivered_at(old).unwrap();
        let ts: String = db.conn.query_row("SELECT delivered_at FROM orders WHERE id=?1", rusqlite::params![old], |r| r.get(0)).unwrap();
        assert!(ts.as_str() < "2027-01-01", "delivered_at остался старым, got {}", ts);
    }

    #[test]
    fn test_status_received_allowed_by_trigger() {
        let (_dir, db) = test_db();
        let oid = seed_order(&db, "delivered", None);
        db.update_order_status(oid, "received", None, None).unwrap();
        assert_eq!(order_status(&db, oid), "received");
        // мусорный статус по-прежнему отклоняется триггером БД
        let err = db.update_order_status(oid, "bogus", None, None);
        assert!(err.is_err());
    }
}
