use crate::crypto::unseal_envelope;
use crate::db::Database;
use crate::http;
use chrono::Datelike;
use serde_json::{json, Value};

fn config_str(db: &Database, key: &str) -> Result<String, String> {
    db.get_config(key).ok_or_else(|| format!("missing_config_{key}"))
}

pub fn ensure_manager_key(
    db: &Database,
    enc: &crate::crypto::FieldEncryption,
    base: &str,
    token: &str,
) -> Result<([u8; 32], [u8; 32], i64), String> {
    let (secret, public) = match (db.get_config("mgr_x25519_priv_enc"), db.get_config("mgr_x25519_pub")) {
        (Some(priv_enc), Some(pub_hex)) => {
            let decoded = enc
                .decrypt(&priv_enc)
                .map_err(|_| "key_decrypt_failed".to_string())?;
            let decoded = hex::decode(decoded).map_err(|e| format!("hex: {e}"))?;
            let secret: [u8; 32] = decoded
                .try_into()
                .map_err(|_| "priv_key_len".to_string())?;
            let pub_bytes = hex::decode(&pub_hex).map_err(|e| format!("hex: {e}"))?;
            let public: [u8; 32] = pub_bytes.try_into().map_err(|_| "pub_key_len".to_string())?;
            (secret, public)
        }
        _ => {
            let (s, p) = crate::crypto::generate_x25519();
            let stored = enc.encrypt(&hex::encode(s))?;
            db.set_config("mgr_x25519_priv_enc", &stored)?;
            db.set_config("mgr_x25519_pub", &hex::encode(p))?;
            (s, p)
        }
    };

    let list = http::request(base, "GET", "/manager/api/keys", Some(token), None)
        .map_err(|e| format!("keys_list: {e}"))?;
    if list.status == 200 {
        if let Ok(parsed) = serde_json::from_str::<Value>(&list.body) {
            if let Some(keys) = parsed.get("keys").and_then(|k| k.as_array()) {
                let pub_hex = hex::encode(public);
                if let Some(active) = keys
                    .iter()
                    .find(|k| k.get("pubkey").and_then(|p| p.as_str()) == Some(pub_hex.as_str()) && k.get("is_active").and_then(|a| a.as_i64()) == Some(1))
                {
                    let id = active.get("id").and_then(|i| i.as_i64()).unwrap_or(0);
                    db.set_config("mgr_key_id", &id.to_string())?;
                    return Ok((secret, public, id));
                }
            }
        }
    }

    let body = json!({ "pubkey": hex::encode(public), "label": "manager-app" }).to_string();
    let upload = http::request(base, "POST", "/manager/api/keys", Some(token), Some(&body))
        .map_err(|e| format!("key_upload: {e}"))?;
    if upload.status != 201 {
        return Err(format!("key_upload_status_{}", upload.status));
    }
    let parsed: Value = serde_json::from_str(&upload.body).map_err(|e| format!("parse: {e}"))?;
    let id = parsed.get("id").and_then(|i| i.as_i64()).ok_or("key_id_missing")?;
    db.set_config("mgr_key_id", &id.to_string())?;
    Ok((secret, public, id))
}

fn find_own_envelope(envelopes: &Value, key_id: i64) -> Option<&Value> {
    envelopes
        .as_array()
        .and_then(|arr| arr.iter().find(|e| e.get("key_id").and_then(|k| k.as_i64()) == Some(key_id)))
}

pub fn sync(db: &Database, enc: &crate::crypto::FieldEncryption) -> Result<Value, String> {
    let base = http::server_base(db);
    let token = config_str(db, "license_token")?;
    let (secret, _public, key_id) = ensure_manager_key(db, enc, &base, &token)?;

    let mut workers_seen = 0usize;
    let mut snapshots_stored = 0usize;
    let mut sealed_to_other_key = 0usize;
    let mut unseal_failures = 0usize;

    let workers_resp =
        http::request(&base, "GET", "/manager/api/workers", Some(&token), None)
            .map_err(|e| format!("workers: {e}"))?;
    if workers_resp.status != 200 {
        return Err(format!("workers_status_{}", workers_resp.status));
    }
    let parsed: Value =
        serde_json::from_str(&workers_resp.body).map_err(|e| format!("parse: {e}"))?;

    for w in parsed
        .get("workers")
        .and_then(|arr| arr.as_array())
        .cloned()
        .unwrap_or_default()
    {
        let iid = w.get("installation_id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if iid.is_empty() {
            continue;
        }
        workers_seen += 1;

        let mut snapshot: Option<String> = None;
        if let Some(env_str) = w.get("hb_envelope").and_then(|v| v.as_str()) {
            if let Ok(envelopes) = serde_json::from_str::<Value>(env_str) {
                if let Some(mine) = find_own_envelope(&envelopes, key_id) {
                    match unseal_envelope(&secret, mine) {
                        Ok(plain) => snapshot = Some(plain),
                        Err(_) => unseal_failures += 1,
                    }
                } else if envelopes.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                    sealed_to_other_key += 1;
                }
            }
        }

        let label = w.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let role = w.get("role").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let is_active = w.get("is_active").and_then(|v| v.as_i64()).unwrap_or(0);
        let last_seen = w.get("last_seen").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let hb_last_seen = w.get("hb_last_seen").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let quota_cards = w.get("quota_cards_day").and_then(|v| v.as_i64());
        let quota_orders = w.get("quota_orders_day").and_then(|v| v.as_i64());

        db.conn
            .execute(
                "INSERT INTO worker_snapshots (installation_id, label, role, is_active, last_seen, hb_last_seen, snapshot, quota_cards_day, quota_orders_day, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
                 ON CONFLICT(installation_id) DO UPDATE SET
                    label = excluded.label, role = excluded.role, is_active = excluded.is_active,
                    last_seen = excluded.last_seen, hb_last_seen = excluded.hb_last_seen,
                    snapshot = COALESCE(excluded.snapshot, worker_snapshots.snapshot),
                    quota_cards_day = excluded.quota_cards_day,
                    quota_orders_day = excluded.quota_orders_day,
                    updated_at = CURRENT_TIMESTAMP",
                rusqlite::params![
                    iid,
                    label,
                    role,
                    is_active,
                    last_seen,
                    hb_last_seen,
                    snapshot,
                    quota_cards,
                    quota_orders
                ],
            )
            .map_err(|e| format!("snapshot store: {e}"))?;
        snapshots_stored += 1;
    }

    let mut reports_stored = 0usize;
    let to = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = (chrono::Local::now() - chrono::Duration::days(30))
        .format("%Y-%m-%d")
        .to_string();
    let reports_path = format!("/manager/api/reports?from={from}&to={to}");
    let reports_resp =
        http::request(&base, "GET", &reports_path, Some(&token), None)
            .map_err(|e| format!("reports: {e}"))?;
    if reports_resp.status == 200 {
        if let Ok(reports) = serde_json::from_str::<Value>(&reports_resp.body) {
            for r in reports
                .get("reports")
                .and_then(|arr| arr.as_array())
                .cloned()
                .unwrap_or_default()
            {
                let iid = r.get("installation_id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let kind = r.get("kind").and_then(|v| v.as_str()).unwrap_or("daily_stats").to_string();
                let date = r.get("report_date").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                let label = r.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if iid.is_empty() || date.is_empty() {
                    continue;
                }
                let payload = r
                    .get("envelopes")
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .and_then(|envs| find_own_envelope(&envs, key_id).cloned())
                    .and_then(|mine| unseal_envelope(&secret, &mine).ok());
                if let Some(payload) = payload {
                    db.conn
                        .execute(
                            "INSERT INTO reports (installation_id, label, kind, report_date, payload)
                             VALUES (?1, ?2, ?3, ?4, ?5)
                             ON CONFLICT(installation_id, kind, report_date) DO UPDATE SET
                                payload = excluded.payload, label = excluded.label",
                            rusqlite::params![iid, label, kind, date, payload],
                        )
                        .map_err(|e| format!("report store: {e}"))?;
                    reports_stored += 1;
                }
            }
        }
    }

    let rollups = rollup_reports(db).unwrap_or_else(|e| {
        db.log_event("rollup_fail", &e);
        json!({ "rolled": 0, "deleted": 0 })
    });

    let alerts = crate::alerts::evaluate(db).unwrap_or_else(|e| {
        db.log_event("alert_eval_fail", &e);
        json!({ "evaluated": 0, "alerts_new": 0, "new_alerts": [] })
    });

    db.log_event("sync", &format!("workers={workers_seen} reports={reports_stored}"));
    Ok(json!({
        "ok": true,
        "workers": workers_seen,
        "snapshots": snapshots_stored,
        "reports": reports_stored,
        "sealed_to_other_key": sealed_to_other_key,
        "unseal_failures": unseal_failures,
        "alerts_new": alerts.get("alerts_new").and_then(|v| v.as_i64()).unwrap_or(0),
        "new_alerts": alerts.get("new_alerts").cloned().unwrap_or(json!([])),
        "rollup": rollups,
    }))
}

