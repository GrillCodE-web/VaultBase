# Sprint 3 День 4: Интеграция конфигов

**Дата:** 11 августа 2026  
**Статус:** 🚀 IN PROGRESS

---

## ✅ Завершено (часть 1)

### 1. Загрузка конфига в main.rs ✅

```rust
// Загружает конфиг при старте
// Выбирает профиль из VAULTBASE_PROFILE или dev (debug) / production
// Пытается загрузить из файла, fallback на дефолты
let app_config = config::get_default_config(&profile);
```

### 2. Config добавлен в AppState ✅

```rust
pub struct AppState {
    pub config: Config,  // SPRINT3-DAY4
    pub db: Mutex<Database>,
    pub is_locked: AtomicBool,
    pub current_user: Mutex<Option<ActiveUser>>,
}
```

### 3. Config-aware rate limiter функция ✅

```rust
pub fn check_rate_limit_with_config(
    category: RateLimitCategory,
    key: u64,
    config_limits: (u32, u32, u32)
) -> Result<(), String>
```

### 4. Auth модуль обновлен ✅

```rust
// user_login теперь использует config для rate limits
let config = &state().config;
let rate_limit_result = rate_limiter::check_rate_limit_with_config(
    RateLimitCategory::Strict,
    key,
    (config.security.rate_limit_strict, config.security.rate_limit_moderate, config.security.rate_limit_lenient)
);
```

---

## 📋 Что остается сделать (части 2-5)

### Часть 2: Rate Limiter - все оставшиеся функции

**Файл:** `src-tauri/src/commands/auth.rs`

**Функции которые нужно обновить:**

- [ ] Line 309: `setup_password()` - use config.security.rate_limit_strict
- [ ] Line 342: `unlock()` - use config.security.rate_limit_strict
- [ ] Line 439: `change_password()` - use config.security.rate_limit_strict

**Паттерн:**

```rust
// БЫЛО:
rate_limiter::check_rate_limit(RateLimitCategory::Strict, key)?;

// СТАНЕТ:
let config = &state().config;
rate_limiter::check_rate_limit_with_config(
    RateLimitCategory::Strict,
    key,
    (config.security.rate_limit_strict, config.security.rate_limit_moderate, config.security.rate_limit_lenient)
)?;
```

---

### Часть 3: API URLs - endpoints.rs

**Файл:** `src-tauri/src/endpoints.rs`

**Константы которые нужно заменить:**

- [ ] `SYNC_SERVER_URL` → `state().config.api.sync_server`
- [ ] `STUFFER_BASE_URL` → `state().config.api.stuffer_base`
- [ ] Tracking APIs (USPS, UPS, FedEx, Track17, IINAPI)

**Паттерн:**

```rust
// БЫЛО:
const SYNC_SERVER_URL: &str = "https://example.com";
let url = format!("{}/endpoint", SYNC_SERVER_URL);

// СТАНЕТ:
let config = &state().config;
let url = format!("{}/endpoint", config.api.sync_server);
```

**Функции:**

- [ ] `invoke_sync_api()` - use config.api.sync_server + request_timeout
- [ ] `invoke_stuffer()` - use config.api.stuffer_base + request_timeout
- [ ] `invoke_tracking_api()` - use config.api.tracking.* URLs + tracking_timeout
- [ ] USPS tracking - use config.api.tracking.usps
- [ ] UPS tracking - use config.api.tracking.ups
- [ ] FedEx tracking - use config.api.tracking.fedex
- [ ] Track17 - use config.api.tracking.track17
- [ ] IINAPI - use config.api.tracking.iinapi

---

### Часть 4: HTTP Timeouts - endpoints.rs + commands/*.rs

**Файл:** `src-tauri/src/endpoints.rs` и другие

**Константы которые нужно заменить:**

- [ ] `HTTP_REQUEST_TIMEOUT_SECS` → `config.api.request_timeout`
- [ ] `TRACKING_REQUEST_TIMEOUT_SECS` → `config.api.tracking_timeout`

**Паттерн:**

```rust
// БЫЛО:
let timeout = Duration::from_secs(HTTP_REQUEST_TIMEOUT_SECS);

// СТАНЕТ:
let config = &state().config;
let timeout = Duration::from_secs(config.api.request_timeout as u64);
```

---

### Часть 5: Database - database/*.rs

**Файл:** `src-tauri/src/database/mod.rs`

**Параметры которые нужно использовать:**

- [ ] `max_connections` → `config.database.max_connections`
- [ ] `connection_timeout` → `config.database.connection_timeout`
- [ ] `max_bulk_size` (for IN clause) → `config.database.max_bulk_size`

**Где использовать:**

- [ ] Connection pool initialization
- [ ] Bulk operation size validation
- [ ] Query timeouts

**Паттерн:**

```rust
// БЫЛО:
let pool = create_pool(5);  // hardcoded 5

// СТАНЕТ:
let config = &state().config;
let pool = create_pool(config.database.max_connections);
```

---

### Часть 6: Background Tasks - background.rs

**Файл:** `src-tauri/src/background.rs`

**Интервалы которые нужно использовать:**

- [ ] `license_check_interval` → config.background.license_check_interval
- [ ] `sync_interval` → config.background.sync_interval
- [ ] `stuffer_poll_interval` → config.background.stuffer_poll_interval
- [ ] `fulfillment_check_interval` → config.background.fulfillment_check_interval
- [ ] `risk_check_interval` → config.background.risk_check_interval
- [ ] `quarantine_cleanup_interval` → config.background.quarantine_cleanup_interval
- [ ] `catalog_update_interval` → config.background.catalog_update_interval

