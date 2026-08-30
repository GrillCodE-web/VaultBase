# Права доступа — VaultBase

**Версия:** 2.5.0
**Обновлено:** 2026-08-07

Документ описывает гранулярные права: где они объявлены, какие команды их
проверяют, и — отдельно — какие права объявлены, но **не работают**.

Про роли (`admin` / `operator`), мастер-пароль и вход — см. [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md).

---

## 1. Как устроена проверка

Права — это строковые ключи из `models.rs` (модуль `perms`, строка ~1178).
Пользователю они выдаются поштучно в разделе «Пользователи» админом.

### Четыре охранника

Все они живут в начале `src-tauri/src/main.rs` (строки 40–70) и возвращают
`ActiveUser` либо ошибку-строку, которая долетает до фронта как reject промиса.

| Охранник                  | Что требует                      | Ошибка                    |
| ------------------------- | -------------------------------- | ------------------------- |
| `require_user()`          | Просто вход в систему            | `not_authenticated`       |
| `require_perm(key)`       | Конкретное право                 | `permission_denied:<key>` |
| `require_admin()`         | Роль `admin`                     | `admin_required`          |
| `require_any_perm(&[..])` | **Хотя бы одно** право из списка | `permission_denied:a\|b`  |

### Админ проходит всё

```rust
// models.rs:1373
pub fn has_perm(&self, key: &str) -> bool {
    self.is_admin() || self.permissions.iter().any(|p| p == key)
}
```

Это значит: **`require_perm(X)` никогда не остановит админа**. Права — это
механизм для операторов. Если действие должно быть закрыто и от админа тоже,
права не подходят — нужна другая проверка.

Обратная сторона: `require_admin()` **нельзя** обойти выдачей права. Отсюда
растут мёртвые тумблеры из раздела 4.

### Зачем понадобился `require_any_perm`

Одно и то же действие бывает законным для двух разных ролей. Живой пример —
создание магазина:

```rust
// main.rs:975
fn create_shop(input: ShopInput) -> Result<Shop, String> {
    require_any_perm(&[models::perms::MANAGE_SHOPS, models::perms::CREATE_ORDERS])?;
    ...
}
```

Оператор создаёт магазин не потому, что «управляет справочником», а потому что
оформляет заказ по позиции из каталога: `Orders.jsx:675–712`, ветка
`selectShop → s._fromCatalog`, вызывает `create_shop` прямо посреди оформления.
Закрой это одним `MANAGE_SHOPS` — и сломается основной рабочий сценарий, ради
которого оператора вообще завели.

### Фронт дублирует, но не заменяет

`useAuth.jsx:57` даёт `hasPerm(key)` с той же логикой (админ → всегда `true`).
Фронт использует её, чтобы **прятать** кнопки. Это UX, а не защита: команды
Tauri вызываются напрямую, и настоящая проверка — только в Rust.

---

## 2. Карта прав → команд

18 объявленных прав. 14 реально проверяются, 4 — нет (раздел 4).
(`add_cards_manual` выпилено в MGR-018 вместе с командой `import_cards`:
карты создаёт только менеджер, воркер принимает запечатанные срезы.)

### Карты

| Право                 | Команды                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `view_cards_pool`     | `get_cards`, `get_card`, `get_card_filter_meta`, `get_expiring_cards_dashboard` |
| `take_cards`          | `take_card`                                                                     |
| `transfer_cards`      | `transfer_card_cmd`                                                             |
| `view_own_cards_full` | `reveal_card`                                                                   |

`get_expiring_cards_dashboard` живёт на дашборде, но отдаёт карты — поэтому
закрыт правом на пул карт, а не на статистику.

#### `reveal_card` — три гейта подряд

Это самая чувствительная команда в приложении: она отдаёт PAN и CVV открытым
текстом. На ней стоит:

1. **Rate limit** — 5 вызовов в минуту (`RateLimitCategory::Strict`).
2. **Право** `view_own_cards_full`.
3. **Владелец** — карта должна быть закреплена за вызывающим.
4. _(опционально)_ мастер-пароль, если он передан — сверяется через bcrypt.

Гейт по владельцу раньше отсутствовал: право называлось «view **own** cards
full», но проверялось только его наличие. Оператор с этим правом (оно есть в
`OPERATOR_DEFAULTS`) мог раскрыть номер и CVV **чужой** карты, просто передав её
`id`. Исправлено — `reveal_card` теперь сверяет `card_assignments`:

```rust
// main.rs:604
if !user.is_admin() {
    if let Some(owner_id) = db.get_card_owner(id) {
        if owner_id != user.user_id {
            // + запись security.reveal_denied в аудит
            return Err("card_owned_by_another_user".into());
        }
    }
}
```

