/// SEC-005: Parsed sidecar file. v1 = bare salt (DEK = PBKDF2(password, salt)),
/// v2 = envelope (DEK is random, wrapped with password-derived KEK).
pub struct DbSidecar {
    pub salt_b64: String,
    pub wrapped_dek: Option<String>,
    /// MGR-013: bcrypt-хеш panic-пароля (только в формате v3).
    pub panic_hash: Option<String>,
}

impl Database {
    fn escape_like(s: &str) -> String {
        s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    }

    /// SEC-001: Open database — auto-detects whether file is SQLCipher-encrypted.
    /// If encrypted, creates a "locked shell" that can only read config after unlock.
    /// If plaintext (or new file), opens normally.
    pub fn open(path: &str) -> SqlResult<Self> {
        if std::path::Path::new(path).exists() && Self::is_encrypted(path) {
            Self::open_encrypted_shell(path)
        } else {
            Self::open_with_key(path, None)
        }
    }

    /// Open database with an optional SQLCipher database encryption key (DEK).
    pub fn open_with_key(path: &str, db_key: Option<&[u8; 32]>) -> SqlResult<Self> {
        let conn = Connection::open(path)?;

        if let Some(key) = db_key {
            let hex_key = hex::encode(key);
            conn.execute_batch(&format!("PRAGMA key = \"x'{}'\"", hex_key))?;
        }

        init_db(&conn)?;

        let pool = Self::create_pool(path, db_key);

        Ok(Self {
            conn,
            pool,
            encryption: None,
            last_activity: Arc::new(Mutex::new(Instant::now())),
            autolock_timeout: None,
        })
    }

