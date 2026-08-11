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
const RECONNECT_SECS: u64 = 3;
const PING_INTERVAL_SECS: u64 = 30;
// FIX P3-HB-01: Reconnect after 2 missed pings (60 seconds total)
const MAX_MISSED_PINGS: u32 = 2;
// FIX P0-9: Track last full_pull time to prevent duplicate requests on rapid reconnects
static LAST_FULL_PULL: RwLock<Option<Instant>> = RwLock::new(None);
const FULL_PULL_DEBOUNCE_SECS: u64 = 30;  // Only one full_pull per 30 seconds

// ─────────────────────────────────────────
//  Shared credentials (set from main.rs)
// ─────────────────────────────────────────

#[derive(Default, Clone)]
pub struct WsCredentials {
    pub token:    Option<String>,
    pub group_id: Option<String>,
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
        let (token, group_id) = {
            let c = creds.read().unwrap_or_else(|e| e.into_inner());
            match c.token.clone() {
                Some(t) if !t.is_empty() => {
                    (t, c.group_id.clone().unwrap_or_default())
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
                                            handle_ws_message(&app, pool, mtype, &msg);
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

fn handle_ws_message(app: &AppHandle, pool: &crate::database::DbPool, mtype: &str, msg: &serde_json::Value) {
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
            // FIX WS-BATCH-01: Limit batch size to prevent DoS
            if cards.len() > 100 {
                eprintln!("[ws_sync] Ignoring batch with {} cards (max 100)", cards.len());
                return;
            }
            apply_card_updates(pool, &cards);

            let event = if mtype == "full_data" { "sync:full_data" } else { "sync:card_update" };
            let _ = app.emit(event, serde_json::json!({
                "cards": cards,
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

fn apply_card_updates(pool: &crate::database::DbPool, cards: &[serde_json::Value]) {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return,
    };

    // ★ Insight: BEGIN/COMMIT транзакция для batch update
    // Ускоряет синхронизацию 100 карт с ~5 секунд до ~200ms
    let _ = conn.execute_batch("BEGIN");

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
