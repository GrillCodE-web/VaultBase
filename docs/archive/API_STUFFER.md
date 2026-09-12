# Stuffer API

REST-подобный JSON API для интеграции стафферов с панелью. Все запросы проходят через единую точку входа и различаются параметром `json` в query string.

> Актуальная редакция (апдейт панели 2026-09). Ключевые изменения: новые методы
> `package` и `add_track`; в `packages` добавлены депозитные поля (`percent`,
> `is_deposited`, `deposit_amount`, `deposited_date`) и поля `labels` /
> `labels_hash`; `tracks` — объекты `{track, carrier}`; поле
> `labels[].label_carrier` переименовано в `labels[].carrier`.

## Базовый URL

```
/api/stuffer/
```

Пример для локальной разработки:

```
http://localhost:1174/api/stuffer/
```

## Аутентификация

К каждому запросу обязательно добавляется query-параметр `api_key` — API-ключ стаффера из панели.

| Параметр  | Где   | Обязательный | Описание          |
| --------- | ----- | ------------ | ----------------- |
| `api_key` | query | да           | API-ключ стаффера |

**Ошибки аутентификации:**

| HTTP | Ответ                        | Причина             |
| ---- | ---------------------------- | ------------------- |
| 403  | `{"error": "no api key"}`    | Параметр не передан |
| 403  | `{"error": "wrong api key"}` | Ключ не найден      |

## Общие правила

- Все ответы — JSON (`Content-Type: application/json`).
- Параметр `json` в query string определяет вызываемый метод.
- Успешные ответы содержат `"success": true` (кроме ошибок аутентификации).
- При неизвестном значении `json` возвращается HTTP 404: `{"error": "Wrong request: <значение>"}`.

---

## Методы

### 1. Список курьеров — `couriers`

Возвращает курьеров (drops), назначенных данному стафферу. Архивные курьеры исключаются.

**Запрос**

```
GET /api/stuffer/?json=couriers&api_key={api_key}
```

**Пример ответа**

```json
{
  "success": true,
  "couriers": [
    {
      "id": 982,
      "name": "John Doe",
      "status": "ready",
      "address1": "123 Main St",
      "address2": "Apt 4",
      "gender": "male",
      "city": "New York",
      "country": "US",
      "state": "NY",
      "zip": "10001",
      "expired_date": "2026-12-31",
      "packages": {
        "new": 3,
        "shipped": 1,
        "sent": 5
      },
      "public_description": "Описание курьера для стаффера"
    }
  ]
}
```

**Поля курьера**

| Поле                 | Тип    | Описание                                   |
| -------------------- | ------ | ------------------------------------------ |
| `id`                 | int    | ID курьера (используется как `courier_id`) |
| `name`               | string | Имя курьера                                |
| `status`             | string | Текущий статус курьера                     |
| `address1`           | string | Адрес, строка 1                            |
| `address2`           | string | Адрес, строка 2                            |
| `gender`             | string | Пол                                        |
| `city`               | string | Город                                      |
| `country`            | string | Страна                                     |
| `state`              | string | Штат / регион                              |
| `zip`                | string | Почтовый индекс                            |
| `expired_date`       | string | Дата истечения                             |
| `packages.new`       | int    | Количество пакетов в статусе `new`         |
| `packages.shipped`   | int    | Количество пакетов в статусе `shipped`     |
| `packages.sent`      | int    | Количество пакетов в статусе `sent`        |
| `public_description` | string | Публичное описание курьера                 |

---

### 2. Доступные курьеры — `available_couriers`

Возвращает курьеров, доступных для добавления стафферу (аналог секции «New couriers» в панели). Имя и адрес **не раскрываются** — только локация и статус.

Отличие от `couriers`: метод `couriers` возвращает уже добавленных курьеров с полными данными; `available_couriers` — тех, кого стаффер ещё может добавить.

**Запрос**

```
GET /api/stuffer/?json=available_couriers&api_key={api_key}
```

**Пример ответа**

