# VaultBase — Мастер-чеклист улучшений, багов и доработок

> **Создан:** 2026-08-11 · **Обновлён:** 2026-08-26  
> **Всего пунктов:** 184 · **Выполнено:** 143 (из них 9 «уже было») · **Открыто:** 34  
> **Статусы:** ⬜ Не начато · 🔄 В работе · ✅ Готово · ❌ Отклонено  
> **Приоритеты:** 🔴 Критичный · 🟠 Важный · 🟡 Средний · 🟢 Желательный  
> **Параллельная работа:** пункт сначала клеймится (⬜ → `🔄 @a`/`🔄 @b`, коммит одного
> чеклиста), потоки/правила — [PARALLEL_WORK.md](PARALLEL_WORK.md). Открытые 43 пункта
> распределены: 20 → STREAM A (backend), 23 → STREAM B (frontend).

---

## 1. БЕЗОПАСНОСТЬ

### 1.1 Шифрование БД (VeraCrypt-уровень)

| #       | Задача                                                                                          | Приоритет | Файл(ы)                                     | Статус |
| ------- | ----------------------------------------------------------------------------------------------- | --------- | ------------------------------------------- | ------ |
| SEC-001 | Внедрить SQLCipher — полное шифрование файла БД (никакие метаданные не видны без мастер-пароля) | 🔴        | `src-tauri/Cargo.toml`, `database/_core.rs` | ✅     |
| SEC-002 | Key derivation через PBKDF2/Argon2 для SQLCipher (уже есть PBKDF2 1M, адаптировать)             | 🔴        | `encryption.rs`, `_core.rs`                 | ✅     |
| SEC-003 | Удалить `vaultbase.db` из git-истории (BFG / git filter-branch)                                 | 🔴        | `.gitignore`, git history                   | ✅     |
| SEC-004 | Добавить `vaultbase.db` и все `.db` в `.gitignore`                                              | 🔴        | `.gitignore`                                | ✅     |

### 1.2 Мастер-пароль

| #       | Задача                                                                                       | Приоритет | Файл(ы)                                            | Статус        |
| ------- | -------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------- | ------------- |
| SEC-005 | Реализовать смену мастер-пароля (проверка текущего → перешифрование ключа → обновление хеша) | 🔴        | `encryption.rs`, `commands/config.rs`, `Login.jsx` | ✅            |
| SEC-006 | Добавить confirm-поле при смене пароля (повторить новый пароль)                              | 🟠        | `Login.jsx`                                        | ✅ (уже было) |
| SEC-007 | Показывать требования к паролю (12+ символов) в UI                                           | 🟠        | `Login.jsx:14-21`                                  | ✅ (уже было) |

### 1.3 E2E шифрование синхронизации

| #       | Задача                                                                              | Приоритет | Файл(ы)                                    | Статус |
| ------- | ----------------------------------------------------------------------------------- | --------- | ------------------------------------------ | ------ |
| SEC-008 | E2E шифрование sync-группы (ключ группы, сервер видит только зашифрованный payload) | 🔴        | `sync.rs`, `ws_sync.rs`, `cc-sync-server/` | ✅     |
| SEC-009 | Мастер-пароль тоже синхронизируется не в открытом виде — усложнить протокол         | 🔴        | `sync.rs`                                  | ✅     |

### 1.4 Утечки данных в памяти

| #       | Задача                                                                | Приоритет | Файл(ы)                                     | Статус |
| ------- | --------------------------------------------------------------------- | --------- | ------------------------------------------- | ------ |
| SEC-010 | Очистка `revealed: {}` (расшифрованные PAN/CVV) при lock/logout       | 🔴        | `src/store/cards.js:210`                    | ✅     |
| SEC-011 | Float окно: очистка данных при lock/logout                            | 🔴        | `src/float.jsx:179`                         | ✅     |
| SEC-012 | SMTP test() — zeroize пароля после использования                      | 🟠        | `smtp.rs:90-104`                            | ✅     |
| SEC-013 | Clipboard auto-clear через 30 сек для PAN/CVV                         | 🟠        | `src/utils/clipboard.js`, `float.jsx:17-40` | ✅     |
| SEC-014 | UI store reset при logout (sideCard, shopUsageCardId, timelineCardId) | 🟠        | `src/store/ui.js`                           | ✅     |

### 1.5 IMAP/SMTP безопасность

| #       | Задача                                                   | Приоритет | Файл(ы)                    | Статус |
| ------- | -------------------------------------------------------- | --------- | -------------------------- | ------ |
| SEC-015 | Шифрование IMAP-паролей тем же ключом что PAN/CVV        | 🟠        | `imap.rs`, `database/`     | ✅     |
| SEC-016 | SMTP TLS логика ИНВЕРТИРОВАНА — исправить relay/starttls | 🔴        | `smtp.rs:64-71`            | ✅     |
| SEC-017 | Ротация IMAP credentials через UI                        | 🟡        | Settings UI                | ✅     |
| SEC-018 | Алерт при отвале IMAP-подключения                        | 🟡        | `imap.rs`, `background.rs` | ✅     |

### 1.6 CSP и конфигурация

| #       | Задача                                                               | Приоритет | Файл(ы)                 | Статус |
| ------- | -------------------------------------------------------------------- | --------- | ----------------------- | ------ |
| SEC-019 | Ужесточить CSP: добавить report-uri, проверить inline-стили          | 🟡        | `tauri.conf.json`       | ✅     |
| SEC-020 | Seed data: запретить `seed_test_data` в production сборках           | 🔴        | `commands/config.rs:62` | ✅     |
| SEC-021 | Secret config keys: валидация что frontend не запрашивает raw values | 🟡        | `state.rs:72-90`        | ✅     |

