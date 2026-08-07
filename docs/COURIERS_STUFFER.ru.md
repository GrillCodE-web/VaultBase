# Курьеры / Посылки — интеграция со Stuffer

**Версия:** 2.5.0
**Статус:** реализовано (backend + UI)

> Русскоязычный дубль [COURIERS_STUFFER.md](COURIERS_STUFFER.md).
> Справочник API: [API_STUFFER.md](API_STUFFER.md).

Раздел «Курьеры / Посылки» интегрирует внешнюю панель **Stuffer**. Десктоп-приложение —
тонкий прокси в реальном времени: курьеры и посылки локально пока не сохраняются, запросы
к Stuffer API выполняются по требованию, ответ сразу отображается.

---

## Архитектура

```
React (Couriers.jsx)  ──invoke──►  Tauri-команды (main.rs)  ──►  stuffer.rs (ureq)  ──►  Stuffer API
        ▲                                   │                                                  │
        │                                   └── читает base_url + api_key из config (короткий лок БД)
        └──────────────────────────── JSON-ответ (курьеры / посылки / лейблы) ────────────────┘
```

- **`src-tauri/src/stuffer.rs`** — HTTP-клиент (`ureq`), serde-структуры, маппинг ошибок.
  Сетевые вызовы идут **вне** мьютекса БД; лок берётся только на чтение кредов.
- **`src-tauri/src/main.rs`** — Tauri-команды + проверка прав + запись в audit-log.
- **`src/pages/Couriers.jsx`** — три вкладки и форма создания посылки.

---

## Настройка

Задаётся в **Настройки → Stuffer API**:

| Поле        | Ключ config        | По умолчанию                                 |
| ----------- | ------------------ | -------------------------------------------- |
| Базовый URL | `stuffer_base_url` | `https://dash.stockhubdeal.com/api/stuffer/` |
| API-ключ    | `stuffer_api_key`  | — (секрет)                                   |

**Безопасность:**

- API-ключ хранится в таблице `config` и считается секретом.
- Его **нет** в whitelist `CONFIG_READABLE` — общий `get_config` его не читает, доступ
  только из backend-кода.
- `stuffer_get_config` возвращает только `{ api_key_set: bool, base_url }` — не сам ключ.
- Пустое поле ключа при сохранении оставляет ранее сохранённый ключ.

---

## Tauri-команды

| Команда                           | Право             | Метод Stuffer                     |
| --------------------------------- | ----------------- | --------------------------------- |
| `stuffer_get_config`              | —                 | (локальный просмотр конфига)      |
| `stuffer_set_config`              | `manage_couriers` | (локальная запись конфига)        |
| `stuffer_list_couriers`           | `view_couriers`   | `GET ?json=couriers`              |
| `stuffer_list_available_couriers` | `view_couriers`   | `GET ?json=available_couriers`    |
| `stuffer_add_courier`             | `manage_couriers` | `POST ?json=add_courier`          |
| `stuffer_list_packages`           | `view_packages`   | `GET ?json=packages`              |
| `stuffer_get_labels`              | `view_packages`   | `GET ?json=labels&package_id=...` |
| `stuffer_create_package`          | `create_packages` | `POST ?json=new_package`          |

Имена аргументов — в camelCase Tauri (напр. `courierId`, `packageId`, `package`).

### Права (`models.rs`)

- `view_couriers`, `view_packages`, `create_packages` — операторам по умолчанию.
- `manage_couriers` (добавление курьеров, сохранение конфига API) — admin или явное право.

---

## UI (`src/pages/Couriers.jsx`)

- **Мои курьеры** — назначенные курьеры (имя, статус, адрес, срок, счётчики посылок).
- **Доступные** — курьеры для добавления; «Добавить курьера» вызывает `stuffer_add_courier`.
- **Посылки** — до 500 последних посылок; «Этикетки» открывает модал для просмотра и
  скачивания каждого лейбла в PDF (base64 → Blob). «Новая посылка» открывает форму.
- Форма создания соответствует payload `new_package` (курьер, название, получатель, вес,
  количество, магазин, цена, дата доставки, способ оплаты, ASIN, UPC, комментарий и
  повторяемый список трек/перевозчик).

Навигация, под-вкладки (`assigned` / `available` / `packages`) и ленивый импорт — в `App.jsx`.

---

## Обработка ошибок

`stuffer.rs` маппит сбои в стабильные строковые коды для UI:

- `stuffer_not_configured` — не задан API-ключ.
- `stuffer_network_error` — сбой транспорта.
- `stuffer_http_<code>` — не-JSON HTTP-ошибка.
- `stuffer_api_error[:<code>]: <msg>` — Stuffer вернул `{"error": ...}`.
- `stuffer_missing_field` / `stuffer_parse_error` / `stuffer_decode_error` — неожиданное тело.

---

## Статус проверки

- **Read-only методы проверены на реальном Stuffer API** (2026-08-06):
  `couriers` (16 записей), `available_couriers` (840), `packages` (41). Всё распарсилось
  корректно; serde-структуры совпадают с реальными ответами (лишнее поле
  `comments[].sender_name` от сервера безопасно игнорируется).
- **Пишущие методы вживую не гонялись:** `add_courier` и `new_package` проверены только
  по документированному контракту запрос/ответ (тестовых мутаций не отправлялось).
- Также зелёные: `cargo check`, `npm run lint`, `vite build`, `vitest` 317/317.

## Что ещё не сделано

- Живой прогон пишущих методов (`add_courier`, `new_package`) с реальной мутацией.
- Опциональный локальный кэш курьеров/посылок в БД.
- Опциональная привязка курьера к профилю и посылки к локальному заказу (обоснование
  раздельного хранения: [DESIGN_MACOS_PLAN.md](../DESIGN_MACOS_PLAN.md) §13).
- **PPTP API** — добавить по аналогии, когда появится документация.