```json
{
  "success": true,
  "couriers": [
    {
      "id": 1234,
      "country": "US",
      "city": "New York",
      "state": "NY",
      "zip": "10001",
      "status": "ready",
      "packages": {
        "new": 2,
        "shipped": 1,
        "sent": 5
      },
      "public_description": "Описание курьера"
    }
  ]
}
```

**Поля курьера**

| Поле                 | Тип    | Описание                                               |
| -------------------- | ------ | ------------------------------------------------------ |
| `id`                 | int    | ID курьера (используется при добавлении/пакетах)       |
| `country`            | string | Страна                                                 |
| `city`               | string | Город                                                  |
| `state`              | string | Штат / регион                                          |
| `zip`                | string | Почтовый индекс                                        |
| `status`             | string | Текущий статус курьера                                 |
| `packages.new`       | int    | Количество пакетов в статусе `new` (включая `checked`) |
| `packages.shipped`   | int    | Количество пакетов в статусе `shipped`                 |
| `packages.sent`      | int    | Количество пакетов в статусе `sent`                    |
| `public_description` | string | Публичное описание курьера                             |

---

### 3. Добавление курьера — `add_courier`

Назначает курьера стафферу (аналог кнопки добавления в секции «New couriers»). Типичный сценарий: получить `id` через `available_couriers`, затем вызвать этот метод.

**Запрос**

```
POST /api/stuffer/?json=add_courier&api_key={api_key}
Content-Type: application/json
```

**Тело запроса**

```json
{
  "courier_id": 1234
}
```

| Поле         | Тип | Обязательный | Описание                           |
| ------------ | --- | ------------ | ---------------------------------- |
| `courier_id` | int | **да**       | ID курьера из `available_couriers` |

**Пример успешного ответа**

```json
{
  "success": true,
  "courier": {
    "id": 1234,
    "name": "John Doe",
    "status": "ready",
    "address1": "123 Main St",
    "address2": "Apt 4",
    "gender": "male",
    "city": "New York",
    "country": "US",
    "state": "NY",
    "zip": "10001",
    "expired_date": "2026-12-31",
    "packages": {
      "new": 0,
      "shipped": 1,
      "sent": 2
    },
    "public_description": "Описание курьера"
  }
}
```

Поля объекта `courier` — те же, что в методе `couriers`.

**Ошибки**

| HTTP | Ответ                                 | Причина                             |
| ---- | ------------------------------------- | ----------------------------------- |
| 400  | `{"error": "Invalid courier_id"}`     | `courier_id` не передан или ≤ 0     |
| 404  | `{"error": "Courier not found"}`      | Курьер с указанным ID не существует |
| 403  | `{"error": "Couriers limit reached"}` | Достигнут лимит добавления курьеров |
| 400  | `{"error": "Courier not available"}`  | Курьер недоступен для добавления    |

Если курьер ранее был скрыт стаффером, повторный вызов с тем же `courier_id` восстанавливает связь (идемпотентный успех).

---

### 4. Список пакетов — `packages`

Возвращает до **500** последних пакетов стаффера (не архивных), отсортированных по `package_id DESC`.

**Запрос**

```
GET /api/stuffer/?json=packages&api_key={api_key}
```

**Пример ответа**

```json
{
  "success": true,
  "packages": [
    {
      "id": 11516,
      "name": "Apple iPhone 13 Pro, QTY:2",
      "status": "checked",
      "price": 999.99,
      "percent": 15,
      "is_deposited": true,
      "deposit_amount": 210.0,
      "deposited_date": "2026-08-10 18:49:07",
      "labels": [
        {
          "track": "1Z999AA10123456784",
          "carrier": "UPS"
        }
      ],
      "labels_hash": "abc123...",
      "tracks": [
        {
          "track": "1Z999AA10123456784",
          "carrier": "ups"
        }
      ],
      "comments": [
        {
          "id": 814,
          "date": "01.07.2020 11:57",
          "comment_text": "Проверьте вес",
          "sender": "admin",
          "access": "admin,stuffer,support"
        }
      ]
    },
    {
      "id": 10809,
      "name": "Apple iPad Pro, QTY:4",
      "status": "received",
      "price": 799.0,
      "percent": 0,
      "is_deposited": false,
      "deposit_amount": null,
      "deposited_date": null,
      "labels_hash": "",
      "tracks": [
        {
          "track": "N/A",
          "carrier": "unknown"
        }
      ],
      "comments": []
    }
  ]
}
```