**Паттерн:**

```rust
// БЫЛО:
loop {
    sleep(Duration::from_secs(60));  // hardcoded 60 sec
    do_sync();
}

// СТАНЕТ:
let config = &state().config;
loop {
    sleep(Duration::from_secs(config.background.sync_interval as u64));
    do_sync();
}
```

---

### Часть 7: Email (IMAP/SMTP) - imap.rs, smtp.rs

**Файл:** `src-tauri/src/imap.rs` и `src-tauri/src/smtp.rs`

**Параметры которые нужно использовать:**

- [ ] `imap_poll_interval` → config.email.imap_poll_interval
- [ ] `imap_fetch_limit` → config.email.imap_fetch_limit
- [ ] `smtp_timeout` → config.email.smtp_timeout

**Паттерн:**

```rust
// БЫЛО:
const IMAP_POLL_INTERVAL: u32 = 5;

// СТАНЕТ:
let config = &state().config;
let interval = config.email.imap_poll_interval;
```

---

### Часть 8: Security Settings - encryption.rs, rate_limiter.rs

**Файл:** `src-tauri/src/encryption.rs` и `src-tauri/src/rate_limiter.rs`

**Параметры которые нужно использовать:**

- [ ] `pbkdf2_iterations` → config.security.pbkdf2_iterations
- [ ] `session_timeout` → config.security.session_timeout
- [ ] `autolock_timeout` → config.security.autolock_timeout
- [ ] Rate limits (уже частично сделано)

**Паттерн:**

```rust
// БЫЛО:
const PBKDF2_ITERATIONS: u32 = 600_000;

// СТАНЕТ:
let config = &state().config;
let iterations = config.security.pbkdf2_iterations;
```

---

### Часть 9: Logging Settings - main.rs

**Файл:** `src-tauri/src/main.rs`

**Параметры которые нужно использовать:**

- [ ] `log_level` → config.logging.level
- [ ] `json` → config.logging.json
- [ ] `file_output` → config.logging.file_output
- [ ] `log_dir` → config.logging.log_dir

**Где использовать:**

- [ ] logging::init_logging() - already done (uses config at startup)
- [ ] Но можно добавить в логирование какой конфиг использован

---

## 🎯 Приоритет

1. **Критично** (влияет на security):
   - ✅ Rate limits (DONE)
   - [ ] PBKDF2 iterations
   - [ ] Session timeout

2. **Важно** (влияет на behavior):
   - [ ] API URLs
   - [ ] HTTP timeouts
   - [ ] Background intervals

3. **Nice-to-have** (улучшение):
   - [ ] Database settings
   - [ ] Email settings
   - [ ] Logging settings

---

## 📊 Статистика

| Компонент  | Функции  | Константы            | Статус   |
| ---------- | -------- | -------------------- | -------- |
| Auth       | ✅ 1/4   | ✅ rate_limit        | 25%      |
| Endpoints  | 0/6      | ❌ URLs + timeouts   | 0%       |
| Background | 0/7      | ❌ intervals         | 0%       |
| Database   | 0/3      | ❌ connection params | 0%       |
| Email      | 0/3      | ❌ IMAP/SMTP params  | 0%       |
| Encryption | 0/3      | ❌ security params   | 0%       |
| **TOTAL**  | **1/22** | -                    | **4.5%** |

---

## 🔄 После интеграции

### Что удалить:

1. Большинство констант из `constants.rs`
2. Hardcoded URLs из `endpoints.rs`
3. Hardcoded intervals из `background.rs`
4. Hardcoded timeout из везде

### Что оставить:

1. Constants.rs - только для очень базовых вещей
2. Или вообще удалить и использовать только конфиги

### Обновить тесты:

1. Все тесты которые используют hardcoded константы
2. Обновить чтобы использовали конфиг-based значения

---

## 📝 Пример полного обновления одной функции

### ДО:

```rust
#[tauri::command]
pub(crate) fn user_login(username: String, password: String) -> Result<LoginResult, String> {
    rate_limiter::check_rate_limit(
        rate_limiter::RateLimitCategory::Strict,
        rate_limiter::get_rate_limit_key("user_login")
    )?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_REQUEST_TIMEOUT_SECS))
        .build()?;

    let response = client
        .post(&format!("{}/login", SYNC_SERVER_URL))
        .send()
        .await?;

    // ... rest of function
}
```

### ПОСЛЕ:

```rust
#[tauri::command]
pub(crate) fn user_login(username: String, password: String) -> Result<LoginResult, String> {
    let config = &state().config;

    // Use config-based rate limiting
    rate_limiter::check_rate_limit_with_config(
        rate_limiter::RateLimitCategory::Strict,
        rate_limiter::get_rate_limit_key("user_login"),
        (config.security.rate_limit_strict, config.security.rate_limit_moderate, config.security.rate_limit_lenient)
    )?;

    // Use config-based timeout
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.api.request_timeout as u64))
        .build()?;

    // Use config-based API URL
    let response = client
        .post(&format!("{}/login", config.api.sync_server))
        .send()
        .await?;

    // ... rest of function
}
```

---

## 🎉 Результат

После завершения:

- ✅ Все константы заменены на конфиг значения
- ✅ Возможность переключать поведение через TOML файлы
- ✅ Разные настройки для dev/staging/production
- ✅ ENV переопределения работают везде
- ✅ Единственный источник истины - config в AppState

---

## 📞 Следующие шаги

1. Продолжить интеграцию во все модули
2. Обновить тесты
3. Удалить ненужные константы
4. Создать миграционный гайд для разработчиков

**Продолжим?** 💪
