// Tauri commands: uPanel domain (FEAT-018 — PPTP servers via uPanel API).
//
// HTTP-запросы к uPanel выполняются ВНЕ with_db!-лока: сначала короткое
// чтение подключения (URL + расшифрованный токен), затем сеть, затем короткая
// запись статуса. Иначе глобальный лок БД подвисал бы на весь сетевой таймаут.
//
// Политики доступа повторяют остальное приложение: просмотр подключений и
// их статусов (виджет на дашборде) — любому залогиненному, управление и
// работа с PPTP-серверами — только с правом manage_proxies, как весь
// раздел Proxies.

use crate::models::{UpanelApiStatus, UpanelConnection, UpanelConnectionInput, UpanelLiveFilter};
use crate::state::*;
use serde_json::Value;
use std::time::Instant;

// ─────────────────────────────────────────
//  HTTP helpers
// ─────────────────────────────────────────

/// Собрать GET-URL с query-параметрами (значения url-энкодятся).
fn build_query(base_url: &str, path: &str, params: &[(String, String)]) -> String {
    let mut url = format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'));
    let mut first = true;
    for (k, v) in params {
        url.push(if first { '?' } else { '&' });
        first = false;
        url.push_str(k);
        url.push('=');
        url.push_str(&urlencoding::encode(v));
    }
    url
}

/// Стабильные коды HTTP-ошибок uPanel (i18n на фронте по префиксу `upanel_`).
fn map_upanel_http_error(code: u16, text: &str) -> String {
    // Тело ошибки может быть JSON {"error": "..."} — пробуем вытащить.
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            return format!("upanel_api_error_{}: {}", code, err);
        }
    }
    match code {
        401 => "upanel_invalid_token".to_string(),
        402 => "upanel_payment_required".to_string(),
        403 => "upanel_forbidden".to_string(),
        404 => "upanel_not_found".to_string(),
        429 => "upanel_rate_limited".to_string(),
        _ => format!("upanel_http_{}", code),
    }
}

/// Ответ uPanel → JSON с маппингом ошибок на стабильные коды (i18n на фронте).
fn read_upanel_json(resp: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
    match resp {
        Ok(r) => r
            .into_string()
            .map_err(|e| format!("upanel_read_error: {}", e))
            .and_then(|body| {
                serde_json::from_str(&body).map_err(|_| "upanel_parse_error".to_string())
            }),
        Err(ureq::Error::Status(code, r)) => Err(map_upanel_http_error(
            code,
            &r.into_string().unwrap_or_default(),
        )),
        Err(ureq::Error::Transport(_)) => Err("upanel_network_error".to_string()),
    }
}

