// ─────────────────────────────────────────
//  Тестовые данные (seed) — для демо/онбординга.
//
//  Заполняет БД по ~3 разнообразных записи каждого типа, ИСПОЛЬЗУЯ штатные
//  insert-хелперы (со всем шифрованием и хешированием), а не сырой SQL. Это
//  гарантирует, что демо-данные неотличимы от настоящих: карты зашифрованы,
//  профили привязаны к картам, заказы — к профилям/магазинам/дропам.
//
//  Идемпотентно по факту: если в credit_cards уже есть строки, не сеет повторно,
//  чтобы не плодить дубли при повторном вызове.
// ─────────────────────────────────────────

impl Database {
    /// Есть ли уже пользовательские данные (чтобы не сеять поверх реальных).
    pub fn has_any_data(&self) -> bool {
        let cards: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM credit_cards", [], |r| r.get(0))
            .unwrap_or(0);
        let orders: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM orders", [], |r| r.get(0))
            .unwrap_or(0);
        cards > 0 || orders > 0
    }

    /// Заполнить БД тестовыми данными. Возвращает краткую сводку что создано.
    /// `force=false` — не сеет, если данные уже есть.
    pub fn seed_test_data(&self, force: bool) -> Result<String, String> {
        if self.is_locked() {
            return Err("database_locked".into());
        }
        if !force && self.has_any_data() {
            return Err("data_exists".into());
        }

        // ── 3 карты: разные банки, статусы, уровни ────────────────────────
        let cards = vec![
            CardInput {
                card_number: "4147202512340011".into(),
                expiry_date: Some("08/27".into()),
                cvv: Some("512".into()),
                holder_name: Some("James Carter".into()),
                billing_address: Some("742 Evergreen Terrace".into()),
                city: Some("Springfield".into()),
                state: Some("IL".into()),
                zip: Some("62704".into()),
                country: Some("US".into()),
                phone: Some("+1 217 555 0142".into()),
                email: Some("j.carter88@gmail.com".into()),
                ip_address: Some("73.24.118.9".into()),
                source: "dump".into(),
                domain: Some("bestbuy.com".into()),
                acquired_at: None,
            },
            CardInput {
                card_number: "5425233012340022".into(),
                expiry_date: Some("11/26".into()),
                cvv: Some("881".into()),
                holder_name: Some("Maria Gonzalez".into()),
                billing_address: Some("18 Sunset Blvd".into()),
                city: Some("Los Angeles".into()),
                state: Some("CA".into()),
                zip: Some("90028".into()),
                country: Some("US".into()),
                phone: Some("+1 323 555 0188".into()),
                email: Some("maria.g.la@outlook.com".into()),
                ip_address: Some("104.28.51.7".into()),
                source: "sniff".into(),
                domain: Some("walmart.com".into()),
                acquired_at: None,
            },
            CardInput {
                card_number: "378282246310005".into(),
                expiry_date: Some("03/28".into()),
                cvv: Some("1042".into()),
                holder_name: Some("Robert Sinclair".into()),
                billing_address: Some("500 Park Avenue".into()),
                city: Some("New York".into()),
                state: Some("NY".into()),
                zip: Some("10022".into()),
                country: Some("US".into()),
                phone: Some("+1 212 555 0199".into()),
                email: Some("rsinclair@protonmail.com".into()),
                ip_address: Some("66.108.14.201".into()),
                source: "manual".into(),
                domain: None,
                acquired_at: None,
            },
        ];
        self.insert_cards(cards)?;

        // Собираем id вставленных карт (по порядку created_at).
        let card_ids: Vec<i64> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM credit_cards ORDER BY id DESC LIMIT 3")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut v: Vec<i64> = rows.filter_map(|r| r.ok()).collect();
            v.reverse();
            v
        };

        // ── Проставим разные статусы картам, чтобы пул выглядел живым ─────
        if card_ids.len() >= 3 {
            let _ = self.conn.execute(
                "UPDATE credit_cards SET status='in_use', bank_name='Chase', card_type='visa', card_level='signature' WHERE id=?1",
                params![card_ids[0]],
            );
            let _ = self.conn.execute(
                "UPDATE credit_cards SET status='free', bank_name='Bank of America', card_type='mastercard', card_level='world' WHERE id=?1",
                params![card_ids[1]],
            );
            let _ = self.conn.execute(
                "UPDATE credit_cards SET status='dead', bank_name='Amex', card_type='amex', card_level='platinum' WHERE id=?1",
                params![card_ids[2]],
            );
        }

        // ── 3 магазина ────────────────────────────────────────────────────
        let shops = vec![
            ShopInput {
                name: "Best Buy".into(),
                url: "https://bestbuy.com".into(),
                category: "Electronics".into(),
                notes: "Требует AVS-совпадение".into(),
                requires_cvv_match: true,
                blocks_vpn: true,
                phone_must_match: false,
                accepts_amex: true,
                requires_avs: true,
                high_cancel_risk: false,
            },
            ShopInput {
                name: "Walmart".into(),
                url: "https://walmart.com".into(),
                category: "Retail".into(),
                notes: "Лёгкий, но частые отмены при высоком чеке".into(),
                requires_cvv_match: false,
                blocks_vpn: false,
                phone_must_match: false,
                accepts_amex: true,
                requires_avs: false,
                high_cancel_risk: true,
            },
            ShopInput {
                name: "Newegg".into(),
                url: "https://newegg.com".into(),
                category: "Electronics".into(),
                notes: "Строгий антифрод, нужен чистый прокси".into(),
                requires_cvv_match: true,
                blocks_vpn: true,
                phone_must_match: true,
                accepts_amex: false,
                requires_avs: true,
                high_cancel_risk: false,
            },
        ];
        let mut shop_ids = Vec::new();
        for s in &shops {
            if let Ok(shop) = self.create_shop(s) {
                shop_ids.push(shop.id);
            }
        }

