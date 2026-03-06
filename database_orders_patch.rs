// ============================================================
// PATCH: database.rs — Orders + Footprints + Risk Check
// Append inside impl Database { ... }
// ============================================================

use crate::models::{
    OrderInput, Order, PaginatedOrders, OrderFilter, StatusMeta,
    RiskCheckResult, RiskWarning, OrderTemplate, SaveTemplateInput,
};
use crate::encryption::hash_value;

// ─── helpers ──────────────────────────────────────────────────

fn items_total(items_json: &str) -> f64 {
    #[derive(serde::Deserialize)]
    struct Item { qty: i64, price: f64 }
    serde_json::from_str::<Vec<Item>>(items_json)
        .map(|v| v.iter().map(|i| i.qty as f64 * i.price).sum())
        .unwrap_or(0.0)
}

// ─── create_order ─────────────────────────────────────────────

pub fn create_order(&self, input: OrderInput) -> Result<Order, String> {
    if input.profile_id.is_empty() { return Err("profile_required".into()); }
    if input.shop_id == 0 { return Err("shop_required".into()); }
    if input.drop_id == 0 { return Err("drop_required".into()); }

    let now = Utc::now().to_rfc3339();
    let items_json = serde_json::to_string(&input.items).unwrap_or_default();
    let total = items_total(&items_json);
    let total_opt = if total > 0.0 { Some(total) } else { None };

    self.conn.execute(
        "INSERT INTO orders
         (profile_id, shop_id, drop_id, email_pool_id, proxy_id,
          order_number, status, total_amount, notes, items_json,
          created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8,?9,?10,?10)",
        params![
            input.profile_id,
            input.shop_id,
            input.drop_id,
            input.email_pool_id,
            input.proxy_id,
            input.order_number,
            total_opt,
            input.notes,
            items_json,
            now
        ],
    ).map_err(|e| e.to_string())?;

    let order_id = self.conn.last_insert_rowid();

    // ── Record footprint ──────────────────────────────────────
    self.record_footprint(order_id, &input)?;

    self.log_event("order.created", Some(&format!("order_id={}", order_id)))?;
    self.get_order_by_id(order_id)
}

