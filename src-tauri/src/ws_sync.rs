//! Raw WebSocket sync client for Tauri desktop.
//!
//! Architecture:
//!   - Credentials (token + group_id) are set by main.rs after unlock/join-group.
//!   - Background std::thread connects to wss://.../ws, authenticates, receives events.
//!   - On card:update — applies status changes to local SQLite (status is plaintext).
//!   - On catalog_update — upserts catalog item/shop into local SQLite.
//!   - Emits Tauri events so React refreshes without reload.
//!   - Auto-reconnects every 3 seconds on disconnect.

#![allow(dead_code)]

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tungstenite::{connect, Message};
use tauri::{AppHandle, Emitter};
use crate::models;

// URL выводится из crate::endpoints (переменная VAULTBASE_SYNC_WS_URL там же).
// CLEAN-004: Use centralized constants
use crate::constants::{
    WS_RECONNECT_SECS as RECONNECT_SECS,
    WS_PING_INTERVAL_SECS as PING_INTERVAL_SECS,
    WS_MAX_MISSED_PINGS as MAX_MISSED_PINGS,
    WS_FULL_PULL_DEBOUNCE_SECS as FULL_PULL_DEBOUNCE_SECS,
};
static LAST_FULL_PULL: RwLock<Option<Instant>> = RwLock::new(None);

// ─────────────────────────────────────────
//  Shared credentials (set from main.rs)
// ─────────────────────────────────────────

#[derive(Default, Clone)]
pub struct WsCredentials {
    pub token:    Option<String>,
    pub group_id: Option<String>,
    pub group_key: Option<[u8; 32]>,
}

pub type SharedCreds = Arc<RwLock<WsCredentials>>;

pub fn new_credentials() -> SharedCreds {
    Arc::new(RwLock::new(WsCredentials::default()))
}

// ─────────────────────────────────────────
//  Stop signal
// ─────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};

pub struct WsSyncHandle {
    pub running: Arc<AtomicBool>,
    pub creds:   SharedCreds,
}

impl WsSyncHandle {
    pub fn stop(&self) { self.running.store(false, Ordering::Relaxed); }
    pub fn is_running(&self) -> bool { self.running.load(Ordering::Relaxed) }
    pub fn set_creds(&self, token: Option<String>, group_id: Option<String>) {
        if let Ok(mut c) = self.creds.write() {
            c.token    = token;
            c.group_id = group_id;
        }
    }

    pub fn set_group_key(&self, key: Option<[u8; 32]>) {
        if let Ok(mut c) = self.creds.write() {
            c.group_key = key;
        }
    }
}

// ─────────────────────────────────────────
//  Start background thread
// ─────────────────────────────────────────

pub fn start(app: AppHandle, handle: Arc<WsSyncHandle>) {
    if handle.is_running() { return; }
    handle.running.store(true, Ordering::Relaxed);

    let running = handle.running.clone();
    let creds   = handle.creds.clone();

    std::thread::spawn(move || {
        ws_loop(app, running, creds);
    });
}

// ─────────────────────────────────────────
//  Main loop
// ─────────────────────────────────────────

