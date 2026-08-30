// MGR-004: телеметрия воркера менеджер-приложению запечатанными конвертами.
// Контракт: docs/MANAGER_APP.md §2.2/§4/§5 и сервер cc-sync-server/routes/telemetry.js.
//
// Схема (sealed box): эфемерный X25519 (e,E) → shared = X25519(e,B) →
// key = HKDF-SHA256(ikm=shared, salt=B||E, info=b"vb-mgr-telemetry-v1", 32) →
// AES-256-GCM(key, nonce=12 случайных байт, payload UTF8-JSON).
// Конверт: {"key_id": int, "ephemeral": hex(E), "nonce": hex(12), "ct": base64}.
// Сервер видит только форму конверта — plaintext не покидает воркер.

use crate::state::*;
use crate::database::Database;
use rusqlite::params;
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, Payload, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

const HKDF_INFO: &[u8] = b"vb-mgr-telemetry-v1";

// ── Запечатанный конверт ─────────────────────────────────────────

/// Форма совпадает с валидатором сервера (routes/telemetry.js):
/// key_id int, ephemeral hex{64}, nonce hex{24}, ct base64.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEnvelope {
    pub key_id: i64,
    pub ephemeral: String,
    pub nonce: String,
    pub ct: String,
}

/// Публичный менеджерский ключ из `GET /api/telemetry/keys`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryManagerKey {
    pub id: i64,
    pub pubkey: String,
    pub key_type: Option<String>,
    pub label: Option<String>,
}

fn derive_key(shared: &[u8; 32], b: &[u8; 32], e: &[u8; 32]) -> Result<[u8; 32], String> {
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(b);
    salt[32..].copy_from_slice(e);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm).map_err(|e| e.to_string())?;
    Ok(okm)
}

/// Запечатать `plaintext` для получателя с публичным ключом `pub_hex`
/// (32 байта X25519, hex). Эфемерная пара генерируется на каждый вызов.
pub(crate) fn seal_envelope(
    key_id: i64,
    pub_hex: &str,
    plaintext: &str,
) -> Result<TelemetryEnvelope, String> {
    let b_bytes = hex::decode(pub_hex.trim())
        .map_err(|e| format!("bad_pubkey_hex: {}", e))?;
    if b_bytes.len() != 32 {
        return Err(format!("bad_pubkey_len: {}", b_bytes.len()));
    }
    let b = PublicKey::from(<[u8; 32]>::try_from(b_bytes.as_slice()).unwrap());

    let e = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
    let e_pub = PublicKey::from(&e);
    let shared = e.diffie_hellman(&b);

    let key = derive_key(shared.as_bytes(), b.as_bytes(), e_pub.as_bytes())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext.as_bytes(), aad: &[] })
        .map_err(|e| format!("aes_gcm_encrypt: {}", e))?;

    Ok(TelemetryEnvelope {
        key_id,
        ephemeral: hex::encode(e_pub.as_bytes()),
        nonce: hex::encode(nonce),
        ct: {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(ct)
        },
    })
}

/// Распечатать конверт приватным ключом получателя `priv_hex` (32 байта, hex).
/// Воркеру для отправки не нужен (только seal), но это обратная сторона
/// того же контракта: roundtrip-тесты и отладка локальной расшифровкой.
#[cfg(test)]
pub(crate) fn unseal_envelope(priv_hex: &str, env: &TelemetryEnvelope) -> Result<String, String> {
    let b_secret_bytes = hex::decode(priv_hex.trim())
        .map_err(|e| format!("bad_privkey_hex: {}", e))?;
    if b_secret_bytes.len() != 32 {
        return Err(format!("bad_privkey_len: {}", b_secret_bytes.len()));
    }
    let b_secret = StaticSecret::from(<[u8; 32]>::try_from(b_secret_bytes.as_slice()).unwrap());
    let b_pub = PublicKey::from(&b_secret);

    let e_bytes = hex::decode(&env.ephemeral).map_err(|e| format!("bad_ephemeral: {}", e))?;
    if e_bytes.len() != 32 {
        return Err(format!("bad_ephemeral_len: {}", e_bytes.len()));
    }
    let e_pub = PublicKey::from(<[u8; 32]>::try_from(e_bytes.as_slice()).unwrap());

    let shared = b_secret.diffie_hellman(&e_pub);
    let key = derive_key(shared.as_bytes(), b_pub.as_bytes(), e_pub.as_bytes())?;

    let nonce_bytes = hex::decode(&env.nonce).map_err(|e| format!("bad_nonce: {}", e))?;
    let ct = {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&env.ct)
            .map_err(|e| format!("bad_ct: {}", e))?
    };
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: &ct, aad: &[] })
        .map_err(|_| "aes_gcm_decrypt_failed".to_string())?;
    String::from_utf8(pt).map_err(|e| format!("bad_utf8: {}", e))
}

// ── Heartbeat payload (§2.2) ──────────────────────────────────────

/// `"ok" | "down"` — по свежести успешных sync-событий в activity_log
/// (успешное событие за последние 15 минут = connectivity жив).
/// WS-статус живёт в событиях фронтенда (`ws_sync:status`), из БД недоступен —
/// приближение, уточняется в MGR-005.
fn sync_ws_state(db: &Database) -> &'static str {
    let n: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'sync.%' \
         AND event_type NOT LIKE '%fail%' AND event_type NOT LIKE '%error%' \
         AND event_type NOT LIKE '%reject%' \
         AND created_at > datetime('now', '-15 minutes')",
        [], |r| r.get(0),
    ).unwrap_or(0);
    if n > 0 { "ok" } else { "down" }
}

/// `true | false | null`: есть активные аккаунты → true, если хотя бы у
/// одного успешная проверка за 24 ч; нет аккаунтов → null (нет данных).
fn imap_health(db: &Database) -> Option<bool> {
    let total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM imap_accounts WHERE is_active = 1", [], |r| r.get(0),
    ).unwrap_or(0);
    if total == 0 { return None; }
    let ok: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM imap_accounts \
         WHERE is_active = 1 AND last_ok IS NOT NULL AND last_ok > datetime('now', '-1 day')",
        [], |r| r.get(0),
    ).unwrap_or(0);
    Some(ok > 0)
}

/// Аналогично прокси: есть → не все заблокированы; нет → null.
fn proxy_health(db: &Database) -> Option<bool> {
    let total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies", [], |r| r.get(0),
    ).unwrap_or(0);
    if total == 0 { return None; }
    let alive: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies WHERE is_blocked = 0", [], |r| r.get(0),
    ).unwrap_or(0);
    Some(alive > 0)
}

fn count_recent_errors(db: &Database) -> i64 {
    db.conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE created_at > datetime('now', '-1 day') \
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%reject%')",
        [], |r| r.get(0),
    ).unwrap_or(0)
}

/// MGR-015: тот же счётчик ошибок, но по категориям — менеджер видит, ЧТО
/// у воркера болит (imap/sync/proxy/order/smtp), а не только факт боли.
/// Классификация по префиксу event_type; неизвестное — в `other`.
fn errors_by_category(db: &Database) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for k in ["imap", "smtp", "proxy", "sync", "order", "other"] {
        out.insert(k.to_string(), serde_json::json!(0));
    }
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT event_type FROM activity_log WHERE created_at > datetime('now', '-1 day') \
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%reject%')",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            for et in rows.flatten() {
                let bucket = if et.starts_with("imap.") { "imap" }
                    else if et.starts_with("smtp.") { "smtp" }
                    else if et.starts_with("proxy.") { "proxy" }
                    else if et.starts_with("sync.") || et.starts_with("ws_sync.") { "sync" }
                    else if et.starts_with("order.") || et.starts_with("shop.") { "order" }
                    else { "other" };
                let n = out.get(bucket).and_then(|v| v.as_i64()).unwrap_or(0);
                out.insert(bucket.to_string(), serde_json::json!(n + 1));
            }
        }
    }
    out
}

/// MGR-015: реальный smtp-сигнал вместо null-заглушки.
/// Нет активных конфигов → null (нет данных). Успешная отправка за 24 ч
/// (sent_emails) → true; иначе TCP-проба SMTP-хоста (2 с, без аутентификации).
fn smtp_health(db: &Database) -> Option<bool> {
    let total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM smtp_configs WHERE is_active = 1", [], |r| r.get(0),
    ).unwrap_or(0);
    if total == 0 { return None; }
    let recent_ok: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM sent_emails WHERE sent_at > datetime('now', '-1 day')",
        [], |r| r.get(0),
    ).unwrap_or(0);
    if recent_ok > 0 { return Some(true); }
    let (host, port): (String, u16) = db.conn.query_row(
        "SELECT host, port FROM smtp_configs WHERE is_active = 1 ORDER BY id LIMIT 1",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).ok()?;
    Some(smtp_tcp_ok(&host, port))
}

/// TCP-проба SMTP-хоста: коннект без авторизации, 2 секунды.
fn smtp_tcp_ok(host: &str, port: u16) -> bool {
    use std::net::ToSocketAddrs;
    match format!("{}:{}", host, port).to_socket_addrs() {
        Ok(mut addrs) => addrs.any(|addr| {
            std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)).is_ok()
        }),
        Err(_) => false,
    }
}

/// Payload heartbeat из §2.2 (в конверте; plaintext указан в MANAGER_APP.md).
/// MGR-015: payload_version + worker_sent_at — защита от молчаливой порчи
/// статики при эволюции схемы и от расхождений часов (сервер допишет received).
pub(crate) fn build_heartbeat_payload(db: &Database) -> serde_json::Value {
    serde_json::json!({
        "payload_version": 2,
        "worker_sent_at": chrono::Utc::now().to_rfc3339(),
        "tz_offset_min": chrono::Local::now().offset().local_minus_utc() / 60,
        "ts": chrono::Utc::now().to_rfc3339(),
        "app_version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "sync_ws": sync_ws_state(db),
        "db_ok": !db.is_locked(),
        "imap_ok": imap_health(db),
        "smtp_ok": smtp_health(db),
        "proxy_ok": proxy_health(db),
        "errors_24h": count_recent_errors(db),
        "errors_by": errors_by_category(db),
    })
}

// ── daily_stats за дату (§4) ──────────────────────────────────────

fn scalar_i64(db: &Database, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    db.conn.query_row(sql, params, |r| r.get(0)).unwrap_or(0)
}

