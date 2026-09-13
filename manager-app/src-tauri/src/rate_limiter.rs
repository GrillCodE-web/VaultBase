// SPEC-B (d62): rate limiting на unlock_app/setup_master_password — порт
// воркерского src-tauri/src/rate_limiter.rs, но только std (OnceLock вместо
// once_cell — менеджер не тащит лишних зависимостей).
//
// Token bucket per command key: не более N попыток за окно. Применяется
// только к чувствительным командам (мастер-пароль) — перебор пароля
// упирается в 5 попыток/минуту.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_ATTEMPTS: u32 = 5;
const WINDOW: Duration = Duration::from_secs(60);

struct Bucket {
    count: u32,
    window_start: Instant,
}

fn buckets() -> &'static Mutex<HashMap<&'static str, Bucket>> {
    static BUCKETS: OnceLock<Mutex<HashMap<&'static str, Bucket>>> = OnceLock::new();
    BUCKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Проверить лимит для команды. Ok(()) — разрешено, Err — превышено.
pub fn check(command_key: &'static str) -> Result<(), String> {
    let mut map = buckets()
        .lock()
        .map_err(|_| "rate_limiter_poisoned".to_string())?;

    let now = Instant::now();

    // Периодическая чистка протухших окон, чтобы map не рос бесконечно
    if map.len() % 100 == 0 && !map.is_empty() {
        map.retain(|_, b| now.duration_since(b.window_start) <= WINDOW * 2);
    }

    let bucket = map.entry(command_key).or_insert(Bucket {
        count: 0,
        window_start: now,
    });

    if now.duration_since(bucket.window_start) > WINDOW {
        bucket.count = 0;
        bucket.window_start = now;
    }

    if bucket.count >= MAX_ATTEMPTS {
        return Err("rate_limit_exceeded".to_string());
    }

    bucket.count += 1;
    Ok(())
}