fn ws_loop(app: AppHandle, running: Arc<AtomicBool>, creds: SharedCreds) {
    while running.load(Ordering::Relaxed) {
        // Для подключения достаточно ТОКЕНА ЛИЦЕНЗИИ. Группа необязательна:
        // соло-оператор — полноценный сценарий, ему тоже нужны события
        // сервера (обновления, отзыв лицензии, admin-уведомления).
        // Сервер это уже поддерживает: в socket.js членство в группе
        // проверяется как `if (member)`, соединение принимается по одному
        // токену. Раньше здесь требовалась пара (token, group_id), поэтому
        // без группы цикл молча спал и статус навсегда застывал на
        // «Connecting…» — при живом и доступном сервере.
        let (token, group_id, group_key) = {
            let c = creds.read().unwrap_or_else(|e| e.into_inner());
            match c.token.clone() {
                Some(t) if !t.is_empty() => {
                    (t, c.group_id.clone().unwrap_or_default(), c.group_key)
                }
                _ => {
                    // Токена нет — лицензия ещё не активирована. Ждём.
                    let _ = app.emit("ws_sync:status", serde_json::json!({
                        "connected": false, "connecting": false, "reason": "no_license"
                    }));
                    std::thread::sleep(Duration::from_secs(RECONNECT_SECS));
                    continue;
                }
            }
        };

        let _ = app.emit("ws_sync:status", serde_json::json!({ "connected": false, "connecting": true }));

        // Переменную VAULTBASE_SYNC_WS_URL читает сам endpoints::ws_url();
        // если её нет, адрес выводится из общей базы (VAULTBASE_SERVER_URL).
        let ws_url = crate::endpoints::ws_url();
        match connect(ws_url) {
            Ok((mut socket, _)) => {
                // Сырой /ws протокол (ws-tauri.js): auth первым фреймом как
                // {"type":"auth","token":"..."}. Не socket.io (40{...}) —
                // сервер /ws парсит JSON напрямую.
                // FIX AUDIT-24: раньше токен фильтровался до [A-Za-z0-9_-], что
                // портило base64-токены с '+/='. JSON-сериализация уже безопасна.
                let auth_msg = serde_json::json!({ "type": "auth", "token": token }).to_string();
                if socket.send(Message::Text(auth_msg)).is_err() {
                    std::thread::sleep(Duration::from_secs(RECONNECT_SECS));
                    continue;
                }

                let _ = app.emit("ws_sync:status", serde_json::json!({ "connected": true, "connecting": false, "group_id": group_id }));

                // FIX P0-9: Request full pull of missed updates with debouncing
                let now = Instant::now();
                let should_pull = {
                    let last_pull = LAST_FULL_PULL.read().unwrap_or_else(|e| e.into_inner());
                    match *last_pull {
                        Some(last) => now.duration_since(last).as_secs() > FULL_PULL_DEBOUNCE_SECS,
                        None => true,
                    }
                };

                if should_pull {
                    // /ws протокол: {"type":"full_pull"}. Сервер вернёт full_data
                    // только если клиент в группе — иначе error:not_in_group,
                    // который мы молча игнорируем (соло-режим без группы).
                    let full_pull = serde_json::json!({ "type": "full_pull" }).to_string();
                    let _ = socket.send(Message::Text(full_pull));
                    if let Ok(mut last_pull) = LAST_FULL_PULL.write() {
                        *last_pull = Some(now);
                    }
                }

                // Set a read timeout so the loop can wake up and send keepalive pings.
                // Reach through MaybeTlsStream to get the underlying TcpStream.
                {
                    use tungstenite::stream::MaybeTlsStream;
                    let ping_dur = Duration::from_secs(PING_INTERVAL_SECS);
                    match socket.get_mut() {
                        MaybeTlsStream::Plain(tcp) => {
                            let _ = tcp.set_read_timeout(Some(ping_dur));
                        }
                        MaybeTlsStream::NativeTls(tls) => {
                            let _ = tls.get_ref().set_read_timeout(Some(ping_dur));
                        }
                        _ => {}
                    }
                }

                let mut last_activity = Instant::now();
                // FIX P3-HB-02: Track missed pings for heartbeat timeout
                let mut missed_pings = 0u32;

                // Message loop
                loop {
                    if !running.load(Ordering::Relaxed) {
                        let _ = socket.close(None);
                        return;
                    }
                    // Check if credentials changed (e.g., user left group)
                    // group_id сравниваем нормализованно: при работе без группы
                    // здесь пустая строка, а в creds — None. Прямое сравнение
                    // Some("") == None даёт false и рвало бы соединение
                    // соло-оператору на каждой итерации.
                    let still_valid = {
                        let c = creds.read().unwrap_or_else(|e| e.into_inner());
                        let cur_group = c.group_id.clone().unwrap_or_default();
                        c.token.as_deref() == Some(&token) && cur_group == group_id
                    };
                    if !still_valid { let _ = socket.close(None); break; }

                    match socket.read() {
                        Ok(Message::Text(text)) => {
                            last_activity = Instant::now();
                            missed_pings = 0; // Reset on any message received
                            // /ws протокол: все сообщения — JSON-объекты с полем
                            // "type". Разбираем и передаём в обработчик.
                            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&text) {
                                let mtype = msg["type"].as_str().unwrap_or("");
                                // Сервер шлёт {"type":"ping"} каждые 30с — отвечаем pong.
                                if mtype == "ping" {
                                    let pong = serde_json::json!({ "type": "pong" }).to_string();
                                    let _ = socket.send(Message::Text(pong));
                                    continue;
                                }
                                if let Some(state) = crate::state::STATE.get() {
                                    if let Ok(db) = state.db.lock() {
                                        if let Some(pool) = db.pool.as_ref() {
                                            handle_ws_message(&app, pool, mtype, &msg, group_key.as_ref());
                                        }
                                    }
                                }
                            }
                        }
                        Ok(Message::Ping(p)) => {
                            last_activity = Instant::now();
                            missed_pings = 0;
                            let _ = socket.send(Message::Pong(p));
                        }
                        Ok(Message::Pong(_)) => {
                            last_activity = Instant::now();
                            missed_pings = 0;
                        }
                        Ok(Message::Close(_)) => break,
                        Err(tungstenite::Error::Io(ref e))
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                || e.kind() == std::io::ErrorKind::TimedOut =>
                        {
                            // Read timeout elapsed — send a ping if idle long enough.
                            if last_activity.elapsed() >= Duration::from_secs(PING_INTERVAL_SECS) {
                                // FIX P3-HB-03: Track missed pings and reconnect after MAX_MISSED_PINGS
                                missed_pings += 1;
                                if missed_pings >= MAX_MISSED_PINGS {
                                    eprintln!("[ws_sync] Heartbeat timeout: {} missed pings, reconnecting", missed_pings);
                                    let _ = socket.close(None);
                                    break;
                                }
                                if let Err(e) = socket.send(Message::Ping(vec![])) {
                                    eprintln!("[ws_sync] ping failed: {e}");
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                        _ => {}
                    }
                }

                let _ = app.emit("ws_sync:status", serde_json::json!({ "connected": false, "connecting": false }));
                // BUG-009: Reset full_pull debounce on disconnect so reconnect gets fresh data
                if let Ok(mut last_pull) = LAST_FULL_PULL.write() {
                    *last_pull = None;
                }
            }
            Err(e) => {
                eprintln!("[ws_sync] connect error: {e}");
            }
        }

        if running.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(RECONNECT_SECS));
        }
    }
}

