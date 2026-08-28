use crate::db::Database;
use crate::telemetry::{parse_day, DayStats};
use serde_json::{json, Value};

pub struct AlertCfg {
    pub decline_pct: i64,
    pub dead_pct: i64,
    pub min_orders: i64,
    pub min_cards: i64,
    pub webhook_url: String,
}

fn cfg_i64(db: &Database, key: &str, default: i64) -> i64 {
    db.get_config(key)
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

pub fn load_cfg(db: &Database) -> AlertCfg {
    AlertCfg {
        decline_pct: cfg_i64(db, "alert_decline_pct", 50).clamp(1, 100),
        dead_pct: cfg_i64(db, "alert_dead_pct", 30).clamp(1, 100),
        min_orders: cfg_i64(db, "alert_min_orders", 3).clamp(1, 1000),
        min_cards: cfg_i64(db, "alert_min_cards", 3).clamp(1, 1000),
        webhook_url: db.get_config("alert_webhook_url").unwrap_or_default(),
    }
}

fn insert_alert(
    db: &Database,
    severity: &str,
    category: &str,
    iid: &str,
    label: &str,
    title: String,
    message: String,
    dedupe_key: &str,
) -> Result<Option<Value>, String> {
    let changed = db
        .conn
        .execute(
            "INSERT OR IGNORE INTO local_alerts
                (severity, category, installation_id, label, title, message, dedupe_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![severity, category, iid, label, title, message, dedupe_key],
        )
        .map_err(|e| format!("alert insert: {e}"))?;
    if changed == 0 {
        return Ok(None);
    }
    Ok(Some(json!({
        "severity": severity,
        "category": category,
        "installation_id": iid,
        "label": label,
        "title": title,
        "message": message,
        "source": "local",
    })))
}

fn evaluate_worker(
    db: &Database,
    cfg: &AlertCfg,
    iid: &str,
    label: &str,
    date: &str,
    d: &DayStats,
    quota_cards: Option<i64>,
    quota_orders: Option<i64>,
    out: &mut Vec<Value>,
) -> Result<(), String> {
    let name = if label.is_empty() { iid } else { label };

    if d.orders >= cfg.min_orders && d.declined * 100 >= cfg.decline_pct * d.orders {
        let pct = (d.declined as f64 / d.orders as f64 * 1000.0).round() / 10.0;
        let sev = if d.declined * 100 >= 70 * d.orders { "critical" } else { "warning" };
        if let Some(a) = insert_alert(
            db,
            sev,
            "decline_spike",
            iid,
            label,
            format!("Decline spike: {name}"),
            format!("{pct}% declined ({}/{}) on {date}", d.declined, d.orders),
            &format!("{iid}:decline_spike:{date}"),
        )? {
            out.push(a);
        }
    }

    if d.cards_taken >= cfg.min_cards && d.cards_dead * 100 >= cfg.dead_pct * d.cards_taken {
        let pct = (d.cards_dead as f64 / d.cards_taken as f64 * 1000.0).round() / 10.0;
        let sev = if d.cards_dead * 100 >= 60 * d.cards_taken { "critical" } else { "warning" };
        if let Some(a) = insert_alert(
            db,
            sev,
            "dead_ratio",
            iid,
            label,
            format!("Dead-card ratio: {name}"),
            format!("{pct}% dead ({}/{}) on {date}", d.cards_dead, d.cards_taken),
            &format!("{iid}:dead_ratio:{date}"),
        )? {
            out.push(a);
        }
    }

    if let Some(q) = quota_cards {
        if q > 0 && d.cards_taken >= q {
            if let Some(a) = insert_alert(
                db,
                "info",
                "quota_cards",
                iid,
                label,
                format!("Cards quota reached: {name}"),
                format!("{}/{} cards taken on {date}", d.cards_taken, q),
                &format!("{iid}:quota_cards:{date}"),
            )? {
                out.push(a);
            }
        }
    }

    if let Some(q) = quota_orders {
        if q > 0 && d.orders >= q {
            if let Some(a) = insert_alert(
                db,
                "info",
                "quota_orders",
                iid,
                label,
                format!("Orders quota reached: {name}"),
                format!("{}/{} orders on {date}", d.orders, q),
                &format!("{iid}:quota_orders:{date}"),
            )? {
                out.push(a);
            }
        }
    }

    Ok(())
}

fn post_webhook(url: &str, alerts: &[Value]) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() || alerts.is_empty() {
        return Ok(());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("webhook_url_must_be_http_s".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();
    let body = json!({ "alerts": alerts }).to_string();
    agent
        .post(url)
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map(|_| ())
        .map_err(|e| format!("webhook: {e}"))
}

pub fn evaluate(db: &Database) -> Result<Value, String> {
    let cfg = load_cfg(db);

    let mut stmt = db
        .conn
        .prepare(
            "SELECT r.installation_id, r.label, r.report_date, r.payload,
                    s.quota_cards_day, s.quota_orders_day
             FROM reports r
             LEFT JOIN worker_snapshots s ON s.installation_id = r.installation_id
             WHERE r.kind = 'daily_stats'
               AND r.report_date = (
                   SELECT MAX(report_date) FROM reports
                   WHERE installation_id = r.installation_id AND kind = 'daily_stats'
               )",
        )
        .map_err(|e| format!("select: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut evaluated = 0usize;
    let mut fresh: Vec<Value> = Vec::new();

    for row in rows.flatten() {
        let (iid, label, date, payload, quota_cards, quota_orders) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        evaluated += 1;
        let d = parse_day(&v);
        evaluate_worker(
            db,
            &cfg,
            &iid,
            &label.unwrap_or_default(),
            &date,
            &d,
            quota_cards,
            quota_orders,
            &mut fresh,
        )?;
    }

    if !cfg.webhook_url.trim().is_empty() && !fresh.is_empty() {
        if let Err(e) = post_webhook(&cfg.webhook_url, &fresh) {
            db.log_event("alert_webhook_fail", &e);
        } else {
            db.log_event("alert_webhook", &format!("sent={}", fresh.len()));
        }
    }

    let alerts_new = fresh.len();
    Ok(json!({
        "ok": true,
        "evaluated": evaluated,
        "alerts_new": alerts_new,
        "new_alerts": fresh,
    }))
}

pub fn list(db: &Database, status: &str) -> Result<Value, String> {
    let (sql, params): (&str, Vec<String>) = match status {
        "new" | "ack" | "closed" => (
            "SELECT id, severity, category, installation_id, label, title, message, status, created_at
             FROM local_alerts WHERE status = ?1 ORDER BY created_at DESC, id DESC LIMIT 200",
            vec![status.to_string()],
        ),
        _ => (
            "SELECT id, severity, category, installation_id, label, title, message, status, created_at
             FROM local_alerts WHERE status != 'closed' ORDER BY created_at DESC, id DESC LIMIT 200",
            vec![],
        ),
    };
    let mut stmt = db.conn.prepare(sql).map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "severity": row.get::<_, String>(1)?,
                "category": row.get::<_, String>(2)?,
                "installation_id": row.get::<_, String>(3)?,
                "label": row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "title": row.get::<_, String>(5)?,
                "message": row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                "status": row.get::<_, String>(7)?,
                "created_at": row.get::<_, String>(8)?,
                "source": "local",
            }))
        })
        .map_err(|e| format!("query: {e}"))?;
    let alerts: Vec<Value> = rows.flatten().collect();
    Ok(json!({ "alerts": alerts }))
}

