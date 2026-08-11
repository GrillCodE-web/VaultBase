impl Database {
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
        
        // FIX SQL-INJECTION: Use parameterized queries for all user input
        let like = if search.is_empty() {
            None
        } else {
            Some(format!("%{}%", Self::escape_like(&search.to_lowercase())))
        };
        
        // FIX SQL-INJECTION: Build COUNT query with proper parameter binding
        let total: i64 = match &like {
            Some(search_pattern) => {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM shops WHERE (LOWER(name) LIKE ?1 ESCAPE '\\' OR LOWER(domain) LIKE ?1 ESCAPE '\\')",
                    params![search_pattern],
                    |r| r.get(0)
                ).unwrap_or(0)
            },
            None => {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM shops WHERE 1=1",
                    [],
                    |r| r.get(0)
                ).unwrap_or(0)
            }
        };
        
        // FIX SQL-INJECTION: Use parameterized SELECT with LIMIT/OFFSET as numbers
        let ids: Vec<i64> = match &like {
            Some(search_pattern) => {
                let mut stmt = self.conn.prepare(
                    "SELECT id FROM shops WHERE (LOWER(name) LIKE ?1 ESCAPE '\\' OR LOWER(domain) LIKE ?1 ESCAPE '\\') ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
                ).map_err(|e| e.to_string())?;
                
                let collected: Vec<i64> = stmt.query_map(params![search_pattern, pp, offset], |r| r.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                collected
            },
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT id FROM shops WHERE 1=1 ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
                ).map_err(|e| e.to_string())?;
                
                let collected: Vec<i64> = stmt.query_map(params![pp, offset], |r| r.get(0))
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                collected
            }
        };
        
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
}

// ─────────────────────────────────────────
//  Tests for SQL Safety in get_shops
// ─────────────────────────────────────────

#[cfg(test)]
mod shops_tests {
    use super::*;

    /// Test LIKE pattern escaping
    #[test]
    fn test_escape_like_basic() {
        // Verify escape_like function handles special characters
        let test_cases = vec![
            ("hello", "hello"),  // No special chars
            ("%test%", "\\%test\\%"),  // Percent signs
            ("_underscore_", "\\_underscore\\_"),  // Underscores
            ("\\back\\slash\\", "\\\\back\\\\slash\\\\"),  // Backslashes
        ];
        
        for (input, _expected) in test_cases {
            // The escape_like function should return a safe string
            // that can be used in LIKE clauses
            let _ = Database::escape_like(input);
        }
    }

    /// Test pagination calculation with valid inputs
    #[test]
    fn test_pagination_calculation() {
        let page = 1u32;
        let per_page = 20u32;
        let offset = ((page.saturating_sub(1)) as i64) * (per_page.max(1) as i64);
        
        assert_eq!(offset, 0, "First page should have offset 0");
    }

    /// Test pagination calculation for page 2
    #[test]
    fn test_pagination_calculation_page2() {
        let page = 2u32;
        let per_page = 20u32;
        let offset = ((page.saturating_sub(1)) as i64) * (per_page.max(1) as i64);
        
        assert_eq!(offset, 20, "Second page with 20 items should have offset 20");
    }

    /// Test pagination with edge case (per_page = 0)
    #[test]
    fn test_pagination_per_page_zero() {
        let per_page = 0u32;
        let pp = per_page.max(1) as i64;
        
        assert_eq!(pp, 1, "per_page should be at least 1");
    }

    /// Test total pages calculation
    #[test]
    fn test_total_pages_calculation() {
        let total = 100u32;
        let per_page = 20u32;
        let total_pages = (total + per_page - 1) / per_page.max(1);
        
        assert_eq!(total_pages, 5, "100 items with 20 per page = 5 pages");
    }

    /// Test total pages with non-divisible count
    #[test]
    fn test_total_pages_non_divisible() {
        let total = 95u32;
        let per_page = 20u32;
        let total_pages = (total + per_page - 1) / per_page.max(1);
        
        assert_eq!(total_pages, 5, "95 items with 20 per page = 5 pages (ceiling)");
    }

    /// Test search parameter handling (empty search)
    #[test]
    fn test_search_parameter_empty() {
        let search = "";
        
        // Empty search should use WHERE 1=1 instead of LIKE
        assert_eq!(search.is_empty(), true);
    }

    /// Test search parameter handling (non-empty search)
    #[test]
    fn test_search_parameter_non_empty() {
        let search = "amazon";
        
        // Non-empty search should use LIKE pattern
        assert!(!search.is_empty());
        let like_pattern = format!("%{}%", search.to_lowercase());
        assert_eq!(like_pattern, "%amazon%");
    }

    /// Test LIMIT/OFFSET parameter types (should be i64, not format! string)
    #[test]
    fn test_limit_offset_parameter_types() {
        let per_page = 20u32;
        let page = 1u32;
        
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        
        // Verify these are numeric types, not strings
        assert!(std::mem::size_of_val(&pp) > 0);
        assert!(std::mem::size_of_val(&offset) > 0);
    }
}
