//! REDESIGN-05-5B4: E2E-шифрованная переписка воркеров (docs/CHAT_E2E.md).
//!
//! Крипто-граница: plaintext существует только в локальной SQLCipher-БД
//! (chat_messages, миграция v27) и в памяти процесса. В транзит и на сервер
//! уходит исключительно sealed-box конверт TelemetryEnvelope (тот же контракт,
//! что у срезов/telemetry: X25519-eph + HKDF + AES-256-GCM), запечатанный
//! публичным ключом получателя из GET /sync/chat/peers. Сервер — opaque-relay
//! (routes/chat.js): хранит только шифротекст + метаданные маршрутизации.
//!
//! Payload внутри конверта (JSON):
//!   { "v": 1, "body": "…", "ref": { "type": "order"|"card"|"profile", "id": "…" }? }
//!
//! Доставка at-least-once: входящие дедуплицируются по UNIQUE(server_id).
//! Ротация ключа: unseal по server key_id не удался → сброс
//! CHAT_KEY_REGISTERED и перевыпуск X25519-пары; повторный fetch подтянет
//! сообщения, запечатанные уже под новый ключ.

use crate::database::Database;
use crate::models::{ChatMessage, ChatPeer};
use crate::state::{require_user, spawn_task, with_db};
use serde_json::{json, Value};
use tauri::Emitter;

const HTTP_TIMEOUT_SECS: u64 = 30;
const MAX_BODY_CHARS: usize = 4000;
const MAX_REF_LEN: usize = 64;
const ROOM_GROUP_PREFIX: &str = "group:";
/// Курсор фетча входящих (server_id последнего забранного).
const CHAT_SINCE_KEY: &str = "chat_last_server_id";
const ALLOWED_REF_TYPES: [&str; 3] = ["order", "card", "profile"];
// Конфиг-ключи дублируют commands/slices.rs (там они private) — это тот же
// X25519-ключ воркера, что и для срезов. Держать синхронно со slices.rs.
const CHAT_KEY_PRIV: &str = "worker_slice_key_priv";
const CHAT_KEY_REGISTERED: &str = "worker_slice_key_registered";

fn auth_token(db: &Database) -> Result<String, String> {
    db.get_config("license_token")
        .map_err(|e| e.to_string())?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "license_not_activated".to_string())
}

/// Каноническая DM-комната: iid'ы отсортированы — одинаково считается обеими
/// сторонами (и менеджером при отправке нам).
pub(crate) fn dm_room(a: &str, b: &str) -> String {
    if a <= b {
        format!("dm:{a}:{b}")
    } else {
        format!("dm:{b}:{a}")
    }
}

fn validate_ref(ref_type: &Option<String>, ref_id: &Option<String>) -> Result<(Option<String>, Option<String>), String> {
    let rt = ref_type.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let ri = ref_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    match (rt, ri) {
        (None, None) => Ok((None, None)),
        (Some(t), Some(i)) if ALLOWED_REF_TYPES.contains(&t) && i.len() <= MAX_REF_LEN => {
            Ok((Some(t.to_string()), Some(i.to_string())))
        }
        _ => Err("ref_invalid".into()),
    }
}

/// peers из ответа сервера + свой group_id (для групповой рассылки).
struct PeerBook {
    peers: Vec<ChatPeer>,
    group_id: Option<String>,
}