    /// SEC-001: Create a locked shell for an encrypted DB file.
    /// The connection is open but unusable until reopen_with_key() is called.
    fn open_encrypted_shell(path: &str) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        Ok(Self {
            conn,
            pool: None,
            encryption: None,
            last_activity: Arc::new(Mutex::new(Instant::now())),
            autolock_timeout: None,
        })
    }

    /// SEC-001: Re-open the database with the correct SQLCipher key after unlock.
    /// Replaces conn and pool in-place. Validates the key immediately — SQLCipher
    /// does not report a wrong key at PRAGMA time, only on first read.
    pub fn reopen_with_key(&mut self, path: &str, db_key: &[u8; 32]) -> Result<(), String> {
        let conn = Connection::open(path).map_err(|e| format!("reopen: {e}"))?;
        let hex_key = hex::encode(db_key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\"", hex_key))
            .map_err(|e| format!("pragma key: {e}"))?;
        // Wrong key → first read fails with "file is not a database".
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
            .map_err(|_| "wrong_password".to_string())?;
        init_db(&conn).map_err(|e| format!("init_db after reopen: {e}"))?;
        let pool = Self::create_pool(path, Some(db_key));
        self.conn = conn;
        self.pool = pool;
        Ok(())
    }

    /// SEC-001: Close conn + pool before file-level operations (migration).
    /// On Windows an open SQLite handle blocks rename/delete of the file,
    /// so sqlcipher_export file swap would fail while we hold the DB open.
    /// Afterwards self.conn is an in-memory placeholder until reopen_with_key().
    pub fn close_connections(&mut self) {
        self.pool = None;
        if let Ok(placeholder) = Connection::open_in_memory() {
            let old = std::mem::replace(&mut self.conn, placeholder);
            // close() returns Err((conn, err)) when statements are still open;
            // dropping that tuple closes the handle either way.
            let _ = old.close();
        }
    }

    /// Create r2d2 connection pool. Each pooled connection receives the same
    /// SQLCipher PRAGMA key so it can read/write the encrypted file.
    pub(crate) fn create_pool(path: &str, db_key: Option<&[u8; 32]>) -> Option<DbPool> {
        let hex_key = db_key.map(hex::encode);
        let manager = SqliteConnectionManager::file(path)
            .with_init(move |c| {
                if let Some(ref hk) = hex_key {
                    c.execute_batch(&format!("PRAGMA key = \"x'{}'\"", hk))?;
                }
                c.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA wal_autocheckpoint = 3000;")
            });

        Pool::builder()
            // PERF-013: 8 → 16 соединений (фоновые IMAP/WS потоки + UI-команды
            // конкурируют за пул) + явный таймаут ожидания свободного соединения
            .max_size(16)
            .connection_timeout(std::time::Duration::from_secs(5))
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

    /// SEC-001: Rekey the database file with a new SQLCipher key.
    /// Used during master password change — atomically re-encrypts entire file.
    /// WAL is checkpointed first so no frames remain keyed under the old key.
    pub fn rekey(&self, new_key: &[u8; 32]) -> SqlResult<()> {
        let hex_key = hex::encode(new_key);
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        self.conn.execute_batch(&format!("PRAGMA rekey = \"x'{}'\"", hex_key))?;
        Ok(())
    }

    /// SEC-001: Migrate a plaintext (unencrypted) database to SQLCipher.
    /// Uses sqlcipher_export() to copy data into a new encrypted file,
    /// then replaces the original.
    pub fn migrate_to_encrypted(path: &str, new_key: &[u8; 32]) -> Result<(), String> {
        let encrypted_path = format!("{}.encrypted", path);
        let hex_key = hex::encode(new_key);

        let conn = Connection::open(path).map_err(|e| format!("open plaintext: {e}"))?;

        // FIX: sqlcipher_export копирует схему и данные, но НЕ header-прагмы
        // (user_version). Без переноса версии зашифрованная копия получала
        // user_version=0 → init_db прогонял все миграции заново и падал на
        // первом неидемпотентном ALTER (v21: duplicate column created_by) —
        // снаружи это выглядело как «Authentication error» на unlock.
        let user_version: u32 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| format!("read user_version: {e}"))?;

        conn.execute_batch(&format!(
            "ATTACH DATABASE '{}' AS encrypted KEY \"x'{}'\"; \
             SELECT sqlcipher_export('encrypted'); \
             PRAGMA encrypted.user_version = {}; \
             DETACH DATABASE encrypted;",
            encrypted_path.replace('\'', "''"),
            hex_key,
            user_version,
        )).map_err(|e| format!("sqlcipher_export: {e}"))?;
        drop(conn);

        // WAL/shm старой plaintext-базы: содержат открытые данные и будут
        // конфликтовать с новым зашифрованным файлом при переименовании.
        let _ = std::fs::remove_file(format!("{}-wal", path));
        let _ = std::fs::remove_file(format!("{}-shm", path));

        let backup_path = format!("{}.plaintext.bak", path);
        std::fs::rename(path, &backup_path)
            .map_err(|e| format!("rename original: {e}"))?;
        std::fs::rename(&encrypted_path, path)
            .map_err(|e| format!("rename encrypted: {e}"))?;

        // SEC-001: plaintext-копия обязана исчезнуть — это и есть смысл миграции.
        // AV/индексатор может держать файл — даём несколько попыток.
        let mut removed = false;
        for _ in 0..5 {
            if std::fs::remove_file(&backup_path).is_ok() { removed = true; break; }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        if !removed {
            eprintln!("[SEC-001] WARNING: plaintext backup {} could not be deleted", backup_path);
        }

        Ok(())
    }

    /// SEC-001: Check if a database file is already encrypted with SQLCipher.
    /// Tries to read the header — a plaintext SQLite file starts with "SQLite format 3\0".
    pub fn is_encrypted(path: &str) -> bool {
        match std::fs::read(path) {
            Ok(data) if data.len() >= 16 => !data.starts_with(b"SQLite format 3\0"),
            Ok(_) => false,
            Err(_) => false,
        }
    }

    /// SEC-001: Path to the salt file stored alongside the database.
    /// Salt is not secret — it can safely live in plaintext next to the
    /// encrypted .db file. This avoids the chicken-and-egg problem of needing
    /// to read the DB to get the salt needed to decrypt the DB.
    pub fn salt_file_path(db_path: &str) -> String {
        format!("{}.salt", db_path)
    }

    /// SEC-001: Save the encryption salt to a sidecar file (legacy v1 format —
    /// bare salt, DEK derived directly from password+salt).
    pub fn save_salt_file(db_path: &str, salt_b64: &str) -> Result<(), String> {
        std::fs::write(Self::salt_file_path(db_path), salt_b64)
            .map_err(|e| format!("save salt file: {e}"))
    }

    /// SEC-001: Read the encryption salt from the sidecar file.
    pub fn read_salt_file(db_path: &str) -> Option<String> {
        Self::read_sidecar(db_path).map(|sc| sc.salt_b64)
    }

    /// SEC-005: Save a v2 envelope sidecar: "v2:<salt_b64>:<wrapped_dek_b64>".
    pub fn save_sidecar(db_path: &str, salt_b64: &str, wrapped_dek_b64: &str) -> Result<(), String> {
        std::fs::write(Self::salt_file_path(db_path), format!("v2:{}:{}", salt_b64, wrapped_dek_b64))
            .map_err(|e| format!("save sidecar: {e}"))
    }

    /// SEC-005: Read and parse the sidecar (v2 envelope or legacy v1 bare salt).
    pub fn read_sidecar(db_path: &str) -> Option<DbSidecar> {
        let raw = std::fs::read_to_string(Self::salt_file_path(db_path)).ok()?;
        Self::parse_sidecar(&raw)
    }

    /// SEC-005: Read the .bak sidecar (fallback after an interrupted write).
    pub fn read_sidecar_bak(db_path: &str) -> Option<DbSidecar> {
        let raw = std::fs::read_to_string(format!("{}.bak", Self::salt_file_path(db_path))).ok()?;
        Self::parse_sidecar(&raw)
    }

    /// MGR-013: v3 sidecar: "v3:<salt_b64>:<wrapped_dek_b64>:<panic_bcrypt>".
    /// bcrypt-хеш не содержит ':', split безопасен.
    pub fn save_sidecar_v3(
        db_path: &str,
        salt_b64: &str,
        wrapped_dek_b64: &str,
        panic_hash: &str,
    ) -> Result<(), String> {
        std::fs::write(
            Self::salt_file_path(db_path),
            format!("v3:{}:{}:{}", salt_b64, wrapped_dek_b64, panic_hash),
        )
        .map_err(|e| format!("save sidecar v3: {e}"))
    }

    fn parse_sidecar(raw: &str) -> Option<DbSidecar> {
        let raw = raw.trim();
        if raw.is_empty() {
            return None;
        }
        if let Some(rest) = raw.strip_prefix("v3:") {
            let mut it = rest.split(':');
            let salt = it.next()?.to_string();
            let dek = it.next()?.to_string();
            let panic = it.next()?.to_string();
            if salt.is_empty() || dek.is_empty() || panic.is_empty() {
                return None;
            }
            Some(DbSidecar { salt_b64: salt, wrapped_dek: Some(dek), panic_hash: Some(panic) })
        } else if let Some(rest) = raw.strip_prefix("v2:") {
            let mut it = rest.split(':');
            let salt = it.next()?.to_string();
            let dek = it.next()?.to_string();
            if salt.is_empty() || dek.is_empty() {
                return None;
            }
            Some(DbSidecar { salt_b64: salt, wrapped_dek: Some(dek), panic_hash: None })
        } else {
            Some(DbSidecar { salt_b64: raw.to_string(), wrapped_dek: None, panic_hash: None })
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

#[cfg(test)]
mod sidecar_tests {
    use super::*;

    #[test]
    fn sidecar_v3_roundtrip_with_panic_hash() {
        let dir = tempfile::tempdir().unwrap();
        let dbp = dir.path().join("t.db").to_str().unwrap().to_string();
        let hash = bcrypt::hash("panic-pw-123", 4).unwrap(); // низкий cost для теста
        Database::save_sidecar_v3(&dbp, "c2FsdA==", "d3JhcHBlZA==", &hash).unwrap();

        let sc = Database::read_sidecar(&dbp).expect("v3 sidecar parses");
        assert_eq!(sc.salt_b64, "c2FsdA==");
        assert_eq!(sc.wrapped_dek.as_deref(), Some("d3JhcHBlZA=="));
        let ph = sc.panic_hash.expect("panic hash present");
        // bcrypt-хеш с ':' внутри не ломает split-формат
        assert!(bcrypt::verify("panic-pw-123", &ph).unwrap());
        assert!(!bcrypt::verify("wrong-pw", &ph).unwrap());
    }

    #[test]
    fn sidecar_v2_and_v1_have_no_panic_hash() {
        let dir = tempfile::tempdir().unwrap();
        let dbp = dir.path().join("t.db").to_str().unwrap().to_string();
        Database::save_sidecar(&dbp, "c2FsdA==", "d3JhcHBlZA==").unwrap();
        let sc = Database::read_sidecar(&dbp).expect("v2 sidecar parses");
        assert!(sc.panic_hash.is_none());

        std::fs::write(Database::salt_file_path(&dbp), "bGVnYWN5LXNhbHQ=").unwrap();
        let sc1 = Database::read_sidecar(&dbp).expect("v1 sidecar parses");
        assert_eq!(sc1.salt_b64, "bGVnYWN5LXNhbHQ=");
        assert!(sc1.wrapped_dek.is_none());
        assert!(sc1.panic_hash.is_none());
    }
}