**Поля пакета**

| Поле               | Тип          | Описание                                                                                     |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------- |
| `id`               | int          | ID пакета                                                                                    |
| `name`             | string       | Название пакета                                                                              |
| `status`           | string       | Текущий статус пакета                                                                        |
| `price`            | float        | Цена пакета (`package_price`)                                                                |
| `percent`          | float        | Процент стаффера (`package_stuffer_percent`)                                                 |
| `is_deposited`     | bool         | Была ли выплата стафферу за пак                                                              |
| `deposit_amount`   | float\|null  | Сумма выплаты из `stuffer_balance_history`; `null` если не депозит или транзакция не найдена |
| `deposited_date`   | string\|null | Дата и время депозита (`Y-m-d H:i:s`); `null` если не депозит                                |
| `labels`           | array        | Массив лейблов (может отсутствовать, если лейблов нет)                                       |
| `labels[].track`   | string       | Трек-номер лейбла (может быть `[HIDDEN TRACK]` если скрыт для стаффера)                      |
| `labels[].carrier` | string       | Перевозчик лейбла                                                                            |
| `labels_hash`      | string       | Хеш лейблов для отслеживания изменений                                                       |
| `tracks`           | array        | Массив входящих треков                                                                       |
| `tracks[].track`   | string       | Трек-номер                                                                                   |
| `tracks[].carrier` | string       | Перевозчик                                                                                   |
| `comments`         | array        | Комментарии от admin/support (собственные комментарии стаффера скрыты)                       |

> **Breaking change:** `tracks` теперь содержит объекты `{track, carrier}`, а поле `labels[].label_carrier` переименовано в `labels[].carrier`.

**Поля комментария**

| Поле           | Тип    | Описание                              |
| -------------- | ------ | ------------------------------------- |
| `id`           | int    | ID комментария                        |
| `date`         | string | Дата и время (`DD.MM.YYYY HH:MM`)     |
| `comment_text` | string | Текст комментария                     |
| `sender`       | string | Отправитель (`admin`, `support`, ...) |
| `access`       | string | Уровни доступа через запятую          |

**Ошибки**

| HTTP | Ответ                                        | Причина                      |
| ---- | -------------------------------------------- | ---------------------------- |
| 200  | `{"success": false, "error": "<сообщение>"}` | Ошибка при обработке лейблов |

---

### 5. Пакет по ID — `package`

Возвращает один пакет, принадлежащий данному стафферу. Формат объекта совпадает с элементом массива метода `packages`. Метод не ограничен последними 500 пакетами и может вернуть архивный пакет стаффера.

**Запрос**

```
GET /api/stuffer/?json=package&package_id={package_id}&api_key={api_key}
```

| Параметр     | Где   | Обязательный | Описание  |
| ------------ | ----- | ------------ | --------- |
| `package_id` | query | да           | ID пакета |

**Пример ответа**

```json
{
  "success": true,
  "package": {
    "id": 11516,
    "name": "Apple iPhone 13 Pro, QTY:2",
    "status": "checked",
    "price": 999.99,
    "percent": 15,
    "is_deposited": true,
    "deposit_amount": 210.0,
    "deposited_date": "2026-08-10 18:49:07",
    "labels": [
      {
        "track": "1Z999AA10123456784",
        "carrier": "UPS"
      }
    ],
    "labels_hash": "abc123...",
    "tracks": [
      {
        "track": "1Z999AA10123456784",
        "carrier": "ups"
      }
    ],
    "comments": []
  }
}
```

Поля объекта `package` описаны в разделе `packages`.

**Ошибки**

