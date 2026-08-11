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

    pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let mut version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let migrations: &[(u32, fn(&Connection) -> SqlResult<()>)] = &[
        (1, migration_v1), (2, migration_v2), (3, migration_v3),
        (4, migration_v4), (5, migration_v5), (6, migration_v6),
        (7, migration_v7), (8, migration_v8), (9, migration_v9),
        (10, migration_v10),
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

