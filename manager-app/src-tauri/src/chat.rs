//! REDESIGN-05-5B4: E2E-чат менеджера (docs/CHAT_E2E.md).
//! Сервер — opaque-relay: менеджер видит всех активных воркеров с ключами,
//! шлёт ОДИН конверт одному воркеру (dm), входящие забирает fetch'ем и
//! дедуплицирует по UNIQUE(server_id). Крипто — тот же sealed-box, что и
//! у телеметрии (crypto::seal_envelope/unseal_envelope, X25519+AES-GCM).
//! Ключ менеджера — общий с телеметрией: telemetry::ensure_manager_key.
//! Локальная копия переписки — plaintext в SQLCipher (таблица chat_messages,
//! зеркало воркерской миграции v27).

use crate::crypto::{seal_envelope, unseal_envelope};
use crate::db::Database;
use crate::http;
use crate::state::{with_open, AppState};
use crate::telemetry;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, State};

const MAX_BODY_CHARS: usize = 4000;
// Порог массовых unseal-fail за один fetch: ключ на сервере протух
// (воркер шлёт на новый), генерируем и регистрируем новый.
const UNSEAL_ROTATE_THRESHOLD: usize = 5;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ChatPeer {
    pub installation_id: String,
    pub key_id: i64,
    pub pubkey: String,
    pub label: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub id: i64,
    pub server_id: Option<i64>,
    pub room: String,
    pub peer_iid: String,
    pub direction: String,
    pub body: String,
    pub ref_type: Option<String>,
    pub ref_id: Option<String>,
    pub created_at: String,
    pub read_at: Option<String>,
}

fn my_iid(db: &Database) -> Result<String, String> {
    db.get_config("installation_id").ok_or("no_installation_id".to_string())
}

fn dm_room(a: &str, b: &str) -> String {
    let mut pair = [a.to_string(), b.to_string()];
    pair.sort();
    format!("dm:{}:{}", pair[0], pair[1])
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        server_id: row.get(1)?,
        room: row.get(2)?,
        peer_iid: row.get(3)?,
        direction: row.get(4)?,
        body: row.get(5)?,
        ref_type: row.get(6)?,
        ref_id: row.get(7)?,
        created_at: row.get(8)?,
        read_at: row.get(9)?,
    })
}

const SELECT_COLS: &str =
    "SELECT id, server_id, room, peer_iid, direction, body, ref_type, ref_id, created_at, read_at FROM chat_messages";

#[tauri::command]
pub fn chat_peers(state: State<'_, AppState>) -> Result<Value, String> {
    with_open(&state, |db, enc| {
        let base = http::server_base(db);
        let token = db.get_config("license_token").ok_or("no_token")?;
        telemetry::ensure_manager_key(db, enc, &base, &token)?;
        let resp = http::request(&base, "GET", "/manager/api/chat/peers", Some(&token), None)
            .map_err(|e| format!("peers: {e}"))?;
        if resp.status != 200 {
            return Err(format!("peers_status_{}", resp.status));
        }
        let parsed: Value = serde_json::from_str(&resp.body).map_err(|e| format!("parse: {e}"))?;
        let peers: Vec<ChatPeer> = parsed
            .get("peers")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|p| {
                Some(ChatPeer {
                    installation_id: p.get("installation_id")?.as_str()?.to_string(),
                    key_id: p.get("key_id")?.as_i64()?,
                    pubkey: p.get("pubkey")?.as_str()?.to_string(),
                    label: p
                        .get("label")
                        .and_then(|l| l.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    role: p
                        .get("role")
                        .and_then(|r| r.as_str())
                        .unwrap_or("worker")
                        .to_string(),
                })
            })
            .collect();
        let self_iid = parsed
            .get("self")
            .and_then(|s| s.as_str())
            .map(str::to_string)
            .unwrap_or(my_iid(db)?);
        // Кэш пиров в config: нужен chat_fetch для resolve room/label без сети.
        db.set_config("chat_peers_cache", &serde_json::to_string(&peers).map_err(|e| e.to_string())?)?;
        Ok(json!({ "self": self_iid, "peers": peers }))
    })
}

fn cached_peer(db: &Database, iid: &str) -> Option<ChatPeer> {
    let raw = db.get_config("chat_peers_cache")?;
    let peers: Vec<ChatPeer> = serde_json::from_str(&raw).ok()?;
    peers.into_iter().find(|p| p.installation_id == iid)
}

