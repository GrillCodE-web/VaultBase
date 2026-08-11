# ⚡ Stuffer API - Быстрый старт по улучшениям

**Дата:** 11 августа 2026  
**Документ:** STUFFER_API_IMPROVEMENT_RECOMMENDATIONS.md (62KB)  
**TL;DR:** 8 критических проблем + план на 48 часов

---

## 🎯 Главное

| Метрика                 | Текущее        | Целевое     | Потребуется     |
| ----------------------- | -------------- | ----------- | --------------- |
| Оценка качества         | 9.2/10         | 9.8/10      | +0.6 баллов     |
| Тестовое покрытие       | 0%             | 95%+        | 50+ тестов      |
| Критических исправлений | 8              | 0           | 48 часов работы |
| Обработка ошибок        | ❌ Слабая      | ✅ Отличная | Типизирование   |
| Валидация данных        | ❌ Отсутствует | ✅ Полная   | 3 уровня        |

---

## 🔴 8 Критических проблем

### 1. ❌ Отсутствие тестов (230+ строк без тестов)

**Когда начать:** IMMEDIATELY  
**Время:** 10 часов  
**Эффект:** +0.4 баллов  
**Что нужно:**

- Создать `stuffer_tests.rs` с 50+ unit-тестами
- Покрытие моделей, URL building, JSON парсинга, API методов
- Интеграционные тесты с mock-сервером

### 2. ❌ Слабая валидация входных данных

**Когда начать:** День 1  
**Время:** 4 часа  
**Эффект:** +0.2 баллов  
**Что нужно:**

```rust
// Создать структуру валидации с типизированными ошибками
pub enum PackageValidationError {
    InvalidCourierId(i64),
    MissingShop,
    ShopTooLong(String),
    InvalidPrice(f64),
    InvalidQuantity(i64),
    InvalidPayOption(String),
    InvalidDeliveryDate(String),
}

pub fn validate_package(package: &PackageInput) -> Result<(), PackageValidationError> {
    // Проверить courier_id > 0
    // Проверить shop не пустой и <= 255 chars
    // Проверить price >= 0
    // Проверить quantity > 0
    // Проверить pay_option из допустимого списка
    // Проверить delivery_date формат Y-m-d
}
```

### 3. ❌ Неинформативные ошибки (только строки)

**Когда начать:** День 1  
**Время:** 3 часа  
**Эффект:** +0.1 баллов  
**Что нужно:**

```rust
// Создать типизированные ошибки
pub enum StufferError {
    NetworkError { message: String, retryable: bool },
    HttpError { code: u16, message: String, body: Option<String> },
    ApiError { code: Option<String>, message: String },
    ParseError { field: String, expected: String, got: Option<String> },
    ValidationError { field: String, reason: String },
    AuthError { reason: String },
    RateLimited { retry_after_secs: Option<u64> },
    Unknown { message: String },
}

// Методы
impl StufferError {
    pub fn is_retryable(&self) -> bool { /* ... */ }
    pub fn retry_after_secs(&self) -> Option<u64> { /* ... */ }
}
```

### 4. ❌ Отсутствие Rate Limiting

**Когда начать:** День 3  
**Время:** 3 часа  
**Эффект:** +0.15 баллов  
**Что нужно:**

```rust
// Использовать существующий RateLimiter
static STUFFER_COURIERS_LIMITER: RateLimiter =
    RateLimiter::new(20, 60);  // 20 запросов в минуту

#[tauri::command]
pub fn stuffer_list_couriers() -> Result<Vec<CourierFull>, String> {
    STUFFER_COURIERS_LIMITER.check_limit()?;
    // ...
}
```

### 5. ❌ Нет Retry Logic для сетевых ошибок

**Когда начать:** День 4  
**Время:** 3 часа  
**Эффект:** +0.1 баллов  
**Что нужно:**

```rust
// Exponential backoff: 500ms, 1s, 2s, max 5s
pub async fn retry_with_backoff<F, T>(
    f: F,
    max_attempts: u32,
) -> Result<T, StufferError>
where
    F: FnMut() -> Result<T, StufferError>,
{
    let mut attempt = 0;
    let mut backoff_ms = 500;

    loop {
        match f() {
            Ok(r) => return Ok(r),
            Err(e) if !e.is_retryable() || attempt >= max_attempts => return Err(e),
            _ => {
                std::thread::sleep(Duration::from_millis(backoff_ms));
                backoff_ms = (backoff_ms * 2).min(5000);
                attempt += 1;
            }
        }
    }
}
```

### 6. ⚠️ Слабое логирование

**Когда начать:** День 5  
**Время:** 2 часа  
**Эффект:** +0.05 баллов  
**Что нужно:**

```rust
// Расширить логирование:
tracing::info!(
    courier_id = id,
    "Adding courier to Stuffer"
);

// При успехе:
tracing::info!(
    courier_name = %courier.name,
    courier_status = %courier.status,
    "Courier added successfully"
);

// При ошибке с контекстом:
match error_type {
    StufferError::NetworkError { .. } => tracing::warn!("Retryable..."),
    StufferError::AuthError { .. } => tracing::error!("Auth failed!"),
    StufferError::RateLimited { .. } => tracing::warn!("Rate limited"),
    _ => tracing::error!("Stuffer error: {:?}", err),
}
```

### 7. ❌ Нет типизированных ошибок на фронтенде

**Когда начать:** День 6  
**Время:** 4 часа  
**Эффект:** +0.1 баллов  
**Что нужно:**

