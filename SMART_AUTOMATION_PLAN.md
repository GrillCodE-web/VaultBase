# 🧠 CC Manager — Smart Automation & Collective Mind Plan

**Дата создания:** 2026-03-24
**Статус:** 🔄 IN PROGRESS
**Приоритет:** HIGH

---

## 📊 АНАЛИЗ ТЕКУЩЕЙ СИСТЕМЫ

### ✅ Что уже работает

| Компонент               | Статус      | Описание                                      |
| ----------------------- | ----------- | --------------------------------------------- |
| **Footprint Sync**      | ✅ Работает | Отправка hash'ей на сервер каждые 2 мин       |
| **Risk Check**          | ✅ Работает | Проверка BIN/email/drop перед заказом         |
| **17track Integration** | ✅ Работает | Авто-обновление статусов (batch по 40)        |
| **IMAP Auto-detect**    | ✅ Работает | Извлечение tracking из писем (UPS/FedEx/USPS) |
| **Shop Stats**          | ✅ Работает | success_rate, delivered, declined, pending    |
| **Smart Suggestions**   | ✅ Работает | Подсказки для shop+card комбинаций            |

### ❌ Пробелы архитектуры

1. **Нет координации между threads** — каждый живёт отдельно
2. **Нет global automation config** — все значения hardcoded
3. **Footprint не учитывает order_status** — отправляется без статуса заказа
4. **Нет unique_users counting** — 1 юзер 10 раз = 10 разных юзеров
5. **Нет weighting по времени** — старые данные = новые данные
6. **BIN отправляется plaintext** — не hash
7. **Нет admin web dashboard** — не видно глобальной статистики

---

## 🎯 ЦЕЛИ SMART AUTOMATION

### 1. Collective Mind V2 (Global Intelligence)

**Задача:** Превратить footprint sync в систему коллективного разума

**Что будет:**

- ✅ Отправка `order_status` с каждым footprint
- ✅ Уникальные пользователи (installation_id_hash)
- ✅ Раздельная статистика: delivered vs declined
- ✅ Weighted risk score (с учётом времени)
- ✅ Insight generation для пользователей

**Результат:**

```
User проверяет BIN @ shop → получает:
"BIN has 80% success rate across 8 users — SAFE"
или
"Email has 100% decline rate across 3 users — BURNED, avoid!"
```

---

### 2. Shop Statistics Enhancement (Local + Global)

**Задача:** Полная статистика по каждому магазину

**Текущее (уже есть):**

```rust
ShopStats {
    total: i64,
    pending: i64,
    processing: i64,
    shipped: i64,
    delivered: i64,
    declined: i64,
    cancelled: i64,
    success_rate: f64,
    decline_rate: f64,
    avg_order_value: f64
}
```

**Нужно добавить:**

```rust
ShopStatsV2 {
    // Существующие поля
    ...

    // НОВОЕ: по типам carriers
    ups_orders: i64,
    fedex_orders: i64,
    usps_orders: i64,

    // НОВОЕ: временные периоды
    last_7_days: OrderPeriodStats,
    last_30_days: OrderPeriodStats,

    // НОВОЕ: unique пользователи
    unique_users_30d: i64,

    // НОВОЕ: средний срок доставки
    avg_delivery_days: f64,

    // НОВОЕ: global stats (с сервера)
    global_success_rate: f64,
    global_unique_users: i64,
    global_risk_level: String,
}
```

---

### 3. Tracking API Integration (UPS/FedEx/USPS)

**Задача:** Прямая интеграция с carrier API (в дополнение к 17track)

**Текущее:**

- 17track API (batch по 40, каждые 30 мин)
- IMAP extraction (из писем)

**Нужно:**

```rust
// Прямые API
pub fn check_ups_tracking(tracking: &str) -> Result<TrackingStatus, String>;
pub fn check_fedex_tracking(tracking: &str) -> Result<TrackingStatus, String>;
pub fn check_usps_tracking(tracking: &str) -> Result<TrackingStatus, String>;

// Smart routing
pub fn check_tracking_smart(tracking: &str) -> Result<TrackingStatus, String> {
    // Определяем carrier по формату
    if tracking.starts_with("1Z") { return check_ups(tracking); }
    if tracking.len() == 12 || tracking.len() == 15 { return check_fedex(tracking); }
    if tracking.starts_with("9") { return check_usps(tracking); }

    // Fallback на 17track
    check_17track(tracking)
}
```

---

### 4. Admin Web Dashboard (Global Statistics)

**Задача:** Админ-панель для просмотра глобальной статистики

**Страницы:**

#### 4.1 Dashboard (Overview)