### 1.7 Sync-сервер безопасность

| #       | Задача                                                                | Приоритет | Файл(ы)                              | Статус |
| ------- | --------------------------------------------------------------------- | --------- | ------------------------------------ | ------ |
| SEC-022 | TOCTOU race condition в WS лицензии — обернуть в транзакцию           | 🟠        | `cc-sync-server/ws-tauri.js:110-130` | ✅     |
| SEC-023 | WS rate limit: снизить с 50 msg/sec, добавить backoff после нарушения | 🟠        | `cc-sync-server/ws-tauri.js:60-75`   | ✅     |
| SEC-024 | License offline mode: показывать предупреждение в UI                  | 🟡        | `sync.rs`, UI header                 | ✅     |

---

## 2. АРХИТЕКТУРА И ОРГАНИЗАЦИЯ КОДА

### 2.1 Rust бэкенд

| #        | Задача                                                                              | Приоритет | Файл(ы)                 | Статус                                                       |
| -------- | ----------------------------------------------------------------------------------- | --------- | ----------------------- | ------------------------------------------------------------ |
| ARCH-001 | Разбить `main.rs` (3100 строк) на модули: команды, инициализация, обработка событий | 🟠        | `src-tauri/src/main.rs` | ✅ (уже сделано — main.rs 277 строк)                         |
| ARCH-002 | Заменить 7 `.unwrap()` в `stuffer.rs` на `?` / `.unwrap_or_default()`               | 🔴        | `stuffer.rs:384-495`    | ✅                                                           |
| ARCH-003 | Заменить `.unwrap()` в IMAP regex на `.expect()` с описанием                        | 🟡        | `imap.rs:15-19`         | ✅                                                           |
| ARCH-004 | Структурные ошибки из commands: JSON `{ code, message, suggestion }` вместо String  | 🟠        | `commands/*.rs`         | ✅ (классификатор + database_locked/invalid_master_password) |
| ARCH-005 | IMAP: мигрировать на async-imap или tokio thread pool (blocking I/O)                | 🟠        | `imap.rs`               | ✅                                                           |

### 2.2 Frontend архитектура

| #        | Задача                                                                                          | Приоритет | Файл(ы)                                | Статус |
| -------- | ----------------------------------------------------------------------------------------------- | --------- | -------------------------------------- | ------ |
| ARCH-006 | Разбить Cards.jsx (1302 строки): CardTable, CardFilters, CardActions, SidePanelManager          | 🟠        | `src/pages/Cards.jsx`                  | ✅     |
| ARCH-007 | Разбить DashboardRedesigned.jsx (1383 строки): RevenueChart, Heatmap, StatCards, PeriodSelector | 🟠        | `src/pages/DashboardRedesigned.jsx`    | ✅     |
| ARCH-008 | Разбить Orders.jsx (558 строк) и Profiles.jsx (643 строки)                                      | 🟡        | `src/pages/Orders.jsx`, `Profiles.jsx` | ✅     |
| ARCH-009 | Централизованный API-слой: `src/api/cards.js`, `api/orders.js` и т.д.                           | 🟠        | `src/api/`                             | ✅     |
| ARCH-010 | TypeScript миграция: начать с хуков и утилит (.jsx → .tsx)                                      | 🟡        | `src/hooks/`, `src/utils/`             | ✅     |
| ARCH-011 | Drops.jsx — убрать заглушку из роутинга или реализовать полноценный UI                          | 🟡        | `src/pages/Drops.jsx`                  | ✅     |

### 2.3 Переиспользуемые хуки (устранение дублирования)

| #        | Задача                                                                 | Приоритет | Файл(ы)                         | Статус |
| -------- | ---------------------------------------------------------------------- | --------- | ------------------------------- | ------ |
| ARCH-012 | `usePagination()` — заменить 3 копии buildPageNumbers/getTotalPages    | 🟠        | `src/hooks/usePagination.js`    | ✅     |
| ARCH-013 | `useTableFilters()` — заменить 3 копии debounced search + filter state | 🟠        | `src/hooks/` (новый)            | ✅     |
| ARCH-014 | `useBulkActions()` — заменить 3 копии массовых операций                | 🟡        | `src/hooks/` (новый)            | ✅     |
| ARCH-015 | Единый `<DataLoader>` wrapper (loading, empty, error) для всех страниц | 🟡        | `src/components/DataLoader.jsx` | ✅     |

### 2.4 State management

| #        | Задача                                                                 | Приоритет | Файл(ы)                                   | Статус |
| -------- | ---------------------------------------------------------------------- | --------- | ----------------------------------------- | ------ |
| ARCH-016 | Создать `src/store/ui.js` для централизации modal/panel state          | 🟠        | `src/store/ui.js`                         | ✅     |
| ARCH-017 | Авто-инвалидация cache при мутациях (вместо ручного invalidateCache()) | 🟡        | `src/store/cards.js:160`, `orders.js:120` | ✅     |
| ARCH-018 | TTL для revealed card data (авто-очистка через N минут)                | 🟡        | `src/store/cards.js:210-220`              | ✅     |

---

## 3. UI / UX

### 3.1 Дизайн-система