        // ── 3 email в пул ────────────────────────────────────────────────
        for (email, label) in [
            ("orders.jc2024@gmail.com", "Основной"),
            ("shopping.mg@outlook.com", "Резерв"),
            ("rs.purchases@protonmail.com", "Amex"),
        ] {
            let _ = self.add_email(email, Some(label.to_string()), None);
        }

        // ── 3 прокси ─────────────────────────────────────────────────────
        let proxies = vec![
            ProxyInput {
                host: "residential.us-east.io".into(),
                port: 8080,
                proxy_type: "http".into(),
                username: "user_il".into(),
                password: "demo_pass_1".into(),
                label: "US-East · Residential".into(),
                notes: "Illinois, чистый".into(),
            },
            ProxyInput {
                host: "residential.us-west.io".into(),
                port: 8080,
                proxy_type: "socks5".into(),
                username: "user_ca".into(),
                password: "demo_pass_2".into(),
                label: "US-West · Residential".into(),
                notes: "California".into(),
            },
            ProxyInput {
                host: "mobile.us.io".into(),
                port: 3128,
                proxy_type: "http".into(),
                username: "user_ny".into(),
                password: "demo_pass_3".into(),
                label: "US · Mobile 4G".into(),
                notes: "New York, LTE".into(),
            },
        ];
        for p in &proxies {
            let _ = self.add_proxy(p);
        }

        // ── 3 профиля (по карте) + дроп у каждого ─────────────────────────
        let drops = [
            DropInput {
                recipient_name: "James Carter".into(),
                address: "742 Evergreen Terrace".into(),
                city: "Springfield".into(),
                state: Some("IL".into()),
                zip: "62704".into(),
                country: "US".into(),
                phone: Some("+1 217 555 0142".into()),
            },
            DropInput {
                recipient_name: "Maria Gonzalez".into(),
                address: "18 Sunset Blvd".into(),
                city: "Los Angeles".into(),
                state: Some("CA".into()),
                zip: "90028".into(),
                country: "US".into(),
                phone: Some("+1 323 555 0188".into()),
            },
            DropInput {
                recipient_name: "R. Sinclair".into(),
                address: "500 Park Avenue".into(),
                city: "New York".into(),
                state: Some("NY".into()),
                zip: "10022".into(),
                country: "US".into(),
                phone: Some("+1 212 555 0199".into()),
            },
        ];
        let mut profile_ids = Vec::new();
        for (i, &cid) in card_ids.iter().enumerate() {
            if let Ok(profile) = self.create_profile(cid, Some(format!("Профиль #{}", i + 1))) {
                let _ = self.add_drop(&profile.id, &drops[i]);
                profile_ids.push(profile.id);
            }
        }

        // ── 3 заказа: разные статусы, магазины, суммы ─────────────────────
        if !profile_ids.is_empty() && !shop_ids.is_empty() {
            // Индекс профиля/магазина берём по модулю — если чего-то создалось
            // меньше 3, заказы всё равно распределятся без паники и без
            // временных значений в borrow (см. E0716 при inline .get().unwrap_or).
            let pick_pid = |i: usize| profile_ids[i % profile_ids.len()].clone();
            let pick_sid = |i: usize| shop_ids[i % shop_ids.len()];

            let plan: Vec<(&str, &str, &str, Vec<OrderItemInput>)> = vec![
                (
                    "delivered",
                    "1Z999AA10123456784",
                    "UPS",
                    vec![OrderItemInput {
                        name: "MacBook Air M3".into(),
                        sku: "MBA-M3-256".into(),
                        qty: 1,
                        price: 1099.0,
                    }],
                ),
                (
                    "shipped",
                    "9400111899223456781234",
                    "USPS",
                    vec![OrderItemInput {
                        name: "iPhone 15 Pro".into(),
                        sku: "IP15P-256".into(),
                        qty: 1,
                        price: 999.0,
                    }],
                ),
                (
                    "pending",
                    "",
                    "",
                    vec![
                        OrderItemInput {
                            name: "RTX 4080 GPU".into(),
                            sku: "GPU-4080".into(),
                            qty: 1,
                            price: 1199.0,
                        },
                        OrderItemInput {
                            name: "32GB DDR5 Kit".into(),
                            sku: "RAM-32-D5".into(),
                            qty: 2,
                            price: 145.0,
                        },
                    ],
                ),
            ];

            for (i, (status, track, carrier, items)) in plan.into_iter().enumerate() {
                let pid = pick_pid(i);
                let input = OrderInput {
                    profile_id: pid.clone(),
                    shop_id: pick_sid(i),
                    drop_id: None,
                    email_pool_id: None,
                    proxy_id: None,
                    order_number: Some(format!("TEST-{}", &pid[..6.min(pid.len())])),
                    notes: Some("Тестовый заказ".into()),
                    items,
                };
                if let Ok(order) = self.create_order(&input) {
                    // Проставляем статус и трек после создания (create_order ставит 'pending').
                    if status != "pending" {
                        let _ = self.conn.execute(
                            "UPDATE orders SET status=?1, tracking_number=?2, carrier=?3 WHERE id=?4",
                            params![status, track, carrier, order.id],
                        );
                    }
                }
            }
        }

        Ok(format!(
            "Создано: {} карт, {} магазинов, {} профилей, 3 email, 3 прокси, заказы",
            card_ids.len(),
            shop_ids.len(),
            profile_ids.len()
        ))
    }
}