fn upanel_get(
    base_url: &str,
    token: &str,
    path: &str,
    query: &[(String, String)],
    timeout_secs: u64,
) -> Result<Value, String> {
    let url = build_query(base_url, path, query);
    read_upanel_json(
        ureq::get(&url)
            .set("Authorization", &format!("Bearer {}", token))
            .set("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .call(),
    )
}

fn upanel_post(base_url: &str, token: &str, path: &str, timeout_secs: u64) -> Result<Value, String> {
    let url = build_query(base_url, path, &[]);
    read_upanel_json(
        ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", token))
            .set("Accept", "application/json")
            .timeout(std::time::Duration::from_secs(timeout_secs))
            .call(),
    )
}

fn now_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Одна live-проверка подключения: `GET /me` с коротким таймаутом.
/// online = HTTP 200; network_error = offline (сервер не отвечает);
/// прочее (401/403/5xx…) = error (подключение настроено неверно).
fn check_one_connection(conn_id: i64, name: &str, base_url: &str, token: &str) -> UpanelApiStatus {
    let started = Instant::now();
    let result = upanel_get(
        base_url,
        token,
        "me",
        &[],
        crate::constants::UPANEL_STATUS_TIMEOUT_SECS,
    );
    let latency = started.elapsed().as_millis() as u64;
    match result {
        Ok(_) => UpanelApiStatus {
            connection_id: conn_id,
            name: name.to_string(),
            base_url: base_url.to_string(),
            online: true,
            status: "online".to_string(),
            http_code: Some(200),
            error: None,
            latency_ms: Some(latency),
            checked_at: now_utc(),
        },
        Err(e) => {
            let status = if e.contains("upanel_network_error") {
                "offline"
            } else {
                "error"
            };
            UpanelApiStatus {
                connection_id: conn_id,
                name: name.to_string(),
                base_url: base_url.to_string(),
                online: false,
                status: status.to_string(),
                http_code: None,
                error: Some(e),
                latency_ms: None,
                checked_at: now_utc(),
            }
        }
    }
}

/// Белые списки сортировки /live (пробрасываем в uPanel только известные поля).
const LIVE_ORDER_BY_ALLOWED: &[&str] = &[
    "id",
    "country",
    "state",
    "city",
    "ip",
    "mtu",
    "fraud_score",
    "takes_count",
    "last_take_at",
    "updated_at",
];
const LIVE_ORDER_DIR_ALLOWED: &[&str] = &["asc", "desc"];

/// Фильтр + пагинация → query-параметры для /live.
fn live_query(filter: &UpanelLiveFilter, page: u32, per_page: u32) -> Vec<(String, String)> {
    let mut q: Vec<(String, String)> = Vec::new();
    let mut push = |k: &str, v: String| {
        if !v.is_empty() {
            q.push((k.to_string(), v));
        }
    };
    if let Some(v) = filter.country_code.as_deref() {
        push("country_code", v.trim().to_uppercase());
    }
    if let Some(v) = filter.state.as_deref() {
        push("state", v.trim().to_string());
    }
    if let Some(v) = filter.city.as_deref() {
        push("city", v.trim().to_string());
    }
    if let Some(v) = filter.ip.as_deref() {
        push("ip", v.trim().to_string());
    }
    if let Some(v) = filter.fraud_min {
        push("fraud_min", v.to_string());
    }
    if let Some(v) = filter.fraud_max {
        push("fraud_max", v.to_string());
    }
    if let Some(v) = filter.mtu_min {
        push("mtu_min", v.to_string());
    }
    if let Some(v) = filter.mtu_max {
        push("mtu_max", v.to_string());
    }
    if let Some(v) = filter.order_by.as_deref() {
        let v = v.trim();
        if LIVE_ORDER_BY_ALLOWED.contains(&v) {
            push("order_by", v.to_string());
        }
    }
    if let Some(v) = filter.order_dir.as_deref() {
        let v = v.trim();
        if LIVE_ORDER_DIR_ALLOWED.contains(&v) {
            push("order_dir", v.to_string());
        }
    }
    // Пагинация: page >= 1, per_page зажат в разумные рамки.
    q.push(("page".to_string(), page.max(1).to_string()));
    q.push((
        "per_page".to_string(),
        per_page.clamp(1, 200).to_string(),
    ));
    q
}

// ─────────────────────────────────────────
//  Connections CRUD
// ─────────────────────────────────────────

#[tauri::command]
pub(crate) fn upanel_connections_list() -> Result<Vec<UpanelConnection>, String> {
    // Виджет Online/Offline на дашборде виден всем залогиненным,
    // не только владельцам права manage_proxies.
    require_user()?;
    with_db!(db, { db.upanel_list_connections() })
}

#[tauri::command]
pub(crate) fn upanel_connection_add(input: UpanelConnectionInput) -> Result<UpanelConnection, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.upanel_add_connection(&input) })
}

#[tauri::command]
pub(crate) fn upanel_connection_update(
    id: i64,
    input: UpanelConnectionInput,
) -> Result<UpanelConnection, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.upanel_update_connection(id, &input) })
}

#[tauri::command]
pub(crate) fn upanel_connection_delete(id: i64) -> Result<(), String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    with_db!(db, { db.upanel_delete_connection(id) })
}

// ─────────────────────────────────────────
//  Status checks (Dashboard widget)
// ─────────────────────────────────────────

#[tauri::command]
pub(crate) fn upanel_connection_test(id: i64) -> Result<UpanelApiStatus, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (name, base_url, token, _is_active) = with_db!(db, {
        let conn = db
            .upanel_get_connection_by_id(id)?
            .ok_or_else(|| "upanel_connection_not_found".to_string())?;
        if !conn.is_active {
            return Ok(UpanelApiStatus {
                connection_id: id,
                name: conn.name,
                base_url: conn.base_url,
                online: false,
                status: "disabled".to_string(),
                http_code: None,
                error: None,
                latency_ms: None,
                checked_at: now_utc(),
            });
        }
        let (base_url, token) = db.upanel_get_connection_secret(id)?;
        Ok::<(String, String, String, bool), String>((conn.name, base_url, token, true))
    })?;

    // HTTP вне лока БД.
    let status = check_one_connection(id, &name, &base_url, &token);
    with_db!(db, {
        db.upanel_record_status(
            id,
            &status.status,
            status.http_code,
            status.latency_ms,
            status.error.as_deref(),
        )
    })?;
    Ok(status)
}

