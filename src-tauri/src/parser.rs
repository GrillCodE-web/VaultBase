//! CC dump parser with auto-delimiter detection, Luhn validation, and column auto-detection.
//! FIX P2-DOMAIN: Added log metadata parsing (date, domain, IP)

use crate::models::{CardInput, MappingPreview};

// ─────────────────────────────────────────
//  Log metadata structure
// ─────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct LogMetadata {
    pub timestamp: Option<String>,  // e.g., "2026-03-04 01:25:38"
    pub ip: Option<String>,         // e.g., "107.218.77.158"
    pub domain: Option<String>,     // e.g., "tristatecamera.com"
}

// ─────────────────────────────────────────
//  Public result type
// ─────────────────────────────────────────

#[derive(Debug)]
pub struct ParseResult {
    pub parsed:  Vec<CardInput>,
    pub skipped: usize,
    pub errors:  Vec<String>,
}

// ─────────────────────────────────────────
//  US State abbreviations
// ─────────────────────────────────────────

const US_STATES: &[&str] = &[
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
    "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
    "DC","PR","VI","GU","AS","MP",
];

fn is_us_state(s: &str) -> bool {
    let up = s.to_uppercase();
    US_STATES.contains(&up.as_str())
}

// ─────────────────────────────────────────
//  Street suffixes for billing_address
// ─────────────────────────────────────────

const STREET_SUFFIXES: &[&str] = &[
    "ave","avenue","st","street","rd","road","blvd","boulevard",
    "dr","drive","ln","lane","ct","court","pl","place","way",
    "circle","cir","terrace","ter","trail","trl","pkwy","parkway",
    "hwy","highway","n","s","e","w","ne","nw","se","sw",
];

// ─────────────────────────────────────────
//  Log-line prefix stripping
//  Handles: "[2025-10-26 12:48:52] IP: x.x.x.x | Domain: foo.com | Data: <carddata>"
// ─────────────────────────────────────────

/// Parse log line metadata and card data separately
/// Returns (metadata, card_data)
fn parse_log_line(line: &str) -> (LogMetadata, &str) {
    let mut meta = LogMetadata::default();
    let mut card_data = line;

    // Check if this is a log line with prefix
    if !line.trim_start().starts_with('[') {
        // Not a log line, return as-is
        return (meta, line);
    }

    let lower = line.to_lowercase();

    // Extract timestamp: [YYYY-MM-DD HH:MM:SS]
    if let Some(ts_start) = line.find('[') {
        if let Some(ts_end) = line.find(']') {
            if ts_end > ts_start {
                meta.timestamp = Some(line[ts_start + 1..ts_end].to_string());
                card_data = &line[ts_end + 1..];
            }
        }
    }

    // Extract IP: "IP: x.x.x.x"
    if let Some(ip_pos) = lower.find("ip: ") {
        let ip_start = ip_pos + 4;
        let rest = &line[ip_start..];
        if let Some(end) = rest.find(" |") {
            meta.ip = Some(rest[..end].trim().to_string());
        }
    }

    // Extract Domain: "Domain: foo.com"
    if let Some(dom_pos) = lower.find("domain: ") {
        let dom_start = dom_pos + 8;
        let rest = &line[dom_start..];
        if let Some(end) = rest.find(" |") {
            meta.domain = Some(rest[..end].trim().to_string());
        }
    }

    // Extract card data after "Data: "
    if let Some(pos) = lower.find("| data: ") {
        card_data = &line[pos + 8..];
    } else if let Some(pos) = lower.find("data: ") {
        card_data = &line[pos + 6..];
    }

    (meta, card_data.trim())
}

/// Legacy function for backwards compatibility - returns only card data
fn strip_log_prefix(line: &str) -> &str {
    let (_, card_data) = parse_log_line(line);
    card_data
}

// ─────────────────────────────────────────
//  Luhn validation
// ─────────────────────────────────────────

