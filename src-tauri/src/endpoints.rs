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
const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";

static SERVER_BASE: OnceLock<String> = OnceLock::new();
static WS_URL: OnceLock<String> = OnceLock::new();

/// База HTTP-API без завершающего слеша, например `https://api.example.com`.
pub fn server_base() -> &'static str {
    SERVER_BASE.get_or_init(|| {
        let raw = std::env::var("VAULTBASE_SERVER_URL")
            .unwrap_or_else(|_| DEFAULT_SERVER_URL.to_string());
        let trimmed = raw.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() { DEFAULT_SERVER_URL.to_string() } else { trimmed }
    })
}

/// Собрать абсолютный URL: `endpoint("/verify")` → `https://host/verify`.
pub fn endpoint(path: &str) -> String {
    if path.starts_with('/') {
        format!("{}{}", server_base(), path)
    } else {
        format!("{}/{}", server_base(), path)
    }
}

/// URL socket.io. Если `VAULTBASE_SYNC_WS_URL` не задан, выводится из базы:
/// `https://` → `wss://`, `http://` → `ws://`.
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
        format!("{}/socket.io/?EIO=4&transport=websocket", ws_base)
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
        assert!(u.contains("/socket.io/"), "got {u}");
    }
}
