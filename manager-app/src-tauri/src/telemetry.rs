use crate::crypto::unseal_envelope;
use crate::db::Database;
use crate::http;
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

        db.conn
            .execute(
                "INSERT INTO worker_snapshots (installation_id, label, role, is_active, last_seen, hb_last_seen, snapshot, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
                 ON CONFLICT(installation_id) DO UPDATE SET
                    label = excluded.label, role = excluded.role, is_active = excluded.is_active,
                    last_seen = excluded.last_seen, hb_last_seen = excluded.hb_last_seen,
                    snapshot = COALESCE(excluded.snapshot, worker_snapshots.snapshot),
                    updated_at = CURRENT_TIMESTAMP",
                rusqlite::params![
                    iid,
                    label,
                    role,
                    is_active,
                    last_seen,
                    hb_last_seen,
                    snapshot
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

    db.log_event("sync", &format!("workers={workers_seen} reports={reports_stored}"));
    Ok(json!({
        "ok": true,
        "workers": workers_seen,
        "snapshots": snapshots_stored,
        "reports": reports_stored,
        "sealed_to_other_key": sealed_to_other_key,
        "unseal_failures": unseal_failures,
    }))
}

fn vi64(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

fn vobj<'a>(v: &'a Value, key: &str) -> Option<&'a serde_json::Map<String, Value>> {
    v.get(key).and_then(|x| x.as_object())
}

pub fn analytics(db: &Database, from: &str, to: &str) -> Result<Value, String> {
    let mut stmt = db
        .conn
        .prepare(
            "SELECT installation_id, label, report_date, payload FROM reports
             WHERE kind = 'daily_stats' AND report_date >= ?1 AND report_date <= ?2",
        )
        .map_err(|e| format!("select: {e}"))?;

    let rows = stmt
        .query_map(rusqlite::params![from, to], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("query: {e}"))?;

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
        let (iid, label, date, payload) = row;
        let v: Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(_) => continue,
        };
        reports_counted += 1;

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

        let day = days.entry(date.clone()).or_default();
        day.0 += v.get("orders").and_then(|o| o.get("total")).and_then(|x| x.as_i64()).unwrap_or(0);
        day.1 += vi64(&v_json(&v, "cards"), "dead");
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

    Ok(json!({
        "from": from,
        "to": to,
        "reports": reports_counted,
        "orders_total": orders_total,
        "orders_by_status": orders_by_status,
        "cards_taken": cards_taken,
        "cards_used": cards_used,
        "cards_dead": cards_dead,
        "dead_ratio": if cards_taken > 0 { ((cards_dead as f64 / cards_taken as f64) * 1000.0).round() / 10.0 } else { 0.0 },
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

fn v_json<'a>(v: &'a Value, key: &str) -> Value {
    v.get(key).cloned().unwrap_or(Value::Null)
}

fn vi64_w(map: &serde_json::Map<String, Value>, key: &str) -> i64 {
    map.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
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