pub fn luhn_valid(number: &str) -> bool {
    let digits: Vec<u32> = number
        .chars()
        .filter(|c| c.is_ascii_digit())
        .filter_map(|c| c.to_digit(10))
        .collect();

    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    let sum: u32 = digits.iter().rev().enumerate().map(|(i, &d)| {
        if i % 2 == 1 {
            let doubled = d * 2;
            if doubled > 9 { doubled - 9 } else { doubled }
        } else {
            d
        }
    }).sum();

    sum % 10 == 0
}

// ─────────────────────────────────────────
//  Expiry normalisation → MM/YY
// ─────────────────────────────────────────

fn parse_expiry(raw: &str) -> Option<String> {
    let s = raw.trim();

    // Вспомогательная: проверяем что дата не истекла
    let is_valid_future = |mm: u32, yy: u32| -> bool {
        let now = chrono::Utc::now();
        let cur_y = (now.format("%y").to_string().parse::<u32>().unwrap_or(0)) as u32;
        let cur_m = now.month();
        // FIX B60: отклоняем карты у которых срок уже истёк
        yy > cur_y || (yy == cur_y && mm >= cur_m)
    };
    use chrono::Datelike;

    // MM/YYYY or MM/YY
    if let Some(pos) = s.find('/') {
        let mm = &s[..pos];
        let yy_part = &s[pos+1..];
        let mm: u32 = mm.parse().ok()?;
        if mm < 1 || mm > 12 { return None; }
        let yy: u32 = if yy_part.len() == 4 {
            yy_part.parse::<u32>().ok()? % 100
        } else {
            yy_part.parse().ok()?
        };
        if !is_valid_future(mm, yy) { return None; }
        return Some(format!("{:02}/{:02}", mm, yy));
    }

    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.len() {
        4 => {
            // MMYY
            let mm: u32 = digits[..2].parse().ok()?;
            let yy: u32 = digits[2..].parse().ok()?;
            if mm < 1 || mm > 12 { return None; }
            if !is_valid_future(mm, yy) { return None; }
            Some(format!("{:02}/{:02}", mm, yy))
        }
        6 => {
            // FIX B73: формат MMYYYY (digits[2..6]) — берём последние 2 из 4-значного года
            // Отличие от MMDDYY: день (позиция [2..4]) не может быть >31,
            // а год (позиция [4..6] в MMDDYY) не может быть разумным YY если он < 01.
            // Heuristic: если digits[2..4] <= 31 И digits[4..6] выглядит как год (>= current_yy) —
            // это MMDDYY. Иначе — MMYYYY.
            let mm: u32 = digits[..2].parse().ok()?;
            if mm < 1 || mm > 12 { return None; }
            let middle: u32 = digits[2..4].parse().ok()?;
            let last2: u32 = digits[4..].parse().ok()?;
            let now = chrono::Utc::now();
            let cur_y = now.format("%y").to_string().parse::<u32>().unwrap_or(0);

            // Если middle <= 31 и last2 >= cur_y — это MMDDYY (день + год)
            // В этом случае используем last2 как YY
            // Если middle выглядит как первые 2 цифры года (19xx/20xx) — MMYYYY
            if middle >= 19 || middle == 20 {
                // MMYYYY: digits[2..6] = полный год, берём last 2
                let yy = last2;
                if !is_valid_future(mm, yy) { return None; }
                Some(format!("{:02}/{:02}", mm, yy))
            } else if middle <= 31 && last2 >= cur_y {
                // MMDDYY: используем last2 как YY
                if !is_valid_future(mm, last2) { return None; }
                Some(format!("{:02}/{:02}", mm, last2))
            } else {
                None
            }
        }
        _ => None,
    }
}

// ─────────────────────────────────────────
//  Delimiter auto-detection
// ─────────────────────────────────────────

