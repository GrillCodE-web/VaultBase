// ─────────────────────────────────────────
//  Auto-backup helper
// ─────────────────────────────────────────

pub fn create_backup(db_path: &str) -> Result<String, String> {
        let home = std::env::var("HOME").unwrap_or_default();
        let backup_dir = format!("{}/.config/vaultbase/backups", home);
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        let now = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let dest = format!("{}/backup_{}.db", backup_dir, now);
        std::fs::copy(db_path, &dest).map_err(|e| e.to_string())?;
        // Keep only last 10 backups
        let mut entries: Vec<_> = std::fs::read_dir(&backup_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("backup_"))
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for old in entries.iter().rev().skip(10) {
            let _ = std::fs::remove_file(old.path());
        }
        Ok(dest)
    }

    // ─────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────

    fn mask_name(name: &str) -> String {
    // FIX B53: используем chars() для Unicode-безопасного среза (кириллица, CJK и т.д.)
    let parts: Vec<&str> = name.split_whitespace().collect();
    parts.iter().enumerate().map(|(i, w)| {
        if i == 0 { w.to_string() }
        else {
            let first_char_len = w.chars().next().map(|c| c.len_utf8()).unwrap_or(0);
            format!("{}.", &w[..first_char_len])
        }
    }).collect::<Vec<_>>().join(" ")
    }

    // ─────────────────────────────────────────
    //  init_db — migration runner
    // ─────────────────────────────────────────

    // DB-001: Run a single migration inside a SAVEPOINT for safe rollback
    fn run_migration(conn: &Connection, target: u32, f: fn(&Connection) -> SqlResult<()>) -> SqlResult<()> {
        let sp_name = format!("migration_v{}", target);
        conn.execute_batch(&format!("SAVEPOINT {}", sp_name))?;
        match f(conn) {
            Ok(()) => {
                conn.execute_batch(&format!("RELEASE {}", sp_name))?;
                conn.execute_batch(&format!("PRAGMA user_version = {}", target))?;
                Ok(())
            }
            Err(e) => {
                let _ = conn.execute_batch(&format!("ROLLBACK TO {}", sp_name));
                Err(e)
            }
        }
    }

    const LATEST_VERSION: u32 = 29;

    pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let mut version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version > LATEST_VERSION {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    type MigrationFn = fn(&Connection) -> SqlResult<()>;
    let migrations: &[(u32, MigrationFn)] = &[
        (1, migration_v1), (2, migration_v2), (3, migration_v3),
        (4, migration_v4), (5, migration_v5), (6, migration_v6),
        (7, migration_v7), (8, migration_v8), (9, migration_v9),
        (10, migration_v10), (11, migration_v11), (12, migration_v12),
        (13, migration_v13), (14, migration_v14), (15, migration_v15),
        (16, migration_v16), (17, migration_v17), (18, migration_v18),
        (19, migration_v19), (20, migration_v20), (21, migration_v21), (22, migration_v22),
        (23, migration_v23), (24, migration_v24), (25, migration_v25),
        (26, migration_v26), (27, migration_v27), (28, migration_v28), (29, migration_v29),
    ];
    for &(target, f) in migrations {
        if version < target {
            run_migration(conn, target, f)?;
            version = target;
        }
    }
    Ok(())
    }

    fn migration_v1(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS credit_cards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            card_number     TEXT,
            expiry_date     TEXT,
            cvv             TEXT,
            holder_name     TEXT,
            billing_address TEXT,
            city            TEXT,
            state           TEXT,
            zip             TEXT,
            country         TEXT,
            phone           TEXT,
            email           TEXT,
            ip_address      TEXT,
            bin             TEXT,
            last4           TEXT,
            bank_name       TEXT,
            card_type       TEXT,
            card_level      TEXT,
            status          TEXT NOT NULL DEFAULT 'free',
            source          TEXT NOT NULL DEFAULT 'dump',
            notes           TEXT,
            card_hash       TEXT UNIQUE,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_cards_status  ON credit_cards(status);
        CREATE INDEX IF NOT EXISTS idx_cards_bin     ON credit_cards(bin);
        CREATE INDEX IF NOT EXISTS idx_cards_last4   ON credit_cards(last4);
        CREATE INDEX IF NOT EXISTS idx_cards_country ON credit_cards(country);
        CREATE INDEX IF NOT EXISTS idx_cards_source  ON credit_cards(source);

        CREATE TABLE IF NOT EXISTS profiles (
            id         TEXT PRIMARY KEY,
            card_id    INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
            notes      TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_profiles_card ON profiles(card_id);

        CREATE TABLE IF NOT EXISTS drops (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id     TEXT REFERENCES profiles(id) ON DELETE CASCADE,
            recipient_name TEXT NOT NULL DEFAULT '',
            address        TEXT NOT NULL DEFAULT '',
            city           TEXT NOT NULL DEFAULT '',
            state          TEXT,
            zip            TEXT NOT NULL DEFAULT '',
            country        TEXT NOT NULL DEFAULT '',
            phone          TEXT,
            is_primary     BOOLEAN NOT NULL DEFAULT 0,
            created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_drops_profile ON drops(profile_id);

        CREATE TABLE IF NOT EXISTS imap_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
            host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 993,
            login TEXT NOT NULL, password TEXT,
            poll_interval INTEGER NOT NULL DEFAULT 5,
            is_active BOOLEAN NOT NULL DEFAULT 1, last_checked DATETIME
        );

        CREATE TABLE IF NOT EXISTS email_pool (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            email           TEXT,
            email_hash      TEXT UNIQUE,
            label           TEXT,
            imap_account_id INTEGER REFERENCES imap_accounts(id) ON DELETE SET NULL,
            is_blocked      BOOLEAN NOT NULL DEFAULT 0,
            notes           TEXT,
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS proxies (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            host       TEXT NOT NULL,
            port       INTEGER NOT NULL,
            proxy_type TEXT NOT NULL DEFAULT 'http',
            username   TEXT,
            password   TEXT,
            label      TEXT,
            is_blocked BOOLEAN NOT NULL DEFAULT 0,
            notes      TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shops (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            name               TEXT NOT NULL,
            domain             TEXT UNIQUE NOT NULL,
            url                TEXT NOT NULL DEFAULT '',
            category           TEXT,
            notes              TEXT,
            requires_cvv_match BOOLEAN NOT NULL DEFAULT 0,
            blocks_vpn         BOOLEAN NOT NULL DEFAULT 0,
            phone_must_match   BOOLEAN NOT NULL DEFAULT 0,
            accepts_amex       BOOLEAN NOT NULL DEFAULT 0,
            requires_avs       BOOLEAN NOT NULL DEFAULT 0,
            high_cancel_risk   BOOLEAN NOT NULL DEFAULT 0,
            created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shop_products (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id      INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
            asin         TEXT,
            name         TEXT NOT NULL,
            amazon_price REAL,
            shop_price   REAL,
            url          TEXT,
            notes        TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
            shop_id       INTEGER REFERENCES shops(id) ON DELETE SET NULL,
            drop_id       INTEGER REFERENCES drops(id) ON DELETE SET NULL,
            email_pool_id INTEGER REFERENCES email_pool(id) ON DELETE SET NULL,
            proxy_id      INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            order_number  TEXT,
            status        TEXT NOT NULL DEFAULT 'pending',
            items_json    TEXT,
            total_amount  REAL,
            tracking_number TEXT,
            carrier       TEXT,
            notes         TEXT,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_orders_profile ON orders(profile_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_shop    ON orders(shop_id);

        CREATE TABLE IF NOT EXISTS shop_footprints (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id     INTEGER REFERENCES shops(id) ON DELETE CASCADE,
            shop_domain TEXT,
            order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            email_id    INTEGER REFERENCES email_pool(id) ON DELETE SET NULL,
            proxy_id    INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            email_hash  TEXT,
            ip_hash     TEXT,
            drop_hash   TEXT,
            bin         TEXT,
            phone_hash  TEXT,
            name_hash   TEXT,
            synced      BOOLEAN NOT NULL DEFAULT 0,
            user_token  TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            -- PHASE 1: Footprint V2 (Collective Mind)
            order_status TEXT,
            installation_id_hash TEXT
        );
        -- Индексы для footprint V2
        CREATE INDEX IF NOT EXISTS idx_footprints_synced ON shop_footprints(synced);
        CREATE INDEX IF NOT EXISTS idx_footprints_shop   ON shop_footprints(shop_domain);
        CREATE INDEX IF NOT EXISTS idx_footprints_status ON shop_footprints(order_status);
        CREATE INDEX IF NOT EXISTS idx_footprints_install ON shop_footprints(installation_id_hash);

        -- PHASE 5: Automation Config
        CREATE TABLE IF NOT EXISTS automation_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        -- Default automation config values
        INSERT OR IGNORE INTO automation_config (key, value, description) VALUES
            ('autolock_timeout', '300', 'seconds before auto-lock'),
            ('sync_interval', '120', 'seconds between footprint sync'),
            ('imap_poll_interval', '60', 'seconds between IMAP polls'),
            ('tracking_interval', '1800', 'seconds between tracking checks'),
            ('proxy_check_interval', '1800', 'seconds between proxy health checks'),
            ('max_sync_failures', '5', 'failures before pause'),
            ('auto_archive_enabled', 'true', 'enable auto-archiving'),
            ('burned_card_threshold', '3', 'orders before archive'),
            ('decline_threshold', '5', 'consecutive declines before archive'),
            ('eco_mode', 'false', 'reduce frequency to save resources');
        -- FIX DB-H03: Removed duplicate index creation (already created above at lines 4562-4563)

        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
            description TEXT, entity_type TEXT, entity_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_log_event  ON activity_log(event_type);
        CREATE INDEX IF NOT EXISTS idx_log_entity ON activity_log(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS order_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            shop_tag TEXT, items_json TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    "#)?;
    Ok(())
    }

    fn migration_v2(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS imap_messages (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id              INTEGER REFERENCES imap_accounts(id) ON DELETE CASCADE,
            message_uid             TEXT,
            subject                 TEXT,
            from_email              TEXT,
            received_at             DATETIME,
            extracted_order_number  TEXT,
            extracted_tracking      TEXT,
            action_taken            TEXT,
            processed               BOOLEAN NOT NULL DEFAULT 0,
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_imap_msg_account ON imap_messages(account_id);
        CREATE INDEX IF NOT EXISTS idx_imap_msg_uid     ON imap_messages(account_id, message_uid);
    "#)?;
    Ok(())
    }

    fn migration_v4(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS profile_templates (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            country      TEXT,
            state        TEXT,
            city         TEXT,
            phone_prefix TEXT,
            source       TEXT,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    "#)?;
    Ok(())
    }

    fn migration_v5(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS bin_cache (
            bin       TEXT PRIMARY KEY,
            data_json TEXT NOT NULL,
            cached_at INTEGER NOT NULL
        );
    "#)?;
    Ok(())
    }

    fn migration_v3(conn: &Connection) -> SqlResult<()> {
    // Add new columns to imap_messages (ALTER TABLE is safe — SQLite ignores if column exists via IF NOT EXISTS workaround)
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN body TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN folder TEXT NOT NULL DEFAULT 'INBOX';");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN to_email TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN headers_json TEXT;");
    let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN message_id TEXT;");
    conn.execute_batch(r#"
        CREATE INDEX IF NOT EXISTS idx_imap_folder ON imap_messages(account_id, folder, is_read);

        CREATE TABLE IF NOT EXISTS smtp_configs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            label        TEXT NOT NULL,
            host         TEXT NOT NULL,
            port         INTEGER NOT NULL DEFAULT 587,
            login        TEXT NOT NULL,
            password     TEXT NOT NULL DEFAULT '',
            use_tls      INTEGER NOT NULL DEFAULT 0,
            use_starttls INTEGER NOT NULL DEFAULT 1,
            is_active    INTEGER NOT NULL DEFAULT 1,
            created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sent_emails (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            smtp_config_id INTEGER REFERENCES smtp_configs(id) ON DELETE SET NULL,
            from_email     TEXT,
            to_email       TEXT NOT NULL,
            subject        TEXT,
            body_text      TEXT,
            status         TEXT NOT NULL DEFAULT 'sent',
            error_message  TEXT,
            sent_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sent_emails_config ON sent_emails(smtp_config_id);
    "#)?;
    Ok(())
    }

    fn migration_v6(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS catalog_items (
                id          INTEGER PRIMARY KEY,
                name        TEXT NOT NULL,
                asin        TEXT,
                price       REAL,
                pct         INTEGER DEFAULT 30,
                category    TEXT,
                notes_en    TEXT,
                stop        INTEGER DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_catalog_items_name ON catalog_items(name);
            CREATE INDEX IF NOT EXISTS idx_catalog_items_asin ON catalog_items(asin);

            CREATE TABLE IF NOT EXISTS catalog_shops (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                domain      TEXT UNIQUE NOT NULL,
                category    TEXT,
                score       INTEGER DEFAULT 0,
                ship_us     INTEGER DEFAULT 0,
                fraud_level TEXT,
                top_brands  TEXT,
                top_products TEXT,
                excluded    INTEGER DEFAULT 0,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_catalog_shops_domain ON catalog_shops(domain);
        ")
    }

    fn migration_v7(conn: &Connection) -> SqlResult<()> {
        // Add last_checked column to proxies table (ALTER TABLE is safe — SQLite ignores if column exists)
        let _ = conn.execute_batch("ALTER TABLE proxies ADD COLUMN last_checked DATETIME;");
        // G2: proxy-shop bindings table
        conn.execute_batch("CREATE TABLE IF NOT EXISTS proxy_shop_bindings (proxy_id INTEGER NOT NULL, shop_id INTEGER NOT NULL, PRIMARY KEY(shop_id));")?;
        Ok(())
    }

    fn migration_v8(conn: &Connection) -> SqlResult<()> {
        // PHASE 1: Footprint Sync V2 — добавляем колонки для order_status и installation_id_hash
        let _ = conn.execute_batch("ALTER TABLE shop_footprints ADD COLUMN order_status TEXT;");
        let _ = conn.execute_batch("ALTER TABLE shop_footprints ADD COLUMN installation_id_hash TEXT;");
        // Индексы для производительности при фильтрации по статусам
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_footprints_order_status ON shop_footprints(order_status);");
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_footprints_installation ON shop_footprints(installation_id_hash);");

        // PHASE 2: Shop Statistics Enhancement
        // Add carrier_type column for better carrier tracking
        let _ = conn.execute_batch("ALTER TABLE orders ADD COLUMN carrier_type TEXT;");
        // Add indexes for performance
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_orders_carrier ON orders(carrier_type);");
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);");
        Ok(())
    }

    fn migration_v9(conn: &Connection) -> SqlResult<()> {
        // P2-DOMAIN: Add domain and acquired_at columns to credit_cards
        let _ = conn.execute_batch("ALTER TABLE credit_cards ADD COLUMN domain TEXT;");
        let _ = conn.execute_batch("ALTER TABLE credit_cards ADD COLUMN acquired_at DATETIME;");
        // Index for domain filtering and grouping
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_cards_domain ON credit_cards(domain);");
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_cards_acquired_at ON credit_cards(acquired_at);");
        Ok(())
    }

    fn migration_v10(conn: &Connection) -> SqlResult<()> {
        // ── Users ──────────────────────────────────────────────────────────────
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                role         TEXT NOT NULL DEFAULT 'operator',
                is_active    BOOLEAN NOT NULL DEFAULT 1,
                must_change_password BOOLEAN NOT NULL DEFAULT 0,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
                last_seen    DATETIME
            );
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);

            -- Per-user permission overrides (admin always has all, operators get defaults + overrides)
            CREATE TABLE IF NOT EXISTS user_permissions (
                user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission_key TEXT NOT NULL,
                granted        BOOLEAN NOT NULL DEFAULT 1,
                updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, permission_key)
            );

            -- Session tokens (one user can have multiple sessions on different PCs)
            CREATE TABLE IF NOT EXISTS user_sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token       TEXT NOT NULL UNIQUE,
                ip_address  TEXT,
                device_info TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at  DATETIME
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_token   ON user_sessions(token);
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);

            -- Detailed activity log per user
            CREATE TABLE IF NOT EXISTS user_activity (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                action_type TEXT NOT NULL,
                entity_type TEXT,
                entity_id   TEXT,
                details     TEXT,
                ip_address  TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_user_activity_user    ON user_activity(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_activity_action  ON user_activity(action_type);
            CREATE INDEX IF NOT EXISTS idx_user_activity_created ON user_activity(created_at);

            -- Card assignments: who took which card
            CREATE TABLE IF NOT EXISTS card_assignments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id     INTEGER NOT NULL UNIQUE REFERENCES credit_cards(id) ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_card_assign_user ON card_assignments(user_id);
            CREATE INDEX IF NOT EXISTS idx_card_assign_card ON card_assignments(card_id);
        "#)?;

        // Safe ALTER TABLE additions (ignored if column already exists)
        let _ = conn.execute_batch("ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT 0;");

        Ok(())
    }

    // DB-003/PERF-011/PERF-012: Additional indexes, VACUUM schedule marker
    fn migration_v11(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            -- PERF-011: Index for email search
            CREATE INDEX IF NOT EXISTS idx_cards_email ON credit_cards(email);

            -- PERF-011: Index for card status filtering (most common filter)
            CREATE INDEX IF NOT EXISTS idx_cards_status ON credit_cards(status);

            -- PERF-011: Index for orders by date (dashboard, reports)
            CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

            -- PERF-011: Index for orders by status
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

            -- PERF-011: Index for orders by shop (domain reports)
            CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop);

            -- DB-008: Index for activity log entity lookup
            CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

            -- Store last VACUUM time
            CREATE TABLE IF NOT EXISTS _maintenance (
                key   TEXT PRIMARY KEY,
                value TEXT
            );
            INSERT OR IGNORE INTO _maintenance (key, value) VALUES ('last_vacuum', '');
        "#)?;
        Ok(())
    }

    fn migration_v12(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            -- DB-003: Trigger-based CHECK for card status values
            CREATE TRIGGER IF NOT EXISTS trg_card_status_check
            BEFORE UPDATE OF status ON credit_cards
            BEGIN
                SELECT CASE
                    WHEN NEW.status NOT IN ('free','in_use','burned','reserved','frozen')
                    THEN RAISE(ABORT, 'invalid card status')
                END;
            END;

            -- DB-003: Trigger-based CHECK for order status values
            CREATE TRIGGER IF NOT EXISTS trg_order_status_check
            BEFORE UPDATE OF status ON orders
            BEGIN
                SELECT CASE
                    WHEN NEW.status NOT IN ('pending','processing','shipped','delivered','returned','cancelled','refunded','chargeback')
                    THEN RAISE(ABORT, 'invalid order status')
                END;
            END;
        "#)?;
        Ok(())
    }

    // IMAP-ROUTING/HEALTH: маршрут «домен = почта» (уникально, без повторов),
    // health-поля на аккаунте, домен отправителя на сообщении.
    fn migration_v13(conn: &Connection) -> SqlResult<()> {
        // Здоровье ящика: fail_count >= 3 → «умер», нужен ручной вход
        let _ = conn.execute_batch("ALTER TABLE imap_accounts ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;");
        let _ = conn.execute_batch("ALTER TABLE imap_accounts ADD COLUMN last_error TEXT;");
        let _ = conn.execute_batch("ALTER TABLE imap_accounts ADD COLUMN last_ok DATETIME;");

        // Маршрут домен → ящик. PRIMARY KEY на domain = запрет повторов:
        // один домен обслуживает ровно один IMAP-аккаунт.
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS imap_domain_routes (
                domain          TEXT PRIMARY KEY,
                imap_account_id INTEGER NOT NULL REFERENCES imap_accounts(id) ON DELETE CASCADE,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_domain_route_account ON imap_domain_routes(imap_account_id);
        "#)?;

        // imap_messages: домен отправителя (zoro.com) — по нему фильтруют вид
        let _ = conn.execute_batch("ALTER TABLE imap_messages ADD COLUMN from_domain TEXT;");
        let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_imap_msg_domain ON imap_messages(from_domain);");
        Ok(())
    }

    fn migration_v14(conn: &Connection) -> SqlResult<()> {
        // FIX TEST-007: триггер v12 разрешал ('free','in_use','burned','reserved','frozen'),
        // а приложение работает со статусами ('free','in_use','archive','dead') —
        // WS-синхронизация dead/archive молча отклонялась БД. Пересоздаём триггер
        // с реальным словарём статусов.
        conn.execute_batch(r#"
            DROP TRIGGER IF EXISTS trg_card_status_check;
            CREATE TRIGGER trg_card_status_check
            BEFORE UPDATE OF status ON credit_cards
            BEGIN
                SELECT CASE
                    WHEN NEW.status NOT IN ('free','in_use','archive','dead')
                    THEN RAISE(ABORT, 'invalid card status')
                END;
            END;
        "#)?;
        Ok(())
    }



    // FEAT-009: привязка посылок внешней панели (stuffer) к заказам.
    // Сама посылка живёт на панели; локально — связь + снапшот
    // (courier/track/status) для офлайн-отображения цепочки
    // карта → профиль → заказ → посылка → курьер.
    fn migration_v15(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS order_package_link (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                provider   TEXT NOT NULL DEFAULT 'swat',
                package_id INTEGER NOT NULL,
                courier_id INTEGER,
                track      TEXT,
                status     TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, package_id)
            );
            CREATE INDEX IF NOT EXISTS idx_opl_order ON order_package_link(order_id);
        "#)?;
        Ok(())
    }

    // FEAT-010: локальные теги курьеров ("использован под zoro.com").
    // courier_hash — SHA-256 нормализованной личности курьера
    // (provider|name|address1|city|state|zip) — по нему применяются
    // приходящие из группы теги, не раскрывая данные курьера серверу.
    // ВНИМАНИЕ: ветка agent/upanel (FEAT-018) тоже несёт миграцию "v15"
    // (upanel_connections) — при её влитии перенумеровать её в v17.
    fn migration_v16(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS courier_tags (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                provider     TEXT NOT NULL DEFAULT 'swat',
                courier_id   INTEGER,
                courier_hash TEXT NOT NULL,
                tag          TEXT NOT NULL,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, courier_hash, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_courier_tags_hash ON courier_tags(courier_hash);
            CREATE INDEX IF NOT EXISTS idx_courier_tags_courier ON courier_tags(provider, courier_id);
        "#)?;
        Ok(())
    }

    // MGR-006: кеш новостей и приоритетов шопов от менеджера. Сервер фильтрует
    // по таргетингу, воркер хранит локальный снимок + отметки о прочтении.
    fn migration_v17(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS manager_news (
                id           INTEGER PRIMARY KEY,
                severity     TEXT NOT NULL DEFAULT 'info',
                title        TEXT NOT NULL,
                body         TEXT,
                published_at TEXT,
                expires_at   TEXT,
                is_read      INTEGER NOT NULL DEFAULT 0,
                fetched_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS shop_priorities (
                shop_domain TEXT PRIMARY KEY,
                weight      INTEGER NOT NULL DEFAULT 5,
                notes       TEXT DEFAULT '',
                updated_at  TEXT
            );
        "#)?;
        Ok(())
    }

    // FEAT-018: сохранённые подключения к uPanel API (PPTP-серверы).
    // api_token хранится зашифрованным (AES-256-GCM, encryption.rs) —
    // наружу отдаётся только маска token_preview.
    // NOTE: на ветке была "v15"; при влитии в main перенумерована в v18 —
    // v15/v16/v17 уже заняты (FEAT-009, FEAT-010, MGR-006).
    fn migration_v18(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS upanel_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                base_url TEXT NOT NULL,
                api_token TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                last_check_at TEXT,
                last_check_status TEXT,
                last_check_error TEXT,
                last_http_code INTEGER,
                last_latency_ms INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    // FEAT-011: реестр stuffer-аккаунтов с индивидуальными API-ключами.
    // Общий список курьеров агрегируется по всем аккаунтам; операции с
    // курьером выполняются ключом его аккаунта. api_key — секрет (БД сама
    // зашифрована SQLCipher; на фронт ключ не сериализуется — см. models.rs).
    // Легаси-ключ из config (stuffer_api_key) остаётся «аккаунтом по
    // умолчанию» (id=0 в общем списке) — мигрировать его сюда не нужно.
    fn migration_v19(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS stuffer_accounts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                label      TEXT NOT NULL,
                provider   TEXT NOT NULL DEFAULT 'swat',
                base_url   TEXT NOT NULL DEFAULT '',
                api_key    TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        "#)?;
        Ok(())
    }

    // FIX FEAT-002: триггер v12 разрешал ('pending','processing','shipped','delivered',
    // 'returned','cancelled','refunded','chargeback'), а приложение работает со статусами
    // ('pending','shipped','delivered','declined','cancelled','failed') — update_order_status
    // на 'declined'/'failed' отклонялся БД, статистика неудач risk-факторов была мёртвой.
    // Пересоздаём триггер с объединением словарей (аддитивно, старые значения не ломаются).
    fn migration_v20(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            DROP TRIGGER IF EXISTS trg_order_status_check;
            CREATE TRIGGER trg_order_status_check
            BEFORE UPDATE OF status ON orders
            BEGIN
                SELECT CASE
                    WHEN NEW.status NOT IN ('pending','processing','shipped','delivered','returned','cancelled','refunded','chargeback','declined','failed')
                    THEN RAISE(ABORT, 'invalid order status')
                END;
            END;
        "#)?;
        Ok(())
    }

    // MGR-014: фундамент данных под пул-модель и командную стату менеджера.
    // 1) orders.created_by — кто оформил заказ (backfill: владелец карты профиля
    //    из card_assignments — единственная доступная ретроатрибуция, документируем
    //    как приближение для истории до v21).
    // 2) order_status_history — структурная история переходов статусов заказа
    //    (time-in-status у менеджера вместо парсинга activity_log).
    // 3) card_status_events — структурные переходы статусов карт
    //    (used/dead в daily_stats больше не зависят от формата текстовых строк).
    // Причина деклайна — необязательный ручной ввод (reason, NULL по умолчанию).
    fn migration_v21(conn: &Connection) -> SqlResult<()> {
        // ALTER вынесен из batch и ошибки игнорируются (как остальные ALTER-ы
        // в этом файле): колонка может уже существовать у БД, чей user_version
        // был потерян при sqlcipher_export до фикса его переноса.
        let _ = conn.execute_batch(
            "ALTER TABLE orders ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;"
        );
        conn.execute_batch(r#"
            CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);

            CREATE TABLE IF NOT EXISTS order_status_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                from_status TEXT,
                to_status   TEXT NOT NULL,
                changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                source      TEXT NOT NULL DEFAULT 'user',
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_osh_order  ON order_status_history(order_id);
            CREATE INDEX IF NOT EXISTS idx_osh_status ON order_status_history(to_status);
            CREATE INDEX IF NOT EXISTS idx_osh_time   ON order_status_history(created_at);

            CREATE TABLE IF NOT EXISTS card_status_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id     INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
                from_status TEXT,
                to_status   TEXT NOT NULL,
                changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                reason      TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_cse_card ON card_status_events(card_id);
            CREATE INDEX IF NOT EXISTS idx_cse_to   ON card_status_events(to_status);
            CREATE INDEX IF NOT EXISTS idx_cse_time ON card_status_events(created_at);
        "#)?;
        // Backfill: автор заказа ≈ владелец карты профиля (card_assignments
        // уникальны по card_id — на момент заказа карта была у одного юзера).
        conn.execute_batch(
            "UPDATE orders SET created_by = (
                SELECT ca.user_id FROM profiles p
                JOIN card_assignments ca ON ca.card_id = p.card_id
                WHERE p.id = orders.profile_id
                LIMIT 1
            ) WHERE created_by IS NULL;",
        )?;
        Ok(())
    }

    // MGR-015: локальная очередь неотправленных телеметрических конвертов.
    // Воркер неделями офлайн — отчёты не теряются: неудачная отправка кладёт
    // запечатанный конверт в outbox, успешная отправка вымывает очередь (FIFO,
    // кап по числу строк в коде). Хранится уже запечатанный JSON-тело —
    // сервер/БД не видят plaintext и при ретрае.
    fn migration_v22(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS telemetry_outbox (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT NOT NULL,
                ref_date   TEXT,
                body_json  TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_toutbox_kind_date
                ON telemetry_outbox(kind, COALESCE(ref_date, ''));
            CREATE INDEX IF NOT EXISTS idx_toutbox_time ON telemetry_outbox(created_at);
        "#)?;
        Ok(())
    }

    // FEAT-004: IF-THEN правила автоматизации. automation_rules — сами правила
    // (условия/действия — валидируемые JSON-массивы, движок в _automation.rs);
    // automation_rule_runs — аудит каждого срабатывания (какие действия
    // применились либо с какой ошибкой упали). Ошибки правил не прерывают
    // бизнес-поток смены статуса заказа — фиксируются здесь и в last_error.
    fn migration_v23(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS automation_rules (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL UNIQUE,
                description     TEXT,
                trigger_type    TEXT NOT NULL DEFAULT 'order_status_changed',
                conditions_json TEXT NOT NULL DEFAULT '[]',
                actions_json    TEXT NOT NULL DEFAULT '[]',
                enabled         BOOLEAN NOT NULL DEFAULT 1,
                times_triggered INTEGER NOT NULL DEFAULT 0,
                last_triggered  DATETIME,
                last_error      TEXT,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled, trigger_type);

            CREATE TABLE IF NOT EXISTS automation_rule_runs (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                rule_id         INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
                order_id        INTEGER REFERENCES orders(id) ON DELETE SET NULL,
                card_id         INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
                trigger_value   TEXT,
                actions_applied TEXT,
                status          TEXT NOT NULL DEFAULT 'success',
                error_message   TEXT,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_arr_rule ON automation_rule_runs(rule_id);
            CREATE INDEX IF NOT EXISTS idx_arr_time ON automation_rule_runs(created_at);
        "#)?;
        Ok(())
    }

    // REDESIGN-05-5B1: связка локальной карты с серверным срезом пула.
    // card_hash у менеджера солёный и в локальную схему не переносится
    // (см. slices.rs), поэтому для outcome-отчётов и будущего UI «эта карта
    // из пула» нужна явная связь pool_slice_id ↔ card_id.
    fn migration_v24(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS card_pool_links (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                pool_slice_id INTEGER NOT NULL UNIQUE,
                card_id       INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
                card_hash     TEXT NOT NULL,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_pool_links_card ON card_pool_links(card_id);
        "#)?;
        Ok(())
    }

    // MGR-018 (этап C): централизованные срезы прокси/email от менеджера.
    // source='manager' помечает пришедшее срезом (локальное — 'manual').
    // asset_pool_links связывает серверный срез (pool_slice_id из
    // issued_asset_slices на cc-sync-server) с локальной строкой — дедуп при
    // at-least-once доставке и точка опоры для будущего отзыва менеджером.
    fn migration_v25(conn: &Connection) -> SqlResult<()> {
        // Идемпотентность: колонки могут уже существовать у БД с потерянным
        // user_version (sqlcipher_export до фикса) — как остальные ALTER-ы здесь.
        let _ = conn.execute_batch("ALTER TABLE proxies ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';");
        let _ = conn.execute_batch("ALTER TABLE email_pool ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';");
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS asset_pool_links (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                kind          TEXT NOT NULL CHECK (kind IN ('proxy','email')),
                pool_slice_id INTEGER NOT NULL,
                local_id      INTEGER NOT NULL,
                created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(kind, pool_slice_id)
            );
        "#)?;
        Ok(())
    }


    // REDESIGN-05-5B3: трекинг-контур «перебивки».
    // 1) tracking_checkpoints — история точек отслеживания по заказу
    //    (in_transit → out_for_delivery → delivered → exception). Пишет
    //    фоновый поллер run_tracking_update; дедуп — на уровне INSERT
    //    (та же пара status+event_at+description не пишется дважды, см.
    //    record_tracking_checkpoint в _orders.rs).
    // 2) orders.delivered_at — когда поллер впервые увидел delivered
    //    (нужно правилу «delivered >24ч и не перебит»).
    // 3) статус 'received' — заказ перебит и получен дропом (сессия
    //    перебивки); триггер v20 пересоздаётся аддитивно, старые значения
    //    не ломаются (как и при FEAT-002-фиксе).
    fn migration_v26(conn: &Connection) -> SqlResult<()> {
        // Идемпотентность: колонка может уже существовать у БД с потерянным
        // user_version (sqlcipher_export до фикса) — как остальные ALTER-ы здесь.
        let _ = conn.execute_batch("ALTER TABLE orders ADD COLUMN delivered_at TEXT;");
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS tracking_checkpoints (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                tracking_number TEXT NOT NULL,
                carrier         TEXT,
                status          TEXT NOT NULL,
                status_detail   TEXT,
                location        TEXT,
                description     TEXT,
                event_at        TEXT,
                checked_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_checkpoints_order    ON tracking_checkpoints(order_id);
            CREATE INDEX IF NOT EXISTS idx_checkpoints_tracking ON tracking_checkpoints(tracking_number);
            CREATE INDEX IF NOT EXISTS idx_checkpoints_status   ON tracking_checkpoints(status);

            DROP TRIGGER IF EXISTS trg_order_status_check;
            CREATE TRIGGER trg_order_status_check
            BEFORE UPDATE OF status ON orders
            BEGIN
                SELECT CASE
                    WHEN NEW.status NOT IN ('pending','processing','shipped','delivered','returned','cancelled','refunded','chargeback','declined','failed','received')
                    THEN RAISE(ABORT, 'invalid order status')
                END;
            END;
        "#)?;
        Ok(())
    }


    // REDESIGN-05-5B4: E2E-чат (docs/CHAT_E2E.md). Локальная копия переписки:
    // plaintext здесь — норма (SQLCipher), на сервере и в транзите — только
    // запечатанные конверты (TelemetryEnvelope, тот же контракт, что у срезов
    // и config-shares). server_id — id строки на сервере; UNIQUE(server_id)
    // даёт идемпотентный fetch (at-least-once доставка), у исходящих NULL.
    fn migration_v27(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS chat_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id   INTEGER UNIQUE,
                room        TEXT NOT NULL,
                peer_iid    TEXT NOT NULL,
                direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
                body        TEXT NOT NULL,
                ref_type    TEXT,
                ref_id      TEXT,
                created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                read_at     DATETIME
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_room   ON chat_messages(room, id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_unread ON chat_messages(direction, read_at);
        "#)?;
        Ok(())
    }

    // REDESIGN-05 (c5j): FTS5-индекс для ⌘K global_search. Покрывает только
    // plaintext-колонки (PAN/имена зашифрованы и индексируемым быть не могут):
    // cards(last4/bin/bank), orders(number/track/carrier/notes), shops,
    // email_pool, proxies. rowid = entity_code*1e9 + id (все id INTEGER PK).
    // Если FTS5 не собран в sqlcipher — миграция no-op, поиск остаётся на LIKE.
    fn migration_v28(conn: &Connection) -> SqlResult<()> {
        if conn
            .execute_batch("CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x); DROP TABLE temp.fts5_probe;")
            .is_err()
        {
            return Ok(());
        }
        conn.execute_batch(r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS global_fts
            USING fts5(entity, entity_id UNINDEXED, title, body, tokenize='unicode61');

            INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              SELECT 1000000000 + id, 'card', id, coalesce(last4,''),
                     trim(coalesce(bin,'')||' '||coalesce(bank_name,'')) FROM credit_cards;
            INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              SELECT 2000000000 + id, 'order', id, coalesce(order_number,''),
                     trim(coalesce(tracking_number,'')||' '||coalesce(carrier,'')||' '||coalesce(notes,'')) FROM orders;
            INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              SELECT 3000000000 + id, 'shop', id, coalesce(name,''), coalesce(domain,'') FROM shops;
            INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              SELECT 4000000000 + id, 'email', id, coalesce(label,''), coalesce(email,'') FROM email_pool;
            INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              SELECT 5000000000 + id, 'proxy', id, coalesce(label,''), coalesce(host,'') FROM proxies;

            CREATE TRIGGER IF NOT EXISTS fts_cards_ai AFTER INSERT ON credit_cards BEGIN
              INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              VALUES (1000000000 + new.id, 'card', new.id, coalesce(new.last4,''),
                      trim(coalesce(new.bin,'')||' '||coalesce(new.bank_name,'')));
            END;
            CREATE TRIGGER IF NOT EXISTS fts_cards_au AFTER UPDATE OF last4, bin, bank_name ON credit_cards BEGIN
              UPDATE global_fts SET title = coalesce(new.last4,''),
                     body = trim(coalesce(new.bin,'')||' '||coalesce(new.bank_name,''))
              WHERE rowid = 1000000000 + new.id;
            END;
            CREATE TRIGGER IF NOT EXISTS fts_cards_ad AFTER DELETE ON credit_cards BEGIN
              DELETE FROM global_fts WHERE rowid = 1000000000 + old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS fts_orders_ai AFTER INSERT ON orders BEGIN
              INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              VALUES (2000000000 + new.id, 'order', new.id, coalesce(new.order_number,''),
                      trim(coalesce(new.tracking_number,'')||' '||coalesce(new.carrier,'')||' '||coalesce(new.notes,'')));
            END;
            CREATE TRIGGER IF NOT EXISTS fts_orders_au AFTER UPDATE OF order_number, tracking_number, carrier, notes ON orders BEGIN
              UPDATE global_fts SET title = coalesce(new.order_number,''),
                     body = trim(coalesce(new.tracking_number,'')||' '||coalesce(new.carrier,'')||' '||coalesce(new.notes,''))
              WHERE rowid = 2000000000 + new.id;
            END;
            CREATE TRIGGER IF NOT EXISTS fts_orders_ad AFTER DELETE ON orders BEGIN
              DELETE FROM global_fts WHERE rowid = 2000000000 + old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS fts_shops_ai AFTER INSERT ON shops BEGIN
              INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              VALUES (3000000000 + new.id, 'shop', new.id, coalesce(new.name,''), coalesce(new.domain,''));
            END;
            CREATE TRIGGER IF NOT EXISTS fts_shops_au AFTER UPDATE OF name, domain ON shops BEGIN
              UPDATE global_fts SET title = coalesce(new.name,''), body = coalesce(new.domain,'')
              WHERE rowid = 3000000000 + new.id;
            END;
            CREATE TRIGGER IF NOT EXISTS fts_shops_ad AFTER DELETE ON shops BEGIN
              DELETE FROM global_fts WHERE rowid = 3000000000 + old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS fts_emails_ai AFTER INSERT ON email_pool BEGIN
              INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              VALUES (4000000000 + new.id, 'email', new.id, coalesce(new.label,''), coalesce(new.email,''));
            END;
            CREATE TRIGGER IF NOT EXISTS fts_emails_au AFTER UPDATE OF label, email ON email_pool BEGIN
              UPDATE global_fts SET title = coalesce(new.label,''), body = coalesce(new.email,'')
              WHERE rowid = 4000000000 + new.id;
            END;
            CREATE TRIGGER IF NOT EXISTS fts_emails_ad AFTER DELETE ON email_pool BEGIN
              DELETE FROM global_fts WHERE rowid = 4000000000 + old.id;
            END;

            CREATE TRIGGER IF NOT EXISTS fts_proxies_ai AFTER INSERT ON proxies BEGIN
              INSERT INTO global_fts(rowid, entity, entity_id, title, body)
              VALUES (5000000000 + new.id, 'proxy', new.id, coalesce(new.label,''), coalesce(new.host,''));
            END;
            CREATE TRIGGER IF NOT EXISTS fts_proxies_au AFTER UPDATE OF label, host ON proxies BEGIN
              UPDATE global_fts SET title = coalesce(new.label,''), body = coalesce(new.host,'')
              WHERE rowid = 5000000000 + new.id;
            END;
            CREATE TRIGGER IF NOT EXISTS fts_proxies_ad AFTER DELETE ON proxies BEGIN
              DELETE FROM global_fts WHERE rowid = 5000000000 + old.id;
            END;
        "#)?;
        Ok(())
    }


    // q77: wiki магазинов — база знаний (AVS, звонки, переадресация) + история
    // правок. Правит любой участник; author_id = текущий пользователь, дата
    // проставляется автоматически (CURRENT_TIMESTAMP).
    fn migration_v29(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(r#"
            CREATE TABLE IF NOT EXISTS shop_wiki (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                content     TEXT NOT NULL DEFAULT '',
                updated_by  TEXT,
                updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(shop_id)
            );
            CREATE TABLE IF NOT EXISTS shop_wiki_history (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
                content     TEXT NOT NULL,
                edited_by   TEXT,
                edited_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_wiki_history_shop ON shop_wiki_history(shop_id, edited_at);
        "#)?;
        Ok(())
    }