fn fetch_peer_book(_db: &Database, token: &str) -> Result<PeerBook, String> {
    let resp = ureq::get(&crate::endpoints::endpoint("/sync/chat/peers"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("peers_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("peers_parse: {e}"))?;
    let peers = body
        .get("peers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|p| {
            Some(ChatPeer {
                installation_id: p["installation_id"].as_str()?.to_string(),
                key_id: p["key_id"].as_i64()?,
                pubkey: p["pubkey"].as_str()?.to_string(),
                label: p["label"].as_str().unwrap_or("").to_string(),
                role: p["role"].as_str().unwrap_or("worker").to_string(),
            })
        })
        .collect();
    let group_id = body
        .get("group_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    Ok(PeerBook { peers, group_id })
}

fn seal_for_peer(peer: &ChatPeer, payload: &str) -> Result<String, String> {
    let env = crate::commands::telemetry::seal_envelope(peer.key_id, &peer.pubkey, payload)?;
    serde_json::to_string(&env).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────
//  Команды
// ─────────────────────────────────────────

/// Каталог собеседников: члены моей группы + активные менеджеры.
#[tauri::command]
pub(crate) fn chat_peers() -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let book = fetch_peer_book(db, &token)?;
        Ok(json!({
            "self": crate::license::get_or_create_installation_id(db)?,
            "group_id": book.group_id,
            "peers": book.peers,
        }))
    })
}

/// Отправка. peer_iid = None → групповая комната (fan-out всем из peers,
/// каждому свой конверт). Исходящее сохраняется локально только после
/// успешного POST (нет его на сервере — нет и в БД: ложная «отправленность»
/// хуже повторной отправки).
#[tauri::command]
pub(crate) fn chat_send(
    app: tauri::AppHandle,
    body: String,
    peer_iid: Option<String>,
    ref_type: Option<String>,
    ref_id: Option<String>,
) -> Result<ChatMessage, String> {
    require_user()?;
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("empty_body".into());
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(format!("body_too_long: max {MAX_BODY_CHARS}"));
    }
    let (ref_type, ref_id) = validate_ref(&ref_type, &ref_id)?;

    let (msg, emit_room) = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let self_iid = crate::license::get_or_create_installation_id(db)?;
        let book = fetch_peer_book(db, &token)?;
        // Ключ приёма должен быть зарегистрирован, иначе нам не ответить.
        crate::commands::slices::ensure_slice_key(db)?;

        let payload = {
            let mut p = json!({ "v": 1, "body": body });
            if let (Some(t), Some(i)) = (ref_type.clone(), ref_id.clone()) {
                p["ref"] = json!({ "type": t, "id": i });
            }
            p.to_string()
        };

        let (room, targets): (String, Vec<&ChatPeer>) = match peer_iid.as_deref() {
            Some(peer) => {
                let target = book
                    .peers
                    .iter()
                    .find(|p| p.installation_id == peer)
                    .ok_or("peer_unknown")?;
                (dm_room(&self_iid, peer), vec![target])
            }
            None => {
                let gid = book
                    .group_id
                    .as_deref()
                    .ok_or("no_group")?;
                (format!("{ROOM_GROUP_PREFIX}{gid}"), book.peers.iter().collect())
            }
        };
        if targets.is_empty() {
            return Err("no_recipients".into());
        }

        let envelopes: Vec<Value> = targets
            .iter()
            .map(|p| {
                Ok(json!({
                    "target_iid": p.installation_id,
                    "key_id": p.key_id,
                    "sealed_data": seal_for_peer(p, &payload)?,
                }))
            })
            .collect::<Result<_, String>>()?;

        let mut req_body = json!({ "room": room, "envelopes": envelopes });
        if let (Some(t), Some(i)) = (ref_type.clone(), ref_id.clone()) {
            req_body["ref_type"] = json!(t);
            req_body["ref_id"] = json!(i);
        }
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/send"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&req_body.to_string())
            .map_err(|e| format!("chat_send_failed: {e}"))?;
        let parsed: Value = resp.into_json().map_err(|e| format!("chat_send_parse: {e}"))?;
        if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err("chat_send_rejected".into());
        }

        // Для групповой комнаты одно локальное исходящее; peer_iid = "" (всем).
        let local_peer = peer_iid.clone().unwrap_or_default();
        let local_id = db.chat_insert_outgoing(
            &room,
            &local_peer,
            &body,
            ref_type.as_deref(),
            ref_id.as_deref(),
        )?;
        let msg = db
            .chat_get(local_id)?
            .ok_or("chat_insert_lost")?;
        let _ = db.log_event(
            "chat.sent",
            &format!("room={room} recipients={}", targets.len()),
            Some("chat"),
            None,
        );
        Ok::<(ChatMessage, String), String>((msg, room))
    })?;
    let _ = app.emit("chat:message", &msg);
    let _ = app.emit("chat:room_updated", json!({ "room": emit_room }));
    Ok(msg)
}

