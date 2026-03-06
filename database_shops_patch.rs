// ============================================================
// PATCH: database.rs — Shops + Products operations
// Append inside impl Database { ... }
// ============================================================

use crate::models::{ShopInput, Shop, ShopDetail, ShopStats, Product, ProductInput, Suggestion, PaginatedShops};

// ─── Domain normalizer ────────────────────────────────────────

fn normalize_domain(url: &str) -> String {
    let s = url.trim();
    // Strip scheme
    let s = if let Some(rest) = s.strip_prefix("https://") { rest }
            else if let Some(rest) = s.strip_prefix("http://") { rest }
            else { s };
    // Strip www.
    let s = s.strip_prefix("www.").unwrap_or(s);
    // Take only host part (before first '/')
    let s = s.split('/').next().unwrap_or(s);
    // Strip trailing dot
    s.trim_end_matches('.').to_lowercase()
}

// ─── Shops ────────────────────────────────────────────────────

pub fn create_shop(&self, input: ShopInput) -> Result<Shop, String> {
    if input.name.trim().is_empty() {
        return Err("shop_name_required".to_string());
    }
    let domain = normalize_domain(&input.url);
    if domain.is_empty() {
        return Err("shop_url_required".to_string());
    }

    // Uniqueness check
    let exists: bool = self.conn
        .query_row(
            "SELECT COUNT(*) FROM shops WHERE domain = ?1",
            params![domain],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;
    if exists {
        return Err("shop_domain_duplicate".to_string());
    }

    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "INSERT INTO shops
         (name, domain, url, category, notes,
          requires_cvv_match, blocks_vpn, phone_must_match,
          accepts_amex, requires_avs, high_cancel_risk,
          created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
        params![
            input.name.trim(),
            domain,
            input.url.trim(),
            if input.category.is_empty() { None } else { Some(input.category.clone()) },
            if input.notes.is_empty() { None } else { Some(input.notes.clone()) },
            input.requires_cvv_match,
            input.blocks_vpn,
            input.phone_must_match,
            input.accepts_amex,
            input.requires_avs,
            input.high_cancel_risk,
            now
        ],
    ).map_err(|e| e.to_string())?;

    let id = self.conn.last_insert_rowid();
    self.log_event("shop.created", Some(&format!("id={} domain={}", id, domain)))?;
    self.get_shop_by_id(id)
}

pub fn update_shop(&self, id: i64, input: ShopInput) -> Result<Shop, String> {
    let domain = normalize_domain(&input.url);
    // Uniqueness — exclude self
    let exists: bool = self.conn
        .query_row(
            "SELECT COUNT(*) FROM shops WHERE domain = ?1 AND id != ?2",
            params![domain, id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0;
    if exists {
        return Err("shop_domain_duplicate".to_string());
    }

    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "UPDATE shops SET name=?1, domain=?2, url=?3, category=?4, notes=?5,
         requires_cvv_match=?6, blocks_vpn=?7, phone_must_match=?8,
         accepts_amex=?9, requires_avs=?10, high_cancel_risk=?11, updated_at=?12
         WHERE id=?13",
        params![
            input.name.trim(),
            domain,
            input.url.trim(),
            if input.category.is_empty() { None } else { Some(input.category) },
            if input.notes.is_empty() { None } else { Some(input.notes) },
            input.requires_cvv_match,
            input.blocks_vpn,
            input.phone_must_match,
            input.accepts_amex,
            input.requires_avs,
            input.high_cancel_risk,
            now,
            id
        ],
    ).map_err(|e| e.to_string())?;

    self.get_shop_by_id(id)
}

fn get_shop_by_id(&self, id: i64) -> Result<Shop, String> {
    let row = self.conn.query_row(
        "SELECT s.id, s.name, s.domain, s.url, s.category, s.notes,
                s.requires_cvv_match, s.blocks_vpn, s.phone_must_match,
                s.accepts_amex, s.requires_avs, s.high_cancel_risk,
                s.created_at, s.updated_at,
                COUNT(o.id) as total_orders,
                SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN o.status='declined' OR o.status='cancelled' THEN 1 ELSE 0 END) as declined,
                AVG(o.total_amount) as avg_val
         FROM shops s
         LEFT JOIN orders o ON o.shop_id = s.id
         WHERE s.id = ?1
         GROUP BY s.id",
        params![id],
        |r| self.map_shop_row(r),
    ).map_err(|_| "shop_not_found".to_string())?;
    Ok(row)
}

fn map_shop_row(&self, r: &rusqlite::Row) -> rusqlite::Result<Shop> {
    let total: i64 = r.get(14)?;
    let delivered: i64 = r.get::<_, Option<i64>>(15)?.unwrap_or(0);
    let declined: i64 = r.get::<_, Option<i64>>(16)?.unwrap_or(0);
    let avg_val: f64 = r.get::<_, Option<f64>>(17)?.unwrap_or(0.0);
    let success_rate = if total > 0 { delivered as f64 / total as f64 * 100.0 } else { 0.0 };

    Ok(Shop {
        id: r.get(0)?,
        name: r.get(1)?,
        domain: r.get(2)?,
        url: r.get(3)?,
        category: r.get(4)?,
        notes: r.get(5)?,
        requires_cvv_match: r.get(6)?,
        blocks_vpn: r.get(7)?,
        phone_must_match: r.get(8)?,
        accepts_amex: r.get(9)?,
        requires_avs: r.get(10)?,
        high_cancel_risk: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
        total_orders: total,
        delivered,
        declined,
        success_rate,
        avg_order_value: avg_val,
    })
}

pub fn get_shops(&self, page: u32, per_page: u32, search: Option<String>) -> Result<PaginatedShops, String> {
    let offset = (page.saturating_sub(1)) * per_page;

    let (where_clause, search_param): (String, Option<String>) = match search.as_deref() {
        Some(s) if !s.is_empty() => {
            let pat = format!("%{}%", s);
            ("WHERE s.name LIKE ?1 OR s.domain LIKE ?1".to_string(), Some(pat))
        }
        _ => (String::new(), None),
    };

    let total: u32 = {
        let sql = format!("SELECT COUNT(*) FROM shops s {}", where_clause);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Some(ref pat) = search_param {
            stmt.query_row([pat.as_str()], |r| r.get(0)).map_err(|e| e.to_string())?
        } else {
            stmt.query_row([], |r| r.get(0)).map_err(|e| e.to_string())?
        }
    };

    let data_sql = format!(
        "SELECT s.id, s.name, s.domain, s.url, s.category, s.notes,
                s.requires_cvv_match, s.blocks_vpn, s.phone_must_match,
                s.accepts_amex, s.requires_avs, s.high_cancel_risk,
                s.created_at, s.updated_at,
                COUNT(o.id) as total_orders,
                SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN o.status='declined' OR o.status='cancelled' THEN 1 ELSE 0 END) as declined,
                AVG(o.total_amount) as avg_val
         FROM shops s
         LEFT JOIN orders o ON o.shop_id = s.id
         {}
         GROUP BY s.id
         ORDER BY s.name ASC
         LIMIT {} OFFSET {}",
        where_clause,
        per_page,
        offset
    );

    let mut stmt = self.conn.prepare(&data_sql).map_err(|e| e.to_string())?;

    let items = if let Some(ref pat) = search_param {
        stmt.query_map([pat.as_str()], |r| self.map_shop_row(r))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], |r| self.map_shop_row(r))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    Ok(PaginatedShops {
        items,
        total,
        page,
        per_page,
        total_pages: ((total as f64) / (per_page as f64)).ceil() as u32,
    })
}

