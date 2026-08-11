# Отчет по заглушкам и временному коду VaultBase v2.11.2

**Дата:** 2026-08-10  
**Проект:** VaultBase v2.11.2  
**Директория:** /workspace/manager-work

---

## 📋 Резюме

Проведен комплексный анализ кодовой базы на наличие заглушек, временного кода, hardcoded значений и placeholders. Обнаружено:

- **TODO/FIXME комментарии:** 0 классических TODO, но 74+ комментариев с префиксами FIX/BUG/ISSUE
- **Hardcoded URLs:** 41+ упоминание
- **Hardcoded значения:** 100+ различных констант
- **Пустые функции:** 2 заглушки
- **Unwrap/Expect:** 21 небезопасное использование
- **Console.log:** 82+ отладочных вывода
- **Закомментированный код:** минимальный объем
- **Временные FIX-метки:** 74+ комментария с контекстом багфиксов

---

## 1. TODO, FIXME, HACK, XXX комментарии

### 1.1. Классические TODO/FIXME: НЕ НАЙДЕНО ✓

Хорошая новость: в проекте **нет** комментариев вида `// TODO:` или `// FIXME:`.

### 1.2. FIX-комментарии (74+ упоминания)

Вместо TODO используются структурированные FIX-метки с кодами багов/задач:

#### **Критические (AUDIT, TC-H, CRY-H)**

**Местоположение:** `/workspace/manager-work/src-tauri/src/commands/auth.rs`

```rust
// FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force
// FIX CRY-H02: Use bcrypt cost factor 14 for stronger password hashing (OWASP 2026 recommendation)
```

**Местоположение:** `/workspace/manager-work/src-tauri/src/background.rs`

```rust
// FIX TC-H01: Validate count to prevent command injection
// FIX TC-H01: Use spawn with explicit arg handling (already safe via .arg())
```

**Местоположение:** `/workspace/manager-work/src-tauri/src/commands/config.rs`

```rust
// FIX TC-02: Prevent path traversal attacks by canonicalizing the path
// FIX AUDIT-11: реальный импорт через SQLite backup API (атомарно, без race condition)
```

#### **Средний приоритет (P1-RETRY, P2-QUARANTINE, B-MED)**

**Местоположение:** `/workspace/manager-work/src-tauri/src/commands/cards.rs`

```rust
// FIX P1-RETRY-03: Push update to sync server with retry
// FIX P1-RETRY-04: Push update to sync server with retry
// FIX P1-RETRY-05: Push bulk update to sync server with retry
```

**Местоположение:** `/workspace/manager-work/src-tauri/src/database/_cards.rs`

```rust
// P2-QUARANTINE: Filter by quarantine status (cards < 14 days old are quarantined)
```

Карты младше 14 дней автоматически помещаются в карантин — это бизнес-логика, но комментарий указывает на то, что это временная или настраиваемая мера.

**Местоположение:** `/workspace/manager-work/src-tauri/src/background.rs`

```rust
// FIX B-MED-05: Race condition fix — используем атомарный флаг + единый lock
// FIX P3-FOOTPRINT-AUTO-01: Periodic footprint sync с retry и логированием
// FIX B22: IMAP тред — lock держим минимально, не во время сетевых операций
```

#### **Фронтенд FIX-метки (FE-H, P1-16, P2-STATUS)**

**Местоположение:** `/workspace/manager-work/src/App.jsx`

```javascript
// FIX P2-STATUS-01: WS sync connection status
// FIX FE-H05: Log error instead of silently ignoring
// FIX FE-03: Properly handle Promise.all cleanup with error handling
```

**Местоположение:** `/workspace/manager-work/src/pages/Cards.jsx`

```javascript
// FIX FE-H01: Track delete timers for cleanup on unmount
// FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
```

**Местоположение:** `/workspace/manager-work/src/pages/Orders/RepeatOrderModal.jsx`

```javascript
// FIX P1-16: Add scroll lock
```

---

## 2. Hardcoded значения

### 2.1. URLs и API endpoints (41+ упоминание)

#### **Основной сервер синхронизации**

**Файл:** `/workspace/manager-work/src-tauri/src/endpoints.rs:27`

```rust
const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
```

**Комментарий:**

> Прежний адрес `api.eulivehub.com` был вшит в семь мест и на 2026-08-07 **не резолвится вообще** (NXDOMAIN).

#### **Stuffer API**

**Файл:** `/workspace/manager-work/src-tauri/src/stuffer.rs:11`

