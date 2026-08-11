//! Единая точка, откуда берутся адреса sync-сервера.
//!
//! До этого модуля базовый URL был вшит в семь мест в пяти файлах
//! (`license.rs`, `sync.rs`, `ws_sync.rs`, `main.rs`, `database/_cards.rs`), и
//! переопределить можно было только WebSocket. Сменить домен без пересборки было
//! нельзя — а деплой-скрипты (`deploy_full.py`, `deploy_ssl.py`) поднимают
//! совсем другой хост, чем тот, в который стучится клиент.
//!
//! Теперь домен задаётся один раз:
//!
//! * `VAULTBASE_SERVER_URL` — база для HTTP (`https://host`, без слеша в конце);
//! * `VAULTBASE_SYNC_WS_URL` — полный WebSocket-URL, если он не выводится из базы.
//!
//! Значения читаются один раз за процесс: перечитывать их на каждый вызов
//! незачем, а `OnceLock` заодно исключает гонку при обращении из потоков
//! IMAP-проверки и WS-цикла.

use std::sync::OnceLock;

/// Значение по умолчанию — боевой sync-сервер.
///
/// Прежний адрес `api.eulivehub.com` был вшит в семь мест и на 2026-08-07
/// **не резолвится вообще** (NXDOMAIN) — собранный с ним клиент не смог бы ни
/// активироваться, ни синхронизироваться. Проверено: на sec201-www живой Node
/// (`/version` → JSON, `/activate` → `missing_fields`, `/sync/cards` → 401).
/// Домен `pub-www.otpmanager.pro` — это статика/лендинг, API там нет.
// FIX CRITICAL: Use constant instead of hardcoded URL
const DEFAULT_SERVER_URL: &str = crate::constants::DEFAULT_SERVER_URL;

static SERVER_BASE: OnceLock<String> = OnceLock::new();
static WS_URL: OnceLock<String> = OnceLock::new();

fn get_server_base() -> String {
    std::env::var("VAULTBASE_SERVER_URL")
        .unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string())
        .trim().trim_end_matches('/').to_string()
}

/// База HTTP-API без завершающего слеша, например `https://api.example.com`.
pub fn server_base() -> String {
    get_server_base()
}

/// Собрать абсолютный URL: `endpoint("/verify")` → `https://host/verify`.
pub fn endpoint(path: &str) -> String {
    if path.starts_with('/') {
        format!("{}{}", server_base(), path)
    } else {
        format!("{}/{}", server_base(), path)
    }
}

/// URL сырого WebSocket-сервера `/ws` (ws-tauri.js). Если
/// `VAULTBASE_SYNC_WS_URL` не задан, выводится из базы:
/// `https://` → `wss://`, `http://` → `ws://`.
///
/// Именно `/ws`, а НЕ `/socket.io/`: клиент использует голый tungstenite,
/// а socket.io v4 требует engine.io handshake (polling → sid → upgrade),
/// которого tungstenite не делает — сервер отвечал 400 и WS не подключался.
/// Сервер поднимает оба (`/ws` и `/socket.io/`); сырой `/ws` — простой
/// JSON-протокол без рукопожатия.
pub fn ws_url() -> &'static str {
    WS_URL.get_or_init(|| {
        if let Ok(explicit) = std::env::var("VAULTBASE_SYNC_WS_URL") {
            let t = explicit.trim().to_string();
            if !t.is_empty() { return t; }
        }
        let base = server_base();
        let ws_base = if let Some(rest) = base.strip_prefix("https://") {
            format!("wss://{}", rest)
        } else if let Some(rest) = base.strip_prefix("http://") {
            format!("ws://{}", rest)
        } else {
            format!("wss://{}", base)
        };
        format!("{}/ws", ws_base)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_joins_with_single_slash() {
        // Не зависит от переменных окружения: проверяем только склейку.
        let base = server_base();
        assert!(!base.ends_with('/'), "база не должна оканчиваться слешем");
        assert_eq!(endpoint("/verify"), format!("{}/verify", base));
        assert_eq!(endpoint("verify"), format!("{}/verify", base));
    }

    #[test]
    fn ws_url_is_websocket_scheme() {
        let u = ws_url();
        assert!(u.starts_with("wss://") || u.starts_with("ws://"), "got {u}");
        assert!(u.ends_with("/ws"), "got {u}");
    }
}