/// История: room = None → все комнаты; иначе сообщения конкретной комнаты.
#[tauri::command]
pub(crate) fn chat_list(room: Option<String>, limit: Option<u32>) -> Result<Vec<ChatMessage>, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        db.chat_list(room.as_deref(), limit.unwrap_or(200))
    })
}

/// Пометить входящие прочитанными (по локальным id).
#[tauri::command]
pub(crate) fn chat_mark_read(app: tauri::AppHandle, ids: Vec<i64>) -> Result<u32, String> {
    require_user()?;
    let n = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        db.chat_mark_read(&ids)
    })?;
    if n > 0 {
        let _ = app.emit("chat:read", json!({ "ids": ids, "updated": n }));
    }
    Ok(n)
}

/// Бейдж непрочитанных (сайдбар). До разблокировки БД отдаёт 0, а не ошибку.
#[tauri::command]
pub(crate) fn chat_unread_count() -> Result<u32, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Ok(0u32);
        }
        db.chat_unread_count()
    })
}

/// Ручной fetch входящих (pull-to-refresh; основной путь — WS chat_message).
#[tauri::command]
pub(crate) fn chat_fetch(app: tauri::AppHandle) -> Result<Value, String> {
    require_user()?;
    fetch_and_store(Some(&app))
}

// ─────────────────────────────────────────
//  Приём (fetch + unseal)
// ─────────────────────────────────────────

fn fetch_and_store(app: Option<&tauri::AppHandle>) -> Result<Value, String> {
    let (result, new_messages) = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        fetch_locked(db, false)
    })?;
    if let Some(app) = app {
        for m in &new_messages {
            let _ = app.emit("chat:message", m);
        }
        if !new_messages.is_empty() {
            let _ = app.emit("chat:unread", json!({ "added": new_messages.len() }));
        }
    }
    Ok(result)
}

