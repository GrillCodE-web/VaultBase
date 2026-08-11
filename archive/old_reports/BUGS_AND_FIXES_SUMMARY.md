# 🐛 СВОДКА БАГОВ И ИСПРАВЛЕНИЙ

## Общая статистика

**Дата аудита:** 11 августа 2026  
**Проект:** VaultBase v2.11.2  
**Общая оценка:** 7.3/10 🟡

| Категория                | Количество | Статус                              |
| ------------------------ | ---------- | ----------------------------------- |
| **Критичные баги**       | 4          | 🔴 Требуют немедленного исправления |
| **Высокие баги**         | 4          | 🟡 Исправить на этой неделе         |
| **Средние проблемы**     | 8          | 🟢 Исправить в течение месяца       |
| **Низкие проблемы**      | 3          | 🔵 Backlog                          |
| **Заглушки (FIX метки)** | 74+        | ⚠️ Технический долг                 |
| **Hardcoded URLs**       | 41+        | ⚠️ Вынести в конфиг                 |
| **Magic numbers**        | 100+       | ⚠️ Константы                        |
| **console.log**          | 82+        | ⚠️ Удалить из production            |
| **ИТОГО проблем**        | **19**     |                                     |

---

## 🔴 КРИТИЧНЫЕ БАГИ (Priority P0)

### #1: Небезопасное использование `.expect()` и `.unwrap()`

**Серьезность:** КРИТИЧНАЯ  
**Риск:** Приложение упадет без graceful recovery  
**Количество вхождений:** 21+

**Проблемные файлы:**

- `src-tauri/src/main.rs` — строки 41, 74, 167
- `src-tauri/src/state.rs` — строки 18, 53
- `src-tauri/src/encryption.rs` — строка 106
- `src-tauri/src/imap.rs` — строки 102-106, 339-343, 539-543

**Пример проблемы:**

```rust
// ❌ ПЛОХО - приложение упадет
let db = Database::open(&db_path_str).expect("Failed to open database");
```

**Решение:**

```rust
// ✅ ХОРОШО - показать диалог пользователю
let db = match Database::open(&db_path_str) {
    Ok(d) => d,
    Err(e) => {
        app.dialog()
            .message(&format!("Не удалось открыть базу данных: {}", e))
            .title("Ошибка")
            .show(|_| std::process::exit(1));
        return;
    }
};
```

**Трудозатраты:** 6-8 часов  
**Файлов для изменения:** 5

---

### #2: SQL Injection потенциалы через динамическую генерацию

**Серьезность:** КРИТИЧНАЯ  
**Риск:** SQL injection, потеря данных  
**Количество вхождений:** 6+

**Проблемные файлы:**

- `src-tauri/src/database/_orders.rs` — строки 293, 305
- `src-tauri/src/database/_shops.rs` — строки 50-57
- `src-tauri/src/database/_imap.rs` — строка 128

**Пример проблемы:**

```rust
// ⚠️ ОПАСНО - динамическая генерация SQL
let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
let sql = format!("UPDATE orders SET status=?1 WHERE id IN ({})", placeholders);
```

**Решение:**

```rust
// ✅ БЕЗОПАСНО - валидация + query builder
if ids.len() > 500 {
    return Err("Too many IDs - max 500 allowed".to_string());
}

use sea_query::*;
let query = Query::update()
    .table(Orders::Table)
    .value(Orders::Status, status)
    .and_where(Orders::Id.is_in(ids))
    .build(SqliteQueryBuilder);
```

**Трудозатраты:** 1-2 дня (внедрение query builder)  
**Файлов для изменения:** 3

---

### #3: Race Conditions в многопоточном коде

**Серьезность:** КРИТИЧНАЯ  
**Риск:** Deadlocks, data corruption  
**Количество вхождений:** 4

**Проблемные файлы:**

- `src-tauri/src/background.rs` — строки 28-56 (TOCTOU bug)
- `src-tauri/src/tracking.rs` — строка 15 (неограниченный кеш)
- `src-tauri/src/rate_limiter.rs` — строка 16 (memory leak)
- `src-tauri/src/ws_sync.rs` — строка 45 (race в reconnect)

**Пример проблемы #1 — TOCTOU bug:**

