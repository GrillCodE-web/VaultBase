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
//!   { "v": 1, "body": "...", "ref": { "type": "order"|"card"|"profile"|"message", "id": "..." }? }
//!   { "v": 1, "type": "read_receipt", "ids": [server_id...] }  ← квитанция о
//!   прочтении (CHAT-2.0, CHAT_E2E.md §9): не сообщение, в ленту не попадает.
//!
//! Доставка at-least-once: входящие дедуплицируются по UNIQUE(server_id).
//! Трекинг исходящих (миграция v30, chat_outgoing_targets): server_id каждого
//! конверта fan-out'а хранится локально; delivered подтягивается опросом
//! GET /sync/chat/outbox (серверная пометка выдачи блоба), read — входящими
//! read_receipt-конвертами. Изменения агрегатов уходят на фронт событием
//! "chat:status" { updates: [{ msg_id, total, delivered, read }] }.
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
/// Курсор outbox-опроса (метка времени — delivered_at обновляет старые строки).
const CHAT_OUTBOX_SINCE_KEY: &str = "chat_outbox_since";
/// 13q: кэш своего group_id (из peers) — чтобы собрать room групповой отправки
/// в оффлайне, когда сервер недоступен.
const CHAT_GROUP_ID_KEY: &str = "chat_group_id";
/// TTL read_receipt-конвертов: служебные, долго жить не должны.
const RECEIPT_TTL_HOURS: u32 = 72;
/// qfk: префикс конфиг-ключа TTL комнаты — `chat_room_ttl:<room>` (часы, 0/нет
/// = автоудаление выключено). Хранится локально на каждом клиенте.
const CHAT_ROOM_TTL_PREFIX: &str = "chat_room_ttl:";
/// bx6: конфиг-ключ со списком замьюченных комнат (JSON-массив room-ключей).
const CHAT_MUTED_ROOMS_KEY: &str = "chat_muted_rooms";
/// 19d: локальные заметки о пирах (JSON-объект iid -> текст).
const CHAT_PEER_NOTES_KEY: &str = "chat_peer_notes";
/// 19d: максимум символов в своём label.
const MAX_LABEL_CHARS: usize = 48;
const ALLOWED_REF_TYPES: [&str; 4] = ["order", "card", "profile", "message"];
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

/// 19d: публичный Chat-ID в стиле qTOX — SHA-256(installation_id + pubkey),
/// первые 8 байт в HEX-верхнем регистре, группами по 4 (XXXX-XXXX-XXXX-XXXX).
/// Детерминированный и одинаковый у всех сторон: peer'ы берут pubkey с сервера,
/// self — из своего slice-ключа (тот же pubkey, что зарегистрирован на сервере).
fn public_chat_id(iid: &str, pubkey: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(iid.as_bytes());
    h.update(b":");
    h.update(pubkey.as_bytes());
    let digest = h.finalize();
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02X}")).collect();
    hex.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
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
    // 19d: собственный label с сервера (licenses.label) — для профиля.
    self_label: Option<String>,
}

/// Разбор ответа /sync/chat/peers в PeerBook. Побочно кэширует group_id
/// (13q: нужен для сборки room групповой отправки в оффлайне).
fn parse_peer_book(db: &Database, body: &Value) -> PeerBook {
    let peers = body
        .get("peers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|p| {
            let installation_id = p["installation_id"].as_str()?.to_string();
            let pubkey = p["pubkey"].as_str()?.to_string();
            // 19d: публичный Chat-ID считаем локально из iid+pubkey.
            let chat_id = public_chat_id(&installation_id, &pubkey);
            Some(ChatPeer {
                installation_id,
                key_id: p["key_id"].as_i64()?,
                pubkey,
                chat_id,
                label: p["label"].as_str().unwrap_or("").to_string(),
                role: p["role"].as_str().unwrap_or("worker").to_string(),
                online: p["online"].as_bool().unwrap_or(false),
                last_seen: p["last_seen"].as_str().map(String::from),
            })
        })
        .collect();
    let group_id = body
        .get("group_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    if let Some(gid) = group_id.as_deref() {
        let _ = db.set_config(CHAT_GROUP_ID_KEY, gid);
    }
    // 19d: собственный label — сервер отдаёт его отдельным полем self_label.
    let self_label = body
        .get("self_label")
        .and_then(|v| v.as_str())
        .map(String::from);
    PeerBook { peers, group_id, self_label }
}

