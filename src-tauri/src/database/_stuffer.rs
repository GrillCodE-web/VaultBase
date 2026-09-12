// FEAT-009: локальные связи заказов с посылками внешней панели (stuffer).
// Сама посылка живёт на панели; здесь — связь + снапшот (courier/track/status)
// для офлайн-отображения цепочки карта → профиль → заказ → посылка → курьер.
//
// Файл подключается через include!() внутрь impl Database (см. mod.rs),
// поэтому impl-обёртка не нужна.

use crate::models::{OrderPackageLink, ProfilePackageLink, StufferAccount};

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
    /// Апдейт панели 2026-09: tracks — объекты {track, carrier}; courier_id
    /// в «packages» больше не документирован (None → COALESCE сохраняет
    /// прежнее значение снапшота).
    pub fn refresh_package_snapshots(&self, provider: &str, packages: &[crate::stuffer::Package]) -> Result<u32, String> {
        let mut updated: u32 = 0;
        for p in packages {
            let track = p.tracks.first().map(|t| t.track.as_str());
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

    // ── FEAT-011: реестр stuffer-аккаунтов (индивидуальные API-ключи) ────

    fn map_stuffer_account(r: &rusqlite::Row) -> rusqlite::Result<StufferAccount> {
        Ok(StufferAccount {
            id: r.get(0)?,
            label: r.get(1)?,
            provider: r.get(2)?,
            base_url: r.get(3)?,
            api_key: r.get(4)?,
            created_at: r.get(5)?,
        })
    }

    pub fn list_stuffer_accounts(&self) -> Result<Vec<StufferAccount>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,label,provider,base_url,api_key,created_at FROM stuffer_accounts ORDER BY id",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], Self::map_stuffer_account).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Аккаунт с API-ключом — только для внутреннего использования
    /// (построение провайдера); на фронт ключ не уходит (serde skip).
    pub fn get_stuffer_account(&self, id: i64) -> Result<StufferAccount, String> {
        self.conn.query_row(
            "SELECT id,label,provider,base_url,api_key,created_at FROM stuffer_accounts WHERE id=?1",
            params![id], Self::map_stuffer_account,
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("stuffer_account_not_found: {}", id),
            other => other.to_string(),
        })
    }

    pub fn add_stuffer_account(&self, label: &str, base_url: &str, api_key: &str) -> Result<i64, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        if label.is_empty() || label.chars().count() > 100 {
            return Err("stuffer_account_label_invalid".into());
        }
        if api_key.is_empty() {
            return Err("stuffer_account_key_empty".into());
        }
        if base_url.chars().count() > 500 {
            return Err("stuffer_account_url_invalid".into());
        }
        self.conn.execute(
            "INSERT INTO stuffer_accounts(label,base_url,api_key) VALUES(?1,?2,?3)",
            params![label, base_url, api_key],
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn delete_stuffer_account(&self, id: i64) -> Result<(), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let n = self.conn.execute("DELETE FROM stuffer_accounts WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 { return Err(format!("stuffer_account_not_found: {}", id)); }
        Ok(())
    }

    // ── FEAT-010: теги курьеров ("использован под X"), sync по хешу ─────

    /// Стабильный хеш личности курьера: SHA-256 от нормализованной строки
    /// "provider|name|address1|city|state|zip" (lowercase, схлопнутые пробелы).
    /// courier_id у разных пользователей панели свой — по нему синкать нельзя.
    pub fn courier_identity_hash(
        provider: &str, name: &str, address1: &str, city: &str, state: &str, zip: &str,
    ) -> String {
        use sha2::{Digest, Sha256};
        let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
        let identity = [provider, name, address1, city, state, zip]
            .iter().map(|p| norm(p)).collect::<Vec<_>>().join("|");
        let digest = Sha256::digest(identity.as_bytes());
        digest.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Нормализация тега: trim + lowercase. Пустой/длинный — ошибка.
    fn normalize_courier_tag(tag: &str) -> Result<String, String> {
        let t = tag.trim().to_lowercase();
        if t.is_empty() { return Err("tag_empty".into()); }
        if t.chars().count() > 100 { return Err("tag_too_long".into()); }
        Ok(t)
    }

    /// Локальная установка тега (свой courier_id + хеш). true = добавлен.
    pub fn add_courier_tag(
        &self, provider: &str, courier_id: i64, courier_hash: &str, tag: &str,
    ) -> Result<bool, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let tag = Self::normalize_courier_tag(tag)?;
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO courier_tags(provider,courier_id,courier_hash,tag) VALUES(?1,?2,?3,?4)",
            params![provider, courier_id, courier_hash, tag],
        ).map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// Локальное снятие тега. true = был и снят.
    pub fn remove_courier_tag(&self, provider: &str, courier_hash: &str, tag: &str) -> Result<bool, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let tag = Self::normalize_courier_tag(tag)?;
        let n = self.conn.execute(
            "DELETE FROM courier_tags WHERE provider=?1 AND courier_hash=?2 AND tag=?3",
            params![provider, courier_hash, tag],
        ).map_err(|e| e.to_string())?;
        Ok(n > 0)
    }

    /// Теги конкретного курьера (по provider+courier_id).
    pub fn list_courier_tags(&self, provider: &str, courier_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT tag FROM courier_tags WHERE provider=?1 AND courier_id=?2 ORDER BY tag"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![provider, courier_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Теги по хешу личности — и свои, и пришедшие из группы.
    pub fn list_courier_tags_by_hash(&self, provider: &str, courier_hash: &str) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT tag FROM courier_tags WHERE provider=?1 AND courier_hash=?2 ORDER BY tag"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![provider, courier_hash], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Применить тег, пришедший из группы (по WS). courier_id неизвестен —
    /// NULL; UI достаёт такие теги через list_courier_tags_by_hash.
    pub fn apply_remote_courier_tag(&self, provider: &str, courier_hash: &str, tag: &str, add: bool) -> Result<bool, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let tag = Self::normalize_courier_tag(tag)?;
        if add {
            let n = self.conn.execute(
                "INSERT OR IGNORE INTO courier_tags(provider,courier_id,courier_hash,tag) VALUES(?1,NULL,?2,?3)",
                params![provider, courier_hash, tag],
            ).map_err(|e| e.to_string())?;
            Ok(n > 0)
        } else {
            // remove: сносим и свой, и удалённый экземпляр — тег снят глобально
            let n = self.conn.execute(
                "DELETE FROM courier_tags WHERE provider=?1 AND courier_hash=?2 AND tag=?3",
                params![provider, courier_hash, tag],
            ).map_err(|e| e.to_string())?;
            Ok(n > 0)
        }
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
        }, None).unwrap().id
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

    /// Посылка без courier_id в ответе панели (актуальная схема 2026-09 —
    /// поле больше не документировано) не должна затирать курьера в снапшоте.
    #[test]
    fn test_refresh_package_snapshots_keeps_courier_when_absent() {
        let (_dir, db) = test_db();
        let oid = make_order(&db, &make_profile(&db, 1));
        db.link_order_package(oid, "swat", 44, Some(7), None, None).unwrap();

        let pkgs: Vec<crate::stuffer::Package> = vec![
            serde_json::from_value(serde_json::json!({ "id": 44, "status": "checked" })).unwrap(),
        ];
        assert!(pkgs[0].courier_id.is_none());
        let n = db.refresh_package_snapshots("swat", &pkgs).unwrap();
        assert_eq!(n, 1);

        let link = db.list_links_for_order(oid).unwrap().remove(0);
        assert_eq!(link.status.as_deref(), Some("checked"));
        assert_eq!(link.courier_id, Some(7));
    }

    #[test]
    fn test_courier_identity_hash_normalizes() {
        let h1 = Database::courier_identity_hash("swat", "John  Doe", "1 Main  St", "NY", "NY", "10001");
        let h2 = Database::courier_identity_hash("swat", "john doe", "1 main st", "ny", "ny", "10001");
        assert_eq!(h1, h2, "регистр и лишние пробелы не влияют");
        assert_eq!(h1.len(), 64, "sha-256 hex");
        let h3 = Database::courier_identity_hash("other", "john doe", "1 main st", "ny", "ny", "10001");
        assert_ne!(h1, h3, "provider входит в хеш");
    }

    #[test]
    fn test_courier_tags_roundtrip() {
        let (_dir, db) = test_db();
        let hash = Database::courier_identity_hash("swat", "John Doe", "1 Main St", "NY", "NY", "10001");

        assert!(db.add_courier_tag("swat", 7, &hash, " Zoro.com ").unwrap());
        assert!(!db.add_courier_tag("swat", 7, &hash, "zoro.com").unwrap(), "дубль не добавляется");
        assert!(db.add_courier_tag("swat", 7, &hash, "bond").unwrap());

        assert_eq!(db.list_courier_tags("swat", 7).unwrap(), vec!["bond", "zoro.com"]);
        assert_eq!(db.list_courier_tags_by_hash("swat", &hash).unwrap(), vec!["bond", "zoro.com"]);

        assert!(db.remove_courier_tag("swat", &hash, "ZORO.COM").unwrap());
        assert!(!db.remove_courier_tag("swat", &hash, "zoro.com").unwrap(), "повторное снятие — false");
        assert_eq!(db.list_courier_tags("swat", 7).unwrap(), vec!["bond"]);
    }

    #[test]
    fn test_courier_tag_validation() {
        let (_dir, db) = test_db();
        let hash = "ab".repeat(32);
        assert_eq!(db.add_courier_tag("swat", 1, &hash, "   ").unwrap_err(), "tag_empty");
        let long = "x".repeat(101);
        assert_eq!(db.add_courier_tag("swat", 1, &hash, &long).unwrap_err(), "tag_too_long");
    }

    #[test]
    fn test_apply_remote_courier_tag() {
        let (_dir, db) = test_db();
        let hash = Database::courier_identity_hash("swat", "Jane Roe", "2 Oak Ave", "LA", "CA", "90001");

        // пришедший из группы тег: courier_id NULL, виден только по хешу
        assert!(db.apply_remote_courier_tag("swat", &hash, "zoro.com", true).unwrap());
        assert!(!db.apply_remote_courier_tag("swat", &hash, "zoro.com", true).unwrap(), "дубль");
        assert_eq!(db.list_courier_tags_by_hash("swat", &hash).unwrap(), vec!["zoro.com"]);
        assert!(db.list_courier_tags("swat", 7).unwrap().is_empty(), "по courier_id не виден");

        // локальный тег того же хеша + снятие из группы сносит оба
        assert!(db.add_courier_tag("swat", 7, &hash, "bond").unwrap());
        assert!(db.apply_remote_courier_tag("swat", &hash, "bond", false).unwrap());
        assert!(db.list_courier_tags_by_hash("swat", &hash).unwrap().iter().all(|t| t != "bond"));
        assert_eq!(db.list_courier_tags_by_hash("swat", &hash).unwrap(), vec!["zoro.com"]);

        // изоляция по provider
        assert!(db.list_courier_tags_by_hash("other", &hash).unwrap().is_empty());
    }

    // ── FEAT-011: реестр stuffer-аккаунтов ──────────────────────────────

    #[test]
    fn test_stuffer_accounts_roundtrip() {
        let (_dir, db) = test_db();
        assert!(db.list_stuffer_accounts().unwrap().is_empty());

        let id1 = db.add_stuffer_account("Main panel", "https://p1.example.com", "key-one").unwrap();
        let id2 = db.add_stuffer_account("Second", "", "key-two").unwrap();

        let all = db.list_stuffer_accounts().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].label, "Main panel");
        assert_eq!(all[0].provider, "swat", "провайдер по умолчанию");
        assert_eq!(all[0].base_url, "https://p1.example.com");
        assert_eq!(all[1].base_url, "", "пустой url → дефолт провайдера на бэкенде");

        let got = db.get_stuffer_account(id2).unwrap();
        assert_eq!(got.api_key, "key-two", "внутренний доступ видит ключ");

        db.delete_stuffer_account(id1).unwrap();
        assert_eq!(db.list_stuffer_accounts().unwrap().len(), 1);
        assert!(db.delete_stuffer_account(id1).is_err(), "повторное удаление — ошибка");
        assert!(db.get_stuffer_account(id1).is_err());
    }

    #[test]
    fn test_stuffer_account_validation() {
        let (_dir, db) = test_db();
        assert_eq!(db.add_stuffer_account("", "", "k").unwrap_err(), "stuffer_account_label_invalid");
        assert_eq!(db.add_stuffer_account("x".repeat(101).as_str(), "", "k").unwrap_err(), "stuffer_account_label_invalid");
        assert_eq!(db.add_stuffer_account("ok", "", "").unwrap_err(), "stuffer_account_key_empty");
        assert_eq!(db.add_stuffer_account("ok", "u".repeat(501).as_str(), "k").unwrap_err(), "stuffer_account_url_invalid");
    }

    #[test]
    fn test_stuffer_account_key_never_serialized() {
        let (_dir, db) = test_db();
        let id = db.add_stuffer_account("Sec", "", "super-secret-key").unwrap();
        let acc = db.get_stuffer_account(id).unwrap();
        let json = serde_json::to_value(&acc).unwrap();
        assert!(json.get("api_key").is_none(), "api_key не должен уходить на фронт");
        assert!(json.get("label").is_some());
    }
}