// ─────────────────────────────────────────
//  Event handler — сырой /ws протокол (ws-tauri.js)
// ─────────────────────────────────────────

fn handle_ws_message(app: &AppHandle, pool: &crate::database::DbPool, mtype: &str, msg: &serde_json::Value, group_key: Option<&[u8; 32]>) {
    match mtype {
        // {"type":"auth_ok","installation_id":...,"group_id":...}
        "auth_ok" => {
            // Соединение подтверждено. Ничего не делаем — статус уже "connected".
        }
        // {"type":"auth_error","error":"invalid_token"|"missing_token"}
        "auth_error" => {
            let err = msg["error"].as_str().unwrap_or("");
            eprintln!("[ws_sync] auth_error: {err}");
            // invalid_token = лицензия отозвана/невалидна — сообщаем UI.
            if err == "invalid_token" {
                let _ = app.emit("license_revoked", ());
            }
        }
        // {"type":"card_update"|"full_data","cards":[...],"updated_by":...}
        "card_update" | "full_data" => {
            let cards = match msg["cards"].as_array() {
                Some(c) => c.clone(),
                None => return,
            };
            if cards.len() > 100 {
                eprintln!("[ws_sync] Ignoring batch with {} cards (max 100)", cards.len());
                return;
            }

            let decrypted_cards: Vec<serde_json::Value> = cards.iter().map(|card| {
                let mut c = card.clone();
                if let (Some(gk), Some(enc_data)) = (group_key, card["encrypted_data"].as_str()) {
                    if !enc_data.is_empty() {
                        if let Ok(plain) = crate::encryption::e2e_decrypt(enc_data, gk) {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&plain) {
                                if let Some(obj) = parsed.as_object() {
                                    for (k, v) in obj {
                                        c[k.clone()] = v.clone();
                                    }
                                }
                            }
                        }
                    }
                }
                c
            }).collect();

            apply_card_updates(pool, &decrypted_cards);

            // FEAT-010: full_data несёт и теги курьеров группы (снапшот состояния)
            if mtype == "full_data" {
                if let Some(tags) = msg["courier_tags"].as_array() {
                    let applied = apply_courier_tags_snapshot(pool, tags);
                    if applied > 0 {
                        let _ = app.emit("courier_tag:refresh", ());
                    }
                }
            }

            let event = if mtype == "full_data" { "sync:full_data" } else { "sync:card_update" };
            let _ = app.emit(event, serde_json::json!({
                "cards": decrypted_cards,
                "updated_by": msg["updated_by"].as_str().unwrap_or(""),
            }));
        }

        "member_joined" => {
            let _ = app.emit("sync:member_joined", serde_json::json!({
                "installation_id": msg["installation_id"].as_str().unwrap_or("")
            }));
        }

        "member_left" => {
            let _ = app.emit("sync:member_left", serde_json::json!({
                "installation_id": msg["installation_id"].as_str().unwrap_or("")
            }));
        }

        // {"type":"catalog_update","payload":{"type":"item"|"shop","data":{...}}}
        "catalog_update" => {
            let payload = &msg["payload"];
            let update_type = payload["type"].as_str().unwrap_or("");
            let item_data = &payload["data"];
            if update_type == "item" {
                if let Some(name) = item_data["name"].as_str() {
                    let input = models::CatalogItemInput {
                        id: item_data["id"].as_i64(),
                        name: name.to_string(),
                        asin: item_data["asin"].as_str().map(|s| s.to_string()),
                        price: item_data["price"].as_f64(),
                        pct: item_data["pct"].as_i64(),
                        category: item_data["category"].as_str().map(|s| s.to_string()),
                        notes_en: item_data["notes_en"].as_str().map(|s| s.to_string()),
                        stop: item_data["stop"].as_bool().unwrap_or(false)
                            || item_data["stop"].as_i64().map(|v| v != 0).unwrap_or(false),
                    };
                    apply_catalog_item(pool, input);
                    let _ = app.emit("catalog_item_added", item_data);
                }
            } else if update_type == "shop" {
                if let Some(domain) = item_data["domain"].as_str() {
                    let input = models::CatalogShopInput {
                        domain: domain.to_string(),
                        category: item_data["category"].as_str().map(|s| s.to_string()),
                        score: item_data["score"].as_i64(),
                        ship_us: item_data["ship_us"].as_bool().unwrap_or(false)
                            || item_data["ship_us"].as_i64().map(|v| v != 0).unwrap_or(false),
                        fraud_level: item_data["fraud_level"].as_str().map(|s| s.to_string()),
                        top_brands: item_data["top_brands"].as_str().map(|s| s.to_string()),
                        top_products: item_data["top_products"].as_str().map(|s| s.to_string()),
                        excluded: item_data["excluded"].as_bool().unwrap_or(false)
                            || item_data["excluded"].as_i64().map(|v| v != 0).unwrap_or(false),
                    };
                    apply_catalog_shop(pool, input);
                    let _ = app.emit("catalog_shop_added", item_data);
                }
            }
        }

        // FEAT-010: {"type":"courier_tag","provider","courier_hash","tag","action":"add"|"remove"}
        "courier_tag" => {
            let provider = msg["provider"].as_str().unwrap_or("swat");
            let hash = match msg["courier_hash"].as_str() {
                Some(h) if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) => h,
                _ => return,
            };
            let tag = match msg["tag"].as_str() {
                Some(t) => t,
                None => return,
            };
            let add = msg["action"].as_str() != Some("remove");
            if apply_courier_tag(pool, provider, hash, tag, add) {
                let _ = app.emit("courier_tag:update", serde_json::json!({
                    "provider": provider,
                    "courier_hash": hash,
                    "tag": tag,
                    "action": if add { "add" } else { "remove" },
                    "updated_by": msg["updated_by"].as_str().unwrap_or(""),
                }));
            }
        }

        // {"type":"error","error":"not_in_group"|...} — молча игнорируем:
        // соло-режим без группы получит not_in_group на full_pull, это норма.
        "error" | "pong" | "group_refreshed" => {}

        _ => {}
    }
}