```
┌─────────────────────────────────────────────────────────────┐
│  CC Manager — Admin Dashboard                               │
├─────────────────────────────────────────────────────────────┤
│  👥 Users: 1,247  │  🏪 Shops: 342  │  📦 Orders: 45,892   │
│  ✅ Delivered: 32,451 (70.7%)  │  ❌ Declined: 8,234 (17.9%)│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Top Problem Shops (last 7 days)                            │
├─────────────────────────────────────────────────────────────┤
│  1. new-shop.com     │  🔴 85% decline  │  234 orders      │
│  2. sketchy-retail.co│  🟡 45% decline  │  89 orders       │
│  3. fake-luxury.net  │  🟡 38% decline  │  56 orders       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Burned BINs (mass detection)                               │
├─────────────────────────────────────────────────────────────┤
│  542198 │ 🔴 92% decline @ 12 shops │ 47 users affected    │
│  412876 │ 🟡 67% decline @ 5 shops  │ 23 users affected    │
└─────────────────────────────────────────────────────────────┘
```

#### 4.2 Shops Detail

```
┌─────────────────────────────────────────────────────────────┐
│  Shop: nike.com                                              │
├─────────────────────────────────────────────────────────────┤
│  📊 Global Stats                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Total Orders: 12,453  │  Unique Users: 3,241         │   │
│  │ Delivered: 9,234 (74.1%)  │  Declined: 2,456 (19.7%) │   │
│  │ Avg Delivery: 4.2 days  │  Risk Level: 🟢 LOW        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  📈 Stats by Carrier                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ UPS:   4,234 orders (76% success)                    │   │
│  │ FedEx: 3,892 orders (72% success)                    │   │
│  │ USPS:  2,123 orders (78% success)                    │   │
│  │ Unknown: 2,204 orders                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  🔥 Burned Patterns                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Email hash e5a2f...: 100% decline (5 users) 🔴       │   │
│  │ BIN 542198: 15% decline (23 users) 🟡                │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 4.3 Users (Installation Stats)

```
┌─────────────────────────────────────────────────────────────┐
│  User: installation_abc123                                   │
├─────────────────────────────────────────────────────────────┤
│  📊 Activity                                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ First Seen: 2026-01-15  │  Last Active: 2026-03-24   │   │
│  │ Total Orders: 234  │  Success Rate: 68%              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  🏪 Shops Used (top 5)                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ nike.com: 45 orders (82% success) ✅                 │   │
│  │ amazon.com: 38 orders (71% success) ✅               │   │
│  │ ebay.com: 29 orders (45% success) ⚠️                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  💳 Cards Used                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ BIN 542198: 89 orders (65% success)                  │   │
│  │ BIN 412876: 67 orders (72% success)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### 4.4 Footprints (Global Search)

```
┌─────────────────────────────────────────────────────────────┐
│  Footprint Search                                            │
├─────────────────────────────────────────────────────────────┤
│  Search: [hash_value or shop_domain]           [🔍 Search]  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Results for: nike.com                                       │
├─────────────────────────────────────────────────────────────┤
│  Hash Type  │  Hash Value  │  Count  │  Success  │  Risk   │
├─────────────────────────────────────────────────────────────┤
│  BIN        │  542198      │  1,234  │  85%      │  🟢 LOW │
│  BIN        │  412876      │  892    │  45%      │  🟡 MED │
│  Email      │  e5a2f...    │  567    │  12%      │  🔴 HIGH│
│  Drop       │  d4e8f...    │  234    │  67%      │  🟡 MED │
└─────────────────────────────────────────────────────────────┘
```

---

### 5. App Enhancement (In-App Statistics)

**Задача:** Улучшить отображение статистики в приложении

#### 5.1 Shops Page Enhancement

**Текущее:**

```jsx
<ShopRow>
  <td>{shop.name}</td>
  <td>{shop.success_rate}%</td>
  <td>
    <ShopRiskBadge shopId={shop.id} />
  </td>
</ShopRow>
```

**Нужно:**

```jsx
<ShopRow>
  <td>{shop.name}</td>

  {/* Расширенная статистика */}
  <td>
    <ShopStatsCell
      total={shop.total_orders}
      delivered={shop.delivered}
      declined={shop.declined}
      processing={shop.processing}
      shipped={shop.shipped}
      cancelled={shop.cancelled}
    />
  </td>

  {/* По типам carriers */}
  <td>
    <CarrierStats ups={shop.ups_orders} fedex={shop.fedex_orders} usps={shop.usps_orders} />
  </td>

  {/* Global stats с сервера */}
  <td>
    <GlobalShopStats shopId={shop.id} />
  </td>

  {/* Risk badge */}
  <td>
    <ShopRiskBadge shopId={shop.id} />
  </td>
</ShopRow>
```

#### 5.2 Order Row Enhancement

**Добавить:**

- Carrier detection (UPS/FedEx/USPS иконка)
- Tracking status timeline
- Auto-update indicator