| #      | Задача                                                       | Приоритет | Файл(ы)                     | Статус |
| ------ | ------------------------------------------------------------ | --------- | --------------------------- | ------ |
| UX-001 | Завершить дизайн-токены: убрать старые cyber-цвета (#00d9ff) | 🟡        | `src/styles/`, `tokens.css` | ✅     |
| UX-002 | Убрать мёртвый CSS (PurgeCSS или ручной аудит)               | 🟡        | `src/styles/`               | ✅     |
| UX-003 | Единые loading/empty/error состояния на ВСЕХ страницах       | 🟡        | Все страницы                | 🔄 @b  |

### 3.2 Доступность (a11y)

| #      | Задача                                           | Приоритет | Файл(ы)                            | Статус |
| ------ | ------------------------------------------------ | --------- | ---------------------------------- | ------ |
| UX-004 | ARIA-labels на иконочные кнопки                  | 🟡        | Все компоненты                     | ✅     |
| UX-005 | Keyboard navigation по таблицам (стрелки, Enter) | 🟡        | Cards, Orders, Profiles            | ✅     |
| UX-006 | `aria-live` regions для анонсирования изменений  | 🟡        | Все страницы                       | ✅     |
| UX-007 | Контрастность по WCAG AA (status badges)         | 🟡        | `constants/colors.js`, `status.js` | ✅     |
| UX-008 | Focus trap в модальных окнах Profiles            | 🟡        | `Profiles.jsx:420`                 | ✅     |
| UX-009 | `role="columnheader"` для заголовков таблиц      | 🟡        | `Cards.jsx:900-920`                | ✅     |

### 3.3 Функциональные UX улучшения

| #      | Задача                                                                  | Приоритет | Файл(ы)                               | Статус |
| ------ | ----------------------------------------------------------------------- | --------- | ------------------------------------- | ------ |
| UX-010 | Drag & Drop: импорт файлов (бросить CSV на окно)                        | 🟢        | ImportModal                           | ⬜     |
| UX-011 | Drag & Drop: переупорядочивание карт/профилей                           | 🟢        | Cards, Profiles                       | ⬜     |
| UX-012 | OS-уведомления (нативные) для: новая почта, статус посылки, ошибка sync | 🟡        | Tauri notifications plugin            | ⬜     |
| UX-013 | Onboarding-тур для новых пользователей (react-joyride)                  | 🟢        | `Onboarding.jsx`                      | ⬜     |
| UX-014 | Кастомизируемый дашборд: drag & drop виджеты (react-grid-layout)        | 🟡        | `DashboardRedesigned.jsx`             | ⬜     |
| UX-015 | Progress bar для batch import (вместо только спиннера)                  | 🟠        | `BatchImportModal.jsx`                | ✅     |
| UX-016 | Offline индикатор в header (badge когда sync server недоступен)         | 🟡        | `App.jsx`, UI header                  | ✅     |
| UX-017 | Column picker: persist в localStorage + кнопка reset                    | 🟡        | `Cards.jsx:37-48`, `ColumnPicker.jsx` | ✅     |
| UX-018 | Email assignment feedback — показывать какой email выбран               | 🟡        | `ProfileModal.jsx:312-336`            | ✅     |
| UX-019 | autoCreateDrop: убрать auto=true по умолчанию, добавить подтверждение   | 🟡        | `ProfileModal.jsx:22`                 | ✅     |

### 3.4 Горячие клавиши

| #      | Задача                                                             | Приоритет | Файл(ы)                         | Статус |
| ------ | ------------------------------------------------------------------ | --------- | ------------------------------- | ------ |
| UX-020 | Расширить: Ctrl+N (новая запись), Ctrl+F (поиск), Ctrl+E (экспорт) | 🟢        | `useKeyboardShortcuts.js`       | ✅     |
| UX-021 | Sequence timeout: уменьшить с 1000ms до 500ms                      | 🟢        | `useKeyboardShortcuts.js:47-49` | ✅     |
| UX-022 | Conflict detection: проверка на дублирование shortcuts             | 🟢        | `useKeyboardShortcuts.js`       | ✅     |

---

## 4. ПРОИЗВОДИТЕЛЬНОСТЬ

### 4.1 Рендеринг

| #        | Задача                                                                  | Приоритет | Файл(ы)                   | Статус |
| -------- | ----------------------------------------------------------------------- | --------- | ------------------------- | ------ |
| PERF-001 | React.memo() для Float компонентов: Field, CopyBtn, RiskBadge           | 🟡        | `float.jsx:75-80`         | ✅     |
| PERF-002 | React.memo() для PremiumStatCard + SmartAlertCard в Dashboard           | 🟡        | `DashboardRedesigned.jsx` | ✅     |
| PERF-003 | useCallback с правильными deps в Cards (handleSearch, handleBulkEnrich) | 🟡        | `Cards.jsx:160-200`       | ✅     |
| PERF-004 | useCallback для handleDelete, handleBulkStatus в Orders                 | 🟡        | `Orders.jsx:90-140`       | ✅     |
| PERF-005 | useMemo для recentOrders в Float ProfileFloat                           | 🟡        | `float.jsx:200+`          | ✅     |

### 4.2 Загрузка данных

| #        | Задача                                                                                    | Приоритет | Файл(ы)                            | Статус        |
| -------- | ----------------------------------------------------------------------------------------- | --------- | ---------------------------------- | ------------- |
| PERF-006 | Lazy loading страниц: React.lazy() + Suspense для всех 18 страниц                         | 🟡        | `App.jsx`                          | ✅ (уже было) |
| PERF-007 | Dashboard: Promise.allSettled() — показывать частичные данные при ошибке одного запроса   | 🟡        | `DashboardRedesigned.jsx:887`      | ✅ (уже было) |
| PERF-008 | Исправить debounce: перенести в onChange handler вместо useEffect                         | 🟡        | `src/hooks/useDebounceCallback.js` | ✅            |
| PERF-009 | Card reveal: использовать cache перед fetch (уже в store, но не используется)             | 🟡        | `store/cards.js:revealCard`        | ✅            |
| PERF-010 | React Query / TanStack Query — рассмотреть для v3 (кэш, дедупликация, background refetch) | 🟢        | Архитектурное решение              | ⬜            |

### 4.3 БД производительность

| #        | Задача                                                                    | Приоритет | Файл(ы)             | Статус   |
| -------- | ------------------------------------------------------------------------- | --------- | ------------------- | -------- |
| PERF-011 | Добавить индекс для email search: `idx_cards_email_search`                | 🟡        | `_migrations.rs`    | ✅       |
| PERF-012 | Добавить VACUUM по расписанию (при старте или ежедневно)                  | 🟢        | `background.rs`     | ✅       |
| PERF-013 | Увеличить database pool с 8 до 16 + connection_timeout 5s                 | 🟡        | `_core.rs:34`       | ✅       |
| PERF-014 | Bundle size: lazy load recharts и jsPDF (тяжёлые зависимости)             | 🟢        | `vite.config.js`    | ✅ @main |
| PERF-015 | BIN enrichment: debounce запросов (макс 1 req/2sec) + exponential backoff | 🟡        | `_cards.rs:466-530` | ✅       |

---

## 5. ФУНКЦИОНАЛ — НОВЫЙ И ДОРАБОТКИ

### 5.1 Smart Automation

| #        | Задача                                                                             | Приоритет | Файл(ы)                 | Статус   |
| -------- | ---------------------------------------------------------------------------------- | --------- | ----------------------- | -------- |
| FEAT-001 | Авто-архив: перемещение `dead` карт в отдельную директорию по нажатию пользователя | 🟡        | `commands/cards.rs`, UI | ⬜       |
| FEAT-002 | Risk V2: ML-подобный скоринг (магазин, карта, время суток, сумма)                  | 🟡        | `_orders.rs`            | 🔄 @main |
| FEAT-003 | Smart-подсказки: «Карта скоро сгорит», «3 неуспешных заказа подряд»                | 🟡        | UI notifications        | ⬜       |
| FEAT-004 | IF-THEN правила автоматизации (status=declined → пометить карту)                   | 🟡        | Новый модуль            | ⬜       |

### 5.2 Отчёты

| #        | Задача                                                | Приоритет | Файл(ы)             | Статус |
| -------- | ----------------------------------------------------- | --------- | ------------------- | ------ |
| FEAT-005 | Еженедельный отчёт: заказы, success rate, расход карт | 🟡        | jsPDF, новый модуль | ⬜     |

### 5.3 Напоминания и расписания

| #        | Задача                                                             | Приоритет | Файл(ы)             | Статус   |
| -------- | ------------------------------------------------------------------ | --------- | ------------------- | -------- |
| FEAT-006 | Напоминание: скоро истечёт срок карты (backend ✅; UI → STREAM B)  | 🟡        | `background.rs`, UI | ✅ @main |
| FEAT-007 | Напоминание: проверить трекинг посылки (backend ✅; UI → STREAM B) | 🟡        | `background.rs`, UI | ✅ @main |
| FEAT-008 | Cron-подобные задачи в background.rs                               | 🟡        | `background.rs`     | ✅ @main |

### 5.4 Stuffer доработки

| #        | Задача                                                                                            | Приоритет | Файл(ы)                    | Статус   |
| -------- | ------------------------------------------------------------------------------------------------- | --------- | -------------------------- | -------- |
| FEAT-009 | Привязка посылок к заказам/профилям (карта → заказ → посылка → курьер)                            | 🟡        | `stuffer.rs`, DB schema    | ✅ @main |
| FEAT-010 | Sync курьеров между пользователями: теги (использован под zoro.com) через хеши в реальном времени | 🟡        | `stuffer.rs`, `ws_sync.rs` | ✅ @main |
| FEAT-011 | Общий список курьеров с индивидуальными API ключами                                               | 🟡        | `stuffer.rs`, UI           | ⬜       |
| FEAT-012 | Live тест пишущих методов (add_courier, new_package)                                              | 🟡        | `stuffer.rs`               | ✅ @main |

### 5.5 Плагинная система

| #        | Задача                                                               | Приоритет | Файл(ы)    | Статус |
| -------- | -------------------------------------------------------------------- | --------- | ---------- | ------ |
| FEAT-013 | Архитектура плагинов для внешних API (курьеры от другого провайдера) | 🟡        | `stuffer/` | ✅     |

### 5.6 Пользователи

| #        | Задача                                                      | Приоритет | Файл(ы)             | Статус |
| -------- | ----------------------------------------------------------- | --------- | ------------------- | ------ |
| FEAT-014 | Soft delete: статус active/disabled вместо полного удаления | 🟠        | `UsersPage.jsx`, DB | ✅     |
| FEAT-015 | Убрать 4 неработающих PERM_LABELS                           | 🟡        | `UsersPage.jsx`     | ✅     |

### 5.7 Token и сессии

| #        | Задача                                              | Приоритет | Файл(ы)                          | Статус |
| -------- | --------------------------------------------------- | --------- | -------------------------------- | ------ |
| FEAT-016 | Token refresh mechanism (auto-refresh перед expiry) | 🟠        | `useAuth.jsx`                    | ✅     |
| FEAT-017 | Проверка token expiry перед каждым invoke()         | 🟠        | `useAuth.jsx`, `errorHandler.js` | ✅     |

---

### 5.5 VaultBase Manager (второе приложение — наблюдатель/управленец)

Контракт и архитектура: [docs/MANAGER_APP.md](docs/MANAGER_APP.md). Стрим M (@main).

| #       | Задача                                                                                                                                                                                                                                                                             | Приоритет | Файл(ы)                                       | Статус   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------- | -------- |
| MGR-001 | Серверное ядро: миграция v11, /manager/api, /api/telemetry, alerts-engine, WS-баны, канал ?app=manager                                                                                                                                                                             | 🔴        | `cc-sync-server/*`                            | ✅       |
| MGR-002 | Каркас manager-app: активация + мастер-пароль + SQLCipher + sidecar, 11 команд Tauri                                                                                                                                                                                               | 🔴        | `manager-app/src-tauri/*`                     | ✅       |
| MGR-003 | UI менеджера: дашборд, работники+политики, аналитика (BIN/шопы/дропы), новости, алерты, приоритеты, апдейты, настройки (en/ru)                                                                                                                                                     | 🔴        | `manager-app/src/*`                           | ✅       |
| MGR-004 | Воркер: отправка heartbeat + daily_stats запечатанными конвертами (X25519→HKDF→AES-GCM, см. MANAGER_APP.md §2.2, §4)                                                                                                                                                               | 🔴        | `src-tauri/src/commands/telemetry.rs` (новый) | ✅ @main |
| MGR-005 | Воркер: применение политик живьём (ban→лок, force_logout, мин. версия, permissions_override, квоты)                                                                                                                                                                                | 🔴        | `src-tauri`, `src/hooks`                      | ✅ @main |
| MGR-006 | Воркер: UI новостей (баннер по severity) и сортировка каталога по приоритетам шопов                                                                                                                                                                                                | 🟠        | `src/pages/Catalog.jsx`, компонент            | ✅ @main |
| MGR-007 | Менеджер: движок числовых алертов (правила на расшифрованных отчётах: спайк деклайна, dead-ratio, квоты) + показ в UI + OS-уведомления (tauri-plugin-notification, только при активной сессии — после разлогина по idle-таймеру не показываем); опц. generic webhook. БЕЗ Telegram | 🟠        | `manager-app`                                 | ✅ @main |
| MGR-008 | Сервер-хард: sha-256-хеш токенов в БД, kill-switch деплоя, анти-replay WS. Бэкапы БД — НЕ делаем (бэкап = вторая копия данных и риск компрометации)                                                                                                                                | 🟠        | `cc-sync-server`                              | ✅ @main |
| MGR-009 | Менеджер: tauri-plugin-updater (отдельный signing key) + staged rollout (stable/beta, %)                                                                                                                                                                                           | 🟡        | `manager-app/src-tauri`                       | ✅ @main |
| MGR-010 | Полное управление лицензиями из manager-app: список лицензий, создание (worker/manager), деактивация/бан — админ-эндпоинты на сервере (минимум логики, только CRUD лицензий), UI в manager-app                                                                                     | 🟠        | сервер + manager-app                          | ✅ @main |
| MGR-011 | Менеджер: персональная стата работника (агрегация daily_stats), сортировка списка, умная лента успехов/фейлов                                                                                                                                                                      | 🟠        | `manager-app`                                 | ✅ @main |
| MGR-012 | Аудит: на сервере только шифротекст — телеметрия/отчёты E2E-конвертами (X25519→HKDF→AES-GCM, `telemetry.rs` только seal, сервер хранит как есть), sync_cards/bin_cache AES-256-GCM; в открытом виде лишь токены лицензий (→MGR-008) и техметаданные (iid, даты, домены шопов)      | 🟠        | `cc-sync-server`, `src-tauri`                 | ✅ @main |
| MGR-013 | Воркер: panic-пароль (duress) — второй пароль на экране входа → криптостирание БД (rekey на случайный ключ) + перезапись/удаление БД, WAL, конфигов и локальных секретов; снаружи выглядит как «неверный пароль»; + удалённый wipe командой менеджера через heartbeat-политику     | 🟠        | `src-tauri`, `cc-sync-server`, `manager-app`  | ✅ @main |

## 6. БАГИ (конкретные, найденные в коде)

| #        | Баг                                                                             | Приоритет | Файл(ы)                              | Статус |
| -------- | ------------------------------------------------------------------------------- | --------- | ------------------------------------ | ------ |
| BUG-001  | SMTP TLS логика инвертирована: `use_tls=false` → starttls_relay() вместо plain  | 🔴        | `smtp.rs:64-71`                      | ✅     |
| BUG-002  | 7x `.unwrap()` в stuffer.rs — бэкенд крашится при неожиданном JSON              | 🔴        | `stuffer.rs:384-495`                 | ✅     |
| BUG-003  | Seed data доступна в production через `seed_test_data(force=true)`              | 🔴        | `commands/config.rs:62`              | ✅     |
| BUG-004  | Revealed карты не очищаются при lock (утечка расшифрованных данных)             | 🔴        | `store/cards.js:210`                 | ✅     |
| BUG-005  | Float окно не сбрасывает данные при logout                                      | 🟠        | `float.jsx:179`                      | ✅     |
| BUG-006  | UI store не сбрасывается при logout (утечка состояния между сессиями)           | 🟠        | `store/ui.js`                        | ✅     |
| BUG-007  | WS sync: TOCTOU race condition в проверке лицензии                              | 🟠        | `ws-tauri.js:110-130`                | ✅     |
| BUG-008  | WS sync: обновления без транзакций (partial state при crash)                    | 🟠        | `ws_sync.rs:200+`                    | ✅     |
| BUG-009  | WS sync: debounce full_pull не сбрасывается при reconnect                       | 🟡        | `ws_sync.rs:60`                      | ✅     |
| BUG-010  | Database pool не закрывается при exit (file locks на Windows)                   | 🟡        | `_core.rs:28`                        | ✅     |
| BUG-011  | Float window hide() вместо close() — процесс в памяти после exit                | 🟡        | `main.rs:160-195`                    | ✅     |
| BUG-012  | Body overflow не восстанавливается при внезапном unmount ImportModal            | 🟡        | `ImportModal.jsx:112-114`            | ✅     |
| BUG-013  | Set vs Array inconsistency: Profiles=Set, Cards=Array для selectedIds           | 🟡        | `Profiles.jsx:39-40`                 | ✅     |
| BUG-014  | Missing useCallback deps: stale closures в Cards handleSetSideCard              | 🟡        | `Cards.jsx:545`                      | ✅     |
| BUG-015  | Даты hardcoded 'ru-RU' — не учитывают locale пользователя                       | 🟡        | `Shops.jsx:44-50`, `MyStats.jsx`     | ✅     |
| BUG-012a | Body overflow: создан `useScrollLock` hook с ref-counting для вложенных модалей | 🟡        | `src/hooks/useScrollLock.js`         | ✅     |
| BUG-016  | CreateOrderModal: quickCreate race condition                                    | 🟡        | `CreateOrderModal.jsx`               | ✅     |
| BUG-017  | CSV Import: не валидирует пустой preview_rows                                   | 🟡        | `ImportModal.jsx:56-61`              | ✅     |
| BUG-018  | Risk scoring offline: RiskCheckOutcome::Offline не показывается пользователю    | 🟡        | `_orders.rs`, `CreateOrderModal.jsx` | ✅     |
| BUG-019  | ActionsMenu z-index может конфликтовать с модалями                              | 🟡        | `ActionsMenu.jsx:50-60`              | ✅     |
| BUG-020  | Config loading: нет warning если production конфиг не найден                    | 🟡        | `main.rs:96-110`                     | ✅     |
| BUG-021  | Float CopyBtn: race condition при множественных кликах (очередь toast)          | 🟢        | `float.jsx:30-45`                    | ✅     |
| BUG-022  | localStorage quota: нет retry и уведомления при overflow                        | 🟢        | `utils/localStorage.js:28-52`        | ✅     |

---

## 7. ТЕСТИРОВАНИЕ

| #        | Задача                                                                      | Приоритет | Файл(ы)                 | Статус   |
| -------- | --------------------------------------------------------------------------- | --------- | ----------------------- | -------- |
| TEST-001 | E2E: полный flow карта → заказ → отслеживание                               | 🟠        | `e2e/`                  | ✅       |
| TEST-002 | E2E: CRUD всех сущностей (Cards, Profiles, Orders, Shops)                   | 🟠        | `e2e/`                  | ✅       |
| TEST-003 | E2E: фильтрация и поиск                                                     | 🟡        | `e2e/`                  | ✅       |
| TEST-004 | E2E: импорт/экспорт                                                         | 🟡        | `e2e/`                  | ✅       |
| TEST-005 | E2E: Settings (язык, тема)                                                  | 🟡        | `e2e/`                  | ⬜       |
| TEST-006 | E2E: роли (admin vs operator)                                               | 🟡        | `e2e/`                  | 🔄 @main |
| TEST-007 | Rust: тесты для sync.rs и ws_sync.rs (0 тестов сейчас!)                     | 🟠        | `sync.rs`, `ws_sync.rs` | ✅       |
| TEST-008 | Rust: edge cases для encryption.rs (пустые данные, повреждённый шифротекст) | 🟡        | `encryption.rs`         | ✅       |
| TEST-009 | Rust: тесты parser.rs (разные форматы email)                                | 🟡        | `parser.rs`             | ✅       |
| TEST-010 | Rust: concurrent access rate_limiter.rs                                     | 🟡        | `rate_limiter.rs`       | ✅       |
| TEST-011 | Frontend: snapshot тесты для компонентов (Vitest)                           | 🟡        | `src/`                  | ✅       |
| TEST-012 | Frontend: тесты для clipboard.js, pagination.js, formatting.js, csv.js      | 🟡        | `src/utils/__tests__/`  | ✅       |
| TEST-013 | Performance: benchmark для БД с 100k карт (criterion)                       | 🟢        | `src-tauri/`            | ✅       |

---

## 8. DevOps и CI/CD

| #          | Задача                                                                    | Приоритет | Файл(ы)                        | Статус |
| ---------- | ------------------------------------------------------------------------- | --------- | ------------------------------ | ------ |
| DEVOPS-001 | Автоматическая сборка релизов: push тега → CI → артефакты → release notes | 🟡        | `build-release.yml`, `ship.py` | ✅     |
| DEVOPS-002 | Staging окружение: staging sync-сервер + процесс деплоя                   | 🟡        | `VaultBase.staging.toml`       | ⬜     |
| DEVOPS-003 | Crash-reporting (Sentry) — узнавать о падениях у пользователей            | 🟡        | Tauri Sentry plugin            | ⬜     |
| DEVOPS-004 | Autoupdate: проверить подпись на всех платформах                          | 🟡        | `tauri.conf.json`              | ✅     |
| DEVOPS-005 | Убрать DEV конфиги — всё всегда production                                | 🟡        | Все конфиги                    | ✅     |

---

## 9. ЧИСТКА КОДА

| #         | Задача                                                                         | Приоритет | Файл(ы)                                                 | Статус |
| --------- | ------------------------------------------------------------------------------ | --------- | ------------------------------------------------------- | ------ |
| CLEAN-001 | console.log → error: заменить на logger.js или убрать                          | 🟡        | ESLint config, все файлы                                | ✅     |
| CLEAN-002 | React Compiler: исправить 17 мест setState в useEffect + 7 ref в render        | 🟡        | ESLint warnings                                         | ✅     |
| CLEAN-003 | Удалить дубликаты документации (оставить 1 язык или настроить автоперевод)     | 🟢        | `AGENTS.md`, `README.md`, `PROJECT_STATUS.md`           | ⬜     |
| CLEAN-004 | Magic numbers → constants с комментариями                                      | 🟡        | `Cards.jsx:500`, `ws_sync.rs:20,60`, `background.rs:45` | ✅     |
| CLEAN-005 | `.env.example`: добавить USPS_API_USER_ID и другие undocumented vars           | 🟢        | `.env.example`                                          | ✅     |
| CLEAN-006 | PostCSS: добавить autoprefixer                                                 | 🟢        | `postcss.config.js`                                     | ✅     |
| CLEAN-007 | ESLint: убрать generic `eslint-disable-next-line` (указать конкретное правило) | 🟢        | Все файлы                                               | ✅     |
| CLEAN-008 | Deeply nested ternaries → object lookup для status colors                      | 🟢        | `DashboardRedesigned.jsx:650+`                          | ✅     |
| CLEAN-009 | Prop drilling в Cards: compound components pattern или Context для CardRow     | 🟡        | `Cards.jsx:950+`                                        | ⬜     |
| CLEAN-010 | virtualizer overscan: сделать конфигурируемым (не hardcoded 20)                | 🟢        | `Profiles.jsx:47`                                       | ⬜     |

---

## 10. i18n / ЛОКАЛИЗАЦИЯ

| #        | Задача                                                            | Приоритет | Файл(ы)                          | Статус        |
| -------- | ----------------------------------------------------------------- | --------- | -------------------------------- | ------------- |
| I18N-001 | float.jsx: hardcoded strings → i18n keys                          | 🟡        | `float.jsx`                      | ✅            |
| I18N-002 | Profiles.jsx: "No suitable free card found" → i18n                | 🟡        | `Profiles.jsx:320`               | ✅ (уже было) |
| I18N-003 | Dashboard: "Not enough data (need ≥3 orders)" → i18n              | 🟡        | `DashboardRedesigned.jsx:200`    | ✅            |
| I18N-004 | Orders "Batch Import", Cards "BIN Enrich" → i18n                  | 🟡        | `Orders.jsx:75`, `Cards.jsx:850` | ✅            |
| I18N-005 | Pluralization: `pluralize(count, ['заказ', 'заказа', 'заказов'])` | 🟡        | `src/utils/pluralize.js`         | ✅            |
| I18N-006 | Дата форматирование: динамический locale вместо hardcoded 'ru-RU' | 🟡        | `Shops.jsx:44`, `MyStats.jsx`    | ✅            |

---

## 11. БД — ЦЕЛОСТНОСТЬ И МИГРАЦИИ

| #      | Задача                                                              | Приоритет | Файл(ы)                       | Статус        |
| ------ | ------------------------------------------------------------------- | --------- | ----------------------------- | ------------- |
| DB-001 | Миграции: SAVEPOINT для каждой миграции (rollback при failure)      | 🟠        | `_migrations.rs:38-50`        | ✅            |
| DB-002 | Миграции: проверка downgrade safety (version check при старте)      | 🟡        | `_migrations.rs:25-40`        | ✅            |
| DB-003 | CHECK constraints для status колонок (orders, emails)               | 🟡        | `_migrations.rs`              | ✅            |
| DB-004 | Валидация shop domain (strip protocol, validate TLD)                | 🟡        | `_shops.rs`                   | ✅            |
| DB-005 | Email validation: разрешить `+` в local part                        | 🟡        | `src/utils/validation.js`     | ✅ (уже было) |
| DB-006 | Card import: валидация длины номера (не только Luhn)                | 🟡        | `parser.rs:200+`              | ✅            |
| DB-007 | BIN cache: UI кнопка для ручного refresh / invalidate               | 🟡        | `_cards.rs:477-485`, UI       | ✅            |
| DB-008 | Activity log: логировать failed операции (import, enrichment, sync) | 🟡        | `_migrations.rs`, `commands/` | ✅            |

---

## 12. ERROR HANDLING

| #       | Задача                                                      | Приоритет | Файл(ы)                    | Статус                             |
| ------- | ----------------------------------------------------------- | --------- | -------------------------- | ---------------------------------- |
| ERR-001 | Float ErrorBoundary (сейчас белый экран при ошибке)         | 🟠        | `float.jsx`                | ✅                                 |
| ERR-002 | Suspense + ErrorBoundary для lazy pages                     | 🟡        | `App.jsx:1287-1299`        | ✅ (уже было)                      |
| ERR-003 | Sync ошибки: показывать на всех страницах (не только Cards) | 🟡        | `App.jsx`, все страницы    | ✅                                 |
| ERR-004 | IMAP ошибки: emit event в React                             | 🟡        | `imap.rs`, `background.rs` | ✅ (imap_connection_alert + toast) |
| ERR-005 | Stuffer ошибки: humanize (HTTP коды → user-friendly текст)  | 🟡        | `errorHandler.js:155-175`  | ✅                                 |
| ERR-006 | Auto-retry для failed invoke() (с backoff)                  | 🟡        | `src/api/` (новый)         | ✅                                 |
| ERR-007 | Clipboard copy error: показывать toast в Float              | 🟢        | `float.jsx:50-80`          | ✅                                 |

---

## 13. НОВЫЕ БАГИ (финальный аудит)

### 13.1 Критические

| #         | Баг                                                                                                                                              | Приоритет | Файл(ы)                 | Статус |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ----------------------- | ------ |
| FINAL-001 | **Reveal card БЕЗ ВЛАДЕЛЬЦА** — если owner_id=NULL, проверка прав пропускается. Любой раскроет новую карту                                       | 🔴        | `commands/cards.rs:108` | ✅     |
| FINAL-002 | **UPS OAuth URL injection** — client_id/secret не URL-кодируются. Символы `&`/`=` в пароле ломают или расширяют запрос                           | 🔴        | `tracking.rs:298-300`   | ✅     |
| FINAL-003 | **Tracking cache cleanup НИКОГДА не срабатывает** — `len() % interval == 0` работает только при кратности. Cache растёт бесконечно (memory leak) | 🔴        | `tracking.rs:37`        | ✅     |
| FINAL-004 | **Orders store cache pollution** — нет лимита на количество ключей. При переборе 1000+ фильтров cache растёт неограниченно                       | 🔴        | `store/orders.js:69-77` | ✅     |

### 13.2 Важные

| #         | Баг                                                                                                       | Приоритет | Файл(ы)                     | Статус        |
| --------- | --------------------------------------------------------------------------------------------------------- | --------- | --------------------------- | ------------- |
| FINAL-005 | Catalog.jsx: `p ?? pageRef.current` — при p=0 (валидная страница) вернёт pageRef (nullish coalescing баг) | 🟠        | `Catalog.jsx:74-75`         | ✅            |
| FINAL-006 | Updates.jsx: sessionStorage ненадёжен — баннер обновления появляется снова после очистки                  | 🟠        | `Updates.jsx:229, 271`      | ✅            |
| FINAL-007 | Orders cache key JSON.stringify — не гарантирует детерминированность при null полях                       | 🟠        | `store/orders.js:69`        | ✅            |
| FINAL-008 | Tracking USPS: `.replace("{}", ...)` заменит ВСЕ вхождения. Нужно `replacen(..., 1)`                      | 🟠        | `tracking.rs:125`           | ✅            |
| FINAL-009 | cards.rs: raw SQL в update_card_status без проверки существования карты                                   | 🟠        | `commands/cards.rs:200-203` | ✅ (уже было) |
| FINAL-010 | Settings.jsx: setSeeding(false) может не выполниться при ошибке (вложенный try)                           | 🟠        | `Settings.jsx:290-308`      | ✅ (уже было) |
| FINAL-011 | errorHandler.js: новые permission не в PERMISSION_LABELS → undefined в UI                                 | 🟠        | `errorHandler.js:25-43`     | ✅            |
| FINAL-012 | background.rs: 3 копии tracking блока UPS/FedEx/USPS — DRY violation                                      | 🟠        | `background.rs:416-475`     | ✅            |
| FINAL-013 | useAuth.jsx: если localStorage полон при login, токен не сохранится. Молчаливый разлогин при reload       | 🟠        | `useAuth.jsx:17-18`         | ✅            |

### 13.3 Средние

| #         | Баг                                                                                     | Приоритет | Файл(ы)              | Статус |
| --------- | --------------------------------------------------------------------------------------- | --------- | -------------------- | ------ |
| FINAL-014 | Tracking cache mutex poisoned state — если поток паникнет, cache перестанет обновляться | 🟡        | `tracking.rs:33`     | ✅     |
| FINAL-015 | Background IMAP: молчаливый skip при опечатке в order_number из письма                  | 🟡        | `background.rs:195`  | ✅     |
| FINAL-016 | Activate.jsx: пустой installationId не обработан — пользователь не узнает об ошибке     | 🟡        | `Activate.jsx:36-37` | ✅     |

---

## ОБЩАЯ СТАТИСТИКА

| Категория      | Пунктов | Открыто |
| -------------- | ------- | ------- |
| 🔴 Критичный   | 25      | 0       |
| 🟠 Важный      | 46      | 0       |
| 🟡 Средний     | 101     | 17      |
| 🟢 Желательный | 19      | 7       |
| **ИТОГО**      | **191** | **24**  |

> Подсчитано по фактическим строкам таблиц (2026-08-28). Открытых 🟠 нет —
> MGR-013 (panic-пароль воркера + удалённый wipe) закрыт 2026-08-28.
> FEAT-006/007 и MGR-009 закрыты 2026-08-28.
> Текущее состояние работ и хендоф между сессиями — в
> [SESSION_LOG.md](SESSION_LOG.md), распределение по потокам — в
> [PARALLEL_WORK.md](PARALLEL_WORK.md).