#[tauri::command]
pub fn chat_send(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    peer_iid: String,
    body: String,
    ref_type: Option<String>,
    ref_id: Option<String>,
) -> Result<ChatMessage, String> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("empty_body".to_string());
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err("body_too_long".to_string());
    }
    let msg = with_open(&state, |db, enc| {
        let base = http::server_base(db);
        let token = db.get_config("license_token").ok_or("no_token")?;
        let (_secret, _public, _key_id) = telemetry::ensure_manager_key(db, enc, &base, &token)?;

        // Пир: сначала кэш, иначе — свежий список с сервера.
        let peer = match cached_peer(db, &peer_iid) {
            Some(p) => p,
            None => {
                let resp =
                    http::request(&base, "GET", "/manager/api/chat/peers", Some(&token), None)
                        .map_err(|e| format!("peers: {e}"))?;
                if resp.status != 200 {
                    return Err(format!("peers_status_{}", resp.status));
                }
                let parsed: Value =
                    serde_json::from_str(&resp.body).map_err(|e| format!("parse: {e}"))?;
                let peers: Vec<ChatPeer> = parsed
                    .get("peers")
                    .and_then(|p| p.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|p| {
                        Some(ChatPeer {
                            installation_id: p.get("installation_id")?.as_str()?.to_string(),
                            key_id: p.get("key_id")?.as_i64()?,
                            pubkey: p.get("pubkey")?.as_str()?.to_string(),
                            label: p.get("label").and_then(|l| l.as_str()).unwrap_or_default().to_string(),
                            role: p.get("role").and_then(|r| r.as_str()).unwrap_or("worker").to_string(),
                        })
                    })
                    .collect();
                db.set_config("chat_peers_cache", &serde_json::to_string(&peers).map_err(|e| e.to_string())?)?;
                peers
                    .into_iter()
                    .find(|p| p.installation_id == peer_iid)
                    .ok_or("peer_unknown")?
            }
        };

        let pub_bytes: [u8; 32] = hex::decode(&peer.pubkey)
            .map_err(|e| format!("pubkey_hex: {e}"))?
            .try_into()
            .map_err(|_| "pubkey_len".to_string())?;
        let sealed = seal_envelope(peer.key_id, &body, &pub_bytes)?;
        let room = dm_room(&my_iid(db)?, &peer_iid);
        let payload = json!({
            "target_iid": peer_iid,
            "key_id": peer.key_id,
            "sealed_data": sealed.to_string(),
            "room": room,
            "ref_type": ref_type,
            "ref_id": ref_id,
        });
        let resp = http::request(
            &base,
            "POST",
            "/manager/api/chat/send",
            Some(&token),
            Some(&payload.to_string()),
        )
        .map_err(|e| format!("send: {e}"))?;
        if resp.status != 201 {
            return Err(format!("send_status_{}", resp.status));
        }
        let parsed: Value = serde_json::from_str(&resp.body).map_err(|e| format!("parse: {e}"))?;
        let server_id = parsed.get("id").and_then(|i| i.as_i64());

        db.conn
            .execute(
                "INSERT INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id)
                 VALUES (?1, ?2, ?3, 'out', ?4, ?5, ?6)",
                rusqlite::params![server_id, room, peer_iid, body, ref_type, ref_id],
            )
            .map_err(|e| format!("insert: {e}"))?;
        let id = db.conn.last_insert_rowid();
        db.conn
            .query_row(&format!("{SELECT_COLS} WHERE id = ?1"), [id], map_row)
            .map_err(|e| format!("reload: {e}"))
    })?;
    let _ = app.emit("chat:message", &msg);
    Ok(msg)
}