fn fetch_peer_book(db: &Database, token: &str) -> Result<PeerBook, String> {
    let resp = ureq::get(&crate::endpoints::endpoint("/sync/chat/peers"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("peers_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("peers_parse: {e}"))?;
    Ok(parse_peer_book(db, &body))
}

/// 13q: исход попытки онлайн-отправки. Offline — сеть недоступна (ureq
/// Transport): сообщение надо положить в очередь и досылать. Hard — отказ по
/// существу (сервер ответил 4xx/5xx, неизвестный пир, крипто): очередь не
/// поможет, ошибку отдаём наверх.
enum SendFail {
    Offline,
    Hard(String),
}

fn classify(e: ureq::Error) -> SendFail {
    match &e {
        ureq::Error::Transport(_) => SendFail::Offline,
        _ => SendFail::Hard(e.to_string()),
    }
}

fn build_payload(body: &str, ref_type: Option<&str>, ref_id: Option<&str>, ttl_hours: Option<u32>, priority: bool) -> String {
    let mut p = json!({ "v": 1, "body": body });
    if let (Some(t), Some(i)) = (ref_type, ref_id) {
        p["ref"] = json!({ "type": t, "id": i });
    }
    // qfk: TTL кладём в сам конверт — получатель ставит локальный expires_at по
    // нему (сервер чистит свои блобы отдельно по req_body.ttl_hours).
    if let Some(h) = ttl_hours {
        if h > 0 {
            p["ttl"] = json!(h);
        }
    }
    // azl: флаг важности едет внутри конверта — сервер его не видит.
    if priority {
        p["imp"] = json!(true);
    }
    p.to_string()
}

/// qfk: TTL комнаты в часах из локального конфига (`chat_room_ttl:<room>`).
/// None — автоудаление выключено (ключа нет либо значение 0/битое).
fn room_ttl_hours(db: &Database, room: &str) -> Option<u32> {
    db.get_config(&format!("{CHAT_ROOM_TTL_PREFIX}{room}"))
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|h| *h > 0)
}

/// Одна попытка реальной отправки: peers → seal → POST. Возвращает room и
/// пары (target_iid, server_id) для трекинга. Ошибки классифицированы
/// (SendFail) — на Offline вызывающий кладёт в очередь.
#[allow(clippy::too_many_arguments)]
fn try_online_send(
    db: &Database,
    token: &str,
    self_iid: &str,
    body: &str,
    room_id: Option<&str>,
    peer_iid: Option<&str>,
    ref_type: Option<&str>,
    ref_id: Option<&str>,
    ttl_hours: Option<u32>,
    priority: bool,
) -> Result<(String, Vec<(String, i64)>), SendFail> {
    let resp = ureq::get(&crate::endpoints::endpoint("/sync/chat/peers"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(classify)?;
    let pbody: Value = resp.into_json().map_err(|e| SendFail::Hard(format!("peers_parse: {e}")))?;
    let book = parse_peer_book(db, &pbody);
    crate::commands::slices::ensure_slice_key(db).map_err(SendFail::Hard)?;

    let payload = build_payload(body, ref_type, ref_id, ttl_hours, priority);
    let (room, targets): (String, Vec<&ChatPeer>) = match (room_id, peer_iid) {
        // mgt: пользовательская комната — адресаты только её члены (peers теперь
        // включает со-участников комнат, поэтому ключи есть).
        (Some(rid), _) => {
            let members = fetch_room_members(token, rid).map_err(SendFail::Hard)?;
            let targets: Vec<&ChatPeer> = book
                .peers
                .iter()
                .filter(|p| p.installation_id != self_iid && members.iter().any(|m| m == &p.installation_id))
                .collect();
            (rid.to_string(), targets)
        }
        (None, Some(peer)) => {
            let target = book
                .peers
                .iter()
                .find(|p| p.installation_id == peer)
                .ok_or_else(|| SendFail::Hard("peer_unknown".into()))?;
            (dm_room(self_iid, peer), vec![target])
        }
        (None, None) => {
            let gid = book.group_id.as_deref().ok_or_else(|| SendFail::Hard("no_group".into()))?;
            (format!("{ROOM_GROUP_PREFIX}{gid}"), book.peers.iter().collect())
        }
    };
    if targets.is_empty() {
        return Err(SendFail::Hard("no_recipients".into()));
    }

    let envelopes: Vec<Value> = targets
        .iter()
        .map(|p| {
            Ok(json!({
                "target_iid": p.installation_id,
                "key_id": p.key_id,
                "sealed_data": seal_for_peer(p, &payload).map_err(SendFail::Hard)?,
            }))
        })
        .collect::<Result<_, SendFail>>()?;

    let mut req_body = json!({ "room": room, "envelopes": envelopes });
    if let (Some(t), Some(i)) = (ref_type, ref_id) {
        req_body["ref_type"] = json!(t);
        req_body["ref_id"] = json!(i);
    }
    // qfk: сервер проставит expires_at своим блобам и подметёт их по TTL.
    if let Some(h) = ttl_hours {
        if h > 0 {
            req_body["ttl_hours"] = json!(h);
        }
    }
    let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/send"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&req_body.to_string())
        .map_err(classify)?;
    let parsed: Value = resp.into_json().map_err(|e| SendFail::Hard(format!("chat_send_parse: {e}")))?;
    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(SendFail::Hard("chat_send_rejected".into()));
    }
    let server_ids: Vec<i64> = parsed
        .get("ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
        .unwrap_or_default();
    let pairs: Vec<(String, i64)> = if server_ids.len() == targets.len() && !server_ids.is_empty() {
        targets.iter().map(|p| p.installation_id.clone()).zip(server_ids).collect()
    } else {
        if !server_ids.is_empty() {
            let _ = db.log_event(
                "chat.tracking_partial",
                &format!("ids {} != targets {}", server_ids.len(), targets.len()),
                Some("chat"),
                None,
            );
        }
        Vec::new()
    };
    Ok((room, pairs))
}

/// mgt: состав пользовательской комнаты по её room-ключу (GET /sync/chat/rooms).
/// Нужен fan-out'у: адресуем строго членам комнаты, а не всей группе.
fn fetch_room_members(token: &str, room: &str) -> Result<Vec<String>, String> {
    let resp = ureq::get(&crate::endpoints::endpoint("/sync/chat/rooms"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("rooms_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("rooms_parse: {e}"))?;
    let members = body
        .get("rooms")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|r| r.get("room").and_then(|x| x.as_str()) == Some(room)))
        .and_then(|r| r.get("members"))
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
        .ok_or("room_unknown")?;
    Ok(members)
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
        let self_iid = crate::license::get_or_create_installation_id(db)?;
        // 19d: свой Chat-ID считаем из того же slice-ключа, что зарегистрирован
        // на сервере — значит peer'ы увидят ровно такой же ID.
        let self_priv = crate::commands::slices::ensure_slice_key(db)?;
        let self_pub = crate::commands::slices::pubkey_hex(&self_priv);
        Ok(json!({
            "self": self_iid,
            "self_chat_id": public_chat_id(&self_iid, &self_pub),
            "self_label": book.self_label,
            "group_id": book.group_id,
            "peers": book.peers,
        }))
    })
}

/// mgt: список моих пользовательских комнат (m4i). Сервер отдаёт состав и
/// заголовок; сама переписка приходит обычным потоком chat/messages.
#[tauri::command]
pub(crate) fn chat_rooms_list() -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let resp = ureq::get(&crate::endpoints::endpoint("/sync/chat/rooms"))
            .set("Authorization", &format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| format!("rooms_failed: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("rooms_parse: {e}"))
    })
}

/// mgt: создать пользовательскую комнату. members — Chat-ID (installation_id)
/// участников; создатель становится владельцем и первым членом на сервере.
#[tauri::command]
pub(crate) fn chat_room_create(title: String, members: Vec<String>) -> Result<Value, String> {
    require_user()?;
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title_empty".into());
    }
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let body = json!({ "title": title, "members": members }).to_string();
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/rooms"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body)
            .map_err(|e| format!("room_create: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("room_create_parse: {e}"))
    })
}

/// mgt: правка состава комнаты (владелец/менеджер). add/remove — Chat-ID.
/// Приглашение по Chat-ID = add одного участника.
#[tauri::command]
pub(crate) fn chat_room_members(
    room: String,
    add: Vec<String>,
    remove: Vec<String>,
) -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let body = json!({ "room": room, "add": add, "remove": remove }).to_string();
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/rooms/members"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body)
            .map_err(|e| format!("room_members: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("room_members_parse: {e}"))
    })
}

/// yyt: список закреплённых сообщений комнаты (server_id + кто/когда закрепил).
/// Тела не отдаются — фронт сопоставляет message_id с уже загруженной лентой.
#[tauri::command]
pub(crate) fn chat_pins_list(room: String) -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let url = format!(
            "{}?room={}",
            crate::endpoints::endpoint("/sync/chat/pins"),
            urlencoding::encode(&room)
        );
        let resp = ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| format!("pins_failed: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("pins_parse: {e}"))
    })
}

/// yyt: закрепить/открепить сообщение по его server_id. Сервер хранит лишь
/// маршрутизацию (комната+id), тело остаётся sealed-конвертом.
#[tauri::command]
pub(crate) fn chat_pin_set(room: String, message_id: i64, pinned: bool) -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let body = json!({ "room": room, "message_id": message_id, "pinned": pinned }).to_string();
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/pins"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body)
            .map_err(|e| format!("pin_set: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("pin_set_parse: {e}"))
    })
}