fn detect_delimiter(raw: &str) -> char {
    let candidates = ['|', '\t', ';', ',', ' '];
    let lines: Vec<&str> = raw.lines()
        .map(|l| strip_log_prefix(l.trim()))
        .filter(|l| !l.is_empty())
        .take(10)
        .collect();

    if lines.is_empty() { return '|'; }

    let mut best_delim = '|';
    let mut best_score = 0usize;

    for &delim in &candidates {
        let counts: Vec<usize> = lines.iter()
            .map(|l| l.split(delim).count())
            .collect();
        if counts.iter().all(|&c| c <= 1) { continue; }
        let mode = {
            let mut freq = std::collections::HashMap::new();
            for &c in &counts { *freq.entry(c).or_insert(0usize) += 1; }
            *freq.values().max().unwrap_or(&0)
        };
        if mode > best_score {
            best_score = mode;
            best_delim = delim;
        }
    }
    best_delim
}

// ─────────────────────────────────────────
//  Billing address heuristic
// ─────────────────────────────────────────

fn is_billing_address(s: &str) -> bool {
    let has_digit = s.chars().any(|c| c.is_ascii_digit());
    let has_alpha = s.chars().any(|c| c.is_alphabetic());
    if !has_digit || !has_alpha { return false; }

    let words: Vec<&str> = s.split_whitespace().collect();
    if words.len() < 2 { return false; }

    // First token should start with or be a digit (house number)
    let first_has_digit = words[0].chars().any(|c| c.is_ascii_digit());
    if !first_has_digit { return false; }

    // Must contain a known street suffix OR be long enough (3+ words)
    let has_suffix = words.iter().any(|w| {
        STREET_SUFFIXES.contains(&w.to_lowercase().as_str())
    });
    has_suffix || words.len() >= 3
}

// ─────────────────────────────────────────
//  Column type heuristics
// ─────────────────────────────────────────

fn classify_column(samples: &[&str]) -> String {
    let non_empty: Vec<&str> = samples.iter().copied().filter(|s| !s.is_empty()).collect();
    if non_empty.is_empty() { return "skip".into(); }

    let n = non_empty.len();

    // card_number: Luhn valid + 13-19 digits
    let card_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        d.len() >= 13 && d.len() <= 19 && luhn_valid(s)
    }).count();
    if card_hits > n / 2 { return "card_number".into(); }

    // expiry: MM/YY-ish patterns
    let exp_hits = non_empty.iter().filter(|s| parse_expiry(s).is_some()).count();
    if exp_hits > n / 2 { return "expiry_date".into(); }

    // email
    let email_hits = non_empty.iter().filter(|s| s.contains('@') && s.contains('.')).count();
    if email_hits > n / 2 { return "email".into(); }

    // ip_address: N.N.N.N
    let ip_hits = non_empty.iter().filter(|s| {
        let parts: Vec<&str> = s.split('.').collect();
        parts.len() == 4 && parts.iter().all(|p| p.parse::<u32>().is_ok())
    }).count();
    if ip_hits > n / 2 { return "ip_address".into(); }

    // billing_address: "123 Main St" pattern — check BEFORE cvv/phone
    let addr_hits = non_empty.iter().filter(|s| is_billing_address(s)).count();
    if addr_hits > n / 2 { return "billing_address".into(); }

    // FIX B59: zip проверяем ДО cvv — иначе 4-значные европейские ZIP (NL, AT, IL)
    // ошибочно классифицируются как CVV (оба 4 цифры)
    // zip: 5 digits or short numeric (4-10 chars)
    let zip_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        d.len() == s.len() && s.len() >= 4 && s.len() <= 10
    }).count();
    // Для zip используем порог 5+ цифр (5-значные US ZIP), или 4-значные если все одинаковой длины
    let all_same_len = non_empty.windows(2).all(|w| w[0].len() == w[1].len());
    if zip_hits > n * 2 / 3 && (non_empty.iter().all(|s| s.len() == 5) || (all_same_len && non_empty.first().map(|s| s.len() == 4).unwrap_or(false))) {
        return "zip".into();
    }

    // cvv: 3-4 digits only (проверяем ПОСЛЕ zip)
    // FIX B-MED-02: Поддержка 4-значных CVV для American Express
    let cvv_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        (d.len() == 3 || d.len() == 4) && *s == &d  // CVV 3-4 цифры (AmEx)
    }).count();
    if cvv_hits > n * 2 / 3 { return "cvv".into(); }
    // AmEx 4-digit CVV — только если не похоже на zip
    let cvv4_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        d.len() == 4 && *s == &d
    }).count();
    if cvv4_hits > n * 2 / 3 && zip_hits < n / 4 { return "cvv".into(); }

    // phone: 10+ digit chars, total len ≤ 20
    let phone_hits = non_empty.iter().filter(|s| {
        let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        digits.len() >= 10 && s.len() <= 20
    }).count();
    if phone_hits > n * 2 / 3 { return "phone".into(); }

    // 2-letter alphabetic — disambiguate state vs country
    let two_letter: Vec<&&str> = non_empty.iter().filter(|s| {
        s.len() == 2 && s.chars().all(|c| c.is_ascii_alphabetic())
    }).collect();
    if two_letter.len() > n * 2 / 3 {
        // Count how many are known US states
        let state_hits = two_letter.iter().filter(|s| is_us_state(s)).count();
        if state_hits > two_letter.len() / 2 {
            return "state".into();
        }
        return "country".into();
    }

    // holder_name: 2+ words, alpha + spaces + hyphens
    let name_hits = non_empty.iter().filter(|s| {
        let words: Vec<&str> = s.split_whitespace().collect();
        words.len() >= 2 && words.iter().all(|w| w.chars().all(|c| c.is_alphabetic() || c == '-'))
    }).count();
    if name_hits > n / 2 { return "holder_name".into(); }

    // FIX B62: city требует 2+ слова ИЛИ первую букву заглавную + только буквы+дефис
    // Однословные значения типа "DE" или "free" не считаются city
    let city_hits = non_empty.iter().filter(|s| {
        let words: Vec<&str> = s.split_whitespace().collect();
        let all_alpha = s.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '.');
        let looks_like_city = words.len() >= 2  // New York, Los Angeles, ...
            || (words.len() == 1 && s.len() >= 4  // Rome, Paris, Oslo — не 2-буквенные state abbrev
                && s.chars().next().map(|c| c.is_uppercase()).unwrap_or(false));
        s.len() >= 3 && all_alpha && looks_like_city
    }).count();
    if city_hits > n / 2 { return "city".into(); }

    "skip".into()
}