| HTTP | Ответ                                        | Причина                                     |
| ---- | -------------------------------------------- | ------------------------------------------- |
| 400  | `{"error": "Invalid package_id"}`            | `package_id` не передан или меньше единицы  |
| 404  | `{"error": "Package not found"}`             | Пакет не найден или не принадлежит стафферу |
| 200  | `{"success": false, "error": "<сообщение>"}` | Ошибка при обработке лейблов                |

---

### 6. Добавление трека — `add_track`

Добавляет один входящий трек существующему пакету стаффера.

**Запрос**

```
POST /api/stuffer/?json=add_track&api_key={api_key}
Content-Type: application/json
```

**Тело запроса**

```json
{
  "package_id": 11516,
  "track": "1Z999AA10123456784",
  "carrier": "ups"
}
```

| Поле         | Тип    | Обязательный | Описание                          |
| ------------ | ------ | ------------ | --------------------------------- |
| `package_id` | int    | да           | ID пакета стаффера                |
| `track`      | string | да           | Трек-номер длиной менее 50 знаков |
| `carrier`    | string | да           | Ключ перевозчика из панели        |

Трек нормализуется: пробелы удаляются, буквы приводятся к верхнему регистру. Carrier приводится к нижнему регистру. Повторная отправка того же трека не создаёт дубликат. При добавлении первого реального трека placeholder `n/a / unknown` удаляется.

Формат трека строго проверяется для `fedex`, `ups`, `usps`, `ontrac`, `dhl`, `lasership` и `amazon(tba)`. Для `unknown` применяются общие эвристики (минимальная длина, наличие букв, запрет служебных и повторяющихся значений). Для остальных зарегистрированных перевозчиков проверяются длина и допустимые символы. Placeholder `N/A` через `add_track` добавить нельзя.

**Пример успешного ответа**

```json
{
  "success": true,
  "track": {
    "track": "1Z999AA10123456784",
    "carrier": "ups"
  },
  "tracks": [
    {
      "track": "1Z999AA10123456784",
      "carrier": "ups"
    }
  ]
}
```

**Ошибки**

| HTTP | Ответ                                                             | Причина                                     |
| ---- | ----------------------------------------------------------------- | ------------------------------------------- |
| 400  | `{"error": "Invalid package_id"}`                                 | `package_id` не передан или меньше единицы  |
| 404  | `{"error": "Package not found"}`                                  | Пакет не найден или не принадлежит стафферу |
| 400  | `{"error": "Invalid track"}`                                      | Пустой, слишком длинный или невалидный трек |
| 400  | `{"error": "Invalid carrier"}`                                    | Перевозчик отсутствует в настройках панели  |
| 400  | `{"error": "Invalid track format for carrier", "carrier": "ups"}` | Трек не соответствует формату перевозчика   |
| 500  | `{"error": "Track not added"}`                                    | Трек не удалось сохранить                   |

---

### 7. Лейблы пакета — `labels`

Возвращает лейблы конкретного пакета, принадлежащего данному стафферу. Файлы лейблов кодируются в base64.

**Запрос**

```
GET /api/stuffer/?json=labels&package_id={package_id}&api_key={api_key}
```

| Параметр     | Где   | Обязательный | Описание  |
| ------------ | ----- | ------------ | --------- |
| `package_id` | query | да           | ID пакета |

**Пример ответа**

```json
{
  "success": true,
  "labels": [
    {
      "track": "1Z999AA10123456784",
      "carrier": "UPS",
      "file": "JVBERi0xLjQK..."
    }
  ]
}
```

**Поля лейбла**

| Поле      | Тип    | Описание                                     |
| --------- | ------ | -------------------------------------------- |
| `track`   | string | Трек-номер (полный, без маскировки)          |
| `carrier` | string | Перевозчик                                   |
| `file`    | string | Содержимое файла лейбла в base64 (если есть) |

**Ошибки**

| HTTP | Ответ                            | Причина                                     |
| ---- | -------------------------------- | ------------------------------------------- |
| 404  | `{"error": "Package not found"}` | Пакет не найден или не принадлежит стафферу |