/// 6if: агрегированные реакции комнаты — [{message_id, emoji, count, reactors}].
/// Фронт сопоставляет message_id с уже загруженной лентой (тела не отдаются).
#[tauri::command]
pub(crate) fn chat_reactions_list(room: String) -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let url = format!(
            "{}?room={}",
            crate::endpoints::endpoint("/sync/chat/reactions"),
            urlencoding::encode(&room)
        );
        let resp = ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| format!("reactions_failed: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("reactions_parse: {e}"))
    })
}

/// 6if: поставить/снять реакцию (toggle) на сообщение по server_id. Сервер
/// хранит только маршрутизацию (комната+id+эмодзи+кто), тело — sealed-конверт.
#[tauri::command]
pub(crate) fn chat_reaction_set(room: String, message_id: i64, emoji: String) -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let body = json!({ "room": room, "message_id": message_id, "emoji": emoji }).to_string();
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/reactions"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body)
            .map_err(|e| format!("reaction_set: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("reaction_set_parse: {e}"))
    })
}

/// 19d: сменить свой публичный label (licenses.label на сервере). Виден всем
/// пирам в /sync/chat/peers. Пустая строка допустима — сбрасывает label.
#[tauri::command]
pub(crate) fn chat_set_label(label: String) -> Result<Value, String> {
    require_user()?;
    let label = label.trim().to_string();
    if label.chars().count() > MAX_LABEL_CHARS {
        return Err("label_too_long".into());
    }
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let body = json!({ "label": label }).to_string();
        let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/profile"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .send_string(&body)
            .map_err(|e| format!("set_label: {e}"))?;
        resp.into_json::<Value>().map_err(|e| format!("set_label_parse: {e}"))
    })
}

/// 19d: все локальные заметки о пирах (объект iid -> текст). Хранятся только
/// на этом клиенте (config), сервер их не видит.
#[tauri::command]
pub(crate) fn chat_notes_get() -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        let raw = db.get_config(CHAT_PEER_NOTES_KEY).map_err(|e| e.to_string())?;
        let val = raw
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| json!({}));
        Ok(val)
    })
}

/// 19d: задать/очистить локальную заметку о пире. Пустой текст — удаляет.
#[tauri::command]
pub(crate) fn chat_note_set(peer_iid: String, note: String) -> Result<(), String> {
    require_user()?;
    if peer_iid.len() > MAX_REF_LEN {
        return Err("peer_invalid".into());
    }
    let note = note.trim().to_string();
    with_db!(db, {
        let raw = db.get_config(CHAT_PEER_NOTES_KEY).map_err(|e| e.to_string())?;
        let mut map = raw
            .and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok())
            .unwrap_or_default();
        if note.is_empty() {
            map.remove(&peer_iid);
        } else {
            map.insert(peer_iid, Value::String(note));
        }
        let serialized = serde_json::to_string(&map).map_err(|e| e.to_string())?;
        db.set_config(CHAT_PEER_NOTES_KEY, &serialized).map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// qfk: текущий TTL комнаты в часах (0 — автоудаление выключено). Хранится
/// локально у каждого клиента (`chat_room_ttl:<room>`).
#[tauri::command]
pub(crate) fn chat_room_ttl_get(room: String) -> Result<u32, String> {
    require_user()?;
    with_db!(db, { Ok(room_ttl_hours(db, &room).unwrap_or(0)) })
}

/// qfk: задать TTL комнаты в часах (0 — выключить). Влияет на последующие
/// отправки: сервер и получатель получают ttl_hours/ttl в конверте.
#[tauri::command]
pub(crate) fn chat_room_ttl_set(room: String, hours: u32) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        db.set_config(&format!("{CHAT_ROOM_TTL_PREFIX}{room}"), &hours.to_string())
            .map_err(|e| e.to_string())
    })
}

