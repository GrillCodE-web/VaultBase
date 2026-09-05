impl Database {
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

    // P2-DOMAIN: Statistics by domain
    pub fn get_by_domain(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<Vec<DomainStats>, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let os_where = if date_and.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", date_and)
        };
        let sql = format!(
            "WITH os AS (\
             SELECT cc.domain as cid,COUNT(*) as to_,\
             SUM(CASE WHEN o.status IN('shipped','delivered')THEN 1 ELSE 0 END) as sh,\
             SUM(COALESCE(o.total_amount,0)) as re\
             FROM orders o JOIN profiles p ON p.id=o.profile_id {} GROUP BY cc.domain),\
             cs AS (SELECT domain,id,\
             CASE WHEN status='free' THEN 1 ELSE 0 END as is_free,\
             CASE WHEN status='dead' THEN 1 ELSE 0 END as is_dead,\
             CASE WHEN acquired_at IS NOT NULL AND julianday('now') - julianday(acquired_at) < 14 THEN 1 ELSE 0 END as is_quarantined\
             FROM credit_cards WHERE domain IS NOT NULL AND domain != '')\
             SELECT cs.domain,COUNT(*) as tc,\
             SUM(cs.is_free) as fc,SUM(cs.is_dead) as dc,SUM(cs.is_quarantined) as qc,\
             COALESCE(SUM(os.to_),0),COALESCE(SUM(os.re),0.0),\
             CASE WHEN COALESCE(SUM(os.to_),0)=0 THEN 0.0 ELSE\
             CAST(COALESCE(SUM(os.sh),0) AS REAL)*100/CAST(COALESCE(SUM(os.to_),0) AS REAL) END\
             FROM cs LEFT JOIN os ON os.cid=cs.domain\
             GROUP BY cs.domain ORDER BY COALESCE(SUM(os.to_),0) DESC LIMIT 20",
            os_where
        );
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(DomainStats {
                domain:           r.get::<_,Option<String>>(0)?.unwrap_or_else(|| "—".into()),
                total_cards:      r.get(1)?,
                free_cards:       r.get(2)?,
                dead_cards:       r.get(3)?,
                quarantined_cards: r.get(4)?,
                total_orders:     r.get(5)?,
                revenue:          r.get::<_,f64>(6).unwrap_or(0.0),
                success_rate:     r.get::<_,f64>(7).unwrap_or(0.0),
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

        let mut csv = String::from("VaultBase Dashboard Export\r\n\r\n");
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
             FROM credit_cards c
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
            // REDESIGN-05-5B4: бейдж чата — тот же COUNT, что chat_unread_count.
            unread_chat: self.conn.query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE direction='in' AND read_at IS NULL",
                [], |r| r.get(0),
            ).unwrap_or(0),
            unsynced_footprints,
        })
    }

    /// MGR-022: SLA-таймеры из order_status_history (MGR-014).
    /// Средние часы переходов по заказам, СОЗДАННЫМ в периоде; заказы без
    /// истории (до миграции v21) не участвуют — AVG игнорирует NULL.
    /// pending_aging — мгновенный срез текущих pending (без привязки к периоду).
    pub fn get_sla_stats(&self, period: &str, from: Option<&str>, to: Option<&str>) -> Result<SlaStats, String> {
        let (start, end) = period_dates(period, from, to);
        let (date_and, p_strs) = date_and_clause(&start, &end, "o.created_at");
        let extra = if date_and.is_empty() { String::new() } else { format!(" AND {}", date_and) };
        let p_refs: Vec<&dyn rusqlite::ToSql> = p_strs.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

        let sql = format!(
            "WITH t AS ( \
               SELECT order_id, \
                 MIN(CASE WHEN to_status='shipped'   THEN created_at END) AS shipped_at, \
                 MIN(CASE WHEN to_status='delivered' THEN created_at END) AS delivered_at, \
                 MIN(CASE WHEN to_status='declined'  THEN created_at END) AS declined_at \
               FROM order_status_history GROUP BY order_id \
             ) \
             SELECT \
               AVG((julianday(t.shipped_at)   - julianday(o.created_at)) * 24.0), \
               AVG((julianday(t.delivered_at) - julianday(t.shipped_at)) * 24.0), \
               AVG((julianday(t.delivered_at) - julianday(o.created_at)) * 24.0), \
               AVG((julianday(t.declined_at)  - julianday(o.created_at)) * 24.0), \
               COUNT(t.shipped_at), COUNT(t.delivered_at), COUNT(t.declined_at) \
             FROM orders o JOIN t ON t.order_id = o.id \
             WHERE 1=1{}",
            extra
        );
        let round1 = |v: Option<f64>| v.map(|x| (x * 10.0).round() / 10.0);
        type AvgRow = (Option<f64>, Option<f64>, Option<f64>, Option<f64>, i64, i64, i64);
        let (a_ps, a_sd, a_cd, a_cdec, n_ship, n_del, n_dec): AvgRow = self.conn.query_row(&sql, p_refs.as_slice(), |r| Ok((
            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
            r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, i64>(6)?,
        ))).map_err(|e| e.to_string())?;

        let aging: (i64, i64, i64, i64, Option<f64>) = self.conn.query_row(
            "WITH p AS ( \
               SELECT (julianday('now') - julianday(created_at)) * 24.0 AS h \
               FROM orders WHERE status='pending' \
             ) \
             SELECT \
               COALESCE(SUM(CASE WHEN h < 24 THEN 1 ELSE 0 END), 0), \
               COALESCE(SUM(CASE WHEN h >= 24 AND h < 72 THEN 1 ELSE 0 END), 0), \
               COALESCE(SUM(CASE WHEN h >= 72 AND h < 168 THEN 1 ELSE 0 END), 0), \
               COALESCE(SUM(CASE WHEN h >= 168 THEN 1 ELSE 0 END), 0), \
               MAX(h) FROM p",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ).map_err(|e| e.to_string())?;

        let shop_sql = format!(
            "WITH t AS ( \
               SELECT order_id, \
                 MIN(CASE WHEN to_status='delivered' THEN created_at END) AS delivered_at \
               FROM order_status_history GROUP BY order_id \
             ) \
             SELECT s.domain, COUNT(*), \
               AVG((julianday(t.delivered_at) - julianday(o.created_at)) * 24.0) \
             FROM orders o JOIN shops s ON s.id = o.shop_id JOIN t ON t.order_id = o.id \
             WHERE 1=1{} \
             GROUP BY s.domain ORDER BY 2 DESC LIMIT 10",
            extra
        );
        let mut stmt = self.conn.prepare(&shop_sql).map_err(|e| e.to_string())?;
        let by_shop = stmt.query_map(p_refs.as_slice(), |r| {
            Ok(SlaShop {
                shop: r.get(0)?,
                orders: r.get(1)?,
                avg_hours_to_delivered: round1(r.get::<_, Option<f64>>(2)?),
            })
        }).map_err(|e| e.to_string())?
          .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;

        Ok(SlaStats {
            avg_hours_pending_to_shipped: round1(a_ps),
            avg_hours_shipped_to_delivered: round1(a_sd),
            avg_hours_created_to_delivered: round1(a_cd),
            avg_hours_created_to_declined: round1(a_cdec),
            orders_shipped: n_ship,
            orders_delivered: n_del,
            orders_declined: n_dec,
            pending_aging: SlaAging {
                lt24h: aging.0, d1_3: aging.1, d3_7: aging.2, gt7d: aging.3,
                oldest_hours: aging.4.map(|x| (x * 10.0).round() / 10.0).unwrap_or(0.0),
            },
            by_shop,
        })
    }
}