fn vi64(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

fn vobj<'a>(v: &'a Value, key: &str) -> Option<&'a serde_json::Map<String, Value>> {
    v.get(key).and_then(|x| x.as_object())
}

/// MGR-022: месяцы ("YYYY-MM"), ПОЛНОСТЬЮ покрытые диапазоном [from, to].
/// Только за них rollup подмешивается в аналитику — частичный месяц
/// задваивал бы данные сырого хвоста (или занижал — при вырезании дней).
fn months_fully_inside(from: &str, to: &str) -> Vec<String> {
    let parse = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    let (f, t) = match (parse(from), parse(to)) {
        (Some(f), Some(t)) => (f, t),
        _ => return Vec::new(),
    };
    let first_full = if f.day() == 1 {
        f
    } else {
        // первое число следующего месяца
        let next = if f.month() == 12 {
            chrono::NaiveDate::from_ymd_opt(f.year() + 1, 1, 1)
        } else {
            chrono::NaiveDate::from_ymd_opt(f.year(), f.month() + 1, 1)
        };
        match next { Some(d) => d, None => return Vec::new() }
    };
    let mut out = Vec::new();
    let mut cur = first_full;
    loop {
        let (y, m) = (cur.year(), cur.month());
        let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
        let next = match chrono::NaiveDate::from_ymd_opt(ny, nm, 1) {
            Some(d) => d,
            None => break,
        };
        let last_day = next - chrono::Duration::days(1);
        if last_day > t {
            break;
        }
        out.push(format!("{:04}-{:02}", y, m));
        cur = next;
        if out.len() > 600 {
            break;
        }
    }
    out
}