/// bx6: список замьюченных комнат (локально, JSON-массив в конфиге). Mute —
/// чисто клиентская настройка: сервер и E2E-конверты про неё не знают.
fn muted_rooms(db: &Database) -> Vec<String> {
    db.get_config(CHAT_MUTED_ROOMS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

/// 9ks: пересчитать бейдж непрочитанных (без mute-комнат) и обновить трей/
/// таскбар. Best-effort: свой lock БД, поэтому вызывать ТОЛЬКО вне with_db!.
fn refresh_tray_badge(app: &tauri::AppHandle) {
    let count = {
        let guard = match crate::state::state().db.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let db = &*guard;
        if db.is_locked() {
            return;
        }
        let muted = muted_rooms(db);
        db.chat_unread_count_excluding(&muted).unwrap_or(0)
    };
    crate::tray::set_unread(app, count);
}

/// bx6: все замьюченные комнаты — для иконок/подавления бейджа в списке.
#[tauri::command]
pub(crate) fn chat_muted_rooms() -> Result<Vec<String>, String> {
    require_user()?;
    with_db!(db, { Ok(muted_rooms(db)) })
}

/// bx6: замьючена ли комната (для подавления OS-уведомления).
#[tauri::command]
pub(crate) fn chat_room_mute_get(room: String) -> Result<bool, String> {
    require_user()?;
    with_db!(db, { Ok(muted_rooms(db).iter().any(|r| r == &room)) })
}

/// bx6: включить/выключить mute комнаты.
#[tauri::command]
pub(crate) fn chat_room_mute_set(app: tauri::AppHandle, room: String, muted: bool) -> Result<(), String> {
    require_user()?;
    with_db!(db, {
        let mut set = muted_rooms(db);
        let has = set.iter().any(|r| r == &room);
        if muted && !has {
            set.push(room);
        } else if !muted && has {
            set.retain(|r| r != &room);
        }
        db.set_config(
            CHAT_MUTED_ROOMS_KEY,
            &serde_json::to_string(&set).unwrap_or_else(|_| "[]".into()),
        )
        .map_err(|e| e.to_string())
    })?;
    // 9ks: mute/unmute меняет число непрочитанных для бейджа (mute-комнаты не
    // учитываются) — обновляем трей/таскбар сразу.
    refresh_tray_badge(&app);
    Ok(())
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
    room: Option<String>,
    ref_type: Option<String>,
    ref_id: Option<String>,
    priority: Option<bool>,
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
    let priority = priority.unwrap_or(false);

    let (msg, emit_room) = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let token = auth_token(db)?;
        let self_iid = crate::license::get_or_create_installation_id(db)?;
        // Для групповой комнаты одно локальное исходящее; peer_iid = "" (всем).
        let local_peer = peer_iid.clone().unwrap_or_default();
        // qfk: эффективный room-ключ (как его знает конфиг TTL) и его TTL в часах.
        let effective_room = match (room.as_deref(), peer_iid.as_deref()) {
            (Some(rid), _) => rid.to_string(),
            (None, Some(peer)) => dm_room(&self_iid, peer),
            (None, None) => db
                .get_config(CHAT_GROUP_ID_KEY)
                .ok()
                .flatten()
                .map(|g| format!("{ROOM_GROUP_PREFIX}{g}"))
                .unwrap_or_default(),
        };
        let ttl_hours = room_ttl_hours(db, &effective_room);

        // 13q: пробуем отправить онлайн. Offline (нет сети, ureq Transport) —
        // кладём в очередь с pending=1 и досылаем при реконнекте; Hard —
        // ошибка по существу (пир/крипто/сервер), отдаём наверх.
        match try_online_send(
            db,
            &token,
            &self_iid,
            &body,
            room.as_deref(),
            peer_iid.as_deref(),
            ref_type.as_deref(),
            ref_id.as_deref(),
            ttl_hours,
            priority,
        ) {
            Ok((room, pairs)) => {
                let local_id = db.chat_insert_outgoing(
                    &room,
                    &local_peer,
                    &body,
                    ref_type.as_deref(),
                    ref_id.as_deref(),
                    false,
                    priority,
                )?;
                // qfk: свой экземпляр тоже подметётся по TTL комнаты.
                if let Some(h) = ttl_hours {
                    db.chat_set_expiry_hours(local_id, h)?;
                }
                // Трекинг (dhs): по паре (target_iid, server_id) на получателя.
                if !pairs.is_empty() {
                    db.chat_insert_outgoing_targets(local_id, &pairs)?;
                }
                let msg = db.chat_get(local_id)?.ok_or("chat_insert_lost")?;
                let _ = db.log_event(
                    "chat.sent",
                    &format!("room={room} recipients={}", pairs.len()),
                    Some("chat"),
                    None,
                );
                Ok::<(ChatMessage, String), String>((msg, room))
            }
            Err(SendFail::Offline) => {
                // Комнату строим локально: DM детерминированно из iid; группа —
                // из закешированного group_id (parse_peer_book пишет его при
                // каждом онлайн-обмене). Нет кеша — в группу оффлайн некуда.
                let room = match (room.as_deref(), peer_iid.as_deref()) {
                    // mgt: пользовательская комната известна по room-ключу.
                    (Some(rid), _) => rid.to_string(),
                    (None, Some(peer)) => dm_room(&self_iid, peer),
                    (None, None) => {
                        let gid = db
                            .get_config(CHAT_GROUP_ID_KEY)
                            .map_err(|e| e.to_string())?
                            .ok_or("no_group_offline")?;
                        format!("{ROOM_GROUP_PREFIX}{gid}")
                    }
                };
                let local_id = db.chat_insert_outgoing(
                    &room,
                    &local_peer,
                    &body,
                    ref_type.as_deref(),
                    ref_id.as_deref(),
                    true,
                    priority,
                )?;
                // qfk: TTL считается от локального времени постановки в очередь.
                if let Some(h) = ttl_hours {
                    db.chat_set_expiry_hours(local_id, h)?;
                }
                let msg = db.chat_get(local_id)?.ok_or("chat_insert_lost")?;
                let _ = db.log_event(
                    "chat.queued",
                    &format!("room={room} (offline)"),
                    Some("chat"),
                    None,
                );
                Ok::<(ChatMessage, String), String>((msg, room))
            }
            Err(SendFail::Hard(e)) => Err(e),
        }
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

/// Пометить входящие прочитанными (по локальным id). Каждому автору
/// помеченных сообщений уходит E2E read_receipt (best-effort: ошибка отправки
/// квитанции не валит команду — локальное прочтение уже зафиксировано).
#[tauri::command]
pub(crate) fn chat_mark_read(app: tauri::AppHandle, ids: Vec<i64>) -> Result<u32, String> {
    require_user()?;
    let n = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        // Сначала собираем refs (кто автор, какие server_id) — после mark они
        // уже «прочитаны», и отличить свежепомеченные нельзя.
        let refs = db.chat_incoming_unread_refs(&ids)?;
        // dz3: id объявлений среди помечаемых — по ним отчитаемся серверу.
        let news_ids = db.chat_news_ref_ids(&ids).unwrap_or_default();
        let n = db.chat_mark_read(&ids)?;
        if n > 0 && !refs.is_empty() {
            if let (Ok(token), Ok(self_iid)) = (
                auth_token(db),
                crate::license::get_or_create_installation_id(db),
            ) {
                send_read_receipts(db, &token, &self_iid, refs);
            }
        }
        // dz3: прочтение объявления в чате наполняет news_reads (счётчик N/M у
        // менеджера) — раньше это делала отдельная страница новостей. Best-effort.
        if n > 0 && !news_ids.is_empty() {
            if let Ok(token) = crate::commands::telemetry::worker_token(db) {
                for nid in &news_ids {
                    let _ = ureq::post(&crate::endpoints::endpoint(&format!("/api/telemetry/news/{}/read", nid)))
                        .set("Authorization", &format!("Bearer {}", token))
                        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                        .call();
                }
            }
        }
        Ok::<u32, String>(n)
    })?;
    if n > 0 {
        let _ = app.emit("chat:read", json!({ "ids": ids, "updated": n }));
        // 9ks: прочтение уменьшает бейдж непрочитанных на трее/таскбаре.
        refresh_tray_badge(&app);
    }
    Ok(n)
}

/// E2E read_receipt каждому автору (CHAT_E2E.md §9). Синхронно внутри
/// команды — как и остальной HTTP в chat.rs; конверт служебный, TTL 72ч.
/// Ошибки по отдельному адресату не прерывают остальных.
fn send_read_receipts(db: &Database, token: &str, self_iid: &str, refs: Vec<(i64, String)>) {
    let mut by_sender: std::collections::BTreeMap<String, Vec<i64>> = Default::default();
    for (server_id, sender) in refs {
        by_sender.entry(sender).or_default().push(server_id);
    }
    let book = match fetch_peer_book(db, token) {
        Ok(b) => b,
        Err(e) => {
            let _ = db.log_event("chat.receipt_failed", &e, Some("chat"), None);
            return;
        }
    };
    for (sender, ids) in by_sender {
        let res = (|| -> Result<(), String> {
            let peer = book
                .peers
                .iter()
                .find(|p| p.installation_id == sender)
                .ok_or("peer_unknown")?;
            let payload = json!({ "v": 1, "type": "read_receipt", "ids": ids }).to_string();
            let req_body = json!({
                "room": dm_room(self_iid, &sender),
                "ttl_hours": RECEIPT_TTL_HOURS,
                "envelopes": [{
                    "target_iid": sender,
                    "key_id": peer.key_id,
                    "sealed_data": seal_for_peer(peer, &payload)?,
                }],
            });
            let resp = ureq::post(&crate::endpoints::endpoint("/sync/chat/send"))
                .set("Authorization", &format!("Bearer {}", token))
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                .send_string(&req_body.to_string())
                .map_err(|e| format!("receipt_send: {e}"))?;
            let parsed: Value = resp.into_json().map_err(|e| format!("receipt_parse: {e}"))?;
            if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
                return Err("receipt_rejected".into());
            }
            Ok(())
        })();
        if let Err(e) = res {
            let _ = db.log_event(
                "chat.receipt_failed",
                &format!("to {sender}: {e}"),
                Some("chat"),
                None,
            );
        }
    }
}