```rust
// ❌ ПЛОХО - между проверкой и действием состояние может измениться
let should_lock = {
    let db = st.db.lock().unwrap();
    db.should_lock()
};
if should_lock {
    let mut db = st.db.lock().unwrap(); // Состояние могло измениться!
    db.clear_encryption();
}
```

**Решение:**

```rust
// ✅ ХОРОШО - держать lock на протяжении операции
let mut db = st.db.lock().unwrap();
if db.should_lock() {
    db.clear_encryption();
}
```

**Пример проблемы #2 — Memory leak в кеше:**

```rust
// ❌ ПЛОХО - кеш растет бесконечно
static TRACKING_CACHE: Lazy<Mutex<HashMap<String, (TrackingStatus, i64)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Нет cleanup → OOM при длительной работе
```

**Решение:**

```rust
// ✅ ХОРОШО - LRU eviction + TTL
const MAX_CACHE_SIZE: usize = 1000;
const CACHE_TTL_SECONDS: i64 = 3600;

fn cache_insert(key: String, value: TrackingStatus) {
    let mut guard = TRACKING_CACHE.lock().unwrap();

    // Периодическая очистка старых записей
    if guard.len() % 100 == 0 {
        let now = chrono::Utc::now().timestamp();
        guard.retain(|_, (_, ts)| now - ts < CACHE_TTL_SECONDS * 2);
    }

    // LRU eviction при превышении лимита
    if guard.len() >= MAX_CACHE_SIZE {
        // Удалить самую старую запись
        let oldest_key = guard.iter()
            .min_by_key(|(_, (_, ts))| ts)
            .map(|(k, _)| k.clone());
        if let Some(k) = oldest_key {
            guard.remove(&k);
        }
    }

    guard.insert(key, (value, now));
}
```

**Трудозатраты:** 6-8 часов  
**Файлов для изменения:** 4

---

### #4: CSP XSS уязвимость — `'unsafe-inline'`

**Серьезность:** КРИТИЧНАЯ  
**Риск:** XSS атаки через inline стили  
**Количество вхождений:** 1 (CSP config)

**Проблемный файл:**

- `src-tauri/tauri.conf.json`

**Проблема:**

```json
"csp": "style-src 'self' 'unsafe-inline' blob:; ..."
```

**Решение:**

1. Найти все inline стили: `grep -r "style={{" src/`
2. Вынести их в CSS файлы
3. Обновить CSP:

```json
"csp": "style-src 'self'; upgrade-insecure-requests; report-uri https://sec201-www.otpmanager.pro/csp-report; ..."
```

**Трудозатраты:** 4-6 часов  
**Файлов для изменения:** ~20 JSX файлов + tauri.conf.json

---

## 🟡 ВЫСОКИЕ БАГИ (Priority P1)

### #5: Memory leaks в React useEffect без cleanup

**Серьезность:** ВЫСОКАЯ  
**Риск:** Memory leaks, stale closures  
**Количество вхождений:** 6+

**Проблемные файлы:**

- `src/pages/Cards.jsx` — строки 255-316
- `src/pages/App.jsx` — строки 161-185, 453
- `src/store/cards.js` — строки 81-147

**Пример проблемы:**

```jsx
// ❌ ПЛОХО - таймеры могут не очиститься
useEffect(() => {
  const setupListeners = async () => {
    const listener = await listen('event', () => {
      timers[id] = setTimeout(() => removeItem(id), 2000)
    })
    unlisten = listener
  }
  setupListeners()

  return () => {
    if (unlisten) unlisten()
    Object.values(timers).forEach(clearTimeout) // Может быть stale
  }
}, [removeItem])
```

**Решение:**

```jsx
// ✅ ХОРОШО - cancelled флаг + useRef
const timersRef = useRef({})

useEffect(() => {
  let cancelled = false
  let unlisten = null

  const setupListeners = async () => {
    if (cancelled) return
    const listener = await listen('event', () => {
      if (cancelled) return
      const timerId = setTimeout(() => {
        if (!cancelled) removeItem(id)
      }, 2000)
      timersRef.current[id] = timerId
    })
    if (!cancelled) unlisten = listener
  }

  setupListeners()

  return () => {
    cancelled = true
    if (unlisten) unlisten()
    Object.values(timersRef.current).forEach(clearTimeout)
    timersRef.current = {}
  }
}, [removeItem])
```

