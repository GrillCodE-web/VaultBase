impl Database {
    fn escape_like(s: &str) -> String {
        s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    }

    /// FIX B-MED-04: Open database with optional connection pooling
    pub fn open(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        init_db(&conn)?;

        // Create connection pool for concurrent reads
        // For desktop single-user mode, pool is optional but improves performance
        let pool = Self::create_pool(path);

        Ok(Self {
            conn,
            pool,
            encryption: None,
            last_activity: Arc::new(Mutex::new(Instant::now())),
            autolock_timeout: None,
        })
    }

    /// FIX B-MED-04: Create r2d2 connection pool
    fn create_pool(path: &str) -> Option<DbPool> {
        let manager = SqliteConnectionManager::file(path)
            .with_init(|c| {
                // Initialize each connection with pragmas
                // FIX P0-7: Add busy_timeout for SQLite to wait instead of returning SQLITE_BUSY
                // FIX P2-10: Add wal_autocheckpoint for better WAL management (3000 pages = ~12MB)
                c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 3000;")
            });

        Pool::builder()
            .max_size(8)  // FIX P2-24: Increase from 4 to 8 for better concurrency
            .build(manager)
            .ok()
    }

    /// FIX B-MED-04: Get connection from pool or direct connection
    pub fn get_connection(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>, String> {
        if let Some(pool) = &self.pool {
            pool.get().map_err(|e| e.to_string())
        } else {
            // Fallback: this shouldn't happen in normal operation
            Err("Connection pool not initialized".to_string())
        }
    }

    pub fn set_encryption(&mut self, enc: FieldEncryption) {
        self.encryption = Some(Arc::new(enc));
        self.touch_activity();
    }

    pub fn clear_encryption(&mut self) { self.encryption = None; }
    pub fn is_locked(&self) -> bool { self.encryption.is_none() }

    pub fn touch_activity(&self) {
        if let Ok(mut t) = self.last_activity.lock() { *t = Instant::now(); }
    }

    pub fn encrypt_field(&self, val: &str) -> Result<String, String> {
        match &self.encryption {
            Some(enc) => enc.encrypt(val),
            None      => Err("database_locked".into()),
        }
    }

    pub fn decrypt_field(&self, val: &str) -> Result<String, String> {
        match &self.encryption {
            Some(enc) => enc.decrypt(val),
            None      => Err("database_locked".into()),
        }
    }

    fn opt_encrypt(&self, val: Option<&str>) -> Result<Option<String>, String> {
        match val {
            Some(v) if !v.is_empty() => Ok(Some(self.encrypt_field(v)?)),
            _ => Ok(None),
        }
    }

    fn opt_decrypt(&self, val: Option<&str>) -> Result<Option<String>, String> {
        match val {
            Some(v) if !v.is_empty() => Ok(Some(self.decrypt_field(v)?)),
            _ => Ok(None),
        }
    }

    // ─────────────────────────────────────────
    //  Config helpers
    // ─────────────────────────────────────────

    pub fn get_config(&self, key: &str) -> SqlResult<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM config WHERE key=?1")?;
        let mut rows = stmt.query(params![key])?;
        Ok(if let Some(row) = rows.next()? { row.get(0)? } else { None })
    }

    pub fn set_config(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.execute(
            "INSERT INTO config(key,value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn log_event(&self, event_type: &str, description: &str, category: Option<&str>, entity_id: Option<&str>) -> Result<(), String> {
        // FIX AUDIT-14: раньше category/entity_id игнорировались — из-за этого
        // get_card_timeline (по entity_type='card') и фильтры по entity_type
        // в get_activity_log всегда возвращали пустоту.
        self.conn.execute(
            "INSERT INTO activity_log(event_type,description,entity_type,entity_id) VALUES(?1,?2,?3,?4)",
            params![event_type, description, category, entity_id],
        ).map_err(|e| e.to_string())?;
        // FIX B47: авто-ротация лога — держим последние 10 000 записей
        let _ = self.conn.execute(
            "DELETE FROM activity_log WHERE id NOT IN (SELECT id FROM activity_log ORDER BY id DESC LIMIT 10000)",
            [],
        );
        Ok(())
    }

    /// Возвращает HMAC-ключ из DEK или фолбэк-ключ если не залочено.
    /// Фолбэк деривируется из installation_id (уникален для каждой установки),
    /// а не из статической константы — чтобы хеши не были детерминированными
    /// и не поддавались словарным атакам при залоченной БД.
    fn hmac_key(&self) -> [u8; 32] {
        match &self.encryption {
            Some(enc) => enc.derive_hmac_key(),
            None => {
                use sha2::{Sha256, Digest};
                let mut h = Sha256::new();
                h.update(b"vaultbase-footprint-fallback-v2:");
                if let Ok(Some(id)) = self.get_config("installation_id") {
                    h.update(id.as_bytes());
                }
                h.finalize().into()
            }
        }
    }

    /// PHASE 1: Footprint Sync V2 — получает installation_id из config и возвращает HMAC-SHA256 hash
    pub fn get_installation_id_hash(&self) -> Option<String> {
        let installation_id = self.get_config("installation_id").ok()??;
        if installation_id.is_empty() {
            return None;
        }
        let key = self.hmac_key();
        Some(hash_value_with_key(&installation_id, &key))
    }
}