/// MGR-015: снимок состава пула карт на текущий момент (не за дату):
/// статусы, топ-10 BIN, страны, возрастные корзины по COALESCE(acquired_at,
/// created_at). Даёт менеджеру прогноз выгорания пула, а не только общий итог.
fn build_pool_snapshot(db: &Database) -> serde_json::Value {
    let mut counts = |sql: &str| -> serde_json::Map<String, serde_json::Value> {
        let mut m = serde_json::Map::new();
        if let Ok(mut stmt) = db.conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            }) {
                for (k, n) in rows.flatten() {
                    m.insert(k, serde_json::json!(n));
                }
            }
        }
        m
    };
    let by_status = counts("SELECT status, COUNT(*) FROM credit_cards GROUP BY status ORDER BY 2 DESC");
    let by_bin_top = counts(
        "SELECT COALESCE(bin, '?') AS b, COUNT(*) FROM credit_cards GROUP BY 1 ORDER BY 2 DESC LIMIT 10");
    let by_country = counts(
        "SELECT COALESCE(country, '?') AS c, COUNT(*) FROM credit_cards GROUP BY 1 ORDER BY 2 DESC LIMIT 15");

    let age_count = |cond: &str| -> i64 {
        let sql = format!(
            "SELECT COUNT(*) FROM credit_cards \
             WHERE COALESCE(acquired_at, created_at) IS NOT NULL \
             AND julianday('now') - julianday(COALESCE(acquired_at, created_at)) {}",
            cond);
        db.conn.query_row(&sql, [], |r| r.get(0)).unwrap_or(0)
    };
    let age_lt30 = age_count("BETWEEN 0 AND 30");
    let age_mid = age_count("BETWEEN 30 AND 60");
    let age_gt60 = age_count("> 60");
    let age_unknown = scalar_i64(db,
        "SELECT COUNT(*) FROM credit_cards WHERE COALESCE(acquired_at, created_at) IS NULL", &[]);

    let proxy_total: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies", [], |r| r.get(0)).unwrap_or(0);
    let proxy_blocked: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM proxies WHERE is_blocked = 1", [], |r| r.get(0)).unwrap_or(0);

    serde_json::json!({
        "taken_at": chrono::Utc::now().to_rfc3339(),
        "by_status": by_status,
        "by_bin_top": by_bin_top,
        "by_country": by_country,
        "age": { "lt30": age_lt30, "d30_60": age_mid, "gt60": age_gt60, "unknown": age_unknown },
        "proxy_blocked": proxy_blocked,
        "proxy_total": proxy_total,
    })
}

/// MGR-015: per-оператор сплит дня — кто оформил (orders.created_by, миграция
/// v21) и сколько карт взял (card_assignments). Ключ — username; заказы без
/// автора (системные флоу) уходят в "unknown".
fn build_by_user(db: &Database, date: &str) -> serde_json::Map<String, serde_json::Value> {
    let mut by_user: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut ensure = |map: &mut serde_json::Map<String, serde_json::Value>, name: &str| {
        map.entry(name.to_string()).or_insert_with(|| serde_json::json!({
            "orders": 0, "delivered": 0, "declined": 0, "revenue": 0.0, "cards_taken": 0
        }));
    };
    // заказы по авторам (created_by — миграция v21)
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT COALESCE(u.username, 'unknown'), COUNT(*), \
                COALESCE(SUM(CASE WHEN o.status='delivered' THEN 1 END), 0), \
                COALESCE(SUM(CASE WHEN o.status='declined' THEN 1 END), 0), \
                COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total_amount END), 0.0) \
         FROM orders o LEFT JOIN users u ON u.id = o.created_by \
         WHERE DATE(o.created_at, 'localtime') = ?1 GROUP BY 1",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?, r.get::<_, f64>(4)?))
        }) {
            for (name, orders, delivered, declined, revenue) in rows.flatten() {
                ensure(&mut by_user, &name);
                let obj = by_user.get_mut(&name).unwrap().as_object_mut().unwrap();
                obj.insert("orders".into(), serde_json::json!(orders));
                obj.insert("delivered".into(), serde_json::json!(delivered));
                obj.insert("declined".into(), serde_json::json!(declined));
                obj.insert("revenue".into(), serde_json::json!(revenue));
            }
        }
    }
    // взятые карты по юзерам
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT COALESCE(u.username, 'unknown'), COUNT(*) \
         FROM card_assignments ca LEFT JOIN users u ON u.id = ca.user_id \
         WHERE DATE(ca.assigned_at, 'localtime') = ?1 GROUP BY 1",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }) {
            for (name, taken) in rows.flatten() {
                ensure(&mut by_user, &name);
                let obj = by_user.get_mut(&name).unwrap().as_object_mut().unwrap();
                obj.insert("cards_taken".into(), serde_json::json!(taken));
            }
        }
    }
    by_user
}

/// Собрать daily_stats за `date` ("YYYY-MM-DD", локальная дата).
/// created_at в БД — UTC, поэтому сравнение через `'localtime'`.
pub(crate) fn build_daily_stats(db: &Database, date: &str) -> serde_json::Value {
    let mut orders_by_status = serde_json::Map::new();
    let mut total_orders = 0i64;
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT status, COUNT(*) FROM orders \
         WHERE DATE(created_at, 'localtime') = ?1 GROUP BY status",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }) {
            for row in rows.flatten() {
                total_orders += row.1;
                orders_by_status.insert(row.0, row.1.into());
            }
        }
    }

    let cards_taken = scalar_i64(db,
        "SELECT COUNT(*) FROM card_assignments WHERE DATE(assigned_at, 'localtime') = ?1",
        &[&date]);
    let mut cards_used = 0i64;
    let mut cards_dead = 0i64;
    let mut by_bin: std::collections::BTreeMap<String, (i64, i64)> =
        std::collections::BTreeMap::new();
    // MGR-014/015: статусы карт берём из структурной таблицы card_status_events;
    // для дней ДО миграции v21 — старый парсинг activity_log (формат
    // "Card {id} status → {status}", commands/cards.rs). Источники
    // объединяются с дедупом по (card_id, status): с v21 каждая смена пишется
    // в ОБА источника — без дедупа счётчики задваивались бы.
    let mut seen: std::collections::HashSet<(i64, String)> = std::collections::HashSet::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT e.card_id, e.to_status FROM card_status_events e \
         WHERE DATE(e.created_at, 'localtime') = ?1",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        }) {
            for (card_id, status) in rows.flatten() {
                let bin: Option<String> = db.conn.query_row(
                    "SELECT bin FROM credit_cards WHERE id = ?1", params![card_id],
                    |r| r.get(0),
                ).ok().flatten();
                let entry = by_bin.entry(bin.unwrap_or_else(|| "?".into())).or_insert((0, 0));
                match status.as_str() {
                    "in_use" => { cards_used += 1; entry.0 += 1; }
                    "dead"   => { cards_dead += 1; entry.1 += 1; }
                    _ => {}
                }
                seen.insert((card_id, status));
            }
        }
    }
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT l.description, l.entity_id FROM activity_log l \
         WHERE l.event_type = 'card.status_changed' AND DATE(l.created_at, 'localtime') = ?1",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for (desc, entity_id) in rows.flatten() {
                // формат: "Card {id} status → {status}" (commands/cards.rs)
                let status = desc
                    .as_deref()
                    .and_then(|d| d.rsplit('→').next())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                let card_id: Option<i64> = entity_id
                    .as_deref()
                    .and_then(|id| id.parse::<i64>().ok());
                if card_id.map(|c| seen.contains(&(c, status.clone()))).unwrap_or(false) {
                    continue; // уже посчитано из card_status_events
                }
                let bin: Option<String> = entity_id
                    .as_deref()
                    .and_then(|id| id.parse::<i64>().ok())
                    .and_then(|id| db.conn.query_row(
                        "SELECT bin FROM credit_cards WHERE id = ?1", params![id],
                        |r| r.get(0),
                    ).ok().flatten());
                let entry = by_bin.entry(bin.unwrap_or_else(|| "?".into())).or_insert((0, 0));
                match status.as_str() {
                    "in_use" => { cards_used += 1; entry.0 += 1; }
                    "dead"   => { cards_dead += 1; entry.1 += 1; }
                    _ => {}
                }
            }
        }
    }

    let drops_taken = scalar_i64(db,
        "SELECT COUNT(*) FROM drops WHERE DATE(created_at, 'localtime') = ?1",
        &[&date]);
    let mut drops_by_destination = serde_json::Map::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT s.domain, COUNT(DISTINCT d.id) FROM drops d \
         JOIN orders o ON o.profile_id = d.profile_id \
         JOIN shops s ON s.id = o.shop_id \
         WHERE DATE(d.created_at, 'localtime') = ?1 GROUP BY s.domain",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }) {
            for row in rows.flatten() {
                drops_by_destination.insert(row.0, row.1.into());
            }
        }
    }

    let mut shops = serde_json::Map::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT s.domain, COUNT(*), \
                SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END), \
                SUM(CASE WHEN o.status = 'declined' THEN 1 ELSE 0 END), \
                SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END), \
                COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN o.total_amount END), 0.0) \
         FROM orders o JOIN shops s ON s.id = o.shop_id \
         WHERE DATE(o.created_at, 'localtime') = ?1 GROUP BY s.domain",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok(serde_json::json!({
                "domain": r.get::<_, String>(0)?, "orders": r.get::<_, i64>(1)?,
                "delivered": r.get::<_, i64>(2)?, "declined": r.get::<_, i64>(3)?,
                "cancelled": r.get::<_, i64>(4)?, "revenue": r.get::<_, f64>(5)?,
            }))
        }) {
            for row in rows.flatten() {
                if let Some(d) = row.get("domain").and_then(|v| v.as_str()) {
                    shops.insert(d.to_string(), row.clone());
                }
            }
        }
    }

    let (imap_ok, imap_fail) = (
        scalar_i64(db,
            "SELECT COUNT(*) FROM activity_log WHERE event_type = 'imap.poll_completed' \
             AND DATE(created_at, 'localtime') = ?1", &[&date]),
        scalar_i64(db,
            "SELECT COUNT(*) FROM activity_log \
             WHERE event_type IN ('imap.poll_error', 'imap.check_error') \
             AND DATE(created_at, 'localtime') = ?1", &[&date]),
    );
    let ws_ok = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'sync.%' \
         AND event_type NOT LIKE '%fail%' AND event_type NOT LIKE '%error%' \
         AND event_type NOT LIKE '%reject%' AND DATE(created_at, 'localtime') = ?1",
        &[&date]) > 0;
    let push_fail = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type = 'sync.push_rejected' \
         AND DATE(created_at, 'localtime') = ?1", &[&date]);

    // MGR-015: реальные daily-сигналы smtp/proxy вместо нулей-заглушек.
    // smtp_ok = успешные отправки за дату (sent_emails); smtp_fail/proxy_fail =
    // ошибки из activity_log по префиксам; proxy_ok-событий воркер пока не
    // пишет, состояние прокси уходит снимком пула (pool.proxy_blocked/total).
    let smtp_ok_n = scalar_i64(db,
        "SELECT COUNT(*) FROM sent_emails WHERE DATE(sent_at, 'localtime') = ?1",
        &[&date]);
    let smtp_fail_n = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'smtp.%' \
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%reject%') \
         AND DATE(created_at, 'localtime') = ?1", &[&date]);
    let proxy_fail_n = scalar_i64(db,
        "SELECT COUNT(*) FROM activity_log WHERE event_type LIKE 'proxy.%' \
         AND (event_type LIKE '%error%' OR event_type LIKE '%fail%' OR event_type LIKE '%reject%') \
         AND DATE(created_at, 'localtime') = ?1", &[&date]);

    // MGR-022: флотовая теплокарта BIN×шоп — топ-50 пар за дату (менеджер
    // агрегирует по флоту; у одиночного воркера пары слишком редкие).
    let mut bin_shop: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = db.conn.prepare(
        "SELECT COALESCE(cc.bin, '?'), s.domain, COUNT(*), \
                SUM(CASE WHEN o.status IN ('shipped','delivered') THEN 1 ELSE 0 END), \
                SUM(CASE WHEN o.status = 'declined' THEN 1 ELSE 0 END) \
         FROM orders o JOIN profiles pr ON pr.id = o.profile_id \
         JOIN credit_cards cc ON cc.id = pr.card_id \
         JOIN shops s ON s.id = o.shop_id \
         WHERE DATE(o.created_at, 'localtime') = ?1 \
         GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 50",
    ) {
        if let Ok(rows) = stmt.query_map(params![date], |r| {
            Ok(serde_json::json!({
                "bin": r.get::<_, String>(0)?, "shop": r.get::<_, String>(1)?,
                "orders": r.get::<_, i64>(2)?, "ok": r.get::<_, i64>(3)?,
                "declined": r.get::<_, i64>(4)?,
            }))
        }) {
            bin_shop = rows.flatten().collect();
        }
    }

    // MGR-022: SLA-блок — скользящие 7 дней (get_sla_stats, order_status_history).
    // Ошибка не роняет телеметрию: блок просто отсутствует.
    let sla = db.get_sla_stats("7d", None, None)
        .ok()
        .and_then(|s| serde_json::to_value(s).ok())
        .unwrap_or(serde_json::Value::Null);

    serde_json::json!({
        "payload_version": 2,
        "worker_sent_at": chrono::Utc::now().to_rfc3339(),
        "tz_offset_min": chrono::Local::now().offset().local_minus_utc() / 60,
        "date": date,
        "app_version": env!("CARGO_PKG_VERSION"),
        "orders": {
            "total": total_orders,
            "by_status": orders_by_status,
        },
        "by_user": build_by_user(db, date),
        "bin_shop": bin_shop,
        "sla": sla,
        "cards": {
            "taken": cards_taken,
            "used": cards_used,
            "dead": cards_dead,
            "by_bin": by_bin.iter().map(|(k, (used, dead))| (
                k.clone(), serde_json::json!({ "used": used, "dead": dead })
            )).collect::<serde_json::Map<String, serde_json::Value>>(),
        },
        "pool": build_pool_snapshot(db),
        "drops": {
            "taken": drops_taken,
            "by_destination": drops_by_destination,
        },
        "shops": shops,
        "health": {
            "imap_ok": imap_ok, "imap_fail": imap_fail,
            "smtp_ok": smtp_ok_n, "smtp_fail": smtp_fail_n,
            "proxy_ok": 0, "proxy_fail": proxy_fail_n,
        },
        "sync": { "ws_ok": ws_ok, "push_ok": 0, "push_fail": push_fail },
    })
}