**Трудозатраты:** 4-6 часов  
**Файлов для изменения:** 4

---

### #6: Race conditions в async операциях (JS)

**Серьезность:** ВЫСОКАЯ  
**Риск:** Stale data, некорректное состояние  
**Количество вхождений:** 8+

**Проблемные файлы:**

- `src/store/cards.js` — строки 81-147, 188-227
- `src/store/orders.js` — строки 95-120

**Решение:**

```javascript
// Добавить AbortController для всех async операций
const controller = new AbortController()

try {
  const result = await invoke('get_cards', { signal: controller.signal })
  if (!controller.signal.aborted) {
    set({ cards: result })
  }
} catch (e) {
  if (e.name !== 'AbortError') {
    console.error('Failed to load cards:', e)
  }
}

// Cleanup
return () => controller.abort()
```

**Трудозатраты:** 3-4 часа  
**Файлов для изменения:** 2

---

### #7: Необработанные Promise rejections

**Серьезность:** ВЫСОКАЯ  
**Риск:** Unhandled rejection → crash  
**Количество вхождений:** 12+

**Проблемные файлы:**

- `src/App.jsx` — строки 453, 680, 721
- `src/pages/Dashboard.jsx` — строки 234, 567

**Решение:**

```jsx
// ✅ Всегда оборачивать invoke в try-catch
const loadData = useCallback(async () => {
  try {
    const result = await invoke('get_data')
    setData(result)
  } catch (e) {
    console.error('Failed to load data:', e)
    // Опционально: показать toast
  }
}, [])
```

**Трудозатраты:** 2-3 часа  
**Файлов для изменения:** 5

---

### #8: localStorage без обработки ошибок

**Серьезность:** СРЕДНЯЯ  
**Риск:** QuotaExceededError  
**Количество вхождений:** 8+

**Решение:**

```javascript
// Обернуть все localStorage операции
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('localStorage quota exceeded')
      // Очистить старые данные
      localStorage.clear()
    }
    return false
  }
}
```

**Трудозатраты:** 2 часа  
**Файлов для изменения:** 3

---

## 🟢 СРЕДНИЕ ПРОБЛЕМЫ (Priority P2)

### #9: Hardcoded URLs в production

**Количество:** 41+ вхождение  
**Трудозатраты:** 4-6 часов

**Решение:** Вынести в `constants.rs` или БД конфиг

---

### #10: Magic numbers без констант

**Количество:** 100+ вхождений  
**Трудозатраты:** 2-3 часа

**Примеры:**

- `3600` → `CACHE_TTL_SECONDS`
- `300` → `DEFAULT_AUTOLOCK_TIMEOUT`
- `14` → `QUARANTINE_PERIOD_DAYS`

---

### #11: console.log в production

**Количество:** 82+ вхождений  
**Трудозатраты:** 2 часа

**Решение:** Добавить в vite.config.js:

```javascript
esbuild: {
  drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
}
```

---

### #12: Отсутствие индексов для частых запросов

**Таблицы:** cards, orders, shops  
**Трудозатраты:** 2-3 часа

**Рекомендуемые индексы:**

```sql
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_exp_date ON cards(exp_date);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_tracking ON orders(tracking_number);
```

---

### #13-16: Остальные средние проблемы

- Orphaned records в БД
- Отсутствие валидации Tauri commands
- Дублирование кода обработки ошибок
- Отсутствие централизованного logging

**Детали:** См. `FULL_AUDIT_REPORT_2026-08-11.md`

---

## 🔵 НИЗКИЕ ПРОБЛЕМЫ (Priority P3)

### #17: Отсутствие метрик производительности

**Решение:** Внедрить structured logging (tracing для Rust, pino для Node)

---

### #18: Отсутствие CSP reporting

**Решение:** Добавить `report-uri` в CSP для мониторинга нарушений

---

### #19: Устаревшие зависимости

**Количество:** 5+ пакетов  
**Детали:** См. раздел "Безопасность зависимостей"

---

## ⚠️ ТЕХНИЧЕСКИЙ ДОЛГ

### Заглушки и TODO

| Тип                | Количество | Приоритет  |
| ------------------ | ---------- | ---------- |
| **FIX метки**      | 74+        | 🟡 Средний |
| **Hardcoded URLs** | 41+        | 🟡 Средний |
| **Magic numbers**  | 100+       | 🟢 Низкий  |
| **console.log**    | 82+        | 🟢 Низкий  |

