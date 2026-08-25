// ─────────────────────────────────────────────────────────────────────
//  uPanel API connections (FEAT-018)
//
//  Сохранённые подключения к внешнему uPanel API (PPTP-серверы — тот же
//  «прокси»-слой, см. Proxies → PPTP). Токен шифруется AES-256-GCM
//  (encryption.rs) и НИКОГДА не отдаётся в frontend — наружу уходит
//  только token_preview (маска вида `upl_…4f2a`).
// ─────────────────────────────────────────────────────────────────────

impl Database {
    /// Добавить подключение. Токен шифруется перед записью.
    pub fn upanel_add_connection(&self, input: &UpanelConnectionInput) -> Result<UpanelConnection, String> {
        if input.name.trim().is_empty() {
            return Err("upanel_name_required".to_string());
        }
        let base_url = normalize_upanel_base_url(&input.base_url)?;
        let token = input.api_token.trim();
        if token.is_empty() {
            return Err("upanel_token_required".to_string());
        }

        let stored_token = self.encrypt_field(token)?;
        self.conn
            .execute(
                "INSERT INTO upanel_connections (name, base_url, api_token, is_active, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    input.name.trim(),
                    base_url,
                    stored_token,
                    input.is_active.unwrap_or(true) as i64,
                    upanel_now()
                ],
            )
            .map_err(|e| format!("db_insert_error: {}", e))?;
        let id = self.conn.last_insert_rowid();
        self.upanel_get_connection_by_id(id)?
            .ok_or_else(|| "upanel_connection_not_found".to_string())
    }

    /// Список подключений (токен замаскирован).
    pub fn upanel_list_connections(&self) -> Result<Vec<UpanelConnection>, String> {
        let ids: Vec<i64> = self
            .conn
            .prepare("SELECT id FROM upanel_connections ORDER BY id")
            .map_err(|e| format!("db_prepare_error: {}", e))?
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("db_query_error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(c) = self.upanel_get_connection_by_id(id)? {
                out.push(c);
            }
        }
        Ok(out)
    }

    /// Обновить подключение. Пустой api_token = оставить прежний токен.
    pub fn upanel_update_connection(
        &self,
        id: i64,
        input: &UpanelConnectionInput,
    ) -> Result<UpanelConnection, String> {
        if input.name.trim().is_empty() {
            return Err("upanel_name_required".to_string());
        }
        let existing = self
            .upanel_get_connection_by_id(id)?
            .ok_or_else(|| "upanel_connection_not_found".to_string())?;
        let base_url = normalize_upanel_base_url(&input.base_url)?;

        // Пустой токен в форме редактирования = «не менять». Токен в БД лежит
        // зашифрованным — читаем как есть и пишем обратно без преобразований.
        let stored_token = if input.api_token.trim().is_empty() {
            self.conn
                .query_row(
                    "SELECT api_token FROM upanel_connections WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|_| "upanel_connection_not_found".to_string())?
        } else {
            self.encrypt_field(input.api_token.trim())?
        };

        // При смене URL/токена прежний статус больше не актуален.
        self.conn
            .execute(
                "UPDATE upanel_connections
                 SET name = ?2, base_url = ?3, api_token = ?4, is_active = ?5,
                     updated_at = ?6, last_check_at = NULL, last_check_status = NULL,
                     last_check_error = NULL, last_http_code = NULL, last_latency_ms = NULL
                 WHERE id = ?1",
                params![
                    id,
                    input.name.trim(),
                    base_url,
                    stored_token,
                    input.is_active.unwrap_or(existing.is_active) as i64,
                    upanel_now()
                ],
            )
            .map_err(|e| format!("db_update_error: {}", e))?;
        self.upanel_get_connection_by_id(id)?
            .ok_or_else(|| "upanel_connection_not_found".to_string())
    }

    pub fn upanel_delete_connection(&self, id: i64) -> Result<(), String> {
        let n = self
            .conn
            .execute("DELETE FROM upanel_connections WHERE id = ?1", params![id])
            .map_err(|e| format!("db_delete_error: {}", e))?;
        if n == 0 {
            return Err("upanel_connection_not_found".to_string());
        }
        Ok(())
    }

    /// Расшифрованные креды подключения — только для внутреннего HTTP-вызова
    /// из commands/upanel.rs (токен не покидает бэкенд).
    pub fn upanel_get_connection_secret(&self, id: i64) -> Result<(String, String), String> {
        let row: (String, String, i64) = self
            .conn
            .query_row(
                "SELECT base_url, api_token, is_active FROM upanel_connections WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| "upanel_connection_not_found".to_string())?;
        if row.2 == 0 {
            return Err("upanel_connection_disabled".to_string());
        }
        let token = self.decrypt_field(&row.1)?;
        Ok((row.0, token))
    }

    /// Записать результат live-проверки статуса (виджет Online/Offline).
    pub fn upanel_record_status(
        &self,
        id: i64,
        status: &str,
        http_code: Option<u16>,
        latency_ms: Option<u64>,
        error: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE upanel_connections
                 SET last_check_at = ?2, last_check_status = ?3, last_check_error = ?4,
                     last_http_code = ?5, last_latency_ms = ?6
                 WHERE id = ?1",
                params![
                    id,
                    upanel_now(),
                    status,
                    error,
                    http_code.map(|c| c as i64),
                    latency_ms.map(|l| l as i64)
                ],
            )
            .map_err(|e| format!("db_update_error: {}", e))?;
        Ok(())
    }

    /// Подключение по id (токен замаскирован) — для UI.
    pub fn upanel_get_connection_by_id(&self, id: i64) -> Result<Option<UpanelConnection>, String> {
        use rusqlite::OptionalExtension;

        #[derive(Debug)]
        struct RawRow {
            id: i64,
            name: String,
            base_url: String,
            api_token: String,
            is_active: bool,
            last_check_at: Option<String>,
            last_check_status: Option<String>,
            last_check_error: Option<String>,
            last_http_code: Option<i64>,
            last_latency_ms: Option<i64>,
            created_at: String,
            updated_at: String,
        }

        let raw: Option<RawRow> = self
            .conn
            .query_row(
                "SELECT id, name, base_url, api_token, is_active, last_check_at,
                        last_check_status, last_check_error, last_http_code, last_latency_ms,
                        created_at, updated_at
                 FROM upanel_connections WHERE id = ?1",
                params![id],
                |r| {
                    Ok(RawRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        base_url: r.get(2)?,
                        api_token: r.get(3)?,
                        is_active: r.get::<_, i64>(4)? != 0,
                        last_check_at: r.get(5)?,
                        last_check_status: r.get(6)?,
                        last_check_error: r.get(7)?,
                        last_http_code: r.get(8)?,
                        last_latency_ms: r.get(9)?,
                        created_at: r.get(10)?,
                        updated_at: r.get(11)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("db_query_error: {}", e))?;

        Ok(raw.map(|row| {
            // Превью строим по расшифрованному токену (без шифрования токен
            // лежит как есть — decrypt_field его просто вернёт).
            let plain = self
                .decrypt_field(&row.api_token)
                .unwrap_or_else(|_| row.api_token.clone());
            UpanelConnection {
                id: row.id,
                name: row.name,
                base_url: row.base_url,
                is_active: row.is_active,
                token_preview: upanel_token_preview(&plain),
                last_check_at: row.last_check_at,
                last_check_status: row.last_check_status,
                last_check_error: row.last_check_error,
                last_http_code: row.last_http_code.map(|c| c as u16),
                last_latency_ms: row.last_latency_ms.map(|l| l as u64),
                created_at: row.created_at,
                updated_at: row.updated_at,
            }
        }))
    }
}

fn upanel_now() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Нормализация base URL: пустая строка → дефолтный URL uPanel;
/// срезаем хвостовые слеши; схема обязательна http(s)://.
fn normalize_upanel_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(crate::constants::UPANEL_API_BASE_URL.to_string());
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("upanel_invalid_url".to_string());
    }
    Ok(trimmed.to_string())
}