/// t8l: жёсткое удаление своего сообщения. Каждому получателю шлём
/// служебный delete-конверт с его server_id, чистим серверные строки и
/// локальную копию. Удалять можно только исходящие (direction = "out").
#[tauri::command]
pub(crate) fn chat_delete(app: tauri::AppHandle, msg_id: i64) -> Result<(), String> {
    require_user()?;
    let room = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let msg = db.chat_get(msg_id)?.ok_or("chat_msg_unknown")?;
        if db.chat_direction(msg_id)?.as_deref() != Some("out") {
            return Err("delete_only_own".into());
        }
        let token = auth_token(db)?;
        let targets = db.chat_outgoing_targets_for(msg_id)?;
        if !targets.is_empty() {
            let book = fetch_peer_book(db, &token)?;
            let mut server_ids: Vec<i64> = Vec::new();
            for (target_iid, server_id) in &targets {
                server_ids.push(*server_id);
                let peer = match book.peers.iter().find(|p| &p.installation_id == target_iid) {
                    Some(p) => p,
                    None => continue,
                };
                let payload =
                    json!({ "v": 1, "type": "delete", "ids": [server_id] }).to_string();
                let sealed = match seal_for_peer(peer, &payload) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let req_body = json!({
                    "room": msg.room,
                    "ttl_hours": RECEIPT_TTL_HOURS,
                    "envelopes": [{
                        "target_iid": target_iid,
                        "key_id": peer.key_id,
                        "sealed_data": sealed,
                    }],
                });
                let _ = ureq::post(&crate::endpoints::endpoint("/sync/chat/send"))
                    .set("Authorization", &format!("Bearer {}", token))
                    .set("Content-Type", "application/json")
                    .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                    .send_string(&req_body.to_string());
            }
            if !server_ids.is_empty() {
                let _ = ureq::post(&crate::endpoints::endpoint("/sync/chat/delete"))
                    .set("Authorization", &format!("Bearer {}", token))
                    .set("Content-Type", "application/json")
                    .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                    .send_string(&json!({ "ids": server_ids }).to_string());
            }
        }
        db.chat_delete(msg_id)?;
        let _ = db.log_event("chat.deleted", &format!("msg {msg_id}"), Some("chat"), None);
        Ok::<String, String>(msg.room)
    })?;
    let _ = app.emit("chat:deleted", json!({ "id": msg_id, "room": room }));
    let _ = app.emit("chat:room_updated", json!({ "room": room }));
    Ok(())
}

/// tdq: правка своего сообщения. Каждому получателю шлём служебный edit-конверт
/// с его server_id и новым текстом; обновляем локальную копию и ставим метку
/// «изменено». Редактировать можно только исходящие (direction = "out").
#[tauri::command]
pub(crate) fn chat_edit(app: tauri::AppHandle, msg_id: i64, body: String) -> Result<(), String> {
    require_user()?;
    let text = body.trim().to_string();
    if text.is_empty() {
        return Err("empty_body".into());
    }
    if text.chars().count() > MAX_BODY_CHARS {
        return Err("body_too_long".into());
    }
    let updated = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let msg = db.chat_get(msg_id)?.ok_or("chat_msg_unknown")?;
        if db.chat_direction(msg_id)?.as_deref() != Some("out") {
            return Err("edit_only_own".into());
        }
        let token = auth_token(db)?;
        let targets = db.chat_outgoing_targets_for(msg_id)?;
        if !targets.is_empty() {
            let book = fetch_peer_book(db, &token)?;
            for (target_iid, server_id) in &targets {
                let peer = match book.peers.iter().find(|p| &p.installation_id == target_iid) {
                    Some(p) => p,
                    None => continue,
                };
                let payload =
                    json!({ "v": 1, "type": "edit", "ids": [server_id], "body": text }).to_string();
                let sealed = match seal_for_peer(peer, &payload) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let req_body = json!({
                    "room": msg.room,
                    "ttl_hours": RECEIPT_TTL_HOURS,
                    "envelopes": [{
                        "target_iid": target_iid,
                        "key_id": peer.key_id,
                        "sealed_data": sealed,
                    }],
                });
                let _ = ureq::post(&crate::endpoints::endpoint("/sync/chat/send"))
                    .set("Authorization", &format!("Bearer {}", token))
                    .set("Content-Type", "application/json")
                    .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
                    .send_string(&req_body.to_string());
            }
        }
        db.chat_edit_own(msg_id, &text)?;
        let _ = db.log_event("chat.edited", &format!("msg {msg_id}"), Some("chat"), None);
        db.chat_get(msg_id)?.ok_or("chat_msg_unknown".to_string())
    })?;
    // chat:message с обновлённым телом — upsert во фронте перерисует на месте.
    let _ = app.emit("chat:message", &updated);
    Ok(())
}

/// CHAT-2.0 (g80): «печатает...» — эфемерный сигнал пиру в DM. Best-effort:
/// ошибки сети только логируются, UI не должен падать из-за индикатора.
/// Троттлинг: фронт шлёт не чаще 3с, сервер релеит не чаще 2с на пару.
#[tauri::command]
pub(crate) fn chat_typing(peer_iid: String) -> Result<(), String> {
    require_user()?;
    if peer_iid.len() > MAX_REF_LEN {
        return Err("peer_invalid".into());
    }
    with_db!(db, {
        if db.is_locked() {
            return Ok(());
        }
        let token = auth_token(db)?;
        let self_iid = crate::license::get_or_create_installation_id(db)?;
        let req_body = json!({ "room": dm_room(&self_iid, &peer_iid), "target_iid": peer_iid });
        let res = ureq::post(&crate::endpoints::endpoint("/sync/chat/typing"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(10))
            .send_string(&req_body.to_string());
        if let Err(e) = res {
            let _ = db.log_event("chat.typing_failed", &e.to_string(), Some("chat"), None);
        }
        Ok(())
    })
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
    let (result, new_messages, status_updates, deleted) = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        let (res, msgs, mut changed, deleted) = fetch_locked(db, false)?;
        // Outbox-опрос: delivered-пометки наших исходящих. Ошибка не валит
        // fetch входящих — трекинг догонится следующим опросом.
        match fetch_outbox_locked(db) {
            Ok(ids) => {
                for id in ids {
                    if !changed.contains(&id) {
                        changed.push(id);
                    }
                }
            }
            Err(e) => {
                let _ = db.log_event("chat.outbox_failed", &e, Some("chat"), None);
            }
        }
        let updates: Vec<Value> = changed
            .iter()
            .filter_map(|mid| match db.chat_out_status(*mid) {
                Ok((total, delivered, read)) => Some(json!({
                    "msg_id": mid, "total": total, "delivered": delivered, "read": read,
                })),
                Err(_) => None,
            })
            .collect();
        Ok::<(Value, Vec<ChatMessage>, Vec<Value>, Vec<(String, i64)>), String>((res, msgs, updates, deleted))
    })?;
    if let Some(app) = app {
        for m in &new_messages {
            let _ = app.emit("chat:message", m);
        }
        if !new_messages.is_empty() {
            let _ = app.emit("chat:unread", json!({ "added": new_messages.len() }));
        }
        if !status_updates.is_empty() {
            let _ = app.emit("chat:status", json!({ "updates": status_updates }));
        }
        for (room, local_id) in &deleted {
            let _ = app.emit("chat:deleted", json!({ "room": room, "id": local_id }));
        }
        if !deleted.is_empty() {
            let _ = app.emit("chat:room_updated", json!({}));
        }
        // CHAT-2.0 (3ak): OS-уведомление о входящем делается на фронте
        // (App.jsx слушает chat:message через osNotify.js — паттерн UX-012),
        // здесь только события.
        // 9ks: обновляем бейдж непрочитанных на трее/таскбаре.
        refresh_tray_badge(app);
    }
    Ok(result)
}