// ─────────────────────────────────────────
//  Public: detect_mapping
// ─────────────────────────────────────────

pub fn detect_mapping(raw: &str) -> Vec<String> {
    // FIX B61: делегируем с предзаданным делиметром
    detect_mapping_with_delim(raw, detect_delimiter(raw))
}

fn detect_mapping_with_delim(raw: &str, delim: char) -> Vec<String> {
    let lines: Vec<Vec<&str>> = raw.lines()
        .map(|l| strip_log_prefix(l.trim()))
        .filter(|l| !l.is_empty())
        .take(10)
        .map(|l| l.split(delim).map(|s| s.trim()).collect())
        .collect();

    if lines.is_empty() { return vec![]; }

    let col_count = lines.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut mapping = Vec::with_capacity(col_count);

    for col_i in 0..col_count {
        let samples: Vec<&str> = lines.iter()
            .filter_map(|row| row.get(col_i).copied())
            .collect();
        mapping.push(classify_column(&samples));
    }

    // Ensure only one card_number (first wins → rest skip)
    let mut saw_card = false;
    for m in mapping.iter_mut() {
        if m == "card_number" {
            if saw_card { *m = "skip".into(); } else { saw_card = true; }
        }
    }

    mapping
}

// ─────────────────────────────────────────
//  Public: mapping_preview (for IPC)
// ─────────────────────────────────────────

pub fn mapping_preview(raw: &str) -> MappingPreview {
    // FIX B61: детектируем делиметр один раз и переиспользуем
    let delim = detect_delimiter(raw);
    let rows: Vec<Vec<String>> = raw.lines()
        .map(|l| strip_log_prefix(l.trim()))
        .filter(|l| !l.is_empty())
        .take(5)
        .map(|l| l.split(delim).map(|s| s.trim().to_string()).collect())
        .collect();

    let detected = detect_mapping_with_delim(raw, delim);
    MappingPreview {
        preview_rows: rows,
        detected_mapping: detected,
    }
}

