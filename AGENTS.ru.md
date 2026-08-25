# VaultBase — Руководство разработчика

> Русскоязычный дубль [AGENTS.md](AGENTS.md).

## Структура проекта

```
manager-work/
├── src/                          # Фронтенд React (Vite)
│   ├── pages/                    # Компоненты-страницы
│   │   ├── DashboardRedesigned.jsx # Главный дашборд
│   │   ├── Cards.jsx             # Управление картами
│   │   ├── Orders.jsx            # Трекинг заказов
│   │   ├── Profiles.jsx          # Профили (+ drops внутри)
│   │   ├── Shops.jsx             # Каталог магазинов
│   │   ├── Proxies.jsx           # Управление прокси
│   │   ├── Couriers.jsx          # Курьеры / Посылки (Stuffer)
│   │   ├── Imap.jsx              # Почтовые аккаунты
│   │   ├── Updates.jsx           # Обновления
│   │   ├── Settings.jsx          # Настройки + аудит
│   │   ├── MyStats.jsx           # Личная статистика оператора
│   │   ├── UsersPage.jsx         # Управление пользователями (admin)
│   │   ├── Drops.jsx             # Заглушка (функционал внутри Profiles)
│   │   └── UserLogin.jsx         # Аутентификация пользователя
│   ├── components/               # Переиспользуемые компоненты
│   ├── hooks/                    # Пользовательские хуки
│   │   ├── useAuth.jsx           # Контекст аутентификации
│   │   ├── useIdleTimer.js       # Тайм-аут сессии
│   │   ├── useLang.jsx           # i18n
│   │   ├── useSmartToast.jsx     # Тост-уведомления
│   │   └── useConfirm.jsx        # Диалоги подтверждения
│   ├── styles/                   # CSS (дизайн-система) — 7 файлов, всё консолидировано
│   │   ├── index.css             # Точка входа: @import всех 5 слоёв ниже
│   │   ├── tokens.css            # Токены (CSS-переменные: цвета, отступы, тени)
│   │   ├── base.css              # Reset + body + базовая типографика (@layer app)
│   │   ├── layout.css            # Сайдбар, топбар, контент (@layer app)
│   │   ├── components.css        # Кнопки, карточки, утилиты (@layer app)
│   │   ├── pages.css             # Стили страниц: дашборд, карты и т.д. (@layer app)
│   │   └── fonts.css             # @font-face для Geist/GeistMono
│   ├── App.jsx                   # Главный компонент
│   ├── main.jsx                  # Точка входа (импортирует src/index.css)
│   ├── float.jsx                 # Float-окно (импортирует src/index.css)
│   └── index.css                 # Однострочный @import styles/index.css
│
│   ⚠️  CSS — ЧИТАТЬ ПЕРЕД ПРАВКОЙ СТИЛЕЙ:
│   СТАРЫЕ имена файлов (tokens-redesign.css, layout/sidebar-redesign.css,
│   utilities-redesign.css, content-redesign.css и т.д.) БОЛЬШЕ НЕ СУЩЕСТВУЮТ.
│   Они объединены в v2.8.0. Правка этих путей не даёт эффекта.
│   Редактировать только файлы в src/styles/ — 7 файлов выше.
│   Цепочка импортов: main.jsx → src/index.css → src/styles/index.css → 5 файлов.
│
├── src-tauri/                    # Бэкенд Rust (Tauri v2)
│   ├── src/
│   │   ├── main.rs               # Точка входа: setup, invoke_handler (206 команд)
│   │   ├── commands/             # Tauri-команды по доменам
│   │   │   ├── mod.rs            # Реэкспорт всех команд
│   │   │   ├── auth.rs           # Вход, сессии, мастер-пароль
│   │   │   ├── cards.rs          # Карты + магазины (CRUD, фильтры)
│   │   │   ├── orders.rs         # Заказы
│   │   │   ├── dashboard.rs      # Статистика дашборда
│   │   │   ├── imap.rs / smtp.rs # Почта
│   │   │   ├── license.rs        # Лицензия
│   │   │   ├── sync.rs           # Синхронизация
│   │   │   ├── stuffer.rs        # Курьеры/посылки (Stuffer API)
│   │   │   ├── automation.rs     # Автоматизация
│   │   │   ├── catalog.rs        # Каталог
│   │   │   ├── config.rs / misc.rs
│   │   │   └── *_tests.rs        # Тесты команд рядом с кодом
│   │   ├── models.rs             # Модели данных + флаги прав (perms)
│   │   ├── database/             # Слой БД (SQLCipher — вся БД зашифрована)
│   │   │   ├── mod.rs            # Структура Database + обёртка impl
│   │   │   ├── _core.rs          # Открытие, пул, ключи
│   │   │   ├── _cards.rs         # Операции с картами
│   │   │   ├── _analytics.rs     # Статистика дашборда
│   │   │   ├── _imap.rs          # Почтовые аккаунты
│   │   │   ├── _profiles.rs      # Профили + drops
│   │   │   ├── _shops.rs         # Магазины + каталог
│   │   │   ├── _orders.rs        # Заказы
│   │   │   ├── _misc.rs          # Прочие операции
│   │   │   ├── _users.rs         # Аутентификация, права, автовход
│   │   │   ├── _helpers.rs       # Вспомогательные функции
│   │   │   ├── _seed.rs          # Сидинг справочников
│   │   │   └── _migrations.rs    # Миграции БД
│   │   ├── encryption.rs         # AES-256-GCM для полей
│   │   ├── imap.rs / smtp.rs     # Почтовые клиенты
│   │   ├── parser.rs             # Парсинг карт из текста
│   │   ├── sync.rs / ws_sync.rs  # HTTP + WebSocket синхронизация
│   │   ├── tracking.rs           # Трекинг заказов
│   │   ├── license.rs            # Валидация лицензии
│   │   ├── config.rs             # TOML-профили (dev/staging/production)
│   │   ├── logging.rs            # tracing-логи (JSON, ротация по дням)
│   │   └── background.rs         # Фоновые задачи
│   ├── tauri.conf.json           # Конфиг Tauri (окна: main + float)
│   └── icons/                    # Иконки приложения
│
├── package.json                  # Node-зависимости
├── vite.config.js                # Конфиг Vite
└── AGENTS.md                     # Оригинал этого файла (EN)
```