/// Outbox-опрос: серверные delivered_at наших исходящих. Курсор — метка
/// времени (сервер сравнивает по COALESCE(delivered_at, created_at) > cursor).
/// Минимальное ручное кодирование — формат datetime контролируем нами.
fn fetch_outbox_locked(db: &Database) -> Result<Vec<i64>, String> {
    let token = auth_token(db)?;
    let since = db
        .get_config(CHAT_OUTBOX_SINCE_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let mut url = crate::endpoints::endpoint("/sync/chat/outbox");
    if !since.is_empty() {
        let enc = since.replace(' ', "%20").replace(':', "%3A");
        url = format!("{url}?updated_since={enc}");
    }
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("outbox_fetch_failed: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("outbox_parse: {e}"))?;
    let rows = body
        .get("messages")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut delivered_rows: Vec<(i64, String)> = Vec::new();
    let mut max_mark = since.clone();
    for r in &rows {
        let created = r["created_at"].as_str().unwrap_or("");
        let delivered = r["delivered_at"].as_str().unwrap_or("");
        let mark = if delivered.is_empty() { created } else { delivered };
        if mark > max_mark.as_str() {
            max_mark = mark.to_string();
        }
        if let (Some(sid), false) = (r["id"].as_i64(), delivered.is_empty()) {
            delivered_rows.push((sid, delivered.to_string()));
        }
    }
    let changed = db.chat_mark_targets_delivered(&delivered_rows)?;
    if max_mark != since {
        db.set_config(CHAT_OUTBOX_SINCE_KEY, &max_mark)
            .map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

/// read_receipt-конверт? Возвращает ids для служебного payload'а, иначе None.
fn parse_read_receipt_ids(payload: &Value) -> Option<Vec<i64>> {
    if payload.get("type")?.as_str()? != "read_receipt" {
        return None;
    }
    let ids: Vec<i64> = payload
        .get("ids")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_i64())
        .filter(|i| *i > 0)
        .collect();
    Some(ids)
}

/// delete-конверт (t8l)? Возвращает server_id входящих для стирания, иначе None.
fn parse_delete_ids(payload: &Value) -> Option<Vec<i64>> {
    if payload.get("type")?.as_str()? != "delete" {
        return None;
    }
    let ids: Vec<i64> = payload
        .get("ids")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_i64())
        .filter(|i| *i > 0)
        .collect();
    Some(ids)
}

/// edit-конверт (tdq)? Отправитель отредактировал свои сообщения — возвращаем
/// (server_id входящих для правки, новый текст), иначе None.
fn parse_edit(payload: &Value) -> Option<(Vec<i64>, String)> {
    if payload.get("type")?.as_str()? != "edit" {
        return None;
    }
    let ids: Vec<i64> = payload
        .get("ids")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_i64())
        .filter(|i| *i > 0)
        .collect();
    let body = payload.get("body")?.as_str()?.trim().to_string();
    if ids.is_empty() || body.is_empty() {
        return None;
    }
    Some((ids, body))
}

/// Общая логика fetch. retried_after_rotation — защёлка от цикла: при
/// массовых ошибках unseal один раз ротируем X25519-ключ (потерянный
/// приватник, CHAT_E2E.md «Угроза №3») и повторяем fetch.
/// Третий элемент кортежа — msg_id исходящих, чей статус read изменился
/// входящими read_receipt'ами (для события chat:status). Четвёртый (t8l) —
/// (room, local_id) удалённых по служебному delete-конверту (для chat:deleted).
fn fetch_locked(db: &mut Database, retried_after_rotation: bool) -> Result<(Value, Vec<ChatMessage>, Vec<i64>, Vec<(String, i64)>), String> {
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
    let mut receipt_updates: Vec<i64> = Vec::new();
    let mut deleted: Vec<(String, i64)> = Vec::new();
    // qfk: подметаем локально протухшие по TTL строки (expires_at <= now) и
    // отдаём их как удалённые — фронт снимет их из ленты (chat:deleted).
    for (room, local_id) in db.chat_sweep_expired()? {
        deleted.push((room, local_id));
    }
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
            // Служебный read_receipt: не сообщение, в ленту не попадает —
            // проставляем read_at на наших исходящих конвертах.
            if let Some(ids) = parse_read_receipt_ids(&payload) {
                let changed = db.chat_mark_targets_read(&ids)?;
                for mid in changed {
                    if !receipt_updates.contains(&mid) {
                        receipt_updates.push(mid);
                    }
                }
                return Ok(None);
            }
            // Служебный delete (t8l): отправитель стёр свои сообщения —
            // удаляем соответствующие входящие по их server_id.
            if let Some(ids) = parse_delete_ids(&payload) {
                let refs = db.chat_delete_incoming_by_server_ids(&ids)?;
                for (room, local_id) in refs {
                    deleted.push((room, local_id));
                }
                return Ok(None);
            }
            // Служебный edit (tdq): отправитель отредактировал свои сообщения —
            // правим соответствующие входящие по их server_id и отдаём их
            // обновлённые строки в ленту (chat:message → upsert по id).
            if let Some((ids, new_body)) = parse_edit(&payload) {
                let refs = db.chat_edit_incoming_by_server_ids(&ids, &new_body)?;
                for (_room, local_id) in refs {
                    if let Ok(Some(m)) = db.chat_get(local_id) {
                        new_messages.push(m);
                    }
                }
                return Ok(None);
            }
            let text = payload["body"].as_str().unwrap_or("").to_string();
            if text.is_empty() {
                return Err("empty_body".into());
            }
            let prt = payload["ref"]["type"].as_str().map(String::from).or(ref_type);
            let pri = payload["ref"]["id"].as_str().map(String::from).or(ref_id);
            // qfk: TTL из конверта — получатель ставит свой expires_at локально.
            let ttl = payload["ttl"].as_u64().filter(|v| *v > 0).map(|v| v as u32);
            // azl: флаг важности из конверта.
            let imp = payload["imp"].as_bool().unwrap_or(false);
            let inserted =
                db.chat_insert_incoming(server_id, room, sender, &text, prt.as_deref(), pri.as_deref(), created_at, imp)?;
            if let (Some(local_id), Some(h)) = (inserted, ttl) {
                db.chat_set_expiry_hours(local_id, h)?;
            }
            Ok(inserted)
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
        receipt_updates,
        deleted,
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

/// 13q: досыл оффлайн-очереди. Проходим pending=1 в хронологии; каждое пробуем
/// реально отправить (try_online_send). Успех — снимаем pending и пишем
/// трекинг; снова Offline — сеть ещё лежит, прекращаем (остальные дождутся
/// следующего реконнекта); Hard — логируем и пропускаем, чтобы «отравленное»
/// сообщение не блокировало очередь. Возвращает досланные (уже pending=0) для
/// эмита во фронт и список затронутых комнат.
fn flush_pending_locked(db: &Database) -> Result<(Vec<ChatMessage>, Vec<String>), String> {
    let token = auth_token(db)?;
    let self_iid = crate::license::get_or_create_installation_id(db)?;
    let queued = db.chat_pending_outgoing()?;
    let mut sent: Vec<ChatMessage> = Vec::new();
    let mut rooms: Vec<String> = Vec::new();
    for m in queued {
        // Получатель для DM — сохранённый peer_iid; для группы (room = "group:…")
        // и пустого peer_iid адресуем всем (None → fan-out по каталогу).
        let peer_opt = if m.room.starts_with(ROOM_GROUP_PREFIX) || m.peer_iid.is_empty() {
            None
        } else {
            Some(m.peer_iid.as_str())
        };
        // mgt: очередь пользовательской комнаты досылается по её room-ключу.
        let room_opt = if m.room.starts_with("room:") { Some(m.room.as_str()) } else { None };
        // qfk: досылаем с тем же TTL комнаты (сервер проставит expires_at).
        let ttl_hours = room_ttl_hours(db, &m.room);
        match try_online_send(
            db,
            &token,
            &self_iid,
            &m.body,
            room_opt,
            peer_opt,
            m.ref_type.as_deref(),
            m.ref_id.as_deref(),
            ttl_hours,
            m.priority,
        ) {
            Ok((_room, pairs)) => {
                db.chat_clear_pending(m.id)?;
                if !pairs.is_empty() {
                    db.chat_insert_outgoing_targets(m.id, &pairs)?;
                }
                if let Some(updated) = db.chat_get(m.id)? {
                    if !rooms.contains(&updated.room) {
                        rooms.push(updated.room.clone());
                    }
                    sent.push(updated);
                }
            }
            Err(SendFail::Offline) => break,
            Err(SendFail::Hard(e)) => {
                let _ = db.log_event(
                    "chat.flush_hard",
                    &format!("msg {}: {e}", m.id),
                    Some("chat"),
                    None,
                );
            }
        }
    }
    if !sent.is_empty() {
        let _ = db.log_event("chat.flushed", &sent.len().to_string(), Some("chat"), None);
    }
    Ok((sent, rooms))
}

/// Досыл очереди под блокировкой БД + эмит событий во фронт. Общий путь для
/// команды chat_flush_pending и WS-хука реконнекта. Возвращает число досланных.
fn flush_and_emit(app: Option<&tauri::AppHandle>) -> Result<usize, String> {
    let (sent, rooms) = with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".into());
        }
        flush_pending_locked(db)
    })?;
    if let Some(app) = app {
        for m in &sent {
            let _ = app.emit("chat:message", m);
        }
        for room in &rooms {
            let _ = app.emit("chat:room_updated", json!({ "room": room }));
        }
    }
    Ok(sent.len())
}