// ── HTTP-отправка (контракт routes/telemetry.js) ──────────────────

fn worker_token(db: &Database) -> Result<String, String> {
    let stored = db.get_config("license_token").map_err(|e| e.to_string())?;
    match stored {
        Some(t) if !t.is_empty() => match &db.encryption {
            Some(enc) => Ok(enc.decrypt(&t).unwrap_or(t)),
            None => Ok(t),
        },
        _ => Err("no_token".into()),
    }
}

const HEARTBEAT_TIMEOUT_SECS: u64 = 10;

/// Активные менеджерские ключи (`GET /api/telemetry/keys` → `{keys:[...]}`).
/// Сервер принимает ≤8 конвертов — обрезаем список так же.
fn fetch_manager_keys(token: &str) -> Result<Vec<TelemetryManagerKey>, String> {
    let resp = ureq::get(&crate::endpoints::endpoint("/api/telemetry/keys"))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("http_{}", code),
            _ => "network_error".to_string(),
        })?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|_| "bad_keys_response".to_string())?;
    let mut keys: Vec<TelemetryManagerKey> = Vec::new();
    if let Some(arr) = body.get("keys").and_then(|v| v.as_array()) {
        for k in arr {
            let id = k.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let pubkey = k.get("pubkey").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id > 0 && pubkey.len() == 64 && hex::decode(&pubkey).map(|b| b.len() == 32).unwrap_or(false) {
                keys.push(TelemetryManagerKey {
                    id,
                    pubkey,
                    key_type: k.get("key_type").and_then(|v| v.as_str()).map(String::from),
                    label: k.get("label").and_then(|v| v.as_str()).map(String::from),
                });
            }
        }
    }
    if keys.is_empty() {
        return Err("no_active_manager_keys".into());
    }
    keys.truncate(8);
    Ok(keys)
}

fn seal_for_managers(
    keys: &[TelemetryManagerKey],
    payload: &serde_json::Value,
) -> Result<Vec<TelemetryEnvelope>, String> {
    let plaintext = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    keys.iter()
        .map(|k| seal_envelope(k.id, &k.pubkey, &plaintext))
        .collect()
}

fn http_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => format!("http_{}", code),
        _ => "network_error".to_string(),
    }
}

// ── MGR-005: применение политик живьём ───────────────────────────
// Политика приходит в ответе heartbeat (`{ok, policy, update_required}`)
// или в 403 banned (`{error, reason, policy}`). Поля серверной строки
// worker_policies: banned, banned_reason, ban_until, permissions_override,
// quota_cards_day, quota_orders_day, min_version, version_exempt,
// force_logout, updated_by, updated_at.

/// Эффекты применения — то, о чём фронту надо узнать немедленно.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyEffects {
    pub banned: bool,
    pub force_logout: bool,
    pub update_required: bool,
    /// MGR-013: сервер потребовал криптостирание локальной БД.
    /// Одноразовый эффект heartbeat — в PolicyState и в персистящийся
    /// config НЕ переносится (иначе restore_policy_from_config повторил бы wipe).
    #[serde(default)]
    pub wipe: bool,
}

/// SQLite-хранимые флаги приходят как 0/1, из JSON — как bool.
fn policy_flag(v: &serde_json::Value, key: &str) -> bool {
    match v.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    }
}

fn policy_opt_i64(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| x.as_i64())
}

fn policy_opt_string(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// permissions_override — TEXT-колонка с JSON: может прийти строкой или
/// уже объектом. Невалидное значение игнорируем, чтобы не ломать права.
fn parse_permissions_override(v: &serde_json::Value) -> Option<std::collections::HashMap<String, bool>> {
    let parsed: serde_json::Value = match v.get("permissions_override") {
        Some(serde_json::Value::String(s)) => serde_json::from_str(s).ok()?,
        Some(o @ serde_json::Value::Object(_)) => o.clone(),
        _ => return None,
    };
    parsed.as_object().map(|m| {
        m.iter().filter_map(|(k, val)| val.as_bool().map(|b| (k.clone(), b))).collect()
    })
}

/// Разобрать строку политики в PolicyState (update_required живёт отдельно
/// от строки worker_policies — его сервер вычисляет на heartbeat).
fn parse_policy_state(policy: &serde_json::Value, update_required: bool) -> PolicyState {
    PolicyState {
        banned: policy_flag(policy, "banned"),
        banned_reason: policy_opt_string(policy, "banned_reason"),
        ban_until: policy_opt_string(policy, "ban_until"),
        update_required,
        min_version: policy_opt_string(policy, "min_version"),
        permissions_override: parse_permissions_override(policy),
        quota_cards_day: policy_opt_i64(policy, "quota_cards_day"),
        quota_orders_day: policy_opt_i64(policy, "quota_orders_day"),
        force_logout: policy_flag(policy, "force_logout"),
    }
}

/// Применить политику живьём: персистит в config `worker_policy` (вместе с
/// update_required — одним ключом), обновляет in-memory PolicyState.
/// force_logout гасит все локальные сессии и ставит флаг ack — следующий
/// heartbeat уйдёт с `ack_force_logout:true`, и сервер сбросит флаг.
pub(crate) fn apply_policy(db: &mut Database, policy: &serde_json::Value, update_required: bool) -> PolicyEffects {
    let next = parse_policy_state(policy, update_required);
    // MGR-013: wipe — одноразовый эффект; в персистящуюся политику не пишем,
    // чтобы restore_policy_from_config после рестарта не повторил стирание
    // (сервер сбрасывает флаг по wipe_ack).
    let wipe = policy_flag(policy, "wipe");
    let mut stored = policy.clone();
    stored["update_required"] = serde_json::json!(update_required);
    if let Some(obj) = stored.as_object_mut() { obj.remove("wipe"); }
    let _ = db.set_config("worker_policy", &stored.to_string());

    let force_logout = next.force_logout;
    if let Some(st) = STATE.get() {
        if let Ok(mut p) = st.policy.lock() { *p = next.clone(); }
        if force_logout {
            if let Ok(mut u) = st.current_user.lock() { *u = None; }
        }
    }
    if force_logout {
        let _ = db.logout_all_sessions();
        let _ = db.set_config("telemetry_ack_force_logout", "1");
    }
    PolicyEffects { banned: next.banned, force_logout, update_required, wipe }
}

/// Восстановить политику из config при логине — после рестарта приложения
/// бан/override/квоты продолжают действовать до первого свежего heartbeat.
pub(crate) fn restore_policy_from_config(db: &Database) {
    let Some(raw) = db.get_config("worker_policy").ok().flatten() else { return };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let next = parse_policy_state(&v, policy_flag(&v, "update_required"));
    if let Some(st) = STATE.get() {
        if let Ok(mut p) = st.policy.lock() { *p = next; }
    }
}

// ── MGR-005: дневные квоты ───────────────────────────────────────
// Счётчик считается так же, как в daily_stats (локальная дата,
// DATE(..., 'localtime')) — менеджер видит те же числа в отчёте.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DailyQuota { Cards, Orders }

fn quota_err(kind: DailyQuota) -> String {
    match kind {
        DailyQuota::Cards => "quota_exceeded:cards_day".to_string(),
        DailyQuota::Orders => "quota_exceeded:orders_day".to_string(),
    }
}

fn quota_used_today(db: &Database, kind: DailyQuota) -> i64 {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let sql = match kind {
        DailyQuota::Cards =>
            "SELECT COUNT(*) FROM card_assignments WHERE DATE(assigned_at, 'localtime') = ?1",
        DailyQuota::Orders =>
            "SELECT COUNT(*) FROM orders WHERE DATE(created_at, 'localtime') = ?1",
    };
    scalar_i64(db, sql, &[&today as &dyn rusqlite::ToSql])
}

/// Проверка с явным лимитом — тестируемое ядро; `None` = без квоты,
/// `Some(0)` = полный запрет на сегодня.
pub(crate) fn enforce_daily_quota_with(db: &Database, kind: DailyQuota, limit: Option<i64>) -> Result<(), String> {
    let Some(limit) = limit else { return Ok(()) };
    if limit <= 0 || quota_used_today(db, kind) >= limit {
        return Err(quota_err(kind));
    }
    Ok(())
}

/// Проверка по активной политике (in-memory; без политики — пропускает).
pub(crate) fn enforce_daily_quota(db: &Database, kind: DailyQuota) -> Result<(), String> {
    let p = crate::state::policy_snapshot();
    let limit = match kind {
        DailyQuota::Cards => p.quota_cards_day,
        DailyQuota::Orders => p.quota_orders_day,
    };
    enforce_daily_quota_with(db, kind, limit)
}

/// Ответ heartbeat: `{ok, policy, update_required}`; при бане middleware
/// отвечает `403 {error:'banned', reason, policy}` — policy уходит наверх
/// целиком (MGR-005 применяет бан/лок/квоты).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryHeartbeatResult {
    pub sent: bool,
    pub reason: String,
    pub update_required: bool,
    pub banned: bool,
    pub policy: Option<serde_json::Value>,
    /// MGR-005: политика потребовала разлогин — фронт должен выкинуть на логин.
    #[serde(default)]
    pub force_logout: bool,
    /// MGR-013: сервер потребовал wipe — вызывающая команда обязана стереть
    /// локальные данные и перезапустить приложение (ack уже отправлен).
    #[serde(default)]
    pub wipe: bool,
}

