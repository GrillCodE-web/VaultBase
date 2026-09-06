//! Фоновый realtime-канал менеджера: сырой WS `/ws` (ws-tauri.js) + периодический
//! опрос чата как fallback.
//!
//! Зачем: у менеджера не было ни одного пуш-канала — чат и панель обновлялись
//! только ручными запросами. Сервер принимает manager-лицензии на /ws (см.
//! ws-tauri.js: роль manager получает группу null, карточный sync ей закрыт,
//! работают адресные notify: chat_message).
//!
//! Протокол совпадает с воркерским (src-tauri/src/ws_sync.rs): сервер первым
//! фреймом шлёт {"type":"auth_challenge","nonce":...}, клиент эхом возвращает
//! nonce в auth. Legacy без челленджа тоже поддержан (таймаут 5с → auth без nonce).

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tungstenite::{connect, Message};

use crate::state::{AppState, DbState};

const RECONNECT_SECS: u64 = 5;
const RECONNECT_MAX_SECS: u64 = 300;
const NO_LICENSE_WAIT_SECS: u64 = 15;
const PING_INTERVAL_SECS: u64 = 25;
const MAX_MISSED_PINGS: u32 = 2;
const CHAT_POLL_INTERVAL_SECS: u64 = 60;

static WS_CONNECTED: AtomicBool = AtomicBool::new(false);

/// Токен + база сервера из открытой БД; None — приложение заперто/без лицензии.
fn creds(app: &AppHandle) -> Option<(String, String)> {
    let state = app.state::<AppState>();
    let guard = state.db.lock().ok()?;
    match &*guard {
        DbState::Open { db, .. } => {
            let token = db.get_config("license_token").filter(|t| !t.is_empty())?;
            Some((token, crate::http::server_base(db)))
        }
        DbState::Closed => None,
    }
}

fn ws_url_from(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    if let Some(rest) = b.strip_prefix("https://") {
        format!("wss://{rest}/ws")
    } else if let Some(rest) = b.strip_prefix("http://") {
        format!("ws://{rest}/ws")
    } else {
        format!("wss://{b}/ws")
    }
}

pub fn start(app: AppHandle) {
    let ws_app = app.clone();
    std::thread::spawn(move || ws_loop(ws_app));
    std::thread::spawn(move || chat_poll_loop(app));
}

/// Fallback-опрос: раз в минуту забирает чат, даже если WS жив (дёшево:
/// ?since_id= возвращает пусто, дедуп по server_id). Гарантирует автосинк
/// при мёртвом/пропускающем события WS.
fn chat_poll_loop(app: AppHandle) {
    loop {
        std::thread::sleep(Duration::from_secs(CHAT_POLL_INTERVAL_SECS));
        let state = app.state::<AppState>();
        if let Err(e) = crate::chat::fetch_and_emit(&app, &state) {
            // locked/no_token — штатные состояния до разблокировки; не шумим.
            if e != "locked" && e != "no_token" {
                eprintln!("[ws] chat poll failed: {e}");
            }
        }
    }
}

fn ws_loop(app: AppHandle) {
    let mut backoff = RECONNECT_SECS;
    loop {
        let (token, base) = match creds(&app) {
            Some(c) => c,
            None => {
                set_connected(&app, false);
                std::thread::sleep(Duration::from_secs(NO_LICENSE_WAIT_SECS));
                continue;
            }
        };

        let _ = app.emit(
            "ws:status",
            json!({ "connected": false, "connecting": true }),
        );

        match connect_and_run(&app, &token, &ws_url_from(&base)) {
            Ok(()) => {
                backoff = RECONNECT_SECS;
            }
            Err(e) => {
                eprintln!("[ws] connection ended: {e}");
            }
        }
        set_connected(&app, false);
        std::thread::sleep(Duration::from_secs(backoff));
        backoff = (backoff * 2).min(RECONNECT_MAX_SECS);
    }
}

fn set_connected(app: &AppHandle, connected: bool) {
    WS_CONNECTED.store(connected, Ordering::Relaxed);
    let _ = app.emit(
        "ws:status",
        json!({ "connected": connected, "connecting": false }),
    );
}