// ─────────────────────────────────────────
//  DB writes (status field is plaintext)
// ─────────────────────────────────────────

fn status_weight(s: &str) -> u8 {
    // FIX AUDIT-17: "declined" — статус заказа, не карты. Убран.
    match s { "dead" => 5, "archive" => 3, "in_use" => 2, "free" => 1, _ => 0 }
}

fn apply_catalog_item(pool: &crate::database::DbPool, item: models::CatalogItemInput) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute(
        "INSERT OR REPLACE INTO catalog_items(id,name,asin,price,pct,category,notes_en,stop) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![item.id, item.name, item.asin, item.price, item.pct, item.category, item.notes_en, item.stop as i64],
    );
}

fn apply_catalog_shop(pool: &crate::database::DbPool, shop: models::CatalogShopInput) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = conn.execute(
        "INSERT OR REPLACE INTO catalog_shops(domain,category,score,ship_us,fraud_level,top_brands,top_products,excluded) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![shop.domain, shop.category, shop.score, shop.ship_us as i64, shop.fraud_level, shop.top_brands, shop.top_products, shop.excluded as i64],
    );
}

/// FEAT-010: применить один тег курьера из группы. true = состояние изменилось.
/// Нормализация как в Database::normalize_courier_tag (trim + lowercase).
fn apply_courier_tag(
    pool: &crate::database::DbPool,
    provider: &str,
    courier_hash: &str,
    tag: &str,
    add: bool,
) -> bool {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let tag = tag.trim().to_lowercase();
    if tag.is_empty() || tag.chars().count() > 100 {
        return false;
    }
    let res = if add {
        conn.execute(
            "INSERT OR IGNORE INTO courier_tags(provider,courier_id,courier_hash,tag) VALUES(?1,NULL,?2,?3)",
            rusqlite::params![provider, courier_hash, tag],
        )
    } else {
        conn.execute(
            "DELETE FROM courier_tags WHERE provider=?1 AND courier_hash=?2 AND tag=?3",
            rusqlite::params![provider, courier_hash, tag],
        )
    };
    matches!(res, Ok(n) if n > 0)
}