Незакреплённая карта (`get_card_owner` вернул `None`) **не** блокируется. Иначе
сломался бы порядок «взять карту → раскрыть» и легаси-профили, у которых
назначения нет. Защищать там нечего: карта ничья.

Отказ пишется в аудит как `security.reveal_denied` — рядом с уже существующим
`security.reveal_failed` (неверный мастер-пароль).

★ Почему это удалось починить, а `view_all_orders` — нет: у карт **есть**
таблица владения (`card_assignments`, `_migrations.rs:482`), а у заказов её нет.
Право можно применить ровно настолько, насколько его выражает схема данных.

### Заказы

| Право           | Команды                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_orders` | `create_order`, `update_order_status`, `update_order_tracking`, `batch_create_orders`, `get_clean_email_for_shop`, (+ `create_shop` через `require_any_perm`) |

`get_clean_email_for_shop` — не `manage_emails`. Это шаг оформления заказа:
возвращается **один** свободный адрес, весь пул при этом не раскрывается.

`delete_order` — `require_admin()`, не `create_orders`. Удаление необратимо, а
владельца у заказа нет (см. раздел 4), значит оно всегда задевает чужие данные.

### Справочники

| Право            | Команды                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_shops`   | `update_shop`, `delete_shop`, `add_shop_product`, `update_shop_product`, `delete_shop_product`                                                                              |
| `manage_emails`  | `add_email`, `get_emails`, `update_email`, `block_email`, `delete_email`                                                                                                    |
| `manage_proxies` | `add_proxy`, `import_proxies`, `get_proxies`, `update_proxy`, `block_proxy`, `delete_proxy`, `test_proxy_connection`, `set_proxy_shop_binding`, `remove_proxy_shop_binding` |

`test_proxy_connection` закрыт не из-за данных, а из-за того, что делает:
исходящее TCP-соединение по произвольному адресу и порту. Без права любой
вошедший пользователь получил бы сканер портов внутри сети, где стоит клиент.

### Статистика и экспорт

| Право               | Команды                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `view_stats_global` | `get_dashboard_stats`, `get_revenue_chart`, `get_heatmap_data`, `get_top_banks`, `get_by_country`, `get_by_source`, `get_by_domain` |
| `export_data`       | `export_cards`, `export_dashboard_csv`                                                                                              |

### Курьеры и посылки (Stuffer)

| Право             | Команды                                                    |
| ----------------- | ---------------------------------------------------------- |
| `view_couriers`   | `stuffer_list_couriers`, `stuffer_list_available_couriers` |
| `manage_couriers` | `stuffer_add_courier`, `stuffer_set_config`                |
| `view_packages`   | `stuffer_list_packages`, `stuffer_get_labels`              |
| `create_packages` | `stuffer_create_package`                                   |

### Закрыто только входом (`require_user`)

Права здесь нет намеренно — действие нужно каждому оператору, а разделить
«свои/чужие» либо нечем, либо незачем:

| Область                                    | Команды                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Профили и дропы (PII: имя, адрес, телефон) | `create_profile`, `get_profiles`, `get_profile`, `get_profile_detail`, `update_profile`, `update_profile_notes`, `duplicate_profile`, `find_duplicate_profiles`, шаблоны профилей, `add_drop`, `update_drop`, `delete_drop`, `set_primary_drop`, `import_drops`, `find_duplicate_drops` |
| Мутации карт в рабочем цикле               | `update_card_status`, `update_card_notes`, `bulk_update_cards`                                                                                                                                                                                                                          |
| Почта (IMAP/SMTP, 25 команд)               | учётки, папки, сообщения, отправка                                                                                                                                                                                                                                                      |
| Справочник магазинов (чтение)              | `get_shops`, `get_shop`, `get_shop_smart_suggestions`                                                                                                                                                                                                                                   |
| Заказы (чтение)                            | `get_orders`, `get_order`                                                                                                                                                                                                                                                               |
| Прочее                                     | `set_config`, `get_activity_log`, `get_unsynced_footprints`, `mark_footprints_synced`, `sync_now`                                                                                                                                                                                       |

`get_config` намеренно **без** проверки: `App.jsx` читает `always_on_top` до
`resumeSession()`, то есть до появления пользователя. Ключи ограничены
whitelist'ом, секреты отдаются только флагом `<key>_set`.

### Только админ (`require_admin`)

| Причина                               | Команды                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| Необратимо и затрагивает общие данные | `delete_order`, `delete_card`, `bulk_delete_cards`, `delete_profile` |
| Обход всех прав разом                 | `export_backup` (вся база одним файлом)                              |
| Уничтожение следов                    | `clear_activity_log` (туда же пишется `security.reveal_denied`)      |
| Управление пользователями             | все 13 команд (см. раздел 4)                                         |

