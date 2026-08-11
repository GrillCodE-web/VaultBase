# Action Plan: Устранение технического долга VaultBase v2.11.2

**Дата:** 2026-08-10  
**Статус:** План утвержден после анализа кодовой базы

---

## 🎯 Краткая сводка

- **Всего проблемных мест:** 300+
- **Критичных:** 5
- **Средней важности:** 50+
- **Низкой важности:** 245+
- **Оценка трудозатрат:** 3-5 дней разработки + 2 дня тестирования

---

## 📅 План работ (по приоритетам)

### SPRINT 1: Критичные исправления (1-2 дня)

#### Задача 1.1: Обработка ошибок вместо panic

**Приоритет:** 🔴 КРИТИЧНЫЙ  
**Файлы:** `src-tauri/src/main.rs`, `src-tauri/src/state.rs`

**Действия:**

```rust
// БЫЛО:
let db = Database::open(&db_path_str).expect("Failed to open database");

// ДОЛЖНО БЫТЬ:
let db = Database::open(&db_path_str).map_err(|e| {
    show_error_dialog(&format!("Database initialization failed: {}", e));
    std::process::exit(1);
})?;
```

**Файлы для правки:**

- `/workspace/manager-work/src-tauri/src/main.rs:41` — Database::open
- `/workspace/manager-work/src-tauri/src/main.rs:74` — get_webview_window
- `/workspace/manager-work/src-tauri/src/state.rs:18` — STATE.get()
- `/workspace/manager-work/src-tauri/src/state.rs:53` — WS_HANDLE.get()

**Результат:** Graceful shutdown вместо panic, информативные ошибки для пользователя.

---

#### Задача 1.2: CORS fallback для production

**Приоритет:** 🔴 КРИТИЧНЫЙ  
**Файл:** `cc-sync-server/socket.js:65`

**Действия:**

```javascript
// БЫЛО:
origin: process.env.NODE_ENV === 'production'
  ? process.env.WS_ALLOWED_ORIGINS?.split(',') || []
  : ['http://localhost:5173', 'http://localhost:1420']

// ДОЛЖНО БЫТЬ:
origin: process.env.NODE_ENV === 'production'
  ? process.env.WS_ALLOWED_ORIGINS?.split(',') ||
    (() => {
      console.error('FATAL: WS_ALLOWED_ORIGINS not set in production')
      process.exit(1)
    })()
  : ['http://localhost:5173', 'http://localhost:1420']
```

**Результат:** Fail-fast при отсутствии критичной конфигурации.

---

#### Задача 1.3: Проверка ADMIN_PASS при старте

**Приоритет:** 🔴 КРИТИЧНЫЙ  
**Файл:** `cc-sync-server/middleware.js:70`

**Действия:**

```javascript
if (!process.env.ADMIN_PASS) {
  console.error('FATAL: ADMIN_PASS environment variable is not set.')
  process.exit(1) // Добавить выход вместо продолжения работы
}
```

**Результат:** Сервер не запустится без критичных секретов.

---

### SPRINT 2: Конфигурация и hardcoded значения (2-3 дня)

#### Задача 2.1: Централизация URLs

**Приоритет:** 🟡 ВЫСОКИЙ  
**Файлы:** `src-tauri/src/endpoints.rs`, `src-tauri/src/stuffer.rs`, `src-tauri/src/tracking.rs`

**Действия:**

1. Создать файл `src-tauri/src/config.rs`:

```rust
pub struct ApiConfig {
    pub server_url: String,
    pub stuffer_url: String,
    pub usps_api_url: String,
    pub ups_api_url: String,
    pub fedex_api_url: String,
    pub seventeen_track_url: String,
    pub iinapi_url: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            server_url: env::var("VAULTBASE_SERVER_URL")
                .unwrap_or_else(|_| "https://sec201-www.otpmanager.pro".to_string()),
            stuffer_url: env::var("STUFFER_BASE_URL")
                .unwrap_or_else(|_| "https://dash.stockhubdeal.com/api/stuffer/".to_string()),
            usps_api_url: env::var("USPS_API_URL")
                .unwrap_or_else(|_| "https://secure.shippingapis.com/ShippingAPI.dll".to_string()),
            // ... и т.д.
        }
    }
}
```

2. Обновить использование в:
   - `/workspace/manager-work/src-tauri/src/tracking.rs:104,255,276,448`
   - `/workspace/manager-work/src-tauri/src/background.rs:400`
   - `/workspace/manager-work/src-tauri/src/database/_helpers.rs:9`

**Результат:** Все API URLs настраиваются через ENV или конфиг-файл.

---

#### Задача 2.2: Константы для magic numbers

**Приоритет:** 🟡 ВЫСОКИЙ

**Действия:**

1. Создать файл `src-tauri/src/constants.rs`:

```rust
pub mod timeouts {
    pub const HTTP_DEFAULT_SECS: u64 = 10;
    pub const HTTP_SLOW_SECS: u64 = 30;
    pub const IMAP_READ_SECS: u64 = 20;
    pub const IMAP_WRITE_SECS: u64 = 8;
    pub const STUFFER_SECS: u64 = 15;
}

pub mod retry {
    pub const MAX_RETRIES: u32 = 3;
    pub const MAX_MISSED_PINGS: u32 = 2;
    pub const MAX_FAILURES_BEFORE_PAUSE: u32 = 5;
}

pub mod batch {
    pub const TRACKING_BATCH_SIZE: usize = 40;
}

pub mod quarantine {
    pub const DAYS: i64 = 14;
}

pub mod bcrypt {
    pub const COST_FACTOR: u32 = 14;
}
```

2. Заменить все hardcoded значения на константы из `constants.rs`.

**Файлы для правки (50+ упоминаний):**

- Таймауты: `tracking.rs`, `sync.rs`, `imap.rs`, `background.rs`, `stuffer.rs`
- Retry: `sync.rs`, `ws_sync.rs`, `background.rs`
- Quarantine: `_cards.rs`, `_analytics.rs`
- Bcrypt: `commands/auth.rs`

**Результат:** Все константы в одном месте, легко настраиваются.

---

#### Задача 2.3: Quarantine в конфиг-таблицу

**Приоритет:** 🟡 ВЫСОКИЙ  
**Файлы:** `src-tauri/src/database/_cards.rs`, `_analytics.rs`, `_misc.rs`

**Действия:**

1. Добавить в миграцию:

```sql
INSERT INTO config (key, value, description) VALUES
  ('quarantine_days', '14', 'Days before card is released from quarantine');
```

2. Создать helper:

```rust
impl Database {
    pub fn get_quarantine_days(&self) -> Result<i64, String> {
        self.get_config_i64("quarantine_days", 14)
    }
}
```

3. Заменить hardcoded `14` на `get_quarantine_days()` в:
   - `/workspace/manager-work/src-tauri/src/database/_cards.rs:120,123`
   - `/workspace/manager-work/src-tauri/src/database/_analytics.rs:330`

**Результат:** Администратор может настроить период карантина через UI настроек.

---

### SPRINT 3: Улучшение observability (1-2 дня)

#### Задача 3.1: Structured logging (Node.js)

**Приоритет:** 🟢 СРЕДНИЙ  
**Файлы:** `cc-sync-server/**/*.js`

**Действия:**

1. Установить `pino`:

```bash
cd cc-sync-server && npm install pino pino-pretty
```

2. Создать `cc-sync-server/logger.js`:

```javascript
const pino = require('pino')
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
})
module.exports = logger
```

3. Заменить все `console.log/error/warn` на `logger.info/error/warn`.

**Файлы для правки (26 упоминаний):**

- `index.js:42,103,126,129,140`
- `middleware.js:53,70,75`
- `routes/admin-api.js:286`
- `routes/admin-auth.js:31,37,49`
- `routes/bin.js:83,105`
- `routes/catalog.js:16,29`
- `routes/invite.js:90`
- `routes/sync.js:259`
- `routes/update.js:74`
- `socket.js:157`
- `ws-tauri.js:207,252,255`

**Результат:** JSON логи в production, красивый вывод в dev, фильтрация по уровню.

---

#### Задача 3.2: Улучшение логирования (Rust)

**Приоритет:** 🟢 СРЕДНИЙ  
**Файлы:** Rust backend (если используется `tracing`)

**Действия:**

1. Проверить наличие `tracing` в `Cargo.toml`
2. Добавить structured logging для critical paths
3. Заменить `eprintln!` на `tracing::error!`

**Результат:** Централизованные логи с контекстом.

---

#### Задача 3.3: Удаление console.log из React

**Приоритет:** 🟢 СРЕДНИЙ  
**Файлы:** `src/**/*.jsx` (56+ упоминаний)

**Действия:**

1. Создать `src/utils/logger.js`:

```javascript
const isDev = import.meta.env.DEV

export const logger = {
  error: (...args) => isDev && console.error(...args),
  warn: (...args) => isDev && console.warn(...args),
  info: (...args) => isDev && console.log(...args),
  debug: (...args) => isDev && console.debug(...args),
}
```

2. Заменить все `console.*` на `logger.*`.

**Результат:** Логи только в dev-режиме, чистый production build.

---

### SPRINT 4: Оптимизация и cleanup (1 день)

#### Задача 4.1: Regex в once_cell

**Приоритет:** 🟢 НИЗКИЙ  
**Файл:** `src-tauri/src/imap.rs`

**Действия:**

```rust
use once_cell::sync::Lazy;

static RE_USPS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(9[0-9]\d{20})\b").unwrap());
static RE_UPS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap());
static RE_AMAZON: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(TBA\d{12})\b").unwrap());
static RE_FEDEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap());
static RE_ORDER: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap());
```

Заменить в:

- `/workspace/manager-work/src-tauri/src/imap.rs:102-106`
- `/workspace/manager-work/src-tauri/src/imap.rs:339-343`
- `/workspace/manager-work/src-tauri/src/imap.rs:539-543`

