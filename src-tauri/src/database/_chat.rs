// REDESIGN-05-5B4: E2E-чат — локальная таблица chat_messages (миграция v27).
// plaintext только здесь (SQLCipher); сеть видит исключительно конверты.
// ChatMessage в scope через `use crate::models::*;` в mod.rs.
impl Database {
    /// Исходящее сообщение: вставляется локально сразу после успешного POST
    /// на сервер. read_at проставлено (своё сообщение «прочитано»).
    pub fn chat_insert_outgoing(
        &self,
        room: &str,
        peer_iid: &str,
        body: &str,
        ref_type: Option<&str>,
        ref_id: Option<&str>,
    ) -> Result<i64, String> {
        self.conn.execute(
            "INSERT INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id, read_at)
             VALUES (NULL, ?1, ?2, 'out', ?3, ?4, ?5, datetime('now'))",
            rusqlite::params![room, peer_iid, body, ref_type, ref_id],
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Входящее сообщение с сервера. INSERT OR IGNORE по UNIQUE(server_id) —
    /// повторный fetch/WS-notify не плодит дубли. Возвращает Some(local_id)
    /// для новой строки, None при дедупе. created_at берём серверный —
    /// единые часы для всех участников.
    pub fn chat_insert_incoming(
        &self,
        server_id: i64,
        room: &str,
        peer_iid: &str,
        body: &str,
        ref_type: Option<&str>,
        ref_id: Option<&str>,
        created_at: &str,
    ) -> Result<Option<i64>, String> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at)
             VALUES (?1, ?2, ?3, 'in', ?4, ?5, ?6, COALESCE(NULLIF(?7, ''), datetime('now')))",
            rusqlite::params![server_id, room, peer_iid, body, ref_type, ref_id, created_at],
        ).map_err(|e| e.to_string())?;
        Ok(if n > 0 { Some(self.conn.last_insert_rowid()) } else { None })
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
        let (sql, room_param): (&str, Option<String>) = match room {
            Some(r) => (
                "SELECT id, server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at, read_at
                 FROM (SELECT * FROM chat_messages WHERE room = ?1 ORDER BY id DESC LIMIT ?2) ORDER BY id ASC",
                Some(r.to_string()),
            ),
            None => (
                "SELECT id, server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at, read_at
                 FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?1) ORDER BY id ASC",
                None,
            ),
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let map_row = |r: &rusqlite::Row| -> rusqlite::Result<ChatMessage> {
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
            })
        };
        let rows = match room_param {
            Some(r) => stmt.query_map(rusqlite::params![r, limit], map_row),
            None => stmt.query_map(rusqlite::params![limit], map_row),
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

    /// Одно сообщение по локальному id (для emit WS-события).
    pub fn chat_get(&self, id: i64) -> Result<Option<ChatMessage>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at, read_at
             FROM chat_messages WHERE id = ?1",
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(rusqlite::params![id], |r| {
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
            })
        }).map_err(|e| e.to_string())?;
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
}
