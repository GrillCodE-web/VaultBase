//! Raw WebSocket sync client for Tauri desktop.
//!
//! Architecture:
//!   - Credentials (license token) are set from auth.rs after unlock.
//!   - Background std::thread connects to wss://.../ws, authenticates, receives events.
//!   - On cards_issued / assets_issued / config_shared — фоново забирает
//!     запечатанные срезы/share-ключи менеджера (commands/slices.rs, MGR-018).
//!   - On catalog_update — upserts catalog item/shop into local SQLite.
//!   - Emits Tauri events so React refreshes without reload.
//!   - Auto-reconnects every 3 seconds on disconnect.
//!
//! MGR-018 (этап E1): групповой card sync (full_pull, card_update/full_data,
//! E2E group_key, courier_tag, member_joined/left) выпилен — карты приходят
//! только персональными срезами от менеджера.

#![allow(dead_code)]

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tungstenite::{connect, Message};
use tauri::{AppHandle, Emitter};
use crate::models;
use crate::state::with_db;

// URL выводится из crate::endpoints (переменная VAULTBASE_SYNC_WS_URL там же).
// CLEAN-004: Use centralized constants
use crate::constants::{
    WS_RECONNECT_SECS as RECONNECT_SECS,
    WS_PING_INTERVAL_SECS as PING_INTERVAL_SECS,
    WS_MAX_MISSED_PINGS as MAX_MISSED_PINGS,
};

// ─────────────────────────────────────────
//  Shared credentials (set from main.rs)
// ─────────────────────────────────────────

/// MGR-018 (этап E1): group_id/group_key удалены — воркер всегда соло,
/// WS авторизуется одним токеном лицензии.
#[derive(Default, Clone)]
pub struct WsCredentials {
    pub token: Option<String>,
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
    pub fn set_creds(&self, token: Option<String>) {
        if let Ok(mut c) = self.creds.write() {
            c.token = token;
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
        // Для подключения достаточно ТОКЕНА ЛИЦЕНЗИИ — соло-воркер получает
        // события сервера (срезы карт/ассетов, share-ключи, отзыв лицензии).
        let token = {
            let c = creds.read().unwrap_or_else(|e| e.into_inner());
            match c.token.clone() {
                Some(t) if !t.is_empty() => t,
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
                // MGR-008 anti-replay: новые серверы первым фреймом шлют
                // {"type":"auth_challenge","nonce":...} — ждём его с таймаутом
                // и эхом возвращаем nonce в auth. Старые серверы челлендж не
                // шлют: по таймауту уходим в legacy-режим без nonce.
                let mut auth_nonce: Option<String> = None;
                {
                    use tungstenite::stream::MaybeTlsStream;
                    match socket.get_mut() {
                        MaybeTlsStream::Plain(tcp) => {
                            let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
                        }
                        MaybeTlsStream::NativeTls(tls) => {
                            let _ = tls.get_ref().set_read_timeout(Some(Duration::from_secs(5)));
                        }
                        _ => {}
                    }
                }
                if let Ok(Message::Text(text)) = socket.read() {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        if v["type"].as_str() == Some("auth_challenge") {
                            auth_nonce = v["nonce"].as_str().map(|s| s.to_string());
                        }
                    }
                }
                {
                    use tungstenite::stream::MaybeTlsStream;
                    match socket.get_mut() {
                        MaybeTlsStream::Plain(tcp) => {
                            let _ = tcp.set_read_timeout(None);
                        }
                        MaybeTlsStream::NativeTls(tls) => {
                            let _ = tls.get_ref().set_read_timeout(None);
                        }
                        _ => {}
                    }
                }
                let auth_msg = match &auth_nonce {
                    Some(n) => serde_json::json!({ "type": "auth", "token": token, "nonce": n }).to_string(),
                    None    => serde_json::json!({ "type": "auth", "token": token }).to_string(),
                };
                if socket.send(Message::Text(auth_msg)).is_err() {
                    std::thread::sleep(Duration::from_secs(RECONNECT_SECS));
                    continue;
                }

                let _ = app.emit("ws_sync:status", serde_json::json!({ "connected": true, "connecting": false }));

                // MGR-018 (этап E1): full_pull/full_data (групповой sync)
                // выпилены — пропущенные срезы воркер догоняет HTTP-забором
                // (slices fetch по тику фона и по ws-нотификациям).

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
                    // Токен сменился (re-login/logout) — переподключаемся.
                    let still_valid = {
                        let c = creds.read().unwrap_or_else(|e| e.into_inner());
                        c.token.as_deref() == Some(&token)
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
        // MGR-018: {"type":"cards_issued"} — менеджер выдал срезы этому воркеру.
        // Тянем их фоном (HTTP fetch + unseal + insert), не блокируя ws-читателя.
        "cards_issued" => {
            crate::commands::slices::fetch_on_ws_notify();
        }
        // MGR-018 (этап C): {"type":"assets_issued","kind":"proxy"|"email"} —
        // менеджер выдал срезы прокси/email. Тот же фоновый забор.
        "assets_issued" => {
            let kind = msg["kind"].as_str().unwrap_or("");
            crate::commands::slices::fetch_assets_on_ws_notify(kind);
        }
        // MGR-018 (этап D): {"type":"config_shared","kind":"stuffer"} —
        // появился/обновлён share-конверт. Забираем и применяем.
        "config_shared" => {
            crate::commands::slices::fetch_config_shares_on_ws_notify();
        }
        // REDESIGN-05-5B4: {"type":"chat_message"} — сервер принял sealed-
        // конверт для нас (routes/chat.js). Полезная нагрузка по WS не ездит:
        // забираем /sync/chat/messages, распечатываем, кладём в chat_messages
        // и эмитим chat:message фронту.
        "chat_message" => {
            crate::commands::chat::fetch_on_ws_notify(app.clone());
        }
        // {"type":"news","news":{...}} — менеджер опубликовал новость
        // (manager-api.js publish → broadcastAll). Тянем ленту в фоне,
        // NewsAlert покажет баннер при ближайшем опросе локального кэша.
        "news" => {
            crate::state::spawn_task(move || {
                // with_db! использует `?` — замыкание spawn_task возвращает (),
                // поэтому тело обёрнуто в Result-замыкание.
                let r: Result<serde_json::Value, String> = (|| {
                    with_db!(db, {
                        crate::commands::telemetry::fetch_and_store_news(db)
                            .map(|n| serde_json::json!({ "news": n }))
                    })
                })();
                if let Err(e) = r {
                    eprintln!("[ws_sync] news fetch failed: {e}");
                }
            });
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
        // {"type":"error"|"pong"} — молча игнорируем.
        "error" | "pong" => {}
        _ => {}
    }
}

// ─────────────────────────────────────────
//  DB writes (catalog upserts)
// ─────────────────────────────────────────

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

    // ── WsSyncHandle ──

    #[test]
    fn test_handle_stop_and_creds() {
        let handle = WsSyncHandle {
            running: Arc::new(AtomicBool::new(true)),
            creds: new_credentials(),
        };
        assert!(handle.is_running());
        handle.set_creds(Some("tok".into()));
        {
            let c = handle.creds.read().unwrap();
            assert_eq!(c.token.as_deref(), Some("tok"));
        }
        handle.stop();
        assert!(!handle.is_running());
    }

    #[test]
    fn test_credentials_default_empty() {
        let c = WsCredentials::default();
        assert!(c.token.is_none());
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