---

## 3. Разделение чтения и записи

Права на справочники устроены несимметрично, и это намеренно.

```rust
// main.rs:983 — чтение: только вход
fn get_shops(page: u32, per_page: u32, search: String) -> Result<PaginatedShops, String> {
    require_user()?;
    ...
}

// main.rs:995 — запись: право
fn update_shop(id: i64, input: ShopInput) -> Result<(), String> {
    require_perm(models::perms::MANAGE_SHOPS)?;
    ...
}
```

Список магазинов — это справочник для выбора. Он нужен на трёх страницах:
в заказах (выбрать магазин), в прокси (привязка прокси к магазину) и в самом
разделе магазинов. Закрыть чтение правом `manage_shops` — значит выдать это
право всем, и тогда оно перестанет что-либо значить.

То же касается `get_shop` и `get_shop_smart_suggestions`.

Пул email так **не** разделён: `get_emails` требует `manage_emails`, потому что
список адресов — сам по себе чувствительные данные, а для заказа есть отдельная
узкая команда `get_clean_email_for_shop`.

---

## 4. Мёртвые тумблеры

Четыре права объявлены в `models.rs` — и **не проверяются ни одной командой**.
Из интерфейса (`UsersPage.jsx`) они **убраны**: раньше они выглядели рабочими
тумблерами, сохранялись через `set_user_permission_cmd` и молча ничего не
делали. Сами константы в `models.rs` оставлены — удалять их стоит вместе с
решением по каждому пункту ниже.

Заодно исправлена обратная ошибка: `view_couriers`, `manage_couriers`,
`view_packages`, `create_packages` в `UsersPage.jsx` **отсутствовали**, хотя
бэкенд их проверяет. Из-за этого `manage_couriers` нельзя было выдать никому —
настройка Stuffer оставалась недоступной любому оператору навсегда. Теперь есть
группа «Курьеры».

### `view_all_orders` — блокирует схема БД

```rust
// main.rs:1042
fn get_orders(filter: OrderFilter, page: u32, per_page: u32) -> Result<PaginatedOrders, String> {
    require_user()?;   // не VIEW_ALL_ORDERS
    ...
}
```

Право подразумевает пару «свои заказы / все заказы». Но в таблице `orders`
(`database/_migrations.rs:183`) **нет колонки владельца** — ни `created_by`, ни
`user_id`. Отфильтровать «чужие» нечем.

Варианты были такие:

| Вариант                         | Почему нет                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `require_perm(VIEW_ALL_ORDERS)` | Оператора выкидывает со **всей** страницы заказов: права нет в `OPERATOR_DEFAULTS`, а «своих» заказов не существует |
| Оставить как есть, молча        | Тумблер в UI врёт, что что-то делает                                                                                |
| `require_user()` + комментарий  | ✅ Честный минимум: без входа не пустит, но не притворяется работающим правом                                       |

**Чтобы включить по-настоящему** нужна миграция:

1. `ALTER TABLE orders ADD COLUMN created_by INTEGER REFERENCES users(id)`
2. `create_order` пишет туда `user.id`
3. `OrderFilter` получает поле владельца
4. `get_orders` при отсутствии права подставляет фильтр `created_by = me`
5. `delete_order` можно снять с `require_admin()` на «свой заказ или админ»

Пока миграции нет — тумблер убран из UI, чтобы не вводить в заблуждение.

### `manage_users` и `manage_permissions` — перекрыты `require_admin()`

Все 13 команд управления пользователями (`get_users`, `create_user`,
`update_user_cmd`, `delete_user_cmd`, `set_user_password_cmd`,
`get_user_with_permissions`, `set_user_permission_cmd`,
`reset_user_permissions_cmd`, `get_users_stats`, `get_user_period_stats`,
`get_user_activity_log`, `get_admin_overview`) начинаются с `require_admin()`.

Раз `require_admin()` проверяет **роль**, а не право, выдача оператору
`manage_users` не даёт ничего. Плюс к этому `App.jsx:745` вообще не показывает
пункт меню «Пользователи» неадминам.

Развилка — продуктовое решение, а не техническое:

- **Если управление пользователями должно быть только у админа** → удалить оба
  права из `perms` и из `UsersPage.jsx`. Роль уже всё выражает.
- **Если оператор-бригадир должен уметь заводить людей** → заменить
  `require_admin()` на `require_perm(MANAGE_USERS)` в командах и открыть пункт
  меню по `hasPerm`. Осторожно: `set_user_permission_cmd` под `manage_permissions`
  — это право раздавать права, то есть по факту эскалация до админа.

