# 🔧 VaultBase Configuration System

**Создано:** 11 августа 2026 (Sprint 3 Day 3)  
**Версия:** 2.11.2

---

## 📋 Обзор

VaultBase использует **TOML-конфигурацию** для управления настройками приложения:

- ✅ **Три профиля:** dev, staging, production
- ✅ **Переопределение через ENV:** все параметры можно переопределить через переменные окружения
- ✅ **Валидация:** конфиг проверяется при загрузке
- ✅ **Структурированные логи:** все изменения конфига логируются

---

## 📂 Файлы конфигурации

| Файл                        | Профиль    | Назначение                               |
| --------------------------- | ---------- | ---------------------------------------- |
| `VaultBase.dev.toml`        | dev        | Разработка (debug mode, localhost)       |
| `VaultBase.staging.toml`    | staging    | Staging (production-like, internal URLs) |
| `VaultBase.production.toml` | production | Production (high security, real URLs)    |

---

## 🚀 Быстрый старт

### 1. Загрузка конфига по умолчанию (dev):

```rust
// В main.rs - автоматически загружается
let config = config::get_default_config("dev");
```

### 2. Загрузка конфига из файла:

```rust
use std::path::Path;

// Загрузить конфиг из VaultBase.dev.toml
let config = config::load_config(Path::new("VaultBase.dev.toml"))?;
```

### 3. Получить путь конфига для профиля:

```rust
let config_path = config::get_config_path("dev");
// Result: VaultBase.dev.toml (в VAULTBASE_CONFIG_DIR или текущей директории)
```

---

## ⚙️ Структура конфига

### [app] - Основные параметры приложения

```toml
[app]
profile = "dev"              # dev, staging, production
name = "VaultBase"           # Имя приложения
version = "2.11.2"           # Версия
debug = true                 # Включить debug режим (только dev!)
```

### [logging] - Логирование

```toml
[logging]
level = "debug"              # trace, debug, info, warn, error
json = true                  # JSON-формат логов
file_output = true           # Писать логи в файлы
log_dir = "logs"             # Директория логов
max_file_size = 100          # Max размер файла в MB
```

**Доступные уровни:**

- `trace` - Очень подробная отладка (dev только)
- `debug` - Детальная отладка (dev только)
- `info` - Общая информация (production)
- `warn` - Предупреждения
- `error` - Ошибки

### [api] - API и внешние сервисы

```toml
[api]
sync_server = "http://localhost:3000"     # URL синк-сервера
stuffer_base = "http://localhost:3001"    # URL Stuffer API
request_timeout = 30                      # HTTP timeout (sec)
tracking_timeout = 15                     # Tracking API timeout (sec)

[api.tracking]
usps = "http://localhost:3002/usps"
ups = "http://localhost:3002/ups"
fedex = "http://localhost:3002/fedex"
track17 = "http://localhost:3002/track17"
iinapi = "http://localhost:3002/iinapi"
```

### [security] - Безопасность

```toml
[security]
rate_limit_strict = 5              # Auth попытки в минуту
rate_limit_moderate = 30           # API вызовы в минуту
rate_limit_lenient = 100           # Общие вызовы в минуту
pbkdf2_iterations = 600000         # PBKDF2 итерации для паролей
session_timeout = 3600             # Timeout сессии (сек)
autolock_timeout = 30              # Auto-lock timeout (сек)
```

**Рекомендации:**

- `pbkdf2_iterations` - минимум 100k (лучше 600k+)
- `rate_limit_strict` - для аутентификации (1-10/мин)
- `rate_limit_moderate` - для API (20-50/мин)

### [database] - База данных

```toml
[database]
path = "vaultbase.db"          # Путь к БД файлу
max_connections = 5            # Max одновременных подключений
connection_timeout = 10        # Timeout подключения (сек)
max_bulk_size = 500            # Max элементов в bulk операциях
```

### [email] - IMAP/SMTP

```toml
[email]
imap_poll_interval = 5         # Интервал опроса (сек)
imap_fetch_limit = 100         # Max писем за раз
smtp_timeout = 30              # SMTP timeout (сек)
```

### [background] - Фоновые задачи

```toml
[background]
license_check_interval = 60           # 1 мин
sync_interval = 60                    # 1 мин
stuffer_poll_interval = 300           # 5 мин
fulfillment_check_interval = 1800     # 30 мин
risk_check_interval = 300             # 5 мин
quarantine_cleanup_interval = 1800    # 30 мин
catalog_update_interval = 3600        # 1 час
```