fn record_footprint(&self, order_id: i64, input: &OrderInput) -> Result<(), String> {
    // shop_domain
    let shop_domain: String = self.conn.query_row(
        "SELECT domain FROM shops WHERE id = ?1", params![input.shop_id],
        |r| r.get(0),
    ).map_err(|_| "shop_not_found".to_string())?;

    // email_hash
    let email_hash: Option<String> = if let Some(eid) = input.email_pool_id {
        let enc = self.encryption.as_ref().ok_or("locked")?;
        let email_enc: String = self.conn.query_row(
            "SELECT email FROM email_pool WHERE id = ?1", params![eid], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let email = enc.decrypt(&email_enc).ok();
        email.map(|e| hash_value(&e))
    } else { None };

    // ip_hash
    let ip_hash: Option<String> = if let Some(pid) = input.proxy_id {
        let (host, port): (String, i64) = self.conn.query_row(
            "SELECT host, port FROM proxies WHERE id = ?1", params![pid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|e| e.to_string())?;
        Some(hash_value(&format!("{}:{}", host, port)))
    } else { None };

    // drop_hash (address without name)
    let (addr, city, state, zip, country, recipient_name, phone_raw): (String, String, Option<String>, String, String, String, Option<String>) =
        self.conn.query_row(
            "SELECT address, city, state, zip, country, recipient_name, phone FROM drops WHERE id = ?1",
            params![input.drop_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        ).map_err(|e| e.to_string())?;

    let drop_raw = format!("{}{}{}{}{}", addr, city, state.as_deref().unwrap_or(""), zip, country);
    let drop_hash = hash_value(&drop_raw);
    let name_hash = hash_value(&recipient_name);

    // bin from card via profile
    let enc = self.encryption.as_ref().ok_or("locked")?;
    let (card_number_enc, phone_enc): (String, Option<String>) = self.conn.query_row(
        "SELECT cc.card_number, cc.phone FROM profiles p JOIN credit_cards cc ON cc.id = p.card_id WHERE p.id = ?1",
        params![input.profile_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let card_number = enc.decrypt(&card_number_enc).unwrap_or_default();
    let bin: Option<String> = if card_number.len() >= 6 { Some(card_number[..6].to_string()) } else { None };

    let phone_hash: Option<String> = phone_enc
        .as_deref()
        .and_then(|p| enc.decrypt(p).ok())
        .filter(|p| !p.is_empty())
        .map(|p| hash_value(&p));

    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "INSERT INTO shop_footprints
         (shop_id, order_id, shop_domain, email_id, ip_hash, drop_hash,
          bin, phone_hash, name_hash, email_hash, proxy_id, synced, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,?12)",
        params![
            input.shop_id,
            order_id,
            shop_domain,
            input.email_pool_id,
            ip_hash,
            drop_hash,
            bin,
            phone_hash,
            name_hash,
            email_hash,
            input.proxy_id,
            now
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ─── get_order_by_id ──────────────────────────────────────────

fn get_order_by_id(&self, id: i64) -> Result<Order, String> {
    let enc_opt = self.encryption.as_ref();

    let row = self.conn.query_row(
        "SELECT o.id, o.profile_id, o.shop_id, o.drop_id, o.email_pool_id, o.proxy_id,
                o.order_number, o.status, o.total_amount, o.tracking_number, o.carrier,
                o.notes, o.items_json, o.created_at, o.updated_at,
                s.name as shop_name,
                cc.holder_name as holder_enc, cc.last4, cc.bank_name,
                cc.expiry_date as exp_enc
         FROM orders o
         LEFT JOIN shops s ON s.id = o.shop_id
         LEFT JOIN profiles p ON p.id = o.profile_id
         LEFT JOIN credit_cards cc ON cc.id = p.card_id
         WHERE o.id = ?1",
        params![id],
        |r| {
            Ok((
                r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?, r.get::<_, Option<i64>>(4)?, r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?,
                r.get::<_, Option<f64>>(8)?, r.get::<_, Option<String>>(9)?,
                r.get::<_, Option<String>>(10)?, r.get::<_, Option<String>>(11)?,
                r.get::<_, Option<String>>(12)?, r.get::<_, String>(13)?, r.get::<_, String>(14)?,
                r.get::<_, Option<String>>(15)?, r.get::<_, Option<String>>(16)?,
                r.get::<_, Option<String>>(17)?, r.get::<_, Option<String>>(18)?,
                r.get::<_, Option<String>>(19)?,
            ))
        },
    ).map_err(|e| e.to_string())?;

    let (oid, profile_id, shop_id, drop_id, email_pool_id, proxy_id,
         order_number, status, total_amount, tracking_number, carrier,
         notes, items_json, created_at, updated_at,
         shop_name, holder_enc, last4, bank_name, exp_enc) = row;

    let holder_masked = holder_enc.as_deref()
        .and_then(|enc_val| enc_opt.and_then(|e| e.decrypt(enc_val).ok()))
        .map(|full| {
            let mut parts = full.splitn(2, ' ');
            let first = parts.next().unwrap_or("");
            let last_init = parts.next().and_then(|l| l.chars().next()).map(|c| format!(" {}.", c)).unwrap_or_default();
            format!("{}{}", first, last_init)
        });

    // card_expiring: exp < 30 days
    let card_expiring = exp_enc.as_deref()
        .and_then(|enc_val| enc_opt.and_then(|e| e.decrypt(enc_val).ok()))
        .and_then(|exp| {
            // Parse MM/YY or MM/YYYY
            let parts: Vec<&str> = exp.split('/').collect();
            if parts.len() == 2 {
                let month: u32 = parts[0].parse().ok()?;
                let year_raw: i32 = parts[1].parse().ok()?;
                let year = if year_raw < 100 { year_raw + 2000 } else { year_raw };
                let exp_date = chrono::NaiveDate::from_ymd_opt(year, month, 1)?.succ_opt()?;
                let days = (exp_date - Utc::now().naive_utc().date()).num_days();
                Some(days < 30)
            } else { None }
        })
        .unwrap_or(false);

    // pending_too_long
    let pending_too_long = status == "pending" && {
        chrono::DateTime::parse_from_rfc3339(&created_at)
            .map(|dt| (Utc::now() - dt.with_timezone(&Utc)).num_days() > 5)
            .unwrap_or(false)
    };

    // bin_declined_here
    let bin_declined_here: bool = {
        let card_number_enc_opt: Option<String> = self.conn.query_row(
            "SELECT cc.card_number FROM profiles p JOIN credit_cards cc ON cc.id = p.card_id WHERE p.id = ?1",
            params![profile_id],
            |r| r.get(0),
        ).ok();

        card_number_enc_opt
            .and_then(|enc_val| enc_opt.and_then(|e| e.decrypt(&enc_val).ok()))
            .and_then(|cn| if cn.len() >= 6 { Some(cn[..6].to_string()) } else { None })
            .map(|bin| {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM shop_footprints sf
                     JOIN orders o ON o.id = sf.order_id
                     WHERE sf.shop_id = ?1 AND sf.bin = ?2
                     AND o.status IN ('declined','cancelled')
                     AND o.id != ?3",
                    params![shop_id, bin, oid],
                    |r| r.get::<_, i64>(0),
                ).unwrap_or(0) > 0
            })
            .unwrap_or(false)
    };

    Ok(Order {
        id: oid, profile_id, shop_id, drop_id, email_pool_id, proxy_id,
        order_number, status, total_amount, tracking_number, carrier,
        notes, items_json,
        shop_name, holder_masked, last4, bank_name,
        pending_too_long, card_expiring, bin_declined_here,
        created_at, updated_at,
    })
}

// ─── get_orders ───────────────────────────────────────────────

pub fn get_orders(&self, filter: OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
    let offset = (page.saturating_sub(1)) * per_page;
    let mut conditions: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = filter.status {
        if !s.is_empty() {
            conditions.push(format!("o.status = ?{}", binds.len() + 1));
            binds.push(Box::new(s.clone()));
        }
    }
    if let Some(sid) = filter.shop_id {
        conditions.push(format!("o.shop_id = ?{}", binds.len() + 1));
        binds.push(Box::new(sid));
    }
    if let Some(ref df) = filter.date_from {
        conditions.push(format!("o.created_at >= ?{}", binds.len() + 1));
        binds.push(Box::new(df.clone()));
    }
    if let Some(ref dt) = filter.date_to {
        conditions.push(format!("o.created_at <= ?{}", binds.len() + 1));
        binds.push(Box::new(dt.clone()));
    }
    if let Some(ref q) = filter.search {
        if !q.is_empty() {
            let pat = format!("%{}%", q);
            conditions.push(format!("(o.order_number LIKE ?{0} OR cc.last4 LIKE ?{0})", binds.len() + 1));
            binds.push(Box::new(pat));
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total: u32 = {
        let sql = format!(
            "SELECT COUNT(*) FROM orders o
             LEFT JOIN profiles p ON p.id = o.profile_id
             LEFT JOIN credit_cards cc ON cc.id = p.card_id
             {}", where_clause
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        stmt.query_row(refs.as_slice(), |r| r.get(0)).map_err(|e| e.to_string())?
    };

    let sql = format!(
        "SELECT o.id FROM orders o
         LEFT JOIN profiles p ON p.id = o.profile_id
         LEFT JOIN credit_cards cc ON cc.id = p.card_id
         {}
         ORDER BY o.created_at DESC
         LIMIT ?{lim} OFFSET ?{off}",
        where_clause,
        lim = binds.len() + 1,
        off = binds.len() + 2
    );

    binds.push(Box::new(per_page as i64));
    binds.push(Box::new(offset as i64));

    let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
    let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();

    let ids: Vec<i64> = stmt.query_map(refs.as_slice(), |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let items: Vec<Order> = ids.iter()
        .filter_map(|id| self.get_order_by_id(*id).ok())
        .collect();

    Ok(PaginatedOrders {
        items,
        total,
        page,
        per_page,
        total_pages: ((total as f64) / (per_page as f64)).ceil() as u32,
    })
}

// ─── update_order_status ──────────────────────────────────────

pub fn update_order_status(&self, id: i64, status: &str, meta: Option<StatusMeta>) -> Result<(), String> {
    let old_status: String = self.conn.query_row(
        "SELECT status FROM orders WHERE id = ?1", params![id], |r| r.get(0),
    ).map_err(|_| "order_not_found".to_string())?;

    let now = Utc::now().to_rfc3339();

    if let Some(ref m) = meta {
        if status == "shipped" {
            self.conn.execute(
                "UPDATE orders SET status=?1, tracking_number=?2, carrier=?3, order_number=COALESCE(?4, order_number), updated_at=?5 WHERE id=?6",
                params![status, m.tracking_number, m.carrier, m.order_number, now, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE orders SET status=?1, updated_at=?2 WHERE id=?3",
                params![status, now, id],
            ).map_err(|e| e.to_string())?;
        }
    } else {
        self.conn.execute(
            "UPDATE orders SET status=?1, updated_at=?2 WHERE id=?3",
            params![status, now, id],
        ).map_err(|e| e.to_string())?;
    }

    self.log_event(
        "order.status_changed",
        Some(&format!("order_id={} {}→{}", id, old_status, status)),
    )
}

pub fn delete_order(&self, id: i64) -> Result<(), String> {
    self.conn.execute("DELETE FROM shop_footprints WHERE order_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.conn.execute("DELETE FROM orders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.log_event("order.deleted", Some(&format!("order_id={}", id)))
}

// ─── run_risk_check ───────────────────────────────────────────

pub fn run_risk_check(
    &self,
    profile_id: &str,
    shop_id: i64,
    drop_id: i64,
    email_pool_id: Option<i64>,
    proxy_id: Option<i64>,
) -> Result<RiskCheckResult, String> {
    let enc_opt = self.encryption.as_ref();
    let mut warnings: Vec<RiskWarning> = Vec::new();

    // ── email_hash ──
    if let (Some(eid), Some(enc)) = (email_pool_id, enc_opt) {
        let email_enc: Option<String> = self.conn.query_row(
            "SELECT email FROM email_pool WHERE id = ?1", params![eid], |r| r.get(0),
        ).ok();
        if let Some(enc_val) = email_enc {
            if let Ok(email) = enc.decrypt(&enc_val) {
                let ehash = hash_value(&email);
                let hit: Option<(i64, String)> = self.conn.query_row(
                    "SELECT o.id, o.status FROM shop_footprints sf
                     JOIN orders o ON o.id = sf.order_id
                     WHERE sf.shop_id = ?1 AND sf.email_hash = ?2
                     ORDER BY o.created_at DESC LIMIT 1",
                    params![shop_id, ehash],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                ).ok();
                if let Some((oid, ostatus)) = hit {
                    warnings.push(RiskWarning {
                        kind: "email".into(),
                        severity: "medium".into(),
                        message: format!("Email already used here (order #{}, {})", oid, ostatus),
                        related_order_id: Some(oid),
                        related_order_status: Some(ostatus),
                    });
                }
            }
        }
    }

    // ── ip_hash ──
    if let Some(pid) = proxy_id {
        let hp: Option<(String, i64)> = self.conn.query_row(
            "SELECT host, port FROM proxies WHERE id = ?1", params![pid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok();
        if let Some((host, port)) = hp {
            let ihash = hash_value(&format!("{}:{}", host, port));
            let hit: Option<(i64, String)> = self.conn.query_row(
                "SELECT o.id, o.status FROM shop_footprints sf
                 JOIN orders o ON o.id = sf.order_id
                 WHERE sf.shop_id = ?1 AND sf.ip_hash = ?2
                 ORDER BY o.created_at DESC LIMIT 1",
                params![shop_id, ihash],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).ok();
            if let Some((oid, ostatus)) = hit {
                warnings.push(RiskWarning {
                    kind: "ip".into(),
                    severity: "high".into(),
                    message: format!("Proxy IP already used here (order #{}, {})", oid, ostatus),
                    related_order_id: Some(oid),
                    related_order_status: Some(ostatus),
                });
            }
        }
    }

    // ── drop_hash ──
    let drop_data: Option<(String, String, Option<String>, String, String)> = self.conn.query_row(
        "SELECT address, city, state, zip, country FROM drops WHERE id = ?1",
        params![drop_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ).ok();
    if let Some((addr, city, state, zip, country)) = drop_data {
        let dhash = hash_value(&format!("{}{}{}{}{}", addr, city, state.as_deref().unwrap_or(""), zip, country));
        let hit: Option<(i64, String)> = self.conn.query_row(
            "SELECT o.id, o.status FROM shop_footprints sf
             JOIN orders o ON o.id = sf.order_id
             WHERE sf.shop_id = ?1 AND sf.drop_hash = ?2
             ORDER BY o.created_at DESC LIMIT 1",
            params![shop_id, dhash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok();
        if let Some((oid, ostatus)) = hit {
            warnings.push(RiskWarning {
                kind: "drop".into(),
                severity: "high".into(),
                message: format!("Shipping address already used here (order #{}, {})", oid, ostatus),
                related_order_id: Some(oid),
                related_order_status: Some(ostatus),
            });
        }
    }

    // ── BIN ──
    if let Some(enc) = enc_opt {
        let cn_enc: Option<String> = self.conn.query_row(
            "SELECT cc.card_number FROM profiles p JOIN credit_cards cc ON cc.id = p.card_id WHERE p.id = ?1",
            params![profile_id], |r| r.get(0),
        ).ok();
        if let Some(enc_val) = cn_enc {
            if let Ok(cn) = enc.decrypt(&enc_val) {
                if cn.len() >= 6 {
                    let bin = &cn[..6];
                    let hit: Option<(i64, String)> = self.conn.query_row(
                        "SELECT o.id, o.status FROM shop_footprints sf
                         JOIN orders o ON o.id = sf.order_id
                         WHERE sf.shop_id = ?1 AND sf.bin = ?2
                         AND o.status IN ('declined','cancelled')
                         ORDER BY o.created_at DESC LIMIT 1",
                        params![shop_id, bin],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    ).ok();
                    if let Some((oid, ostatus)) = hit {
                        warnings.push(RiskWarning {
                            kind: "bin".into(),
                            severity: "medium".into(),
                            message: format!("This BIN was declined here before (order #{}, {})", oid, ostatus),
                            related_order_id: Some(oid),
                            related_order_status: Some(ostatus),
                        });
                    }
                }
            }
        }
    }

    let score = warnings.len() as u32;
    let has_high = warnings.iter().any(|w| w.severity == "high");

    let level = if score == 0 {
        "safe"
    } else if has_high || score >= 3 {
        "high_risk"
    } else {
        "warning"
    };

    Ok(RiskCheckResult {
        level: level.to_string(),
        score,
        warnings,
        offline: false,
    })
}

// ─── Templates ────────────────────────────────────────────────

pub fn save_order_template(&self, input: SaveTemplateInput) -> Result<OrderTemplate, String> {
    if input.name.trim().is_empty() { return Err("template_name_required".into()); }
    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "INSERT INTO order_templates (name, shop_tag, items_json, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![input.name.trim(), input.shop_tag, input.items_json, now],
    ).map_err(|e| e.to_string())?;
    let id = self.conn.last_insert_rowid();
    self.conn.query_row(
        "SELECT id, name, shop_tag, items_json, created_at FROM order_templates WHERE id = ?1",
        params![id],
        |r| Ok(OrderTemplate { id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?, items_json: r.get(3)?, created_at: r.get(4)? }),
    ).map_err(|e| e.to_string())
}

pub fn get_order_templates(&self, shop_tag: Option<String>) -> Result<Vec<OrderTemplate>, String> {
    let (sql, use_tag) = match shop_tag.as_deref() {
        Some(tag) if !tag.is_empty() => (
            "SELECT id, name, shop_tag, items_json, created_at FROM order_templates
             ORDER BY CASE WHEN shop_tag = ?1 THEN 0 ELSE 1 END, name ASC",
            Some(tag.to_string()),
        ),
        _ => (
            "SELECT id, name, shop_tag, items_json, created_at FROM order_templates ORDER BY name ASC",
            None,
        ),
    };

    let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;

    let items = if let Some(tag) = use_tag {
        stmt.query_map([tag], |r| Ok(OrderTemplate {
            id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?,
            items_json: r.get(3)?, created_at: r.get(4)?,
        }))
    } else {
        stmt.query_map([], |r| Ok(OrderTemplate {
            id: r.get(0)?, name: r.get(1)?, shop_tag: r.get(2)?,
            items_json: r.get(3)?, created_at: r.get(4)?,
        }))
    };

    items.map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_order_template(&self, id: i64) -> Result<(), String> {
    self.conn.execute("DELETE FROM order_templates WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