### `view_reports` — не привязано ни к чему

Право есть, команды нет. Аналитика закрыта `view_stats_global`. Либо
`view_reports` — это задуманный, но не сделанный отдельный раздел отчётов,
либо дубль `view_stats_global`. Сейчас — просто мусор в списке.

---

## 5. Права по умолчанию у оператора

```rust
// models.rs
pub const OPERATOR_DEFAULTS: &[&str] = &[
    VIEW_CARDS_POOL, TAKE_CARDS, VIEW_OWN_CARDS_FULL,
    CREATE_ORDERS, VIEW_COURIERS, VIEW_PACKAGES, CREATE_PACKAGES,
];
```

Оператор «из коробки» умеет: смотреть пул карт, брать карты, раскрывать
свои, создавать заказы, смотреть курьеров и посылки, создавать посылки.

**Не умеет:** видеть статистику дашборда, экспортировать, управлять
магазинами/email/прокси, передавать карты, добавлять курьеров.

### Что видит оператор на дашборде

Дашборд — стартовая страница для **всех** (`App.jsx:403`), и он же почти
целиком закрыт правом `view_stats_global`, которого у оператора нет. Панели
просто будут пустыми — страница не падает:

```jsx
// DashboardRedesigned.jsx:727
const [s, c, hm, b, co, so, dm, ex, ro, bp] = await Promise.allSettled([...])
if (s.status === 'fulfilled') setStats(s.value)
```

`Promise.allSettled` (а не `Promise.all`) — единственная причина, по которой
закрывать статистику правами вообще безопасно. С `Promise.all` первый же
`permission_denied` уронил бы весь дашборд, то есть стартовый экран.

Отказы уходят в `console.warn`. Toast'а нет — иначе оператор ловил бы семь
ошибок при каждом заходе.

### Как отказ выглядит для пользователя

Бэкенд возвращает строку `permission_denied:<key>` (или `key_a|key_b` для
`require_any_perm`). `src/utils/errorHandler.js` переводит её в человеческую
фразу — «Недостаточно прав: управление прокси. Обратитесь к администратору».
Раньше ветки для этого не было, и сырая строка попадала прямо в тост.

Важно: `isUnauthorizedError()` явно **исключает** `permission_denied`. По его
`true` вызывающий код разлогинивает пользователя (`App.jsx`), и без этого
исключения оператор вылетал бы из системы, открыв страницу, на которую у него
нет права.

### Где UI прячется сам

| Место                          | Условие                             |
| ------------------------------ | ----------------------------------- |
| Навигация: `proxies`           | `manage_proxies`                    |
| Навигация: `couriers`          | `view_couriers` или `view_packages` |
| Навигация: `users`, `my_stats` | `isAdmin`                           |
| Панель Stuffer в настройках    | `manage_couriers`                   |
| Кнопка «раскрыть карту»        | `view_own_cards_full`               |
| Кнопка «взять карту»           | `take_cards`                        |

`shops` в навигации намеренно виден всем: `get_shops` требует лишь входа.

Это UX, а не защита — команды Tauri вызываются напрямую, настоящая проверка
только в Rust. Но без него оператор упирался бы в пустые страницы с ошибкой.

★ При проверке помните: `hasPerm` для админа всегда `true`, поэтому под
админом ни один из этих путей не воспроизводится. Тестировать только под
оператором.

---

## 6. Проверка

```bash
export PATH="/c/msys64/mingw64/bin:$PATH"   # Rust требует MSYS2 mingw64
cd src-tauri && cargo check
```

Проходит чисто. Единственное предупреждение — `imap-proto v0.10.2`
(future-incompat в транзитивной зависимости), к правам отношения не имеет.

Быстрый пересчёт охранников:

```bash
grep -c "require_perm\|require_user\|require_admin\|require_any_perm" src-tauri/src/main.rs
```

---

## 7. Файлы

| Файл                                    | Роль                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| `src-tauri/src/models.rs`               | Константы прав (`perms`), `has_perm`, `OPERATOR_DEFAULTS` |
| `src-tauri/src/main.rs`                 | Охранники (строки 40–70) + их применение в ~198 командах  |
| `src-tauri/src/database/_migrations.rs` | Схема; здесь же отсутствующий `orders.created_by`         |
| `src/hooks/useAuth.jsx`                 | `hasPerm` на фронте — для скрытия UI                      |
| `src/pages/UsersPage.jsx`               | Подписи и группировка прав в интерфейсе                   |
| `src/App.jsx`                           | Навигация; `users` скрыт по `isAdmin` (строка 745)        |
