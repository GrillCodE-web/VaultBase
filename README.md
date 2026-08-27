<div align="center">

# VaultBase

**Защищённый десктоп для управления картами, профилями, заказами, магазинами,
прокси и почтой — плюс второе приложение для менеджера команды.**

![License](https://img.shields.io/badge/license-proprietary-red)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Tauri 2](https://img.shields.io/badge/Tauri-2.0-24C8D8)
![Rust](https://img.shields.io/badge/Rust-backend-DEA584)
![React 18](https://img.shields.io/badge/React-18-61DAFB)
![DB](https://img.shields.io/badge/DB-SQLite%20%2B%20SQLCipher-003B57)
![Tests](https://img.shields.io/badge/tests-475%20passing-brightgreen)
![E2E](https://img.shields.io/badge/e2e-84%20specs-brightgreen)
![i18n](https://img.shields.io/badge/i18n-RU%20%7C%20EN-3178C6)

**[Скриншоты](#скриншоты)** ·
**[Два приложения](#два-приложения)** ·
**[Карта разделов](#карта-разделов)** ·
**[Быстрый старт](#быстрый-старт)** ·
**[Архитектура](#архитектура)** ·
**[Проверки](#проверки-и-качество)** ·
**[Документация](#документация)**

</div>

---

Локальная БД с полным шифрованием (SQLCipher), вход по лицензии + мастер-пароль
(PBKDF2 600k), AES-256-GCM для чувствительных полей, E2E-шифрованная синхронизация
между устройствами через собственный sync-сервер. Два приложения в одном репозитории:
**воркер** (рабочее место оператора) и **VaultBase Manager** (управление командой,
политиками и телеметрией). Tauri-команд: 206 · unit-тесты: 327 (JS) + 148 (Rust) ·
e2e: 84 спека · i18n: RU/EN.

---

## Скриншоты

Все снимки генерируются автоматически — [`scripts/visual-audit.mjs`](scripts/visual-audit.mjs)
крутит оба приложения в Playwright с мок-данными и складывает снимки в репозиторий.
Полные наборы: **[воркер — 19 страниц](docs/screenshots/worker)** ·
**[менеджер — 14 экранов](docs/screenshots/manager)**.

| Воркер                                                                                                                                                                                          | VaultBase Manager                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a href="docs/screenshots/worker/nav-01-dashboard.png"><img src="docs/screenshots/worker/nav-01-dashboard.png" width="420" alt="Дашборд воркера"></a><br>**Дашборд** — сводка, графики, heatmap | <a href="docs/screenshots/manager/04-dashboard.png"><img src="docs/screenshots/manager/04-dashboard.png" width="420" alt="Дашборд менеджера"></a><br>**Дашборд** — команда и телеметрия   |
| <a href="docs/screenshots/worker/nav-03-cards.png"><img src="docs/screenshots/worker/nav-03-cards.png" width="420" alt="Карты"></a><br>**Карты** — импорт, фильтры, BIN                         | <a href="docs/screenshots/manager/05-workers.png"><img src="docs/screenshots/manager/05-workers.png" width="420" alt="Работники и политики"></a><br>**Работники** — политики, баны, квоты |
| <a href="docs/screenshots/worker/nav-05-orders.png"><img src="docs/screenshots/worker/nav-05-orders.png" width="420" alt="Заказы"></a><br>**Заказы** — статусы, трекинги                        | <a href="docs/screenshots/manager/06-analytics.png"><img src="docs/screenshots/manager/06-analytics.png" width="420" alt="Аналитика"></a><br>**Аналитика** — BIN, шопы, дропы             |
| <a href="docs/screenshots/worker/nav-18-dark.png"><img src="docs/screenshots/worker/nav-18-dark.png" width="420" alt="Тёмная тема"></a><br>**Тёмная тема** и EN-локаль                          | <a href="docs/screenshots/manager/08-alerts.png"><img src="docs/screenshots/manager/08-alerts.png" width="420" alt="Алерты"></a><br>**Алерты** — числовые правила                         |

---

<a name="два-приложения"></a>

## Два приложения

### 🖥 Воркер — рабочее место оператора

Карты, профили с дропами, заказы с трекингами, каталог, магазины с риск-скорингом,
пул прокси, интеграция Stuffer API, IMAP-мониторинг почты, журнал активности,
статистика команды. [Все 19 страниц →](docs/screenshots/worker)

### 🛡 VaultBase Manager — управление командой

Дашборд, работники и политики (бан, force_logout, минимальная версия,
переопределение прав, дневные квоты), аналитика по BIN/шопам/дропам,
новости, алерты с правилами, приоритеты шопов, управление обновлениями.
Отчёты воркеров приходят «запечатанными конвертами»
(X25519 → HKDF → AES-256-GCM) — расшифровать их может только менеджер.
[Все 14 экранов →](docs/screenshots/manager)

---

## Карта разделов

| Раздел                | Что делает                                                                       | Код                                                            |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Dashboard**         | Сводка: карты, заказы, выручка, алерты, графики, heatmap банк×магазин            | [`DashboardRedesigned.jsx`](src/pages/DashboardRedesigned.jsx) |
| **Updates**           | «Пока вы спали» — события из почты: новые треки, доставки, отмены                | [`Updates.jsx`](src/pages/Updates.jsx)                         |
| **Cards**             | База карт: импорт, фильтры, статусы (free/in_use/dead), BIN-энричмент, экспорт   | [`Cards.jsx`](src/pages/Cards.jsx)                             |
| **Profiles**          | Профили = карта + получатель + адрес. Дропы живут внутри профиля                 | [`Profiles.jsx`](src/pages/Profiles.jsx)                       |
| **Orders**            | Заказы: статусы, трекинги, batch-импорт, повтор заказа                           | [`Orders.jsx`](src/pages/Orders.jsx)                           |
| **Catalog**           | Каталог товаров и магазинов-источников (заполняется при синхронизации)           | [`Catalog.jsx`](src/pages/Catalog.jsx)                         |
| **Shops**             | Магазины: флаги риска (AVS/VPN/AMEX), win/loss, success rate, risk-скоринг       | [`Shops.jsx`](src/pages/Shops.jsx)                             |
| **Proxies**           | Пул прокси: проверка живости, привязка к магазинам, статистика использования     | [`Proxies.jsx`](src/pages/Proxies.jsx)                         |
| **Couriers/Packages** | Интеграция со Stuffer API: курьеры и посылки                                     | [`Couriers.jsx`](src/pages/Couriers.jsx)                       |
| **IMAP**              | Почтовые аккаунты: мониторинг писем, парсинг треков/подтверждений, SMTP-отправка | [`Imap.jsx`](src/pages/Imap.jsx)                               |
| **Activity Log**      | Журнал всех действий в системе (аудит)                                           | [`ActivityLog.jsx`](src/pages/ActivityLog.jsx)                 |
| **Users**             | (admin) Пользователи, роли, сессии, статистика команды                           | [`UsersPage.jsx`](src/pages/UsersPage.jsx)                     |
| **My Stats**          | (operator) Личная статистика оператора                                           | [`MyStats.jsx`](src/pages/MyStats.jsx)                         |
| **Settings**          | Лицензия, тема, язык, авто-блокировка, BIN API, Stuffer API, БД, синк            | [`Settings.jsx`](src/pages/Settings.jsx)                       |

Скрытые/служебные страницы: [`Login.jsx`](src/pages/Login.jsx) (мастер-пароль, экран
бана/блокировки), [`UserLogin.jsx`](src/pages/UserLogin.jsx), [`Activate.jsx`](src/pages/Activate.jsx)
(активация лицензии), [`Onboarding.jsx`](src/pages/Onboarding.jsx) и
[`float.jsx`](src/float.jsx) — отдельное плавающее окно профиля (`float.html`).
Менеджер: [`manager-app/src/`](manager-app/src/) — свой набор страниц.

---

## Быстрый старт

```bash
npm install            # зависимости
npm run dev            # Vite dev-сервер :5173 (UI без десктоп-обвязки)
npx tauri dev          # полное приложение (Rust + WebView)
npm run tauri build    # продакшн-инсталляторы -> src-tauri/target/release/bundle/
```

Менеджер — отдельное приложение в этом же репозитории: [`manager-app/`](manager-app/)
(свой `npm run dev`, свой Tauri-процесс и своя SQLCipher-база).

## Проверки и качество

| Проверка                    | Команда                            | Результат                    |
| --------------------------- | ---------------------------------- | ---------------------------- |
| ESLint                      | `npm run lint`                     | 0 ошибок                     |
| Unit-тесты (JS)             | `npx vitest run`                   | 327 passing                  |
| Unit-тесты (Rust)           | `cargo test` (в `src-tauri`)       | 148 passing                  |
| E2E (Playwright, мок Tauri) | `npm run test:e2e`                 | 84 спека, chromium + firefox |
| Аудит дрейфа CSS/i18n       | `python scripts/audit_frontend.py` | 0 orphan / 0 phantom         |
| Visual-аудит всех страниц   | `node scripts/visual-audit.mjs`    | 33 снимка, 0 ошибок консоли  |

Дальше это гоняет CI: подпись автообновлений, production-профиль релизов,
dependabot по npm/cargo/actions.

## Архитектура

```
VaultBase/
├── src/                  # Фронтенд воркера (React 18 + Vite)
│   ├── pages/            # Страницы — см. карту разделов выше
│   ├── components/       # Общие: Modal, EmptyState, ErrorBoundary, skeletons...
│   ├── store/            # Сторы (cards, orders) — кэш и состояние списков
│   ├── api/              # Тонкие обёртки над Tauri-командами
│   ├── hooks/            # useAuth, useLang, useKeyboardShortcuts, useUndo...
│   ├── i18n/             # en.js / ru.js — 530+ ключей, t(key, {params})
│   └── styles/           # 7 файлов: tokens.css, base, layout, components, pages
├── src-tauri/            # Бэкенд воркера (Rust)
│   └── src/
│       ├── commands/     # 206 Tauri-команд по доменам (cards, orders, imap, telemetry...)
│       ├── database/     # SQLite/SQLCipher: _cards, _orders, _analytics, _shops...
│       ├── encryption.rs # AES-256-GCM полей, обёртки ключей
│       └── sync.rs / ws_sync.rs  # HTTP + WebSocket синхронизация
├── manager-app/          # VaultBase Manager — второе приложение (React + Rust)
├── cc-sync-server/       # Собственный WebSocket sync-сервер (Node.js) + docs/API.md
├── e2e/                  # Playwright-тесты с моком Tauri (setup/tauri-mock.js)
├── scripts/              # audit_frontend.py, visual-audit.mjs, release-скрипты
└── docs/                 # Справочники: [индекс](docs/README.md)
```

**Поток данных:** `UI → Tauri-команда → Rust → SQLite (SQLCipher) → ответ → стор`.

**Безопасность:** вся БД под SQLCipher; чувствительные поля — AES-256-GCM; ключ выводится
из мастер-пароля PBKDF2 600k и живёт только в памяти (зануляется при блокировке);
sync-трафик шифруется сквозным шифрованием, телеметрия менеджеру — «запечатанными
конвертами» X25519 → HKDF → AES-GCM; политика менеджера (бан, force_logout,
минимальная версия, override прав, квоты) применяется воркером живьём.

**Вход:** лицензия (challenge → activation key через sync-сервер) → мастер-пароль →
автовход в соло-режиме. Роль admin/operator приходит с лицензией.

## Конфигурация

Профили `VaultBase.dev.toml` / `.staging.toml` / `.production.toml` — порты,
sync-сервер, логирование. Подробно: [docs/CONFIGURATION.md](docs/CONFIGURATION.md),
[docs/CONSTANTS.md](docs/CONSTANTS.md).

## Документация

| Документ                                              | Что внутри                                         |
| ----------------------------------------------------- | -------------------------------------------------- |
| [AGENTS.md](AGENTS.md) / [AGENTS.ru.md](AGENTS.ru.md) | Правила разработки и для ИИ-агентов (EN/RU)        |
| [MASTER_CHECKLIST.md](MASTER_CHECKLIST.md)            | Живой чеклист задач — 184 пункта со статусами      |
| [PARALLEL_WORK.md](PARALLEL_WORK.md)                  | Протокол параллельных агентских сессий (worktrees) |
| [CHANGELOG.md](CHANGELOG.md)                          | История версий + [Unreleased]: сводка спринта      |
| [docs/README.md](docs/README.md)                      | Индекс всех справочников                           |
| [MANAGER_APP.md](docs/MANAGER_APP.md)                 | Архитектура VaultBase Manager и телеметрии         |

---

<div align="center">

**VaultBase** · проприетарная лицензия — все права защищены

Tauri 2 · Rust · React 18 · SQLite/SQLCipher · Node.js sync-сервер

</div>