## Установка и разработка

### Требования

- Node.js 18+
- Rust 1.70+
- Tauri CLI: `npm install -g @tauri-apps/cli`

### Установка

```bash
cd manager-work
npm install
```

### Разработка

```bash
# Терминал 1: Vite dev-сервер
npm run dev

# Терминал 2: приложение Tauri
npm run tauri dev
```

### Сборка

```bash
npm run build
npm run tauri build
```

## Архитектура

### Фронтенд (React 18 + Vite)

- **Состояние:** React Context (useAuth, useLang, useSmartToast, useConfirm)
- **Стили:** CSS-переменные + утилиты Tailwind
- **Дизайн-система:** tokens-redesign.css (цвета, отступы, тени, типографика)
- **Компоненты:** лениво загружаемые страницы, переиспользуемый UI
- **Асинхронность:** Tauri invoke() для вызова бэкенда, обработка ошибок на промисах

### Бэкенд (Rust + Tauri v2)

- **БД:** SQLite с пулом соединений r2d2
- **Шифрование:** AES-256-GCM для чувствительных полей (номера карт, пароли)
- **Аутентификация:** bcrypt + токены сессий
- **Права:** роли (admin, operator) с гранулярной проверкой
- **Синхронизация:** WebSocket для обновлений в реальном времени
- **Почта:** IMAP/SMTP для интеграции почтовых аккаунтов

## Ключевые возможности

### Пользователи

- **Роли:** admin (полный доступ), operator (ограниченный) — назначаются **лицензией**
- **Схема входа:** активация лицензии → мастер-пароль → автовход в соло-режиме
- **Права:** гранулярная система (view_own_cards_full, take_cards, transfer_cards и т.д.)
- **Сессии:** токены с истечением, авто-очистка просроченных
- **Журнал действий:** все действия логируются с временем и деталями
- **Тайм-аут:** 30 минут неактивности → авто-выход

### Карты

- **Шифрование:** номера карт зашифрованы в покое (AES-256-GCM)
- **BIN-lookup:** авто-обогащение данными банка через iinapi.com
- **Изоляция:** операторы видят только свои карты
- **Статусы:** free, in_use, dead, archived
- **Таймлайн карты:** полная история использования по магазинам

### Трекинг заказов

- **Статусы:** pending, processing, shipped, delivered, failed, cancelled
- **Трекинг:** прямые API перевозчиков (UPS/FedEx/USPS) + fallback на 17track.net
- **Email footprint:** отслеживание почты, использованной для заказа
- **Оценка риска:** авто-скоринг по магазину, карте, профилю

### Дашборд admin

- **Live-уведомления:** тосты при взятии карт и создании заказов операторами
- **Статистика:** обзор пользователей, активность, назначения карт
- **Аудит:** поиск по журналу системных событий
- **Онлайн-сессии:** просмотр и отзыв активных сессий

### Дашборд оператора

- **My Stats:** личная статистика (взято карт, создано заказов, конверсия)
- **Мои карты:** список карт, назначенных оператору
- **Журнал:** личная история действий
- **Смена пароля:** самообслуживание

## Рабочие процессы

### Добавление новой Tauri-команды

1. **Объявить команду в подходящем домене `src-tauri/src/commands/`** (например, `cards.rs`)
   и реэкспортировать в `commands/mod.rs`:

```rust
#[tauri::command]
pub(crate) fn my_new_command(param: String) -> Result<String, String> {
    Ok("result".to_string())
}
```

2. **Зарегистрировать в `invoke_handler` в `main.rs`:**

```rust
.invoke_handler(tauri::generate_handler![
    commands::cards::my_new_command,
])
```

3. **Вызвать из React:**

```javascript
const result = await invoke('my_new_command', { param: 'value' })
```

### Добавление метода БД

1. **Добавить в нужный подмодуль `src-tauri/src/database/`:**