```jsx
<OrderRow>
  {/* Carrier иконка */}
  <td>
    <CarrierIcon tracking={order.tracking_number} />
  </td>

  {/* Tracking timeline */}
  <td>
    <TrackingTimeline
      tracking={order.tracking_number}
      status={order.status}
      updatedAt={order.updated_at}
    />
  </td>

  {/* Auto-update badge */}
  {order.auto_updated && (
    <td>
      <Badge tooltip="Auto-updated via tracking">🤖</Badge>
    </td>
  )}
</OrderRow>
```

---

## 📋 ПЛАН РЕАЛИЗАЦИИ

### PHASE 1: Footprint Sync V2 (Collective Mind)

**Срок:** 2-3 дня
**Приоритет:** 🔴 HIGH

| #   | Задача                                              | Файлы       | Сложность | Статус |
| --- | --------------------------------------------------- | ----------- | --------- | ------ |
| 1.1 | Добавить `order_status` колонку в `shop_footprints` | database.rs | Low       | ⬜     |
| 1.2 | Обновить `save_footprint` с передачей статуса       | database.rs | Low       | ⬜     |
| 1.3 | Добавить `installation_id_hash` в footprint payload | sync.rs     | Low       | ⬜     |
| 1.4 | Server: раздельная статистика (delivered/declined)  | server      | High      | ⬜     |
| 1.5 | Server: weighted risk score algorithm               | server      | High      | ⬜     |
| 1.6 | Server: insight generation                          | server      | Medium    | ⬜     |
| 1.7 | Обновить `check_risk_detailed` для V2 ответа        | sync.rs     | Medium    | ⬜     |
| 1.8 | UI: отображение insight в RiskBlock                 | Orders.jsx  | Medium    | ⬜     |

---

### PHASE 2: Shop Statistics Enhancement

**Срок:** 1-2 дня
**Приоритет:** 🟡 MEDIUM

| #   | Задача                                         | Файлы       | Сложность | Статус |
| --- | ---------------------------------------------- | ----------- | --------- | ------ |
| 2.1 | Добавить carrier_type в orders таблицу         | database.rs | Low       | ⬜     |
| 2.2 | Функция `get_shop_stats_by_carrier(shop_id)`   | database.rs | Medium    | ⬜     |
| 2.3 | Функция `get_shop_period_stats(shop_id, days)` | database.rs | Medium    | ⬜     |
| 2.4 | Функция `get_unique_users_for_shop(shop_id)`   | database.rs | Medium    | ⬜     |
| 2.5 | Функция `get_avg_delivery_days(shop_id)`       | database.rs | Low       | ⬜     |
| 2.6 | UI: ShopStatsCell компонент                    | Shops.jsx   | Medium    | ⬜     |
| 2.7 | UI: CarrierStats компонент                     | Shops.jsx   | Low       | ⬜     |

---

### PHASE 3: Tracking API Direct Integration

**Срок:** 2-3 дня
**Приоритет:** 🟡 MEDIUM

| #   | Задача                                         | Файлы       | Сложность | Статус |
| --- | ---------------------------------------------- | ----------- | --------- | ------ |
| 3.1 | UPS API integration (`check_ups_tracking`)     | tracking.rs | Medium    | ⬜     |
| 3.2 | FedEx API integration (`check_fedex_tracking`) | tracking.rs | Medium    | ⬜     |
| 3.3 | USPS API integration (`check_usps_tracking`)   | tracking.rs | Medium    | ⬜     |
| 3.4 | Smart routing функция (`check_tracking_smart`) | tracking.rs | Low       | ⬜     |
| 3.5 | Carrier detection по формату трекинга          | utils.rs    | Low       | ⬜     |
| 3.6 | UI: CarrierIcon компонент                      | Orders.jsx  | Low       | ⬜     |
| 3.7 | UI: TrackingTimeline компонент                 | Orders.jsx  | High      | ⬜     |
| 3.8 | Background thread: приоритизация прямых API    | main.rs     | Medium    | ⬜     |

---

### PHASE 4: Admin Web Dashboard

**Срок:** 4-5 дней
**Приоритет:** 🔴 HIGH

| #    | Задача                            | Файлы         | Сложность | Статус |
| ---- | --------------------------------- | ------------- | --------- | ------ |
| 4.1  | Server: Admin API endpoints       | server/routes | High      | ⬜     |
| 4.2  | Server: Dashboard stats endpoint  | server/routes | Medium    | ⬜     |
| 4.3  | Server: Shop detail endpoint      | server/routes | Medium    | ⬜     |
| 4.4  | Server: User stats endpoint       | server/routes | Medium    | ⬜     |
| 4.5  | Server: Footprint search endpoint | server/routes | High      | ⬜     |
| 4.6  | Web: Dashboard layout             | admin-web/    | Medium    | ⬜     |
| 4.7  | Web: Overview page                | admin-web/    | High      | ⬜     |
| 4.8  | Web: Shop detail page             | admin-web/    | High      | ⬜     |
| 4.9  | Web: User stats page              | admin-web/    | Medium    | ⬜     |
| 4.10 | Web: Footprint search page        | admin-web/    | High      | ⬜     |