// ─────────────────────────────────────────
//  Public: parse_cards
// ─────────────────────────────────────────

pub fn parse_cards(raw: &str, mapping: Vec<String>, source: &str) -> ParseResult {
    let delim = detect_delimiter(raw);
    let mut parsed  = Vec::new();
    let mut skipped = 0usize;
    let mut errors  = Vec::new();
    // FIX B69: data_line_no считает только непустые строки — номера в ошибках соответствуют
    // тому что видит пользователь после удаления пустых строк
    let mut data_line_no = 0usize;

    for line in raw.lines() {
        // FIX P2-DOMAIN: Parse log metadata (timestamp, IP, domain)
        let (meta, card_line) = parse_log_line(line.trim());

        if card_line.is_empty() { continue; }
        data_line_no += 1;
        let line_no = data_line_no; // 1-based для сообщений об ошибках

        let parts: Vec<&str> = card_line.split(delim).map(|s| s.trim()).collect();

        let mut input = CardInput {
            source: source.to_string(),
            // FIX P2-DOMAIN: Populate domain and acquired_at from log metadata
            domain: meta.domain,
            acquired_at: meta.timestamp,
            // Use IP from log if not explicitly mapped
            ip_address: meta.ip,
            ..Default::default()
        };

        let mut has_card_number = false;

        for (i, field) in mapping.iter().enumerate() {
            let val = parts.get(i).copied().unwrap_or("").trim();
            if val.is_empty() || field == "skip" { continue; }

            match field.as_str() {
                "card_number" => {
                    let clean: String = val.chars().filter(|c| c.is_ascii_digit()).collect();
                    // DB-006: явная проверка длины (13-19 цифр по ISO/IEC 7812)
                    // с отдельным сообщением — иначе Luhn-молчание скрывало
                    // очевидные ошибки парсинга столбцов (телефон вместо карты)
                    if clean.len() < 13 || clean.len() > 19 {
                        errors.push(format!("Line {}: invalid card length ({} digits)", line_no, clean.len()));
                        skipped += 1;
                        break;
                    }
                    if luhn_valid(&clean) {
                        input.card_number = clean;
                        has_card_number = true;
                    } else {
                        errors.push(format!("Line {}: invalid card number \"{}\"", line_no, &val[..val.len().min(20)]));
                        skipped += 1;
                        break;
                    }
                }
                "expiry_date"     => { input.expiry_date = parse_expiry(val); }
                "cvv"             => { input.cvv = Some(val.to_string()); }
                "holder_name"     => { input.holder_name = Some(val.to_string()); }
                "billing_address" => { input.billing_address = Some(val.to_string()); }
                "city"            => { input.city = Some(val.to_string()); }
                "state"           => { input.state = Some(val.to_string()); }
                "zip"             => { input.zip = Some(val.to_string()); }
                "country"         => { input.country = Some(val.to_string()); }
                "phone"           => { input.phone = Some(val.to_string()); }
                "email"           => { input.email = Some(val.to_string()); }
                "ip_address"      => { input.ip_address = Some(val.to_string()); } // Override if explicitly mapped
                _ => {}
            }
        }

        if !has_card_number {
            if !errors.last().map(|e: &String| e.starts_with(&format!("Line {}:", line_no))).unwrap_or(false) {
                errors.push(format!("Line {}: missing card_number", line_no));
                skipped += 1;
            }
            continue;
        }

        parsed.push(input);
    }

    ParseResult { parsed, skipped, errors }
}

// ─────────────────────────────────────────
//  Helpers (used by database.rs)
// ─────────────────────────────────────────

pub fn extract_bin_last4(card_number: &str) -> (Option<String>, Option<String>) {
    let digits: String = card_number.chars().filter(|c| c.is_ascii_digit()).collect();
    let bin   = if digits.len() >= 6 { Some(digits[..6].to_string()) } else { None };
    let last4 = if digits.len() >= 4 { Some(digits[digits.len()-4..].to_string()) } else { None };
    (bin, last4)
}


