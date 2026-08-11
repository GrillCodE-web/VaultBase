# ⚡ БЫСТРАЯ ПАМЯТКА ДЛЯ ИСПРАВЛЕНИЙ

## 🔥 СДЕЛАТЬ СЕГОДНЯ (1-2 часа)

```bash
# 1. Проверка Rust уязвимостей
cd /workspace/manager-work/src-tauri
cargo install cargo-audit
cargo audit

# 2. Обновить jspdf
cd /workspace/manager-work
npm install jspdf@^2.5.2
npm test

# 3. Поиск секретов в коде
grep -r "sk_\|pk_\|api_key\|secret\|password" src/ | grep -v ".test." | grep -v "placeholder"

# 4. Проверить переменную окружения
echo $TAURI_ENV_DEBUG
# Должна быть пустой в production
```

---

## 🔴 КРИТИЧНЫЕ ИСПРАВЛЕНИЯ (3-5 дней)

### День 1: Обработка ошибок в Rust

**Файл:** `src-tauri/src/main.rs`

**Было:**

```rust
let db = Database::open(&db_path_str).expect("Failed to open database");
```

**Стало:**

```rust
let db = match Database::open(&db_path_str) {
    Ok(d) => d,
    Err(e) => {
        tauri::api::dialog::blocking::message(
            Some(&window),
            "Критическая ошибка",
            format!("Не удалось открыть базу данных: {}", e),
        );
        std::process::exit(1);
    }
};
```

**Всего заменить:** 21 место

- main.rs: строки 41, 74, 167
- state.rs: строки 18, 53
- encryption.rs: строка 106
- imap.rs: строки 102-106, 339-343, 539-543

---

### День 2: CSP без unsafe-inline

**Файл:** `src-tauri/tauri.conf.json`

**Было:**

```json
"csp": "default-src 'self'; style-src 'self' 'unsafe-inline' blob:; ..."
```

**Стало:**

```json
"csp": "default-src 'self'; style-src 'self'; upgrade-insecure-requests; report-uri https://sec201-www.otpmanager.pro/csp-report; ..."
```

**Действия:**

1. Найти все inline стили в JSX: `grep -r "style={{" src/`
2. Вынести в CSS файлы или использовать className
3. Тестировать в dev mode с новым CSP

---

### День 3: Race Conditions

**Файл:** `src-tauri/src/background.rs`

**Было:**

```rust
let should_lock = {
    let db = match st.db.lock() { Ok(d) => d, Err(_) => continue };
    // ... проверки
};
if should_lock {
    if let Ok(mut db) = st.db.lock() { // TOCTOU BUG
        db.clear_encryption();
    }
}
```

**Стало:**

```rust
let mut db = match st.db.lock() {
    Ok(d) => d,
    Err(_) => continue,
};

if !db.is_locked() {
    // ... проверки внутри одного lock
    if should_lock {
        db.clear_encryption();
        drop(db);
        st.is_locked.store(true, Ordering::SeqCst);
    }
}
```

---

**Файл:** `src-tauri/src/tracking.rs`

**Добавить cleanup:**

```rust
const MAX_CACHE_SIZE: usize = 1000;
const CACHE_TTL_SECONDS: i64 = 3600;

fn cache_tracking_result(tracking: &str, status: TrackingStatus) {
    if let Ok(mut guard) = TRACKING_CACHE.lock() {
        // Периодическая очистка
        if guard.len() % 100 == 0 {
            let now = chrono::Utc::now().timestamp();
            guard.retain(|_, (_, timestamp)| now - timestamp < CACHE_TTL_SECONDS * 2);
        }

        // LRU eviction
        if guard.len() >= MAX_CACHE_SIZE {
            let oldest_key = guard.iter()
                .min_by_key(|(_, (_, ts))| ts)
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest_key {
                guard.remove(&key);
            }
        }

        guard.insert(tracking.to_string(), (status, chrono::Utc::now().timestamp()));
    }
}
```

---

### День 4: CI/CD Тесты

**Создать файл:** `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
      - run: cd src-tauri && cargo test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run test:e2e
```

---

### День 5: React Memory Leaks

**Файл:** `src/pages/Cards.jsx`

**Было:**

```jsx
useEffect(() => {
  const setupListeners = async () => {
    const updateListener = await listen('sync:card_update', event => {
      timers[card.id] = setTimeout(() => {
        removeFlashedId(card.id)
      }, 2000)
    })
    unlistenUpdate = updateListener
  }
  setupListeners()

  return () => {
    if (unlistenUpdate) unlistenUpdate()
    Object.values(timers).forEach(clearTimeout) // stale closure
  }
}, [addFlashedId, removeFlashedId])
```

**Стало:**

