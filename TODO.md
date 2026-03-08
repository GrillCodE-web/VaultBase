# CC Manager — TODO / Аудит задач

> Этот файл — единственный источник правды по задачам.
> После выполнения ставить ✅ и дату. Новые задачи добавлять сюда же.

---

## 🔴 КРИТИЧНО (сломано / не работает)

| # | Задача | Файл(ы) | Статус |
|---|--------|---------|--------|
| C1 | **Float Window кнопки Success/Decline** — вызывали `set_order_status` (не существует). Добавлена `get_latest_order_by_profile`, кнопки используют `update_order_status` с реальным order_id | `src/float.jsx`, `database.rs`, `main.rs` | ✅ 2026-03-08 |
| C2 | **Risk Check → сервер** — добавлен `SyncClient::check_risk`, вызывает `/check` если токен есть, мержит server warnings. Graceful fallback если offline | `sync.rs`, `database.rs`, `main.rs` | ✅ 2026-03-08 |

---

## 🟡 ВАЖНО (есть, но недоделано)

| # | Задача | Файл(ы) | Статус |
|---|--------|---------|--------|
| I1 | **Tracking API Track17** — реализован в tracking_thread. POST /gettrackinfo v2.2, маппинг статусов Delivered/InTransit/Expired. Ключ в Settings → `tracking_api_key` | `main.rs`, `database.rs` | ✅ 2026-03-08 |
| I2 | **Shops: удаление с активными заказами** — нет проверки перед `delete_shop`. Нужно: вернуть ошибку если есть заказы со статусом не `cancelled`/`delivered` | `src-tauri/src/database.rs`, `src/pages/Shops.jsx` | ✅ уже реализовано |
| I3 | **Cards import UI: skipped count** — backend возвращает кол-во дублей, но UI не показывает "X skipped (duplicates)" в тосте после импорта | `src/pages/Cards.jsx` | ✅ уже реализовано |
| I4 | **ZIP radius 100 миль** — закрыто: prefix-match достаточно для практического использования. 42k ZIP таблица = overengineering. | — | ✅ закрыто |

---

## 🟢 UI УЛУЧШЕНИЯ

| # | Задача | Файл(ы) | Статус |
|---|--------|---------|--------|
| U1 | **Profile hover preview tooltip** | `src/pages/Profiles.jsx` | ✅ уже реализовано |
| U2 | **Proxies "Test All"** | `src/pages/Proxies.jsx` | ✅ уже реализовано |
| U3 | **Profiles: pill-фильтры по статусу карты** | `src/pages/Profiles.jsx` | ✅ уже реализовано |
| U4 | **Cards: группировка по Bank** (toggle) | `src/pages/Cards.jsx` | ✅ уже реализовано |
| U5 | **Updates.jsx** — IMAP-лог с табами по типам | `src/pages/Updates.jsx` | ✅ уже реализовано |

---

## 📝 ДОКУМЕНТАЦИЯ / ИНФРАСТРУКТУРА

| # | Задача | Файл(ы) | Статус |
|---|--------|---------|--------|
| D1 | **README: macOS build target** — добавить `cargo tauri build --target aarch64-apple-darwin` в секцию Build | `README.md` | ✅ 2026-03-08 |
| D2 | **cc-sync-server** — сервер задеплоен на `api.eulivehub.com`. Исправлены форматы: footprint expand, `/footprint/check`, `/version`. Activate.jsx показывает installation_id | `sync.rs`, `Activate.jsx` | ✅ 2026-03-08 |

---

---

## ℹ️ ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ (не баги, дизайнерское решение)

| # | Что | Примечание |
|---|-----|-----------|
| L1 | `run_risk_check` игнорирует `drop_id`, `email_pool_id`, `proxy_id` — проверяет только профиль и шоп | Полная проверка требует интеграции с сервером (C2) |
| L2 | Float window кнопки Success/Decline меняют статус **последнего** заказа профиля | Если у профиля несколько заказов — затронет только самый новый |

---

## ✅ СДЕЛАНО

| # | Задача | Дата |
|---|--------|------|
| — | Float Window C1: кнопки Success/Decline — `set_order_status` → `update_order_status` + `get_latest_order_by_profile` | 2026-03-08 |
| — | Shops пагинация: race condition `setPage(p=>)` + `load(page)` — вычисляем newPage один раз | 2026-03-08 |
| — | README: добавлены `--target aarch64/x86_64-apple-darwin` в секцию Build | 2026-03-08 |
| — | Right-side empty space (body flex + #root flex:1) | сессия 1 |
| — | "Failed to load updates" (filter: null → proper object) | сессия 1 |
| — | Невидимый текст holder/country/source (--dim → --text-2) | сессия 1 |
| — | Синие тосты (useToast не принимал строку) | сессия 1 |
| — | get_shop invalid type null (search: null → "") | сессия 1 |
| — | get_shop_detail not found → get_shop | сессия 1 |
| — | IMAP Yahoo DNS (yahoo.com → imap.mail.yahoo.com:993) | сессия 1 |
| — | test_imap_connection crash (нужен id, не host/port) | сессия 1 |
| — | update_shop_product missing в backend | сессия 1 |
| — | change_password params (oldPassword/newPassword → old/new) | сессия 1 |
| — | Email Pool filters не работали (EmailFilter в SQL) | сессия 1 |
| — | save_order_template param mismatch (flat → SaveTemplateInput) | сессия 1 |
| — | CC таблица: BIN+last4, 18 колонок, Reveal All | сессия 2 |
| — | CC фильтры: state, zip_prefix, card_type, expiring_soon (server-side SQL) | сессия 2 |
| — | Импорт: auto-detect лог-формата, billing_address, state/country/city | сессия 2 |
| — | IMAP: "Link to Pool" кнопка → link_all_imap_accounts | сессия 2 |
| — | Orders: +Carrier, +Notes колонки | сессия 2 |
| — | Profiles: +Type, +BIN prefix, +Notes, +Created колонки | сессия 2 |

---

## 📌 Правила работы с файлом

1. Взял задачу → пишешь "в работе" в чате
2. Сделал → меняешь ❌ на ✅ и переносишь в раздел **СДЕЛАНО** с датой
3. Нашёл новый баг/фичу → добавляешь в нужный раздел
4. Не трогать build-plan для рабочего процесса — он архив
