// MGR-020: умный слой менеджера.
// - Dual-baseline аномалии: последний день воркера против его же trailing-7d
//   (self) и против медианы флота за тот же день (fleet).
// - Прогноз выгорания пула: free из последнего daily_stats.pool.by_status.free
//   делится на средний расход (used+dead)/день за trailing 7d.
// - «Действия дня»: ранжированные карточки с impact (объёмное влияние).
// Только локальные расшифрованные reports — сеть не трогаем.
use crate::db::Database;
use crate::telemetry::{parse_day, DayStats};
use serde_json::{json, Value};

const SELF_WINDOW: i64 = 7;
// минимальный объём, чтобы метрика вообще считалась значимой
const MIN_VOLUME: i64 = 3;
// пороги отклонения в процентных пунктах
const WARN_PP: f64 = 15.0;
const CRIT_PP: f64 = 25.0;
// просадка объёма заказов относительно self-базовой линии
const VOLUME_DROP_RATIO: f64 = 0.5;
const VOLUME_DROP_MIN_BASE: f64 = 4.0;
// прогноз пула: сколько дней запаса считается тревожным
const POOL_WARN_DAYS: f64 = 5.0;
const POOL_CRIT_DAYS: f64 = 2.0;

fn median(mut xs: Vec<f64>) -> Option<f64> {
    xs.retain(|x| x.is_finite());
    if xs.is_empty() {
        return None;
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Some(xs[xs.len() / 2])
}

fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn pct(num: i64, den: i64) -> f64 {
    if den > 0 {
        num as f64 / den as f64 * 100.0
    } else {
        0.0
    }
}

struct DayRow {
    date: String,
    d: DayStats,
    pool_free: Option<i64>,
}

fn load_days(db: &Database, per_worker_days: i64) -> Result<Vec<(String, String, Vec<DayRow>)>, String> {
    let mut stmt = db
        .conn
        .prepare(
            "SELECT r.installation_id, COALESCE(s.label,''), r.report_date, r.payload
             FROM reports r
             LEFT JOIN worker_snapshots s ON s.installation_id = r.installation_id
             WHERE r.kind = 'daily_stats'
             ORDER BY r.installation_id, r.report_date DESC",
        )
        .map_err(|e| format!("select: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

    let mut out: Vec<(String, String, Vec<DayRow>)> = Vec::new();
    for row in rows.flatten() {
        let (iid, label, date, payload) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let entry = match out.iter_mut().find(|(id, _, _)| *id == iid) {
            Some(e) => e,
            None => {
                out.push((iid.clone(), label.clone(), Vec::new()));
                out.last_mut().unwrap()
            }
        };
        if entry.2.len() as i64 >= per_worker_days {
            continue;
        }
        let pool_free = v
            .get("pool")
            .and_then(|p| p.get("by_status"))
            .and_then(|s| s.get("free"))
            .and_then(|x| x.as_i64());
        entry.2.push(DayRow {
            date,
            d: parse_day(&v),
            pool_free,
        });
    }
    Ok(out)
}

pub fn insights(db: &Database) -> Result<Value, String> {
    let workers = load_days(db, SELF_WINDOW + 1)?;
    let mut anomalies: Vec<Value> = Vec::new();
    let mut forecast: Vec<Value> = Vec::new();
    let mut actions: Vec<Value> = Vec::new();

    // ── fleet baseline: медианы метрик последнего дня по флоту ──
    let mut fl_decline: Vec<f64> = Vec::new();
    let mut fl_dead: Vec<f64> = Vec::new();
    let mut fl_delivery: Vec<f64> = Vec::new();
    // флотовые ряды по дням: date → агрегаты (для спарклайнов и ночной сводки)
    let mut fleet_by_date: std::collections::BTreeMap<String, DayStats> = Default::default();
    for (_, _, days) in &workers {
        for row in days {
            fleet_by_date
                .entry(row.date.clone())
                .or_default()
                .add(&row.d);
        }
        if let Some(last) = days.first() {
            if last.d.orders >= MIN_VOLUME {
                fl_decline.push(pct(last.d.declined, last.d.orders));
                fl_delivery.push(pct(last.d.delivered, last.d.orders));
            }
            if last.d.cards_taken >= MIN_VOLUME {
                fl_dead.push(pct(last.d.cards_dead, last.d.cards_taken));
            }
        }
    }
    let fleet_decline = median(fl_decline);
    let fleet_dead = median(fl_dead);
    let fleet_delivery = median(fl_delivery);

    for (iid, label, days) in &workers {
        let Some(last) = days.first() else { continue };
        let name = if label.is_empty() { iid.clone() } else { label.clone() };
        let base: Vec<&DayRow> = days.iter().skip(1).collect();

        let base_avg = |f: &dyn Fn(&DayRow) -> f64| -> Option<f64> {
            if base.is_empty() {
                return None;
            }
            Some(base.iter().map(|r| f(r)).sum::<f64>() / base.len() as f64)
        };

        // is_drop=false: аномалия — РОСТ метрики (decline/dead); true — ПРОСАДКА
        // (delivery). В выводе value=текущее, baseline=база; delta_pp всегда >= 0.
        let push_anomaly = |anomalies: &mut Vec<Value>,
                            code: &str,
                            metric: &str,
                            current: f64,
                            baseline: f64,
                            is_drop: bool,
                            volume: i64,
                            date: &str| {
            let delta = if is_drop { baseline - current } else { current - baseline };
            if delta < WARN_PP || volume < MIN_VOLUME {
                return;
            }
            let severity = if delta >= CRIT_PP { "critical" } else { "warning" };
            let impact = r1(delta / 100.0 * volume as f64);
            anomalies.push(json!({
                "code": code,
                "severity": severity,
                "installation_id": iid,
                "label": name,
                "metric": metric,
                "value": r1(current),
                "baseline": r1(baseline),
                "delta_pp": r1(delta),
                "impact": impact,
                "date": date,
            }));
        };

        // self-baseline: деклайн / доставка / мёртвые карты
        if last.d.orders >= MIN_VOLUME {
            let v = pct(last.d.declined, last.d.orders);
            if let Some(b) = base_avg(&|r: &DayRow| pct(r.d.declined, r.d.orders)) {
                push_anomaly(&mut anomalies, "decline_self", "decline_rate", v, b, false, last.d.orders, &last.date);
            }
            let dv = pct(last.d.delivered, last.d.orders);
            if let Some(b) = base_avg(&|r: &DayRow| pct(r.d.delivered, r.d.orders)) {
                push_anomaly(&mut anomalies, "delivery_self", "delivery_rate", dv, b, true, last.d.orders, &last.date);
            }
            if let Some(b) = fleet_decline {
                push_anomaly(&mut anomalies, "decline_fleet", "decline_rate", v, b, false, last.d.orders, &last.date);
            }
            if let Some(b) = fleet_delivery {
                push_anomaly(&mut anomalies, "delivery_fleet", "delivery_rate", dv, b, true, last.d.orders, &last.date);
            }
            // просадка объёма
            if let Some(avg_orders) = base_avg(&|r: &DayRow| r.d.orders as f64) {
                if avg_orders >= VOLUME_DROP_MIN_BASE
                    && (last.d.orders as f64) < avg_orders * VOLUME_DROP_RATIO
                {
                    let impact = r1(avg_orders - last.d.orders as f64);
                    anomalies.push(json!({
                        "code": "volume_drop",
                        "severity": if impact >= 2.0 * VOLUME_DROP_MIN_BASE { "critical" } else { "warning" },
                        "installation_id": iid,
                        "label": name,
                        "metric": "orders",
                        "value": last.d.orders,
                        "baseline": r1(avg_orders),
                        "delta_pp": Value::Null,
                        "impact": impact,
                        "date": last.date,
                    }));
                }
            }
        }
        if last.d.cards_taken >= MIN_VOLUME {
            let v = pct(last.d.cards_dead, last.d.cards_taken);
            if let Some(b) = base_avg(&|r: &DayRow| pct(r.d.cards_dead, r.d.cards_taken)) {
                push_anomaly(&mut anomalies, "dead_self", "dead_ratio", v, b, false, last.d.cards_taken, &last.date);
            }
            if let Some(b) = fleet_dead {
                push_anomaly(&mut anomalies, "dead_fleet", "dead_ratio", v, b, false, last.d.cards_taken, &last.date);
            }
        }

        // ── прогноз выгорания пула ──
        if let Some(free) = last.pool_free {
            let burn_days: Vec<f64> = days
                .iter()
                .map(|r| (r.d.cards_dead + cards_used_fallback(r)) as f64)
                .collect();
            let burn = if burn_days.is_empty() {
                0.0
            } else {
                burn_days.iter().sum::<f64>() / burn_days.len() as f64
            };
            let days_left = if burn > 0.0 { Some(r1(free as f64 / burn)) } else { None };
            let severity = match days_left {
                Some(d) if d <= POOL_CRIT_DAYS => "critical",
                Some(d) if d <= POOL_WARN_DAYS => "warning",
                _ => "ok",
            };
            forecast.push(json!({
                "installation_id": iid,
                "label": name,
                "free": free,
                "burn_per_day": r1(burn),
                "days_left": days_left,
                "severity": severity,
            }));
            if severity != "ok" {
                let d = days_left.unwrap_or(0.0);
                actions.push(json!({
                    "code": "pool_refill",
                    "severity": severity,
                    "impact": r1(burn * (POOL_WARN_DAYS - d).max(1.0)),
                    "installation_id": iid,
                    "label": name,
                    "page": "workers",
                    "params": { "free": free, "days_left": days_left },
                }));
            }
        }
    }

    // ── действия дня из аномалий (топ по impact, дедуп по воркер+метрика) ──
    anomalies.sort_by(|a, b| {
        b["impact"]
            .as_f64()
            .unwrap_or(0.0)
            .partial_cmp(&a["impact"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut seen: std::collections::HashSet<String> = Default::default();
    for a in &anomalies {
        let key = format!(
            "{}:{}",
            a["installation_id"].as_str().unwrap_or(""),
            a["metric"].as_str().unwrap_or("")
        );
        if !seen.insert(key) {
            continue;
        }
        let code = match a["metric"].as_str().unwrap_or("") {
            "decline_rate" => "investigate_decline",
            "dead_ratio" => "investigate_dead",
            "delivery_rate" => "investigate_delivery",
            _ => "investigate_volume",
        };
        actions.push(json!({
            "code": code,
            "severity": a["severity"],
            "impact": a["impact"],
            "installation_id": a["installation_id"],
            "label": a["label"],
            "page": "alerts",
            "params": {
                "metric": a["metric"],
                "value": a["value"],
                "baseline": a["baseline"],
                "date": a["date"],
            },
        }));
    }
    actions.sort_by(|a, b| {
        b["impact"]
            .as_f64()
            .unwrap_or(0.0)
            .partial_cmp(&a["impact"].as_f64().unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    actions.truncate(10);
    forecast.sort_by(|a, b| {
        let da = a["days_left"].as_f64().unwrap_or(f64::MAX);
        let dbb = b["days_left"].as_f64().unwrap_or(f64::MAX);
        da.partial_cmp(&dbb).unwrap_or(std::cmp::Ordering::Equal)
    });

    // ── флотовый ряд (спарклайны) и ночная сводка (вчера vs база 7д) ──
    let series: Vec<(&String, &DayStats)> = fleet_by_date.iter().rev().take(14).collect();
    let fleet_daily: Vec<Value> = series
        .iter()
        .rev()
        .map(|(date, d)| json!({
            "date": date,
            "orders": d.orders,
            "delivered": d.delivered,
            "declined": d.declined,
            "cards_taken": d.cards_taken,
            "cards_dead": d.cards_dead,
        }))
        .collect();

    let night_summary = match series.first() {
        Some((date, last)) => {
            let base: Vec<&DayStats> = series.iter().skip(1).take(7).map(|(_, d)| *d).collect();
            let base_avg = |f: &dyn Fn(&DayStats) -> f64| -> Option<f64> {
                if base.is_empty() {
                    return None;
                }
                Some(base.iter().map(|d| f(d)).sum::<f64>() / base.len() as f64)
            };
            let delta = |now: f64, b: Option<f64>| -> Value {
                match b {
                    Some(v) if v > 0.0 => json!(r1((now - v) / v * 100.0)),
                    _ => Value::Null,
                }
            };
            let base_orders = base_avg(&|d: &DayStats| d.orders as f64);
            let base_delivered = base_avg(&|d: &DayStats| d.delivered as f64);
            let base_decline = base_avg(&|d: &DayStats| pct(d.declined, d.orders));
            let base_dead = base_avg(&|d: &DayStats| pct(d.cards_dead, d.cards_taken));
            json!({
                "date": date,
                "orders": last.orders,
                "delivered": last.delivered,
                "declined": last.declined,
                "decline_rate": r1(pct(last.declined, last.orders)),
                "cards_taken": last.cards_taken,
                "cards_dead": last.cards_dead,
                "dead_ratio": r1(pct(last.cards_dead, last.cards_taken)),
                "baseline_days": base.len(),
                "delta_orders_pct": delta(last.orders as f64, base_orders),
                "delta_delivered_pct": delta(last.delivered as f64, base_delivered),
                "delta_decline_pp": base_decline.map(|b| r1(pct(last.declined, last.orders) - b)),
                "delta_dead_pp": base_dead.map(|b| r1(pct(last.cards_dead, last.cards_taken) - b)),
            })
        }
        None => Value::Null,
    };

    Ok(json!({
        "ok": true,
        "workers_evaluated": workers.len(),
        "anomalies": anomalies,
        "pool_forecast": forecast,
        "actions": actions,
        "fleet_daily": fleet_daily,
        "night_summary": night_summary,
        "fleet_baseline": {
            "decline_rate": fleet_decline.map(r1),
            "dead_ratio": fleet_dead.map(r1),
            "delivery_rate": fleet_delivery.map(r1),
        },
    }))
}

/// Расход пула за день ≈ cards.taken: «взятая» карта ушла из free независимо
/// от того, отработала она или сдохла (dead входит в taken того же дня).
/// DayStats хранит taken и dead — burn = taken восстанавливается из пары.
fn cards_used_fallback(r: &DayRow) -> i64 {
    r.d.cards_taken - r.d.cards_dead
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

    fn insert_report(db: &Database, iid: &str, label: &str, date: &str, payload: &str) {
        db.conn
            .execute(
                "INSERT INTO reports (installation_id, label, kind, report_date, payload)
                 VALUES (?1, ?2, 'daily_stats', ?3, ?4)",
                rusqlite::params![iid, label, date, payload],
            )
            .unwrap();
    }

    fn fill_baseline(db: &Database, iid: &str, days: usize, orders: i64, declined: i64) {
        for i in 1..=days {
            let date = (chrono::Local::now() - chrono::Duration::days(i as i64))
                .format("%Y-%m-%d")
                .to_string();
            insert_report(
                db,
                iid,
                "W",
                &date,
                &format!(
                    r#"{{"orders":{{"total":{orders},"by_status":{{"delivered":{},"declined":{declined}}}}},
                        "cards":{{"taken":6,"used":5,"dead":1}},
                        "pool":{{"by_status":{{"free":40}}}}}}"#,
                    orders - declined
                ),
            );
        }
    }

    #[test]
    fn self_baseline_decline_anomaly_fires() {
        let (_dir, db) = temp_db();
        fill_baseline(&db, "w1", 7, 10, 1); // 10% деклайна неделю
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_report(
            &db, "w1", "W", &today,
            r#"{"orders":{"total":10,"by_status":{"delivered":5,"declined":5}},
                "cards":{"taken":6,"used":5,"dead":1},
                "pool":{"by_status":{"free":40}}}"#,
        ); // 50% — скачок на 40 п.п.
        let r = insights(&db).unwrap();
        let codes: Vec<&str> = r["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["code"].as_str().unwrap())
            .collect();
        assert!(codes.contains(&"decline_self"), "аномалия против себя: {codes:?}");
        let a = r["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["code"] == "decline_self")
            .unwrap();
        assert_eq!(a["severity"], "critical");
        assert_eq!(a["value"], 50.0);
        assert_eq!(a["baseline"], 10.0);
        assert!(a["impact"].as_f64().unwrap() > 0.0);
        // действие сгенерировано
        let acts: Vec<&str> = r["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["code"].as_str().unwrap())
            .collect();
        assert!(acts.contains(&"investigate_decline"));
    }

    #[test]
    fn fleet_baseline_marks_outlier_only() {
        let (_dir, db) = temp_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        // три «нормальных» воркера и один выброс; истории нет — self не сработает
        for (iid, dec) in [("a", 1), ("b", 1), ("c", 2), ("out", 6)] {
            insert_report(
                &db, iid, iid, &today,
                &format!(
                    r#"{{"orders":{{"total":10,"by_status":{{"delivered":{},"declined":{dec}}}}}}}"#,
                    10 - dec
                ),
            );
        }
        let r = insights(&db).unwrap();
        let fl = r["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["code"] == "decline_fleet")
            .collect::<Vec<_>>();
        assert_eq!(fl.len(), 1, "только выброс против флота: {fl:?}");
        assert_eq!(fl[0]["installation_id"], "out");
        assert_eq!(fl[0]["metric"], "decline_rate");
    }

    #[test]
    fn quiet_worker_without_history_yields_no_self_anomaly() {
        let (_dir, db) = temp_db();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_report(
            &db, "w1", "W", &today,
            r#"{"orders":{"total":10,"by_status":{"declined":9}}}"#,
        );
        let r = insights(&db).unwrap();
        assert!(r["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["code"] != "decline_self"));
    }

    #[test]
    fn pool_forecast_days_left_and_action() {
        let (_dir, db) = temp_db();
        for i in 1..=3 {
            let date = (chrono::Local::now() - chrono::Duration::days(i))
                .format("%Y-%m-%d")
                .to_string();
            insert_report(
                &db, "w1", "W", &date,
                r#"{"cards":{"taken":10,"used":9,"dead":1},"pool":{"by_status":{"free":25}}}"#,
            );
        }
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_report(
            &db, "w1", "W", &today,
            r#"{"cards":{"taken":10,"used":9,"dead":1},"pool":{"by_status":{"free":20}}}"#,
        ); // burn=10/день, free=20 → 2 дня → critical
        let r = insights(&db).unwrap();
        let f = &r["pool_forecast"][0];
        assert_eq!(f["free"], 20);
        assert_eq!(f["burn_per_day"], 10.0);
        assert_eq!(f["days_left"], 2.0);
        assert_eq!(f["severity"], "critical");
        let acts = r["actions"].as_array().unwrap();
        assert!(acts.iter().any(|a| a["code"] == "pool_refill"));
        assert_eq!(acts[0]["code"], "pool_refill", "критичный пул — первым");
    }

    #[test]
    fn empty_db_yields_empty_insights() {
        let (_dir, db) = temp_db();
        let r = insights(&db).unwrap();
        assert_eq!(r["workers_evaluated"], 0);
        assert_eq!(r["anomalies"].as_array().unwrap().len(), 0);
        assert_eq!(r["actions"].as_array().unwrap().len(), 0);
        assert!(r["fleet_baseline"]["decline_rate"].is_null());
    }

    #[test]
    fn fleet_daily_series_and_night_summary() {
        let (_dir, db) = temp_db();
        // 8 дней по 2 воркера: стабильная база 10 заказов/день на флот
        for i in 0..8 {
            let date = (chrono::Local::now() - chrono::Duration::days(i))
                .format("%Y-%m-%d")
                .to_string();
            for (iid, extra) in [("w1", 0), ("w2", 0)] {
                let _ = extra;
                insert_report(
                    &db, iid, iid, &date,
                    r#"{"orders":{"total":5,"by_status":{"delivered":4,"declined":1}},
                        "cards":{"taken":4,"used":4,"dead":0}}"#,
                );
            }
        }
        // последний день поднимем вдвое для w1 → флот 15 вместо 10
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        db.conn
            .execute(
                "UPDATE reports SET payload = ?1 WHERE installation_id = 'w1' AND report_date = ?2",
                rusqlite::params![
                    r#"{"orders":{"total":10,"by_status":{"delivered":9,"declined":1}},
                        "cards":{"taken":8,"used":8,"dead":0}}"#,
                    today
                ],
            )
            .unwrap();

        let r = insights(&db).unwrap();
        let daily = r["fleet_daily"].as_array().unwrap();
        assert_eq!(daily.len(), 8, "все 8 дней флота: {}", daily.len());
        // хронологический порядок: старые → новые
        assert!(daily[0]["date"].as_str().unwrap() < daily[7]["date"].as_str().unwrap());
        assert_eq!(daily[7]["orders"], 15);
        assert_eq!(daily[0]["orders"], 10);

        let ns = &r["night_summary"];
        assert_eq!(ns["date"], today);
        assert_eq!(ns["orders"], 15);
        assert_eq!(ns["delivered"], 13);
        assert_eq!(ns["baseline_days"], 7);
        // 15 против 10 → +50%; delivered 13 против 8 → +62.5%
        assert_eq!(ns["delta_orders_pct"], 50.0);
        assert_eq!(ns["delta_delivered_pct"], 62.5);
        // деклайн: 2/15≈13.3% против базы 2/10=20% → -6.7 п.п.; мёртвых 0 против 0
        assert_eq!(ns["delta_decline_pp"], -6.7);
        assert_eq!(ns["delta_dead_pp"], 0.0);
    }

    #[test]
    fn night_summary_null_without_reports() {
        let (_dir, db) = temp_db();
        let r = insights(&db).unwrap();
        assert!(r["night_summary"].is_null());
        assert_eq!(r["fleet_daily"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn volume_drop_detected_against_self() {
        let (_dir, db) = temp_db();
        fill_baseline(&db, "w1", 7, 12, 1);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        insert_report(
            &db, "w1", "W", &today,
            r#"{"orders":{"total":3,"by_status":{"delivered":3}},
                "cards":{"taken":2,"used":2,"dead":0}}"#,
        ); // 3 < 12*0.5 → просадка
        let r = insights(&db).unwrap();
        let v = r["anomalies"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["code"] == "volume_drop")
            .expect("volume_drop");
        assert_eq!(v["value"], 3);
        assert_eq!(v["baseline"], 12.0);
    }
}
