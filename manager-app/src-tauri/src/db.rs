use rusqlite::Connection;
use std::io::Read;
use std::path::Path;

pub struct Database {
    pub conn: Connection,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Sidecar {
    pub salt_b64: String,
    pub wrapped_dek: Option<String>,
}

fn apply_key(conn: &Connection, key: &[u8; 32]) -> Result<(), String> {
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))
        .map_err(|e| format!("pragma key: {e}"))
}

impl Database {
    pub fn open_plain(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("open: {e}"))?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_with_key(path: &str, key: &[u8; 32]) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("open: {e}"))?;
        apply_key(&conn, key)?;
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
            .map_err(|_| "wrong_password".to_string())?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS worker_snapshots (
                    installation_id TEXT PRIMARY KEY,
                    label TEXT,
                    role TEXT,
                    is_active INTEGER,
                    last_seen TEXT,
                    hb_last_seen TEXT,
                    snapshot TEXT,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    installation_id TEXT NOT NULL,
                    label TEXT,
                    kind TEXT NOT NULL,
                    report_date TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    UNIQUE(installation_id, kind, report_date)
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT DEFAULT CURRENT_TIMESTAMP,
                    kind TEXT,
                    message TEXT
                );
                "#,
            )
            .map_err(|e| format!("init schema: {e}"))
    }

    pub fn get_config(&self, key: &str) -> Option<String> {
        self.conn
            .query_row("SELECT value FROM config WHERE key = ?1", [key], |row| {
                row.get::<_, String>(0)
            })
            .ok()
    }

    pub fn set_config(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO config (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [key, value],
            )
            .map_err(|e| format!("set_config: {e}"))?;
        Ok(())
    }

    pub fn log_event(&self, kind: &str, message: &str) {
        let _ = self
            .conn
            .execute("INSERT INTO events (kind, message) VALUES (?1, ?2)", [kind, message]);
    }
}

const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

pub fn is_encrypted(path: &str) -> bool {
    if !Path::new(path).exists() {
        return false;
    }
    let mut buf = [0u8; 16];
    match std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut buf).map(|_| buf))
    {
        Ok(header) => &header != SQLITE_HEADER,
        Err(_) => true,
    }
}

pub fn read_sidecar(db_path: &str) -> Option<Sidecar> {
    let path = format!("{db_path}.sidecar.json");
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn write_sidecar(db_path: &str, sidecar: &Sidecar) -> Result<(), String> {
    let path = format!("{db_path}.sidecar.json");
    let content = serde_json::to_string(sidecar).map_err(|e| format!("sidecar: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("write sidecar: {e}"))
}

pub fn data_dir() -> Result<String, String> {
    let base = dirs::data_dir().ok_or("no data dir")?;
    let dir = base.join("VaultBaseManager");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    Ok(dir
        .to_str()
        .ok_or("non-utf8 data dir path")?
        .to_string())
}

pub fn db_path() -> Result<String, String> {
    Ok(format!("{}/vaultbase-manager.db", data_dir()?))
}

pub fn migrate_plain_to_encrypted(path: &str, key: &[u8; 32]) -> Result<(), String> {
    let encrypted_path = format!("{path}.encrypted");
    let conn = Connection::open(path).map_err(|e| format!("open plain: {e}"))?;
    conn.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS encrypted KEY \"x'{}'\"; \
         SELECT sqlcipher_export('encrypted'); \
         DETACH DATABASE encrypted;",
        encrypted_path.replace('\'', "''"),
        hex::encode(key),
    ))
    .map_err(|e| format!("sqlcipher_export: {e}"))?;
    drop(conn);

    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{path}{suffix}"));
    }
    std::fs::copy(&encrypted_path, path).map_err(|e| format!("swap db file: {e}"))?;
    let _ = std::fs::remove_file(&encrypted_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("test.db");
        let db = db.to_str().unwrap();
        let sc = Sidecar {
            salt_b64: "c2FsdA==".into(),
            wrapped_dek: Some("blob".into()),
        };
        write_sidecar(db, &sc).unwrap();
        assert_eq!(read_sidecar(db).unwrap().salt_b64, "c2FsdA==");
    }

    #[test]
    fn is_encrypted_detection() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("plain.db");
        std::fs::write(&plain, b"SQLite format 3\0 some data").unwrap();
        assert!(!is_encrypted(plain.to_str().unwrap()));

        let enc = dir.path().join("enc.db");
        std::fs::write(&enc, [0x8cu8; 64]).unwrap();
        assert!(is_encrypted(enc.to_str().unwrap()));

        assert!(!is_encrypted(dir.path().join("missing.db").to_str().unwrap()));
    }

    #[test]
    fn open_with_key_and_wrong_password() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.db");
        let path = path.to_str().unwrap().to_string();

        let key = [7u8; 32];
        {
            let db = Database::open_plain(&path).unwrap();
            db.set_config("k", "v").unwrap();
        }
        migrate_plain_to_encrypted(&path, &key).unwrap();
        assert!(is_encrypted(&path));

        let db = Database::open_with_key(&path, &key).unwrap();
        assert_eq!(db.get_config("k").unwrap(), "v");

        assert!(Database::open_with_key(&path, &[8u8; 32]).is_err());
    }
}