/// FEAT-010: снапшот тегов из full_data. action='remove' сносит запись,
/// 'add' — добавляет. Возвращает число реально изменённых строк.
fn apply_courier_tags_snapshot(pool: &crate::database::DbPool, tags: &[serde_json::Value]) -> u32 {
    if tags.len() > 5000 {
        eprintln!("[ws_sync] Ignoring courier_tags snapshot with {} rows (max 5000)", tags.len());
        return 0;
    }
    let mut applied = 0u32;
    for t in tags {
        let provider = t["provider"].as_str().unwrap_or("swat");
        let hash = match t["courier_hash"].as_str() {
            Some(h) if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) => h,
            _ => continue,
        };
        let tag = match t["tag"].as_str() {
            Some(s) => s,
            None => continue,
        };
        let add = t["action"].as_str() != Some("remove");
        if apply_courier_tag(pool, provider, hash, tag, add) {
            applied += 1;
        }
    }
    applied
}

fn apply_card_updates(pool: &crate::database::DbPool, cards: &[serde_json::Value]) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };

    // ★ Insight: BEGIN/COMMIT транзакция для batch update
    // Ускоряет синхронизацию 100 карт с ~5 секунд до ~200ms
    // BUG-008: BEGIN IMMEDIATE — при крахе между апдейтами SQLite откатывает
    // незавершённую транзакцию целиком (нет partial state).
    if conn.execute_batch("BEGIN IMMEDIATE").is_err() {
        return; // пул занят/бит — без транзакции не работаем
    }

    for card in cards {
        // FIX WS-VALIDATION-05: Validate card_hash format (must be hex, min 8 chars)
        let hash   = match card["card_hash"].as_str() {
            Some(h) if h.len() >= 8 && h.chars().all(|c| c.is_ascii_hexdigit()) => h,
            _ => continue
        };
        // FIX WS-STATUS-01: Validate status is one of allowed values
        // FIX AUDIT-17: "declined" — статус заказа, не карты. Убран.
        let status = match card["status"].as_str() {
            Some(s) if ["free", "in_use", "archive", "dead"].contains(&s) => s,
            _ => continue
        };
        // FIX WS-NOTES-01: Limit notes length to prevent DoS
        let notes  = card["notes"].as_str().and_then(|n| if n.len() <= 500 { Some(n) } else { None });
        let new_w  = status_weight(status);

        let existing = conn.query_row(
            "SELECT id, status FROM credit_cards WHERE card_hash = ?1",
            rusqlite::params![hash],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        );

        if let Ok((id, cur_status)) = existing {
            if new_w > status_weight(&cur_status) {
                let _ = conn.execute(
                    "UPDATE credit_cards SET status = ?1 WHERE id = ?2",
                    rusqlite::params![status, id],
                );
                if let Some(n) = notes {
                    if !n.is_empty() {
                        let _ = conn.execute(
                            "UPDATE credit_cards SET notes = ?1 WHERE id = ?2",
                            rusqlite::params![n, id],
                        );
                    }
                }
                let _ = conn.execute(
                    "INSERT INTO activity_log(event_type, description) VALUES(?1,?2)",
                    rusqlite::params![
                        "sync.card_updated",
                        format!("Sync: card {} {} → {}", &hash[..8.min(hash.len())], cur_status, status),
                    ],
                );
            }
        }
    }

    // COMMIT транзакции — все изменения применяются атомарно
    let _ = conn.execute_batch("COMMIT");
}


