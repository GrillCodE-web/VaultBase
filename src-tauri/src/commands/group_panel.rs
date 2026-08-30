//! REDESIGN-05-5B2: панель воркеров sync-группы.
//!
//! Сервер (cc-sync-server/routes/group-panel.js) отдаёт по моей группе:
//! presence (WS), last_seen (heartbeat), счётчики карт (адресные срезы + пул)
//! и самопубликованные агрегаты воркеров. Здесь — две стороны воркера:
//!
//!   group_workers         → GET  /sync/group/workers (панель, только чтение)
//!   publish_group_stats   → POST /sync/group/stats   (мои агрегаты — зовёт
//!                           фоновый cron в background.rs раз в 5 минут)
//!
//! Публикуем только агрегаты (счётчики/доля деклайнов), никакого контента
//! заказов/карт — E2E-граница доверия сохраняется.

use crate::database::Database;
use crate::state::{require_user, with_db};
use serde_json::{json, Value};

const HTTP_TIMEOUT_SECS: u64 = 30;
/// Каденс публикации статов (cron в background.rs), сек.
pub(crate) const GROUP_STATS_INTERVAL_SECS: u64 = 300;

// Копия auth_token из slices.rs — там он приватный, а файл сейчас чужая
// рабочая зона (MGR-018C). Держать в синхроне с оригиналом.
fn group_auth_token(db: &Database) -> Result<String, String> {
    db.get_config("license_token")
        .map_err(|e| e.to_string())?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "license_not_activated".to_string())
}

/// Агрегаты по локальной БД для публикации в группу. Чистая функция от БД —
/// покрыта тестами; сетевой слой тонкий.
pub(crate) fn compute_group_stats(db: &Database) -> Result<Value, String> {
    let q = |sql: &str| -> Result<i64, String> {
        db.conn
            .query_row(sql, [], |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    let orders_today = q("SELECT COUNT(*) FROM orders WHERE created_at >= datetime('now','start of day')")?;
    let orders_week = q("SELECT COUNT(*) FROM orders WHERE created_at >= datetime('now','-7 days')")?;
    let failed_week = q("SELECT COUNT(*) FROM orders WHERE status = 'failed' AND created_at >= datetime('now','-7 days')")?;
    let cards_free = q("SELECT COUNT(*) FROM credit_cards WHERE status = 'free'")?;
    let cards_in_use = q("SELECT COUNT(*) FROM credit_cards WHERE status = 'in_use'")?;
    let cards_dead = q("SELECT COUNT(*) FROM credit_cards WHERE status = 'dead'")?;

    let decline_rate_week = if orders_week > 0 {
        ((failed_week as f64 / orders_week as f64) * 1000.0).round() / 1000.0
    } else {
        0.0
    };

    Ok(json!({
        "orders_today": orders_today,
        "orders_week": orders_week,
        "failed_week": failed_week,
        "decline_rate_week": decline_rate_week,
        "cards_free": cards_free,
        "cards_in_use": cards_in_use,
        "cards_dead": cards_dead,
    }))
}

/// Публикация моих агрегатов на сервер. Молча пропускается без токена/группы
/// (409 no_sync_group) и при любой сетевой ошибке — телеметрия не должна
/// мешать работе; сбой фиксируется в activity_log.
pub(crate) fn publish_group_stats(db: &Database) -> Result<(), String> {
    let token = match group_auth_token(db) {
        Ok(t) => t,
        Err(_) => return Ok(()), // лицензия не активирована — нечего публиковать
    };
    let stats = compute_group_stats(db)?;
    let body = json!({ "stats": stats });
    let resp = ureq::post(&crate::endpoints::endpoint("/sync/group/stats"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .send_string(&body.to_string());
    match resp {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(409, _)) => Ok(()), // вне группы — легальное состояние
        Err(e) => {
            let _ = db.log_event("group.stats_failed", &e.to_string(), Some("sync"), None);
            Ok(()) // ошибки публикации не прерывают фоновый поток
        }
    }
}

/// Панель воркеров моей группы: presence, last_seen, счётчики карт, статы.
#[tauri::command]
pub(crate) fn group_workers() -> Result<Value, String> {
    require_user()?;
    with_db!(db, {
        if db.is_locked() {
            return Err("database_locked".to_string());
        }
        let token = group_auth_token(db)?;
        let resp = ureq::get(&crate::endpoints::endpoint("/sync/group/workers"))
            .set("Authorization", &format!("Bearer {token}"))
            .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
            .call()
            .map_err(|e| match e {
                ureq::Error::Status(code, r) => {
                    let detail = r
                        .into_json::<Value>()
                        .ok()
                        .and_then(|v| v.get("error").and_then(|x| x.as_str()).map(String::from))
                        .unwrap_or_else(|| format!("http_{code}"));
                    format!("group_workers: {detail}")
                }
                other => format!("group_workers: {other}"),
            })?;
        resp.into_json::<Value>().map_err(|e| format!("group_workers: parse: {e}"))
    })
}

#[cfg(test)]
mod group_panel_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("panel.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new(
            "panel_test_pw_1234567890",
            &salt,
        ));
        (dir, db)
    }

    #[test]
    fn compute_group_stats_aggregates_orders_and_cards() {
        let (_dir, db) = test_db();

        // Заказы: 2 сегодня (1 failed), 1 десятидневной давности (не считается).
        let now = db.conn
            .query_row("SELECT datetime('now')", [], |r| r.get::<_, String>(0))
            .unwrap();
        let old = db.conn
            .query_row("SELECT datetime('now', '-10 days')", [], |r| r.get::<_, String>(0))
            .unwrap();
        let ins = |status: &str, ts: &str| {
            db.conn
                .execute(
                    "INSERT INTO orders (order_number, status, created_at, updated_at) VALUES ('N1', ?1, ?2, ?2)",
                    rusqlite::params![status, ts],
                )
                .unwrap();
        };
        ins("delivered", &now);
        ins("failed", &now);
        ins("failed", &old);

        // Карты: free/in_use/dead (минимальный набор колонок).
        let ins_card = |pan: &str, status: &str| {
            use sha2::Digest;
            let hash = format!("{:x}", sha2::Sha256::digest(pan.as_bytes()));
            db.conn
                .execute(
                    "INSERT INTO credit_cards (card_number, expiry_date, cvv, status, card_hash) VALUES (?1, '01/30', '111', ?2, ?3)",
                    rusqlite::params![pan, status, hash],
                )
                .unwrap();
        };
        ins_card("4111111111111111", "free");
        ins_card("4111111111111112", "free");
        ins_card("4111111111111113", "in_use");
        ins_card("4111111111111114", "dead");

        let stats = compute_group_stats(&db).unwrap();
        assert_eq!(stats["orders_today"], 2);
        assert_eq!(stats["orders_week"], 2);
        assert_eq!(stats["failed_week"], 1);
        assert_eq!(stats["decline_rate_week"], 0.5);
        assert_eq!(stats["cards_free"], 2);
        assert_eq!(stats["cards_in_use"], 1);
        assert_eq!(stats["cards_dead"], 1);
    }

    #[test]
    fn compute_group_stats_empty_db_zeroes() {
        let (_dir, db) = test_db();
        let stats = compute_group_stats(&db).unwrap();
        assert_eq!(stats["orders_today"], 0);
        assert_eq!(stats["decline_rate_week"], 0.0);
    }

    #[test]
    fn publish_without_token_is_noop() {
        let (_dir, db) = test_db();
        // Нет license_token → Ok(()) без сети.
        publish_group_stats(&db).unwrap();
    }
}
