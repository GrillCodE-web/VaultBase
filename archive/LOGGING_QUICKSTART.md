# 🚀 Быстрый старт: Логирование в VaultBase

**Создано:** 11 августа 2026 (Sprint 3 Day 2)  
**Для:** Разработчиков VaultBase

---

## 📚 TL;DR

### Rust Backend:

```rust
// В любом файле добавь:
tracing::info!("Что-то произошло", key = value);
tracing::warn!("Предупреждение", error = %err);
tracing::error!("Ошибка!", user_id = %id);
```

### JavaScript Frontend:

```javascript
import { createLogger } from './utils/logger'
const logger = createLogger('MyModule')

logger.info('Что-то произошло', { key: value })
logger.warn('Предупреждение', { error: err.message })
logger.error('Ошибка!', error, { user_id: id })
```

---

## 🦀 Rust Backend (tracing)

### 1. Базовое использование:

```rust
// Info level - общая информация
tracing::info!("User logged in", user_id = %user_id);

// Debug level - детальная отладка
tracing::debug!(
    action = "fetch_cards",
    count = card_count,
    "Fetching cards from database"
);

// Warn level - предупреждения
tracing::warn!(
    error = %e,
    "Failed to connect to sync server"
);

// Error level - ошибки
tracing::error!(
    user_id = %user_id,
    error = %e,
    "Database operation failed"
);
```

### 2. Структурированные события:

```rust
// Security event
tracing::warn!(
    event_type = "security",
    action = "rate_limit_exceeded",
    user_id = %user_id,
    ip_address = ?ip,
    "Rate limit exceeded"
);

// Performance metric
tracing::info!(
    event_type = "metric",
    operation = "encrypt_card",
    duration_ms = duration.as_millis() as u64,
    "Encryption completed"
);

// API call
tracing::debug!(
    event_type = "api_call",
    method = "POST",
    endpoint = "/api/cards",
    status = 201,
    duration_ms = 145,
    "API call completed"
);

// Database operation
tracing::debug!(
    event_type = "db_operation",
    operation = "INSERT",
    table = "cards",
    rows_affected = 1,
    duration_ms = 23,
    "Database operation completed"
);
```

### 3. Измерение производительности:

```rust
let start = std::time::Instant::now();

// ... ваш код ...

let duration = start.elapsed();
tracing::info!(
    operation = "complex_calculation",
    duration_ms = duration.as_millis() as u64,
    "Operation completed"
);
```

### 4. Логирование в функциях:

```rust
#[tauri::command]
pub(crate) fn my_command(param: String) -> Result<Data, String> {
    let start = std::time::Instant::now();

    tracing::debug!(
        action = "my_command_start",
        param = %param,
        "Starting command"
    );

    let result = do_something(param);

    match result {
        Ok(data) => {
            let duration = start.elapsed();
            tracing::info!(
                action = "my_command_success",
                duration_ms = duration.as_millis() as u64,
                "Command completed successfully"
            );
            Ok(data)
        },
        Err(e) => {
            let duration = start.elapsed();
            tracing::error!(
                action = "my_command_failed",
                error = %e,
                duration_ms = duration.as_millis() as u64,
                "Command failed"
            );
            Err(e)
        }
    }
}
```

---

## 🌐 JavaScript Frontend (logger)

### 1. Создание логгера для модуля:

```javascript
// В начале файла
import { createLogger } from './utils/logger'

const logger = createLogger('Cards') // Имя модуля
```

### 2. Базовое использование:

```javascript
// Info level
logger.info('Cards loaded successfully', { count: cards.length })

// Debug level
logger.debug('Fetching cards from backend', {
  user_id: userId,
  filters: activeFilters,
})

// Warn level
logger.warn('API rate limit approaching', {
  requests_remaining: 5,
})

// Error level
logger.error('Failed to save card', error, {
  card_id: cardId,
  retry_count: retries,
})
```

### 3. Специализированные методы:

```javascript
// Security event
logger.security('Unauthorized access attempt', {
  user_id: userId,
  ip_address: ip,
  resource: 'admin_panel',
})

// Performance metric
logger.metric('Cards render completed', {
  count: cards.length,
  duration_ms: renderTime,
})

// API call
logger.apiCall('POST', '/api/cards', 201, 145, {
  card_count: 1,
})
```

### 4. Измерение производительности:

```javascript
// Способ 1: measure()
const result = await logger.measure(
  'fetchCards',
  async () => {
    return await invoke('get_cards')
  },
  { user_id: userId }
)

// Способ 2: вручную
const start = performance.now()
const result = await invoke('get_cards')
const duration = performance.now() - start

logger.metric('Cards fetched', {
  count: result.length,
  duration_ms: duration.toFixed(2),
})
```