```rust
// например, в _cards.rs
impl Database {
    pub fn my_new_method(&self, id: i64) -> Result<MyType, String> {
        // реализация
    }
}
```

2. **Вызвать из Tauri-команды:**

```rust
#[tauri::command]
fn my_command(id: i64) -> Result<MyType, String> {
    with_db!(db, { db.my_new_method(id) })
}
```

### Добавление страницы React

1. **Создать компонент в `src/pages/MyPage.jsx`:**

```javascript
export default function MyPage({ onNavigate, activeTab }) {
  return <div>My Page</div>
}
```

2. **Добавить в `PAGE_MAP` в `App.jsx`:**

```javascript
const PAGE_MAP = {
  my_page: lazy(() => import('./pages/MyPage')),
}
```

3. **Добавить в `NAV_DEFS` в `App.jsx`:**

```javascript
const NAV_DEFS = [{ key: 'my_page', icon: MyIcon, page: 'my_page', label: 'My Page' }]
```

## Система прав

### Флаги прав (в `models.rs`)

```rust
pub mod perms {
    pub const VIEW_OWN_CARDS_FULL: &str = "view_own_cards_full";
    pub const TAKE_CARDS: &str = "take_cards";
    pub const TRANSFER_CARDS: &str = "transfer_cards";
    pub const CREATE_ORDERS: &str = "create_orders";
    pub const VIEW_AUDIT_LOG: &str = "view_audit_log";
}
```

### Проверка прав в Rust

```rust
#[tauri::command]
fn my_protected_command() -> Result<(), String> {
    let user = require_perm(models::perms::MY_PERMISSION)?;
    Ok(())
}
```

### Проверка прав в React

```javascript
const { hasPerm, isAdmin } = useAuth()
if (hasPerm('take_cards')) {
  // показать кнопку
}
```

## Обработка ошибок

### Фронтенд

- **useSmartToast:** централизованные тост-уведомления
- **try-catch:** все асинхронные операции обёрнуты
- **Fallback UI:** пустые состояния, error boundaries
- **Сообщения:** понятные ошибки на русском
- **401:** авто-выход и редирект на логин при истечении сессии

### Бэкенд

- **Result<T, String>:** все операции возвращают Result
- **Свои ошибки:** конкретные сообщения под сценарии
- **Логирование:** все ошибки в журнал действий
- **Мягкая деградация:** сбой без повреждения данных

## Тестирование

### Чеклист ручного тестирования

- [ ] Вход/выход работает
- [ ] Тайм-аут срабатывает через 30 минут неактивности
- [ ] Admin видит всех пользователей и статистику
- [ ] Оператор видит только свои карты
- [ ] Шифрование/дешифрование карт работает
- [ ] Создание и трекинг заказов работает
- [ ] Синхронизация почты работает
- [ ] WebSocket-синхронизация работает
- [ ] Журнал фиксирует все действия
- [ ] Права применяются корректно

### Первый запуск / доступ

- При первом запуске создаётся один пользователь `admin` со **случайным 32-байтным паролем,
  который нигде не хранится** (ни в логе, ни в файле). В соло-режиме приложение
  авто-входит после ввода мастер-пароля — логин/пароль не нужны.
- Роль (`admin`/`operator`) берётся из активированной лицензии (config `license_role`),
  обновляется при каждом verify.
- См. [docs/AUTH_AND_ROLES.md](docs/AUTH_AND_ROLES.md).

## Советы по производительности

1. **БД:** пул соединений (r2d2) для конкурентных запросов
2. **Фронтенд:** ленивая загрузка страниц, React.memo для тяжёлых компонентов
3. **Шифрование:** кэшировать расшифрованные значения в памяти (осторожно)
4. **Синхронизация:** WebSocket вместо поллинга
5. **CSS:** CSS-переменные для тем, избегать inline-стилей

## Безопасность

1. **Пароли:** всегда bcrypt (cost 14)
2. **Шифрование:** AES-256-GCM для чувствительных данных
3. **Сессии:** валидация токена на каждом запросе
4. **Права:** проверка и на фронте, и на бэке
5. **Логирование:** логировать чувствительные операции (но не пароли/ключи)
6. **HTTPS:** всегда в продакшне
7. **CORS:** ограничить доступ доверенными источниками

## Диагностика

### Ошибка "database_locked"

- Проверьте, не запущен ли второй экземпляр
- Перезапустите приложение

### Ошибка "permission_denied"

- Проверьте роль и права пользователя
- Убедитесь, что токен валиден

### Ошибка "card_not_found"

- Карта могла быть удалена
- Проверьте корректность ID карты

### WebSocket не подключается

- Проверьте сеть
- Убедитесь, что sync-сервер запущен
- Проверьте правила фаервола

## Ресурсы

- [Tauri Docs](https://tauri.app/docs/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [React Docs](https://react.dev/)
- [SQLite Docs](https://www.sqlite.org/docs.html)
- [Tailwind CSS](https://tailwindcss.com/)

---

**Обновлено:** 25 августа 2026
**Версия:** 2.11.3