```rust
pub const DEFAULT_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";
```

#### **Tracking APIs (USPS, UPS, FedEx, 17track)**

**Файл:** `/workspace/manager-work/src-tauri/src/tracking.rs`

```rust
// Строка 104
"https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML={}"

// Строка 255
"https://ontrack.ups.com/api/tracking/{}"

// Строка 276
"https://ontrack.ups.com/security/v1/oauth/token"

// Строка 448
"https://apis.fedex.com/track/v2/trackingnumbers"
```

**Файл:** `/workspace/manager-work/src-tauri/src/background.rs:400`

```rust
let resp = ureq::post("https://api.17track.net/track/v2.2/gettrackinfo")
```

#### **BIN Lookup API**

**Файл:** `/workspace/manager-work/src-tauri/src/database/_helpers.rs:9`

```rust
let url = format!("https://api.iinapi.com/api/v1/{}", bin);
```

#### **Localhost endpoints в тестах и конфигах**

**Файл:** `/workspace/manager-work/cc-sync-server/socket.js:67`

```javascript
: ['http://localhost:5173', 'http://localhost:1420']
```

**Файл:** `/workspace/manager-work/playwright.config.js:15`

```javascript
baseURL: 'http://localhost:5173',
```

**Файл:** `/workspace/manager-work/cc-sync-server/test/admin-auth.http.test.js:46`

```javascript
base = `http://127.0.0.1:${server.address().port}`
```

#### **Примеры в seed данных**

**Файл:** `/workspace/manager-work/src-tauri/src/database/_seed.rs`

```rust
// Строки 127-151
url: "https://bestbuy.com".into(),
url: "https://walmart.com".into(),
url: "https://newegg.com".into(),

// Строки 182, 191
port: 8080,
```

**Файл:** `/workspace/manager-work/src-tauri/src/database/_misc.rs:447`

```rust
params![name, domain, format!("https://{}", domain)]
```

#### **Placeholder в UI**

**Файл:** `/workspace/manager-work/src/pages/Shops.jsx`

```javascript
// Строка 253
placeholder = 'https://shop.com/product'

// Строка 378
placeholder = 'https://nike.com'
```

**Файл:** `/workspace/manager-work/src/pages/Proxies.jsx:421`

```javascript
'192.168.1.1:8080:user:pass\nsocks5://user:pass@proxy.com:1080\nhttp://10.0.0.1:3128'
```

---

### 2.2. Magic numbers (таймауты, лимиты, размеры)

#### **Таймауты HTTP-запросов**

**Rust (src-tauri/src/):**

```rust
// tracking.rs:109, 261, 461
.timeout(std::time::Duration::from_secs(10))

// stuffer.rs:12
const TIMEOUT_SECS: u64 = 15;

// background.rs:482, 529
.timeout(std::time::Duration::from_secs(30))

// imap.rs:266, 268, 269, 497, 498
Duration::from_secs(8)
stream.set_read_timeout(Some(Duration::from_secs(20)))

// sync.rs: многократно
.timeout(std::time::Duration::from_secs(5))
.timeout(std::time::Duration::from_secs(10))
```

#### **Retry/Batch константы**

**Файл:** `/workspace/manager-work/src-tauri/src/sync.rs`

```rust
const MAX_RETRIES: u32 = 3;  // Строки 133, 485
```

**Файл:** `/workspace/manager-work/src-tauri/src/ws_sync.rs:23`

```rust
const MAX_MISSED_PINGS: u32 = 2;
```

**Файл:** `/workspace/manager-work/src-tauri/src/background.rs:69`

```rust
const MAX_FAILURES_BEFORE_PAUSE: u32 = 5;
```

**Комментарий:** 17track батчинг по 40 номеров (строка 231)

#### **Database pragmas**

**Файл:** `/workspace/manager-work/src-tauri/src/database/_core.rs:31`

```rust
"PRAGMA journal_mode = WAL;
 PRAGMA foreign_keys = ON;
 PRAGMA busy_timeout = 5000;
 PRAGMA wal_autocheckpoint = 3000;"
