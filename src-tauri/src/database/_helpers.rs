// ─────────────────────────────────────────
//  BIN API fetch (standalone)
    // ─────────────────────────────────────────

    pub fn fetch_bin_info(bin: &str, api_key: &str) -> Result<BinInfo, String> {
    if api_key.is_empty() { return Err("no_api_key".into()); }

    // PERF-015: глобальный debounce — максимум 1 запрос к iinapi.com в 2 секунды
    // (платный API, burst при массовом импорте карт сжигал квоту)
    static LAST_CALL: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
    {
        let mut last = LAST_CALL.lock().map_err(|_| "bin_lock_poisoned".to_string())?;
        if let Some(prev) = *last {
            let elapsed = prev.elapsed();
            let min_interval = std::time::Duration::from_secs(2);
            if elapsed < min_interval {
                std::thread::sleep(min_interval - elapsed);
            }
        }
        *last = Some(std::time::Instant::now());
    }

    // FIX B08: api_key передаётся в заголовке X-Api-Key, а не в URL (иначе попадает в логи сервера)
    let url = format!("https://api.iinapi.com/api/v1/{}", bin);
    // PERF-015: exponential backoff при сбоях (1s, 2s, 4s)
    let mut last_err = String::new();
    let mut resp = None;
    for attempt in 0..3u32 {
        match ureq::get(&url).set("X-Api-Key", api_key).call() {
            Ok(r) => { resp = Some(r); break; }
            Err(ureq::Error::Status(code, _)) if (400..500).contains(&code) && code != 429 => {
                // 4xx (кроме 429) — ретраить бессмысленно
                return Err(format!("bin_api_error: HTTP {code}"));
            }
            Err(e) => {
                last_err = e.to_string();
                if attempt < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(1 << attempt));
                }
            }
        }
    }
    let resp = resp.ok_or_else(|| format!("bin_api_error: {last_err}"))?;

    let json: serde_json::Value = resp.into_json()
        .map_err(|e| format!("bin_api_parse: {e}"))?;

    Ok(BinInfo {
        bin: bin.to_string(),
        bank_name:  json["bank"]["name"].as_str().map(String::from),
        card_type:  json["type"].as_str().map(String::from),
        // FIX B46: card_level из поля "level", brand отдельно из "brand"
        card_level: json["level"].as_str().map(String::from),
        country:    json["country"]["alpha2"].as_str().map(String::from),
        brand:      json["brand"].as_str().map(String::from),
    })
    }

    // ─────────────────────────────────────────
    //  Dashboard helpers
    // ─────────────────────────────────────────

    fn period_dates(period: &str, from: Option<&str>, to: Option<&str>) -> (Option<String>, Option<String>) {
    use chrono::{Local, Duration};
    match period {
        "today" => {
            let now = Local::now();
            (Some(now.format("%Y-%m-%d 00:00:00").to_string()),
             Some(now.format("%Y-%m-%d 23:59:59").to_string()))
        }
        "7d" => {
            let now = Local::now();
            (Some((now - Duration::days(7)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some(now.format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "30d" => {
            let now = Local::now();
            (Some((now - Duration::days(30)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some(now.format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "custom" => {
            (from.map(|s| format!("{} 00:00:00", s)),
             to.map(|s| format!("{} 23:59:59", s)))
        }
        _ => (None, None), // "all"
    }
    }

    fn prev_period_dates(period: &str) -> (Option<String>, Option<String>) {
    use chrono::{Local, Duration};
    match period {
        "today" => {
            let yesterday = Local::now() - Duration::days(1);
            (Some(yesterday.format("%Y-%m-%d 00:00:00").to_string()),
             Some(yesterday.format("%Y-%m-%d 23:59:59").to_string()))
        }
        "7d" => {
            let now = Local::now();
            (Some((now - Duration::days(14)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some((now - Duration::days(7)).format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        "30d" => {
            let now = Local::now();
            (Some((now - Duration::days(60)).format("%Y-%m-%d %H:%M:%S").to_string()),
             Some((now - Duration::days(30)).format("%Y-%m-%d %H:%M:%S").to_string()))
        }
        // FIX B63: добавляем предыдущие периоды для month, year
        "month" => {
            let now = Local::now();
            let this_month_start = now.date_naive().with_day(1).unwrap_or(now.date_naive());
            use chrono::Datelike;
            let (prev_year, prev_month) = if this_month_start.month() == 1 {
                (this_month_start.year() - 1, 12u32)
            } else {
                (this_month_start.year(), this_month_start.month() - 1)
            };
            let prev_start = chrono::NaiveDate::from_ymd_opt(prev_year, prev_month, 1)
                .map(|d| d.format("%Y-%m-%d 00:00:00").to_string());
            let prev_end = this_month_start.pred_opt()
                .map(|d| d.format("%Y-%m-%d 23:59:59").to_string());
            (prev_start, prev_end)
        }
        "year" => {
            let now = Local::now();
            use chrono::Datelike;
            let this_year = now.year();
            (Some(format!("{}-01-01 00:00:00", this_year - 1)),
             Some(format!("{}-12-31 23:59:59", this_year - 1)))
        }
        _ => (None, None),
    }
    }

    /// Returns (WHERE conditions string, param values) for date range on `col`.
    /// The conditions string uses ?1/?2 placeholders starting from index 1.
    fn date_and_clause(start: &Option<String>, end: &Option<String>, col: &str) -> (String, Vec<String>) {
    let mut conds = Vec::new();
    let mut p = Vec::new();
    if let Some(s) = start {
        conds.push(format!("{}>= ?{}", col, p.len() + 1));
        p.push(s.clone());
    }
    if let Some(e) = end {
        conds.push(format!("{}<= ?{}", col, p.len() + 1));
        p.push(e.clone());
    }
    (conds.join(" AND "), p)
    }

    fn parse_expiry_days_left(expiry: &str) -> Option<i64> {
    use chrono::{Local, NaiveDate};
    let parts: Vec<&str> = expiry.split('/').collect();
    if parts.len() != 2 { return None; }
    let month: u32 = parts[0].trim().parse().ok()?;
    let year_str = parts[1].trim();
    let year: i32 = if year_str.len() == 2 {
        2000 + year_str.parse::<i32>().ok()?
    } else {
        year_str.parse().ok()?
    };
    let last_day = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?.pred_opt()?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?.pred_opt()?
    };
    let today = Local::now().date_naive();
    Some((last_day - today).num_days())
    }

    fn trend_pct(current: f64, prev: f64) -> Option<f64> {
    if prev == 0.0 { return None; }
    Some((current - prev) / prev * 100.0)
    }

