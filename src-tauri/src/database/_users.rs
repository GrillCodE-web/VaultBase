/// Cost-фактор bcrypt для всех паролей пользователей.
///
/// Одно значение на модуль: раньше сеяный admin хешировался с 14, а
/// create_user/set_user_password — с 12, из-за чего документация («bcrypt cost
/// 14») расходилась с кодом, и пароли обычных пользователей были слабее.
/// Совпадает с мастер-паролем (main.rs) и с порогом авто-миграции там же.
const BCRYPT_COST: u32 = 14;

impl Database {

    /// Создаёт первого admin-пользователя если таблица users пустая.
    /// Пароль генерируется случайным и НИГДЕ не сохраняется (ни в логи, ни в файлы):
    /// в соло-режиме вход выполняется автоматически (try_auto_login), а если
    /// понадобится многопользовательский режим — админ задаст себе пароль в настройках.
    pub fn ensure_admin_exists(&self) -> Result<(), String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role='admin'", [], |r| r.get(0)
        ).unwrap_or(0);
        if count == 0 {
            let mut random_pw = [0u8; 32];
            use aes_gcm::aead::rand_core::RngCore;
            aes_gcm::aead::OsRng.fill_bytes(&mut random_pw);
            let random_pw_b64 = {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(random_pw)
            };
            let hash = bcrypt::hash(&random_pw_b64, BCRYPT_COST).map_err(|e| e.to_string())?;
            self.conn.execute(
                "INSERT INTO users(username, password_hash, display_name, role, must_change_password) VALUES('admin', ?1, 'Администратор', 'admin', 1)",
                params![hash],
            ).map_err(|e| e.to_string())?;
            eprintln!("[vaultbase] Admin user created (solo mode, auto-login enabled)");
        }
        Ok(())
    }

    /// Автовход: каждая установка = один пользователь, роль определяется ЛИЦЕНЗИЕЙ
    /// (config "license_role" сохраняется при activate/verify с сервера).
    /// Пароль не нужен — доступ уже защищён мастер-ключом.
    /// Возвращает None если пользователей больше одного (легаси multi-user режим).
    pub fn try_auto_login(&self, ip: Option<&str>, device: Option<&str>) -> Result<Option<crate::models::LoginResult>, String> {
        let active_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE is_active=1", [], |r| r.get(0)
        ).unwrap_or(0);
        if active_count != 1 { return Ok(None); }

        let row: Option<(i64, String, String, Option<String>)> = self.conn.query_row(
            "SELECT id, username, role, display_name FROM users WHERE is_active=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).ok();
        let Some((user_id, username, mut role, display_name)) = row else { return Ok(None); };

        // Роль из лицензии имеет приоритет над локальной
        if let Ok(Some(lic_role)) = self.get_config("license_role") {
            if (lic_role == "admin" || lic_role == "operator") && lic_role != role {
                self.conn.execute(
                    "UPDATE users SET role=?1 WHERE id=?2",
                    params![lic_role, user_id],
                ).map_err(|e| e.to_string())?;
                role = lic_role;
            }
        }

        let token = uuid::Uuid::new_v4().to_string();
        let expires = chrono::Utc::now() + chrono::Duration::days(30);
        self.conn.execute(
            "INSERT INTO user_sessions(user_id, token, ip_address, device_info, expires_at) VALUES(?1,?2,?3,?4,?5)",
            params![user_id, token, ip, device, expires.format("%Y-%m-%d %H:%M:%S").to_string()],
        ).map_err(|e| e.to_string())?;
        self.conn.execute(
            "UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?1",
            params![user_id],
        ).map_err(|e| e.to_string())?;
        let _ = self.log_user_activity(user_id, "auth.auto_login", None, None, None, ip);

        let permissions = self.resolve_permissions(user_id, &role);
        Ok(Some(crate::models::LoginResult {
            token,
            user_id,
            username,
            display_name,
            role,
            permissions,
            expires_at: Some(expires.format("%Y-%m-%d %H:%M:%S").to_string()),
        }))
    }

    /// Логин пользователя — возвращает сессионный токен + права
    pub fn user_login(&self, username: &str, password: &str, ip: Option<&str>, device: Option<&str>) -> Result<crate::models::LoginResult, String> {
        let row: Option<(i64, String, String, Option<String>, bool)> = self.conn.query_row(
            "SELECT id, password_hash, role, display_name, is_active FROM users WHERE username=?1 COLLATE NOCASE",
            params![username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_,bool>(4)?)),
        ).ok();

        let (user_id, hash, role, display_name, is_active) = row.ok_or("wrong_credentials")?;
        if !is_active { return Err("user_inactive".into()); }
        if !bcrypt::verify(password, &hash).map_err(|_| "wrong_credentials")? {
            return Err("wrong_credentials".into());
        }

        // Создаём сессию
        let token = uuid::Uuid::new_v4().to_string();
        let expires = chrono::Utc::now() + chrono::Duration::days(30);
        self.conn.execute(
            "INSERT INTO user_sessions(user_id, token, ip_address, device_info, expires_at) VALUES(?1,?2,?3,?4,?5)",
            params![user_id, token, ip, device, expires.format("%Y-%m-%d %H:%M:%S").to_string()],
        ).map_err(|e| e.to_string())?;

        // Обновляем last_seen
        self.conn.execute(
            "UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?1",
            params![user_id],
        ).map_err(|e| e.to_string())?;

        // Логируем активность
        let _ = self.log_user_activity(user_id, "auth.login", None, None,
            ip.map(|i| format!("ip={}", i)).as_deref(), ip);

        let permissions = self.resolve_permissions(user_id, &role);

        Ok(crate::models::LoginResult {
            token,
            user_id,
            username: username.to_string(),
            display_name,
            role,
            permissions,
            expires_at: Some(expires.format("%Y-%m-%d %H:%M:%S").to_string()),
        })
    }

    /// FEAT-016: sliding-refresh сессии. Если токен валиден и до истечения
    /// осталось меньше 7 дней — продлеваем до +30 дней.
    /// Возвращает (expires_at, was_extended); None — сессия мертва.
    pub fn refresh_session(&self, token: &str) -> Option<(String, bool)> {
        let expiry: Option<String> = self.conn.query_row(
            "SELECT expires_at FROM user_sessions
             WHERE token=?1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
            params![token],
            |r| r.get::<_, Option<String>>(0),
        ).ok()?;

        let now = chrono::Utc::now();
        let threshold = now + chrono::Duration::days(7);
        let current = expiry.as_deref()
            .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
            .map(|dt| dt.and_utc());

        match current {
            // Бессрочная сессия — продлевать нечего
            None => Some((expiry.unwrap_or_default(), false)),
            Some(exp) if exp < threshold => {
                let new_exp = now + chrono::Duration::days(30);
                let new_exp_str = new_exp.format("%Y-%m-%d %H:%M:%S").to_string();
                self.conn.execute(
                    "UPDATE user_sessions SET expires_at=?1 WHERE token=?2",
                    params![new_exp_str, token],
                ).ok()?;
                Some((new_exp_str, true))
            }
            Some(exp) => Some((exp.format("%Y-%m-%d %H:%M:%S").to_string(), false)),
        }
    }

    /// FEAT-017: срок действия сессии по токену (без продления).
    pub fn get_session_expiry(&self, token: &str) -> Option<String> {
        self.conn.query_row(
            "SELECT expires_at FROM user_sessions WHERE token=?1",
            params![token],
            |r| r.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    /// Завершает сессию по токену
    pub fn user_logout(&self, token: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM user_sessions WHERE token=?1", params![token])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Проверяет токен, обновляет last_seen, возвращает ActiveUser
    pub fn get_active_user_by_token(&self, token: &str) -> Option<crate::models::ActiveUser> {
        let row: Option<(i64, String, String, Option<String>, bool, Option<String>)> = self.conn.query_row(
            "SELECT u.id, u.username, u.role, u.display_name, u.is_active, s.ip_address
             FROM user_sessions s JOIN users u ON s.user_id=u.id
             WHERE s.token=?1 AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)",
            params![token], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_,bool>(4)?, r.get(5)?)),
        ).ok();
        let (user_id, username, mut role, _dn, is_active, ip_address) = row?;
        if !is_active { return None; }
        // Соло-режим: роль из лицензии имеет приоритет (могла смениться на сервере)
        let active_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE is_active=1", [], |r| r.get(0)
        ).unwrap_or(0);
        if active_count == 1 {
            if let Ok(Some(lic_role)) = self.get_config("license_role") {
                if (lic_role == "admin" || lic_role == "operator") && lic_role != role {
                    let _ = self.conn.execute("UPDATE users SET role=?1 WHERE id=?2", params![lic_role, user_id]);
                    role = lic_role;
                }
            }
        }
        // Обновляем last_seen в сессии и в user
        let _ = self.conn.execute("UPDATE user_sessions SET last_seen=CURRENT_TIMESTAMP WHERE token=?1", params![token]);
        let _ = self.conn.execute("UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?1", params![user_id]);
        let permissions = self.resolve_permissions(user_id, &role);
        Some(crate::models::ActiveUser { user_id, username, role, permissions, token: token.to_string(), ip_address })
    }

    /// Разрешает итоговый список прав: admin → всё, operator → defaults + overrides
    fn resolve_permissions(&self, user_id: i64, role: &str) -> Vec<String> {
        use crate::models::perms;
        if role == "admin" {
            return perms::ALL.iter().map(|(k, _)| k.to_string()).collect();
        }
        // Начинаем с дефолтов оператора
        let mut result: std::collections::HashSet<String> = perms::OPERATOR_DEFAULTS
            .iter().map(|s| s.to_string()).collect();
        // Применяем явные overrides из user_permissions
        if let Ok(mut stmt) = self.conn.prepare(
            "SELECT permission_key, granted FROM user_permissions WHERE user_id=?1"
        ) {
            let rows = stmt.query_map(params![user_id], |r| {
                Ok((r.get::<_,String>(0)?, r.get::<_,bool>(1)?))
            });
            if let Ok(rows) = rows {
                for row in rows.filter_map(|r| r.ok()) {
                    if row.1 { result.insert(row.0); } else { result.remove(&row.0); }
                }
            }
        }
        result.into_iter().collect()
    }

    /// Получить список всех пользователей
    pub fn get_users(&self) -> Result<Vec<crate::models::User>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, username, display_name, role, is_active, created_at, last_seen, created_by FROM users ORDER BY role DESC, username ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(crate::models::User {
            id: r.get(0)?, username: r.get(1)?, display_name: r.get(2)?,
            role: r.get(3)?, is_active: r.get::<_,bool>(4)?,
            created_at: r.get(5)?, last_seen: r.get(6)?, created_by: r.get(7)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Создать пользователя (только admin)
    pub fn create_user(&self, input: &crate::models::CreateUserInput, created_by: i64) -> Result<crate::models::User, String> {
        if input.username.trim().is_empty() { return Err("username_empty".into()); }
        // Единая политика паролей с мастер-паролем (12+ символов, верхний/нижний
        // регистр, цифра, спецсимвол) — раньше здесь был только минимум 6 символов.
        let v = PasswordValidation::check(&input.password);
        if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
        if input.role != "admin" && input.role != "operator" { return Err("invalid_role".into()); }
        // Cost 14 — как у мастер-пароля (main.rs:363) и у сеяного admin (стр. 19).
        // Здесь было 12: документация обещала 14 для всех паролей, а пароли
        // пользователей на деле хешировались слабее.
        let hash = bcrypt::hash(&input.password, BCRYPT_COST).map_err(|e| e.to_string())?;
        self.conn.execute(
            "INSERT INTO users(username, password_hash, display_name, role, created_by) VALUES(?1,?2,?3,?4,?5)",
            params![input.username.trim(), hash, input.display_name, input.role, created_by],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "username_taken".to_string() } else { e.to_string() }
        })?;
        let id = self.conn.last_insert_rowid();
        self.conn.query_row(
            "SELECT id,username,display_name,role,is_active,created_at,last_seen,created_by FROM users WHERE id=?1",
            params![id], |r| Ok(crate::models::User {
                id: r.get(0)?, username: r.get(1)?, display_name: r.get(2)?,
                role: r.get(3)?, is_active: r.get::<_,bool>(4)?,
                created_at: r.get(5)?, last_seen: r.get(6)?, created_by: r.get(7)?,
            })
        ).map_err(|e| e.to_string())
    }

    /// Обновить пользователя
    pub fn update_user(&self, id: i64, display_name: Option<&str>, is_active: bool, role: Option<&str>) -> Result<(), String> {
        if let Some(r) = role {
            if r != "admin" && r != "operator" { return Err("invalid_role".into()); }
            // Нельзя снять роль admin у последнего админа
            if r == "operator" {
                let admin_count: i64 = self.conn.query_row(
                    "SELECT COUNT(*) FROM users WHERE role='admin' AND id != ?1", params![id], |r| r.get(0)
                ).unwrap_or(0);
                if admin_count == 0 { return Err("last_admin".into()); }
            }
            self.conn.execute(
                "UPDATE users SET display_name=?1, is_active=?2, role=?3 WHERE id=?4",
                params![display_name, is_active, r, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE users SET display_name=?1, is_active=?2 WHERE id=?3",
                params![display_name, is_active, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Сменить пароль пользователя
    pub fn set_user_password(&self, id: i64, new_password: &str) -> Result<(), String> {
        // Единая политика паролей с мастер-паролем (12+ символов, верхний/нижний
        // регистр, цифра, спецсимвол) — раньше здесь был только минимум 6 символов.
        let v = PasswordValidation::check(new_password);
        if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
        let hash = bcrypt::hash(new_password, BCRYPT_COST).map_err(|e| e.to_string())?;
        self.conn.execute("UPDATE users SET password_hash=?1 WHERE id=?2", params![hash, id])
            .map_err(|e| e.to_string())?;
        // Инвалидируем все сессии кроме текущей
        self.conn.execute("DELETE FROM user_sessions WHERE user_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// FIX AUDIT-FE-01: смена собственного пароля пользователем.
    /// Проверяет текущий пароль, затем ставит новый (та же политика, что у админа).
    pub fn change_own_password(&self, user_id: i64, current: &str, new_password: &str) -> Result<(), String> {
        let hash: String = self.conn.query_row(
            "SELECT password_hash FROM users WHERE id=?1", params![user_id], |r| r.get(0)
        ).map_err(|_| "user_not_found")?;
        if !bcrypt::verify(current, &hash).map_err(|_| "wrong_current_password")? {
            return Err("wrong_current_password".into());
        }
        let v = PasswordValidation::check(new_password);
        if let Some(msg) = v.error_message() { return Err(format!("password_too_weak: {msg}")); }
        let new_hash = bcrypt::hash(new_password, BCRYPT_COST).map_err(|e| e.to_string())?;
        self.conn.execute("UPDATE users SET password_hash=?1, must_change_password=0 WHERE id=?2",
            params![new_hash, user_id]).map_err(|e| e.to_string())?;
        // Инвалидируем все сессии пользователя (кроме текущей — её токен не знаем,
        // поэтому просто удаляем все; фронтенд перелогинится при необходимости).
        self.conn.execute("DELETE FROM user_sessions WHERE user_id=?1", params![user_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// FIX AUDIT-FE-02: список онлайн-сессий (для админа).
    pub fn get_online_sessions(&self) -> Result<Vec<crate::models::UserSession>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,user_id,token,ip_address,device_info,created_at,last_seen
             FROM user_sessions ORDER BY last_seen DESC LIMIT 200"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(crate::models::UserSession {
            id: r.get(0)?, user_id: r.get(1)?, token: r.get(2)?,
            ip_address: r.get(3)?, device_info: r.get(4)?,
            created_at: r.get(5)?, last_seen: r.get(6)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// FIX AUDIT-FE-03: отозвать сессию по id (для админа).
    pub fn revoke_session(&self, session_id: i64) -> Result<(), String> {
        let rows = self.conn.execute("DELETE FROM user_sessions WHERE id=?1", params![session_id])
            .map_err(|e| e.to_string())?;
        if rows == 0 { return Err("session_not_found".into()); }
        Ok(())
    }

    /// Удалить пользователя (нельзя удалить последнего admin)
    /// FEAT-014: soft delete — пользователь деактивируется (is_active=0),
    /// сессии отзываются, но запись и история операций сохраняются.
    /// Полное удаление — только hard_delete_user (данные + сессии).
    pub fn delete_user(&self, id: i64) -> Result<(), String> {
        let role: String = self.conn.query_row(
            "SELECT role FROM users WHERE id=?1", params![id], |r| r.get(0)
        ).map_err(|_| "user_not_found")?;
        if role == "admin" {
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM users WHERE role='admin' AND is_active=1", [], |r| r.get(0)
            ).unwrap_or(0);
            if count <= 1 { return Err("last_admin".into()); }
        }
        self.conn.execute("UPDATE users SET is_active=0 WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM user_sessions WHERE user_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// FEAT-014: полное удаление (только для деактивированных).
    pub fn hard_delete_user(&self, id: i64) -> Result<(), String> {
        let (role, active): (String, i64) = self.conn.query_row(
            "SELECT role, is_active FROM users WHERE id=?1", params![id], |r| Ok((r.get(0)?, r.get(1)?))
        ).map_err(|_| "user_not_found")?;
        if active != 0 { return Err("user_must_be_deactivated_first".into()); }
        if role == "admin" {
            let count: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM users WHERE role='admin'", [], |r| r.get(0)
            ).unwrap_or(0);
            if count <= 1 { return Err("last_admin".into()); }
        }
        self.conn.execute("DELETE FROM user_sessions WHERE user_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        self.conn.execute("DELETE FROM users WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Получить полный профиль пользователя с правами и сессиями
    pub fn get_user_with_permissions(&self, id: i64) -> Result<crate::models::UserWithPermissions, String> {
        use crate::models::perms;
        let user: crate::models::User = self.conn.query_row(
            "SELECT id,username,display_name,role,is_active,created_at,last_seen,created_by FROM users WHERE id=?1",
            params![id], |r| Ok(crate::models::User {
                id: r.get(0)?, username: r.get(1)?, display_name: r.get(2)?,
                role: r.get(3)?, is_active: r.get::<_,bool>(4)?,
                created_at: r.get(5)?, last_seen: r.get(6)?, created_by: r.get(7)?,
            })
        ).map_err(|_| "user_not_found")?;

        // Явные overrides из таблицы
        let mut overrides: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
        if let Ok(mut stmt) = self.conn.prepare("SELECT permission_key, granted FROM user_permissions WHERE user_id=?1") {
            if let Ok(rows) = stmt.query_map(params![id], |r| Ok((r.get::<_,String>(0)?, r.get::<_,bool>(1)?))) {
                for row in rows.filter_map(|r| r.ok()) { overrides.insert(row.0, row.1); }
            }
        }

        let default_set: std::collections::HashSet<&str> = perms::OPERATOR_DEFAULTS.iter().copied().collect();
        let permissions: Vec<crate::models::UserPermissionEntry> = perms::ALL.iter().map(|(key, _)| {
            if user.role == "admin" {
                crate::models::UserPermissionEntry { permission_key: key.to_string(), granted: true, is_default: false }
            } else if let Some(&g) = overrides.get(*key) {
                crate::models::UserPermissionEntry { permission_key: key.to_string(), granted: g, is_default: false }
            } else {
                let def = default_set.contains(*key);
                crate::models::UserPermissionEntry { permission_key: key.to_string(), granted: def, is_default: true }
            }
        }).collect();

        let sessions: Vec<crate::models::UserSession> = {
            let mut stmt = self.conn.prepare(
                "SELECT id,user_id,token,ip_address,device_info,created_at,last_seen FROM user_sessions WHERE user_id=?1 ORDER BY last_seen DESC LIMIT 20"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![id], |r| Ok(crate::models::UserSession {
                id: r.get(0)?, user_id: r.get(1)?, token: r.get(2)?,
                ip_address: r.get(3)?, device_info: r.get(4)?,
                created_at: r.get(5)?, last_seen: r.get(6)?,
            })).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        Ok(crate::models::UserWithPermissions { user, permissions, sessions })
    }

    /// Установить право для пользователя
    pub fn set_user_permission(&self, user_id: i64, key: &str, granted: bool) -> Result<(), String> {
        use crate::models::perms;
        if !perms::ALL.iter().any(|(k, _)| *k == key) {
            return Err(format!("unknown_permission: {}", key));
        }
        self.conn.execute(
            "INSERT INTO user_permissions(user_id,permission_key,granted,updated_at) VALUES(?1,?2,?3,CURRENT_TIMESTAMP)
             ON CONFLICT(user_id,permission_key) DO UPDATE SET granted=excluded.granted, updated_at=excluded.updated_at",
            params![user_id, key, granted],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Сбросить права пользователя к дефолтам роли
    pub fn reset_user_permissions(&self, user_id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM user_permissions WHERE user_id=?1", params![user_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Логировать активность пользователя
    pub fn log_user_activity(&self, user_id: i64, action: &str, entity_type: Option<&str>,
        entity_id: Option<&str>, details: Option<&str>, ip: Option<&str>) -> Result<(), String>
    {
        self.conn.execute(
            "INSERT INTO user_activity(user_id,action_type,entity_type,entity_id,details,ip_address) VALUES(?1,?2,?3,?4,?5,?6)",
            params![user_id, action, entity_type, entity_id, details, ip],
        ).map_err(|e| e.to_string())?;
        // Авто-ротация: держим последние 50 000 записей на пользователя
        let _ = self.conn.execute(
            "DELETE FROM user_activity WHERE user_id=?1 AND id NOT IN (SELECT id FROM user_activity WHERE user_id=?1 ORDER BY id DESC LIMIT 50000)",
            params![user_id, user_id],
        );
        Ok(())
    }

    /// Получить лог активности пользователя
    pub fn get_user_activity_log(&self, user_id: Option<i64>, limit: u32, offset: u32) -> Result<Vec<crate::models::UserActivity>, String> {
        let sql = if user_id.is_some() {
            "SELECT a.id,a.user_id,u.username,u.display_name,a.action_type,a.entity_type,a.entity_id,a.details,a.ip_address,a.created_at
             FROM user_activity a JOIN users u ON a.user_id=u.id WHERE a.user_id=?1 ORDER BY a.created_at DESC LIMIT ?2 OFFSET ?3"
        } else {
            "SELECT a.id,a.user_id,u.username,u.display_name,a.action_type,a.entity_type,a.entity_id,a.details,a.ip_address,a.created_at
             FROM user_activity a JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT ?2 OFFSET ?3"
        };
        if let Some(uid) = user_id {
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![uid, limit, offset], Self::map_activity_row)
                .map_err(|e| e.to_string())?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        } else {
            // user_id=None — все пользователи
            let sql2 = "SELECT a.id,a.user_id,u.username,u.display_name,a.action_type,a.entity_type,a.entity_id,a.details,a.ip_address,a.created_at
                        FROM user_activity a JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT ?1 OFFSET ?2";
            let mut stmt = self.conn.prepare(sql2).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![limit, offset], Self::map_activity_row)
                .map_err(|e| e.to_string())?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
    }

    /// FIX AUDIT-FE-04: журнал аудита с фильтрами по пользователю и типу действия.
    pub fn get_user_activity_log_filtered(&self, user_id: Option<i64>, action_type: Option<&str>, limit: u32, offset: u32) -> Result<Vec<crate::models::UserActivity>, String> {
        let mut sql = String::from(
            "SELECT a.id,a.user_id,u.username,u.display_name,a.action_type,a.entity_type,a.entity_id,a.details,a.ip_address,a.created_at
             FROM user_activity a JOIN users u ON a.user_id=u.id WHERE 1=1");
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(uid) = user_id {
            sql.push_str(" AND a.user_id=?");
            params.push(Box::new(uid));
        }
        if let Some(at) = action_type {
            if !at.is_empty() {
                sql.push_str(" AND a.action_type=?");
                params.push(Box::new(at.to_string()));
            }
        }
        sql.push_str(" ORDER BY a.created_at DESC LIMIT ? OFFSET ?");
        params.push(Box::new(limit));
        params.push(Box::new(offset));

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), Self::map_activity_row)
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    fn map_activity_row(r: &rusqlite::Row) -> rusqlite::Result<crate::models::UserActivity> {
        Ok(crate::models::UserActivity {
            id: r.get(0)?, user_id: r.get(1)?, username: r.get(2)?,
            display_name: r.get(3)?, action_type: r.get(4)?,
            entity_type: r.get(5)?, entity_id: r.get(6)?,
            details: r.get(7)?, ip_address: r.get(8)?, created_at: r.get(9)?,
        })
    }

    /// Статистика по всем пользователям (для Admin Overview)
    pub fn get_users_stats(&self) -> Result<Vec<crate::models::UserStats>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.last_seen,
                    (SELECT COUNT(*) FROM card_assignments ca WHERE ca.user_id=u.id) as cards_taken,
                    (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id
                        JOIN card_assignments ca ON ca.card_id=p.card_id WHERE ca.user_id=u.id) as orders_created,
                    (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id
                        JOIN card_assignments ca ON ca.card_id=p.card_id WHERE ca.user_id=u.id AND o.status='delivered') as orders_delivered,
                    (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id
                        JOIN card_assignments ca ON ca.card_id=p.card_id WHERE ca.user_id=u.id AND o.status='declined') as orders_declined,
                    (SELECT COALESCE(SUM(o.total_amount),0) FROM orders o JOIN profiles p ON o.profile_id=p.id
                        JOIN card_assignments ca ON ca.card_id=p.card_id WHERE ca.user_id=u.id) as total_spent,
                    (SELECT COUNT(*) FROM orders o JOIN profiles p ON o.profile_id=p.id
                        JOIN card_assignments ca ON ca.card_id=p.card_id WHERE ca.user_id=u.id AND o.tracking_number IS NOT NULL AND o.tracking_number!='') as tracking_count,
                    (SELECT COUNT(*) FROM user_activity ua WHERE ua.user_id=u.id AND ua.action_type='card.add_manual') as cards_added_manual,
                    (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id=u.id AND s.last_seen > datetime('now','-1 hour')) as active_sessions,
                    (SELECT s.ip_address FROM user_sessions s WHERE s.user_id=u.id ORDER BY s.last_seen DESC LIMIT 1) as last_ip
             FROM users u ORDER BY u.role DESC, u.username ASC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |r| {
            Ok(crate::models::UserStats {
                user_id: r.get(0)?, username: r.get(1)?, display_name: r.get(2)?,
                role: r.get(3)?, is_active: r.get::<_,bool>(4)?, last_seen: r.get(5)?,
                cards_taken: r.get(6)?, orders_created: r.get(7)?,
                orders_delivered: r.get(8)?, orders_declined: r.get(9)?,
                total_spent: r.get::<_,f64>(10).unwrap_or(0.0),
                tracking_count: r.get(11)?, cards_added_manual: r.get(12)?,
                active_sessions: r.get(13)?, last_ip: r.get(14)?,
            })
        }).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Статистика пользователя по периодам
    pub fn get_user_period_stats(&self, user_id: i64) -> Result<Vec<crate::models::UserPeriodStats>, String> {
        let periods = [("today", "date(o.created_at)=date('now')"), ("7d", "o.created_at >= datetime('now','-7 days')"), ("30d", "o.created_at >= datetime('now','-30 days')")];
        let mut result = vec![];
        for (label, condition) in periods {
            let sql = format!(
                "SELECT COUNT(*),
                        SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END),
                        COALESCE(SUM(o.total_amount),0)
                 FROM orders o JOIN profiles p ON o.profile_id=p.id
                 JOIN card_assignments ca ON ca.card_id=p.card_id
                 WHERE ca.user_id=?1 AND {}",
                condition
            );
            let (orders_created, orders_delivered, total_spent): (i64, i64, f64) =
                self.conn.query_row(&sql, params![user_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap_or((0, 0, 0.0));
            let cards_taken: i64 = if label == "today" {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM card_assignments WHERE user_id=?1 AND date(assigned_at)=date('now')",
                    params![user_id], |r| r.get(0)
                ).unwrap_or(0)
            } else if label == "7d" {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM card_assignments WHERE user_id=?1 AND assigned_at >= datetime('now','-7 days')",
                    params![user_id], |r| r.get(0)
                ).unwrap_or(0)
            } else {
                self.conn.query_row(
                    "SELECT COUNT(*) FROM card_assignments WHERE user_id=?1 AND assigned_at >= datetime('now','-30 days')",
                    params![user_id], |r| r.get(0)
                ).unwrap_or(0)
            };
            result.push(crate::models::UserPeriodStats { period: label.to_string(), orders_created, orders_delivered, total_spent, cards_taken });
        }
        Ok(result)
    }

    /// Назначить карту пользователю (оператор берёт карту из пула)
    /// FIX: Улучшенная обработка edge cases — проверка что карта существует и не занята
    pub fn assign_card_to_user(&self, card_id: i64, user_id: i64, assigned_by: Option<i64>) -> Result<(), String> {
        // 1. Проверяем что карта существует
        let card_exists: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM credit_cards WHERE id=?1", params![card_id], |r| r.get(0)
        ).unwrap_or(0);
        if card_exists == 0 { return Err("card_not_found".into()); }

        // 2. Проверяем что карта свободна (не назначена)
        let already: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM card_assignments WHERE card_id=?1", params![card_id], |r| r.get(0)
        ).unwrap_or(0);
        if already > 0 { return Err("card_already_taken".into()); }

        // 3. Проверяем что пользователь существует и активен
        let user_active: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM users WHERE id=?1 AND is_active=1", params![user_id], |r| r.get(0)
        ).unwrap_or(0);
        if user_active == 0 { return Err("user_not_found_or_inactive".into()); }

        // 4. Атомарно назначаем карту и обновляем статус
        self.conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            self.conn.execute(
                "INSERT INTO card_assignments(card_id, user_id, assigned_by) VALUES(?1,?2,?3)",
                params![card_id, user_id, assigned_by],
            ).map_err(|e| e.to_string())?;
            // Обновляем статус карты
            self.conn.execute("UPDATE credit_cards SET status='in_use' WHERE id=?1", params![card_id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                self.log_user_activity(user_id, "card.taken", Some("card"), Some(&card_id.to_string()),
                    Some(&format!("assigned_by={:?}", assigned_by)), None)?;
                Ok(())
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// Передать карту другому пользователю
    pub fn transfer_card(&self, card_id: i64, to_user_id: i64, by_user_id: i64) -> Result<(), String> {
        let rows = self.conn.execute(
            "UPDATE card_assignments SET user_id=?1, assigned_by=?2, assigned_at=CURRENT_TIMESTAMP WHERE card_id=?3",
            params![to_user_id, by_user_id, card_id],
        ).map_err(|e| e.to_string())?;
        if rows == 0 { return Err("card_not_assigned".into()); }
        self.log_user_activity(to_user_id, "card.transferred", Some("card"), Some(&card_id.to_string()),
            Some(&format!("from_user={}", by_user_id)), None)?;
        Ok(())
    }

    /// Получить назначения карт для пользователя
    pub fn get_user_card_assignments(&self, user_id: i64) -> Result<Vec<crate::models::CardAssignment>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT ca.card_id, ca.user_id, u.username, ca.assigned_at, ca.assigned_by
             FROM card_assignments ca JOIN users u ON ca.user_id=u.id WHERE ca.user_id=?1 ORDER BY ca.assigned_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![user_id], |r| Ok(crate::models::CardAssignment {
            card_id: r.get(0)?, user_id: r.get(1)?, username: r.get(2)?,
            assigned_at: r.get(3)?, assigned_by: r.get(4)?,
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Получить id пользователя которому назначена карта
    pub fn get_card_owner(&self, card_id: i64) -> Option<i64> {
        self.conn.query_row(
            "SELECT user_id FROM card_assignments WHERE card_id=?1", params![card_id], |r| r.get(0)
        ).ok()
    }

    /// Общий обзор для Admin Dashboard
    pub fn get_admin_overview(&self) -> Result<crate::models::AdminOverview, String> {
        let users = self.get_users_stats()?;
        let today_orders: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE date(created_at)=date('now')", [], |r| r.get(0)
        ).unwrap_or(0);
        let today_delivered: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM orders WHERE date(created_at)=date('now') AND status='delivered'", [], |r| r.get(0)
        ).unwrap_or(0);
        let today_spent: f64 = self.conn.query_row(
            "SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE date(created_at)=date('now')", [], |r| r.get(0)
        ).unwrap_or(0.0);
        let total_cards_in_pool: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM credit_cards WHERE id NOT IN (SELECT card_id FROM card_assignments)", [], |r| r.get(0)
        ).unwrap_or(0);
        let total_cards_assigned: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM card_assignments", [], |r| r.get(0)
        ).unwrap_or(0);
        let online_sessions: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM user_sessions WHERE last_seen > datetime('now','-1 hour')", [], |r| r.get(0)
        ).unwrap_or(0);
        Ok(crate::models::AdminOverview { users, today_orders, today_delivered, today_spent,
            total_cards_in_pool, total_cards_assigned, online_sessions })
    }

    /// Удалить истекшие сессии
    pub fn cleanup_expired_sessions(&self) {
        let _ = self.conn.execute(
            "DELETE FROM user_sessions WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP",
            [],
        );
    }

}