**Результат:** Regex компилируются один раз при старте приложения.

---

#### Задача 4.2: Seed данные только для dev

**Приоритет:** 🟢 НИЗКИЙ  
**Файл:** `src-tauri/src/database/_seed.rs`

**Действия:**

```rust
#[cfg(debug_assertions)]
pub fn seed_demo_data(&self) -> Result<(), String> {
    // ... existing code ...
}

#[cfg(not(debug_assertions))]
pub fn seed_demo_data(&self) -> Result<(), String> {
    Ok(()) // No-op in release
}
```

**Результат:** Seed данные не попадут в production.

---

#### Задача 4.3: Локализация hardcoded строк

**Приоритет:** 🟢 НИЗКИЙ  
**Файлы:** `src/App.jsx`, `src/i18n/ru.js`

**Действия:**

1. Добавить в `src/i18n/en.js` и `src/i18n/ru.js`:

```javascript
session_expired: 'Session expired. Please log in again.',
```

2. Заменить в `src/App.jsx:341`:

```javascript
toast(t('session_expired'), 'error')
```

**Результат:** Все UI строки локализуемы.

---

### SPRINT 5: Документация (0.5 дня)

#### Задача 5.1: Расшифровка FIX-кодов

**Приоритет:** 🟢 НИЗКИЙ

**Действия:**
Создать файл `FIXES_GLOSSARY.md`:

```markdown
# Расшифровка FIX-кодов в VaultBase

## Категории

### TC-H (Thread/Concurrency - High)

- TC-H01: Command injection защита
- TC-H02: Path traversal защита
- TC-H03: Rate limiting

### CRY-H (Cryptography - High)

- CRY-H02: Bcrypt cost factor 14

### AUDIT

- AUDIT-01: Legacy plaintext migration
- AUDIT-09: Logging для мониторинга
- AUDIT-11: Atomic operations
- AUDIT-13: Live query optimization

### B-MED (Bug - Medium)

- B-MED-04: Connection pooling
- B-MED-05: Race condition fix
- B-MED-07: Bcrypt auto-upgrade

### P1-RETRY, P2-STATUS, P3-FOOTPRINT

- Retry механизмы и reliability improvements

### FE-H (Frontend - High)

- FE-H01: Cleanup on unmount
- FE-H05: Error logging
- FE-03: Promise.all error handling

### F-MED (Frontend - Medium)

- F-MED-01: useCallback optimization

### API-11, WS-BATCH, WS-MAXPAYLOAD

- WebSocket и API security
```

**Результат:** Новые разработчики понимают контекст FIX-комментариев.

---

## 📊 Чеклист выполнения

### SPRINT 1 (Критичные)

- [ ] 1.1: Обработка ошибок вместо panic (main.rs, state.rs)
- [ ] 1.2: CORS fallback для production (socket.js)
- [ ] 1.3: Проверка ADMIN_PASS при старте (middleware.js)

### SPRINT 2 (Конфигурация)

- [ ] 2.1: Централизация URLs (config.rs)
- [ ] 2.2: Константы для magic numbers (constants.rs)
- [ ] 2.3: Quarantine в конфиг-таблицу

### SPRINT 3 (Observability)

- [ ] 3.1: Structured logging (Node.js + pino)
- [ ] 3.2: Улучшение логирования (Rust)
- [ ] 3.3: Удаление console.log из React

### SPRINT 4 (Оптимизация)

- [ ] 4.1: Regex в once_cell
- [ ] 4.2: Seed данные только для dev
- [ ] 4.3: Локализация hardcoded строк

### SPRINT 5 (Документация)

- [ ] 5.1: Расшифровка FIX-кодов (FIXES_GLOSSARY.md)

---

## 🧪 План тестирования

После каждого спринта:

1. **Unit тесты:**
   - Новые функции обработки ошибок
   - Config loading с fallback значениями
   - Quarantine logic с разными периодами

2. **Integration тесты:**
   - CORS с различными origins
   - Retry механизмы
   - Логирование в разных режимах

3. **E2E тесты:**
   - Критичные flow (активация, sync, tracking)
   - Проверка на отсутствие panic

4. **Security audit:**
   - Проверка всех TC-H исправлений
   - Проверка секретов в логах

---

## 📈 Метрики успеха

| Метрика                          | Было | Цель |
| -------------------------------- | ---- | ---- |
| Console.log в production         | 82   | 0    |
| Unwrap/Expect в критичных местах | 6    | 0    |
| Hardcoded URLs                   | 7    | 0    |
| Magic numbers (без констант)     | 100+ | <10  |
| Seed данных в release build      | Да   | Нет  |
| Hardcoded локализация            | 1+   | 0    |

---

## 🚀 После завершения

1. Создать release `v2.12.0` с описанием всех изменений
2. Обновить deployment скрипты для новых ENV переменных
3. Провести код-ревью всех изменений
4. Запустить full regression testing
5. Развернуть на staging → production

---

**Конец плана**
