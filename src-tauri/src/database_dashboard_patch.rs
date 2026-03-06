// ============================================================
// PATCH — append these methods inside `impl Database` in
// src-tauri/src/database.rs
// ============================================================

// ── Helpers ──────────────────────────────────────────────────

/// Returns (from_ts, to_ts, prev_from_ts, prev_to_ts) as ISO-8601 strings
/// suitable for SQLite's datetime() comparisons.
fn period_bounds(
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> (String, String, String, String) {
    use chrono::{Duration, Local, NaiveDate, NaiveDateTime, TimeZone};

    let now = Local::now().naive_local();
    let today_start = now.date().and_hms_opt(0, 0, 0).unwrap();

    let (cur_from, cur_to) = match period {
        "today" => (today_start, now),
        "7d" => (now - Duration::days(7), now),
        "30d" => (now - Duration::days(30), now),
        "custom" => {
            let f = from
                .and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d").ok()
                    .map(|d| d.and_hms_opt(0, 0, 0).unwrap()))
                .unwrap_or(now - Duration::days(30));
            let t = to
                .and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d").ok()
                    .map(|d| d.and_hms_opt(23, 59, 59).unwrap()))
                .unwrap_or(now);
            (f, t)
        }
        _ => (NaiveDateTime::from_timestamp_opt(0, 0).unwrap(), now), // "all"
    };

    let span = cur_to - cur_from;
    let prev_from = cur_from - span;
    let prev_to = cur_from;

    let fmt = "%Y-%m-%d %H:%M:%S";
    (
        cur_from.format(fmt).to_string(),
        cur_to.format(fmt).to_string(),
        prev_from.format(fmt).to_string(),
        prev_to.format(fmt).to_string(),
    )
}

fn trend_pct(current: f64, previous: f64) -> f64 {
    if previous == 0.0 {
        if current > 0.0 { 100.0 } else { 0.0 }
    } else {
        ((current - previous) / previous) * 100.0
    }
}

// ── get_dashboard_stats ──────────────────────────────────────