// ─────────────────────────────────────────
//  Tests (TEST-009)
// ─────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|s| s.to_string()).collect()
    }

    // ── Luhn ──

    #[test]
    fn test_luhn_valid_known_numbers() {
        assert!(luhn_valid("4111111111111111")); // Visa test
        assert!(luhn_valid("5500005555555559")); // Mastercard test
        assert!(luhn_valid("378282246310005"));  // Amex test (15 digits)
    }

    #[test]
    fn test_luhn_invalid_checksum() {
        assert!(!luhn_valid("4111111111111112"));
        assert!(!luhn_valid("5500005555555550"));
    }

    #[test]
    fn test_luhn_length_bounds() {
        assert!(!luhn_valid("411111111111"));      // 12 digits — too short
        assert!(!luhn_valid("41111111111111111111")); // 20 digits — too long
        assert!(!luhn_valid(""));
    }

    #[test]
    fn test_luhn_ignores_spaces_and_dashes() {
        assert!(luhn_valid("4111 1111 1111 1111"));
        assert!(luhn_valid("4111-1111-1111-1111"));
    }

    // ── detect_mapping ──

    #[test]
    fn test_detect_mapping_comma_csv() {
        let raw = "\
4111111111111111,12/29,123,John Doe
5500005555555559,11/29,456,Jane Smith
340000000000009,10/29,789,Bob Johnson";
        let m = detect_mapping(raw);
        assert_eq!(m, mapping(&["card_number", "expiry_date", "cvv", "holder_name"]));
    }

    #[test]
    fn test_detect_mapping_pipe_delimited() {
        let raw = "\
4111111111111111|12/29|123
5500005555555559|11/29|456
378282246310005|10/29|7890";
        let m = detect_mapping(raw);
        assert_eq!(m, mapping(&["card_number", "expiry_date", "cvv"]));
    }

    #[test]
    fn test_detect_mapping_email_formats() {
        // TEST-009: разные форматы email — plain, plus-tag, поддомен, точки в local part
        let raw = "\
4111111111111111|user@gmail.com
5500005555555559|jane.doe+shop@outlook.com
378282246310005|bob@mail.sub.domain.co.uk";
        let m = detect_mapping(raw);
        assert_eq!(m, mapping(&["card_number", "email"]));
    }

    #[test]
    fn test_detect_mapping_duplicate_card_columns_second_skipped() {
        let raw = "\
4111111111111111|5500005555555559|12/29
5500005555555559|4111111111111111|11/29
378282246310005|4111111111111111|10/29";
        let m = detect_mapping(raw);
        assert_eq!(m, mapping(&["card_number", "skip", "expiry_date"]));
    }

    #[test]
    fn test_detect_mapping_empty_input() {
        assert!(detect_mapping("").is_empty());
        assert!(detect_mapping("\n\n  \n").is_empty());
    }

    // ── mapping_preview ──

    #[test]
    fn test_mapping_preview_limits_rows_and_detects() {
        let raw = "\
4111111111111111|12/29
5500005555555559|11/29
378282246310005|10/29
4111111111111111|09/29
5500005555555559|08/29
378282246310005|07/29";
        let p = mapping_preview(raw);
        assert_eq!(p.preview_rows.len(), 5); // max 5 preview rows
        assert_eq!(p.preview_rows[0], vec!["4111111111111111".to_string(), "12/29".to_string()]);
        assert_eq!(p.detected_mapping, mapping(&["card_number", "expiry_date"]));
    }

    // ── parse_cards ──

    #[test]
    fn test_parse_cards_valid_full_row() {
        let raw = "4111111111111111|12/29|123|John Doe";
        let res = parse_cards(raw, mapping(&["card_number", "expiry_date", "cvv", "holder_name"]), "test-src");
        assert_eq!(res.parsed.len(), 1);
        assert_eq!(res.skipped, 0);
        assert!(res.errors.is_empty());
        let c = &res.parsed[0];
        assert_eq!(c.card_number, "4111111111111111");
        assert_eq!(c.expiry_date.as_deref(), Some("12/29"));
        assert_eq!(c.cvv.as_deref(), Some("123"));
        assert_eq!(c.holder_name.as_deref(), Some("John Doe"));
        assert_eq!(c.source, "test-src");
    }

    #[test]
    fn test_parse_cards_invalid_luhn_skipped_with_error() {
        let raw = "4111111111111112|12/29";
        let res = parse_cards(raw, mapping(&["card_number", "expiry_date"]), "t");
        assert_eq!(res.parsed.len(), 0);
        assert_eq!(res.skipped, 1);
        assert_eq!(res.errors.len(), 1);
        assert!(res.errors[0].contains("invalid card number"));
    }

    #[test]
    fn test_parse_cards_missing_card_number() {
        let raw = "12/29|123";
        let res = parse_cards(raw, mapping(&["expiry_date", "cvv"]), "t");
        assert_eq!(res.parsed.len(), 0);
        assert_eq!(res.skipped, 1);
        assert!(res.errors[0].contains("missing card_number"));
    }

    #[test]
    fn test_parse_cards_empty_lines_ignored_and_line_numbers() {
        // FIX B69: пустые строки не считаются — ошибка на 2-й строке данных = "Line 2"
        let raw = "4111111111111111|12/29\n\n\n4111111111111112|11/29\n";
        let res = parse_cards(raw, mapping(&["card_number", "expiry_date"]), "t");
        assert_eq!(res.parsed.len(), 1);
        assert_eq!(res.skipped, 1);
        assert!(res.errors[0].starts_with("Line 2:"), "got: {}", res.errors[0]);
    }

    #[test]
    fn test_parse_cards_log_line_metadata() {
        let raw = "[2026-03-04 01:25:38] IP: 107.218.77.158 | Domain: tristatecamera.com | Data: 4111111111111111|12/29|123";
        let res = parse_cards(raw, mapping(&["card_number", "expiry_date", "cvv"]), "log");
        assert_eq!(res.parsed.len(), 1);
        let c = &res.parsed[0];
        assert_eq!(c.card_number, "4111111111111111");
        assert_eq!(c.domain.as_deref(), Some("tristatecamera.com"));
        assert_eq!(c.acquired_at.as_deref(), Some("2026-03-04 01:25:38"));
        assert_eq!(c.ip_address.as_deref(), Some("107.218.77.158"));
    }

    #[test]
    fn test_parse_cards_expired_expiry_becomes_none_but_card_kept() {
        // Истёкший срок → expiry_date=None, но карта всё равно парсится (Luhn валиден)
        let raw = "4111111111111111|01/20";
        let res = parse_cards(raw, mapping(&["card_number", "expiry_date"]), "t");
        assert_eq!(res.parsed.len(), 1);
        assert_eq!(res.parsed[0].expiry_date, None);
    }

    // ── extract_bin_last4 ──

    #[test]
    fn test_extract_bin_last4_normal() {
        let (bin, last4) = extract_bin_last4("4111111111111111");
        assert_eq!(bin.as_deref(), Some("411111"));
        assert_eq!(last4.as_deref(), Some("1111"));
    }

    #[test]
    fn test_extract_bin_last4_with_separators() {
        let (bin, last4) = extract_bin_last4("4111-1111-1111-1111");
        assert_eq!(bin.as_deref(), Some("411111"));
        assert_eq!(last4.as_deref(), Some("1111"));
    }

    #[test]
    fn test_extract_bin_last4_short_numbers() {
        let (bin, last4) = extract_bin_last4("12345");
        assert_eq!(bin, None); // < 6 digits → no BIN
        assert_eq!(last4.as_deref(), Some("2345"));

        let (bin, last4) = extract_bin_last4("123");
        assert_eq!(bin, None);
        assert_eq!(last4, None); // < 4 digits → no last4
    }
}