```

`busy_timeout = 5000` (5 секунд), `wal_autocheckpoint = 3000` (3000 страниц = ~12MB).

#### **Autolock timeout**

**Файл:** `/workspace/manager-work/src-tauri/src/database/_migrations.rs:239`

```rust
('autolock_timeout', '300', 'seconds before auto-lock')
```

300 секунд = 5 минут.

#### **Bcrypt cost factor**

**Файл:** `/workspace/manager-work/src-tauri/src/commands/auth.rs:257`

```rust
let hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
```

Cost factor = 14 (OWASP 2026 рекомендация).

#### **Quarantine период**

**Файл:** `/workspace/manager-work/src-tauri/src/database/_cards.rs:120`

```rust
// Cards older than 14 days OR without acquired_at (always available)
WHERE (acquired_at IS NULL OR julianday('now') - julianday(acquired_at) >= 14)
```

**Файл:** `/workspace/manager-work/src-tauri/src/database/_analytics.rs:330`

```sql
CASE WHEN acquired_at IS NOT NULL
     AND julianday('now') - julianday(acquired_at) < 14
     THEN 1 ELSE 0 END as is_quarantined
```

Карты младше 14 дней находятся в карантине.

#### **JavaScript таймауты**

**Файл:** `/workspace/manager-work/src/hooks/useSmartToast.jsx`

```javascript
defaultDuration: 4000,  // Строка 12
defaultDuration: 5000,  // Строка 22
defaultDuration: 4000,  // Строка 27
```

**Файл:** `/workspace/manager-work/src/App.jsx`

```javascript
const id = setInterval(loadBadges, 30_000) // 30 секунд
const id = setInterval(checkForUpdate, 6 * 60 * 60 * 1000) // 6 часов
```

---

### 2.3. Пароли и секреты в переменных окружения

**ВАЖНО:** Реальные секреты не найдены в коде (✓), но есть частые обращения к `process.env`:

**Файл:** `/workspace/manager-work/cc-sync-server/` (28 упоминаний `process.env`)

```javascript
// auth.js:16
const base = process.env.SESSION_SECRET || process.env.ADMIN_PASS

// middleware.js:70-71
if (!process.env.ADMIN_PASS) {
  console.error('CRITICAL: ADMIN_PASS environment variable is not set.')
}

// routes/activate.js:25
const secret = process.env.SERVER_SECRET

// routes/bin.js:28
const secret = process.env.SERVER_SECRET
```

**Файл:** `/workspace/manager-work/src` (14 упоминаний `import.meta.env`)

```javascript
// App.jsx:491, 516, 579
if (import.meta.env.DEV) console.error(...)
```

**Риски:**

- Секреты хранятся в окружении (правильно), но нет проверок на корректность формата
- `ADMIN_PASS.length < 12` — предупреждение, но не блокировка
- Секреты смешиваются (SESSION_SECRET fallback на ADMIN_PASS)

---

### 2.4. Локализация (i18n)

Проект использует систему локализации через `t()` функцию, но есть hardcoded строки:

**Файл:** `/workspace/manager-work/src/App.jsx:341`

```javascript
toast('Сессия истекла. Пожалуйста, войдите снова.', 'error')
```

Hardcoded русский текст вместо `t('session_expired')`.

---

## 3. Placeholders и заглушки

### 3.1. Пустые функции (2 найдено)

**Файл:** `/workspace/manager-work/src-tauri/src/background.rs`

```rust
// Строка 471
#[cfg(not(target_os = "macos"))]
pub(crate) fn set_dock_badge(_count: u32) {}