// ─────────────────────────────────────────
//  Tests (TEST-007)
// ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn test_db() -> (tempfile::TempDir, crate::database::Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = crate::database::Database::open(path.to_str().unwrap()).unwrap();
        (dir, db)
    }

    // ── status_weight ──

    #[test]
    fn test_status_weight_ordering() {
        assert!(status_weight("dead") > status_weight("archive"));
        assert!(status_weight("archive") > status_weight("in_use"));
        assert!(status_weight("in_use") > status_weight("free"));
        assert!(status_weight("free") > status_weight("unknown"));
        assert_eq!(status_weight(""), 0);
        assert_eq!(status_weight("declined"), 0); // FIX AUDIT-17: не статус карты
    }

    // ── WsSyncHandle ──

    #[test]
    fn test_handle_stop_and_creds() {
        let handle = WsSyncHandle {
            running: Arc::new(AtomicBool::new(true)),
            creds: new_credentials(),
        };
        assert!(handle.is_running());
        handle.set_creds(Some("tok".into()), Some("grp".into()));
        handle.set_group_key(Some([7u8; 32]));
        {
            let c = handle.creds.read().unwrap();
            assert_eq!(c.token.as_deref(), Some("tok"));
            assert_eq!(c.group_id.as_deref(), Some("grp"));
            assert_eq!(c.group_key, Some([7u8; 32]));
        }
        handle.stop();
        assert!(!handle.is_running());
    }

    #[test]
    fn test_credentials_default_empty() {
        let c = WsCredentials::default();
        assert!(c.token.is_none());
        assert!(c.group_id.is_none());
        assert!(c.group_key.is_none());
    }

    // ── apply_card_updates ──

    fn insert_card(db: &crate::database::Database, hash: &str, status: &str) {
        db.conn.execute(
            "INSERT INTO credit_cards(card_hash, status) VALUES(?1, ?2)",
            rusqlite::params![hash, status],
        ).unwrap();
    }

    fn card_status(db: &crate::database::Database, hash: &str) -> String {
        db.conn.query_row(
            "SELECT status FROM credit_cards WHERE card_hash = ?1",
            rusqlite::params![hash],
            |r| r.get(0),
        ).unwrap()
    }

    #[test]
    fn test_apply_card_updates_escalates_status() {
        let (_dir, db) = test_db();
        insert_card(&db, "abcdef0123456789", "free");
        let pool = db.pool.as_ref().unwrap();

        apply_card_updates(pool, &[serde_json::json!({
            "card_hash": "abcdef0123456789",
            "status": "dead",
            "notes": "killed by sync"
        })]);

        assert_eq!(card_status(&db, "abcdef0123456789"), "dead");
        let notes: String = db.conn.query_row(
            "SELECT notes FROM credit_cards WHERE card_hash = 'abcdef0123456789'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(notes, "killed by sync");
    }

    #[test]
    fn test_apply_card_updates_no_downgrade() {
        // dead (5) → free (1): эскалация только вверх, даунгрейд запрещён
        let (_dir, db) = test_db();
        insert_card(&db, "abcdef0123456789", "dead");
        let pool = db.pool.as_ref().unwrap();

        apply_card_updates(pool, &[serde_json::json!({
            "card_hash": "abcdef0123456789",
            "status": "free"
        })]);

        assert_eq!(card_status(&db, "abcdef0123456789"), "dead");
    }

    #[test]
    fn test_apply_card_updates_skips_invalid_hash() {
        let (_dir, db) = test_db();
        insert_card(&db, "abcdef0123456789", "free");
        let pool = db.pool.as_ref().unwrap();

        // Слишком короткий хеш
        apply_card_updates(pool, &[serde_json::json!({ "card_hash": "abc", "status": "dead" })]);
        // Не-hex символы
        apply_card_updates(pool, &[serde_json::json!({ "card_hash": "zzzzzzzzzzzz", "status": "dead" })]);
        // Хеш отсутствует
        apply_card_updates(pool, &[serde_json::json!({ "status": "dead" })]);

        assert_eq!(card_status(&db, "abcdef0123456789"), "free");
    }

    #[test]
    fn test_apply_card_updates_skips_invalid_status() {
        let (_dir, db) = test_db();
        insert_card(&db, "abcdef0123456789", "free");
        let pool = db.pool.as_ref().unwrap();

        apply_card_updates(pool, &[serde_json::json!({
            "card_hash": "abcdef0123456789",
            "status": "declined" // недопустимый статус карты
        })]);

        assert_eq!(card_status(&db, "abcdef0123456789"), "free");
    }

    #[test]
    fn test_apply_card_updates_notes_length_limit() {
        let (_dir, db) = test_db();
        insert_card(&db, "abcdef0123456789", "free");
        let pool = db.pool.as_ref().unwrap();

        let long_notes = "x".repeat(501);
        apply_card_updates(pool, &[serde_json::json!({
            "card_hash": "abcdef0123456789",
            "status": "in_use",
            "notes": long_notes
        })]);

        // Статус применён, а слишком длинные notes — нет
        assert_eq!(card_status(&db, "abcdef0123456789"), "in_use");
        let notes: Option<String> = db.conn.query_row(
            "SELECT notes FROM credit_cards WHERE card_hash = 'abcdef0123456789'",
            [], |r| r.get(0),
        ).unwrap();
        assert!(notes.is_none());
    }

    #[test]
    fn test_apply_card_updates_unknown_hash_ignored() {
        let (_dir, db) = test_db();
        let pool = db.pool.as_ref().unwrap();
        // Карты с таким хешем нет — просто не падаем
        apply_card_updates(pool, &[serde_json::json!({
            "card_hash": "00000000deadbeef",
            "status": "dead"
        })]);
        let count: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM credit_cards", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    // ── catalog upserts ──

    #[test]
    fn test_apply_catalog_item_upsert() {
        let (_dir, db) = test_db();
        let pool = db.pool.as_ref().unwrap().clone();

        let item = models::CatalogItemInput {
            id: Some(1),
            name: "Test Item".into(),
            asin: Some("B000TEST".into()),
            price: Some(99.99),
            pct: Some(50),
            category: Some("electronics".into()),
            notes_en: None,
            stop: false,
        };
        apply_catalog_item(&pool, item.clone());
        apply_catalog_item(&pool, models::CatalogItemInput { name: "Updated".into(), ..item });

        let name: String = db.conn.query_row(
            "SELECT name FROM catalog_items WHERE id = 1", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(name, "Updated");
    }

    #[test]
    fn test_apply_catalog_shop_upsert() {
        let (_dir, db) = test_db();
        let pool = db.pool.as_ref().unwrap().clone();

        let shop = models::CatalogShopInput {
            domain: "example.com".into(),
            category: Some("electronics".into()),
            score: Some(80),
            ship_us: true,
            fraud_level: Some("low".into()),
            top_brands: None,
            top_products: None,
            excluded: false,
        };
        apply_catalog_shop(&pool, shop);
        apply_catalog_shop(&pool, models::CatalogShopInput {
            domain: "example.com".into(),
            category: None,
            score: Some(95),
            ship_us: true,
            fraud_level: None,
            top_brands: None,
            top_products: None,
            excluded: false,
        });

        let (count, score): (i64, i64) = db.conn.query_row(
            "SELECT COUNT(*), MAX(score) FROM catalog_shops WHERE domain = 'example.com'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(count, 1);
        assert_eq!(score, 95);
    }
}