impl TelemetryHeartbeatResult {
    fn fail(reason: String) -> Self {
        TelemetryHeartbeatResult {
            sent: false, reason, update_required: false, banned: false,
            policy: None, force_logout: false, wipe: false,
        }
    }
}

/// MGR-013: подтверждение wipe до стирания (после него токен и БД мертвы —
/// ack больше не уйдёт). Best-effort: при сбое флаг останется на сервере и
/// wipe повторится на следующем heartbeat.
fn send_wipe_ack(token: &str, envelopes: &serde_json::Value) {
    let body = serde_json::json!({ "envelopes": envelopes, "wipe_ack": true });
    let _ = ureq::post(&crate::endpoints::endpoint("/api/telemetry/heartbeat"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .set("X-App-Version", env!("CARGO_PKG_VERSION"))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .send_string(&body.to_string());
}

pub(crate) fn send_heartbeat(db: &mut Database) -> TelemetryHeartbeatResult {
    let token = match worker_token(db) {
        Ok(t) => t,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    let keys = match fetch_manager_keys(&token) {
        Ok(k) => k,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    let envelopes = match seal_for_managers(&keys, &build_heartbeat_payload(db)) {
        Ok(e) => e,
        Err(reason) => return TelemetryHeartbeatResult::fail(reason),
    };
    // MGR-005: после force_logout следующий heartbeat подтверждает разлогин —
    // сервер по ack_force_logout:true сбрасывает флаг в worker_policies.
    let ack = db.get_config("telemetry_ack_force_logout").ok().flatten().as_deref() == Some("1");
    let body = if ack {
        serde_json::json!({ "envelopes": envelopes, "ack_force_logout": true })
    } else {
        serde_json::json!({ "envelopes": envelopes })
    };
    let resp = ureq::post(&crate::endpoints::endpoint("/api/telemetry/heartbeat"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .set("X-App-Version", env!("CARGO_PKG_VERSION"))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .send_string(&body.to_string());

    match resp {
        Ok(r) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
                let _ = db.set_config("telemetry_last_heartbeat_at",
                    &chrono::Utc::now().to_rfc3339());
                if ack { let _ = db.set_config("telemetry_ack_force_logout", "0"); }
                let update_required = v.get("update_required").and_then(|x| x.as_bool()).unwrap_or(false);
                let policy = v.get("policy").cloned();
                let effects = match &policy {
                    Some(p) => apply_policy(db, p, update_required),
                    None => PolicyEffects::default(),
                };
                if effects.wipe {
                    send_wipe_ack(&token, &serde_json::json!(envelopes));
                }
                // MGR-015: сервер жив — попутно вымываем очередь дневных отчётов
                let _ = outbox_flush(db, &token, 5);
                TelemetryHeartbeatResult {
                    sent: true, reason: "ok".into(),
                    update_required,
                    banned: effects.banned,
                    policy,
                    force_logout: effects.force_logout,
                    wipe: effects.wipe,
                }
            } else {
                TelemetryHeartbeatResult::fail("bad_response".into())
            }
        }
        Err(ureq::Error::Status(403, r)) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            let policy = v.get("policy").cloned();
            let effects = match &policy {
                Some(p) => apply_policy(db, p, false),
                None => PolicyEffects::default(),
            };
            // MGR-013: wipe приходит и в 403-политике (бан+wipe) — ack с тем
            // же конвертом, токен ещё жив до стирания.
            if effects.wipe {
                send_wipe_ack(&token, &serde_json::json!(envelopes));
            }
            TelemetryHeartbeatResult {
                sent: false,
                reason: v.get("error").and_then(|x| x.as_str()).unwrap_or("banned").to_string(),
                update_required: false,
                banned: true,
                policy,
                force_logout: effects.force_logout,
                wipe: effects.wipe,
            }
        }
        Err(e) => TelemetryHeartbeatResult {
            sent: false, reason: http_err(e), update_required: false, banned: false,
            policy: None, force_logout: false, wipe: false,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryReportResult {
    pub sent: bool,
    pub reason: String,
    pub date: String,
}

// ── MGR-015: локальная очередь неотправленных конвертов ───────────
// Воркер неделями офлайн — дневные отчёты не теряются: неудачная отправка
// (сеть/5xx) кладёт уже запечатанное тело в telemetry_outbox (миграция v22),
// успешная отправка вымывает очередь FIFO. Кап — чтобы рост был ограничен.

const OUTBOX_CAP: i64 = 60;

/// Положить тело отчёта в очередь (та же (kind, date) перезаписывается —
/// актуальный снапшот важнее истории ретраев), кап FIFO в OUTBOX_CAP.
fn outbox_enqueue(db: &Database, kind: &str, ref_date: Option<&str>, body: &serde_json::Value) {
    let _ = db.conn.execute(
        "DELETE FROM telemetry_outbox WHERE kind = ?1 AND COALESCE(ref_date, '') = COALESCE(?2, '')",
        params![kind, ref_date],
    );
    let _ = db.conn.execute(
        "INSERT INTO telemetry_outbox(kind, ref_date, body_json) VALUES(?1, ?2, ?3)",
        params![kind, ref_date, body.to_string()],
    );
    let _ = db.conn.execute(
        "DELETE FROM telemetry_outbox WHERE id NOT IN \
         (SELECT id FROM telemetry_outbox ORDER BY created_at DESC, id DESC LIMIT ?1)",
        params![OUTBOX_CAP],
    );
}

/// Вымыть очередь: до `max` старых конвертов на /api/telemetry/report.
/// Успех → строка удаляется; 4xx (тело отвергнуто сервером) → удаляем тоже
/// (ретрай бессмысленного не раздувает очередь); сеть/5xx → стоп до след. раза.
fn outbox_flush(db: &Database, token: &str, max: usize) -> usize {
    let rows: Vec<(i64, String)> = {
        let mut stmt = match db.conn.prepare(
            "SELECT id, body_json FROM telemetry_outbox WHERE kind = 'daily_stats' \
             ORDER BY created_at ASC, id ASC LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return 0,
        };
        let mapped = stmt.query_map(params![max as i64], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        });
        match mapped {
            Ok(m) => m.filter_map(|r| r.ok()).collect(),
            Err(_) => return 0,
        }
    };
    let mut ok_n = 0;
    for (id, body_json) in rows {
        let resp = ureq::post(&crate::endpoints::endpoint("/api/telemetry/report"))
            .set("Authorization", &format!("Bearer {}", token))
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
            .send_string(&body_json);
        match resp {
            // 2xx = сервер принял конверт (валидация проходит до ok-ответа)
            Ok(_) => {
                let _ = db.conn.execute("DELETE FROM telemetry_outbox WHERE id = ?1", params![id]);
                ok_n += 1;
            }
            // тело отвергнуто навсегда (битый/устаревший формат) — не раздуваем очередь
            Err(ureq::Error::Status(c, _)) if (400..500).contains(&c) => {
                let _ = db.conn.execute("DELETE FROM telemetry_outbox WHERE id = ?1", params![id]);
            }
            // сеть/5xx — попробуем при следующем успешном heartbeat/отчёте
            Err(_) => break,
        }
    }
    ok_n
}

pub(crate) fn send_daily_stats(db: &mut Database, date: &str) -> TelemetryReportResult {
    let fail = |reason: &str| TelemetryReportResult {
        sent: false, reason: reason.into(), date: date.into(),
    };
    let token = match worker_token(db) { Ok(t) => t, Err(e) => return fail(&e) };
    let keys = match fetch_manager_keys(&token) { Ok(k) => k, Err(e) => return fail(&e) };
    let payload = build_daily_stats(db, date);
    let envelopes = match seal_for_managers(&keys, &payload) { Ok(e) => e, Err(e) => return fail(&e) };
    let body = serde_json::json!({ "kind": "daily_stats", "date": date, "envelopes": envelopes });
    let result = match ureq::post(&crate::endpoints::endpoint("/api/telemetry/report"))
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .send_string(&body.to_string())
    {
        Ok(r) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::json!({}));
            if v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
                let _ = db.set_config("telemetry_last_daily_stats", date);
                // MGR-015: сервер жив — вымываем накопленную очередь
                let _ = outbox_flush(db, &token, 10);
                TelemetryReportResult { sent: true, reason: "ok".into(), date: date.into() }
            } else {
                fail("bad_response")
            }
        }
        Err(ureq::Error::Status(c, _)) => {
            if c >= 500 { outbox_enqueue(db, "daily_stats", Some(date), &body); }
            fail(&format!("http_{}", c))
        }
        Err(_) => {
            outbox_enqueue(db, "daily_stats", Some(date), &body);
            fail("network_error")
        }
    };
    result
}

// ── Интеграционная точка: команды + идемпотентный tick ────────────

pub(crate) fn yesterday_local() -> String {
    (chrono::Local::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d").to_string()
}

/// heartbeat + отчет за прошлые сутки, если они пришли по расписанию.
/// `force=true` шлёт heartbeat даже внутри интервала (кнопка «отправить сейчас»).
pub(crate) fn telemetry_tick_impl(db: &mut Database, force: bool) -> serde_json::Value {
    let interval: i64 = db
        .get_config("telemetry_heartbeat_interval_secs").ok().flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(300);
    let due = force || match db.get_config("telemetry_last_heartbeat_at").ok().flatten() {
        Some(ts) => chrono::DateTime::parse_from_rfc3339(&ts)
            .map(|t| (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() >= interval)
            .unwrap_or(true),
        None => true,
    };
    let heartbeat = if due { send_heartbeat(db) } else {
        TelemetryHeartbeatResult::fail("skipped_not_due".into())
    };

    // MGR-006: после успешного heartbeat подтягиваем новости и приоритеты
    // (best-effort — сбой сети/формата не должен ломать телеметрию).
    let mut feeds = serde_json::json!({ "news": "skipped", "priorities": "skipped" });
    if heartbeat.sent {
        let n = fetch_and_store_news(db);
        let p = fetch_and_store_priorities(db);
        feeds = serde_json::json!({
            "news": n.as_ref().map(|c| serde_json::json!(c)).unwrap_or_else(|e| serde_json::json!(format!("err:{}", e))),
            "priorities": p.as_ref().map(|c| serde_json::json!(c)).unwrap_or_else(|e| serde_json::json!(format!("err:{}", e))),
        });
    }

    let yesterday = yesterday_local();
    let already_sent = db.get_config("telemetry_last_daily_stats").ok().flatten()
        .map(|d| d == yesterday).unwrap_or(false);
    let daily = if already_sent {
        TelemetryReportResult { sent: false, reason: "skipped_already_sent".into(),
            date: yesterday }
    } else {
        send_daily_stats(db, &yesterday)
    };

    // MGR-015: догоняем дни, пропущенные из-за офлайна (маркер = последний
    // отправленный день; всё новее маркера и старше вчерашнего досылаем,
    // максимум 6 за тик, старые вперёд; первая неудача останавливает).
    let mut backfilled = 0usize;
    if daily.sent {
        let marker = db.get_config("telemetry_last_daily_stats").ok().flatten();
        for back in (2..=7).rev() {
            let d = (chrono::Local::now() - chrono::Duration::days(back as i64))
                .format("%Y-%m-%d").to_string();
            if marker.as_deref().map(|m| d.as_str() <= m).unwrap_or(false) { break; }
            let r = send_daily_stats(db, &d);
            if !r.sent { break; }
            backfilled += 1;
        }
    }
    serde_json::json!({ "heartbeat": heartbeat, "daily_stats": daily, "feeds": feeds,
        "backfill": backfilled })
}

/// MGR-013: криптостирание по команде сервера и перезапуск. Ack уже ушёл из
/// send_heartbeat; здесь БД закрывается, файлы перезаписываются и удаляются.
/// restart() не возвращается — дальше чистое состояние fresh-install.
fn perform_wipe_and_restart(db: &mut Database, app: &tauri::AppHandle) -> ! {
    db.close_connections();
    let path = crate::state::db_path();
    crate::wipe::wipe_local_data(path.to_str().unwrap_or("vaultbase.db"));
    app.restart()
}

#[tauri::command]
pub(crate) fn telemetry_send_heartbeat(app: tauri::AppHandle) -> Result<TelemetryHeartbeatResult, String> {
    with_db!(db, {
        let r = send_heartbeat(db);
        if r.wipe {
            perform_wipe_and_restart(db, &app);
        }
        Ok(r)
    })
}

#[tauri::command]
pub(crate) fn telemetry_send_daily_stats(date: Option<String>) -> Result<TelemetryReportResult, String> {
    with_db!(db, {
        let d = date.unwrap_or_else(|| {
            chrono::Local::now().format("%Y-%m-%d").to_string()
        });
        if !regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap().is_match(&d) {
            return Err("invalid_date".into());
        }
        Ok(send_daily_stats(db, &d))
    })
}

#[tauri::command]
pub(crate) fn telemetry_tick(app: tauri::AppHandle, force: Option<bool>) -> Result<serde_json::Value, String> {
    with_db!(db, {
        let r = telemetry_tick_impl(db, force.unwrap_or(false));
        if r["heartbeat"]["wipe"].as_bool().unwrap_or(false) {
            perform_wipe_and_restart(db, &app);
        }
        Ok(r)
    })
}

// ── MGR-006: новости и приоритеты шопов от менеджера ─────────────
// Сервер фильтрует по таргетингу и отдаёт уже применимое к этому воркеру.
// Воркер кеширует снимок локально (миграция v17): новости с флагом прочтения,
// приоритеты — мапой domain→weight для сортировки каталога.

/// GET-запрос к telemetry API с Bearer-токеном; возвращает распарсенный JSON.
fn telemetry_get(db: &Database, path: &str) -> Result<serde_json::Value, String> {
    let token = worker_token(db)?;
    ureq::get(&crate::endpoints::endpoint(path))
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(HEARTBEAT_TIMEOUT_SECS))
        .call()
        .map_err(http_err)?
        .into_json()
        .map_err(|_| "bad_response".to_string())
}

/// Забрать новости с сервера и слить в локальный кеш. Сервер уже посчитал
/// is_read, но локальный флаг приоритетнее (пользователь мог отметить оффлайн).
/// Новости, исчезнувшие из выборки (unpublish/expire), подтираем.
pub(crate) fn fetch_and_store_news(db: &Database) -> Result<i64, String> {
    let body = telemetry_get(db, "/api/telemetry/news")?;
    let items = body.get("news").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut seen: Vec<i64> = Vec::new();
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for n in &items {
        let id = n.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if id <= 0 { continue; }
        seen.push(id);
        let severity = n.get("severity").and_then(|v| v.as_str()).unwrap_or("info");
        let title = n.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let body_t = n.get("body").and_then(|v| v.as_str());
        let published = n.get("published_at").and_then(|v| v.as_str());
        let expires = n.get("expires_at").and_then(|v| v.as_str());
        let server_read = n.get("is_read").and_then(|v| v.as_i64()).unwrap_or(0);
        tx.execute(
            "INSERT INTO manager_news (id, severity, title, body, published_at, expires_at, is_read)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                severity = excluded.severity,
                title = excluded.title,
                body = excluded.body,
                published_at = excluded.published_at,
                expires_at = excluded.expires_at,
                is_read = MAX(manager_news.is_read, excluded.is_read)",
            params![id, severity, title, body_t, published, expires, server_read],
        ).map_err(|e| e.to_string())?;
    }
    if !seen.is_empty() {
        let ph = seen.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM manager_news WHERE id NOT IN ({})", ph);
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::ToSql> = seen.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
        stmt.execute(refs.as_slice()).map_err(|e| e.to_string())?;
    } else {
        tx.execute("DELETE FROM manager_news", []).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(seen.len() as i64)
}

/// Забрать приоритеты шопов и заменить локальную мапу domain→weight.
/// Сервер уже развернул таргеты (all / iid / role) в конкретные строки;
/// при конфликте одного домена в разных таргетах берём максимальный вес.
pub(crate) fn fetch_and_store_priorities(db: &Database) -> Result<i64, String> {
    let body = telemetry_get(db, "/api/telemetry/priorities")?;
    let items = body.get("priorities").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let tx = db.conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM shop_priorities", []).map_err(|e| e.to_string())?;
    for p in &items {
        let domain = p.get("shop_domain").and_then(|v| v.as_str()).unwrap_or("");
        if domain.is_empty() { continue; }
        let weight = p.get("weight").and_then(|v| v.as_i64()).unwrap_or(5);
        let notes = p.get("notes").and_then(|v| v.as_str()).unwrap_or("");
        let updated = p.get("updated_at").and_then(|v| v.as_str());
        tx.execute(
            "INSERT INTO shop_priorities (shop_domain, weight, notes, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(shop_domain) DO UPDATE SET
                weight = MAX(shop_priorities.weight, excluded.weight),
                notes = excluded.notes,
                updated_at = excluded.updated_at",
            params![domain, weight, notes, updated],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(items.len() as i64)
}

#[tauri::command]
pub(crate) fn manager_refresh_feeds() -> Result<serde_json::Value, String> {
    with_db!(db, {
        let news = fetch_and_store_news(db).map_err(|e| format!("news: {}", e))?;
        let priorities = fetch_and_store_priorities(db).map_err(|e| format!("priorities: {}", e))?;
        Ok(serde_json::json!({ "news": news, "priorities": priorities }))
    })
}

#[tauri::command]
pub(crate) fn get_manager_news(unread_only: Option<bool>) -> Result<serde_json::Value, String> {
    with_db!(db, {
        let unread = unread_only.unwrap_or(false);
        let sql = if unread {
            "SELECT id, severity, title, body, published_at, expires_at, is_read
             FROM manager_news WHERE is_read = 0 ORDER BY published_at DESC LIMIT 100"
        } else {
            "SELECT id, severity, title, body, published_at, expires_at, is_read
             FROM manager_news ORDER BY published_at DESC LIMIT 100"
        };
        let mut stmt = db.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "severity": r.get::<_, String>(1)?,
                "title": r.get::<_, String>(2)?,
                "body": r.get::<_, Option<String>>(3)?,
                "published_at": r.get::<_, Option<String>>(4)?,
                "expires_at": r.get::<_, Option<String>>(5)?,
                "is_read": r.get::<_, i64>(6)? == 1,
            }))
        }).map_err(|e| e.to_string())?;
        let news: Vec<serde_json::Value> = rows.flatten().collect();
        let unread_count: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)
        ).unwrap_or(0);
        Ok(serde_json::json!({ "news": news, "unread": unread_count }))
    })
}

