impl Database {
    // ─────────────────────────────────────────
    //  IMAP Accounts
    // ─────────────────────────────────────────

    pub fn get_imap_accounts(&self) -> Result<Vec<ImapAccount>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,label,host,port,login,poll_interval,is_active,last_checked,
                    fail_count,last_error,last_ok
             FROM imap_accounts ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(ImapAccount {
            id: r.get(0)?, label: r.get(1)?, host: r.get(2)?, port: r.get(3)?,
            login: r.get(4)?, poll_interval: r.get(5)?,
            is_active: r.get::<_,i64>(6).unwrap_or(1) != 0,
            last_checked: r.get(7)?,
            fail_count: r.get::<_,i64>(8).unwrap_or(0),
            last_error: r.get(9).unwrap_or(None),
            last_ok: r.get(10).unwrap_or(None),
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn add_imap_account(&self, input: &ImapInput) -> Result<ImapAccount, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let enc_pw = self.encrypt_field(&input.password)?;
        self.conn.execute(
            "INSERT INTO imap_accounts(label,host,port,login,password,poll_interval,is_active) VALUES(?1,?2,?3,?4,?5,?6,1)",
            params![input.label, input.host, input.port, input.login, enc_pw, input.poll_interval],
        ).map_err(|e| e.to_string())?;
        let imap_id = self.conn.last_insert_rowid();

        // Auto-create Email Pool entry for this IMAP login if it doesn't already exist.
        // FIX AUDIT-01: email хранится ЗАШИФРОВАННЫМ (как в add_email), а поиск
        // идёт по email_hash — иначе смена мастер-пароля падала на plaintext.
        let enc_login = self.encrypt_field(&input.login)?;
        let login_hash = Self::email_hash(&input.login);
        let existing: Option<i64> = self.conn.query_row(
            "SELECT id FROM email_pool WHERE email_hash=?1", params![login_hash], |r| r.get(0),
        ).ok();
        if let Some(email_id) = existing {
            // Link existing email pool entry to this IMAP account
            let _ = self.conn.execute(
                "UPDATE email_pool SET imap_account_id=?1 WHERE id=?2",
                params![imap_id, email_id],
            );
        } else {
            // Create new email pool entry and link it
            let _ = self.conn.execute(
                "INSERT INTO email_pool(email,email_hash,label,imap_account_id,is_blocked,created_at,updated_at) VALUES(?1,?2,?3,?4,0,datetime('now'),datetime('now'))",
                params![enc_login, login_hash, input.label, imap_id],
            );
        }

        Ok(ImapAccount {
            id: imap_id,
            label: input.label.clone(), host: input.host.clone(),
            port: input.port, login: input.login.clone(),
            poll_interval: input.poll_interval, is_active: true, last_checked: None,
            fail_count: 0, last_error: None, last_ok: None,
        })
    }

    // ── IMAP-ROUTING: маршруты «домен = почта» ─────────────────────────

    /// Привязать домен к ящику. Повтор домена запрещён — вернёт ошибку
    /// "domain_already_routed:<domain>", чтобы UI показал понятное сообщение.
    pub fn add_domain_route(&self, domain: &str, imap_account_id: i64) -> Result<(), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let d = domain.trim().trim_start_matches("www.").to_lowercase();
        if d.is_empty() { return Err("domain_empty".into()); }
        let existing: Option<i64> = self.conn.query_row(
            "SELECT imap_account_id FROM imap_domain_routes WHERE domain=?1",
            params![d], |r| r.get(0),
        ).ok();
        if existing.is_some() {
            return Err(format!("domain_already_routed:{}", d));
        }
        self.conn.execute(
            "INSERT INTO imap_domain_routes(domain, imap_account_id) VALUES(?1,?2)",
            params![d, imap_account_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_domain_route(&self, domain: &str) -> Result<(), String> {
        let d = domain.trim().trim_start_matches("www.").to_lowercase();
        self.conn.execute("DELETE FROM imap_domain_routes WHERE domain=?1", params![d])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Все маршруты с меткой ящика (для дашборда «домен → почта»).
    pub fn list_domain_routes(&self) -> Result<Vec<crate::models::DomainRoute>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT r.domain, r.imap_account_id, a.label, r.created_at
             FROM imap_domain_routes r
             LEFT JOIN imap_accounts a ON a.id = r.imap_account_id
             ORDER BY r.domain"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok(crate::models::DomainRoute {
            domain: r.get(0)?,
            imap_account_id: r.get(1)?,
            account_label: r.get(2).unwrap_or(None),
            created_at: r.get::<_,Option<String>>(3).unwrap_or(None).unwrap_or_default(),
        })).map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Ящик, обслуживающий домен (None — маршрут не задан).
    pub fn get_account_for_domain(&self, domain: &str) -> Result<Option<i64>, String> {
        let d = domain.trim().trim_start_matches("www.").to_lowercase();
        Ok(self.conn.query_row(
            "SELECT imap_account_id FROM imap_domain_routes WHERE domain=?1",
            params![d], |r| r.get(0),
        ).ok())
    }

    /// IMAP-HEALTH: записать успешный поллинг — сбросить счётчик ошибок.
    pub fn mark_imap_ok(&self, id: i64) -> Result<(), String> {
        let _ = self.conn.execute(
            "UPDATE imap_accounts SET fail_count=0, last_error=NULL, last_ok=datetime('now') WHERE id=?1",
            params![id],
        );
        Ok(())
    }

    /// IMAP-HEALTH: записать ошибку поллинга — нарастить счётчик и сохранить текст.
    pub fn mark_imap_error(&self, id: i64, error: &str) -> Result<(), String> {
        let short: String = error.chars().take(200).collect();
        let _ = self.conn.execute(
            "UPDATE imap_accounts SET fail_count=fail_count+1, last_error=?2, last_checked=datetime('now') WHERE id=?1",
            params![id, short],
        );
        Ok(())
    }

    pub fn update_imap_account(&self, id: i64, input: &ImapInput) -> Result<(), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        if !input.password.is_empty() {
            let enc_pw = self.encrypt_field(&input.password)?;
            self.conn.execute(
                "UPDATE imap_accounts SET label=?1,host=?2,port=?3,login=?4,password=?5,poll_interval=?6 WHERE id=?7",
                params![input.label, input.host, input.port, input.login, enc_pw, input.poll_interval, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE imap_accounts SET label=?1,host=?2,port=?3,login=?4,poll_interval=?5 WHERE id=?6",
                params![input.label, input.host, input.port, input.login, input.poll_interval, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_imap_account(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM imap_accounts WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Link all existing IMAP accounts to Email Pool entries (create or update).
    /// Returns number of accounts processed.
    pub fn link_all_imap_to_email_pool(&self) -> Result<u32, String> {
        let accounts = self.get_imap_accounts()?;
        let mut count = 0u32;
        for acc in &accounts {
            // FIX AUDIT-01: email шифруем, поиск по email_hash (как в add_email).
            let enc_login = self.encrypt_field(&acc.login)?;
            let login_hash = Self::email_hash(&acc.login);
            let existing: Option<i64> = self.conn.query_row(
                "SELECT id FROM email_pool WHERE email_hash=?1", params![login_hash], |r| r.get(0),
            ).ok();
            if let Some(email_id) = existing {
                let _ = self.conn.execute(
                    "UPDATE email_pool SET imap_account_id=?1 WHERE id=?2 AND (imap_account_id IS NULL OR imap_account_id != ?1)",
                    params![acc.id, email_id],
                );
            } else {
                let _ = self.conn.execute(
                    "INSERT INTO email_pool(email,email_hash,label,imap_account_id,is_blocked,created_at,updated_at) VALUES(?1,?2,?3,?4,0,datetime('now'),datetime('now'))",
                    params![enc_login, login_hash, acc.label, acc.id],
                );
            }
            count += 1;
        }
        Ok(count)
    }

    pub fn toggle_imap_account(&self, id: i64, active: bool) -> Result<(), String> {
        self.conn.execute("UPDATE imap_accounts SET is_active=?1 WHERE id=?2", params![active as i64, id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_imap_account_with_password(&self, id: i64) -> Result<(ImapAccount, String), String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let (acc, enc_pw) = self.conn.query_row(
            "SELECT id,label,host,port,login,password,poll_interval,is_active,last_checked,
                    fail_count,last_error,last_ok
             FROM imap_accounts WHERE id=?1",
            params![id],
            |r| Ok((ImapAccount {
                id: r.get(0)?, label: r.get(1)?, host: r.get(2)?, port: r.get(3)?,
                login: r.get(4)?, poll_interval: r.get(6)?,
                is_active: r.get::<_,i64>(7).unwrap_or(1) != 0,
                last_checked: r.get(8)?,
                fail_count: r.get::<_,i64>(9).unwrap_or(0),
                last_error: r.get(10).unwrap_or(None),
                last_ok: r.get(11).unwrap_or(None),
            }, r.get::<_,Option<String>>(5)?.unwrap_or_default())),
        ).map_err(|e| e.to_string())?;
        let pw = if enc_pw.is_empty() {
            String::new()
        } else {
            match self.decrypt_field(&enc_pw) {
                Ok(p) => p,
                // Строки, записанные до введения шифрования IMAP-паролей, хранят
                // plaintext. Auth-tag AES-GCM гарантирует, что настоящий шифротекст
                // здесь не может дать ошибку, значит это legacy-строка.
                // Перешифровываем её на месте (как в get_smtp_config_password).
                Err(_) => {
                    let enc = self.encrypt_field(&enc_pw)?;
                    self.conn.execute(
                        "UPDATE imap_accounts SET password=?1 WHERE id=?2",
                        params![enc, id],
                    ).map_err(|e| e.to_string())?;
                    enc_pw
                }
            }
        };
        Ok((acc, pw))
    }

    pub fn update_imap_last_checked(&self, account_id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_accounts SET last_checked=datetime('now') WHERE id=?1", params![account_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  IMAP Messages
    // ─────────────────────────────────────────

    pub fn save_imap_message(&self, account_id: i64, uid: Option<&str>, subject: &str,
        from_email: &str, received_at: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>) -> Result<(), String>
    {
        self.save_imap_message_v2(account_id, uid, subject, from_email, received_at,
            order_num, tracking, action, action.is_some())
    }

    /// FIX B66: `processed` = true только если action реально применено к заказу
    pub fn save_imap_message_v2(&self, account_id: i64, uid: Option<&str>, subject: &str,
        from_email: &str, received_at: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>, processed: bool) -> Result<(), String>
    {
        if let Some(u) = uid {
            let exists: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND message_uid=?2",
                params![account_id, u], |r| r.get(0),
            ).unwrap_or(0);
            if exists > 0 { return Ok(()); }
        }
        let from_domain = Self::domain_from_email(from_email);
        self.conn.execute(
            "INSERT INTO imap_messages(account_id,message_uid,subject,from_email,from_domain,received_at,extracted_order_number,extracted_tracking,action_taken,processed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![account_id, uid, subject, from_email, from_domain, received_at, order_num, tracking, action, processed as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// IMAP-ROUTING: домен отправителя из From-заголовка
    /// ("Shop <orders@zoro.com>" → "zoro.com"), lowercase, без www.
    pub(crate) fn domain_from_email(from: &str) -> Option<String> {
        let after_at = from.rsplit('@').next()?;
        let cleaned: String = after_at
            .trim_end_matches('>')
            .trim()
            .trim_start_matches("www.")
            .to_lowercase();
        if cleaned.is_empty() { None } else { Some(cleaned) }
    }

    /// FIX B57: проверяет наличие UID в БД для дедупликации до сетевого запроса
    pub fn imap_uid_exists(&self, account_id: i64, uid: &str) -> bool {
        self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND message_uid=?2",
            params![account_id, uid], |r| r.get::<_,i64>(0),
        ).unwrap_or(0) > 0
    }

    /// FIX B22: возвращает все известные UID аккаунта для фильтрации до сетевого запроса
    pub fn get_known_imap_uids(&self, account_id: i64) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT message_uid FROM imap_messages WHERE account_id=?1 AND message_uid IS NOT NULL"
        ).map_err(|e| e.to_string())?;
        let uids: Vec<String> = stmt.query_map(params![account_id], |r| r.get(0))
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(uids)
    }

    pub fn get_imap_messages(&self, filter: &ImapMsgFilter, page: u32, per_page: u32) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;

        // FIX SQL-INJ-01: Строгая валидация всех входных данных перед использованием в SQL
        let mut w = vec!["1=1".to_string()];

        // account_id — только целые числа, никакие special characters
        if let Some(aid) = filter.account_id {
            // Дополнительная защита: проверяем, что aid — положительное число
            if aid > 0 {
                w.push(format!("account_id={}", aid));
            }
        }

        // processed — только boolean 0 или 1
        if let Some(p) = filter.processed {
            // Boolean уже валиден (true/false), конвертируем в 1/0
            w.push(format!("processed={}", if p { 1 } else { 0 }));
        }

        // Даты — строгая валидация формата YYYY-MM-DD
        if let Some(ref d) = filter.date_from {
            if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 && d.starts_with(|c: char| c.is_ascii_digit()) {
                // Дополнительная проверка: только цифры и дефисы в правильных позициях
                let parts: Vec<&str> = d.split('-').collect();
                if parts.len() == 3 && parts[0].len() == 4 && parts[1].len() == 2 && parts[2].len() == 2 {
                    w.push(format!("DATE(received_at)>='{}'", d));
                }
            }
        }
        if let Some(ref d) = filter.date_to {
            if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 && d.starts_with(|c: char| c.is_ascii_digit()) {
                let parts: Vec<&str> = d.split('-').collect();
                if parts.len() == 3 && parts[0].len() == 4 && parts[1].len() == 2 && parts[2].len() == 2 {
                    w.push(format!("DATE(received_at)<='{}'", d));
                }
            }
        }

        let where_clause = w.join(" AND ");
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM imap_messages WHERE {}", where_clause), [], |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!("SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE {} ORDER BY id DESC LIMIT {} OFFSET {}", where_clause, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items: Vec<ImapMessage> = stmt.query_map([], |r| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let pages = ((total as u32) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn get_imap_account_stats(&self, account_id: i64) -> Result<ImapAccountStats, String> {
        let total: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1", params![account_id], |r| r.get(0),
        ).unwrap_or(0);
        let unread: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND is_read=0", params![account_id], |r| r.get(0),
        ).unwrap_or(0);
        let mut stmt = self.conn.prepare(
            "SELECT folder, COUNT(*), SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END) FROM imap_messages WHERE account_id=?1 GROUP BY folder"
        ).map_err(|e| e.to_string())?;
        let folders: Vec<ImapFolderInfo> = stmt.query_map(params![account_id], |r| {
            Ok(ImapFolderInfo { name: r.get(0)?, total: r.get(1)?, unread: r.get::<_,Option<i64>>(2)?.unwrap_or(0) })
        }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(ImapAccountStats { total, unread, folders })
    }

    pub fn get_imap_folder_messages(&self, account_id: i64, folder: &str, page: u32, per_page: u32, search: Option<&str>) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let search_active = search.map(|s| !s.trim().is_empty()).unwrap_or(false);
        let total: i64 = if search_active {
            self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND folder=?2 AND (LOWER(subject) LIKE '%' || LOWER(?3) || '%' OR LOWER(from_email) LIKE '%' || LOWER(?3) || '%')",
                params![account_id, folder, search.unwrap_or("")], |r| r.get(0),
            ).unwrap_or(0)
        } else {
            self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE account_id=?1 AND folder=?2",
                params![account_id, folder], |r| r.get(0),
            ).unwrap_or(0)
        };
        let row_map = |r: &rusqlite::Row| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        });
        let items: Vec<ImapMessage> = if search_active {
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE account_id=?1 AND folder=?2 AND (LOWER(subject) LIKE '%' || LOWER(?3) || '%' OR LOWER(from_email) LIKE '%' || LOWER(?3) || '%') ORDER BY id DESC LIMIT ?4 OFFSET ?5";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(params![account_id, folder, search.unwrap_or(""), pp, offset], row_map)
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
        } else {
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE account_id=?1 AND folder=?2 ORDER BY id DESC LIMIT ?3 OFFSET ?4";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let x = stmt.query_map(params![account_id, folder, pp, offset], row_map)
                .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect(); x
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn get_imap_message_body(&self, id: i64) -> Result<Option<String>, String> {
        let res = self.conn.query_row(
            "SELECT body FROM imap_messages WHERE id=?1", params![id], |r| r.get(0),
        );
        match res {
            Ok(v) => Ok(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// FIX AUDIT-FE-05: account_id по id сообщения (для mark_imap_read).
    pub fn get_imap_message_account_id(&self, id: i64) -> Result<Option<i64>, String> {
        let res = self.conn.query_row(
            "SELECT account_id FROM imap_messages WHERE id=?1", params![id], |r| r.get(0),
        );
        match res {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// FIX AUDIT-13: возвращает (uid, folder) сообщения для live-запросов к серверу.
    pub fn get_imap_message_uid_folder(&self, id: i64) -> Result<Option<(String, String)>, String> {
        let res = self.conn.query_row(
            "SELECT message_uid, folder FROM imap_messages WHERE id=?1",
            params![id], |r| Ok((r.get::<_,Option<String>>(0)?, r.get::<_,String>(1)?)),
        );
        match res {
            Ok((Some(uid), folder)) => Ok(Some((uid, folder))),
            Ok(_) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    /// FIX AUDIT-13: сохраняет тело письма в кэш.
    pub fn set_imap_message_body(&self, id: i64, body: &str) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_messages SET body=?1 WHERE id=?2", params![body, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_imap_message_read(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_messages SET is_read=1 WHERE id=?1", params![id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_imap_message(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM imap_messages WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Cached folder list (stored in config table as JSON).
    pub fn get_cached_imap_folders(&self, account_id: i64) -> Vec<String> {
        let key = format!("imap_folders_{}", account_id);
        let val: Option<String> = self.conn.query_row(
            "SELECT value FROM config WHERE key=?1", params![key], |r| r.get(0),
        ).ok();
        val.and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok()).unwrap_or_default()
    }

    pub fn save_cached_imap_folders(&self, account_id: i64, folders: &[String]) -> Result<(), String> {
        let key = format!("imap_folders_{}", account_id);
        let val = serde_json::to_string(folders).unwrap_or_default();
        self.conn.execute(
            "INSERT OR REPLACE INTO config(key,value) VALUES(?1,?2)", params![key, val],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Unified inbox: messages from all accounts' INBOX sorted newest first.
    pub fn get_all_inbox_messages(&self, page: u32, per_page: u32, search: Option<&str>) -> Result<PaginatedMessages, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let search_active = search.map(|s| !s.trim().is_empty()).unwrap_or(false);
        let row_map = |r: &rusqlite::Row| Ok(ImapMessage {
            id: r.get(0)?, account_id: r.get(1)?, message_uid: r.get(2)?,
            subject: r.get(3)?, from_email: r.get(4)?, to_email: r.get(5)?,
            received_at: r.get(6)?, body: r.get(7)?, folder: r.get(8)?,
            is_read: r.get::<_,i64>(9).unwrap_or(0) != 0,
            extracted_order_number: r.get(10)?, extracted_tracking: r.get(11)?,
            action_taken: r.get(12)?,
            processed: r.get::<_,i64>(13).unwrap_or(0) != 0,
            created_at: r.get(14)?,
        });
        let (total, items): (i64, Vec<ImapMessage>) = if search_active {
            let q = search.unwrap_or("");
            let t: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM imap_messages WHERE folder='INBOX' AND (LOWER(subject) LIKE '%'||LOWER(?1)||'%' OR LOWER(from_email) LIKE '%'||LOWER(?1)||'%')",
                params![q], |r| r.get(0),
            ).unwrap_or(0);
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE folder='INBOX' AND (LOWER(subject) LIKE '%'||LOWER(?1)||'%' OR LOWER(from_email) LIKE '%'||LOWER(?1)||'%') ORDER BY id DESC LIMIT ?2 OFFSET ?3";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![q, pp, offset], row_map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (t, rows)
        } else {
            let t: i64 = self.conn.query_row("SELECT COUNT(*) FROM imap_messages WHERE folder='INBOX'", [], |r| r.get(0)).unwrap_or(0);
            let sql = "SELECT id,account_id,message_uid,subject,from_email,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed,created_at FROM imap_messages WHERE folder='INBOX' ORDER BY id DESC LIMIT ?1 OFFSET ?2";
            let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![pp, offset], row_map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
            (t, rows)
        };
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedMessages { items, total: total as u32, page, per_page, pages })
    }

    pub fn archive_imap_message(&self, id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE imap_messages SET folder='Archive' WHERE id=?1",
            params![id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_imap_message_with_body(&self, account_id: i64, uid: Option<&str>,
        subject: &str, from_email: &str, to_email: Option<&str>, received_at: &str,
        body: Option<&str>, folder: &str, order_num: Option<&str>,
        tracking: Option<&str>, action: Option<&str>, processed: bool) -> Result<(), String>
    {
        if let Some(u) = uid {
            if self.imap_uid_exists(account_id, u) { return Ok(()); }
        }
        let from_domain = Self::domain_from_email(from_email);
        self.conn.execute(
            "INSERT INTO imap_messages(account_id,message_uid,subject,from_email,from_domain,to_email,received_at,body,folder,is_read,extracted_order_number,extracted_tracking,action_taken,processed) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13)",
            params![account_id, uid, subject, from_email, from_domain, to_email, received_at, body, folder, order_num, tracking, action, processed as i64],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── SMTP ───────────────────────────────────────────────────

    pub fn add_smtp_config(&self, input: &SmtpConfigInput) -> Result<SmtpConfig, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let enc_pw = self.encrypt_field(&input.password)?;
        self.conn.execute(
            "INSERT INTO smtp_configs(label,host,port,login,password,use_tls,use_starttls) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![input.label, input.host, input.port, input.login, enc_pw, input.use_tls as i64, input.use_starttls as i64],
        ).map_err(|e| e.to_string())?;
        let id = self.conn.last_insert_rowid();
        self.get_smtp_config(id)
    }

    fn get_smtp_config(&self, id: i64) -> Result<SmtpConfig, String> {
        self.conn.query_row(
            "SELECT id,label,host,port,login,use_tls,use_starttls,is_active,created_at FROM smtp_configs WHERE id=?1",
            params![id], |r| Ok(SmtpConfig {
                id: r.get(0)?, label: r.get(1)?, host: r.get(2)?,
                port: r.get(3)?, login: r.get(4)?,
                use_tls: r.get::<_,i64>(5)? != 0,
                use_starttls: r.get::<_,i64>(6)? != 0,
                is_active: r.get::<_,i64>(7)? != 0,
                created_at: r.get(8)?,
            }),
        ).map_err(|e| e.to_string())
    }

    pub fn get_smtp_configs(&self) -> Result<Vec<SmtpConfig>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,label,host,port,login,use_tls,use_starttls,is_active,created_at FROM smtp_configs ORDER BY id"
        ).map_err(|e| e.to_string())?;
        let items: Vec<SmtpConfig> = stmt.query_map([], |r| Ok(SmtpConfig {
            id: r.get(0)?, label: r.get(1)?, host: r.get(2)?,
            port: r.get(3)?, login: r.get(4)?,
            use_tls: r.get::<_,i64>(5)? != 0,
            use_starttls: r.get::<_,i64>(6)? != 0,
            is_active: r.get::<_,i64>(7)? != 0,
            created_at: r.get(8)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    pub fn get_smtp_config_password(&self, id: i64) -> Result<String, String> {
        if self.is_locked() { return Err("database_locked".into()); }
        let stored: String = self.conn.query_row(
            "SELECT password FROM smtp_configs WHERE id=?1", params![id], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        if stored.is_empty() { return Ok(stored); }

        match self.decrypt_field(&stored) {
            Ok(pw) => Ok(pw),
            // Rows written before SMTP passwords were encrypted hold plaintext.
            // AES-GCM's auth tag means a real ciphertext cannot decrypt-fail here,
            // so a failure identifies a legacy row. Re-encrypt it in place.
            Err(_) => {
                let enc = self.encrypt_field(&stored)?;
                self.conn.execute(
                    "UPDATE smtp_configs SET password=?1 WHERE id=?2",
                    params![enc, id],
                ).map_err(|e| e.to_string())?;
                Ok(stored)
            }
        }
    }

    pub fn delete_smtp_config(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM smtp_configs WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn log_sent_email(&self, smtp_config_id: Option<i64>, from_email: Option<&str>,
        to_email: &str, subject: Option<&str>, body_text: Option<&str>,
        status: &str, error_message: Option<&str>) -> Result<(), String>
    {
        self.conn.execute(
            "INSERT INTO sent_emails(smtp_config_id,from_email,to_email,subject,body_text,status,error_message) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![smtp_config_id, from_email, to_email, subject, body_text, status, error_message],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_sent_emails(&self, page: u32, per_page: u32) -> Result<PaginatedSentEmails, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM sent_emails", [], |r| r.get(0)).unwrap_or(0);
        let mut stmt = self.conn.prepare(
            "SELECT id,smtp_config_id,from_email,to_email,subject,status,error_message,sent_at FROM sent_emails ORDER BY id DESC LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;
        let items: Vec<SentEmail> = stmt.query_map(params![pp, offset], |r| Ok(SentEmail {
            id: r.get(0)?, smtp_config_id: r.get(1)?, from_email: r.get(2)?,
            to_email: r.get(3)?, subject: r.get(4)?,
            status: r.get(5)?, error_message: r.get(6)?, sent_at: r.get(7)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        let pages = ((total as u32).max(1) + per_page - 1) / per_page;
        Ok(PaginatedSentEmails { items, total: total as u32, page, per_page, pages })
    }

    // ─────────────────────────────────────────
    //  Order helpers for IMAP
    // ─────────────────────────────────────────

    pub fn find_order_by_number(&self, order_number: &str) -> Result<Option<i64>, String> {
        let res = self.conn.query_row(
            "SELECT id FROM orders WHERE order_number=?1 LIMIT 1", params![order_number], |r| r.get(0),
        );
        match res {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn update_order_status_simple(&self, id: i64, status: &str, tracking: Option<&str>) -> Result<(), String> {
        // FIX AUDIT-16: нормализуем статус — "processing" не входит в допустимые.
        let status = match status {
            "processing" => "pending",
            s => s,
        };
        const VALID_STATUSES: &[&str] = &["pending", "shipped", "delivered", "declined", "cancelled", "failed"];
        if !VALID_STATUSES.contains(&status) {
            return Ok(());
        }
        if let Some(t) = tracking {
            self.conn.execute(
                "UPDATE orders SET status=?1, tracking_number=?2, updated_at=datetime('now') WHERE id=?3",
                params![status, t, id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE orders SET status=?1, updated_at=datetime('now') WHERE id=?2",
                params![status, id],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Activity Log
    // ─────────────────────────────────────────

    pub fn get_activity_log(&self, filter: &LogFilter, page: u32, per_page: u32) -> Result<PaginatedLog, String> {
        let pp = per_page.max(1) as i64;
        let offset = ((page.saturating_sub(1)) as i64) * pp;
        let mut w = vec!["1=1".to_string()];
        let mut binds: Vec<String> = Vec::new();
        if let Some(ref et) = filter.event_type {
            if et != "all" {
                w.push("event_type LIKE ? ESCAPE '\\'".to_string());
                binds.push(format!("{}%", Self::escape_like(et)));
            }
        }
        if let Some(ref d) = filter.from_date { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { w.push(format!("DATE(created_at)>='{}'", d)); } }
        if let Some(ref d) = filter.to_date   { if d.chars().all(|c| c.is_ascii_digit() || c == '-') && d.len() == 10 { w.push(format!("DATE(created_at)<='{}'", d)); } }
        if let Some(ref s) = filter.entity_type {
            if !s.is_empty() {
                w.push("(event_type LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')".to_string());
                let pat = format!("%{}%", Self::escape_like(s));
                binds.push(pat.clone());
                binds.push(pat);
            }
        }
        let wh = w.join(" AND ");
        let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let total: i64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM activity_log WHERE {}", wh),
            rusqlite::params_from_iter(bind_refs.iter().copied()),
            |r| r.get(0),
        ).unwrap_or(0);
        let sql = format!("SELECT id,event_type,description,entity_type,entity_id,created_at FROM activity_log WHERE {} ORDER BY id DESC LIMIT {} OFFSET {}", wh, pp, offset);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items = stmt.query_map(rusqlite::params_from_iter(bind_refs.iter().copied()), |r| Ok(ActivityLog {
            id: r.get(0)?, event_type: r.get(1)?, description: r.get(2)?,
            entity_type: r.get(3)?, entity_id: r.get(4)?, created_at: r.get(5)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(PaginatedLog { items, total: total as u32, page, per_page })
    }

    pub fn clear_activity_log(&self) -> Result<(), String> {
        self.conn.execute("DELETE FROM activity_log", []).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Unsynced Footprints
    // ─────────────────────────────────────────

    /// PHASE 1: Footprint Sync V2 — возвращаем unsynced footprints с order_status и installation_id_hash
    pub fn get_unsynced_footprints_db(&self) -> Result<Vec<Footprint>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,shop_id,shop_domain,order_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced,user_token,order_status,installation_id_hash,created_at FROM shop_footprints WHERE synced=0 LIMIT 500"
        ).map_err(|e| e.to_string())?;
        let items = stmt.query_map([], |r| Ok(Footprint {
            id: r.get(0)?, shop_id: r.get(1)?, shop_domain: r.get(2)?, order_id: r.get(3)?,
            email_hash: r.get(4)?, ip_hash: r.get(5)?, drop_hash: r.get(6)?, bin: r.get(7)?,
            phone_hash: r.get(8)?, name_hash: r.get(9)?,
            synced: r.get::<_,i64>(10).unwrap_or(0) != 0,
            user_token: r.get(11)?,
            order_status: r.get(12)?,
            installation_id_hash: r.get(13)?,
            created_at: r.get(14)?,
        })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        Ok(items)
    }

    /// PHASE 1: Footprint Sync V2 — возвращаем footprint с order_status и installation_id_hash
    pub fn get_footprint_for_profile_shop(&self, profile_id: &str, shop_id: i64) -> Option<Footprint> {
        self.conn.query_row(
            "SELECT id,shop_id,shop_domain,order_id,email_hash,ip_hash,drop_hash,bin,phone_hash,name_hash,synced,user_token,order_status,installation_id_hash,created_at \
             FROM shop_footprints WHERE shop_id=?1 AND order_id IN (SELECT id FROM orders WHERE profile_id=?2) \
             ORDER BY created_at DESC LIMIT 1",
            params![shop_id, profile_id],
            |r| Ok(Footprint {
                id: r.get(0)?, shop_id: r.get(1)?, shop_domain: r.get(2)?, order_id: r.get(3)?,
                email_hash: r.get(4)?, ip_hash: r.get(5)?, drop_hash: r.get(6)?, bin: r.get(7)?,
                phone_hash: r.get(8)?, name_hash: r.get(9)?,
                synced: r.get::<_,i64>(10).unwrap_or(0) != 0,
                user_token: r.get(11)?,
                order_status: r.get(12)?,
                installation_id_hash: r.get(13)?,
                created_at: r.get(14)?,
            }),
        ).ok()
    }

    pub fn mark_footprints_synced_db(&self, ids: &[i64]) -> Result<(), String> {
        if ids.is_empty() { return Ok(()); }
        let placeholders = ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
        self.conn.execute_batch(&format!("UPDATE shop_footprints SET synced=1 WHERE id IN ({})", placeholders))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─────────────────────────────────────────
    //  Global Search
    // ─────────────────────────────────────────

    pub fn global_search(&self, query: &str) -> Result<SearchResults, String> {
        use serde_json::json;

        // FIX TC-01: Escape LIKE wildcards to prevent SQL injection via pattern matching
        // Users can still search for literal % or _ by escaping them
        let escaped_query: String = query
            .chars()
            .flat_map(|c| match c {
                '%' => "\\%".chars().collect::<Vec<_>>(),
                '_' => "\\_".chars().collect::<Vec<_>>(),
                c => vec![c],
            })
            .collect();

        let q = format!("%{}%", escaped_query.to_lowercase());
        let ql = format!("%{}%", escaped_query);

        // Cards — search by last4, bin
        let mut cards = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,last4,bin,bank_name,card_type,status FROM credit_cards WHERE last4 LIKE ?1 OR bin LIKE ?2 LIMIT 8"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![ql, ql], |r| {
            Ok(json!({
                "id": r.get::<_,i64>(0)?, "last4": r.get::<_,Option<String>>(1)?,
                "bin": r.get::<_,Option<String>>(2)?, "bank_name": r.get::<_,Option<String>>(3)?,
                "card_type": r.get::<_,Option<String>>(4)?, "status": r.get::<_,String>(5)?,
                "_type": "card",
            }))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { cards.push(v); } }

        // Orders — search by order_number
        let mut orders = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT o.id,o.order_number,o.status,s.name FROM orders o LEFT JOIN shops s ON o.shop_id=s.id WHERE o.order_number LIKE ?1 LIMIT 6"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![ql], |r| {
            Ok(json!({
                "id": r.get::<_,i64>(0)?, "order_number": r.get::<_,Option<String>>(1)?,
                "status": r.get::<_,String>(2)?, "shop_name": r.get::<_,Option<String>>(3)?,
                "_type": "order",
            }))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { orders.push(v); } }

        // Shops
        let mut shops = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,name,domain FROM shops WHERE LOWER(name) LIKE ?1 OR LOWER(domain) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "name": r.get::<_,String>(1)?, "domain": r.get::<_,String>(2)?, "_type": "shop"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { shops.push(v); } }

        // Emails
        let mut emails = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,email_hash,label FROM email_pool WHERE LOWER(label) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "label": r.get::<_,Option<String>>(2)?, "_type": "email"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { emails.push(v); } }

        // Proxies
        let mut proxies = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT id,host,port,label FROM proxies WHERE LOWER(label) LIKE ?1 OR LOWER(host) LIKE ?1 LIMIT 5"
        ).map_err(|e| e.to_string())?;
        for row in stmt.query_map(params![q], |r| {
            Ok(json!({"id": r.get::<_,i64>(0)?, "host": r.get::<_,String>(1)?, "port": r.get::<_,i64>(2)?, "label": r.get::<_,Option<String>>(3)?, "_type": "proxy"}))
        }).map_err(|e| e.to_string())? { if let Ok(v) = row { proxies.push(v); } }

        // Profiles — search by drop recipient_name or notes
        // FIX AUDIT-15: recipient_name зашифрован — LIKE по шифротексту не работал.
        // Расшифровываем имена и фильтруем в Rust.
        let mut profiles = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT p.id, d.recipient_name, d.city, d.country, p.notes
             FROM profiles p LEFT JOIN drops d ON d.profile_id=p.id"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>)> =
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
        let ql = query.to_lowercase();
        for (pid, name_enc, city, country, notes) in rows {
            let name = name_enc.as_deref()
                .map(|n| self.decrypt_field(n).unwrap_or_else(|_| n.to_string()));
            let name_lower = name.as_deref().unwrap_or("").to_lowercase();
            let notes_lower = notes.as_deref().unwrap_or("").to_lowercase();
            if name_lower.contains(&ql) || notes_lower.contains(&ql) {
                profiles.push(json!({
                    "id": pid, "name": name, "city": city, "country": country,
                    "notes": notes, "_type": "profile",
                }));
                if profiles.len() >= 5 { break; }
            }
        }

        Ok(SearchResults { cards, profiles, orders, shops, emails, proxies })
    }
}