---

### 8. Создание пакета — `new_package` (рекомендуемый)

Создаёт новый пакет для назначенного курьера. Тело запроса передаётся как JSON.

**Запрос**

```
POST /api/stuffer/?json=new_package&api_key={api_key}
Content-Type: application/json
```

**Тело запроса**

```json
{
  "package": {
    "courier_id": 982,
    "name": "Apple iPhone 13 Pro",
    "comment": "Комментарий для admin/support",
    "holder_name": "Petr Vasichkin",
    "weight": "1.5",
    "quantity": 2,
    "shop": "amazon",
    "price": 999.99,
    "delivery_date": "2026-08-10",
    "pay_option": "%",
    "pickup": 0,
    "asin": "B09G9HD6PD",
    "upc": "195949123456",
    "pickup_address": "",
    "pickup_holder_name": "",
    "tracks": [
      {
        "track": "1Z999AA10123456784",
        "carrier": "UPS"
      },
      {
        "track": "794612345678",
        "carrier": "fedex"
      }
    ]
  }
}
```

**Поля объекта `package`**

| Поле                 | Тип    | Обязательный | По умолчанию                            | Описание                                              |
| -------------------- | ------ | ------------ | --------------------------------------- | ----------------------------------------------------- |
| `courier_id`         | int    | **да**       | —                                       | ID курьера из метода `couriers`                       |
| `name`               | string | нет          | `""`                                    | Название пакета                                       |
| `comment`            | string | нет          | —                                       | Комментарий (виден admin и support)                   |
| `holder_name`        | string | нет          | `""`                                    | Имя получателя                                        |
| `weight`             | string | нет          | `"0"`                                   | Вес                                                   |
| `quantity`           | int    | нет          | `0`                                     | Количество товаров                                    |
| `shop`               | string | **да**       | —                                       | Магазин                                               |
| `price`              | float  | нет          | `1`                                     | Цена                                                  |
| `delivery_date`      | string | нет          | сегодня                                 | Дата доставки (`Y-m-d`)                               |
| `pay_option`         | string | нет          | `"%"`                                   | Тип оплаты (см. допустимые значения)                  |
| `pickup`             | int    | нет          | `0`                                     | Флаг самовывоза                                       |
| `asin`               | string | нет          | `""`                                    | ASIN товара                                           |
| `upc`                | string | нет          | `""`                                    | UPC товара                                            |
| `pickup_address`     | string | нет          | `""`                                    | Адрес самовывоза                                      |
| `pickup_holder_name` | string | нет          | `""`                                    | Имя для самовывоза                                    |
| `tracks`             | array  | нет          | `[{"track":"N/A","carrier":"unknown"}]` | Трек-номера; если не переданы — создаётся placeholder |
| `tracks[].track`     | string | нет          | `"N/A"`                                 | Трек-номер                                            |
| `tracks[].carrier`   | string | нет          | `"unknown"`                             | Перевозчик                                            |

Переданные треки проходят ту же серверную проверку, что и `add_track`. Для `fedex`, `ups`, `usps`, `ontrac`, `dhl`, `lasership` и `amazon(tba)` проверяется формат конкретного перевозчика; для остальных — общие ограничения. Если `tracks` отсутствует или пуст, автоматически сохраняется разрешённый placeholder `N/A / unknown`.

**Допустимые значения `pay_option`**

Должны совпадать с опциями из настроек панели (`PackageOption`). Типичные значения:

| Ключ            | Описание         |
| --------------- | ---------------- |
| `%`             | на скуп (дефолт) |
| `forwarding`    | пересыл          |
| `test`          | test             |
| `50/50_admin`   | 50/50 (admin)    |
| `50/50_stuffer` | 50/50 (stuffer)  |
| `sale`          | sale             |

Произвольные значения отклоняются.

**Пример успешного ответа**

```json
{
  "success": true,
  "package_id": 11517
}
```

**Ошибки**