/// Досыл оффлайн-очереди по требованию фронта. Возвращает число досланных.
#[tauri::command]
pub(crate) fn chat_flush_pending(app: tauri::AppHandle) -> Result<usize, String> {
    require_user()?;
    flush_and_emit(Some(&app))
}

/// WS-хук: {"type":"auth_ok"} (реконнект) — досылаем оффлайн-очередь в фоне.
pub(crate) fn flush_on_ws_notify(app: tauri::AppHandle) {
    spawn_task(move || {
        if let Err(e) = flush_and_emit(Some(&app)) {
            eprintln!("[chat] background flush failed: {e}");
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
            .chat_insert_outgoing("dm:me:peer", "peer", "привет", Some("order"), Some("42"), false, false)
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
    fn test_pending_queue_insert_clear_list() {
        let (_d, db) = test_db();
        // Обычное исходящее (не в очереди) и одно оффлайн (pending=1).
        let sent = db
            .chat_insert_outgoing("dm:me:peer", "peer", "ушло", None, None, false, false)
            .unwrap();
        let queued = db
            .chat_insert_outgoing("dm:me:peer", "peer", "в очереди", None, None, true, false)
            .unwrap();
        // В очереди только pending=1.
        let pend = db.chat_pending_outgoing().unwrap();
        assert_eq!(pend.len(), 1);
        assert_eq!(pend[0].id, queued);
        assert!(pend[0].pending);
        // Отправленное — не pending.
        let msgs = db.chat_list(Some("dm:me:peer"), 50).unwrap();
        let sent_msg = msgs.iter().find(|m| m.id == sent).unwrap();
        assert!(!sent_msg.pending);
        // После досыла флаг снят, очередь пуста.
        db.chat_clear_pending(queued).unwrap();
        assert_eq!(db.chat_pending_outgoing().unwrap().len(), 0);
        let after = db.chat_get(queued).unwrap().unwrap();
        assert!(!after.pending);
    }

    #[test]
    fn test_incoming_dedup_by_server_id() {
        let (_d, db) = test_db();
        let first = db
            .chat_insert_incoming(101, "dm:me:peer", "peer", "ответ", None, None, "2026-08-31 10:00:00", false)
            .unwrap();
        assert!(first.is_some());
        // Повторная доставка того же server_id — дедуп, строки не плодятся.
        let second = db
            .chat_insert_incoming(101, "dm:me:peer", "peer", "ответ", None, None, "2026-08-31 10:00:00", false)
            .unwrap();
        assert!(second.is_none());
        assert_eq!(db.chat_count_by_server_id(101).unwrap(), 1);
        assert_eq!(db.chat_max_server_id().unwrap(), 101);
        assert_eq!(db.chat_unread_count().unwrap(), 1, "входящее непрочитано");
    }

    #[test]
    fn test_mark_read_only_incoming() {
        let (_d, db) = test_db();
        let out_id = db.chat_insert_outgoing("dm:me:peer", "peer", "моё", None, None, false, false).unwrap();
        let in_id = db
            .chat_insert_incoming(7, "dm:me:peer", "peer", "их", None, None, "", false)
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
        db.chat_insert_incoming(1, "dm:me:a", "a", "к a", None, None, "", false).unwrap();
        db.chat_insert_incoming(2, "dm:me:b", "b", "к b", None, None, "", false).unwrap();
        db.chat_insert_incoming(3, "group:g1", "a", "в группу", None, None, "", false).unwrap();
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

    // ── CHAT-2.0 (dhs): трекинг исходящих ────────────────────────────────

    #[test]
    fn test_outgoing_targets_status_flow() {
        let (_d, db) = test_db();
        let msg_id = db.chat_insert_outgoing("group:g1", "", "всем", None, None, false, false).unwrap();
        // До привязки конвертов: «просто отправлено».
        let m = db.chat_get(msg_id).unwrap().unwrap();
        assert_eq!(m.out_total, Some(0));
        assert_eq!(m.out_delivered, Some(0));
        assert_eq!(m.out_read, Some(0));

        db.chat_insert_outgoing_targets(
            msg_id,
            &[("peer-a".into(), 501), ("peer-b".into(), 502)],
        )
        .unwrap();
        let (total, delivered, read) = db.chat_out_status(msg_id).unwrap();
        assert_eq!((total, delivered, read), (2, 0, 0));

        // delivered по outbox: идемпотентно, возвращает изменённые msg_id.
        let changed = db
            .chat_mark_targets_delivered(&[(501, "2026-09-12 12:00:01.123".into())])
            .unwrap();
        assert_eq!(changed, vec![msg_id]);
        let changed2 = db
            .chat_mark_targets_delivered(&[(501, "2026-09-12 12:00:02.000".into())])
            .unwrap();
        assert!(changed2.is_empty(), "повторный delivered не перезаписывает");
        // Пустой ts (ещё не доставлено) — пропуск.
        assert!(db.chat_mark_targets_delivered(&[(502, String::new())]).unwrap().is_empty());
        assert_eq!(db.chat_out_status(msg_id).unwrap(), (2, 1, 0));

        // read по read_receipt ids.
        let changed = db.chat_mark_targets_read(&[502]).unwrap();
        assert_eq!(changed, vec![msg_id]);
        assert!(db.chat_mark_targets_read(&[502]).unwrap().is_empty());
        assert!(db.chat_mark_targets_read(&[9999]).unwrap().is_empty(), "чужой server_id игнорится");
        assert_eq!(db.chat_out_status(msg_id).unwrap(), (2, 1, 1));

        // В листинге агрегаты приезжают вместе с сообщением.
        let m = db.chat_list(Some("group:g1"), 50).unwrap()[0].clone();
        assert_eq!((m.out_total, m.out_delivered, m.out_read), (Some(2), Some(1), Some(1)));
    }

    #[test]
    fn test_incoming_unread_refs() {
        let (_d, db) = test_db();
        let in_id = db
            .chat_insert_incoming(77, "dm:me:peer", "peer", "их", None, None, "", false)
            .unwrap()
            .unwrap();
        let out_id = db.chat_insert_outgoing("dm:me:peer", "peer", "моё", None, None, false, false).unwrap();
        let refs = db.chat_incoming_unread_refs(&[in_id, out_id]).unwrap();
        assert_eq!(refs, vec![(77, "peer".to_string())], "только непрочитанные входящие");
        // После mark_read refs пусты — квитанция не уйдёт повторно.
        db.chat_mark_read(&[in_id]).unwrap();
        assert!(db.chat_incoming_unread_refs(&[in_id]).unwrap().is_empty());
    }

    #[test]
    fn test_parse_read_receipt_ids() {
        let p = json!({ "v": 1, "type": "read_receipt", "ids": [1, 2, -5, "x"] });
        assert_eq!(parse_read_receipt_ids(&p), Some(vec![1, 2]));
        // Обычное сообщение — не квитанция.
        let msg = json!({ "v": 1, "body": "привет" });
        assert_eq!(parse_read_receipt_ids(&msg), None);
        // Неизвестный служебный тип будущих версий — не квитанция.
        let future = json!({ "v": 1, "type": "edit", "body": "..." });
        assert_eq!(parse_read_receipt_ids(&future), None);
        // Битый ids — None (упадёт в payload_parse-ветку лога, не в ленту).
        let bad = json!({ "v": 1, "type": "read_receipt", "ids": "nope" });
        assert_eq!(parse_read_receipt_ids(&bad), None);
    }

    #[test]
    fn test_parse_edit() {
        // tdq: корректный edit-конверт — (server_id'ы, новый текст).
        let p = json!({ "v": 1, "type": "edit", "ids": [10, -3, "x"], "body": "  новый  " });
        assert_eq!(parse_edit(&p), Some((vec![10], "новый".to_string())));
        // Обычное сообщение — не правка.
        let msg = json!({ "v": 1, "body": "привет" });
        assert_eq!(parse_edit(&msg), None);
        // Другой служебный тип — не правка.
        let del = json!({ "v": 1, "type": "delete", "ids": [1] });
        assert_eq!(parse_edit(&del), None);
        // Пустой текст после trim — не правка.
        let empty = json!({ "v": 1, "type": "edit", "ids": [1], "body": "   " });
        assert_eq!(parse_edit(&empty), None);
        // Нет валидных ids — не правка.
        let no_ids = json!({ "v": 1, "type": "edit", "ids": [], "body": "текст" });
        assert_eq!(parse_edit(&no_ids), None);
    }

    #[test]
    fn test_chat_edit_own_and_incoming() {
        let (_d, db) = test_db();
        // Своё исходящее — правим текст, ставим edited.
        let out_id = db.chat_insert_outgoing("dm:me:peer", "peer", "старое", None, None, false, false).unwrap();
        assert_eq!(db.chat_edit_own(out_id, "правленое").unwrap(), 1);
        let m = db.chat_get(out_id).unwrap().unwrap();
        assert_eq!(m.body, "правленое");
        assert!(m.edited);
        // Входящее по server_id — применяем E2E-правку автора.
        let in_id = db
            .chat_insert_incoming(555, "dm:me:peer", "peer", "их старое", None, None, "", false)
            .unwrap()
            .unwrap();
        let refs = db.chat_edit_incoming_by_server_ids(&[555], "их новое").unwrap();
        assert_eq!(refs, vec![("dm:me:peer".to_string(), in_id)]);
        let mi = db.chat_get(in_id).unwrap().unwrap();
        assert_eq!(mi.body, "их новое");
        assert!(mi.edited);
    }
}