pub fn get_shop_detail(&self, id: i64) -> Result<ShopDetail, String> {
    let shop = self.get_shop_by_id(id)?;

    // Full stats breakdown
    let stats: ShopStats = {
        let row: (i64, i64, i64, i64, i64, i64, i64, Option<f64>) = self.conn.query_row(
            "SELECT
               COUNT(*),
               SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='shipped' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='declined' THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),
               AVG(total_amount)
             FROM orders WHERE shop_id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        ).map_err(|e| e.to_string())?;

        let (total, pending, processing, shipped, delivered, declined, cancelled, avg) = row;
        let success_rate = if total > 0 { delivered as f64 / total as f64 * 100.0 } else { 0.0 };
        let decline_rate = if total > 0 { declined as f64 / total as f64 * 100.0 } else { 0.0 };

        ShopStats {
            total,
            pending,
            processing,
            shipped,
            delivered,
            declined,
            cancelled,
            success_rate,
            decline_rate,
            avg_order_value: avg.unwrap_or(0.0),
        }
    };

    // Last 10 orders
    let recent_orders: Vec<crate::models::OrderSummary> = {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.status, s.name, o.total_amount, o.tracking_number, o.created_at
             FROM orders o
             LEFT JOIN shops s ON s.id = o.shop_id
             WHERE o.shop_id = ?1
             ORDER BY o.created_at DESC LIMIT 10"
        ).map_err(|e| e.to_string())?;

        stmt.query_map(params![id], |r| {
            Ok(crate::models::OrderSummary {
                id: r.get(0)?,
                status: r.get(1)?,
                shop_name: r.get(2)?,
                total_amount: r.get(3)?,
                tracking_number: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let products = self.get_shop_products(id)?;

    Ok(ShopDetail { shop, stats, recent_orders, products })
}

pub fn delete_shop(&self, id: i64) -> Result<(), String> {
    // Guard: active orders
    let active: i64 = self.conn.query_row(
        "SELECT COUNT(*) FROM orders WHERE shop_id = ?1 AND status IN ('pending','processing','shipped')",
        params![id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if active > 0 {
        return Err(format!("shop_has_active_orders:{}", active));
    }
    self.conn.execute("DELETE FROM shop_products WHERE shop_id = ?1", params![id]).map_err(|e| e.to_string())?;
    self.conn.execute("DELETE FROM shop_footprints WHERE shop_id = ?1", params![id]).map_err(|e| e.to_string())?;
    self.conn.execute("DELETE FROM shops WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    self.log_event("shop.deleted", Some(&format!("id={}", id)))
}

// ─── Smart Suggestions ────────────────────────────────────────

pub fn get_shop_smart_suggestions(&self, shop_id: i64, card_id: i64) -> Result<Vec<Suggestion>, String> {
    // Get card bank_name and card_type
    let (bank_name, card_type): (Option<String>, Option<String>) = self.conn
        .query_row(
            "SELECT bank_name, card_type FROM credit_cards WHERE id = ?1",
            params![card_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "card_not_found".to_string())?;

    let mut suggestions: Vec<Suggestion> = Vec::new();

    // ── Bank success/decline rate ──
    if let Some(ref bank) = bank_name {
        if !bank.is_empty() {
            let (bank_total, bank_delivered): (i64, i64) = self.conn.query_row(
                "SELECT COUNT(*), SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END)
                 FROM orders o
                 JOIN profiles p ON p.id = o.profile_id
                 JOIN credit_cards cc ON cc.id = p.card_id
                 WHERE o.shop_id = ?1 AND cc.bank_name = ?2",
                params![shop_id, bank],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            ).unwrap_or((0, 0));

            if bank_total >= 3 {
                let decline_count = bank_total - bank_delivered;
                let decline_rate = decline_count as f64 / bank_total as f64;
                let success_rate = bank_delivered as f64 / bank_total as f64;

                if decline_rate > 0.6 {
                    suggestions.push(Suggestion {
                        level: "warn".to_string(),
                        message: format!(
                            "{} often declined here ({}/{})",
                            bank, decline_count, bank_total
                        ),
                    });
                } else if success_rate > 0.7 {
                    suggestions.push(Suggestion {
                        level: "good".to_string(),
                        message: format!(
                            "{} works well here ({}%)",
                            bank,
                            (success_rate * 100.0).round() as i64
                        ),
                    });
                } else {
                    suggestions.push(Suggestion {
                        level: "info".to_string(),
                        message: format!(
                            "{} mixed results here ({}/{} delivered)",
                            bank, bank_delivered, bank_total
                        ),
                    });
                }
            }
        }
    }

    // ── Card type success rate ──
    if let Some(ref ctype) = card_type {
        if !ctype.is_empty() {
            let (type_total, type_delivered): (i64, i64) = self.conn.query_row(
                "SELECT COUNT(*), SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END)
                 FROM orders o
                 JOIN profiles p ON p.id = o.profile_id
                 JOIN credit_cards cc ON cc.id = p.card_id
                 WHERE o.shop_id = ?1 AND cc.card_type = ?2",
                params![shop_id, ctype],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            ).unwrap_or((0, 0));

            if type_total >= 3 {
                let success_rate = type_delivered as f64 / type_total as f64;
                if success_rate > 0.7 {
                    suggestions.push(Suggestion {
                        level: "good".to_string(),
                        message: format!(
                            "{} works well here ({}%)",
                            ctype,
                            (success_rate * 100.0).round() as i64
                        ),
                    });
                } else if success_rate < 0.4 && type_total >= 3 {
                    suggestions.push(Suggestion {
                        level: "warn".to_string(),
                        message: format!(
                            "{} low success rate here ({}%)",
                            ctype,
                            (success_rate * 100.0).round() as i64
                        ),
                    });
                }
            }
        }
    }

    // ── Shop-level flags ──
    let (blocks_vpn, high_cancel): (bool, bool) = self.conn.query_row(
        "SELECT blocks_vpn, high_cancel_risk FROM shops WHERE id = ?1",
        params![shop_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((false, false));

    if blocks_vpn {
        suggestions.push(Suggestion {
            level: "warn".to_string(),
            message: "This shop blocks VPN/Proxy — use residential proxy".to_string(),
        });
    }
    if high_cancel {
        suggestions.push(Suggestion {
            level: "warn".to_string(),
            message: "High cancel risk shop — monitor order closely".to_string(),
        });
    }

    if suggestions.is_empty() {
        suggestions.push(Suggestion {
            level: "info".to_string(),
            message: "Not enough order history for this combination yet".to_string(),
        });
    }

    Ok(suggestions)
}

// ─── Products ─────────────────────────────────────────────────

pub fn get_shop_products(&self, shop_id: i64) -> Result<Vec<Product>, String> {
    let mut stmt = self.conn.prepare(
        "SELECT id, shop_id, asin, name, amazon_price, shop_price, url, notes, created_at
         FROM shop_products WHERE shop_id = ?1 ORDER BY name ASC"
    ).map_err(|e| e.to_string())?;

    stmt.query_map(params![shop_id], |r| {
        let amazon_price: Option<f64> = r.get(4)?;
        let shop_price: Option<f64> = r.get(5)?;
        let margin = match (amazon_price, shop_price) {
            (Some(a), Some(s)) => Some(s - a),
            _ => None,
        };
        Ok(Product {
            id: r.get(0)?,
            shop_id: r.get(1)?,
            asin: r.get(2)?,
            name: r.get(3)?,
            amazon_price,
            shop_price,
            margin,
            url: r.get(6)?,
            notes: r.get(7)?,
            created_at: r.get(8)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn add_shop_product(&self, shop_id: i64, product: ProductInput) -> Result<Product, String> {
    if product.name.trim().is_empty() {
        return Err("product_name_required".to_string());
    }
    let now = Utc::now().to_rfc3339();
    self.conn.execute(
        "INSERT INTO shop_products (shop_id, asin, name, amazon_price, shop_price, url, notes, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            shop_id,
            if product.asin.is_empty() { None } else { Some(product.asin) },
            product.name.trim(),
            product.amazon_price,
            product.shop_price,
            if product.url.is_empty() { None } else { Some(product.url) },
            if product.notes.is_empty() { None } else { Some(product.notes) },
            now
        ],
    ).map_err(|e| e.to_string())?;

    let id = self.conn.last_insert_rowid();
    let amazon_price = product.amazon_price;
    let shop_price_val = product.shop_price;
    let margin = match (amazon_price, shop_price_val) {
        (Some(a), Some(s)) => Some(s - a),
        _ => None,
    };

    self.conn.query_row(
        "SELECT id, shop_id, asin, name, amazon_price, shop_price, url, notes, created_at FROM shop_products WHERE id = ?1",
        params![id],
        |r| {
            let ap: Option<f64> = r.get(4)?;
            let sp: Option<f64> = r.get(5)?;
            let m = match (ap, sp) { (Some(a), Some(s)) => Some(s - a), _ => None };
            Ok(Product {
                id: r.get(0)?, shop_id: r.get(1)?, asin: r.get(2)?,
                name: r.get(3)?, amazon_price: ap, shop_price: sp, margin: m,
                url: r.get(6)?, notes: r.get(7)?, created_at: r.get(8)?,
            })
        }
    ).map_err(|e| e.to_string())
}

pub fn update_shop_product(&self, id: i64, product: ProductInput) -> Result<Product, String> {
    self.conn.execute(
        "UPDATE shop_products SET asin=?1, name=?2, amazon_price=?3, shop_price=?4, url=?5, notes=?6 WHERE id=?7",
        params![
            if product.asin.is_empty() { None } else { Some(product.asin) },
            product.name.trim(),
            product.amazon_price,
            product.shop_price,
            if product.url.is_empty() { None } else { Some(product.url) },
            if product.notes.is_empty() { None } else { Some(product.notes) },
            id
        ],
    ).map_err(|e| e.to_string())?;

    self.conn.query_row(
        "SELECT id, shop_id, asin, name, amazon_price, shop_price, url, notes, created_at FROM shop_products WHERE id = ?1",
        params![id],
        |r| {
            let ap: Option<f64> = r.get(4)?;
            let sp: Option<f64> = r.get(5)?;
            let m = match (ap, sp) { (Some(a), Some(s)) => Some(s - a), _ => None };
            Ok(Product {
                id: r.get(0)?, shop_id: r.get(1)?, asin: r.get(2)?,
                name: r.get(3)?, amazon_price: ap, shop_price: sp, margin: m,
                url: r.get(6)?, notes: r.get(7)?, created_at: r.get(8)?,
            })
        }
    ).map_err(|e| e.to_string())
}

pub fn delete_shop_product(&self, id: i64) -> Result<(), String> {
    self.conn.execute("DELETE FROM shop_products WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
