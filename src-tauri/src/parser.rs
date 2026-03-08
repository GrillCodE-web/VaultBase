//! CC dump parser with auto-delimiter detection, Luhn validation, and column auto-detection.

use crate::models::{CardInput, MappingPreview};

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

fn strip_log_prefix(line: &str) -> &str {
    // Look for "| Data: " (case-insensitive search using lowercase)
    let lower = line.to_lowercase();
    if let Some(pos) = lower.rfind("| data: ") {
        return &line[pos + 8..];
    }
    if let Some(pos) = lower.find("data: ") {
        // Only strip if it looks like a log line (starts with '[')
        if line.trim_start().starts_with('[') {
            return &line[pos + 6..];
        }
    }
    line
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
        return Some(format!("{:02}/{:02}", mm, yy));
    }
    // MMYYYY or MMYY
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.len() {
        4 => {
            let mm: u32 = digits[..2].parse().ok()?;
            let yy: u32 = digits[2..].parse().ok()?;
            if mm < 1 || mm > 12 { return None; }
            Some(format!("{:02}/{:02}", mm, yy))
        }
        6 => {
            let mm: u32 = digits[..2].parse().ok()?;
            let yy: u32 = digits[4..].parse().ok()?;
            if mm < 1 || mm > 12 { return None; }
            Some(format!("{:02}/{:02}", mm, yy))
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

    // cvv: 3-4 digits only
    let cvv_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        (d.len() == 3 || d.len() == 4) && *s == &d
    }).count();
    if cvv_hits > n * 2 / 3 { return "cvv".into(); }

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

    // zip: 5 digits or short numeric (4-10 chars)
    let zip_hits = non_empty.iter().filter(|s| {
        let d: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
        d.len() == s.len() && s.len() >= 4 && s.len() <= 10
    }).count();
    if zip_hits > n * 2 / 3 { return "zip".into(); }

    // holder_name: 2+ words, alpha + spaces + hyphens
    let name_hits = non_empty.iter().filter(|s| {
        let words: Vec<&str> = s.split_whitespace().collect();
        words.len() >= 2 && words.iter().all(|w| w.chars().all(|c| c.is_alphabetic() || c == '-'))
    }).count();
    if name_hits > n / 2 { return "holder_name".into(); }

    // city: 1+ words, all alpha (+ space/hyphen/period), length >= 3, not 2-letter
    let city_hits = non_empty.iter().filter(|s| {
        s.len() >= 3
            && s.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '.')
            && !s.trim().is_empty()
    }).count();
    if city_hits > n / 2 { return "city".into(); }

    "skip".into()
}

// ─────────────────────────────────────────
//  Public: detect_mapping
// ─────────────────────────────────────────

pub fn detect_mapping(raw: &str) -> Vec<String> {
    let delim = detect_delimiter(raw);
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
    let delim = detect_delimiter(raw);
    let rows: Vec<Vec<String>> = raw.lines()
        .map(|l| strip_log_prefix(l.trim()))
        .filter(|l| !l.is_empty())
        .take(5)
        .map(|l| l.split(delim).map(|s| s.trim().to_string()).collect())
        .collect();

    let detected = detect_mapping(raw);
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

    for (line_no, line) in raw.lines().enumerate() {
        let line = strip_log_prefix(line.trim());
        if line.is_empty() { continue; }

        let parts: Vec<&str> = line.split(delim).map(|s| s.trim()).collect();

        let mut input = CardInput {
            source: source.to_string(),
            ..Default::default()
        };

        let mut has_card_number = false;

        for (i, field) in mapping.iter().enumerate() {
            let val = parts.get(i).copied().unwrap_or("").trim();
            if val.is_empty() || field == "skip" { continue; }

            match field.as_str() {
                "card_number" => {
                    let clean: String = val.chars().filter(|c| c.is_ascii_digit()).collect();
                    if luhn_valid(&clean) {
                        input.card_number = clean;
                        has_card_number = true;
                    } else {
                        errors.push(format!("Line {}: invalid card number \"{}\"", line_no+1, &val[..val.len().min(20)]));
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
                "ip_address"      => { input.ip_address = Some(val.to_string()); }
                _ => {}
            }
        }

        if !has_card_number {
            if !errors.last().map(|e: &String| e.starts_with(&format!("Line {}:", line_no+1))).unwrap_or(false) {
                errors.push(format!("Line {}: missing card_number", line_no+1));
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