// Строка 610
#[cfg(target_os = "windows")]
pub(crate) fn purge_old_webview_cache() {}
```

Обе функции — platform-specific заглушки (корректное использование).

---

### 3.2. Временные/тестовые данные

**Файл:** `/workspace/manager-work/src-tauri/src/database/_seed.rs:127-151`

```rust
ShopInput {
    name: "Best Buy".into(),
    url: "https://bestbuy.com".into(),
    category: "Electronics".into(),
    notes: "Требует AVS-совпадение".into(),
    ...
},
ShopInput {
    name: "Walmart".into(),
    url: "https://walmart.com".into(),
    category: "Retail".into(),
    notes: "Лёгкий, но частые отмены при высоком чеке".into(),
    ...
},
ShopInput {
    name: "Newegg".into(),
    url: "https://newegg.com".into(),
    category: "Electronics".into(),
    notes: "Строгий антифрод, нужен чистый прокси".into(),
    ...
}
```

Seed-данные для демонстрации, но могут попасть в production БД при первом запуске.

---

### 3.3. Примеры в тестах

**Файл:** `/workspace/manager-work/cc-sync-server/test/admin-auth.http.test.js:17`

```javascript
const ADMIN_PASS = 'integration-test-pass'
```

Только в тестах, безопасно.

---

## 4. Недоделанные фичи и технический долг

### 4.1. Закомментированный код

**Файл:** `/workspace/manager-work/src/App.jsx:330`

```javascript
// ─── Keyboard Shortcuts Popup (removed - now using ShortcutsHelp component) ─────
```

Комментарий о старом коде, но сам код удален (✓).

**Файл:** `/workspace/manager-work/src/App.jsx:1345`

```javascript
// Solo mode: single admin user → auto-login, no login screen (old flow: license → master key → app)
```

Описание старого flow, текущий код реализует новый подход.

---

### 4.2. Legacy код и миграции

**Файл:** `/workspace/manager-work/src-tauri/src/database/_cards.rs:599`

```rust
// FIX AUDIT-01: устойчивость к legacy plaintext. Некоторые поля (например,
// holder_name) хранились в plaintext до внедрения шифрования. Код обнаруживает
// шифротекст «legacy plaintext» и перешифровывал его повторно (двойное
// шифрование) — FIX исправил это.
```

**Файл:** `/workspace/manager-work/src-tauri/src/database/_imap.rs:491`

```rust
// Rows written before SMTP passwords were encrypted hold plaintext.
// so a failure identifies a legacy row. Re-encrypt it in place.
```

Код поддерживает старые БД с незашифрованными данными — миграция работает, но добавляет сложность.

---

### 4.3. Неиспользуемые импорты и dead code

**Проверка:**

- ESLint отключения: 53 раза (`// eslint-disable`)
- Неиспользуемые импорты: явно не найдены (проект проходит линтер)

---

### 4.4. Unwrap/Expect (21 упоминание — потенциальные panic)

**Критические:**

**Файл:** `/workspace/manager-work/src-tauri/src/main.rs`

```rust
// Строка 41
let db = Database::open(&db_path_str).expect("Failed to open database");

// Строка 74
let win = app.get_webview_window("main").expect("main window");

// Строка 167
.expect("error building tauri application")
```

**Файл:** `/workspace/manager-work/src-tauri/src/state.rs`

```rust
// Строка 18
pub(crate) fn state() -> &'static AppState {
    STATE.get().expect("AppState not initialized")
}

// Строка 53
WS_HANDLE.get().expect("WsSyncHandle not initialized")
```

**Риск:** Если БД не открывается или state не инициализирован — приложение упадет.

**Менее критические (Regex компиляция):**

**Файл:** `/workspace/manager-work/src-tauri/src/imap.rs:102-106, 339-343, 539-543`

```rust
let re_usps   = Regex::new(r"\b(9[0-9]\d{20})\b").unwrap();
let re_ups    = Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap();
let re_amazon = Regex::new(r"\b(TBA\d{12})\b").unwrap();
let re_fedex  = Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap();
let re_order  = Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap();
```

Паттерны статичны, `.unwrap()` допустим (regex валидны).

---

### 4.5. Console.log в production (82+ упоминания)

**Файл:** `/workspace/manager-work/cc-sync-server/` — **26 упоминаний**

Примеры:

```javascript
// index.js:42
console.log(JSON.stringify(entry))

// index.js:129
server.listen(PORT, () => console.log(`[vaultbase-sync] port ${PORT}`))

// middleware.js:70-71
console.error('CRITICAL: ADMIN_PASS environment variable is not set.')

// routes/bin.js:83
console.error('BIN decryption error:', e.message)
```

**Файл:** `/workspace/manager-work/src/` — **56+ упоминаний**

Примеры:

```javascript
// App.jsx:491
if (import.meta.env.DEV) console.error('[App] update check failed:', e?.message || e)

// hooks/useSmartToast.jsx
console.warn('[Auth] Failed to save session token:', e.message)

// pages/Cards.jsx:214
console.error('[Cards] Load error:', e)
```

**Рекомендация:** Заменить на structured logging (winston/pino для Node, tracing для Rust).

---

## 5. Специфичные риски и антипаттерны

### 5.1. API-11: CORS localhost в production

**Файл:** `/workspace/manager-work/cc-sync-server/socket.js:63-67`

```javascript
// FIX API-11: Restrict CORS to known origins - default to localhost for dev
cors: {
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.WS_ALLOWED_ORIGINS?.split(',') || [])
    : ['http://localhost:5173', 'http://localhost:1420'],
}
```