```jsx
useEffect(() => {
  let cancelled = false
  let unlistenUpdate = null
  const timers = {}

  const setupListeners = async () => {
    if (cancelled) return

    const updateListener = await listen('sync:card_update', event => {
      if (cancelled) return

      const timerId = setTimeout(() => {
        if (!cancelled) removeFlashedId(card.id)
      }, 2000)

      timers[card.id] = timerId
    })

    if (!cancelled) unlistenUpdate = updateListener
  }

  setupListeners()

  return () => {
    cancelled = true
    if (unlistenUpdate) unlistenUpdate()
    Object.values(timers).forEach(clearTimeout)
  }
}, [removeFlashedId])
```

---

## 🟡 ВАЖНЫЕ ИСПРАВЛЕНИЯ (1 неделя)

### Конфигурация URLs

**Создать файл:** `src-tauri/src/constants.rs`

```rust
pub mod config {
    pub const SYNC_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
    pub const TRACKING_UPS_URL: &str = "https://wwwapps.ups.com/track/api/Track/GetStatus";
    pub const TRACKING_FEDEX_URL: &str = "https://www.fedex.com/trackingCal/track";
    pub const TRACKING_USPS_URL: &str = "https://tools.usps.com/go/TrackConfirmAction";
    pub const IINAPI_URL: &str = "https://api.iinapi.com/api/v1/bin/";
    pub const TRACK17_URL: &str = "https://api.17track.net";
}

pub mod timeouts {
    pub const BACKGROUND_CHECK_INTERVAL_SECS: u64 = 1;
    pub const TRACKING_CACHE_TTL_SECS: i64 = 3600; // 1 час
    pub const DEFAULT_AUTOLOCK_TIMEOUT_SECS: u64 = 300; // 5 минут
    pub const RATE_LIMIT_WINDOW_SECS: u64 = 60;
    pub const RATE_LIMIT_MAX_REQUESTS: u32 = 10;
}

pub mod quarantine {
    pub const QUARANTINE_PERIOD_DAYS: i64 = 14;
    pub const QUARANTINE_PAYMENT_RECEIVED_DAYS: i64 = 2;
}
```

Заменить все hardcoded значения на константы.

---

### SQL Query Builder

**Добавить в Cargo.toml:**

```toml
sea-query = "0.30"
```

**Было:**

```rust
let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
let sql = format!("UPDATE orders SET status=?1 WHERE id IN ({})", placeholders);
```

**Стало:**

```rust
use sea_query::*;

let query = Query::update()
    .table(Orders::Table)
    .value(Orders::Status, status)
    .and_where(Orders::Id.is_in(ids))
    .build(SqliteQueryBuilder);
```

---

## 📋 ЧЕКЛИСТ ПРОВЕРКИ ПЕРЕД КОММИТОМ

```bash
# 1. Линтинг
npm run lint
cd src-tauri && cargo clippy -- -D warnings

# 2. Форматирование
npm run format
cd src-tauri && cargo fmt

# 3. Тесты
npm test
cd src-tauri && cargo test

# 4. Сборка
npm run build

# 5. E2E
npm run test:e2e

# 6. Проверка секретов
grep -r "sk_\|pk_\|api_key" src/ | grep -v ".test."

# 7. Проверка console.log
grep -r "console.log" src/ | wc -l  # Должно быть 0 или минимально

# 8. Проверка TODO/FIXME
grep -r "TODO\|FIXME\|XXX" src/ src-tauri/src/ | wc -l
```

---

## 📊 МЕТРИКИ ДО И ПОСЛЕ

| Метрика                   | До исправлений | После Дня 5 | Цель |
| ------------------------- | -------------- | ----------- | ---- |
| `.expect()` без обработки | 21             | 0           | 0    |
| CSP unsafe-inline         | Да             | Нет         | Нет  |
| Race conditions           | 4              | 0           | 0    |
| Memory leaks              | 6              | 0           | 0    |
| CI/CD tests               | Нет            | Да          | Да   |
| Покрытие тестами          | 10-15%         | 15-20%      | 30%+ |

---

## 🚀 КОМАНДЫ ДЛЯ БЫСТРОГО СТАРТА

```bash
# Клонировать проект
git clone <repo>
cd manager-work

# Установить зависимости
npm install
cd src-tauri && cargo build --release && cd ..

# Запустить dev сервер
npm run dev

# Запустить тесты
npm test
cd src-tauri && cargo test

# Создать ветку для исправлений
git checkout -b fix/critical-issues-sprint1

# После исправлений
git add .
git commit -m "fix: critical issues - error handling, CSP, race conditions"
git push origin fix/critical-issues-sprint1
```

---

## 📞 ПОМОЩЬ

**Вопросы по аудиту:**

- Полный отчет: `FULL_AUDIT_REPORT_2026-08-11.md`
- Технический долг: `TECH_DEBT_REPORT.md`
- План действий: `ACTION_PLAN.md`

**Документация:**

- Архитектура: `docs/ARCHITECTURE.md`
- Безопасность: `docs/AUTH_AND_ROLES.md`
- Разработчикам: `AGENTS.md`

**Поддержка:**

- Issues: GitHub Issues
- Документация: `/docs`
- Roadmap: `ROADMAP.md`

---

**Удачи в исправлениях! 🚀**