#[tauri::command]
pub fn chat_list(
    state: State<'_, AppState>,
    room: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, String> {
    with_open(&state, |db, _| {
        let limit = limit.unwrap_or(500).clamp(1, 2000);
        let mut out = Vec::new();
        match room {
            Some(r) => {
                let mut stmt = db
                    .conn
                    .prepare(&format!("{SELECT_COLS} WHERE room = ?1 ORDER BY id ASC LIMIT ?2"))
                    .map_err(|e| format!("prepare: {e}"))?;
                let rows = stmt
                    .query_map(rusqlite::params![r, limit], map_row)
                    .map_err(|e| format!("query: {e}"))?;
                for m in rows.flatten() {
                    out.push(m);
                }
            }
            None => {
                let mut stmt = db
                    .conn
                    .prepare(&format!("{SELECT_COLS} ORDER BY id ASC LIMIT ?1"))
                    .map_err(|e| format!("prepare: {e}"))?;
                let rows = stmt
                    .query_map([limit], map_row)
                    .map_err(|e| format!("query: {e}"))?;
                for m in rows.flatten() {
                    out.push(m);
                }
            }
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn chat_mark_read(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ids: Vec<i64>,
) -> Result<i64, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let n = with_open(&state, |db, _| {
        let mut count = 0i64;
        let mut stmt = db
            .conn
            .prepare("UPDATE chat_messages SET read_at = CURRENT_TIMESTAMP WHERE id = ?1 AND read_at IS NULL")
            .map_err(|e| format!("prepare: {e}"))?;
        for id in &ids {
            count += stmt.execute([id]).map_err(|e| format!("update: {e}"))? as i64;
        }
        Ok(count)
    })?;
    let _ = app.emit("chat:read", json!({ "ids": ids }));
    Ok(n)
}

#[tauri::command]
pub fn chat_unread_count(state: State<'_, AppState>) -> Result<i64, String> {
    with_open(&state, |db, _| {
        db.conn
            .query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE direction = 'in' AND read_at IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("count: {e}"))
    })
}

#[tauri::command]
pub fn chat_fetch(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let mut fails = 0usize;
    let stored_msgs: Vec<ChatMessage> = with_open(&state, |db, enc| {
        let base = http::server_base(db);
        let token = db.get_config("license_token").ok_or("no_token")?;
        let (secret, _public, _key_id) = telemetry::ensure_manager_key(db, enc, &base, &token)?;

        let since: i64 = db
            .conn
            .query_row("SELECT COALESCE(MAX(server_id), 0) FROM chat_messages", [], |r| r.get(0))
            .unwrap_or(0);
        let path = format!("/manager/api/chat/messages?since_id={since}");
        let resp = http::request(&base, "GET", &path, Some(&token), None)
            .map_err(|e| format!("fetch: {e}"))?;
        if resp.status != 200 {
            return Err(format!("fetch_status_{}", resp.status));
        }
        let parsed: Value = serde_json::from_str(&resp.body).map_err(|e| format!("parse: {e}"))?;
        let my = my_iid(db)?;
        let mut out = Vec::new();
        for m in parsed
            .get("messages")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default()
        {
            let server_id = m.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let sealed_str = m.get("sealed_data").and_then(|v| v.as_str()).unwrap_or_default();
            let envelope: Value = match serde_json::from_str(sealed_str) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let body = match unseal_envelope(&secret, &envelope) {
                Ok(b) => b,
                Err(_) => {
                    fails += 1;
                    continue;
                }
            };
            let peer = m
                .get("sender_iid")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let room = m
                .get("room")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| dm_room(&my, &peer));
            let ref_type = m.get("ref_type").and_then(|v| v.as_str()).map(str::to_string);
            let ref_id = m.get("ref_id").and_then(|v| v.as_str()).map(str::to_string);
            // Дедуп at-least-once доставки: UNIQUE(server_id) + INSERT OR IGNORE.
            let res = db.conn.execute(
                "INSERT OR IGNORE INTO chat_messages (server_id, room, peer_iid, direction, body, ref_type, ref_id)
                 VALUES (?1, ?2, ?3, 'in', ?4, ?5, ?6)",
                rusqlite::params![server_id, room, peer, body, ref_type, ref_id],
            );
            match res {
                Ok(1) => {
                    let id = db.conn.last_insert_rowid();
                    if let Ok(row) =
                        db.conn.query_row(&format!("{SELECT_COLS} WHERE id = ?1"), [id], map_row)
                    {
                        out.push(row);
                    }
                }
                Ok(_) => {}
                Err(e) => return Err(format!("insert: {e}")),
            }
        }
        Ok(out)
    })?;

    // Авто-ротация: массовые unseal-fail — ключ на сервере сменился без нас.
    if fails >= UNSEAL_ROTATE_THRESHOLD {
        let _ = with_open(&state, |db, enc| {
            let base = http::server_base(db);
            let token = db.get_config("license_token").ok_or("no_token")?;
            let (s, p) = crate::crypto::generate_x25519();
            let stored = enc.encrypt(&hex::encode(s))?;
            db.set_config("mgr_x25519_priv_enc", &stored)?;
            db.set_config("mgr_x25519_pub", &hex::encode(p))?;
            db.set_config("mgr_key_id", "0")?;
            telemetry::ensure_manager_key(db, enc, &base, &token)?;
            Ok(())
        });
    }

    let n = stored_msgs.len() as i64;
    for msg in &stored_msgs {
        let _ = app.emit("chat:message", msg);
    }
    Ok(json!({ "stored": n, "unseal_failed": fails }))
}