pub fn analytics(db: &Database, from: &str, to: &str) -> Result<Value, String> {
    // MGR-022: UNION подмешивает месячные rollup'ы (is_rollup=1) — месяц либо
    // целиком сырой, либо целиком свёрнут (rollup_reports), задвоения нет.
    let months = months_fully_inside(from, to);
    let (m_from, m_to) = (
        months.first().cloned().unwrap_or_else(|| "0000-00".into()),
        months.last().cloned().unwrap_or_else(|| "0000-00".into()),
    );
    let mut stmt = db
        .conn
        .prepare(
            "SELECT installation_id, label, report_date, payload, 0 FROM reports
             WHERE kind = 'daily_stats' AND report_date >= ?1 AND report_date <= ?2
             UNION ALL
             SELECT installation_id, NULL, month, payload, 1 FROM report_rollups
             WHERE month >= ?3 AND month <= ?4",
        )
        .map_err(|e| format!("select: {e}"))?;

    let rows = stmt
        .query_map(rusqlite::params![from, to, m_from, m_to], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut rollup_months = 0usize;

    let mut orders_total = 0i64;
    let mut orders_by_status: std::collections::BTreeMap<String, i64> = Default::default();
    let mut cards_taken = 0i64;
    let mut cards_used = 0i64;
    let mut cards_dead = 0i64;
    let mut drops_taken = 0i64;
    let mut by_bin: std::collections::HashMap<String, (i64, i64)> = Default::default();
    let mut by_shop: std::collections::HashMap<String, (i64, i64, i64, i64, f64)> = Default::default();
    let mut by_worker: std::collections::HashMap<String, (String, i64, i64, i64, i64)> = Default::default();
    let mut drops_dest: std::collections::HashMap<String, i64> = Default::default();
    let mut health = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
    let mut days: std::collections::BTreeMap<String, (i64, i64)> = Default::default();
    let mut reports_counted = 0usize;

    for row in rows.flatten() {
        let (iid, label, date, payload, is_rollup) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if is_rollup == 1 { rollup_months += 1; } else { reports_counted += 1; }

        if let Some(orders) = vobj(&v, "orders") {
            let total = orders.get("total").and_then(|x| x.as_i64()).unwrap_or(0);
            orders_total += total;
            if let Some(statuses) = orders.get("by_status").and_then(|x| x.as_object()) {
                for (k, val) in statuses {
                    *orders_by_status.entry(k.clone()).or_default() += val.as_i64().unwrap_or(0);
                }
            }
        }
        if let Some(cards) = vobj(&v, "cards") {
            cards_taken += vi64(&v_json(&v, "cards"), "taken");
            cards_used += vi64(&v_json(&v, "cards"), "used");
            cards_dead += vi64(&v_json(&v, "cards"), "dead");
            if let Some(bins) = cards.get("by_bin").and_then(|x| x.as_object()) {
                for (bin, stats) in bins {
                    let entry = by_bin.entry(bin.clone()).or_default();
                    entry.0 += stats.get("used").and_then(|x| x.as_i64()).unwrap_or(0);
                    entry.1 += stats.get("dead").and_then(|x| x.as_i64()).unwrap_or(0);
                }
            }
        }
        if let Some(drops) = vobj(&v, "drops") {
            drops_taken += drops.get("taken").and_then(|x| x.as_i64()).unwrap_or(0);
            if let Some(dests) = drops.get("by_destination").and_then(|x| x.as_object()) {
                for (dest, count) in dests {
                    *drops_dest.entry(dest.clone()).or_default() += count.as_i64().unwrap_or(0);
                }
            }
        }
        if let Some(shops) = vobj(&v, "shops") {
            for (shop, stats) in shops {
                let entry = by_shop.entry(shop.clone()).or_default();
                entry.0 += vi64(stats, "orders");
                entry.1 += vi64(stats, "delivered");
                entry.2 += vi64(stats, "declined");
                entry.3 += vi64(stats, "cancelled");
                entry.4 += stats.get("revenue").and_then(|x| x.as_f64()).unwrap_or(0.0);
            }
        }
        if let Some(h) = vobj(&v, "health") {
            health.0 += vi64_w(h, "imap_ok");
            health.1 += vi64_w(h, "imap_fail");
            health.2 += vi64_w(h, "smtp_ok");
            health.3 += vi64_w(h, "smtp_fail");
            health.4 += vi64_w(h, "proxy_ok");
            health.5 += vi64_w(h, "proxy_fail");
        }

        let worker = by_worker
            .entry(iid.clone())
            .or_insert_with(|| (label.clone().unwrap_or_default(), 0, 0, 0, 0));
        worker.1 += vi64(&v_json(&v, "cards"), "taken");
        worker.2 += v.get("orders").and_then(|o| o.get("total")).and_then(|x| x.as_i64()).unwrap_or(0);
        worker.3 += v.get("drops").and_then(|d| d.get("taken")).and_then(|x| x.as_i64()).unwrap_or(0);
        worker.4 += vi64(&v_json(&v, "cards"), "dead");

        if is_rollup == 0 {
            // rollup-строки («YYYY-MM») в дневной серии не участвуют
            let day = days.entry(date.clone()).or_default();
            day.0 += v.get("orders").and_then(|o| o.get("total")).and_then(|x| x.as_i64()).unwrap_or(0);
            day.1 += vi64(&v_json(&v, "cards"), "dead");
        }
    }

    let mut bins: Vec<Value> = by_bin
        .into_iter()
        .filter(|(_, v)| v.0 > 0)
        .map(|(bin, (used, dead))| {
            json!({
                "bin": bin,
                "used": used,
                "dead": dead,
                "dead_ratio": (dead as f64 / used as f64 * 1000.0).round() / 10.0,
            })
        })
        .collect();
    bins.sort_by_key(|b| -b.get("used").and_then(|u| u.as_i64()).unwrap_or(0));
    bins.truncate(40);

    let mut shops: Vec<Value> = by_shop
        .into_iter()
        .map(|(shop, (orders, delivered, declined, cancelled, revenue))| {
            json!({
                "shop": shop,
                "orders": orders,
                "delivered": delivered,
                "declined": declined,
                "cancelled": cancelled,
                "revenue": (revenue * 100.0).round() / 100.0,
                "decline_ratio": if orders > 0 { ((declined as f64 / orders as f64) * 1000.0).round() / 10.0 } else { 0.0 },
            })
        })
        .collect();
    shops.sort_by_key(|s| -s.get("orders").and_then(|o| o.as_i64()).unwrap_or(0));

    let mut workers: Vec<Value> = by_worker
        .into_iter()
        .map(|(iid, (label, cards_taken, orders, drops, dead))| {
            json!({
                "installation_id": iid,
                "label": label,
                "cards_taken": cards_taken,
                "orders": orders,
                "drops_taken": drops,
                "cards_dead": dead,
                "dead_ratio": if cards_taken > 0 { ((dead as f64 / cards_taken as f64) * 1000.0).round() / 10.0 } else { 0.0 },
            })
        })
        .collect();
    workers.sort_by_key(|w| -w.get("orders").and_then(|o| o.as_i64()).unwrap_or(0));

    let mut dests: Vec<Value> = drops_dest
        .into_iter()
        .map(|(destination, count)| json!({ "destination": destination, "count": count }))
        .collect();
    dests.sort_by_key(|d| -d.get("count").and_then(|c| c.as_i64()).unwrap_or(0));
    dests.truncate(25);

    let days_out: Vec<Value> = days
        .into_iter()
        .map(|(date, (orders, dead))| json!({ "date": date, "orders": orders, "dead": dead }))
        .collect();

    // MGR-022: воронка taken → used → delivered (приближение: заказов и карт
    // не обязано быть поровну — см. AGENTS/README; delivered берём из заказов).
    let delivered_cnt = orders_by_status.get("delivered").copied().unwrap_or(0);
    let pct = |num: i64, den: i64| if den > 0 { ((num as f64 / den as f64) * 1000.0).round() / 10.0 } else { 0.0 };

    Ok(json!({
        "from": from,
        "to": to,
        "reports": reports_counted,
        "rollup_months": rollup_months,
        "orders_total": orders_total,
        "orders_by_status": orders_by_status,
        "cards_taken": cards_taken,
        "cards_used": cards_used,
        "cards_dead": cards_dead,
        "dead_ratio": if cards_taken > 0 { ((cards_dead as f64 / cards_taken as f64) * 1000.0).round() / 10.0 } else { 0.0 },
        "funnel": {
            "taken": cards_taken,
            "used": cards_used,
            "delivered": delivered_cnt,
            "used_rate": pct(cards_used, cards_taken),
            "delivered_rate": pct(delivered_cnt, cards_used),
        },
        "drops_taken": drops_taken,
        "by_bin": bins,
        "by_shop": shops,
        "by_worker": workers,
        "drops_destinations": dests,
        "health": {
            "imap_ok": health.0, "imap_fail": health.1,
            "smtp_ok": health.2, "smtp_fail": health.3,
            "proxy_ok": health.4, "proxy_fail": health.5,
        },
        "days": days_out,
    }))
}

/// MGR-022: "2.11.3" → (2,11,3) для сравнения версий; суффиксы отбрасываем.
fn semver_key(s: &str) -> Option<(u32, u32, u32)> {
    let core = s.split(['-', '+']).next()?;
    let mut it = core.split('.');
    let maj = it.next()?.parse().ok()?;
    let min = it.next().unwrap_or("0").parse().ok()?;
    let pat = it.next().unwrap_or("0").parse().ok()?;
    Some((maj, min, pat))
}

/// MGR-022: сравнение воркеров за диапазон: объёмы, воронка, SLA, версии.
/// Сырые отчёты диапазона + rollup'ы месяцев, полностью внутри него.
/// app_version — из САМОГО СВЕЖЕГО payload'а воркера (независимо от диапазона,
/// дрейф версий не должен зависеть от выбранных дат).
pub fn fleet_comparison(db: &Database, from: &str, to: &str) -> Result<Value, String> {
    let months = months_fully_inside(from, to);
    let (m_from, m_to) = (
        months.first().cloned().unwrap_or_else(|| "0000-00".into()),
        months.last().cloned().unwrap_or_else(|| "0000-00".into()),
    );
    let mut stmt = db
        .conn
        .prepare(
            "SELECT installation_id, report_date, payload, 0 AS ro FROM reports
             WHERE kind = 'daily_stats' AND report_date >= ?1 AND report_date <= ?2
             UNION ALL
             SELECT installation_id, month, payload, 1 FROM report_rollups
             WHERE month >= ?3 AND month <= ?4
             UNION ALL
             SELECT installation_id, report_date, payload, 2 FROM reports
             WHERE kind = 'daily_stats' AND (installation_id, report_date) IN
               (SELECT installation_id, MAX(report_date) FROM reports
                WHERE kind = 'daily_stats' GROUP BY installation_id)",
        )
        .map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![from, to, m_from, m_to], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    #[derive(Default)]
    struct W {
        days: i64, orders: i64, delivered: i64, declined: i64, cancelled: i64,
        taken: i64, used: i64, dead: i64, drops: i64, revenue: f64,
        err_fails: i64, sla_num: f64, sla_den: i64,
        ver_key: String, app_version: String,
    }
    let mut workers: std::collections::HashMap<String, W> = Default::default();

    #[derive(Default)]
    struct Op {
        orders: i64, delivered: i64, declined: i64, taken: i64, revenue: f64,
    }
    let mut ops: std::collections::HashMap<String, Op> = Default::default();

    for row in rows.flatten() {
        let (iid, date, payload, ro) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let w = workers.entry(iid).or_default();
        if ro == 2 {
            // свежая версия: строка с максимальной report_date воркера
            if let Some(ver) = v.get("app_version").and_then(|x| x.as_str()) {
                if !ver.is_empty() && date >= w.ver_key {
                    w.ver_key = date;
                    w.app_version = ver.to_string();
                }
            }
            continue;
        }
        if ro == 1 {
            // fallback: версия из rollup'а, если сырых отчётов не осталось
            if let Some(ver) = v.get("app_version").and_then(|x| x.as_str()) {
                if !ver.is_empty() && w.app_version.is_empty() && date >= w.ver_key {
                    w.ver_key = date.clone();
                    w.app_version = ver.to_string();
                }
            }
        }
        w.days += if ro == 1 { vi64(&v, "days_count").max(1) } else { 1 };
        let d = parse_day(&v);
        w.orders += d.orders;
        w.delivered += d.delivered;
        w.declined += d.declined;
        w.cancelled += d.cancelled;
        w.taken += d.cards_taken;
        w.dead += d.cards_dead;
        w.drops += d.drops;
        w.used += vobj(&v, "cards").map(|c| vi64_w(c, "used")).unwrap_or(0);
        w.err_fails += d.imap_fail + d.smtp_fail + d.proxy_fail;
        if let Some(shops) = vobj(&v, "shops") {
            for s in shops.values() {
                w.revenue += s.get("revenue").and_then(|x| x.as_f64()).unwrap_or(0.0);
            }
        }
        if let Some(sla) = vobj(&v, "sla") {
            let cnt = vi64_w(sla, "orders_delivered");
            if let (Some(avg), true) = (
                sla.get("avg_hours_created_to_delivered").and_then(|x| x.as_f64()),
                cnt > 0,
            ) {
                w.sla_num += avg * cnt as f64;
                w.sla_den += cnt;
            }
        }
        if let Some(bu) = vobj(&v, "by_user") {
            for (name, st) in bu {
                let e = ops.entry(name.clone()).or_default();
                e.orders += vi64(st, "orders");
                e.delivered += vi64(st, "delivered");
                e.declined += vi64(st, "declined");
                e.taken += vi64(st, "cards_taken");
                e.revenue += st.get("revenue").and_then(|x| x.as_f64()).unwrap_or(0.0);
            }
        }
    }

    // снапшоты: label/role/is_active/last_seen
    let mut snaps: std::collections::HashMap<String, (String, String, i64, String, String)> = Default::default();
    if let Ok(mut st) = db.conn.prepare(
        "SELECT installation_id, label, role, is_active, \
                COALESCE(last_seen,''), COALESCE(hb_last_seen,'') FROM worker_snapshots",
    ) {
        if let Ok(rs) = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ),
            ))
        }) {
            for r in rs.flatten() {
                snaps.insert(r.0, r.1);
            }
        }
    }

    let fleet_max_ver = workers
        .values()
        .filter_map(|w| semver_key(&w.app_version))
        .max();

    let pct = |num: i64, den: i64| if den > 0 { ((num as f64 / den as f64) * 1000.0).round() / 10.0 } else { 0.0 };
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let mut out_workers: Vec<Value> = Vec::new();
    let mut fleet = W::default();
    for (iid, w) in &workers {
        let (label, role, is_active, last_seen, hb_last_seen) =
            snaps.get(iid).cloned().unwrap_or_default();
        fleet.days += w.days;
        fleet.orders += w.orders;
        fleet.delivered += w.delivered;
        fleet.declined += w.declined;
        fleet.taken += w.taken;
        fleet.used += w.used;
        fleet.dead += w.dead;
        fleet.revenue += w.revenue;
        fleet.sla_num += w.sla_num;
        fleet.sla_den += w.sla_den;
        let wkey = semver_key(&w.app_version);
        out_workers.push(json!({
            "installation_id": iid,
            "label": label,
            "role": role,
            "is_active": is_active,
            "last_seen": last_seen,
            "hb_last_seen": hb_last_seen,
            "days": w.days,
            "orders": w.orders,
            "delivered": w.delivered,
            "declined": w.declined,
            "cancelled": w.cancelled,
            "delivery_rate": pct(w.delivered, w.orders),
            "decline_rate": pct(w.declined, w.orders),
            "revenue": (w.revenue * 100.0).round() / 100.0,
            "cards_taken": w.taken,
            "cards_used": w.used,
            "cards_dead": w.dead,
            "dead_ratio": pct(w.dead, w.taken),
            "drops": w.drops,
            "err_fails": w.err_fails,
            "funnel_used_rate": pct(w.used, w.taken),
            "funnel_delivered_rate": pct(w.delivered, w.used),
            "avg_hours_to_delivered": if w.sla_den > 0 { Some(r1(w.sla_num / w.sla_den as f64)) } else { None },
            "app_version": w.app_version,
            "version_outdated": match (wkey, fleet_max_ver) {
                (Some(k), Some(mx)) => k < mx,
                _ => false,
            },
        }));
    }
    out_workers.sort_by_key(|w| -(w.get("orders").and_then(|o| o.as_i64()).unwrap_or(0)));

    let mut out_ops: Vec<Value> = ops
        .into_iter()
        .map(|(name, o)| json!({
            "name": name,
            "orders": o.orders,
            "delivered": o.delivered,
            "declined": o.declined,
            "delivery_rate": pct(o.delivered, o.orders),
            "decline_rate": pct(o.declined, o.orders),
            "revenue": (o.revenue * 100.0).round() / 100.0,
            "cards_taken": o.taken,
        }))
        .collect();
    out_ops.sort_by_key(|o| -(o.get("orders").and_then(|x| x.as_i64()).unwrap_or(0)));
    out_ops.truncate(50);

    Ok(json!({
        "from": from,
        "to": to,
        "fleet": {
            "workers": workers.len(),
            "orders": fleet.orders,
            "delivered": fleet.delivered,
            "declined": fleet.declined,
            "delivery_rate": pct(fleet.delivered, fleet.orders),
            "decline_rate": pct(fleet.declined, fleet.orders),
            "revenue": (fleet.revenue * 100.0).round() / 100.0,
            "cards_taken": fleet.taken,
            "cards_used": fleet.used,
            "cards_dead": fleet.dead,
            "funnel_used_rate": pct(fleet.used, fleet.taken),
            "funnel_delivered_rate": pct(fleet.delivered, fleet.used),
            "avg_hours_to_delivered": if fleet.sla_den > 0 { Some(r1(fleet.sla_num / fleet.sla_den as f64)) } else { None },
        },
        "workers": out_workers,
        "operators": out_ops,
    }))
}