---

## 🌍 Переменные окружения

Все параметры конфига можно переопределить через ENV переменные:

### Основные

```bash
# Профиль
export VAULTBASE_PROFILE=staging

# Debug режим
export VAULTBASE_DEBUG=1

# Уровень логирования
export VAULTBASE_LOG_LEVEL=debug
```

### API

```bash
# Sync сервер
export VAULTBASE_SYNC_SERVER=https://api.example.com

# Директория конфигов
export VAULTBASE_CONFIG_DIR=/etc/vaultbase
```

### Примеры использования

```bash
# Запуск в staging режиме с debug логами
export VAULTBASE_PROFILE=staging
export VAULTBASE_LOG_LEVEL=debug
./vaultbase

# Production с кастомным sync сервером
export VAULTBASE_PROFILE=production
export VAULTBASE_SYNC_SERVER=https://my-api.example.com
./vaultbase

# Dev режим с локальными сервисами
export VAULTBASE_DEBUG=1
./vaultbase
```

---

## 📝 Структура по профилям

### Development (dev)

**Назначение:** Разработка и локальное тестирование

**Характеристики:**

- ✅ Debug mode включен
- ✅ Log level: DEBUG (очень подробно)
- ✅ JSON logging включен для структурированных логов
- ✅ Localhost URLs (http://localhost:XXXX)
- ✅ 5 одновременных подключений к БД
- ✅ Низкие таймауты (для быстрого тестирования)

**Когда использовать:**

- Локальная разработка на машине разработчика
- Модульное тестирование
- Дебаг логирования

**Пример запуска:**

```bash
VAULTBASE_LOG_LEVEL=trace ./vaultbase
```

### Staging (staging)

**Назначение:** QA, тестирование перед production

**Характеристики:**

- ❌ Debug mode отключен (как production)
- ✅ Log level: INFO (только ошибки и важное)
- ✅ JSON logging включен
- ✅ Внутренние staging URLs (https://staging-*)
- ✅ 10 подключений к БД
- ✅ Production-like конфиг

**Когда использовать:**

- QA-тестирование в контролируемой среде
- Load testing
- Проверка перед production deployment
- Тестирование интеграций

**Пример запуска:**

```bash
VAULTBASE_PROFILE=staging ./vaultbase
```

### Production (production)

**Назначение:** Реальные пользователи

**Характеристики:**

- ❌ Debug mode категорически отключен!
- ✅ Log level: INFO (только ошибки)
- ✅ JSON logging включен
- ✅ Реальные production URLs (https://api.vaultbase.com)
- ✅ 20 подключений к БД (высокая пропускная способность)
- ✅ Максимальная безопасность

**Когда использовать:**

- Real users
- Live environment
- Maximum uptime

**Пример запуска:**

```bash
VAULTBASE_PROFILE=production ./vaultbase
```

---

## 🔐 Безопасность

### DO ✅

1. **Используй production конфиг в production:**

   ```bash
   export VAULTBASE_PROFILE=production
   ```

2. **Никогда не логируй чувствительные данные:**
   - Пароли
   - API ключи
   - Приватные ключи
   - PII (личные данные)

3. **Используй HTTPS в production:**

   ```toml
   sync_server = "https://api.vaultbase.com"  # ✅ HTTPS
   stuffer_base = "https://stuffer.vaultbase.com"
   ```

4. **Проверяй log_dir разрешения:**
   ```bash
   chmod 700 logs/  # Только owner может читать/писать
   ```

### DON'T ❌

1. **Никогда не используй debug mode в production:**

   ```bash
   # ❌ НЕПРАВИЛЬНО
   export VAULTBASE_DEBUG=1
   export VAULTBASE_PROFILE=production

   # ✅ ПРАВИЛЬНО
   export VAULTBASE_PROFILE=production
   ```

2. **Не коммитьте конфиги с реальными API ключами:**

   ```bash
   # ❌ НЕПРАВИЛЬНО
   git add VaultBase.production.toml

   # ✅ ПРАВИЛЬНО
   echo "VaultBase.production.toml" >> .gitignore
   ```

3. **Не понижайте PBKDF2 итерации:**

   ```toml
   # ❌ НЕПРАВИЛЬНО
   pbkdf2_iterations = 10000  # Слишком низко!

   # ✅ ПРАВИЛЬНО
   pbkdf2_iterations = 600000  # Production strength
   ```

4. **Не используйте localhost URLs в production:**
   ```toml
   # ❌ НЕПРАВИЛЬНО
   sync_server = "http://localhost:3000"

   # ✅ ПРАВИЛЬНО
   sync_server = "https://api.vaultbase.com"
   ```

---

## 🐛 Отладка конфига

### Просмотр загруженного конфига

При старте приложения логируется загруженный конфиг:

```
2026-08-11T10:30:45.123Z INFO vaultbase::config Configuration loaded successfully profile=production log_level=info
```

### Проверка переопределений

```bash
# Логи покажут какие переменные окружения переопределили значения
export VAULTBASE_LOG_LEVEL=debug
./vaultbase

# В логах увидишь:
# INFO vaultbase::config Log level overridden via VAULTBASE_LOG_LEVEL
```

### Валидация конфига

Конфиг автоматически проверяется при загрузке:

```rust
// Проверяет:
// ✓ Profile is one of: dev, staging, production
// ✓ Log level is one of: trace, debug, info, warn, error
// ✓ Timeouts > 0
// ✓ Rate limits > 0
// ✓ PBKDF2 iterations >= 100k (warning if < 600k)
```

Если ошибка:

```
ERROR Failed to parse TOML configuration: invalid profile 'invalid'. Must be dev, staging, or production
```

---

## 📚 Примеры

### Пример 1: Разработка с debug логами

```bash
cd /workspace/manager-work

# Используем dev конфиг с максимально подробными логами
export VAULTBASE_LOG_LEVEL=trace
export VAULTBASE_CONFIG_DIR=.

./vaultbase

# Логи будут писаться в: logs/vaultbase.log.YYYY-MM-DD
# Уровень: TRACE (очень подробно)
```

### Пример 2: Staging для QA

```bash
export VAULTBASE_PROFILE=staging
export VAULTBASE_CONFIG_DIR=/etc/vaultbase

./vaultbase

# Конфиг: VaultBase.staging.toml
# API endpoints: staging-api.vaultbase.internal
# Log level: INFO
```

### Пример 3: Production deployment

```bash
export VAULTBASE_PROFILE=production
export VAULTBASE_CONFIG_DIR=/etc/vaultbase
export VAULTBASE_SYNC_SERVER=https://api.prod.vaultbase.com

./vaultbase

# Конфиг: VaultBase.production.toml
# Sync override: https://api.prod.vaultbase.com (из ENV)
# Debug: отключен (security)
# Log level: INFO (только ошибки)
```

---

## 🔄 Миграция с констант на конфиг

### До (hardcoded)

```rust
const SYNC_SERVER: &str = "http://localhost:3000";
const REQUEST_TIMEOUT: u64 = 30;

// В коде
invoke_api(SYNC_SERVER, REQUEST_TIMEOUT)
```

### После (конфиг)

```rust
// В config.rs
pub struct ApiConfig {
    pub sync_server: String,
    pub request_timeout: u32,
}

// В коде
invoke_api(&config.api.sync_server, config.api.request_timeout)
```

---

## 📋 Checklist для deployment

- [ ] Выбран правильный конфиг (dev/staging/production)
- [ ] Debug mode отключен в production
- [ ] Log level установлен правильно
- [ ] API endpoints указывают на правильные хосты
- [ ] PBKDF2 iterations >= 600k
- [ ] Rate limits установлены адекватно
- [ ] Database path правильный
- [ ] Разрешения на log_dir (chmod 700)
- [ ] ENV переменные установлены правильно
- [ ] Логи пишутся в правильный файл

---

## ❓ FAQ

**Q: Как изменить конфиг после запуска?**  
A: Измени ENV переменную и перезапусти приложение. Конфиг загружается при старте.

**Q: Почему мой конфиг не загружается?**  
A: Проверь путь файла. По умолчанию ищется в текущей директории или `$VAULTBASE_CONFIG_DIR`.

**Q: Можно ли горячее перезагружать конфиг?**  
A: Нет в текущей версии. Нужно перезапустить приложение.

**Q: Что если конфиг файл не найден?**  
A: Используется `get_default_config()` с значениями по умолчанию для профиля.

**Q: Могу ли я использовать относительные пути в конфиге?**  
A: Да, пути вычисляются относительно app data directory.

---

## 📞 Дополнительная информация

- **Code:** `src-tauri/src/config.rs` (430+ строк)
- **Tests:** 5 unit tests для валидации конфига
- **Docs:** Каждый параметр имеет комментарий в TOML файлах

---

**Готово к использованию!** ✅ День 3 завершен