/// Публичный флаг для возможной диагностики из команд.
#[allow(dead_code)]
pub fn is_connected() -> bool {
    WS_CONNECTED.load(Ordering::Relaxed)
}

fn connect_and_run(app: &AppHandle, token: &str, url: &str) -> Result<(), String> {
    let (mut socket, _) = connect(url).map_err(|e| format!("connect: {e}"))?;

    // Auth: ждём auth_challenge до 5с; по таймауту — legacy auth без nonce.
    let mut auth_nonce: Option<String> = None;
    {
        use tungstenite::stream::MaybeTlsStream;
        match socket.get_mut() {
            MaybeTlsStream::Plain(tcp) => {
                let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
            }
            MaybeTlsStream::NativeTls(tls) => {
                let _ = tls.get_mut().set_read_timeout(Some(Duration::from_secs(5)));
            }
            _ => {}
        }
    }
    match socket.read() {
        Ok(Message::Text(raw)) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if v.get("type").and_then(|t| t.as_str()) == Some("auth_challenge") {
                    auth_nonce = v
                        .get("nonce")
                        .and_then(|n| n.as_str())
                        .map(str::to_string);
                }
            }
        }
        Err(tungstenite::Error::Io(ref e))
            if e.kind() == io::ErrorKind::WouldBlock || e.kind() == io::ErrorKind::TimedOut => {}
        Err(e) => return Err(format!("challenge_read: {e}")),
        _ => {}
    }
    {
        use tungstenite::stream::MaybeTlsStream;
        match socket.get_mut() {
            MaybeTlsStream::Plain(tcp) => {
                let _ = tcp.set_read_timeout(None);
            }
            MaybeTlsStream::NativeTls(tls) => {
                let _ = tls.get_mut().set_read_timeout(None);
            }
            _ => {}
        }
    }

    let mut auth_msg = json!({ "type": "auth", "token": token });
    if let Some(n) = auth_nonce {
        auth_msg["nonce"] = json!(n);
    }
    socket
        .send(Message::Text(auth_msg.to_string()))
        .map_err(|e| format!("auth_send: {e}"))?;

    let mut last_ping = Instant::now();
    let mut missed_pings: u32 = 0;

    loop {
        if last_ping.elapsed() >= Duration::from_secs(PING_INTERVAL_SECS) {
            socket
                .send(Message::Text(json!({"type":"ping"}).to_string()))
                .map_err(|e| format!("ping: {e}"))?;
            last_ping = Instant::now();
            missed_pings += 1;
            if missed_pings > MAX_MISSED_PINGS {
                return Err("ping_timeout".into());
            }
        }

        let msg = match socket.read() {
            Ok(m) => m,
            Err(e) => return Err(format!("read: {e}")),
        };

        match msg {
            Message::Text(raw) => {
                let v: serde_json::Value = match serde_json::from_str(&raw) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                match v.get("type").and_then(|t| t.as_str()) {
                    Some("auth_ok") => {
                        missed_pings = 0;
                        set_connected(app, true);
                        let _ = app.emit("server_online", ());
                        // Мгновенно дотягиваем всё, что накопилось офлайн.
                        let state = app.state::<AppState>();
                        let _ = crate::chat::fetch_and_emit(app, &state);
                    }
                    Some("pong") => {
                        missed_pings = 0;
                    }
                    Some("chat_message") => {
                        let state = app.state::<AppState>();
                        if let Err(e) = crate::chat::fetch_and_emit(app, &state) {
                            eprintln!("[ws] chat fetch on notify failed: {e}");
                        }
                    }
                    Some("news") => {
                        // Менеджер опубликовал новость (server broadcastAll).
                        // Фронту — событие: страница/Shell перечитают список.
                        let _ = app.emit("news:published", v.get("news").cloned().unwrap_or(json!(null)));
                    }
                    Some("auth_error") => {
                        let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("");
                        if err == "invalid_token" {
                            let _ = app.emit("license_revoked", ());
                        }
                        return Err(format!("auth_error: {err}"));
                    }
                    _ => {}
                }
            }
            Message::Ping(p) => {
                let _ = socket.send(Message::Pong(p));
            }
            Message::Close(_) => return Err("closed".into()),
            _ => {}
        }
    }
}