/// MGR-022: флотовая теплокарта BIN×шоп — агрегат массивов bin_shop
/// из дневных payload'ов (и rollup'ов полностью покрытых месяцев).
pub fn fleet_bin_shop(db: &Database, from: &str, to: &str) -> Result<Value, String> {
    let months = months_fully_inside(from, to);
    let (m_from, m_to) = (
        months.first().cloned().unwrap_or_else(|| "0000-00".into()),
        months.last().cloned().unwrap_or_else(|| "0000-00".into()),
    );
    let mut stmt = db
        .conn
        .prepare(
            "SELECT payload FROM reports
             WHERE kind = 'daily_stats' AND report_date >= ?1 AND report_date <= ?2
             UNION ALL
             SELECT payload FROM report_rollups WHERE month >= ?3 AND month <= ?4",
        )
        .map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![from, to, m_from, m_to], |row| row.get::<_, String>(0))
        .map_err(|e| format!("query: {e}"))?;

    let mut agg: std::collections::HashMap<(String, String), (i64, i64, i64)> = Default::default();
    let mut reports_used = 0usize;
    for payload in rows.flatten() {
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(arr) = v.get("bin_shop").and_then(|x| x.as_array()) {
            if !arr.is_empty() {
                reports_used += 1;
            }
            for p in arr {
                let bin = p.get("bin").and_then(|x| x.as_str()).unwrap_or("?").to_string();
                let shop = p.get("shop").and_then(|x| x.as_str()).unwrap_or("?").to_string();
                let e = agg.entry((bin, shop)).or_default();
                e.0 += p.get("orders").and_then(|x| x.as_i64()).unwrap_or(0);
                e.1 += p.get("ok").and_then(|x| x.as_i64()).unwrap_or(0);
                e.2 += p.get("declined").and_then(|x| x.as_i64()).unwrap_or(0);
            }
        }
    }

    let mut cells: Vec<Value> = agg
        .into_iter()
        .filter(|(_, v)| v.0 > 0)
        .map(|((bin, shop), (orders, ok, declined))| {
            json!({
                "bin": bin, "shop": shop, "orders": orders, "ok": ok,
                "declined": declined,
                "success_rate": ((ok as f64 / orders as f64) * 1000.0).round() / 10.0,
            })
        })
        .collect();
    cells.sort_by_key(|c| -(c.get("orders").and_then(|o| o.as_i64()).unwrap_or(0)));
    cells.truncate(200);
    Ok(json!({ "from": from, "to": to, "reports": reports_used, "cells": cells }))
}