**Риск:** Если `WS_ALLOWED_ORIGINS` не задан в production, CORS откроет пустой массив → все запросы будут отклонены.

---

### 5.2. B30: 17track батчинг hardcoded 40

**Файл:** `/workspace/manager-work/src-tauri/src/background.rs:231`

```rust
// FIX B30: 17track батчинг по 40 номеров
```

Размер батча не выделен в константу.

---

### 5.3. Миграция bcrypt cost factor

**Файл:** `/workspace/manager-work/src-tauri/src/commands/auth.rs:288-309`

Автоматический upgrade хешей с cost < 14 на новый cost. **Хорошая практика**, но добавляет сложность при входе пользователя.

---

### 5.4. Quarantine logic не настраивается

Период карантина (14 дней) захардкожен в SQL-запросах в 4+ местах:

```rust
julianday('now') - julianday(acquired_at) < 14
```

**Рекомендация:** Вынести в config-таблицу (`quarantine_days`).

---

## 6. Рекомендации по устранению

### Приоритет 1 (Критично)

1. **Вынести URLs в конфигурацию:**
   - `DEFAULT_SERVER_URL`, `DEFAULT_BASE_URL` (stuffer), tracking APIs → ENV vars или config файл
   - Проверить актуальность `api.iinapi.com`, `17track.net` (возможны изменения API)

2. **Убрать `.expect()` в критических местах:**
   - `Database::open().expect()` → возвращать Result, показать диалог ошибки пользователю
   - `state().expect()` → Option или lazy_static с инициализацией в main

3. **Настроить CORS для production:**
   - Fallback `WS_ALLOWED_ORIGINS` на дефолтное значение или fail-fast при старте сервера

4. **Заменить `console.log` на structured logging:**
   - Серверная часть: `winston` или `pino`
   - Rust: `tracing` (уже частично используется?)

### Приоритет 2 (Средний)

5. **Вынести magic numbers в константы:**
   - Таймауты: `TRACKING_TIMEOUT_SECS`, `IMAP_TIMEOUT_SECS`, `HTTP_TIMEOUT_SECS`
   - Карантин: `QUARANTINE_DAYS = 14` → config-таблица
   - Батчинг: `TRACK_BATCH_SIZE = 40` → конфиг

6. **Удалить seed-данные из production сборки:**
   - `_seed.rs` только для dev/demo режима
   - Или перенести в отдельный SQL-файл для setup

7. **Настроить локализацию для всех строк:**
   - `toast('Сессия истекла. ...')` → `t('session_expired')`

8. **Документировать FIX-комментарии:**
   - Создать `FIXES.md` с расшифровкой всех кодов (TC-H03, P2-QUARANTINE, B-MED-05, etc.)

### Приоритет 3 (Низкий)

9. **Оптимизировать Regex компиляцию:**
   - `once_cell::sync::Lazy` для регулярок в `imap.rs` (сейчас компилируются каждый раз)

10. **Code coverage для FIX-исправлений:**
    - Добавить integration-тесты для всех TC-H (security), P1-RETRY (reliability) меток

---

## 7. Статистика

| Категория                        | Количество |
| -------------------------------- | ---------- |
| FIX/BUG/ISSUE комментарии        | 74+        |
| Hardcoded URLs                   | 41+        |
| Magic numbers (таймауты)         | 30+        |
| Magic numbers (другие)           | 70+        |
| Unwrap/Expect                    | 21         |
| Console.log/error                | 82+        |
| Пустые функции (заглушки)        | 2          |
| Seed/тестовые данные             | 3 магазина |
| Локализованные строки (hardcode) | 1+         |
| ESLint отключения                | 53         |
| Rust файлов (src-tauri/src)      | 43         |
| JS/JSX файлов (src)              | 123        |

---

## 8. Заключение

Проект **не содержит классических TODO/FIXME** и имеет относительно чистую кодовую базу. Основные проблемы:

1. **Большое количество hardcoded URLs и magic numbers** — требуют вынесения в конфигурацию
2. **FIX-комментарии (74+)** — хорошо документированные баг-фиксы, но требуют централизованного tracking
3. **Console.log вместо structured logging** — затрудняет debugging в production
4. **Unwrap/Expect в критических местах** — риск panic
5. **Quarantine logic hardcoded** — не настраивается без изменения кода

**Общая оценка технического долга:** Средний уровень. Проект поддерживаемый, но требует рефакторинга конфигурации и улучшения observability.

---

**Конец отчета**