pub fn count_new(db: &Database) -> Result<i64, String> {
    db.conn
        .query_row(
            "SELECT COUNT(*) FROM local_alerts WHERE status = 'new'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("count: {e}"))
}

pub fn act(db: &Database, id: i64, action: &str) -> Result<(), String> {
    let target = match action {
        "ack" => "ack",
        "close" => "closed",
        _ => return Err("invalid_action".into()),
    };
    let changed = db
        .conn
        .execute(
            "UPDATE local_alerts SET status = ?1 WHERE id = ?2 AND status != 'closed'",
            rusqlite::params![target, id],
        )
        .map_err(|e| format!("alert act: {e}"))?;
    if changed == 0 {
        return Err("alert_not_found".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir();
        let dir = dir.unwrap();
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

    fn set_quota(db: &Database, iid: &str, cards: Option<i64>, orders: Option<i64>) {
        db.conn
            .execute(
                "INSERT INTO worker_snapshots (installation_id, quota_cards_day, quota_orders_day)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(installation_id) DO UPDATE SET
                    quota_cards_day = excluded.quota_cards_day,
                    quota_orders_day = excluded.quota_orders_day",
                rusqlite::params![iid, cards, orders],
            )
            .unwrap();
    }

    #[test]
    fn decline_spike_fires_and_dedupes() {
        let (_dir, db) = temp_db();
        insert_report(
            &db,
            "w1",
            "2026-08-27",
            r#"{"orders":{"total":10,"by_status":{"delivered":4,"declined":6}}}"#,
        );
        let r = evaluate(&db).unwrap();
        assert_eq!(r["alerts_new"], 1);
        let a = &r["new_alerts"][0];
        assert_eq!(a["category"], "decline_spike");
        assert_eq!(a["severity"], "warning");
        let again = evaluate(&db).unwrap();
        assert_eq!(again["alerts_new"], 0);
    }

    #[test]
    fn decline_spike_critical_at_70pct() {
        let (_dir, db) = temp_db();
        insert_report(
            &db,
            "w1",
            "2026-08-27",
            r#"{"orders":{"total":10,"by_status":{"delivered":2,"declined":8}}}"#,
        );
        let r = evaluate(&db).unwrap();
        assert_eq!(r["new_alerts"][0]["severity"], "critical");
    }

    #[test]
    fn dead_ratio_rule_and_thresholds() {
        let (_dir, db) = temp_db();
        db.set_config("alert_dead_pct", "30").unwrap();
        insert_report(&db, "w1", "2026-08-27", r#"{"cards":{"taken":5,"used":3,"dead":2}}"#);
        let r = evaluate(&db).unwrap();
        assert_eq!(r["alerts_new"], 1);
        assert_eq!(r["new_alerts"][0]["category"], "dead_ratio");
        assert_eq!(r["new_alerts"][0]["severity"], "warning");
    }

    #[test]
    fn quota_alerts_from_policy_snapshot() {
        let (_dir, db) = temp_db();
        set_quota(&db, "w1", Some(5), Some(10));
        insert_report(
            &db,
            "w1",
            "2026-08-27",
            r#"{"orders":{"total":12,"by_status":{"delivered":12}},
                "cards":{"taken":6,"used":6,"dead":0}}"#,
        );
        let r = evaluate(&db).unwrap();
        let cats: Vec<&str> = r["new_alerts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["category"].as_str().unwrap())
            .collect();
        assert!(cats.contains(&"quota_cards"));
        assert!(cats.contains(&"quota_orders"));
        assert!(r["new_alerts"][0]["severity"] == "info");
    }

    #[test]
    fn only_latest_report_per_worker_evaluated() {
        let (_dir, db) = temp_db();
        insert_report(&db, "w1", "2026-08-25", r#"{"orders":{"total":8,"by_status":{"declined":8}}}"#);
        insert_report(&db, "w1", "2026-08-27", r#"{"orders":{"total":8,"by_status":{"delivered":8}}}"#);
        let r = evaluate(&db).unwrap();
        assert_eq!(r["evaluated"], 1);
        assert_eq!(r["alerts_new"], 0);
    }

    #[test]
    fn list_and_act_flow() {
        let (_dir, db) = temp_db();
        insert_report(&db, "w1", "2026-08-27", r#"{"orders":{"total":6,"by_status":{"declined":5}}}"#);
        evaluate(&db).unwrap();
        let all = list(&db, "all").unwrap();
        let id = all["alerts"][0]["id"].as_i64().unwrap();
        assert_eq!(count_new(&db).unwrap(), 1);
        act(&db, id, "ack").unwrap();
        assert_eq!(count_new(&db).unwrap(), 0);
        assert_eq!(list(&db, "ack").unwrap()["alerts"].as_array().unwrap().len(), 1);
        act(&db, id, "close").unwrap();
        assert_eq!(list(&db, "all").unwrap()["alerts"].as_array().unwrap().len(), 0);
        assert!(act(&db, id, "close").is_err());
        assert!(act(&db, id, "bogus").is_err());
    }
}