```javascript
// src/api/stuffer.js
export const STUFFER_ERRORS = {
  NETWORK_ERROR: 'stuffer_network_error',
  AUTH_ERROR: 'stuffer_auth_error',
  RATE_LIMITED: 'stuffer_rate_limited',
  COURIER_NOT_FOUND: 'stuffer_courier_not_found',
}

export function parseStufferError(errorMsg) {
  if (errorMsg.includes('not_configured')) {
    return {
      type: STUFFER_ERRORS.NOT_CONFIGURED,
      message: 'Stuffer API не настроен',
      recoverable: false,
      action: 'configure_stuffer',
    }
  }
  // ...
}

// В React компоненте:
const [error, setError] = useState(null)
try {
  const couriers = await invoke('stuffer_list_couriers')
} catch (err) {
  const parsed = parseStufferError(err)
  if (parsed.type === STUFFER_ERRORS.NOT_CONFIGURED) {
    showConfigDialog()
  }
}
```

### 8. 🟢 Отсутствие мониторинга

**Когда начать:** День 7  
**Время:** 2 часа  
**Эффект:** +0.05 баллов  
**Что нужно:**

```rust
// Простые метрики
pub struct StufferMetrics {
    total_requests: AtomicU64,
    successful_requests: AtomicU64,
    failed_requests: AtomicU64,
    avg_latency_ms: AtomicU64,
    last_error: Mutex<Option<String>>,
}

// Exposure via API
#[tauri::command]
pub fn stuffer_get_metrics() -> Result<StufferStats, String> {
    Ok(STUFFER_METRICS.get_stats())
}
```

---

## 📋 Фазы внедрения

### Фаза 1: CRITICAL (Неделя 1) — 30 часов

```
День 1: Валидация + Ошибки (1.2, 1.3)
  └─ Создать stuffer_validator.rs
  └─ Создать stuffer_error.rs
  └─ 20 тестов

День 2-3: Тестовое покрытие (1.1)
  └─ Создать stuffer_tests.rs
  └─ 50+ тестов (структуры, URL, JSON парсинг, API методы)
  └─ Mock-сервер для интеграционных тестов

День 4-5: Rate Limiting + Retry (1.4, 1.5)
  └─ Применить RateLimiter к каждому методу
  └─ Добавить exponential backoff retry
  └─ Интеграционные тесты
```

### Фаза 2: HIGH PRIORITY (Неделя 2) — 12 часов

```
День 1-2: Логирование + Мониторинг (1.6, 1.8)
  └─ Расширить трассировку
  └─ Добавить метрики
  └─ API для получения stats

День 3: Типизированные ошибки на фронтенде (1.7)
  └─ Создать src/api/stuffer.js
  └─ Компоненты для обработки ошибок

День 4-5: Рефакторинг архитектуры
  └─ Новая структура: src-tauri/src/stuffer/
  └─ Модульное разделение
  └─ CI/CD интеграция
```

### Фаза 3: OPTIMIZATION (Неделя 3-4) — 6 часов

```
День 1-2: Performance + Безопасность
  └─ SecureString для API ключа
  └─ Проверка SQL injection
  └─ Review логирования

День 3-4: Документация + Deployment
  └─ STUFFER_TESTING_GUIDE.md
  └─ Migration guide для существующего кода
  └─ Production deployment
```

---

## ✅ Чек-лист для начала

**Перед кодированием:**

- [ ] Ревью этого документа с техническим лидом
- [ ] Согласование временной шкалы с product owner
- [ ] Создание feature branch: `git checkout -b feature/stuffer-api-improvements`

**День 1 - Валидация и Ошибки:**

- [ ] Создать `src-tauri/src/stuffer_validator.rs`
- [ ] Создать `src-tauri/src/stuffer_error.rs`
- [ ] Написать 20 unit-тестов
- [ ] Обновить `create_package` для использования валидации

**День 2-3 - Тестовое покрытие:**

- [ ] Создать `src-tauri/src/stuffer_tests.rs`
- [ ] 50+ unit-тестов для всех функций
- [ ] Интеграционные тесты с mock-сервером
- [ ] Гарантировать 95%+ coverage

**День 4-5 - Rate Limiting + Retry:**

- [ ] Добавить rate limiting к каждому методу в `commands/stuffer.rs`
- [ ] Создать `stuffer_retry.rs` с exponential backoff
- [ ] Тесты для rate limiting и retry
- [ ] Конфиг в `VaultBase.*.toml`

---

## 📊 Быстрые метрики

| Метрика                  | Значение                                          |
| ------------------------ | ------------------------------------------------- |
| **Файлов для изменения** | 2 (stuffer.rs, commands/stuffer.rs)               |
| **Файлов для создания**  | 8 (validator, error, retry, tests, metrics, etc.) |
| **Общее время**          | 48 часов (2-3 недели)                             |
| **Люди**                 | 1-2 разработчика                                  |
| **Конфликты**            | Минимум (модульный подход)                        |
| **Breaking changes**     | 0 (обратная совместимость)                        |

---

## 🎯 Результаты

**После реализации всех 8 исправлений:**

```
Качество:        9.2/10 → 9.8/10 ✅
Тестирование:    0% → 95%+ ✅
Обработка ошибок: Слабая → Отличная ✅
Валидация:       Отсутствует → Полная ✅
Rate Limiting:   Отсутствует → Реализовано ✅
Retry Logic:     Отсутствует → Exponential Backoff ✅
Логирование:     Базовое → Структурированное ✅
Мониторинг:      Отсутствует → Метрики + Алерты ✅
```

---

## 📞 Контакты

**Полный документ:** `STUFFER_API_IMPROVEMENT_RECOMMENDATIONS.md` (62KB)  
**Дата подготовки:** 11 августа 2026  
**Статус:** Ready for Implementation

🚀 **Готово к старту!**