pub fn get_dashboard_stats(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<crate::models::DashboardStats, String> {
    use crate::models::{Alert, DashboardStats};

    let conn = &self.conn;
    let (f, t, pf, pt) = period_bounds(period, from, to);

    // ── Row 1: static CC counts ──────────────────────────────
    let total_cc: i64 = conn
        .query_row("SELECT COUNT(*) FROM credit_cards", [], |r| r.get(0))
        .unwrap_or(0);
    let free_cc: i64 = conn
        .query_row("SELECT COUNT(*) FROM credit_cards WHERE status='free'", [], |r| r.get(0))
        .unwrap_or(0);
    let in_use_cc: i64 = conn
        .query_row("SELECT COUNT(*) FROM credit_cards WHERE status='in_use'", [], |r| r.get(0))
        .unwrap_or(0);
    let dead_cc: i64 = conn
        .query_row("SELECT COUNT(*) FROM credit_cards WHERE status='dead'", [], |r| r.get(0))
        .unwrap_or(0);
    let total_profiles: i64 = conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))
        .unwrap_or(0);
    let no_drop_profiles: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM profiles p WHERE NOT EXISTS \
             (SELECT 1 FROM drops d WHERE d.profile_id=p.id)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // ── Row 2: period-scoped order metrics ───────────────────
    let (total_orders, pending, shipped, delivered, declined, revenue, net_profit): (
        i64, i64, i64, i64, i64, f64, f64,
    ) = conn
        .query_row(
            "SELECT
               COUNT(*),
               SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='shipped'   THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='declined'  THEN 1 ELSE 0 END),
               COALESCE(SUM(total_price), 0.0),
               COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END), 0.0)
             FROM orders
             WHERE created_at >= ? AND created_at <= ?",
            rusqlite::params![f, t],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .unwrap_or((0, 0, 0, 0, 0, 0.0, 0.0));

    // ── Trends vs previous period ────────────────────────────
    let (prev_orders, prev_revenue, prev_delivered): (i64, f64, i64) = conn
        .query_row(
            "SELECT COUNT(*),
               COALESCE(SUM(total_price),0.0),
               SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END)
             FROM orders WHERE created_at >= ? AND created_at <= ?",
            rusqlite::params![pf, pt],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0, 0.0, 0));

    let orders_trend = trend_pct(total_orders as f64, prev_orders as f64);
    let revenue_trend = trend_pct(revenue, prev_revenue);
    let delivered_trend = trend_pct(delivered as f64, prev_delivered as f64);

    // ── Alerts ───────────────────────────────────────────────
    let mut alerts: Vec<Alert> = Vec::new();

    // 1. Orders pending > 5 days
    let stale_pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orders WHERE status='pending' \
             AND julianday('now') - julianday(created_at) > 5",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if stale_pending > 0 {
        alerts.push(Alert {
            level: "warn".into(),
            message: format!("{} order(s) pending for more than 5 days", stale_pending),
            action: "orders".into(),
            count: stale_pending,
        });
    }

    // 2. Cards expiring < 30 days with active profile
    let expiring_with_profile: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT cc.id) FROM credit_cards cc
             JOIN profiles p ON p.card_id = cc.id
             WHERE cc.status != 'dead'
               AND cc.expiry_month IS NOT NULL
               AND (
                 CAST(cc.expiry_year AS INTEGER) * 100 + CAST(cc.expiry_month AS INTEGER)
               ) <= (
                 CAST(strftime('%Y','now','start of month','+30 days') AS INTEGER) * 100
                 + CAST(strftime('%m','now','start of month','+30 days') AS INTEGER)
               )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if expiring_with_profile > 0 {
        alerts.push(Alert {
            level: "warn".into(),
            message: format!("{} card(s) expiring within 30 days (active profiles)", expiring_with_profile),
            action: "cards".into(),
            count: expiring_with_profile,
        });
    }

    // 3. Profiles without drop
    if no_drop_profiles > 0 {
        alerts.push(Alert {
            level: "warn".into(),
            message: format!("{} profile(s) have no drop address", no_drop_profiles),
            action: "profiles".into(),
            count: no_drop_profiles,
        });
    }

    // 4. BIN declined ≥ 3 times at same shop
    let bin_declined: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM (
               SELECT cc.bin, o.shop_id, COUNT(*) as cnt
               FROM orders o
               JOIN credit_cards cc ON cc.id = o.card_id
               WHERE o.status = 'declined'
               GROUP BY cc.bin, o.shop_id
               HAVING cnt >= 3
             )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if bin_declined > 0 {
        alerts.push(Alert {
            level: "error".into(),
            message: format!("{} BIN(s) declined ≥3 times at the same shop", bin_declined),
            action: "orders".into(),
            count: bin_declined,
        });
    }

    Ok(DashboardStats {
        total_cc,
        free_cc,
        in_use_cc,
        dead_cc,
        total_profiles,
        no_drop_profiles,
        total_orders,
        pending,
        shipped,
        delivered,
        declined,
        revenue,
        net_profit,
        orders_trend,
        revenue_trend,
        delivered_trend,
        alerts,
    })
}

// ── get_revenue_chart ────────────────────────────────────────