---

### PHASE 5: Automation Coordination

**Срок:** 2-3 дня
**Приоритет:** 🟡 MEDIUM

| #   | Задача                               | Файлы        | Сложность | Статус |
| --- | ------------------------------------ | ------------ | --------- | ------ |
| 5.1 | Создать `AutomationState` struct     | main.rs      | Low       | ⬜     |
| 5.2 | Добавить `automation_config` таблицу | database.rs  | Low       | ⬜     |
| 5.3 | Функция `get_automation_config()`    | database.rs  | Low       | ⬜     |
| 5.4 | Обновить threads для чтения config   | main.rs      | Medium    | ⬜     |
| 5.5 | Добавить health monitoring           | main.rs      | High      | ⬜     |
| 5.6 | UI: Automation Settings page         | Settings.jsx | Medium    | ⬜     |

---

### PHASE 6: Smart Card Protection

**Срок:** 2-3 дня
**Приоритет:** 🔴 HIGH

| #   | Задача                                       | Файлы       | Сложность | Статус |
| --- | -------------------------------------------- | ----------- | --------- | ------ |
| 6.1 | Функция `get_burned_cards()`                 | database.rs | Medium    | ⬜     |
| 6.2 | Функция `auto_archive_burned_cards()`        | database.rs | Medium    | ⬜     |
| 6.3 | Функция `get_consecutive_declines(card_id)`  | database.rs | High      | ⬜     |
| 6.4 | Функция `auto_archive_risky_cards()`         | database.rs | High      | ⬜     |
| 6.5 | Функция `get_card_replacement_suggestions()` | database.rs | High      | ⬜     |
| 6.6 | Background thread: card protection           | main.rs     | Medium    | ⬜     |
| 6.7 | UI: Burned cards notification                | Cards.jsx   | Medium    | ⬜     |

---

## 🔧 ТЕХНИЧЕСКИЕ ДЕТАЛИ

### Database Migrations

```sql
-- PHASE 1: Footprint V2
ALTER TABLE shop_footprints ADD COLUMN order_status TEXT;
ALTER TABLE shop_footprints ADD COLUMN installation_id_hash TEXT;

-- PHASE 2: Carrier tracking
ALTER TABLE orders ADD COLUMN carrier_type TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_carrier ON orders(carrier_type);

-- PHASE 5: Automation config
CREATE TABLE IF NOT EXISTS automation_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO automation_config (key, value, description) VALUES
    ('autolock_timeout', '300', 'seconds before auto-lock'),
    ('sync_interval', '120', 'seconds between footprint sync'),
    ('imap_poll_interval', '60', 'seconds between IMAP polls'),
    ('tracking_interval', '1800', 'seconds between tracking checks'),
    ('proxy_check_interval', '1800', 'seconds between proxy health checks'),
    ('max_sync_failures', '5', 'failures before pause'),
    ('auto_archive_enabled', 'true', 'enable auto-archiving'),
    ('burned_card_threshold', '3', 'orders before archive'),
    ('decline_threshold', '5', 'consecutive declines before archive');
```

### API Endpoints (Server)

```rust
// PHASE 1: Footprint V2
POST /api/v2/footprint
POST /api/v2/footprint/check

// PHASE 4: Admin Dashboard
GET  /api/admin/dashboard
GET  /api/admin/shops/:id
GET  /api/admin/users/:installation_id
GET  /api/admin/footprints/search?q=
GET  /api/admin/stats/global
```

---

## 📈 МЕТРИКИ УСПЕХА

| Метрика                     | Current | Target     | Impact |
| --------------------------- | ------- | ---------- | ------ |
| Footprint sync success rate | ~85%    | 95%+       | 🔴     |
| Risk check accuracy         | N/A     | 90%+       | 🔴     |
| Auto-tracking coverage      | 60%     | 90%+       | 🟡     |
| User burn prevention        | 0       | 100+ saved | 🔴     |
| Admin visibility            | 0%      | 100%       | 🟡     |

---

## 🔥 СЛЕДУЮЩИЕ ШАГИ

1. **Начать с PHASE 1** (Footprint V2) — самый высокий impact
2. **Параллельно PHASE 6** (Card Protection) — критично для пользователей
3. **Затем PHASE 4** (Admin Dashboard) — для глобальной видимости
4. **PHASE 2-3-5** — по мере времени

---

**Брат, давай ебашить по этому плану! 🚀**