/// MGR-022: месячный агрегат в форме daily_stats (суммы по дням) — тогда
/// analytics/fleet_* парсят rollup тем же кодом, что и сырой отчёт.
/// SLA — взвешенное среднее по orders_delivered, app_version — последняя за месяц.
fn build_month_rollup(month: &str, days: &[(String, Value)]) -> Value {
    let mut by_status: std::collections::BTreeMap<String, i64> = Default::default();
    let mut orders_total = 0i64;
    let mut by_user: std::collections::HashMap<String, serde_json::Map<String, Value>> = Default::default();
    let mut by_bin: std::collections::HashMap<String, (i64, i64)> = Default::default();
    let mut by_shop: std::collections::HashMap<String, (i64, i64, i64, i64, f64)> = Default::default();
    let mut bin_shop: std::collections::HashMap<(String, String), (i64, i64, i64)> = Default::default();
    let mut drops_dest: std::collections::HashMap<String, i64> = Default::default();
    let mut cards = (0i64, 0i64, 0i64);
    let mut drops_taken = 0i64;
    let mut health = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
    let mut sync = (0i64, 0i64, 0i64);
    let mut sla_num = 0f64;
    let mut sla_den = 0i64;
    let mut app_version = String::new();
    let mut app_date = String::new();

    for (date, v) in days {
        if let Some(o) = vobj(v, "orders") {
            orders_total += vi64_w(o, "total");
            if let Some(bs) = o.get("by_status").and_then(|x| x.as_object()) {
                for (k, val) in bs {
                    *by_status.entry(k.clone()).or_default() += val.as_i64().unwrap_or(0);
                }
            }
        }
        if let Some(bu) = vobj(v, "by_user") {
            for (name, st) in bu {
                let e = by_user.entry(name.clone()).or_default();
                for k in ["orders", "delivered", "declined", "revenue", "cards_taken"] {
                    let prev = e.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
                    let add = st.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
                    e.insert(k.into(), json!(((prev + add) * 100.0).round() / 100.0));
                }
            }
        }
        if let Some(c) = vobj(v, "cards") {
            cards.0 += vi64_w(c, "taken");
            cards.1 += vi64_w(c, "used");
            cards.2 += vi64_w(c, "dead");
            if let Some(bins) = c.get("by_bin").and_then(|x| x.as_object()) {
                for (bin, st) in bins {
                    let e = by_bin.entry(bin.clone()).or_default();
                    e.0 += vi64(st, "used");
                    e.1 += vi64(st, "dead");
                }
            }
        }
        if let Some(d) = vobj(v, "drops") {
            drops_taken += vi64_w(d, "taken");
            if let Some(dests) = d.get("by_destination").and_then(|x| x.as_object()) {
                for (k, val) in dests {
                    *drops_dest.entry(k.clone()).or_default() += val.as_i64().unwrap_or(0);
                }
            }
        }
        if let Some(shops) = vobj(v, "shops") {
            for (shop, st) in shops {
                let e = by_shop.entry(shop.clone()).or_default();
                e.0 += vi64(st, "orders");
                e.1 += vi64(st, "delivered");
                e.2 += vi64(st, "declined");
                e.3 += vi64(st, "cancelled");
                e.4 += st.get("revenue").and_then(|x| x.as_f64()).unwrap_or(0.0);
            }
        }
        if let Some(arr) = v.get("bin_shop").and_then(|x| x.as_array()) {
            for p in arr {
                let key = (
                    p.get("bin").and_then(|x| x.as_str()).unwrap_or("?").to_string(),
                    p.get("shop").and_then(|x| x.as_str()).unwrap_or("?").to_string(),
                );
                let e = bin_shop.entry(key).or_default();
                e.0 += vi64(p, "orders");
                e.1 += vi64(p, "ok");
                e.2 += vi64(p, "declined");
            }
        }
        if let Some(h) = vobj(v, "health") {
            health.0 += vi64_w(h, "imap_ok");
            health.1 += vi64_w(h, "imap_fail");
            health.2 += vi64_w(h, "smtp_ok");
            health.3 += vi64_w(h, "smtp_fail");
            health.4 += vi64_w(h, "proxy_ok");
            health.5 += vi64_w(h, "proxy_fail");
        }
        if let Some(s) = vobj(v, "sync") {
            sync.0 += vi64_w(s, "ws_ok_days");
            sync.1 += vi64_w(s, "push_ok");
            sync.2 += vi64_w(s, "push_fail");
        }
        if let Some(sla) = vobj(v, "sla") {
            let cnt = vi64_w(sla, "orders_delivered");
            if let (Some(avg), true) = (
                sla.get("avg_hours_created_to_delivered").and_then(|x| x.as_f64()),
                cnt > 0,
            ) {
                sla_num += avg * cnt as f64;
                sla_den += cnt;
            }
        }
        if let Some(ver) = v.get("app_version").and_then(|x| x.as_str()) {
            if !ver.is_empty() && date.as_str() >= app_date.as_str() {
                app_date = date.clone();
                app_version = ver.to_string();
            }
        }
    }

    let shops: serde_json::Map<String, Value> = by_shop
        .into_iter()
        .map(|(k, (o, d, dec, c, r))| {
            (k, json!({
                "orders": o, "delivered": d, "declined": dec, "cancelled": c,
                "revenue": (r * 100.0).round() / 100.0,
            }))
        })
        .collect();
    let bins: serde_json::Map<String, Value> = by_bin
        .into_iter()
        .map(|(k, (u, d))| (k, json!({ "used": u, "dead": d })))
        .collect();
    let pairs: Vec<Value> = bin_shop
        .into_iter()
        .map(|((b, s), (o, ok, d))| json!({ "bin": b, "shop": s, "orders": o, "ok": ok, "declined": d }))
        .collect();

    json!({
        "payload_version": 2,
        "rolled_up": true,
        "month": month,
        "days_count": days.len() as i64,
        "app_version": app_version,
        "orders": { "total": orders_total, "by_status": by_status },
        "by_user": by_user,
        "cards": { "taken": cards.0, "used": cards.1, "dead": cards.2, "by_bin": bins },
        "drops": { "taken": drops_taken, "by_destination": drops_dest },
        "shops": shops,
        "bin_shop": pairs,
        "sla": {
            "avg_hours_created_to_delivered": if sla_den > 0 {
                Some((( sla_num / sla_den as f64) * 10.0).round() / 10.0)
            } else { None },
            "orders_delivered": sla_den,
        },
        "health": {
            "imap_ok": health.0, "imap_fail": health.1,
            "smtp_ok": health.2, "smtp_fail": health.3,
            "proxy_ok": health.4, "proxy_fail": health.5,
        },
        "sync": { "ws_ok_days": sync.0, "push_ok": sync.1, "push_fail": sync.2 },
    })
}