/// Общая логика fetch. retried_after_rotation — защёлка от цикла: при
/// массовых ошибках unseal один раз ротируем X25519-ключ (потерянный
/// приватник, CHAT_E2E.md «Угроза №3») и повторяем fetch.
fn fetch_locked(db: &mut Database, retried_after_rotation: bool) -> Result<(Value, Vec<ChatMessage>), String> {
    let token = auth_token(db)?;
    let priv_hex = crate::commands::slices::ensure_slice_key(db)?;
    let since: i64 = db
        .get_config(CHAT_SINCE_KEY)
        .map_err(|e| e.to_string())?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
        .max(db.chat_max_server_id()?);

    let url = format!("{}?since_id={}", crate::endpoints::endpoint("/sync/chat/messages"), since);
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("chat_fetch_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("chat_fetch_parse: {e}"))?;
    let messages = body
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut new_messages: Vec<ChatMessage> = Vec::new();
    let mut max_seen = since;
    let mut unseal_failures = 0usize;

    for m in &messages {
        let server_id = m["id"].as_i64().unwrap_or(0);
        if server_id <= 0 {
            continue;
        }
        max_seen = max_seen.max(server_id);
        let room = m["room"].as_str().unwrap_or("");
        let sender = m["sender_iid"].as_str().unwrap_or("");
        let sealed = m["sealed_data"].as_str().unwrap_or("");
        let ref_type = m["ref_type"].as_str().map(String::from);
        let ref_id = m["ref_id"].as_str().map(String::from);
        let created_at = m["created_at"].as_str().unwrap_or("");
        if room.is_empty() || sender.is_empty() || sealed.is_empty() {
            continue;
        }
        let processed = (|| -> Result<Option<i64>, String> {
            let env: crate::commands::telemetry::TelemetryEnvelope =
                serde_json::from_str(sealed).map_err(|e| format!("sealed_parse: {e}"))?;
            let payload_str = crate::commands::telemetry::unseal_envelope(&priv_hex, &env)?;
            let payload: Value =
                serde_json::from_str(&payload_str).map_err(|e| format!("payload_parse: {e}"))?;
            let text = payload["body"].as_str().unwrap_or("").to_string();
            if text.is_empty() {
                return Err("empty_body".into());
            }
            let prt = payload["ref"]["type"].as_str().map(String::from).or(ref_type);
            let pri = payload["ref"]["id"].as_str().map(String::from).or(ref_id);
            db.chat_insert_incoming(server_id, room, sender, &text, prt.as_deref(), pri.as_deref(), created_at)
        })();
        match processed {
            Ok(Some(local_id)) => {
                if let Ok(Some(m)) = db.chat_get(local_id) {
                    new_messages.push(m);
                }
            }
            Ok(None) => {} // дедуп по server_id
            Err(e) => {
                unseal_failures += 1;
                let _ = db.log_event(
                    "chat.incoming_failed",
                    &format!("msg #{server_id}: {e}"),
                    Some("chat"),
                    None,
                );
            }
        }
    }

    if max_seen > since {
        db.set_config(CHAT_SINCE_KEY, &max_seen.to_string())
            .map_err(|e| e.to_string())?;
    }

    // Все входящие не распечатываются нашим ключом → вероятно, приватник
    // потерян/сменился. Ротируем и повторяем fetch один раз (конверты под
    // старый ключ мертвы навсегда — их уже не прочитать).
    if unseal_failures > 0 && new_messages.is_empty() && !retried_after_rotation && !messages.is_empty() {
        let _ = db.log_event(
            "chat.key_rotated",
            "all incoming unseal failed — rotating chat key",
            Some("chat"),
            None,
        );
        db.set_config(CHAT_KEY_PRIV, "").map_err(|e| e.to_string())?;
        db.set_config(CHAT_KEY_REGISTERED, "").map_err(|e| e.to_string())?;
        let _ = crate::commands::slices::ensure_slice_key(db)?;
        // Перерегистрация пубключа произойдёт лениво при ближайшем
        // slices-fetch; повторный чат-fetch подтянет конверты под новый ключ.
        return fetch_locked(db, true);
    }

    Ok((
        json!({
            "fetched": messages.len(),
            "stored": new_messages.len(),
            "failed": unseal_failures,
            "since_id": max_seen,
        }),
        new_messages,
    ))
}

/// WS-хук: {"type":"chat_message"} — забираем входящие в фоне.
pub(crate) fn fetch_on_ws_notify(app: tauri::AppHandle) {
    spawn_task(move || {
        if let Err(e) = fetch_and_store(Some(&app)) {
            eprintln!("[chat] background fetch failed: {e}");
        }
    });
}

// ─────────────────────────────────────────
//  Тесты (миграция v27 + локальные операции)
// ─────────────────────────────────────────

#[cfg(test)]
mod chat_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chat.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new(
            "chat_test_pw_1234567890",
            &salt,
        ));
        (dir, db)
    }

    #[test]
    fn test_dm_room_canonical_both_sides() {
        assert_eq!(dm_room("b-iid", "a-iid"), "dm:a-iid:b-iid");
        assert_eq!(dm_room("a-iid", "b-iid"), "dm:a-iid:b-iid");
    }

    #[test]
    fn test_outgoing_and_list() {
        let (_d, db) = test_db();
        let id = db
            .chat_insert_outgoing("dm:me:peer", "peer", "привет", Some("order"), Some("42"))
            .unwrap();
        let msgs = db.chat_list(Some("dm:me:peer"), 50).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, id);
        assert_eq!(msgs[0].direction, "out");
        assert_eq!(msgs[0].body, "привет");
        assert!(msgs[0].read_at.is_some(), "исходящие сразу прочитаны");
        assert_eq!(db.chat_unread_count().unwrap(), 0);
    }

    #[test]
    fn test_incoming_dedup_by_server_id() {
        let (_d, db) = test_db();
        let first = db
            .chat_insert_incoming(101, "dm:me:peer", "peer", "ответ", None, None, "2026-08-31 10:00:00")
            .unwrap();
        assert!(first.is_some());
        // Повторная доставка того же server_id — дедуп, строки не плодятся.
        let second = db
            .chat_insert_incoming(101, "dm:me:peer", "peer", "ответ", None, None, "2026-08-31 10:00:00")
            .unwrap();
        assert!(second.is_none());
        assert_eq!(db.chat_count_by_server_id(101).unwrap(), 1);
        assert_eq!(db.chat_max_server_id().unwrap(), 101);
        assert_eq!(db.chat_unread_count().unwrap(), 1, "входящее непрочитано");
    }

    #[test]
    fn test_mark_read_only_incoming() {
        let (_d, db) = test_db();
        let out_id = db.chat_insert_outgoing("dm:me:peer", "peer", "моё", None, None).unwrap();
        let in_id = db
            .chat_insert_incoming(7, "dm:me:peer", "peer", "их", None, None, "")
            .unwrap()
            .unwrap();
        // Исходящее не «перечитывается» обратно — UPDATE ограничен direction='in'.
        assert_eq!(db.chat_mark_read(&[out_id]).unwrap(), 0);
        assert_eq!(db.chat_mark_read(&[in_id]).unwrap(), 1);
        assert_eq!(db.chat_unread_count().unwrap(), 0);
        // Повтор — no-op
        assert_eq!(db.chat_mark_read(&[in_id]).unwrap(), 0);
    }

    #[test]
    fn test_list_rooms_isolated() {
        let (_d, db) = test_db();
        db.chat_insert_incoming(1, "dm:me:a", "a", "к a", None, None, "").unwrap();
        db.chat_insert_incoming(2, "dm:me:b", "b", "к b", None, None, "").unwrap();
        db.chat_insert_incoming(3, "group:g1", "a", "в группу", None, None, "").unwrap();
        assert_eq!(db.chat_list(Some("dm:me:a"), 50).unwrap().len(), 1);
        assert_eq!(db.chat_list(None, 50).unwrap().len(), 3);
        assert_eq!(db.chat_list(Some("group:g1"), 50).unwrap()[0].body, "в группу");
    }

    #[test]
    fn test_seal_unseal_roundtrip_via_slice_key() {
        // Полный крипто-контур: отправитель запечатывает пубключом получателя,
        // получатель распечатывает своим приватником (формат telemetry).
        let (_d, db) = test_db();
        let priv_hex = crate::commands::slices::ensure_slice_key(&db).unwrap();
        let pub_hex = crate::commands::slices::pubkey_hex(&priv_hex);
        let payload = json!({ "v": 1, "body": "секрет", "ref": { "type": "order", "id": "7" } }).to_string();
        let env = crate::commands::telemetry::seal_envelope(5, &pub_hex, &payload).unwrap();
        let sealed = serde_json::to_string(&env).unwrap();
        let env2: crate::commands::telemetry::TelemetryEnvelope = serde_json::from_str(&sealed).unwrap();
        let plain = crate::commands::telemetry::unseal_envelope(&priv_hex, &env2).unwrap();
        let back: Value = serde_json::from_str(&plain).unwrap();
        assert_eq!(back["body"].as_str().unwrap(), "секрет");
        assert_eq!(back["ref"]["id"].as_str().unwrap(), "7");
    }

    #[test]
    fn test_validate_ref_rules() {
        assert!(validate_ref(&None, &None).unwrap() == (None, None));
        assert!(validate_ref(&Some("order".into()), &Some("12".into())).is_ok());
        assert!(validate_ref(&Some("nope".into()), &Some("12".into())).is_err());
        assert!(validate_ref(&Some("order".into()), &None).is_err());
        assert!(validate_ref(&None, &Some("12".into())).is_err());
    }
}