/// Проверить все подключения (для виджета «API: Online/Offline»).
/// Отключённые (is_active = false) не пингуются и отдаются как disabled.
#[tauri::command]
pub(crate) fn upanel_check_all_apis() -> Result<Vec<UpanelApiStatus>, String> {
    require_user()?;

    // Короткий лок: собрать подключения + расшифровать токены.
    let items: Vec<(i64, String, String, String, bool)> = with_db!(db, {
        let mut out = Vec::new();
        for conn in db.upanel_list_connections()? {
            if !conn.is_active {
                out.push((conn.id, conn.name, conn.base_url, String::new(), false));
            } else {
                let (base_url, token) = db.upanel_get_connection_secret(conn.id)?;
                out.push((conn.id, conn.name, conn.base_url, token, true));
            }
        }
        Ok::<Vec<(i64, String, String, String, bool)>, String>(out)
    })?;

    let mut statuses = Vec::with_capacity(items.len());
    let mut recorded: Vec<(i64, UpanelApiStatus)> = Vec::new();
    for (id, name, base_url, token, is_active) in items {
        let status = if is_active {
            check_one_connection(id, &name, &base_url, &token)
        } else {
            UpanelApiStatus {
                connection_id: id,
                name,
                base_url,
                online: false,
                status: "disabled".to_string(),
                http_code: None,
                error: None,
                latency_ms: None,
                checked_at: now_utc(),
            }
        };
        if is_active {
            recorded.push((id, status.clone()));
        }
        statuses.push(status);
    }

    // Короткий лок: записать статусы.
    if !recorded.is_empty() {
        with_db!(db, {
            for (id, status) in &recorded {
                db.upanel_record_status(
                    *id,
                    &status.status,
                    status.http_code,
                    status.latency_ms,
                    status.error.as_deref(),
                )?;
            }
            Ok::<(), String>(())
        })?;
    }
    Ok(statuses)
}

// ─────────────────────────────────────────
//  Live servers (PPTP)
// ─────────────────────────────────────────

/// Список живых PPTP-серверов с фильтрами и пагинацией.
#[tauri::command]
pub(crate) fn upanel_live_list(
    connection_id: i64,
    filter: UpanelLiveFilter,
    page: u32,
    per_page: u32,
) -> Result<Value, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (base_url, token) = with_db!(db, { db.upanel_get_connection_secret(connection_id) })?;
    let query = live_query(&filter, page, per_page);
    upanel_get(
        &base_url,
        &token,
        "live",
        &query,
        crate::constants::UPANEL_REQUEST_TIMEOUT_SECS,
    )
}

/// Аггрегированная статистика /live (для строки тоталов).
#[tauri::command]
pub(crate) fn upanel_live_stats(connection_id: i64) -> Result<Value, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (base_url, token) = with_db!(db, { db.upanel_get_connection_secret(connection_id) })?;
    upanel_get(
        &base_url,
        &token,
        "live/stats",
        &[],
        crate::constants::UPANEL_REQUEST_TIMEOUT_SECS,
    )
}

/// Кредиты уже взятого PPTP-сервера.
#[tauri::command]
pub(crate) fn upanel_live_credentials(connection_id: i64, server_id: i64) -> Result<Value, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (base_url, token) = with_db!(db, { db.upanel_get_connection_secret(connection_id) })?;
    upanel_get(
        &base_url,
        &token,
        &format!("live/{}/credentials", server_id),
        &[],
        crate::constants::UPANEL_REQUEST_TIMEOUT_SECS,
    )
}

/// Взять PPTP-сервер (POST /live/{id}/take) — основное действие: сервер
/// закрепляется за ролью и выдаёт креды. Роли viewer на стороне uPanel
/// получат 403 (upanel_forbidden) — это ожидаемое поведение.
#[tauri::command]
pub(crate) fn upanel_live_take(connection_id: i64, server_id: i64) -> Result<Value, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (base_url, token) = with_db!(db, { db.upanel_get_connection_secret(connection_id) })?;
    let result = upanel_post(
        &base_url,
        &token,
        &format!("live/{}/take", server_id),
        crate::constants::UPANEL_REQUEST_TIMEOUT_SECS,
    );

    // Take — это событие уровня Activity Log: кто и какой сервер взял.
    if result.is_ok() {
        let _ = with_db!(db, {
            db.log_event(
                "upanel.take",
                &format!("PPTP server #{} taken (conn #{})", server_id, connection_id),
                Some("proxy"),
                Some(&server_id.to_string()),
            )
        });
    }
    result
}