/// MGR-022: retention — месяц сворачивается ЦЕЛИКОМ и только если полностью
/// старше reports_retention_days (дефолт 90, clamp 30..365): месяц либо
/// сырой, либо свёрнут, поэтому analytics/fleet_* не задваивают данные.
/// Вызывается из sync_telemetry (после заливки свежих отчётов).
pub fn rollup_reports(db: &Database) -> Result<Value, String> {
    let retention: i64 = db
        .get_config("reports_retention_days")
        .and_then(|s| s.parse().ok())
        .unwrap_or(90)
        .clamp(30, 365);
    let cutoff_month = (chrono::Local::now() - chrono::Duration::days(retention))
        .format("%Y-%m")
        .to_string();

    let mut stmt = db
        .conn
        .prepare(
            "SELECT DISTINCT substr(report_date, 1, 7) FROM reports
             WHERE kind = 'daily_stats' AND substr(report_date, 1, 7) < ?1 ORDER BY 1",
        )
        .map_err(|e| format!("select months: {e}"))?;
    let months: Vec<String> = stmt
        .query_map(rusqlite::params![cutoff_month], |row| row.get(0))
        .map_err(|e| format!("months: {e}"))?
        .flatten()
        .collect();

    let mut rolled = 0i64;
    let mut deleted = 0i64;
    for month in months {
        let mut st = db
            .conn
            .prepare(
                "SELECT installation_id, report_date, payload FROM reports
                 WHERE kind = 'daily_stats' AND substr(report_date, 1, 7) = ?1",
            )
            .map_err(|e| format!("select month: {e}"))?;
        let rows = st
            .query_map(rusqlite::params![month], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("month rows: {e}"))?;
        let mut by_iid: std::collections::HashMap<String, Vec<(String, Value)>> = Default::default();
        for row in rows.flatten() {
            if let Ok(v) = serde_json::from_str::<Value>(&row.2) {
                by_iid.entry(row.0).or_default().push((row.1, v));
            }
        }
        for (iid, days) in &by_iid {
            let payload = build_month_rollup(&month, days);
            db.conn
                .execute(
                    "INSERT INTO report_rollups (installation_id, month, payload, days_count)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(installation_id, month) DO UPDATE SET
                        payload = excluded.payload,
                        days_count = excluded.days_count,
                        created_at = CURRENT_TIMESTAMP",
                    rusqlite::params![iid, month, payload.to_string(), days.len() as i64],
                )
                .map_err(|e| format!("rollup upsert: {e}"))?;
            rolled += 1;
        }
        let n = db
            .conn
            .execute(
                "DELETE FROM reports WHERE kind = 'daily_stats' AND substr(report_date, 1, 7) = ?1",
                rusqlite::params![month],
            )
            .map_err(|e| format!("prune: {e}"))?;
        deleted += n as i64;
    }

    if rolled > 0 || deleted > 0 {
        db.log_event("rollup", &format!("rolled={rolled} deleted={deleted} retention={retention}"));
    }
    Ok(json!({ "rolled": rolled, "deleted": deleted, "retention_days": retention }))
}

fn v_json<'a>(v: &'a Value, key: &str) -> Value {
    v.get(key).cloned().unwrap_or(Value::Null)
}