**Детальный список:** См. `TECH_DEBT_DETAILED.md`

---

## 📊 СТАТИСТИКА ТЕСТИРОВАНИЯ

| Компонент            | Покрытие        | Критичность |
| -------------------- | --------------- | ----------- |
| **Frontend (React)** | ~11%            | 🔴 Критично |
| **Backend (Rust)**   | ~10%            | 🔴 Критично |
| **E2E**              | ~5%             | 🔴 Критично |
| **CI/CD**            | 0% (нет тестов) | 🔴 Критично |

**Цель:** 70%+ покрытие критических модулей

**Приоритетные модули для покрытия:**

1. `commands/auth.rs` (авторизация)
2. `commands/cards.rs` (CRUD карт)
3. `commands/orders.rs` (CRUD заказов)
4. `database/_core.rs` (инициализация БД)
5. `store/auth.js` (авторизация frontend)

**Детали:** См. отчет по тестированию выше

---

## 🎯 ПРИОРИТИЗАЦИЯ ИСПРАВЛЕНИЙ

### Спринт 0 (Сегодня — 1-2 часа)

```bash
# 1. Проверить Rust уязвимости
cargo audit

# 2. Обновить jspdf
npm install jspdf@^2.5.2

# 3. Поиск секретов
grep -r "sk_|pk_|api_key" src/

# 4. Проверить TAURI_ENV_DEBUG
echo $TAURI_ENV_DEBUG  # Должна быть пустой
```

---

### Спринт 1 (Критично — 3-5 дней)

**Исправить баги:** #1, #2, #3, #4

**Метрики успеха:**

- ✅ 0 `.expect()` без обработки
- ✅ CSP без `'unsafe-inline'`
- ✅ Кеши с TTL и size limits
- ✅ CI/CD с тестами

**Трудозатраты:** 80 часов (2 разработчика)

---

### Спринт 2 (Высокий приоритет — 1 неделя)

**Исправить баги:** #5, #6, #7, #8, #9, #10

**Метрики успеха:**

- ✅ Все useEffect с cleanup
- ✅ AbortController для async
- ✅ 0 hardcoded URLs
- ✅ 0 magic numbers

**Трудозатраты:** 40 часов (1 разработчик)

---

### Спринт 3 (Средний приоритет — 2 недели)

**Исправить баги:** #11-16

**Метрики успеха:**

- ✅ Покрытие тестами 30%+
- ✅ Structured logging
- ✅ БД индексы

**Трудозатраты:** 160 часов (2 разработчика + QA)

---

## 📋 QUICK CHECKLIST

### Перед началом работы:

- [ ] Прочитать `FULL_AUDIT_REPORT_2026-08-11.md`
- [ ] Прочитать `QUICK_FIX_CHECKLIST.md`
- [ ] Создать ветку: `git checkout -b fix/critical-issues-sprint1`

### После каждого исправления:

- [ ] Написать юнит-тест
- [ ] Запустить `npm test` и `cargo test`
- [ ] Проверить линтером: `npm run lint` и `cargo clippy`
- [ ] Коммит: `git commit -m "fix: описание бага"`

### Перед pull request:

- [ ] Все тесты зеленые
- [ ] Coverage не упал
- [ ] Нет новых console.log
- [ ] Обновлена документация

---

## 📞 РЕСУРСЫ И КОНТАКТЫ

**Полные отчеты:**

- `FULL_AUDIT_REPORT_2026-08-11.md` — полный аудит (50+ страниц)
- `QUICK_FIX_CHECKLIST.md` — быстрая памятка
- `TECH_DEBT_REPORT.md` — технический долг
- `ACTION_PLAN.md` — детальный план действий

**Документация:**

- `README.md` / `README.ru.md` — описание проекта
- `AGENTS.md` — руководство для разработчиков
- `docs/ARCHITECTURE.md` — архитектура

**Поддержка:**

- GitHub Issues
- Документация: `/docs`
- Roadmap: `ROADMAP.md`

---

**Последнее обновление:** 11 августа 2026  
**Следующий аудит:** После Спринта 1 (через 1 неделю)

---

**Удачи в исправлениях! 🚀**
