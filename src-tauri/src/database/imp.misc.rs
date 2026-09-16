impl Database {
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
            "SELECT COUNT(DISTINCT f.ip_hash) FROM shop_footprints f WHERE f.shop_id = ?1 AND f.ip_hash IS NOT NULL",
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
    //  PHASE 2: Shop Statistics Enhancement
    // ─────────────────────────────────────────

    /// Get carrier-specific statistics for a shop
    pub fn get_carrier_stats(&self, shop_id: i64) -> Result<Vec<CarrierStats>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT
                CASE
                    WHEN tracking_number LIKE '1Z%' THEN 'UPS'
                    WHEN tracking_number GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' THEN 'FedEx'
                    WHEN tracking_number LIKE '94%' THEN 'USPS'
                    ELSE 'Unknown'
                END as carrier,
                COUNT(*) as total_orders,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined
             FROM orders
             WHERE shop_id = ?1 AND tracking_number IS NOT NULL AND tracking_number != ''
             GROUP BY carrier
             ORDER BY total_orders DESC"
        ).map_err(|e| e.to_string())?;

        let carriers: Vec<CarrierStats> = stmt.query_map(params![shop_id], |row| {
            let carrier: String = row.get(0)?;
            let total: i64 = row.get(1)?;
            let delivered: i64 = row.get(2)?;
            let declined: i64 = row.get(3)?;
            let success_rate = if total > 0 { delivered as f64 / total as f64 } else { 0.0 };
            Ok(CarrierStats { carrier, total_orders: total, delivered, declined, success_rate })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        Ok(carriers)
    }

    /// Get statistics for a specific time period
    pub fn get_period_stats(&self, shop_id: i64, days: u32) -> Result<PeriodStats, String> {
        let row = self.conn.query_row(
            &format!(
                "SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                    SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined,
                    COALESCE(SUM(CAST(total_amount AS REAL)), 0) as revenue
                 FROM orders
                 WHERE shop_id = ?1
                   AND created_at >= datetime('now', '-{} days')",
                days
            ),
            params![shop_id],
            |r| Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, f64>(3)?,
            ))
        ).map_err(|e| e.to_string())?;

        let total = row.0;
        let delivered = row.1;
        let declined = row.2;
        let revenue = row.3;
        let success_rate = if total > 0 { delivered as f64 / total as f64 } else { 0.0 };

        Ok(PeriodStats { days, total, delivered, declined, success_rate, revenue })
    }

    /// Get unique users (by installation_id_hash) for a shop in last 30 days
    pub fn get_unique_users_for_shop(&self, shop_id: i64) -> Result<i64, String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT f.installation_id_hash)
             FROM shop_footprints f
             WHERE f.shop_id = ?1
               AND f.created_at >= datetime('now', '-30 days')
               AND f.installation_id_hash IS NOT NULL",
            params![shop_id],
            |r| r.get(0)
        ).map_err(|e| e.to_string())?;

        Ok(count)
    }

    /// Get average delivery days for a shop (from order creation to delivered)
    pub fn get_avg_delivery_days(&self, shop_id: i64) -> Result<f64, String> {
        let avg: f64 = self.conn.query_row(
            "SELECT AVG(julianday(updated_at) - julianday(created_at))
             FROM orders
             WHERE shop_id = ?1
               AND status = 'delivered'
               AND created_at IS NOT NULL
               AND updated_at IS NOT NULL",
            params![shop_id],
            |r| r.get(0)
        ).map_err(|e| e.to_string())?;

        Ok((avg * 10.0).round() / 10.0)
    }

    /// Get aggregated shop statistics V2 (base + carrier + period + unique users + avg delivery)
    pub fn get_shop_stats_v2(&self, shop_id: i64) -> Result<ShopStatsV2, String> {
        // Get base stats
        let base_stats = self.get_shop_stats(shop_id)?;

        // Get carrier breakdown
        let carrier_stats = self.get_carrier_stats(shop_id)?;

        // Get period stats
        let period_7d = self.get_period_stats(shop_id, 7)?;
        let period_30d = self.get_period_stats(shop_id, 30)?;

        // Get unique users
        let unique_users_30d = self.get_unique_users_for_shop(shop_id)?;

        // Get avg delivery days
        let avg_delivery_days = self.get_avg_delivery_days(shop_id)?;

        Ok(ShopStatsV2 {
            base_stats,
            carrier_stats,
            period_7d,
            period_30d,
            unique_users_30d,
            avg_delivery_days,
        })
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
            "SELECT COUNT(*), COALESCE(SUM(CAST(total_amount AS REAL)),0), COALESCE(AVG(CAST(total_amount AS REAL)),0) FROM orders WHERE profile_id=?1",
            params![profile_id],
            |r| Ok((r.get::<_,i64>(0)?, r.get::<_,f64>(1)?, r.get::<_,f64>(2)?))
        ).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "orders": row.0, "total": row.1, "avg": row.2 }))
    }

    // E2: Auto-mark orders as Delivered when IMAP poll finds a delivery email
    pub fn auto_mark_delivered_by_account(&self, account_id: i64) -> Result<Vec<i64>, String> {
        // Find the email for this IMAP account (login хранится открытым текстом)
        let email: String = self.conn.query_row(
            "SELECT login FROM imap_accounts WHERE id=?1",
            params![account_id],
            |r| r.get(0)
        ).map_err(|e| e.to_string())?;
        // FIX AUDIT-07: email_pool.email зашифрован — ищем по email_hash.
        // Email связан с заказом через orders.email_pool_id (в profiles нет
        // колонки email_id). Статусы в БД строчные.
        let login_hash = Self::email_hash(&email);
        let mut stmt = self.conn.prepare(
            "SELECT o.id FROM orders o JOIN email_pool ep ON ep.id=o.email_pool_id
             WHERE ep.email_hash=?1 AND o.status='shipped'"
        ).map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt.query_map(params![login_hash], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for id in &ids {
            let _ = self.conn.execute(
                "UPDATE orders SET status='delivered', updated_at=datetime('now') WHERE id=?1",
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

    // ─────────────────────────────────────────
    //  PHASE 5: Automation Config
    // ─────────────────────────────────────────

    /// PHASE 5: Получение конфигурации автоматизации
    pub fn get_automation_config(&self) -> Result<crate::models::AutomationConfig, String> {
        Ok(crate::models::AutomationConfig {
            autolock_timeout: self.get_config_u64("autolock_timeout", 300)?,
            sync_interval: self.get_config_u64("sync_interval", 120)?,
            imap_poll_interval: self.get_config_u64("imap_poll_interval", 60)?,
            tracking_interval: self.get_config_u64("tracking_interval", 1800)?,
            proxy_check_interval: self.get_config_u64("proxy_check_interval", 1800)?,
            max_sync_failures: self.get_config_u32("max_sync_failures", 5)?,
            auto_archive_enabled: self.get_config_bool("auto_archive_enabled", true)?,
            burned_card_threshold: self.get_config_u32("burned_card_threshold", 3)?,
            decline_threshold: self.get_config_u32("decline_threshold", 5)?,
            eco_mode: self.get_config_bool("eco_mode", false)?,
        })
    }

    /// PHASE 5: Установка значения конфигурации автоматизации
    pub fn set_automation_config(&self, key: &str, value: &str) -> Result<(), String> {
        // Валидация ключа
        let allowed_keys = [
            "autolock_timeout", "sync_interval", "imap_poll_interval",
            "tracking_interval", "proxy_check_interval", "max_sync_failures",
            "auto_archive_enabled", "burned_card_threshold", "decline_threshold", "eco_mode"
        ];
        if !allowed_keys.contains(&key) {
            return Err(format!("Invalid automation config key: {}", key));
        }

        self.conn.execute(
            "INSERT INTO automation_config(key, value, updated_at) VALUES(?1, ?2, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
            params![key, value],
        ).map_err(|e| e.to_string())?;

        // Логирование изменения
        self.log_event("automation.config_changed", &format!("{} = {}", key, value), Some("automation"), None)?;

        Ok(())
    }

    /// PHASE 5: Получение состояния здоровья автоматизации
    pub fn get_automation_health(&self) -> Result<crate::models::AutomationHealth, String> {
        use std::time::{SystemTime, UNIX_EPOCH};

        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // Check if database is locked
        let db_locked = self.is_locked();

        // Get config values
        let eco_mode = self.get_config_bool("eco_mode", false)?;

        // Get last success timestamps from activity log
        let get_last_success = |event_type: &str| -> Result<u64, String> {
            let result: Option<String> = self.conn.query_row(
                &format!(
                    "SELECT created_at FROM activity_log
                     WHERE event_type = '{}'
                     ORDER BY created_at DESC LIMIT 1",
                    event_type
                ),
                [],
                |row| row.get(0)
            ).ok();

            if let Some(ts) = result {
                // Parse SQLite timestamp to Unix timestamp
                let parsed = chrono::NaiveDateTime::parse_from_str(&ts, "%Y-%m-%d %H:%M:%S")
                    .map(|dt| dt.and_utc().timestamp() as u64)
                    .unwrap_or(0);
                Ok(parsed)
            } else {
                Ok(0)
            }
        };

        let sync_last_success = get_last_success("sync.footprints_sent").unwrap_or(0);
        let imap_last_success = get_last_success("imap.poll_completed").unwrap_or(0);
        let tracking_last_success = get_last_success("tracking.updated").unwrap_or(0);
        let proxy_last_success = get_last_success("proxy.health_check").unwrap_or(0);

        // Calculate seconds since last success
        let secs_since = |last: u64| -> u64 {
            if last == 0 { return u64::MAX; }
            now_secs.saturating_sub(last)
        };

        // Determine if online (any activity in last 5 minutes)
        let is_online = secs_since(sync_last_success) < 300
            || secs_since(imap_last_success) < 300
            || secs_since(tracking_last_success) < 300
            || secs_since(proxy_last_success) < 300;

        Ok(crate::models::AutomationHealth {
            is_online,
            db_locked,
            eco_mode,
            pause_all: false, // Can be extended with a pause_all config
            sync_last_success: secs_since(sync_last_success),
            imap_last_success: secs_since(imap_last_success),
            tracking_last_success: secs_since(tracking_last_success),
            proxy_last_success: secs_since(proxy_last_success),
        })
    }

    // Helper функции для получения значений разных типов
    fn get_config_u64(&self, key: &str, default: u64) -> Result<u64, String> {
        match self.get_config(key).map_err(|e| e.to_string())? {
            Some(v) => v.parse::<u64>().map_err(|e| format!("Failed to parse {}: {}", key, e)),
            None => Ok(default),
        }
    }

    fn get_config_u32(&self, key: &str, default: u32) -> Result<u32, String> {
        match self.get_config(key).map_err(|e| e.to_string())? {
            Some(v) => v.parse::<u32>().map_err(|e| format!("Failed to parse {}: {}", key, e)),
            None => Ok(default),
        }
    }

    fn get_config_bool(&self, key: &str, default: bool) -> Result<bool, String> {
        match self.get_config(key).map_err(|e| e.to_string())? {
            Some(v) => Ok(v == "true" || v == "1"),
            None => Ok(default),
        }
    }

    // ─────────────────────────────────────────
    //  PHASE 6: Smart Card Protection
    // ─────────────────────────────────────────

    /// PHASE 6: Получение карт с 3+ заказами на одном магазине (burned cards)
    pub fn get_burned_cards(&self, threshold: u32) -> Result<Vec<crate::models::BurnedCard>, String> {
        let mut stmt = self.conn.prepare("
            SELECT p.card_id, o.shop_id, s.name as shop_name, COUNT(*) as order_count,
                   (SELECT o2.status FROM orders o2 WHERE o2.profile_id = p.id ORDER BY o2.created_at DESC LIMIT 1) as last_status
            FROM orders o
            JOIN profiles p ON o.profile_id = p.id
            JOIN shops s ON o.shop_id = s.id
            WHERE o.status NOT IN ('declined', 'failed', 'cancelled')
            GROUP BY p.card_id, o.shop_id
            HAVING COUNT(*) >= ?1
            ORDER BY order_count DESC
        ").map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![threshold as i64], |row| {
            Ok(crate::models::BurnedCard {
                card_id: row.get(0)?,
                shop_id: row.get(1)?,
                shop_name: row.get(2)?,
                order_count: row.get(3)?,
                last_status: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        Ok(rows)
    }

    /// PHASE 6: Авто-архивация карт с 3+ заказами на одном магазине
    pub fn auto_archive_burned_cards(&self, threshold: u32) -> Result<u32, String> {
        let burned = self.get_burned_cards(threshold)?;
        let mut archived = 0u32;

        for burned_card in burned {
            // Проверяем что нет pending заказов
            let has_pending: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id = p.id
                 WHERE p.card_id = ?1 AND o.status = 'pending'",
                params![burned_card.card_id],
                |r| r.get(0),
            ).unwrap_or(0);

            if has_pending > 0 {
                continue; // Не архивируем если есть pending заказы
            }

            // Архивируем карту
            self.conn.execute(
                "UPDATE credit_cards SET status = 'archive' WHERE id = ?1",
                params![burned_card.card_id],
            ).map_err(|e| e.to_string())?;

            // Логируем событие
            self.log_event(
                "automation.card_archived",
                &format!("Card {} archived (burned: {} orders at {})",
                    burned_card.card_id, burned_card.order_count, burned_card.shop_name),
                Some("automation"),
                Some(&burned_card.card_id.to_string()),
            )?;

            archived += 1;
        }

        Ok(archived)
    }

    /// PHASE 6: Получение количества последовательных declines для карты
    pub fn get_consecutive_declines(&self, card_id: i64) -> Result<u32, String> {
        // Получаем последние заказы карты, отсортированные по дате
        // FIX AUDIT-06: s.success_rate не существует в shops — считаем success rate
        // магазина из его заказов (delivered / total, в процентах).
        let mut stmt = self.conn.prepare("
            SELECT o.status, o.shop_id,
              (SELECT COALESCE(
                  (SELECT COUNT(*) FROM orders o2 WHERE o2.shop_id=o.shop_id AND o2.status='delivered') * 100.0 /
                  NULLIF((SELECT COUNT(*) FROM orders o2 WHERE o2.shop_id=o.shop_id), 0), 0)) as success_rate,
              o.created_at
            FROM orders o
            JOIN profiles p ON o.profile_id = p.id
            WHERE p.card_id = ?1
            ORDER BY o.created_at DESC
            LIMIT 20
        ").map_err(|e| e.to_string())?;

        let rows: Vec<(String, i64, Option<f64>, String)> = stmt.query_map(params![card_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        let mut consecutive = 0u32;

        for (status, _shop_id, success_rate, _created_at) in rows {
            if status == "declined" || status == "failed" {
                // Игнорируем declines на "плохих" магазинах (success_rate < 30%)
                if let Some(sr) = success_rate {
                    if sr < 30.0 {
                        continue; // Не считаем этот decline
                    }
                }
                consecutive += 1;
            } else if status == "delivered" {
                // Успешный заказ прерывает серию declines
                break;
            }
        }

        Ok(consecutive)
    }

    /// FEAT-003: smart-подсказки. Возвращает JSON-список подсказок:
    /// - "card_burning": in_use карта набрала >= ALERT_THRESHOLD и < decline_threshold
    ///   consecutive declines (скоро сгорит → уйдёт в авто-архив);
    /// - "order_fail_streak": глобальная серия >= STREAK_THRESHOLD declined/failed
    ///   заказов подряд (по всем картам/магазинам, delivered прерывает серию).
    pub fn smart_hints(&self) -> Result<Vec<serde_json::Value>, String> {
        const ALERT_THRESHOLD: u32 = 3; // предупреждаем раньше авто-архива (дефолт 5)
        const STREAK_THRESHOLD: u32 = 3; // "3 неуспешных заказа подряд"
        let decline_threshold = self.get_config_u32("decline_threshold", 5)?;

        let mut hints = Vec::new();

        // «Карта скоро сгорит»: in_use карты, declines в [ALERT_THRESHOLD, decline_threshold)
        let mut stmt = self.conn.prepare(
            "SELECT id, COALESCE(bin,''), last4 FROM credit_cards WHERE status = 'in_use'"
        ).map_err(|e| e.to_string())?;
        let cards: Vec<(i64, String, Option<String>)> = stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        drop(stmt);
        for (id, bin, last4) in cards {
            let n = self.get_consecutive_declines(id).unwrap_or(0);
            if n >= ALERT_THRESHOLD && n < decline_threshold {
                hints.push(serde_json::json!({
                    "kind": "card_burning", "card_id": id, "bin": bin,
                    "last4": last4, "declines": n, "threshold": decline_threshold,
                }));
            }
        }

        // «N неуспешных заказов подряд»: последние заказы, пока не встретится delivered
        let streak: u32 = {
            let mut s = self.conn.prepare(
                "SELECT status FROM orders ORDER BY created_at DESC, id DESC LIMIT 20"
            ).map_err(|e| e.to_string())?;
            let statuses: Vec<String> = s.query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            let mut n = 0u32;
            for st in statuses {
                if st == "declined" || st == "failed" { n += 1; } else if st == "delivered" { break; }
            }
            n
        };
        if streak >= STREAK_THRESHOLD {
            hints.push(serde_json::json!({ "kind": "order_fail_streak", "count": streak }));
        }

        Ok(hints)
    }

    /// PHASE 6: Авто-архивация карт с множественными consecutive declines
    pub fn auto_archive_risky_cards(&self, decline_threshold: u32) -> Result<u32, String> {
        // Получаем все карты со статусом in_use
        let mut stmt = self.conn.prepare("
            SELECT id FROM credit_cards WHERE status = 'in_use'
        ").map_err(|e| e.to_string())?;

        let card_ids: Vec<i64> = stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut archived = 0u32;

        for card_id in card_ids {
            let consecutive_declines = self.get_consecutive_declines(card_id)?;

            if consecutive_declines >= decline_threshold {
                // Проверяем что нет pending заказов
                let has_pending: i64 = self.conn.query_row(
                    "SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id = p.id
                     WHERE p.card_id = ?1 AND o.status = 'pending'",
                    params![card_id],
                    |r| r.get(0),
                ).unwrap_or(0);

                if has_pending > 0 {
                    continue; // Не архивируем если есть pending заказы
                }

                // Архивируем карту
                self.conn.execute(
                    "UPDATE credit_cards SET status = 'archive' WHERE id = ?1",
                    params![card_id],
                ).map_err(|e| e.to_string())?;

                // Логируем событие
                self.log_event(
                    "automation.card_archived",
                    &format!("Card {} archived ({} consecutive declines)", card_id, consecutive_declines),
                    Some("automation"),
                    Some(&card_id.to_string()),
                )?;

                archived += 1;
            }
        }

        Ok(archived)
    }

    /// PHASE 6: Получение рекомендаций для замены burned карты
    pub fn get_card_replacement_suggestions(
        &self,
        burned_card_id: i64,
        shop_id: i64
    ) -> Result<Vec<crate::models::CardSuggestion>, String> {
        // Получаем информацию о burned карте для matching
        let burned_card_info: Option<(Option<String>, Option<String>, Option<String>)> = self.conn.query_row(
            "SELECT bank_name, card_type, country FROM credit_cards WHERE id = ?1",
            params![burned_card_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).ok();

        let (bank_name, card_type, country) = burned_card_info.unwrap_or((None, None, None));

        // Находим free карты которые НЕ использовались на этом магазине
        let mut stmt = self.conn.prepare("
            SELECT c.id, c.last4, c.bank_name, c.card_type, c.country,
                   CASE
                       WHEN ?2 != '' AND c.bank_name = ?2 THEN 30
                       ELSE 0
                   END +
                   CASE
                       WHEN ?3 != '' AND c.card_type = ?3 THEN 20
                       ELSE 0
                   END +
                   CASE
                       WHEN ?4 != '' AND c.country = ?4 THEN 20
                       ELSE 0
                   END as match_score
            FROM credit_cards c
            WHERE c.status = 'free'
              AND c.id NOT IN (
                  SELECT p.card_id FROM orders o
                  JOIN profiles p ON o.profile_id = p.id
                  WHERE o.shop_id = ?1
              )
            ORDER BY match_score DESC, c.created_at DESC
            LIMIT 5
        ").map_err(|e| e.to_string())?;

        let suggestions = stmt.query_map(params![
            shop_id,
            bank_name.as_ref().unwrap_or(&String::new()),
            card_type.as_ref().unwrap_or(&String::new()),
            country.as_ref().unwrap_or(&String::new()),
        ], |row| {
            Ok(crate::models::CardSuggestion {
                card_id: row.get(0)?,
                last4: row.get(1)?,
                bank_name: row.get(2)?,
                card_type: row.get(3)?,
                country: row.get(4)?,
                match_score: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?
          .filter_map(|r| r.ok())
          .collect();

        Ok(suggestions)
    }

}
