// REDESIGN-05-5B4: E2E-чат — локальная таблица chat_messages (миграция v27).
// plaintext только здесь (SQLCipher); сеть видит исключительно конверты.
// CHAT-2.0 (миграция v30): chat_outgoing_targets — трекинг каждого конверта
// fan-out'а (delivered_at от серверного outbox, read_at от E2E read_receipt).
// ChatMessage в scope через `use crate::models::*;` в mod.rs.

/// Агрегаты трекинга для direction='out' (у входящих — NULL).
const OUT_STATUS_COLS: &str = "
    (CASE WHEN m.direction='out' THEN (SELECT COUNT(*) FROM chat_outgoing_targets t WHERE t.msg_id = m.id) END),
    (CASE WHEN m.direction='out' THEN (SELECT COUNT(*) FROM chat_outgoing_targets t WHERE t.msg_id = m.id AND t.delivered_at IS NOT NULL) END),
    (CASE WHEN m.direction='out' THEN (SELECT COUNT(*) FROM chat_outgoing_targets t WHERE t.msg_id = m.id AND t.read_at IS NOT NULL) END)";

fn chat_msg_from_row(r: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: r.get(0)?,
        server_id: r.get(1)?,
        room: r.get(2)?,
        peer_iid: r.get(3)?,
        direction: r.get(4)?,
        body: r.get(5)?,
        ref_type: r.get(6)?,
        ref_id: r.get(7)?,
        created_at: r.get(8)?,
        read_at: r.get(9)?,
        out_total: r.get(10)?,
        out_delivered: r.get(11)?,
        out_read: r.get(12)?,
        pending: r.get::<_, i64>(13)? != 0,
        edited: r.get::<_, i64>(14)? != 0,
        priority: r.get::<_, i64>(15)? != 0,
        attachment: r.get(16)?,
    })
}