pub fn get_revenue_chart(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<crate::models::RevenuePoint>, String> {
    use crate::models::RevenuePoint;

    let (f, t, _, _) = period_bounds(period, from, to);

    let (group_expr, label_expr) = if period == "today" {
        (
            "strftime('%H', created_at)",
            "strftime('%H:00', created_at)",
        )
    } else {
        (
            "strftime('%Y-%m-%d', created_at)",
            "strftime('%Y-%m-%d', created_at)",
        )
    };

    let sql = format!(
        "SELECT {label}, COALESCE(SUM(total_price),0),
                COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0)
         FROM orders
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY {group}
         ORDER BY {group}",
        label = label_expr,
        group = group_expr
    );

    let mut stmt = self
        .conn
        .prepare(&sql)
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![f, t], |r| {
            Ok(RevenuePoint {
                date: r.get(0)?,
                revenue: r.get(1)?,
                profit: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// ── get_heatmap_data ─────────────────────────────────────────

pub fn get_heatmap_data(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<crate::models::HeatmapCell>, String> {
    use crate::models::HeatmapCell;

    let (f, t, _, _) = period_bounds(period, from, to);

    let sql = "
        SELECT
          COALESCE(cc.bank_name, 'Unknown') as bank,
          COALESCE(s.name, 'Unknown') as shop,
          COUNT(*) as total,
          SUM(CASE WHEN o.status IN ('shipped','delivered') THEN 1 ELSE 0 END) as shipped
        FROM orders o
        JOIN credit_cards cc ON cc.id = o.card_id
        JOIN shops s ON s.id = o.shop_id
        WHERE o.created_at >= ? AND o.created_at <= ?
        GROUP BY cc.bank_name, s.id
        HAVING total >= 3
        ORDER BY total DESC
        LIMIT 64
    ";

    let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![f, t], |r| {
            let total: i64 = r.get(2)?;
            let shipped: i64 = r.get(3)?;
            let success_rate = if total > 0 { shipped as f64 / total as f64 * 100.0 } else { 0.0 };
            Ok(HeatmapCell {
                bank: r.get(0)?,
                shop: r.get(1)?,
                total,
                shipped,
                success_rate,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// ── get_top_banks ────────────────────────────────────────────

pub fn get_top_banks(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<crate::models::BankStats>, String> {
    use crate::models::BankStats;
    let (f, t, _, _) = period_bounds(period, from, to);

    let sql = "
        SELECT
          COALESCE(cc.bank_name,'Unknown') as bank,
          COUNT(DISTINCT cc.id) as total_cards,
          SUM(CASE WHEN cc.status='free'  THEN 1 ELSE 0 END) as free_cards,
          SUM(CASE WHEN cc.status='dead'  THEN 1 ELSE 0 END) as dead_cards,
          COUNT(o.id) as total_orders,
          SUM(CASE WHEN o.status='shipped'   THEN 1 ELSE 0 END) as shipped,
          SUM(CASE WHEN o.status='declined'  THEN 1 ELSE 0 END) as declined,
          COALESCE(SUM(o.total_price), 0.0) as revenue
        FROM credit_cards cc
        LEFT JOIN orders o ON o.card_id = cc.id
          AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY cc.bank_name
        ORDER BY total_orders DESC
        LIMIT 20
    ";

    let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![f, t], |r| {
            let total_orders: i64 = r.get(4)?;
            let shipped: i64 = r.get(5)?;
            let success_rate = if total_orders > 0 { shipped as f64 / total_orders as f64 * 100.0 } else { 0.0 };
            Ok(BankStats {
                bank_name: r.get(0)?,
                total_cards: r.get(1)?,
                free_cards: r.get(2)?,
                dead_cards: r.get(3)?,
                total_orders,
                shipped,
                declined: r.get(6)?,
                revenue: r.get(7)?,
                success_rate,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// ── get_by_country ───────────────────────────────────────────

pub fn get_by_country(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<crate::models::CountryStats>, String> {
    use crate::models::CountryStats;
    let (f, t, _, _) = period_bounds(period, from, to);

    let sql = "
        SELECT
          COALESCE(cc.country,'Unknown') as country,
          COUNT(DISTINCT cc.id) as total_cards,
          SUM(CASE WHEN cc.status='free' THEN 1 ELSE 0 END) as free_cards,
          COUNT(o.id) as total_orders,
          COALESCE(SUM(o.total_price), 0.0) as revenue,
          SUM(CASE WHEN o.status IN ('shipped','delivered') THEN 1 ELSE 0 END) as success
        FROM credit_cards cc
        LEFT JOIN orders o ON o.card_id = cc.id
          AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY cc.country
        ORDER BY total_orders DESC
        LIMIT 20
    ";

    let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![f, t], |r| {
            let total_orders: i64 = r.get(3)?;
            let success: i64 = r.get(5)?;
            let success_rate = if total_orders > 0 { success as f64 / total_orders as f64 * 100.0 } else { 0.0 };
            Ok(CountryStats {
                country: r.get(0)?,
                total_cards: r.get(1)?,
                free_cards: r.get(2)?,
                total_orders,
                revenue: r.get(4)?,
                success_rate,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// ── get_by_source ────────────────────────────────────────────

pub fn get_by_source(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Vec<crate::models::SourceStats>, String> {
    use crate::models::SourceStats;
    let (f, t, _, _) = period_bounds(period, from, to);

    let sql = "
        SELECT
          COALESCE(cc.source,'Unknown') as source,
          COUNT(DISTINCT cc.id) as total_cards,
          SUM(CASE WHEN cc.status='free' THEN 1 ELSE 0 END) as free_cards,
          SUM(CASE WHEN cc.status='dead' THEN 1 ELSE 0 END) as dead_cards,
          COUNT(o.id) as total_orders,
          COALESCE(SUM(o.total_price), 0.0) as revenue,
          SUM(CASE WHEN o.status IN ('shipped','delivered') THEN 1 ELSE 0 END) as success
        FROM credit_cards cc
        LEFT JOIN orders o ON o.card_id = cc.id
          AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY cc.source
        ORDER BY total_orders DESC
        LIMIT 20
    ";

    let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![f, t], |r| {
            let total_orders: i64 = r.get(4)?;
            let success: i64 = r.get(6)?;
            let success_rate = if total_orders > 0 { success as f64 / total_orders as f64 * 100.0 } else { 0.0 };
            Ok(SourceStats {
                source: r.get(0)?,
                total_cards: r.get(1)?,
                free_cards: r.get(2)?,
                dead_cards: r.get(3)?,
                total_orders,
                revenue: r.get(5)?,
                success_rate,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// ── get_expiring_cards ───────────────────────────────────────

pub fn get_expiring_cards(
    &self,
    days: u32,
) -> Result<Vec<crate::models::ExpiringCard>, String> {
    use crate::models::ExpiringCard;

    let sql = format!(
        "SELECT cc.id, cc.last4,
                COALESCE(cc.holder_name, ''),
                COALESCE(cc.expiry_month, ''), COALESCE(cc.expiry_year, ''),
                p.id as profile_id
         FROM credit_cards cc
         LEFT JOIN profiles p ON p.card_id = cc.id
         WHERE cc.status != 'dead'
           AND cc.expiry_month IS NOT NULL
           AND cc.expiry_year IS NOT NULL
           AND (
             CAST(cc.expiry_year AS INTEGER) * 100 + CAST(cc.expiry_month AS INTEGER)
           ) <= (
             CAST(strftime('%Y','now','start of month','+{days} days') AS INTEGER) * 100
             + CAST(strftime('%m','now','start of month','+{days} days') AS INTEGER)
           )
         ORDER BY cc.expiry_year, cc.expiry_month
         LIMIT 50",
        days = days
    );

    let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;

    let enc_ref = self.encryption();
    let rows = stmt
        .query_map([], |r| {
            let holder_enc: String = r.get(2)?;
            let exp_month: String = r.get(3)?;
            let exp_year: String = r.get(4)?;
            let profile_id: Option<String> = r.get(5)?;
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, holder_enc, exp_month, exp_year, profile_id))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(id, last4, holder_enc, exp_month, exp_year, profile_id)| {
            // Decrypt + mask holder name
            let holder_plain = enc_ref.as_ref()
                .and_then(|e| e.decrypt(&holder_enc).ok())
                .unwrap_or_default();
            let holder_masked = if holder_plain.is_empty() {
                "Unknown".to_string()
            } else {
                let parts: Vec<&str> = holder_plain.split_whitespace().collect();
                match parts.as_slice() {
                    [first, rest @ ..] => {
                        let last_initial = rest.last().map(|s| &s[..1]).unwrap_or("");
                        format!("{} {}.", first, last_initial)
                    }
                    _ => holder_plain.clone(),
                }
            };

            // Calculate days left
            let days_left = {
                use chrono::Local;
                let now = Local::now().naive_local().date();
                let m: u32 = exp_month.parse().unwrap_or(12);
                let y: i32 = exp_year.parse().unwrap_or(9999);
                let expiry = chrono::NaiveDate::from_ymd_opt(y, m, 1)
                    .and_then(|d| d.with_day(28))
                    .unwrap_or(now);
                (expiry - now).num_days()
            };

            ExpiringCard {
                id,
                last4,
                holder_name: holder_masked,
                expiry_date: format!("{}/{}", exp_month, exp_year),
                days_left,
                has_profile: profile_id.is_some(),
                profile_id,
            }
        })
        .collect();

    Ok(rows)
}

// ── get_sidebar_badges ───────────────────────────────────────

pub fn get_sidebar_badges(&self) -> Result<crate::models::SidebarBadges, String> {
    use crate::models::SidebarBadges;

    let pending_orders: i64 = self.conn
        .query_row("SELECT COUNT(*) FROM orders WHERE status='pending'", [], |r| r.get(0))
        .unwrap_or(0);

    let expiring_cards: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM credit_cards WHERE status != 'dead'
             AND expiry_month IS NOT NULL
             AND (CAST(expiry_year AS INTEGER)*100 + CAST(expiry_month AS INTEGER))
             <= (CAST(strftime('%Y','now','start of month','+30 days') AS INTEGER)*100
                 + CAST(strftime('%m','now','start of month','+30 days') AS INTEGER))",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let no_drop_profiles: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM profiles p WHERE NOT EXISTS \
             (SELECT 1 FROM drops d WHERE d.profile_id=p.id)",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let clean_emails: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM email_pool WHERE is_blocked=0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let unsynced_footprints: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM shop_footprints WHERE synced=0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(SidebarBadges {
        pending_orders,
        expiring_cards,
        no_drop_profiles,
        clean_emails,
        unread_imap: 0, // stub
        unsynced_footprints,
    })
}

// ── export_dashboard_csv ─────────────────────────────────────

pub fn export_dashboard_csv(
    &self,
    period: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<String, String> {
    let stats = self.get_dashboard_stats(period, from, to)?;
    let banks = self.get_top_banks(period, from, to)?;
    let countries = self.get_by_country(period, from, to)?;

    let mut csv = String::new();

    // Summary
    csv.push_str("=== SUMMARY ===\r\n");
    csv.push_str("Metric,Value\r\n");
    csv.push_str(&format!("Total CC,{}\r\n", stats.total_cc));
    csv.push_str(&format!("Free CC,{}\r\n", stats.free_cc));
    csv.push_str(&format!("Total Orders,{}\r\n", stats.total_orders));
    csv.push_str(&format!("Delivered,{}\r\n", stats.delivered));
    csv.push_str(&format!("Revenue,${:.2}\r\n", stats.revenue));
    csv.push_str(&format!("Net Profit,${:.2}\r\n", stats.net_profit));
    csv.push_str("\r\n");

    // Banks
    csv.push_str("=== TOP BANKS ===\r\n");
    csv.push_str("Bank,Cards,Free,Dead,Orders,Shipped,Declined,Revenue,Success%\r\n");
    for b in &banks {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{:.2},{:.1}%\r\n",
            b.bank_name, b.total_cards, b.free_cards, b.dead_cards,
            b.total_orders, b.shipped, b.declined, b.revenue, b.success_rate
        ));
    }
    csv.push_str("\r\n");

    // Countries
    csv.push_str("=== BY COUNTRY ===\r\n");
    csv.push_str("Country,Cards,Free,Orders,Revenue,Success%\r\n");
    for c in &countries {
        csv.push_str(&format!(
            "{},{},{},{},{:.2},{:.1}%\r\n",
            c.country, c.total_cards, c.free_cards,
            c.total_orders, c.revenue, c.success_rate
        ));
    }

    Ok(csv)
}