fn vi64_w(map: &serde_json::Map<String, Value>, key: &str) -> i64 {
    map.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

#[derive(Default, Clone, Copy)]
pub(crate) struct DayStats {
    pub(crate) orders: i64,
    pub(crate) delivered: i64,
    pub(crate) declined: i64,
    pub(crate) cancelled: i64,
    pub(crate) cards_taken: i64,
    pub(crate) cards_dead: i64,
    pub(crate) drops: i64,
    pub(crate) imap_ok: i64,
    pub(crate) imap_fail: i64,
    pub(crate) smtp_ok: i64,
    pub(crate) smtp_fail: i64,
    pub(crate) proxy_ok: i64,
    pub(crate) proxy_fail: i64,
}

impl DayStats {
    fn add(&mut self, o: &DayStats) {
        self.orders += o.orders;
        self.delivered += o.delivered;
        self.declined += o.declined;
        self.cancelled += o.cancelled;
        self.cards_taken += o.cards_taken;
        self.cards_dead += o.cards_dead;
        self.drops += o.drops;
        self.imap_ok += o.imap_ok;
        self.imap_fail += o.imap_fail;
        self.smtp_ok += o.smtp_ok;
        self.smtp_fail += o.smtp_fail;
        self.proxy_ok += o.proxy_ok;
        self.proxy_fail += o.proxy_fail;
    }
}

pub(crate) fn parse_day(v: &Value) -> DayStats {
    let mut d = DayStats::default();
    if let Some(orders) = vobj(v, "orders") {
        d.orders = vi64_w(orders, "total");
        if let Some(statuses) = orders.get("by_status").and_then(|x| x.as_object()) {
            d.delivered = vi64_w(statuses, "delivered");
            d.declined = vi64_w(statuses, "declined");
            d.cancelled = vi64_w(statuses, "cancelled");
            if d.orders == 0 {
                d.orders = statuses.values().filter_map(|x| x.as_i64()).sum();
            }
        }
    }
    if let Some(cards) = vobj(v, "cards") {
        d.cards_taken = vi64_w(cards, "taken");
        d.cards_dead = vi64_w(cards, "dead");
    }
    if let Some(drops) = vobj(v, "drops") {
        d.drops = vi64_w(drops, "taken");
    }
    if let Some(h) = vobj(v, "health") {
        d.imap_ok = vi64_w(h, "imap_ok");
        d.imap_fail = vi64_w(h, "imap_fail");
        d.smtp_ok = vi64_w(h, "smtp_ok");
        d.smtp_fail = vi64_w(h, "smtp_fail");
        d.proxy_ok = vi64_w(h, "proxy_ok");
        d.proxy_fail = vi64_w(h, "proxy_fail");
    }
    d
}

fn feed_for_day(date: &str, d: &DayStats) -> Vec<Value> {
    let mut out = Vec::new();
    let mut ev = |kind: &str, code: &str, params: Value| {
        out.push(json!({ "date": date, "kind": kind, "code": code, "params": params }));
    };
    if d.orders >= 3 && d.declined * 2 >= d.orders {
        ev("fail", "decline_spike", json!({ "declined": d.declined, "orders": d.orders }));
    }
    if d.cards_dead >= 3 {
        ev("fail", "dead_cards", json!({ "dead": d.cards_dead }));
    }
    if d.imap_fail > 0 && d.imap_ok == 0 {
        ev("fail", "imap_down", json!({ "fails": d.imap_fail }));
    }
    if d.smtp_fail > 0 && d.smtp_ok == 0 {
        ev("fail", "smtp_down", json!({ "fails": d.smtp_fail }));
    }
    if d.proxy_fail > 0 && d.proxy_ok == 0 {
        ev("fail", "proxy_down", json!({ "fails": d.proxy_fail }));
    }
    if d.orders >= 3 && d.declined == 0 && d.cards_dead == 0 {
        ev("success", "clean_day", json!({ "orders": d.orders }));
    }
    if d.orders >= 10 {
        ev("success", "high_volume", json!({ "orders": d.orders }));
    }
    if d.orders == 0 && d.cards_taken == 0 && d.drops == 0 {
        ev("info", "idle_day", json!({}));
    }
    out
}

pub fn worker_stats(db: &Database, installation_id: &str, days: i64) -> Result<Value, String> {
    let days = days.clamp(1, 90);
    let from = (chrono::Local::now() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = db
        .conn
        .prepare(
            "SELECT label, report_date, payload FROM reports
             WHERE installation_id = ?1 AND kind = 'daily_stats' AND report_date >= ?2
             ORDER BY report_date ASC",
        )
        .map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![installation_id, from], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut label = String::new();
    let mut reports = 0usize;
    let mut totals = DayStats::default();
    let mut by_day: Vec<Value> = Vec::new();
    let mut feed: Vec<Value> = Vec::new();
    let mut days_seq: Vec<(String, DayStats)> = Vec::new();

    for row in rows.flatten() {
        let (lbl, date, payload) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        reports += 1;
        if let Some(l) = lbl {
            if !l.is_empty() {
                label = l;
            }
        }
        let d = parse_day(&v);
        totals.add(&d);
        by_day.push(json!({
            "date": date,
            "orders": d.orders,
            "delivered": d.delivered,
            "declined": d.declined,
            "dead": d.cards_dead,
        }));
        feed.extend(feed_for_day(&date, &d));
        days_seq.push((date, d));
    }

    let mut streak = 0i64;
    for (_, d) in days_seq.iter().rev() {
        if d.orders > 0 && d.declined == 0 && d.cards_dead == 0 {
            streak += 1;
        } else {
            break;
        }
    }
    if streak >= 3 {
        let date = days_seq.last().map(|(d, _)| d.clone()).unwrap_or_default();
        feed.push(json!({ "date": date, "kind": "success", "code": "clean_streak", "params": { "n": streak } }));
    }

    feed.sort_by(|a, b| {
        let da = a.get("date").and_then(|x| x.as_str()).unwrap_or("");
        let db_ = b.get("date").and_then(|x| x.as_str()).unwrap_or("");
        db_.cmp(da)
    });
    feed.truncate(40);

    let dead_ratio = if totals.cards_taken > 0 {
        ((totals.cards_dead as f64 / totals.cards_taken as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    Ok(json!({
        "installation_id": installation_id,
        "label": label,
        "days": days,
        "reports": reports,
        "totals": {
            "orders": totals.orders,
            "delivered": totals.delivered,
            "declined": totals.declined,
            "cancelled": totals.cancelled,
            "cards_taken": totals.cards_taken,
            "cards_dead": totals.cards_dead,
            "dead_ratio": dead_ratio,
            "drops": totals.drops,
            "imap_ok": totals.imap_ok, "imap_fail": totals.imap_fail,
            "smtp_ok": totals.smtp_ok, "smtp_fail": totals.smtp_fail,
            "proxy_ok": totals.proxy_ok, "proxy_fail": totals.proxy_fail,
        },
        "by_day": by_day,
        "feed": feed,
    }))
}

pub fn worker_snapshots(db: &Database) -> Result<Value, String> {
    let mut stmt = db
        .conn
        .prepare(
            "SELECT installation_id, label, role, is_active, last_seen, hb_last_seen, snapshot, updated_at
             FROM worker_snapshots ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut out = Vec::new();
    for row in rows.flatten() {
        let (iid, label, role, is_active, last_seen, hb_last_seen, snapshot, updated_at) = row;
        out.push(json!({
            "installation_id": iid,
            "label": label.unwrap_or_default(),
            "role": role.unwrap_or_default(),
            "is_active": is_active,
            "last_seen": last_seen.unwrap_or_default(),
            "hb_last_seen": hb_last_seen.unwrap_or_default(),
            "snapshot": serde_json::from_str::<Value>(&snapshot.unwrap_or_default()).unwrap_or(Value::Null),
            "updated_at": updated_at.unwrap_or_default(),
        }));
    }
    Ok(json!({ "snapshots": out }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let db = Database::open_plain(path.to_str().unwrap()).unwrap();
        (dir, db)
    }

    fn insert_report(db: &Database, iid: &str, date: &str, payload: &str) {
        db.conn
            .execute(
                "INSERT INTO reports (installation_id, label, kind, report_date, payload)
                 VALUES (?1, 'W', 'daily_stats', ?2, ?3)",
                rusqlite::params![iid, date, payload],
            )
            .unwrap();
    }

    fn date_days_ago(n: i64) -> String {
        (chrono::Local::now() - chrono::Duration::days(n))
            .format("%Y-%m-%d")
            .to_string()
    }

    fn codes(feed: &Value) -> Vec<String> {
        feed.as_array()
            .unwrap()
            .iter()
            .map(|e| e["code"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn worker_stats_aggregates_and_flags_bad_day() {
        let (_dir, db) = temp_db();
        insert_report(
            &db,
            "w1",
            &date_days_ago(0),
            r#"{"orders":{"total":6,"by_status":{"delivered":3,"declined":3}},
                "cards":{"taken":5,"used":4,"dead":4},
                "drops":{"taken":1},
                "health":{"imap_ok":0,"imap_fail":2,"smtp_ok":3,"smtp_fail":0}}"#,
        );
        let s = worker_stats(&db, "w1", 30).unwrap();
        assert_eq!(s["reports"], 1);
        assert_eq!(s["totals"]["orders"], 6);
        assert_eq!(s["totals"]["declined"], 3);
        assert_eq!(s["totals"]["cards_dead"], 4);
        assert_eq!(s["totals"]["dead_ratio"], 80.0);
        let c = codes(&s["feed"]);
        assert!(c.contains(&"decline_spike".to_string()));
        assert!(c.contains(&"dead_cards".to_string()));
        assert!(c.contains(&"imap_down".to_string()));
        assert!(!c.contains(&"clean_day".to_string()));
    }

    #[test]
    fn worker_stats_clean_streak_and_high_volume() {
        let (_dir, db) = temp_db();
        for n in (0..3).rev() {
            insert_report(
                &db,
                "w1",
                &date_days_ago(n),
                r#"{"orders":{"total":12,"by_status":{"delivered":12}},
                    "cards":{"taken":4,"used":4,"dead":0}}"#,
            );
        }
        let s = worker_stats(&db, "w1", 30).unwrap();
        assert_eq!(s["reports"], 3);
        let c = codes(&s["feed"]);
        assert!(c.contains(&"clean_day".to_string()));
        assert!(c.contains(&"high_volume".to_string()));
        let streak = s["feed"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["code"] == "clean_streak")
            .expect("clean_streak event");
        assert_eq!(streak["params"]["n"], 3);
        assert_eq!(streak["date"].as_str().unwrap(), date_days_ago(0));
    }

    #[test]
    fn worker_stats_streak_breaks_on_dirty_day() {
        let (_dir, db) = temp_db();
        insert_report(&db, "w1", &date_days_ago(2), r#"{"orders":{"total":5,"by_status":{"delivered":5}}}"#);
        insert_report(&db, "w1", &date_days_ago(1), r#"{"orders":{"total":4,"by_status":{"delivered":2,"declined":2}}}"#);
        insert_report(&db, "w1", &date_days_ago(0), r#"{"orders":{"total":5,"by_status":{"delivered":5}}}"#);
        let s = worker_stats(&db, "w1", 30).unwrap();
        let c = codes(&s["feed"]);
        assert!(!c.contains(&"clean_streak".to_string()));
    }

    #[test]
    fn worker_stats_isolated_per_worker_and_empty() {
        let (_dir, db) = temp_db();
        insert_report(
            &db,
            "w2",
            &date_days_ago(1),
            r#"{"orders":{"total":2,"by_status":{"delivered":2}}}"#,
        );
        let s = worker_stats(&db, "w1", 30).unwrap();
        assert_eq!(s["reports"], 0);
        assert_eq!(s["totals"]["orders"], 0);
        assert!(s["feed"].as_array().unwrap().is_empty());
        assert!(s["by_day"].as_array().unwrap().is_empty());
    }

    #[test]
    fn worker_stats_feed_sorted_desc_and_idle_day() {
        let (_dir, db) = temp_db();
        insert_report(&db, "w1", &date_days_ago(2), r#"{"cards":{"taken":1,"dead":5}}"#);
        insert_report(&db, "w1", &date_days_ago(1), r#"{"orders":{"total":0}}"#);
        insert_report(&db, "w1", &date_days_ago(0), r#"{"cards":{"taken":1,"dead":3}}"#);
        let s = worker_stats(&db, "w1", 30).unwrap();
        let feed = s["feed"].as_array().unwrap();
        let dates: Vec<&str> = feed.iter().map(|e| e["date"].as_str().unwrap()).collect();
        let mut sorted = dates.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(dates, sorted);
        let c = codes(&s["feed"]);
        assert!(c.contains(&"idle_day".to_string()));
        assert_eq!(c.iter().filter(|x| *x == "dead_cards").count(), 2);
    }

    // ── MGR-022 ──

    #[test]
    fn analytics_funnel_rates() {
        let (_dir, db) = temp_db();
        insert_report(
            &db, "w1", &date_days_ago(0),
            r#"{"orders":{"total":10,"by_status":{"delivered":4,"declined":2}},
                "cards":{"taken":8,"used":6,"dead":1}}"#,
        );
        let from = date_days_ago(1);
        let to = date_days_ago(0);
        let a = analytics(&db, &from, &to).unwrap();
        assert_eq!(a["funnel"]["taken"], 8);
        assert_eq!(a["funnel"]["used"], 6);
        assert_eq!(a["funnel"]["delivered"], 4);
        assert_eq!(a["funnel"]["used_rate"], 75.0);
        assert_eq!(a["funnel"]["delivered_rate"], 66.7);
        assert_eq!(a["rollup_months"], 0);
    }

    #[test]
    fn fleet_comparison_workers_and_version_drift() {
        let (_dir, db) = temp_db();
        let today = date_days_ago(0);
        insert_report(
            &db, "w1", &today,
            r#"{"app_version":"2.11.3",
                "orders":{"total":10,"by_status":{"delivered":8,"declined":2}},
                "cards":{"taken":10,"used":8,"dead":1},
                "by_user":{"alice":{"orders":7,"delivered":6,"declined":1,"revenue":140.0,"cards_taken":5},
                           "bob":{"orders":3,"delivered":2,"declined":1,"revenue":40.0,"cards_taken":2}},
                "sla":{"avg_hours_created_to_delivered":20.0,"orders_delivered":8}}"#,
        );
        insert_report(
            &db, "w2", &today,
            r#"{"app_version":"2.10.0",
                "orders":{"total":4,"by_status":{"delivered":1,"declined":3}},
                "cards":{"taken":6,"used":3,"dead":3},
                "by_user":{"alice":{"orders":4,"delivered":1,"declined":3,"revenue":20.0,"cards_taken":3}}}"#,
        );
        let from = date_days_ago(1);
        let c = fleet_comparison(&db, &from, &today).unwrap();
        let ws = c["workers"].as_array().unwrap();
        assert_eq!(ws.len(), 2);
        // сортировка по заказам desc: w1 первый
        assert_eq!(ws[0]["installation_id"], "w1");
        assert_eq!(ws[0]["delivery_rate"], 80.0);
        assert_eq!(ws[0]["avg_hours_to_delivered"], 20.0);
        assert_eq!(ws[0]["app_version"], "2.11.3");
        assert_eq!(ws[0]["version_outdated"], false);
        assert_eq!(ws[1]["installation_id"], "w2");
        assert_eq!(ws[1]["version_outdated"], true);
        assert_eq!(ws[1]["funnel_used_rate"], 50.0);
        // флот-сводка
        assert_eq!(c["fleet"]["orders"], 14);
        assert_eq!(c["fleet"]["delivered"], 9);
        // рейтинг операторов: alice суммарно по двум воркерам, сортировка по заказам
        let ops = c["operators"].as_array().unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0]["name"], "alice");
        assert_eq!(ops[0]["orders"], 11);
        assert_eq!(ops[0]["delivered"], 7);
        assert_eq!(ops[0]["delivery_rate"], 63.6);
        assert_eq!(ops[0]["revenue"], 160.0);
        assert_eq!(ops[0]["cards_taken"], 8);
        assert_eq!(ops[1]["name"], "bob");
        assert_eq!(ops[1]["decline_rate"], 33.3);
    }

    #[test]
    fn fleet_bin_shop_aggregates_pairs() {
        let (_dir, db) = temp_db();
        let today = date_days_ago(0);
        insert_report(
            &db, "w1", &today,
            r#"{"bin_shop":[{"bin":"411111","shop":"a.com","orders":3,"ok":2,"declined":1},
                             {"bin":"555555","shop":"b.com","orders":1,"ok":1,"declined":0}]}"#,
        );
        insert_report(
            &db, "w2", &today,
            r#"{"bin_shop":[{"bin":"411111","shop":"a.com","orders":2,"ok":1,"declined":1}]}"#,
        );
        let from = date_days_ago(1);
        let h = fleet_bin_shop(&db, &from, &today).unwrap();
        assert_eq!(h["reports"], 2);
        let cells = h["cells"].as_array().unwrap();
        assert_eq!(cells.len(), 2);
        // топ по заказам: пара 411111×a.com с суммой 3+2
        assert_eq!(cells[0]["bin"], "411111");
        assert_eq!(cells[0]["orders"], 5);
        assert_eq!(cells[0]["ok"], 3);
        assert_eq!(cells[0]["success_rate"], 60.0);
        assert_eq!(cells[1]["bin"], "555555");
    }

    #[test]
    fn rollup_reports_squashes_old_month_and_no_double_count() {
        let (_dir, db) = temp_db();
        // месяц гарантированно старше retention (min 30 дней): позапрошлый
        let old = (chrono::Local::now() - chrono::Duration::days(400))
            .format("%Y-%m")
            .to_string();
        insert_report(
            &db, "w1", &format!("{old}-05"),
            r#"{"app_version":"2.9.0",
                "orders":{"total":5,"by_status":{"delivered":4,"declined":1}},
                "cards":{"taken":5,"used":4,"dead":1},
                "shops":{"a.com":{"orders":5,"delivered":4,"declined":1,"cancelled":0,"revenue":50.0}},
                "sla":{"avg_hours_created_to_delivered":30.0,"orders_delivered":4}}"#,
        );
        insert_report(
            &db, "w1", &format!("{old}-20"),
            r#"{"app_version":"2.9.1",
                "orders":{"total":3,"by_status":{"delivered":3}},
                "cards":{"taken":3,"used":3,"dead":0},
                "shops":{"a.com":{"orders":3,"delivered":3,"declined":0,"cancelled":0,"revenue":30.0}},
                "sla":{"avg_hours_created_to_delivered":10.0,"orders_delivered":3}}"#,
        );

        let r = rollup_reports(&db).unwrap();
        assert_eq!(r["rolled"], 1);
        assert_eq!(r["deleted"], 2);

        // сырых отчётов за месяц не осталось
        let raw: i64 = db.conn
            .query_row(
                "SELECT COUNT(*) FROM reports WHERE kind='daily_stats' AND substr(report_date,1,7)=?1",
                rusqlite::params![old], |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, 0);

        // analytics по ровно этому месяцу — читает rollup, суммы сохранены
        let a = analytics(&db, &format!("{old}-01"), &format!("{old}-31")).unwrap();
        assert_eq!(a["rollup_months"], 1);
        assert_eq!(a["reports"], 0);
        assert_eq!(a["orders_total"], 8);
        assert_eq!(a["cards_taken"], 8);
        assert_eq!(a["cards_used"], 7);
        let shop = a["by_shop"].as_array().unwrap().iter()
            .find(|s| s["shop"] == "a.com").cloned().unwrap_or(json!(null));
        assert_eq!(shop["revenue"], 80.0);
        assert_eq!(shop["orders"], 8);

        // диапазон «месяц + свежий сырой день» — без задвоения
        insert_report(
            &db, "w1", &date_days_ago(0),
            r#"{"orders":{"total":2,"by_status":{"delivered":2}},"cards":{"taken":2,"used":2,"dead":0}}"#,
        );
        let a2 = analytics(&db, &format!("{old}-01"), &date_days_ago(0)).unwrap();
        assert_eq!(a2["orders_total"], 10, "rollup 8 + сырые 2, без дублей");
        assert_eq!(a2["rollup_months"], 1);
        assert_eq!(a2["reports"], 1);

        // fleet_comparison: SLA rollup'а — взвешенное среднее (30*4 + 10*3)/7 ≈ 21.4
        let c = fleet_comparison(&db, &format!("{old}-01"), &format!("{old}-31")).unwrap();
        let w = &c["workers"][0];
        assert_eq!(w["days"], 2);
        assert_eq!(w["avg_hours_to_delivered"], 21.4);
        assert_eq!(w["app_version"], "2.9.1", "последняя версия месяца из rollup'а");
    }

    #[test]
    fn months_fully_inside_edges() {
        assert!(months_fully_inside("2026-01-15", "2026-01-31").is_empty());
        assert_eq!(months_fully_inside("2026-01-01", "2026-01-31"), vec!["2026-01".to_string()]);
        assert_eq!(
            months_fully_inside("2026-01-15", "2026-04-10"),
            vec!["2026-02".to_string(), "2026-03".to_string()]
        );
        // декабрь → январь переход года
        assert_eq!(
            months_fully_inside("2025-12-01", "2026-01-31"),
            vec!["2025-12".to_string(), "2026-01".to_string()]
        );
    }
}