#[tauri::command]
pub(crate) fn mark_manager_news_read(id: i64) -> Result<(), String> {
    with_db!(db, {
        db.conn.execute("UPDATE manager_news SET is_read = 1 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // best-effort: сообщаем серверу, чтобы счётчики читателей у менеджера совпадали
        if let Ok(token) = worker_token(db) {
            let _ = ureq::post(&crate::endpoints::endpoint(&format!("/api/telemetry/news/{}/read", id)))
                .set("Authorization", &format!("Bearer {}", token))
                .timeout(std::time::Duration::from_secs(5))
                .call();
        }
        Ok(())
    })
}

/// Приоритеты шопов: мапа domain→weight для сортировки каталога.
#[tauri::command]
pub(crate) fn get_shop_priorities() -> Result<serde_json::Value, String> {
    with_db!(db, {
        let mut stmt = db.conn.prepare(
            "SELECT shop_domain, weight, notes FROM shop_priorities ORDER BY weight DESC, shop_domain ASC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?))
        }).map_err(|e| e.to_string())?;
        let mut map = serde_json::Map::new();
        let mut list: Vec<serde_json::Value> = Vec::new();
        for (domain, weight, notes) in rows.flatten() {
            map.insert(domain.clone(), serde_json::json!(weight));
            list.push(serde_json::json!({ "domain": domain, "weight": weight, "notes": notes }));
        }
        Ok(serde_json::json!({ "by_domain": serde_json::Value::Object(map), "list": list }))
    })
}

/// MGR-005: снимок активной политики для фронта. Читает только память —
/// работает и на заблокированной БД (экран лока показывает причину бана).
#[tauri::command]
pub(crate) fn telemetry_get_policy() -> serde_json::Value {
    let p = crate::state::policy_snapshot();
    serde_json::json!({
        "banned": p.banned,
        "banned_reason": p.banned_reason,
        "ban_until": p.ban_until,
        "update_required": p.update_required,
        "min_version": p.min_version,
        "permissions_override": p.permissions_override,
        "quota_cards_day": p.quota_cards_day,
        "quota_orders_day": p.quota_orders_day,
        "force_logout": p.force_logout,
    })
}