/// Гео-справочник штатов/стран для фильтра.
#[tauri::command]
pub(crate) fn upanel_map_states(connection_id: i64) -> Result<Value, String> {
    require_perm(crate::models::perms::MANAGE_PROXIES)?;
    let (base_url, token) = with_db!(db, { db.upanel_get_connection_secret(connection_id) })?;
    upanel_get(
        &base_url,
        &token,
        "map/states",
        &[],
        crate::constants::UPANEL_REQUEST_TIMEOUT_SECS,
    )
}

// ─────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_builder_encodes_and_joins() {
        let url = build_query(
            "https://example.com/api/v1/",
            "/live",
            &[
                ("country_code".to_string(), "US".to_string()),
                ("ip".to_string(), "1.2.3.4".to_string()),
                ("free".to_string(), "a b&c".to_string()),
            ],
        );
        assert_eq!(
            url,
            "https://example.com/api/v1/live?country_code=US&ip=1.2.3.4&free=a%20b%26c"
        );
        // Без параметров — без «?»
        assert_eq!(
            build_query("https://example.com/api/v1", "live/stats", &[]),
            "https://example.com/api/v1/live/stats"
        );
    }

    #[test]
    fn live_query_passes_filters_and_clamps_paging() {
        let filter = UpanelLiveFilter {
            country_code: Some(" us ".to_string()),
            state: Some("California".to_string()),
            ip: Some("8.8.8.8".to_string()),
            fraud_min: Some(10),
            order_by: Some("fraud_score".to_string()),
            order_dir: Some("desc".to_string()),
            ..Default::default()
        };
        let q = live_query(&filter, 0, 9999);
        let pairs: Vec<(String, String)> = q;
        assert!(pairs.contains(&("country_code".to_string(), "US".to_string())));
        assert!(pairs.contains(&("state".to_string(), "California".to_string())));
        assert!(pairs.contains(&("ip".to_string(), "8.8.8.8".to_string())));
        assert!(pairs.contains(&("fraud_min".to_string(), "10".to_string())));
        assert!(pairs.contains(&("order_by".to_string(), "fraud_score".to_string())));
        assert!(pairs.contains(&("order_dir".to_string(), "desc".to_string())));
        // page >= 1, per_page <= 200
        assert!(pairs.contains(&("page".to_string(), "1".to_string())));
        assert!(pairs.contains(&("per_page".to_string(), "200".to_string())));
    }

    #[test]
    fn live_query_drops_unknown_sort_fields() {
        let filter = UpanelLiveFilter {
            order_by: Some("evil_field; DROP TABLE".to_string()),
            order_dir: Some("sideways".to_string()),
            city: Some("   ".to_string()), // пустые фильтры не проходят
            ..Default::default()
        };
        let q = live_query(&filter, 1, 50);
        assert!(!q.iter().any(|(k, _)| k == "order_by"));
        assert!(!q.iter().any(|(k, _)| k == "order_dir"));
        assert!(!q.iter().any(|(k, _)| k == "city"));
        // пагинация есть всегда
        assert!(q.iter().any(|(k, _)| k == "page"));
    }

    #[test]
    fn error_mapping_is_stable() {
        // Без тела ошибки — стабильные коды по HTTP-статусу.
        assert_eq!(map_upanel_http_error(401, ""), "upanel_invalid_token");
        assert_eq!(map_upanel_http_error(403, "denied"), "upanel_forbidden");
        assert_eq!(map_upanel_http_error(404, ""), "upanel_not_found");
        assert_eq!(map_upanel_http_error(429, ""), "upanel_rate_limited");
        assert_eq!(map_upanel_http_error(500, ""), "upanel_http_500");
        // JSON-тело ошибки прокидывается как деталь
        assert_eq!(
            map_upanel_http_error(400, r#"{"error":"invalid country_code"}"#),
            "upanel_api_error_400: invalid country_code"
        );
    }
}
