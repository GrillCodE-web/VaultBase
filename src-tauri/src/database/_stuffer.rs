// FEAT-009: локальные связи заказов с посылками внешней панели (stuffer).
// Сама посылка живёт на панели; здесь — связь + снапшот (courier/track/status)
// для офлайн-отображения цепочки карта → профиль → заказ → посылка → курьер.
//
// Файл подключается через include!() внутрь impl Database (см. mod.rs),
// поэтому impl-обёртка не нужна.

use crate::models::{OrderPackageLink, ProfilePackageLink};

const OPL_COLS: &str =
    "id,order_id,provider,package_id,courier_id,track,status,created_at,updated_at";

fn row_to_link(r: &rusqlite::Row) -> rusqlite::Result<OrderPackageLink> {
    Ok(OrderPackageLink {
        id: r.get(0)?,
        order_id: r.get(1)?,
        provider: r.get(2)?,
        package_id: r.get(3)?,
        courier_id: r.get(4)?,
        track: r.get(5)?,
        status: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

impl Database {
    /// Привязать заказ к посылке панели. Одна активная посылка на заказ:
    /// повторный вызов перевязывает заказ на новую посылку.
    pub fn link_order_package(
        &self,
        order_id: i64,
        provider: &str,
        package_id: i64,
        courier_id: Option<i64>,
        track: Option<&str>,
        status: Option<&str>,
    ) -> Result<OrderPackageLink, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE id=?1", params![order_id], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err(format!("order_not_found: {}", order_id));
        }
        self.conn.execute(
            "INSERT INTO order_package_link(order_id,provider,package_id,courier_id,track,status,created_at,updated_at) \
             VALUES(?1,?2,?3,?4,?5,?6,datetime('now'),datetime('now')) \
             ON CONFLICT(provider,package_id) DO UPDATE SET \
             order_id=excluded.order_id, courier_id=excluded.courier_id, \
             track=excluded.track, status=excluded.status, updated_at=datetime('now')",
            params![order_id, provider, package_id, courier_id, track, status],
        ).map_err(|e| e.to_string())?;
        let id: i64 = self.conn.query_row(
            "SELECT id FROM order_package_link WHERE provider=?1 AND package_id=?2",
            params![provider, package_id], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let _ = self.log_event(
            "stuffer.package_linked",
            &format!("Order {} linked to {} package {}", order_id, provider, package_id),
            Some("stuffer"), Some(&order_id.to_string()),
        );
        self.get_order_package_link(id)
    }

    pub fn unlink_order_package(&self, order_id: i64, link_id: i64) -> Result<(), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let n = self.conn.execute(
            "DELETE FROM order_package_link WHERE id=?1 AND order_id=?2",
            params![link_id, order_id],
        ).map_err(|e| e.to_string())?;
        if n == 0 { return Err(format!("link_not_found: {}", link_id)); }
        let _ = self.log_event(
            "stuffer.package_unlinked",
            &format!("Link {} removed from order {}", link_id, order_id),
            Some("stuffer"), Some(&order_id.to_string()),
        );
        Ok(())
    }

    pub fn get_order_package_link(&self, link_id: i64) -> Result<OrderPackageLink, String> {
        self.conn.query_row(
            &format!("SELECT {} FROM order_package_link WHERE id=?1", OPL_COLS),
            params![link_id], row_to_link,
        ).map_err(|e| e.to_string())
    }

    /// Все связи заказа (сейчас одна — последняя вставленная).
    pub fn list_links_for_order(&self, order_id: i64) -> Result<Vec<OrderPackageLink>, String> {
        let mut stmt = self.conn.prepare(
            &format!("SELECT {} FROM order_package_link WHERE order_id=?1 ORDER BY id", OPL_COLS),
        ).map_err(|e| e.to_string())?;
        let items = stmt.query_map(params![order_id], row_to_link)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    /// Посылки всех заказов профиля — для карточки профиля.
    pub fn list_links_for_profile(&self, profile_id: &str) -> Result<Vec<ProfilePackageLink>, String> {
        let mut stmt = self.conn.prepare(
            &format!(
                "SELECT {cols}, o.order_number, o.status \
                 FROM order_package_link l JOIN orders o ON o.id=l.order_id \
                 WHERE o.profile_id=?1 ORDER BY l.id DESC",
                cols = OPL_COLS.split(',').map(|c| format!("l.{}", c.trim())).collect::<Vec<_>>().join(",")
            ),
        ).map_err(|e| e.to_string())?;
        let items = stmt.query_map(params![profile_id], |r| {
            Ok(ProfilePackageLink {
                link: row_to_link(r)?,
                order_number: r.get(9)?,
                order_status: r.get(10)?,
            })
        }).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    /// Обновить снапшоты связей из свежего списка посылок панели
    /// (status/track/courier). Связи с отсутствующими на панели посылками
    /// не трогаем — панель может отдавать список постранично.
    pub fn refresh_package_snapshots(&self, provider: &str, packages: &[crate::stuffer::Package]) -> Result<u32, String> {
        let mut updated: u32 = 0;
        for p in packages {
            let track = p.tracks.first().map(|s| s.as_str());
            let n = self.conn.execute(
                "UPDATE order_package_link SET status=?1, track=COALESCE(?2,track), \
                 courier_id=COALESCE(?3,courier_id), updated_at=datetime('now') \
                 WHERE provider=?4 AND package_id=?5",
                params![p.status, track, p.courier_id, provider, p.id],
            ).map_err(|e| e.to_string())?;
            updated += n as u32;
        }
        Ok(updated)
    }
}

#[cfg(test)]
mod opl_tests {
    use super::*;
    use crate::models::{OrderInput, OrderItemInput};

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        // create_order пишет зашифрованные поля — нужна разблокированная БД
        // (паттерн из mod perf_tests в _cards.rs)
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("opl_test_pw_1234567890", &salt));
        (dir, db)
    }

    /// Полная цепочка FK: карта → профиль (orders.profile_id REFERENCES profiles).
    /// n — для уникальности номера карты между вызовами.
    fn make_profile(db: &Database, n: usize) -> String {
        db.insert_cards(vec![crate::models::CardInput {
            card_number: format!("411111{:010}", n % 9_999_999_999),
            expiry_date: Some("12/29".into()),
            cvv: Some("123".into()),
            holder_name: Some(format!("Holder {}", n)),
            billing_address: None,
            city: None,
            state: None,
            zip: None,
            country: Some("US".into()),
            phone: None,
            email: None,
            ip_address: None,
            source: "test".into(),
            domain: None,
            acquired_at: None,
        }]).unwrap();
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0))
            .unwrap();
        db.create_profile(card_id, None).unwrap().id
    }

    /// Заказ на существующем профиле (orders.profile_id REFERENCES profiles).
    fn make_order(db: &Database, profile_id: &str) -> i64 {
        // domain уникален (create_shop → domain_already_exists)
        let n: i64 = db.conn
            .query_row("SELECT COUNT(*) FROM shops", [], |r| r.get(0))
            .unwrap();
        let shop = db.create_shop(&crate::models::ShopInput {
            name: format!("Test Shop {}", n),
            url: format!("https://test-{}.example.com", n),
            category: "general".into(),
            notes: String::new(),
            requires_cvv_match: false,
            blocks_vpn: false,
            phone_must_match: false,
            accepts_amex: false,
            requires_avs: false,
            high_cancel_risk: false,
        }).unwrap();
        db.create_order(&OrderInput {
            profile_id: profile_id.into(),
            shop_id: shop.id,
            drop_id: None,
            email_pool_id: None,
            proxy_id: None,
            order_number: Some("ORD-1".into()),
            notes: None,
            items: vec![OrderItemInput {
                name: "Item".into(), sku: "SKU-1".into(), qty: 1, price: 10.0,
            }],
        }).unwrap().id
    }

    #[test]
    fn test_link_unlink_roundtrip() {
        let (_dir, db) = test_db();
        let prof = make_profile(&db, 1);
        let oid = make_order(&db, &prof);
        let link = db.link_order_package(oid, "swat", 501, Some(7), Some("1Z999"), Some("new")).unwrap();
        assert_eq!(link.order_id, oid);
        assert_eq!(link.provider, "swat");
        assert_eq!(link.package_id, 501);
        assert_eq!(link.courier_id, Some(7));
        assert_eq!(link.track.as_deref(), Some("1Z999"));
        assert_eq!(db.list_links_for_order(oid).unwrap().len(), 1);

        db.unlink_order_package(oid, link.id).unwrap();
        assert!(db.list_links_for_order(oid).unwrap().is_empty());
        assert!(db.unlink_order_package(oid, link.id).is_err());
    }

    #[test]
    fn test_link_requires_existing_order() {
        let (_dir, db) = test_db();
        assert!(db.link_order_package(9999, "swat", 1, None, None, None).is_err());
    }

    #[test]
    fn test_relink_same_package_moves_between_orders() {
        let (_dir, db) = test_db();
        let o1 = make_order(&db, &make_profile(&db, 1));
        let o2 = make_order(&db, &make_profile(&db, 2));
        let l1 = db.link_order_package(o1, "swat", 777, None, None, None).unwrap();
        let l2 = db.link_order_package(o2, "swat", 777, Some(3), Some("T2"), Some("shipped")).unwrap();
        assert_eq!(l1.id, l2.id, "UNIQUE(provider,package_id): та же строка переиспользуется");
        assert!(db.list_links_for_order(o1).unwrap().is_empty());
        let got = db.list_links_for_order(o2).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].track.as_deref(), Some("T2"));
    }

    #[test]
    fn test_list_links_for_profile_chain() {
        let (_dir, db) = test_db();
        let prof_chain = make_profile(&db, 1);
        let oa = make_order(&db, &prof_chain);
        let ob = make_order(&db, &prof_chain);
        db.link_order_package(oa, "swat", 1, None, Some("TA"), Some("new")).unwrap();
        db.link_order_package(ob, "swat", 2, None, None, None).unwrap();
        // чужой профиль не попадает
        let oc = make_order(&db, &make_profile(&db, 2));
        db.link_order_package(oc, "swat", 3, None, None, None).unwrap();

        let links = db.list_links_for_profile(&prof_chain).unwrap();
        assert_eq!(links.len(), 2);
        assert!(links.iter().all(|p| p.link.order_id == oa || p.link.order_id == ob));
        assert_eq!(links[0].link.package_id, 2, "свежие первыми (ORDER BY l.id DESC)");
        assert_eq!(links[0].order_status, "pending");
        assert_eq!(links[1].order_number.as_deref(), Some("ORD-1"));
    }

    #[test]
    fn test_refresh_package_snapshots() {
        let (_dir, db) = test_db();
        let oid = make_order(&db, &make_profile(&db, 1));
        db.link_order_package(oid, "swat", 42, None, None, None).unwrap();

        let pkgs: Vec<crate::stuffer::Package> = vec![
            serde_json::from_value(serde_json::json!({
                "id": 42, "status": "shipped", "courier_id": 9,
                "tracks": [{ "track": "1ZNEW", "carrier": "UPS" }]
            })).unwrap(),
            serde_json::from_value(serde_json::json!({ "id": 43, "status": "new" })).unwrap(),
        ];
        let n = db.refresh_package_snapshots("swat", &pkgs).unwrap();
        assert_eq!(n, 1, "обновляются только привязанные посылки");

        let link = db.list_links_for_order(oid).unwrap().remove(0);
        assert_eq!(link.status.as_deref(), Some("shipped"));
        assert_eq!(link.courier_id, Some(9));
        assert_eq!(link.track.as_deref(), Some("1ZNEW"));
    }
}