// ── Тесты ─────────────────────────────────────────────────────────

#[cfg(test)]
mod telemetry_tests {
    use super::*;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut db = Database::open(path.to_str().unwrap()).unwrap();
        let salt = crate::encryption::generate_salt();
        db.set_encryption(crate::encryption::FieldEncryption::new("telemetry_test_pw_1234567890", &salt));
        (dir, db)
    }

    fn make_profile(db: &Database, n: usize) -> String {
        db.insert_cards(vec![crate::models::CardInput {
            card_number: format!("4111111111{n:06}"),
            source: "test".into(),
            ..Default::default()
        }]).unwrap();
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0))
            .unwrap();
        db.create_profile(card_id, None).unwrap().id
    }

    fn make_shop(db: &Database, domain: &str) -> i64 {
        db.create_shop(&crate::models::ShopInput {
            name: format!("Shop {domain}"),
            url: format!("https://{domain}"),
            category: "general".into(),
            ..Default::default()
        }).unwrap().id
    }

    fn make_order(db: &Database, profile_id: &str, shop_id: i64, n: usize) -> i64 {
        db.create_order(&crate::models::OrderInput {
            profile_id: profile_id.into(),
            shop_id,
            drop_id: None, email_pool_id: None, proxy_id: None,
            order_number: Some(format!("ORD-{n}")),
            notes: None,
            items: vec![crate::models::OrderItemInput {
                name: "Item".into(), sku: "S".into(), qty: 1, price: 10.0,
            }],
        }, None).unwrap().id
    }

    fn today_local() -> String {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    }

    fn json_str(s: &str) -> serde_json::Value { serde_json::Value::String(s.into()) }

    // ── Конверт ──

    #[test]
    fn test_seal_unseal_roundtrip() {
        let b = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        let b_pub = PublicKey::from(&b);
        let payload = r#"{"ts":"2026-08-26T00:00:00Z","platform":"windows"}"#;
        let env = seal_envelope(7, &hex::encode(b_pub.as_bytes()), payload).unwrap();
        assert_eq!(env.key_id, 7);
        // форма по валидатору сервера: hex{64}, hex{24}, base64
        assert_eq!(env.ephemeral.len(), 64);
        assert!(env.ephemeral.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(env.nonce.len(), 24);
        assert!(env.nonce.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(!env.ct.is_empty());

        let opened = unseal_envelope(&hex::encode(b.as_bytes()), &env).unwrap();
        assert_eq!(opened, payload);

        // чужой ключ не распечатывает
        let c = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        assert!(unseal_envelope(&hex::encode(c.as_bytes()), &env).is_err());
    }

    #[test]
    fn test_seal_rejects_bad_pubkey() {
        assert!(seal_envelope(1, "zz", "x").is_err());
        assert!(seal_envelope(1, &"ab".repeat(16), "x").is_err()); // 16 байт, не 32
    }

    #[test]
    fn test_seal_nondeterministic() {
        let b = StaticSecret::random_from_rng(&mut rand::rngs::OsRng);
        let b_pub = PublicKey::from(&b);
        let e1 = seal_envelope(1, &hex::encode(b_pub.as_bytes()), "p").unwrap();
        let e2 = seal_envelope(1, &hex::encode(b_pub.as_bytes()), "p").unwrap();
        assert_ne!(e1.nonce, e2.nonce);
        assert_ne!(e1.ephemeral, e2.ephemeral);
    }

    // ── Heartbeat payload ──

    #[test]
    fn test_heartbeat_payload_shape() {
        let (_dir, db) = test_db();
        let p = build_heartbeat_payload(&db);
        assert!(p.get("ts").unwrap().as_str().unwrap().starts_with("20"));
        assert_eq!(p["app_version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(p["platform"], std::env::consts::OS);
        assert_eq!(p["sync_ws"], "down"); // событий sync нет
        assert!(p["db_ok"].as_bool().unwrap());
        assert!(p["imap_ok"].is_null()); // аккаунтов нет
        assert!(p["proxy_ok"].is_null());
        assert_eq!(p["errors_24h"], 0);
    }

    #[test]
    fn test_heartbeat_health_signals() {
        let (_dir, db) = test_db();
        db.conn.execute(
            "INSERT INTO imap_accounts(label,host,login,is_active,last_ok) \
             VALUES('a','imap.test','l',1,datetime('now','-2 hours'))", [],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO proxies(host,port,is_blocked) VALUES('p.test',8080,0),('q.test',8080,1)", [],
        ).unwrap();
        db.log_event("imap.check_error", "boom", Some("imap"), None).unwrap();
        let p = build_heartbeat_payload(&db);
        assert_eq!(p["imap_ok"], serde_json::json!(true));
        assert_eq!(p["proxy_ok"], serde_json::json!(true));
        assert_eq!(p["errors_24h"], 1);

        // все прокси заблокированы → false
        db.conn.execute("UPDATE proxies SET is_blocked = 1", []).unwrap();
        assert_eq!(build_heartbeat_payload(&db)["proxy_ok"], serde_json::json!(false));
    }

    // ── daily_stats ──

    #[test]
    fn test_daily_stats_fixture_day() {
        let (_dir, db) = test_db();
        let pid = make_profile(&db, 1);
        let shop_id = make_shop(&db, "shop.example.com");
        let o1 = make_order(&db, &pid, shop_id, 1);
        let _o2 = make_order(&db, &pid, shop_id, 2);
        db.conn.execute(
            "UPDATE orders SET status='delivered', total_amount=50.0 WHERE id=?1",
            params![o1],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO drops(profile_id,recipient_name,address,city,zip,country) \
             VALUES(?1,'R','addr','Springfield','00000','US')",
            params![pid],
        ).unwrap();
        // MGR-015: taken = кто забронировал карту (card_assignments, миграция v21)
        db.conn.execute(
            "INSERT INTO users(username,password_hash,display_name,role) VALUES('opA','h','Оп','operator')", [],
        ).unwrap();
        let uid: i64 = db.conn.query_row("SELECT id FROM users WHERE username='opA'", [], |r| r.get(0)).unwrap();
        let card_id: i64 = db.conn.query_row("SELECT card_id FROM profiles WHERE id=?1", params![pid], |r| r.get(0)).unwrap();
        db.conn.execute(
            "INSERT INTO card_assignments(card_id, user_id) VALUES(?1, ?2)", params![card_id, uid],
        ).unwrap();
        db.log_event("card.status_changed", &format!("Card {card_id} status → dead"),
            Some("card"), Some(&card_id.to_string())).unwrap();

        let s = build_daily_stats(&db, &today_local());
        assert_eq!(s["date"], json_str(&today_local()));
        assert_eq!(s["orders"]["total"], 2);
        assert_eq!(s["orders"]["by_status"]["delivered"], 1);
        assert_eq!(s["orders"]["by_status"]["pending"], 1);
        assert_eq!(s["cards"]["taken"], 1);
        assert_eq!(s["cards"]["dead"], 1);
        assert_eq!(s["cards"]["by_bin"]["411111"]["dead"], 1);
        assert_eq!(s["drops"]["taken"], 1);
        assert_eq!(s["drops"]["by_destination"]["shop.example.com"], 1);
        assert_eq!(s["shops"]["shop.example.com"]["orders"], 2);
        assert_eq!(s["shops"]["shop.example.com"]["delivered"], 1);
        assert_eq!(s["shops"]["shop.example.com"]["revenue"], 50.0);
        // другой день — пусто
        let empty = build_daily_stats(&db, "2001-01-01");
        assert_eq!(empty["orders"]["total"], 0);
        assert_eq!(empty["drops"]["taken"], 0);
    }

    #[test]
    fn test_daily_stats_sync_health_from_log() {
        let (_dir, db) = test_db();
        db.log_event("imap.poll_completed", "ok", Some("imap"), None).unwrap();
        db.log_event("imap.poll_error", "bad", Some("imap"), None).unwrap();
        db.log_event("sync.footprints_sent", "10", Some("sync"), None).unwrap();
        db.log_event("sync.push_rejected", "x", Some("sync"), None).unwrap();
        let s = build_daily_stats(&db, &today_local());
        assert_eq!(s["health"]["imap_ok"], 1);
        assert_eq!(s["health"]["imap_fail"], 1);
        assert_eq!(s["sync"]["ws_ok"], serde_json::json!(true));
        assert_eq!(s["sync"]["push_fail"], 1);
    }

    // ── tick ──

    #[test]
    fn test_tick_gating_without_token() {
        let (_dir, mut db) = test_db();
        // первый tick: heartbeat пытается, но токена нет → no_token (не паникует)
        let r = telemetry_tick_impl(&mut db, false);
        assert_eq!(r["heartbeat"]["sent"], serde_json::json!(false));
        assert_eq!(r["heartbeat"]["reason"], "no_token");
        assert_eq!(r["daily_stats"]["reason"], "no_token");
    }

    #[test]
    fn test_tick_respects_schedule_marks() {
        let (_dir, mut db) = test_db();
        db.set_config("telemetry_last_heartbeat_at",
            &chrono::Utc::now().to_rfc3339()).unwrap();
        db.set_config("telemetry_last_daily_stats",
            &yesterday_local()).unwrap();
        let r = telemetry_tick_impl(&mut db, false);
        assert_eq!(r["heartbeat"]["reason"], "skipped_not_due");
        assert_eq!(r["daily_stats"]["reason"], "skipped_already_sent");
        // force ломает только интервал heartbeat, не уже отправленный отчёт
        let forced = telemetry_tick_impl(&mut db, true);
        assert_eq!(forced["heartbeat"]["reason"], "no_token");
        assert_eq!(forced["daily_stats"]["reason"], "skipped_already_sent");
    }

    // ── MGR-005: политики ──

    fn policy_json() -> serde_json::Value {
        serde_json::json!({
            "banned": 0,
            "banned_reason": null,
            "ban_until": null,
            "permissions_override": null,
            "quota_cards_day": null,
            "quota_orders_day": null,
            "min_version": null,
            "force_logout": 0,
        })
    }

    #[test]
    fn test_apply_policy_ban_persisted() {
        let (_dir, mut db) = test_db();
        let mut p = policy_json();
        p["banned"] = serde_json::json!(1);
        p["banned_reason"] = json_str("fraud chargeback");
        let fx = apply_policy(&mut db, &p, true);
        assert!(fx.banned && fx.update_required && !fx.force_logout);
        // персист одним ключом, update_required внутри
        let stored = db.get_config("worker_policy").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(v["banned"], 1);
        assert_eq!(v["update_required"], true);
        assert_eq!(v["banned_reason"], "fraud chargeback");
    }

    #[test]
    fn test_apply_policy_unban_clears_state() {
        let (_dir, mut db) = test_db();
        let mut p = policy_json();
        p["banned"] = serde_json::json!(1);
        apply_policy(&mut db, &p, false);
        // сервер снял бан (авто-унбан по ban_until или вручную в панели)
        let fx = apply_policy(&mut db, &policy_json(), false);
        assert!(!fx.banned);
        let stored = db.get_config("worker_policy").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(v["banned"], 0);
    }

    #[test]
    fn test_apply_policy_force_logout_wipes_sessions() {
        let (_dir, mut db) = test_db();
        db.conn.execute(
            "INSERT INTO users(username, password_hash, display_name, role) \
             VALUES('u','h','U','admin')", []).unwrap();
        db.conn.execute(
            "INSERT INTO user_sessions(user_id, token) VALUES(1,'tok')", []).unwrap();
        let mut p = policy_json();
        p["force_logout"] = serde_json::json!(1);
        let fx = apply_policy(&mut db, &p, false);
        assert!(fx.force_logout);
        assert_eq!(scalar_i64(&db, "SELECT COUNT(*) FROM user_sessions", &[]), 0);
        // ack уйдёт следующим heartbeat — сервер по нему сбросит флаг
        assert_eq!(db.get_config("telemetry_ack_force_logout").unwrap().as_deref(), Some("1"));
    }

    #[test]
    fn test_apply_policy_wipe_is_one_shot_effect() {
        let (_dir, mut db) = test_db();
        let mut p = policy_json();
        p["wipe"] = serde_json::json!(1);
        let fx = apply_policy(&mut db, &p, false);
        // Эффект доезжает до вызывающей команды (там wipe + restart)...
        assert!(fx.wipe);
        // ...но НЕ персистится: иначе restore_policy_from_config после
        // рестарта повторил бы стирание (сервер уже сбросил флаг по ack).
        let stored = db.get_config("worker_policy").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&stored).unwrap();
        assert!(v.get("wipe").is_none(), "wipe must not be persisted to worker_policy");
        assert!(parse_policy_state(&v, false).force_logout == false);
        // Без флага — эффекта нет.
        let fx2 = apply_policy(&mut db, &policy_json(), false);
        assert!(!fx2.wipe);
    }

    #[test]
    fn test_permissions_override_parsing_and_merge() {
        let mut p = policy_json();
        p["permissions_override"] = json_str("{\"take_cards\":false,\"manage_users\":true}");
        let st = parse_policy_state(&p, false);
        let ov = st.permissions_override.clone().unwrap();
        assert_eq!(ov.get("take_cards"), Some(&false));
        assert_eq!(ov.get("manage_users"), Some(&true));

        // невалидный JSON не ломает права
        p["permissions_override"] = json_str("{broken");
        assert!(parse_policy_state(&p, false).permissions_override.is_none());

        // мерж поверх perms: явный false режет даже админа…
        let admin = crate::models::ActiveUser {
            user_id: 1, username: "a".into(), role: "admin".into(),
            permissions: vec![], token: "t".into(), ip_address: None,
        };
        assert!(!crate::state::perm_allowed_with(&st, &admin, "take_cards"));
        assert!(crate::state::perm_allowed_with(&st, &admin, "export_data")); // без ключа — обычная логика

        // …а явный true выдаёт право оператору без него
        let op = crate::models::ActiveUser {
            user_id: 2, username: "o".into(), role: "operator".into(),
            permissions: vec![], token: "t".into(), ip_address: None,
        };
        assert!(crate::state::perm_allowed_with(&st, &op, "manage_users"));
        assert!(!crate::state::perm_allowed_with(&st, &op, "export_data"));
    }

    #[test]
    fn test_quota_orders_enforced() {
        let (_dir, db) = test_db();
        let pid = make_profile(&db, 1);
        let sid = make_shop(&db, "quota.test");
        make_order(&db, &pid, sid, 1);
        // лимит 1 уже исчерпан созданным заказом
        assert_eq!(
            enforce_daily_quota_with(&db, DailyQuota::Orders, Some(1)).unwrap_err(),
            "quota_exceeded:orders_day"
        );
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, Some(2)).is_ok());
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, None).is_ok());
        // 0 = полный запрет на сегодня
        assert!(enforce_daily_quota_with(&db, DailyQuota::Orders, Some(0)).is_err());
    }

    #[test]
    fn test_quota_cards_enforced() {
        let (_dir, db) = test_db();
        db.conn.execute(
            "INSERT INTO users(username, password_hash, display_name, role) \
             VALUES('u','h','U','admin')", []).unwrap();
        make_profile(&db, 1); // создаёт карту в пуле
        let card_id: i64 = db.conn
            .query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        db.assign_card_to_user(card_id, 1, Some(1)).unwrap();
        assert_eq!(
            enforce_daily_quota_with(&db, DailyQuota::Cards, Some(1)).unwrap_err(),
            "quota_exceeded:cards_day"
        );
        assert!(enforce_daily_quota_with(&db, DailyQuota::Cards, Some(5)).is_ok());
        assert!(enforce_daily_quota_with(&db, DailyQuota::Cards, None).is_ok());
    }

    #[test]
    fn test_restore_policy_without_state_is_noop() {
        let (_dir, db) = test_db();
        db.set_config("worker_policy", "{\"banned\":1}").unwrap();
        restore_policy_from_config(&db); // STATE нет в юнит-тестах — не паникует
        db.set_config("worker_policy", "{broken").unwrap();
        restore_policy_from_config(&db); // битый JSON — тоже молча пропускаем
    }

    // MGR-006: кеш новостей и приоритетов

    fn insert_news(db: &Database, id: i64, severity: &str, read: i64) {
        db.conn.execute(
            "INSERT OR REPLACE INTO manager_news (id, severity, title, body, published_at, is_read)
             VALUES (?1, ?2, ?3, 'b', '2026-08-28 10:00:00', ?4)",
            params![id, severity, format!("n{}", id), read],
        ).unwrap();
    }

    #[test]
    fn test_news_read_mark_and_unread_count() {
        let (_dir, db) = test_db();
        insert_news(&db, 1, "warning", 0);
        insert_news(&db, 2, "info", 0);
        let unread: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(unread, 2);
        db.conn.execute("UPDATE manager_news SET is_read = 1 WHERE id = 1", []).unwrap();
        let unread: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM manager_news WHERE is_read = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(unread, 1);
    }

    #[test]
    fn test_news_upsert_keeps_local_read_flag() {
        let (_dir, db) = test_db();
        insert_news(&db, 7, "info", 1); // уже прочитано локально
        // симулируем upsert от сервера с is_read=0 — локальный флаг не должен сброситься
        db.conn.execute(
            "INSERT INTO manager_news (id, severity, title, body, published_at, expires_at, is_read)
             VALUES (7, 'warning', 'upd', 'b2', '2026-08-28 11:00:00', NULL, 0)
             ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, title=excluded.title,
                is_read = MAX(manager_news.is_read, excluded.is_read)",
            []).unwrap();
        let (sev, read): (String, i64) = db.conn.query_row(
            "SELECT severity, is_read FROM manager_news WHERE id = 7", [],
            |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(sev, "warning");
        assert_eq!(read, 1);
    }

    #[test]
    fn test_priorities_conflict_takes_max_weight() {
        let (_dir, db) = test_db();
        let upsert = |domain: &str, weight: i64| {
            db.conn.execute(
                "INSERT INTO shop_priorities (shop_domain, weight) VALUES (?1, ?2)
                 ON CONFLICT(shop_domain) DO UPDATE SET weight = MAX(shop_priorities.weight, excluded.weight)",
                params![domain, weight]).unwrap();
        };
        upsert("amazon.com", 5);
        upsert("amazon.com", 9); // таргет по iid важнее общего
        upsert("amazon.com", 3); // меньший вес не должен понизить
        let w: i64 = db.conn.query_row(
            "SELECT weight FROM shop_priorities WHERE shop_domain = 'amazon.com'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(w, 9);
    }

    #[test]
    fn test_priorities_replaced_fully_on_refresh() {
        let (_dir, db) = test_db();
        db.conn.execute("INSERT INTO shop_priorities (shop_domain, weight) VALUES ('old.com', 5)", []).unwrap();
        // fetch_and_store_priorities делает DELETE + insert; симулируем финальное состояние
        db.conn.execute("DELETE FROM shop_priorities", []).unwrap();
        db.conn.execute("INSERT INTO shop_priorities (shop_domain, weight) VALUES ('new.com', 8)", []).unwrap();
        let count: i64 = db.conn.query_row("SELECT COUNT(*) FROM shop_priorities", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        let has_old: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM shop_priorities WHERE shop_domain = 'old.com'", [], |r| r.get(0)).unwrap();
        assert_eq!(has_old, 0);
    }

    // ── MGR-015: telemetry v2 ──

    #[test]
    fn test_payload_v2_envelope_fields() {
        let (_dir, db) = test_db();
        let hb = build_heartbeat_payload(&db);
        assert_eq!(hb["payload_version"], serde_json::json!(2));
        assert!(hb["worker_sent_at"].as_str().unwrap().contains("T"));
        assert!(hb["tz_offset_min"].is_i64());
        assert!(hb["errors_by"].is_object());
        assert_eq!(hb["errors_by"]["imap"], serde_json::json!(0));
        assert!(hb["smtp_ok"].is_null(), "нет smtp-конфигов → null");

        let d = build_daily_stats(&db, &today_local());
        assert_eq!(d["payload_version"], serde_json::json!(2));
        assert!(d["worker_sent_at"].as_str().unwrap().contains("T"));
        assert!(d["tz_offset_min"].is_i64());
        assert!(d["by_user"].is_object());
        assert!(d["pool"].is_object());
        let pool = &d["pool"];
        assert!(pool["by_status"].is_object());
        assert!(pool["age"]["lt30"].is_i64());
        assert!(pool["by_bin_top"].is_object());
        assert!(d["health"]["smtp_ok"].is_i64(), "daily smtp_ok — реальное число, не заглушка");
    }

    #[test]
    fn test_errors_by_category() {
        let (_dir, db) = test_db();
        for (et, n) in [("imap.poll_error", 2), ("sync.push_rejected", 3), ("proxy.check_fail", 1), ("order.sync_error", 4), ("misc.fail", 5)] {
            for _ in 0..n {
                db.conn.execute(
                    "INSERT INTO activity_log(event_type, description) VALUES(?1, 'x')",
                    params![et],
                ).unwrap();
            }
        }
        let e = errors_by_category(&db);
        assert_eq!(e["imap"], serde_json::json!(2));
        assert_eq!(e["sync"], serde_json::json!(3));
        assert_eq!(e["proxy"], serde_json::json!(1));
        assert_eq!(e["order"], serde_json::json!(4));
        assert_eq!(e["other"], serde_json::json!(5));
        assert_eq!(e["smtp"], serde_json::json!(0));
        // сумма категорий = общий счётчик за 24ч
        let total: i64 = e.values().filter_map(|v| v.as_i64()).sum();
        assert_eq!(total, count_recent_errors(&db));
    }

    #[test]
    fn test_smtp_health_sources() {
        let (_dir, db) = test_db();
        // нет конфигов → null (нет данных)
        assert_eq!(build_heartbeat_payload(&db)["smtp_ok"], serde_json::Value::Null);

        // активный конфиг + свежая успешная отправка → true (без сети)
        db.conn.execute(
            "INSERT INTO smtp_configs(label, host, port, login) VALUES('s','smtp.example.com',587,'u')", [],
        ).unwrap();
        db.conn.execute(
            "INSERT INTO sent_emails(smtp_config_id, to_email, subject) VALUES(1,'a@b.c','hi')", [],
        ).unwrap();
        assert_eq!(build_heartbeat_payload(&db)["smtp_ok"], serde_json::json!(true));

        // TCP-проба по заведомо закрытому порту → false (127.0.0.1:1, без ожидания)
        assert!(!smtp_tcp_ok("127.0.0.1", 1));
    }

    #[test]
    fn test_daily_by_user_split() {
        let (_dir, db) = test_db();
        db.conn.execute(
            "INSERT INTO users(username,password_hash,display_name,role) VALUES('opA','h','Оп','operator')", [],
        ).unwrap();
        let uid: i64 = db.conn.query_row("SELECT id FROM users WHERE username='opA'", [], |r| r.get(0)).unwrap();
        let prof = make_profile(&db, 1);
        let shop = make_shop(&db, "byuser.example.com");
        make_order(&db, &prof, shop, 1);
        db.conn.execute(
            "UPDATE orders SET created_by=?1 WHERE id=(SELECT MAX(id) FROM orders)", params![uid],
        ).unwrap();
        // карта на руки оператору
        let card_id: i64 = db.conn.query_row("SELECT card_id FROM profiles WHERE id=?1",
            params![prof], |r| r.get(0)).unwrap();
        db.conn.execute(
            "INSERT INTO card_assignments(card_id, user_id) VALUES(?1,?2)", params![card_id, uid],
        ).unwrap();
        let s = build_daily_stats(&db, &today_local());
        let bu = s["by_user"].as_object().unwrap();
        let e = bu.get("opA").expect("user entry");
        assert_eq!(e["orders"], serde_json::json!(1));
        assert_eq!(e["cards_taken"], serde_json::json!(1));
    }

    #[test]
    fn test_outbox_enqueue_trim_and_replace() {
        let (_dir, db) = test_db();
        let body = serde_json::json!({ "kind": "daily_stats", "date": "2026-08-01", "envelopes": [] });
        for i in 0..70 {
            let date = format!("2026-{:02}-{:02}", 7 + i / 28, (i % 28) + 1);
            outbox_enqueue(&db, "daily_stats", Some(&date), &body);
        }
        let n: i64 = db.conn.query_row("SELECT COUNT(*) FROM telemetry_outbox", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 60, "кап очереди");
        // та же (kind, date) — одна строка (актуальный снапшот, не история ретраев)
        outbox_enqueue(&db, "daily_stats", Some("2026-08-01"), &serde_json::json!({"v":2}));
        outbox_enqueue(&db, "daily_stats", Some("2026-08-01"), &serde_json::json!({"v":3}));
        let same_date: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM telemetry_outbox WHERE kind='daily_stats' AND ref_date='2026-08-01'", [],
            |r| r.get(0)).unwrap();
        assert_eq!(same_date, 1);
        let v: String = db.conn.query_row(
            "SELECT body_json FROM telemetry_outbox WHERE kind='daily_stats' AND ref_date='2026-08-01'", [],
            |r| r.get(0)).unwrap();
        assert!(v.contains("\"v\":3"), "перезаписан последним снапшотом");
    }

    #[test]
    fn test_daily_card_events_preferred_over_log() {
        let (_dir, db) = test_db();
        db.conn.execute("INSERT INTO credit_cards(card_number, bin, source) VALUES('4111111111111111','411111','test')", []).unwrap();
        let card_id: i64 = db.conn.query_row("SELECT MAX(id) FROM credit_cards", [], |r| r.get(0)).unwrap();
        db.conn.execute(
            "INSERT INTO card_status_events(card_id, from_status, to_status) VALUES(?1,'free','dead')",
            params![card_id],
        ).unwrap();
        // и лог-строка за ту же дату — НЕ должна задвоить счётчик
        db.conn.execute(
            "INSERT INTO activity_log(event_type, description, entity_type, entity_id) \
             VALUES('card.status_changed', 'Card ' || ?1 || ' status → dead', 'card', ?1)",
            params![card_id],
        ).unwrap();
        let s = build_daily_stats(&db, &today_local());
        assert_eq!(s["cards"]["dead"], serde_json::json!(1), "событие из card_status_events, лог не дублирует");
    }

    // ── MGR-022: SLA + bin_shop ──

    /// Заказ с контролируемыми штампами: created 10:00, shipped 14:00 (+4ч),
    /// delivered на следующий день 02:00 (+16ч от создания, +12ч после shipped).
    fn make_sla_order(db: &Database, n: usize, created: &str) -> i64 {
        let prof = make_profile(db, n);
        let shop = make_shop(db, &format!("sla{}.example.com", n));
        let oid = make_order(db, &prof, shop, n);
        db.conn.execute("UPDATE orders SET created_at=?1, status='delivered' WHERE id=?2",
            params![created, oid]).unwrap();
        oid
    }

    #[test]
    fn test_sla_stats_averages_and_aging() {
        let (_dir, db) = test_db();
        // пустая БД — все средние None, счётчики 0
        let s0 = db.get_sla_stats("all", None, None).unwrap();
        assert!(s0.avg_hours_pending_to_shipped.is_none());
        assert_eq!(s0.orders_shipped, 0);
        assert_eq!(s0.pending_aging.lt24h, 0);

        let oid = make_sla_order(&db, 1, "2026-08-20 10:00:00");
        db.conn.execute(
            "INSERT INTO order_status_history(order_id, from_status, to_status, created_at) \
             VALUES(?1, 'pending', 'shipped', '2026-08-20 14:00:00')", params![oid]).unwrap();
        db.conn.execute(
            "INSERT INTO order_status_history(order_id, from_status, to_status, created_at) \
             VALUES(?1, 'shipped', 'delivered', '2026-08-21 02:00:00')", params![oid]).unwrap();

        let s = db.get_sla_stats("all", None, None).unwrap();
        assert_eq!(s.avg_hours_pending_to_shipped, Some(4.0));
        assert_eq!(s.avg_hours_shipped_to_delivered, Some(12.0));
        assert_eq!(s.avg_hours_created_to_delivered, Some(16.0));
        assert!(s.avg_hours_created_to_declined.is_none());
        assert_eq!(s.orders_shipped, 1);
        assert_eq!(s.orders_delivered, 1);
        assert_eq!(s.by_shop.len(), 1);
        assert_eq!(s.by_shop[0].avg_hours_to_delivered, Some(16.0));

        // период без заказов — средних нет (история не подтягивает чужие заказы)
        let s2 = db.get_sla_stats("custom", Some("2026-08-25"), Some("2026-08-26")).unwrap();
        assert_eq!(s2.orders_shipped, 0);
        assert!(s2.avg_hours_pending_to_shipped.is_none());

        // висящий pending попадает в aging
        let p2 = make_profile(&db, 2);
        let sh2 = make_shop(&db, "aging.example.com");
        make_order(&db, &p2, sh2, 99); // status='pending', created_at=now
        let s3 = db.get_sla_stats("all", None, None).unwrap();
        assert_eq!(s3.pending_aging.lt24h, 1);
        assert!(s3.pending_aging.oldest_hours >= 0.0);
    }

    #[test]
    fn test_daily_stats_sla_and_bin_shop_blocks() {
        let (_dir, db) = test_db();
        let prof = make_profile(&db, 1);
        let shop = make_shop(&db, "binshop.example.com");
        make_order(&db, &prof, shop, 1);

        let s = build_daily_stats(&db, &today_local());
        assert!(s["sla"].is_object(), "sla-блок присутствует");
        assert!(s["sla"]["pending_aging"].is_object());
        assert_eq!(s["sla"]["pending_aging"]["lt24h"], serde_json::json!(1));

        let pairs = s["bin_shop"].as_array().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0]["orders"], serde_json::json!(1));
        assert_eq!(pairs[0]["bin"].as_str().unwrap().len(), 6);
        // домен шопа совпадает с ключом карты shops
        let shop_key = s["shops"].as_object().unwrap().keys().next().unwrap().clone();
        assert_eq!(pairs[0]["shop"].as_str().unwrap(), shop_key);
    }

    // ── MGR-021: контракт-тесты (golden payload_version) ──

    fn sorted_keys(v: &serde_json::Value) -> Vec<String> {
        let mut ks: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        ks.sort();
        ks
    }

    /// Golden-контракт v2: полный набор ключей heartbeat и daily_stats.
    /// Любое добавление/удаление/переименование поля без бампа
    /// payload_version роняет этот тест — сигнал поднять версию протокола
    /// и обновить матрицу совместимости на стороне менеджера.
    #[test]
    fn test_contract_golden_payload_v2() {
        let (_dir, db) = test_db();

        let hb = build_heartbeat_payload(&db);
        assert_eq!(hb["payload_version"], serde_json::json!(2));
        assert_eq!(sorted_keys(&hb), vec![
            "app_version", "db_ok", "errors_24h", "errors_by", "imap_ok",
            "payload_version", "platform", "proxy_ok", "smtp_ok", "sync_ws",
            "ts", "tz_offset_min", "worker_sent_at",
        ]);
        assert!(hb["app_version"].is_string());
        assert!(hb["db_ok"].is_boolean());
        assert!(hb["errors_24h"].is_i64());

        let d = build_daily_stats(&db, &today_local());
        assert_eq!(d["payload_version"], serde_json::json!(2));
        assert_eq!(sorted_keys(&d), vec![
            "app_version", "bin_shop", "by_user", "cards", "date", "drops",
            "health", "orders", "payload_version", "pool", "shops", "sla",
            "sync", "tz_offset_min", "worker_sent_at",
        ]);
        assert_eq!(sorted_keys(&d["orders"]), vec!["by_status", "total"]);
        assert_eq!(sorted_keys(&d["cards"]), vec!["by_bin", "dead", "taken", "used"]);
        assert_eq!(sorted_keys(&d["drops"]), vec!["by_destination", "taken"]);
        assert_eq!(sorted_keys(&d["health"]), vec![
            "imap_fail", "imap_ok", "proxy_fail", "proxy_ok", "smtp_fail", "smtp_ok",
        ]);
        assert_eq!(sorted_keys(&d["sync"]), vec!["push_fail", "push_ok", "ws_ok"]);
        assert_eq!(sorted_keys(&d["pool"]), vec![
            "age", "by_bin_top", "by_country", "by_status", "proxy_blocked",
            "proxy_total", "taken_at",
        ]);
        assert_eq!(sorted_keys(&d["pool"]["age"]), vec!["d30_60", "gt60", "lt30", "unknown"]);
        assert_eq!(d["date"].as_str().unwrap().len(), 10, "date — YYYY-MM-DD");
        assert!(d["by_user"].is_object());
        assert!(d["shops"].is_object());
        assert!(d["bin_shop"].is_array());
        assert!(d["sla"].is_object() || d["sla"].is_null(), "sla — объект или null при ошибке");
    }
}