### 5. Логирование в React компонентах:

```javascript
import { createLogger } from './utils/logger'

const logger = createLogger('Cards')

function Cards() {
  useEffect(() => {
    logger.info('Cards component mounted')

    return () => {
      logger.debug('Cards component unmounting')
    }
  }, [])

  const handleSave = async card => {
    try {
      logger.debug('Saving card', { card_id: card.id })

      const result = await invoke('save_card', { card })

      logger.info('Card saved successfully', {
        card_id: result.id,
      })
    } catch (error) {
      logger.error('Failed to save card', error, {
        card_id: card.id,
      })
    }
  }
}
```

---

## 🔧 Настройка

### Rust - Изменение уровня через ENV:

```bash
# Linux/macOS
export RUST_LOG=debug
./vaultbase

# Windows
set RUST_LOG=debug
vaultbase.exe

# Только для конкретного модуля
export RUST_LOG=vaultbase::auth=debug
```

### JavaScript - Изменение уровня в DevTools:

```javascript
// В консоли браузера
import { setLogLevel, LogLevel } from './utils/logger'

// Включить все логи (очень подробно)
setLogLevel(LogLevel.TRACE)

// Только дебаг и выше
setLogLevel(LogLevel.DEBUG)

// Только предупреждения и ошибки
setLogLevel(LogLevel.WARN)

// Отключить все логи
setLogLevel(LogLevel.SILENT)
```

---

## 📁 Где находятся файлы логов?

| ОС      | Путь                                            |
| ------- | ----------------------------------------------- |
| Windows | `C:\Users\<user>\AppData\Local\VaultBase\logs\` |
| macOS   | `~/Library/Application Support/VaultBase/logs/` |
| Linux   | `~/.local/share/VaultBase/logs/`                |

**Формат:** `vaultbase.log.2026-08-11` (ежедневная ротация)

---

## 📊 Форматы вывода

### Rust Console (human-readable):

```
2026-08-11T10:30:45.123Z INFO vaultbase::auth user_login:23 User logged in user_id=123 role="admin"
```

### Rust JSON File (structured):

```json
{
  "timestamp": "2026-08-11T10:30:45.123Z",
  "level": "INFO",
  "target": "vaultbase::auth",
  "fields": {
    "message": "User logged in",
    "user_id": "123",
    "role": "admin"
  }
}
```

### JavaScript Console (structured):

```json
{
  "timestamp": "2026-08-11T10:30:45.123Z",
  "level": "INFO",
  "message": "Cards loaded successfully",
  "module": "Cards",
  "count": 15,
  "user_id": "user_123"
}
```

---

## ✅ Best Practices

### DO ✅

1. **Логируй критические события:**
   - Успешные/неудачные логины
   - Важные изменения данных (создание/обновление/удаление)
   - API calls
   - Security events

2. **Добавляй контекст:**

   ```javascript
   // ✅ Хорошо
   logger.error('Save failed', error, {
     card_id: id,
     user_id: userId,
     retry_count: retries,
   })

   // ❌ Плохо
   logger.error('Error')
   ```

3. **Используй правильные уровни:**
   - `TRACE/DEBUG` - детальная отладка (только dev)
   - `INFO` - важные события (prod)
   - `WARN` - что-то не так, но работает
   - `ERROR` - критические ошибки

4. **Логируй производительность:**
   ```rust
   tracing::info!(
       operation = "bulk_insert",
       rows = 500,
       duration_ms = 145,
       "Operation completed"
   );
   ```

### DON'T ❌

1. **Не логируй чувствительные данные:**

   ```rust
   // ❌ ПЛОХО - пароль в логах!
   tracing::info!("Login attempt", password = %password);

   // ✅ ХОРОШО
   tracing::info!("Login attempt", username = %username);
   ```

2. **Не логируй в циклах без необходимости:**

   ```rust
   // ❌ ПЛОХО - 10000 логов!
   for card in cards {
       tracing::debug!("Processing card", card_id = %card.id);
   }

   // ✅ ХОРОШО
   tracing::info!("Processing cards", count = cards.len());
   ```

3. **Не дублируй консольные логи:**
   ```javascript
   // ❌ ПЛОХО
   console.log('Card saved')
   logger.info('Card saved')

   // ✅ ХОРОШО
   logger.info('Card saved')
   ```

---

## 📚 Дополнительная документация

- **Детальный отчет:** `SPRINT3_DAY2_LOGGING_REPORT.md`
- **Summary:** `SPRINT3_DAY2_COMPLETE.md`
- **Код:** `src-tauri/src/logging.rs`, `src/utils/logger.js`

---

**Вопросы?** Читай полную документацию в `SPRINT3_DAY2_LOGGING_REPORT.md`