| HTTP | Ответ                                                             | Причина                                     |
| ---- | ----------------------------------------------------------------- | ------------------------------------------- |
| 400  | `{"error": "Shop is required"}`                                   | Поле `shop` не передано или пустое          |
| 400  | `{"error": "Invalid pay_option"}`                                 | Недопустимое значение `pay_option`          |
| 400  | `{"error": "Invalid track"}`                                      | Пустой, слишком длинный или невалидный трек |
| 400  | `{"error": "Invalid carrier"}`                                    | Перевозчик отсутствует в настройках панели  |
| 400  | `{"error": "Invalid track format for carrier", "carrier": "ups"}` | Трек не соответствует формату перевозчика   |
| 404  | `{"error": "Courier not assigned"}`                               | Курьер не назначен данному стафферу         |
| 404  | `{"error": "Courier not found"}`                                  | Курьер с указанным ID не существует         |
| 500  | `{"error": "Package not added"}`                                  | Пакет не удалось сохранить                  |

> При невалидном JSON в теле запроса сервер вернёт ошибку парсинга.

---

### 9. Создание пакета — `add_package` (устаревший)

> **Deprecated.** Сохранён для обратной совместимости. Используйте `new_package`.

Передаёт данные пакета через form/query-параметр `package` (не JSON body).

**Запрос**

```
POST /api/stuffer/?json=add_package&api_key={api_key}
```

Параметры объекта `package` — те же, что у `new_package`, но передаются как вложенные поля формы, например:

```
package[courier_id]=982
package[name]=Apple iPhone 13 Pro
package[comment]=privet
package[holder_name]=Petr Vasichkin
package[tracks][0][track]=test
package[tracks][0][carrier]=UPS
```

Формат ответа и ошибок идентичен `new_package`.

---

## Сводная таблица методов

| `json`               | HTTP-метод | Описание                             |
| -------------------- | ---------- | ------------------------------------ |
| `couriers`           | GET        | Список добавленных курьеров (полный) |
| `available_couriers` | GET        | Доступные для добавления (краткий)   |
| `add_courier`        | POST       | Добавление курьера (JSON body)       |
| `packages`           | GET        | Список пакетов (до 500)              |
| `package`            | GET        | Один пакет по ID                     |
| `add_track`          | POST       | Добавление трека к пакету            |
| `labels`             | GET        | Лейблы пакета                        |
| `new_package`        | POST       | Создание пакета (JSON body)          |
| `add_package`        | POST       | Создание пакета (legacy)             |

## Примеры вызовов

**curl — список курьеров:**

```bash
curl "http://localhost:1174/api/stuffer/?json=couriers&api_key=YOUR_API_KEY"
```

**curl — доступные курьеры:**

```bash
curl "http://localhost:1174/api/stuffer/?json=available_couriers&api_key=YOUR_API_KEY"
```

**curl — добавление курьера:**

```bash
curl -X POST "http://localhost:1174/api/stuffer/?json=add_courier&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"courier_id": 1234}'
```

**curl — список пакетов:**

```bash
curl "http://localhost:1174/api/stuffer/?json=packages&api_key=YOUR_API_KEY"
```

**curl — пакет по ID:**

```bash
curl "http://localhost:1174/api/stuffer/?json=package&package_id=11516&api_key=YOUR_API_KEY"
```

**curl — добавление трека:**

```bash
curl -X POST "http://localhost:1174/api/stuffer/?json=add_track&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"package_id":11516,"track":"1Z999AA10123456784","carrier":"ups"}'
```

**curl — лейблы пакета:**

```bash
curl "http://localhost:1174/api/stuffer/?json=labels&package_id=11516&api_key=YOUR_API_KEY"
```

**curl — создание пакета:**

```bash
curl -X POST "http://localhost:1174/api/stuffer/?json=new_package&api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "package": {
      "courier_id": 982,
      "name": "Apple iPhone 13 Pro",
      "comment": "privet",
      "holder_name": "Petr Vasichkin",
      "tracks": [
        {"track": "test", "carrier": "UPS"},
        {"track": "test2", "carrier": "fedex"}
      ]
    }
  }'
```