impl Database {
    /// Исходящее сообщение: вставляется локально сразу после успешного POST
    /// на сервер. read_at проставлено (своё сообщение «прочитано»).
    #[allow(clippy::too_many_arguments)]
    pub fn chat_insert_outgoing(
        &self,
        room: &str,
        peer_iid: &str,
        body: &str,
        ref_type: Option<&str>,
        ref_id: Option<&str>,
        pending: bool,
        priority: bool,
    ) -> Result<i64, String> {
        self.conn.execute(
            "INSERT INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id, read_at, pending, priority)
             VALUES (NULL, ?1, ?2, 'out', ?3, ?4, ?5, datetime('now'), ?6, ?7)",
            rusqlite::params![room, peer_iid, body, ref_type, ref_id, pending as i64, priority as i64],
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    /// CHAT (13q): снять флаг оффлайн-очереди после успешного досыла.
    pub fn chat_clear_pending(&self, msg_id: i64) -> Result<(), String> {
        self.conn.execute(
            "UPDATE chat_messages SET pending = 0 WHERE id = ?1",
            rusqlite::params![msg_id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// CHAT (13q): исходящие из оффлайн-очереди (pending=1), хронологически —
    /// в порядке создания, чтобы досыл сохранял очерёдность.
    pub fn chat_pending_outgoing(&self) -> Result<Vec<ChatMessage>, String> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT m.id, m.server_id, m.room, m.peer_iid, m.direction, m.body, m.ref_type, m.ref_id, m.created_at, m.read_at, {OUT_STATUS_COLS}, m.pending, m.edited, m.priority, m.attachment
             FROM chat_messages m WHERE m.direction = 'out' AND m.pending = 1 ORDER BY m.id ASC"
        )).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], chat_msg_from_row).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Входящее сообщение с сервера. INSERT OR IGNORE по UNIQUE(server_id) —
    /// повторный fetch/WS-notify не плодит дубли. Возвращает Some(local_id)
    /// для новой строки, None при дедупе. created_at берём серверный —
    /// единые часы для всех участников.
    #[allow(clippy::too_many_arguments)]
    pub fn chat_insert_incoming(
        &self,
        server_id: i64,
        room: &str,
        peer_iid: &str,
        body: &str,
        ref_type: Option<&str>,
        ref_id: Option<&str>,
        created_at: &str,
        priority: bool,
    ) -> Result<Option<i64>, String> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at, priority)
             VALUES (?1, ?2, ?3, 'in', ?4, ?5, ?6, COALESCE(NULLIF(?7, ''), datetime('now')), ?8)",
            rusqlite::params![server_id, room, peer_iid, body, ref_type, ref_id, created_at, priority as i64],
        ).map_err(|e| e.to_string())?;
        Ok(if n > 0 { Some(self.conn.last_insert_rowid()) } else { None })
    }

    /// avm: прикрепить JSON-метаданные вложения к сообщению по локальному id.
    /// Ключ/nonce content-key живут только здесь (SQLCipher). Пустая строка
    /// сбрасывает вложение.
    pub fn chat_set_attachment(&self, msg_id: i64, attachment: &str) -> Result<(), String> {
        let val: Option<&str> = if attachment.is_empty() { None } else { Some(attachment) };
        self.conn.execute(
            "UPDATE chat_messages SET attachment = ?2 WHERE id = ?1",
            rusqlite::params![msg_id, val],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Максимальный server_id среди входящих — курсор для ?since_id=.
    pub fn chat_max_server_id(&self) -> Result<i64, String> {
        self.conn.query_row(
            "SELECT COALESCE(MAX(server_id), 0) FROM chat_messages WHERE server_id IS NOT NULL",
            [],
            |r| r.get(0),
        ).map_err(|e| e.to_string())
    }

    /// Сообщения комнаты (или все), хронологически. limit зажат сверху.
    pub fn chat_list(&self, room: Option<&str>, limit: u32) -> Result<Vec<ChatMessage>, String> {
        let limit = limit.clamp(1, 500) as i64;
        let (sql, room_param): (String, Option<String>) = match room {
            Some(r) => (
                format!(
                    "SELECT m.id, m.server_id, m.room, m.peer_iid, m.direction, m.body, m.ref_type, m.ref_id, m.created_at, m.read_at, {OUT_STATUS_COLS}, m.pending, m.edited, m.priority, m.attachment
                     FROM (SELECT * FROM chat_messages WHERE room = ?1 ORDER BY id DESC LIMIT ?2) m ORDER BY m.id ASC"
                ),
                Some(r.to_string()),
            ),
            None => (
                format!(
                    "SELECT m.id, m.server_id, m.room, m.peer_iid, m.direction, m.body, m.ref_type, m.ref_id, m.created_at, m.read_at, {OUT_STATUS_COLS}, m.pending, m.edited, m.priority, m.attachment
                     FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?1) m ORDER BY m.id ASC"
                ),
                None,
            ),
        };
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = match room_param {
            Some(r) => stmt.query_map(rusqlite::params![r, limit], chat_msg_from_row),
            None => stmt.query_map(rusqlite::params![limit], chat_msg_from_row),
        }.map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Прочитать входящие по локальным id. Возвращает число обновлённых.
    pub fn chat_mark_read(&self, ids: &[i64]) -> Result<u32, String> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut n = 0u32;
        let mut stmt = self.conn.prepare(
            "UPDATE chat_messages SET read_at = datetime('now')
             WHERE id = ?1 AND direction = 'in' AND read_at IS NULL",
        ).map_err(|e| e.to_string())?;
        for id in ids {
            n += stmt.execute(rusqlite::params![id]).map_err(|e| e.to_string())? as u32;
        }
        Ok(n)
    }

    /// Непрочитанные входящие (бейдж в сайдбаре).
    pub fn chat_unread_count(&self) -> Result<u32, String> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE direction = 'in' AND read_at IS NULL",
            [],
            |r| r.get::<_, u32>(0),
        ).map_err(|e| e.to_string())
    }

    /// 9ks: непрочитанные, исключая замьюченные комнаты (bx6) — для бейджа в
    /// трее/таскбаре, чтобы mute-комнаты не «светили» на иконке приложения.
    pub fn chat_unread_count_excluding(&self, muted: &[String]) -> Result<u32, String> {
        if muted.is_empty() {
            return self.chat_unread_count();
        }
        let placeholders = muted.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT COUNT(*) FROM chat_messages WHERE direction = 'in' AND read_at IS NULL AND room NOT IN ({placeholders})"
        );
        self.conn.query_row(
            &sql,
            rusqlite::params_from_iter(muted.iter()),
            |r| r.get::<_, u32>(0),
        ).map_err(|e| e.to_string())
    }

    /// Одно сообщение по локальному id (для emit WS-события).
    pub fn chat_get(&self, id: i64) -> Result<Option<ChatMessage>, String> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT m.id, m.server_id, m.room, m.peer_iid, m.direction, m.body, m.ref_type, m.ref_id, m.created_at, m.read_at, {OUT_STATUS_COLS}, m.pending, m.edited, m.priority, m.attachment
             FROM chat_messages m WHERE m.id = ?1"
        )).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(rusqlite::params![id], chat_msg_from_row).map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(m)) => Ok(Some(m)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    /// Сколько строк с данным server_id (для тестов дедупа).
    #[cfg(test)]
    pub fn chat_count_by_server_id(&self, server_id: i64) -> Result<i64, String> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE server_id = ?1",
            rusqlite::params![server_id],
            |r| r.get(0),
        ).map_err(|e| e.to_string())
    }

    // ── CHAT-2.0 (dhs): трекинг исходящих ────────────────────────────────

    /// Привязка исходящего сообщения к серверным конвертам: targets =
    /// (target_iid, server_id) в порядке ответа /chat/send. INSERT OR IGNORE:
    /// повторный POST (retry) не плодит строки.
    pub fn chat_insert_outgoing_targets(
        &self,
        msg_id: i64,
        targets: &[(String, i64)],
    ) -> Result<(), String> {
        let mut stmt = self.conn.prepare(
            "INSERT OR IGNORE INTO chat_outgoing_targets (msg_id, target_iid, server_id) VALUES (?1, ?2, ?3)",
        ).map_err(|e| e.to_string())?;
        for (iid, sid) in targets {
            stmt.execute(rusqlite::params![msg_id, iid, sid]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// delivered: проставить delivered_at по (server_id, delivered_at) из
    /// outbox. Идемпотентно (только NULL → значение). Возвращает msg_id
    /// сообщений, чей статус изменился (для chat:status события).
    pub fn chat_mark_targets_delivered(&self, rows: &[(i64, String)]) -> Result<Vec<i64>, String> {
        let mut changed = Vec::new();
        let mut upd = self.conn.prepare(
            "UPDATE chat_outgoing_targets SET delivered_at = ?2
             WHERE server_id = ?1 AND delivered_at IS NULL",
        ).map_err(|e| e.to_string())?;
        let mut q = self.conn.prepare(
            "SELECT msg_id FROM chat_outgoing_targets WHERE server_id = ?1",
        ).map_err(|e| e.to_string())?;
        for (sid, ts) in rows {
            if ts.is_empty() {
                continue;
            }
            if upd.execute(rusqlite::params![sid, ts]).map_err(|e| e.to_string())? > 0 {
                if let Ok(mid) = q.query_row(rusqlite::params![sid], |r| r.get::<_, i64>(0)) {
                    if !changed.contains(&mid) {
                        changed.push(mid);
                    }
                }
            }
        }
        Ok(changed)
    }

    /// read: read_receipt от получателя несёт server_id конвертов, которые он
    /// прочитал. Возвращает msg_id изменённых сообщений.
    pub fn chat_mark_targets_read(&self, server_ids: &[i64]) -> Result<Vec<i64>, String> {
        let mut changed = Vec::new();
        let mut upd = self.conn.prepare(
            "UPDATE chat_outgoing_targets SET read_at = datetime('now')
             WHERE server_id = ?1 AND read_at IS NULL",
        ).map_err(|e| e.to_string())?;
        let mut q = self.conn.prepare(
            "SELECT msg_id FROM chat_outgoing_targets WHERE server_id = ?1",
        ).map_err(|e| e.to_string())?;
        for sid in server_ids {
            if upd.execute(rusqlite::params![sid]).map_err(|e| e.to_string())? > 0 {
                if let Ok(mid) = q.query_row(rusqlite::params![sid], |r| r.get::<_, i64>(0)) {
                    if !changed.contains(&mid) {
                        changed.push(mid);
                    }
                }
            }
        }
        Ok(changed)
    }

    /// Агрегат по исходящему: (всего конвертов, доставлено, прочитано).
    pub fn chat_out_status(&self, msg_id: i64) -> Result<(i64, i64, i64), String> {
        self.conn.query_row(
            "SELECT COUNT(*),
                    COUNT(delivered_at),
                    COUNT(read_at)
             FROM chat_outgoing_targets WHERE msg_id = ?1",
            rusqlite::params![msg_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).map_err(|e| e.to_string())
    }

    /// (server_id, sender_iid) входящих, которые СЕЙЧАС будут помечены
    /// прочитанными (ещё не прочитаны) — адресаты read_receipt'ов.
    pub fn chat_incoming_unread_refs(&self, ids: &[i64]) -> Result<Vec<(i64, String)>, String> {
        let mut out = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT server_id, peer_iid FROM chat_messages
             WHERE id = ?1 AND direction = 'in' AND read_at IS NULL AND server_id IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        for id in ids {
            if let Ok(row) = stmt.query_row(rusqlite::params![id], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            }) {
                out.push(row);
            }
        }
        Ok(out)
    }

    /// dz3: ref_id объявлений (ref_type='news') среди помечаемых прочитанными
    /// входящих — по ним воркер отобьёт серверу POST /news/:id/read, чтобы
    /// счётчик N/M у менеджера наполнялся без старой открытой страницы новостей.
    pub fn chat_news_ref_ids(&self, ids: &[i64]) -> Result<Vec<i64>, String> {
        let mut out = Vec::new();
        let mut stmt = self.conn.prepare(
            "SELECT ref_id FROM chat_messages
             WHERE id = ?1 AND direction = 'in' AND read_at IS NULL
               AND ref_type = 'news' AND ref_id IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        for id in ids {
            if let Ok(ref_id) = stmt.query_row(rusqlite::params![id], |r| r.get::<_, String>(0)) {
                if let Ok(nid) = ref_id.parse::<i64>() {
                    if nid > 0 && !out.contains(&nid) {
                        out.push(nid);
                    }
                }
            }
        }
        Ok(out)
    }

    // ── CHAT (t8l): hard-delete ─────────────────────────────────────────

    /// (target_iid, server_id) исходящего сообщения — адреса и серверные id
    /// конвертов, которым надо разослать delete и что стереть на сервере.
    pub fn chat_outgoing_targets_for(&self, msg_id: i64) -> Result<Vec<(String, i64)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT target_iid, server_id FROM chat_outgoing_targets WHERE msg_id = ?1",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(rusqlite::params![msg_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// direction сообщения ("in"/"out") или None, если не найдено.
    pub fn chat_direction(&self, msg_id: i64) -> Result<Option<String>, String> {
        self.conn.query_row(
            "SELECT direction FROM chat_messages WHERE id = ?1",
            rusqlite::params![msg_id],
            |r| r.get::<_, String>(0),
        ).map(Some).or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            _ => Err(e.to_string()),
        })
    }

    /// Полное удаление одного локального сообщения + его трекинг-строк.
    pub fn chat_delete(&self, msg_id: i64) -> Result<u32, String> {
        self.conn.execute(
            "DELETE FROM chat_outgoing_targets WHERE msg_id = ?1",
            rusqlite::params![msg_id],
        ).map_err(|e| e.to_string())?;
        let n = self.conn.execute(
            "DELETE FROM chat_messages WHERE id = ?1",
            rusqlite::params![msg_id],
        ).map_err(|e| e.to_string())?;
        Ok(n as u32)
    }

    /// Сторона получателя: стереть входящие конверты по их server_id (пришёл
    /// E2E delete от автора). Возвращает затронутые (room, локальный id).
    pub fn chat_delete_incoming_by_server_ids(&self, server_ids: &[i64]) -> Result<Vec<(String, i64)>, String> {
        let mut sel = self.conn.prepare(
            "SELECT id, room FROM chat_messages WHERE server_id = ?1 AND direction = 'in'",
        ).map_err(|e| e.to_string())?;
        let mut del = self.conn.prepare(
            "DELETE FROM chat_messages WHERE server_id = ?1 AND direction = 'in'",
        ).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for sid in server_ids {
            if let Ok((lid, room)) = sel.query_row(rusqlite::params![sid], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            }) {
                del.execute(rusqlite::params![sid]).map_err(|e| e.to_string())?;
                out.push((room, lid));
            }
        }
        Ok(out)
    }

    /// tdq: правка собственного исходящего — новый текст + метка edited.
    /// Возвращает число затронутых строк (0 — id не наш/не out).
    pub fn chat_edit_own(&self, msg_id: i64, body: &str) -> Result<u32, String> {
        let n = self.conn.execute(
            "UPDATE chat_messages SET body = ?2, edited = 1 WHERE id = ?1 AND direction = 'out'",
            rusqlite::params![msg_id, body],
        ).map_err(|e| e.to_string())?;
        Ok(n as u32)
    }

    /// tdq (сторона получателя): применить E2E edit-конверт к входящим по их
    /// server_id — новый текст + метка edited. Возвращает (room, локальный id).
    pub fn chat_edit_incoming_by_server_ids(&self, server_ids: &[i64], body: &str) -> Result<Vec<(String, i64)>, String> {
        let mut sel = self.conn.prepare(
            "SELECT id, room FROM chat_messages WHERE server_id = ?1 AND direction = 'in'",
        ).map_err(|e| e.to_string())?;
        let mut upd = self.conn.prepare(
            "UPDATE chat_messages SET body = ?2, edited = 1 WHERE server_id = ?1 AND direction = 'in'",
        ).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for sid in server_ids {
            if let Ok((lid, room)) = sel.query_row(rusqlite::params![sid], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            }) {
                upd.execute(rusqlite::params![sid, body]).map_err(|e| e.to_string())?;
                out.push((room, lid));
            }
        }
        Ok(out)
    }

    /// qfk: проставить локальный срок жизни строки (expires_at = created_at + N
    /// часов) — по TTL комнаты. hours = 0 снимает срок.
    pub fn chat_set_expiry_hours(&self, msg_id: i64, hours: u32) -> Result<(), String> {
        if hours == 0 {
            self.conn.execute(
                "UPDATE chat_messages SET expires_at = NULL WHERE id = ?1",
                rusqlite::params![msg_id],
            ).map_err(|e| e.to_string())?;
        } else {
            self.conn.execute(
                "UPDATE chat_messages SET expires_at = datetime(created_at, '+' || ?2 || ' hours') WHERE id = ?1",
                rusqlite::params![msg_id, hours],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// qfk: подмести протухшие локальные сообщения. Возвращает (room, id)
    /// удалённых — вызывающий эмитит chat:deleted, чтобы лента обновилась.
    pub fn chat_sweep_expired(&self) -> Result<Vec<(String, i64)>, String> {
        let mut sel = self.conn.prepare(
            "SELECT id, room FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, String)> = sel
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        if !rows.is_empty() {
            self.conn.execute(
                "DELETE FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
                [],
            ).map_err(|e| e.to_string())?;
        }
        Ok(rows.into_iter().map(|(id, room)| (room, id)).collect())
    }
}