/// Токен наружу не отдаётся — только маска вида `upl_…4f2a`.
fn upanel_token_preview(token: &str) -> String {
    let t = token.trim();
    if t.len() <= 8 {
        return "••••".to_string();
    }
    format!("{}…{}", &t[..4], &t[t.len() - 4..])
}

// ─────────────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod upanel_tests {
    use super::*;
    use crate::database::Database;
    use crate::models::{UpanelConnectionInput, UpanelConnection};

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("upanel.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("test_pw_1234567890", &salt));
        (dir, db)
    }

    fn sample_input() -> UpanelConnectionInput {
        UpanelConnectionInput {
            name: "Main uPanel".to_string(),
            base_url: String::new(),
            api_token: "upl_0123456789abcdef0123456789abcdef".to_string(),
            is_active: Some(true),
        }
    }

    #[test]
    fn add_connection_defaults_base_url_and_masks_token() {
        let (_dir, db) = test_db();
        let conn = db.upanel_add_connection(&sample_input()).unwrap();
        assert_eq!(conn.base_url, crate::constants::UPANEL_API_BASE_URL);
        // Токен наружу не отдаётся: только маска, без середины
        assert!(conn.token_preview.starts_with("upl_"), "got {}", conn.token_preview);
        assert!(conn.token_preview.contains('…'));
        assert!(!conn.token_preview.contains("0123456789abcdef012345"));
    }

    #[test]
    fn token_is_stored_encrypted() {
        let (_dir, db) = test_db();
        db.upanel_add_connection(&sample_input()).unwrap();
        let raw: String = db
            .conn
            .query_row("SELECT api_token FROM upanel_connections WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        // В БД лежит шифротекст, не plaintext
        assert!(!raw.contains("0123456789abcdef"));
        assert_ne!(raw, "upl_0123456789abcdef0123456789abcdef");
        // И секрет расшифровывается тем же значением
        let (_, token) = db.upanel_get_connection_secret(1).unwrap();
        assert_eq!(token, "upl_0123456789abcdef0123456789abcdef");
    }

    #[test]
    fn update_with_empty_token_keeps_old_one() {
        let (_dir, db) = test_db();
        db.upanel_add_connection(&sample_input()).unwrap();
        let patched = UpanelConnectionInput {
            name: "Renamed".to_string(),
            base_url: "https://upanel.ushubpulse.com/api/v1/".to_string(),
            api_token: String::new(),
            is_active: None,
        };
        let updated = db.upanel_update_connection(1, &patched).unwrap();
        assert_eq!(updated.name, "Renamed");
        // Хвостовой слеш срезается
        assert_eq!(updated.base_url, "https://upanel.ushubpulse.com/api/v1");
        // Токен не потерялся
        let (_, token) = db.upanel_get_connection_secret(1).unwrap();
        assert_eq!(token, "upl_0123456789abcdef0123456789abcdef");
    }

    #[test]
    fn update_resets_stale_status() {
        let (_dir, db) = test_db();
        db.upanel_add_connection(&sample_input()).unwrap();
        db.upanel_record_status(1, "online", Some(200), Some(120), None).unwrap();
        let patched = UpanelConnectionInput {
            name: "Renamed".to_string(),
            base_url: String::new(),
            api_token: String::new(),
            is_active: None,
        };
        let updated = db.upanel_update_connection(1, &patched).unwrap();
        assert!(updated.last_check_status.is_none());
        assert!(updated.last_latency_ms.is_none());
    }

    #[test]
    fn record_status_persists() {
        let (_dir, db) = test_db();
        db.upanel_add_connection(&sample_input()).unwrap();
        db.upanel_record_status(1, "online", Some(200), Some(321), None).unwrap();
        let list = db.upanel_list_connections().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].last_check_status.as_deref(), Some("online"));
        assert_eq!(list[0].last_latency_ms, Some(321));
    }

    #[test]
    fn delete_and_missing_rows() {
        let (_dir, db) = test_db();
        db.upanel_add_connection(&sample_input()).unwrap();
        assert!(db.upanel_delete_connection(1).is_ok());
        assert_eq!(db.upanel_list_connections().unwrap().len(), 0);
        assert!(db.upanel_delete_connection(99).is_err());
        assert!(db.upanel_get_connection_by_id(99).unwrap().is_none());
    }

    #[test]
    fn disabled_connection_rejects_secret() {
        let (_dir, db) = test_db();
        let inactive = UpanelConnectionInput {
            is_active: Some(false),
            ..sample_input()
        };
        db.upanel_add_connection(&inactive).unwrap();
        assert!(db.upanel_get_connection_secret(1).is_err());
    }

    #[test]
    fn validation_and_url_normalization() {
        let (_dir, db) = test_db();
        let empty_name = UpanelConnectionInput {
            name: "   ".to_string(),
            ..sample_input()
        };
        assert!(db.upanel_add_connection(&empty_name).is_err());

        let empty_token = UpanelConnectionInput {
            api_token: String::new(),
            ..sample_input()
        };
        assert!(db.upanel_add_connection(&empty_token).is_err());

        // Пустой URL → дефолт
        assert_eq!(
            normalize_upanel_base_url("  ").unwrap(),
            crate::constants::UPANEL_API_BASE_URL
        );
        // Хвостовые слеши срезаются
        assert_eq!(
            normalize_upanel_base_url("https://example.com/api/v1//").unwrap(),
            "https://example.com/api/v1"
        );
        // Без схемы — ошибка
        assert!(normalize_upanel_base_url("example.com").is_err());
    }
}
