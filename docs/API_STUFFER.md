https://dash.stockhubdeal.com/api/stuffer/
APIKEY: JkGVN7pMR8zKRqAEpt4VePwS

# Stuffer API

REST-подобный JSON API для интеграции стафферов с панелью. Все запросы проходят через единую точку входа и различаются параметром `json` в query string.

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
      "labels": [
        {
          "track": "1Z999AA10123456784",
          "label_carrier": "UPS"
        }
      ],
      "labels_hash": "abc123...",
      "tracks": ["1Z999AA10123456784"],
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
      "labels_hash": "",
      "tracks": ["N/A"],
      "comments": []
    }
  ]
}
```

**Поля пакета**

| Поле                     | Тип    | Описание                                                                   |
| ------------------------ | ------ | -------------------------------------------------------------------------- |
| `id`                     | int    | ID пакета                                                                  |
| `name`                   | string | Название пакета                                                            |
| `status`                 | string | Текущий статус пакета                                                      |
| `labels`                 | array  | Массив лейблов (может отсутствовать, если лейблов нет)                     |
| `labels[].track`         | string | Трек-номер лейбла (может быть `[HIDDEN TRACK]` если скрыт для стаффера)    |
| `labels[].label_carrier` | string | Перевозчик лейбла                                                          |
| `labels_hash`            | string | Хеш лейблов для отслеживания изменений                                     |
| `tracks`                 | array  | Массив трек-номеров, добавленных при создании пакета (может отсутствовать) |
| `comments`               | array  | Комментарии от admin/support (собственные комментарии стаффера скрыты)     |

**Поля комментария**

| Поле           | Тип    | Описание                            |
| -------------- | ------ | ----------------------------------- |
| `id`           | int    | ID комментария                      |
| `date`         | string | Дата и время (`DD.MM.YYYY HH:MM`)   |
| `comment_text` | string | Текст комментария                   |
| `sender`       | string | Отправитель (`admin`, `support`, …) |
| `access`       | string | Уровни доступа через запятую        |

**Ошибки**

| HTTP | Ответ                                        | Причина                      |
| ---- | -------------------------------------------- | ---------------------------- |
| 200  | `{"success": false, "error": "<сообщение>"}` | Ошибка при обработке лейблов |

---

### 5. Лейблы пакета — `labels`

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

### 6. Создание пакета — `new_package` (рекомендуемый)

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
    "pay_option": "card",
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

| Поле                 | Тип    | Обязательный | По умолчанию | Описание                            |
| -------------------- | ------ | ------------ | ------------ | ----------------------------------- |
| `courier_id`         | int    | **да**       | —            | ID курьера из метода `couriers`     |
| `name`               | string | нет          | `""`         | Название пакета                     |
| `comment`            | string | нет          | —            | Комментарий (виден admin и support) |
| `holder_name`        | string | нет          | `""`         | Имя получателя                      |
| `weight`             | string | нет          | `"0"`        | Вес                                 |
| `quantity`           | int    | нет          | `0`          | Количество товаров                  |
| `shop`               | string | нет          | `""`         | Магазин                             |
| `price`              | float  | нет          | `0`          | Цена                                |
| `delivery_date`      | string | нет          | сегодня      | Дата доставки (`Y-m-d`)             |
| `pay_option`         | string | нет          | `""`         | Способ оплаты                       |
| `pickup`             | int    | нет          | `0`          | Флаг самовывоза                     |
| `asin`               | string | нет          | `""`         | ASIN товара                         |
| `upc`                | string | нет          | `""`         | UPC товара                          |
| `pickup_address`     | string | нет          | `""`         | Адрес самовывоза                    |
| `pickup_holder_name` | string | нет          | `""`         | Имя для самовывоза                  |
| `tracks`             | array  | нет          | —            | Трек-номера для отслеживания        |
| `tracks[].track`     | string | нет          | `"n/a"`      | Трек-номер                          |
| `tracks[].carrier`   | string | нет          | `"unknown"`  | Перевозчик                          |

**Пример успешного ответа**

```json
{
  "success": true,
  "package_id": 11517
}
```

**Ошибки**

| HTTP | Ответ                               | Причина                             |
| ---- | ----------------------------------- | ----------------------------------- |
| 404  | `{"error": "Courier not assigned"}` | Курьер не назначен данному стафферу |
| 404  | `{"error": "Courier not found"}`    | Курьер с указанным ID не существует |
| 500  | `{"error": "Package not added"}`    | Пакет не удалось сохранить          |

> При невалидном JSON в теле запроса сервер вернёт ошибку парсинга.

---

### 7. Создание пакета — `add_package` (устаревший)

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

# Stuffer API

REST-подобный JSON API для интеграции стафферов с панелью. Все запросы проходят через единую точку входа и различаются параметром `json` в query string.

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

### 2. Список пакетов — `packages`

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
      "labels": [
        {
          "track": "1Z999AA10123456784",
          "label_carrier": "UPS"
        }
      ],
      "labels_hash": "abc123...",
      "tracks": ["1Z999AA10123456784"],
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
      "labels_hash": "",
      "tracks": ["N/A"],
      "comments": []
    }
  ]
}
```

**Поля пакета**

| Поле                     | Тип    | Описание                                                                   |
| ------------------------ | ------ | -------------------------------------------------------------------------- |
| `id`                     | int    | ID пакета                                                                  |
| `name`                   | string | Название пакета                                                            |
| `status`                 | string | Текущий статус пакета                                                      |
| `labels`                 | array  | Массив лейблов (может отсутствовать, если лейблов нет)                     |
| `labels[].track`         | string | Трек-номер лейбла (может быть `[HIDDEN TRACK]` если скрыт для стаффера)    |
| `labels[].label_carrier` | string | Перевозчик лейбла                                                          |
| `labels_hash`            | string | Хеш лейблов для отслеживания изменений                                     |
| `tracks`                 | array  | Массив трек-номеров, добавленных при создании пакета (может отсутствовать) |
| `comments`               | array  | Комментарии от admin/support (собственные комментарии стаффера скрыты)     |

**Поля комментария**

| Поле           | Тип    | Описание                            |
| -------------- | ------ | ----------------------------------- |
| `id`           | int    | ID комментария                      |
| `date`         | string | Дата и время (`DD.MM.YYYY HH:MM`)   |
| `comment_text` | string | Текст комментария                   |
| `sender`       | string | Отправитель (`admin`, `support`, …) |
| `access`       | string | Уровни доступа через запятую        |

**Ошибки**

| HTTP | Ответ                                        | Причина                      |
| ---- | -------------------------------------------- | ---------------------------- |
| 200  | `{"success": false, "error": "<сообщение>"}` | Ошибка при обработке лейблов |

---

### 3. Лейблы пакета — `labels`

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

### 4. Создание пакета — `new_package` (рекомендуемый)

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
    "pay_option": "card",
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

| Поле                 | Тип    | Обязательный | По умолчанию | Описание                            |
| -------------------- | ------ | ------------ | ------------ | ----------------------------------- |
| `courier_id`         | int    | **да**       | —            | ID курьера из метода `couriers`     |
| `name`               | string | нет          | `""`         | Название пакета                     |
| `comment`            | string | нет          | —            | Комментарий (виден admin и support) |
| `holder_name`        | string | нет          | `""`         | Имя получателя                      |
| `weight`             | string | нет          | `"0"`        | Вес                                 |
| `quantity`           | int    | нет          | `0`          | Количество товаров                  |
| `shop`               | string | нет          | `""`         | Магазин                             |
| `price`              | float  | нет          | `0`          | Цена                                |
| `delivery_date`      | string | нет          | сегодня      | Дата доставки (`Y-m-d`)             |
| `pay_option`         | string | нет          | `""`         | Способ оплаты                       |
| `pickup`             | int    | нет          | `0`          | Флаг самовывоза                     |
| `asin`               | string | нет          | `""`         | ASIN товара                         |
| `upc`                | string | нет          | `""`         | UPC товара                          |
| `pickup_address`     | string | нет          | `""`         | Адрес самовывоза                    |
| `pickup_holder_name` | string | нет          | `""`         | Имя для самовывоза                  |
| `tracks`             | array  | нет          | —            | Трек-номера для отслеживания        |
| `tracks[].track`     | string | нет          | `"n/a"`      | Трек-номер                          |
| `tracks[].carrier`   | string | нет          | `"unknown"`  | Перевозчик                          |

**Пример успешного ответа**

```json
{
  "success": true,
  "package_id": 11517
}
```

**Ошибки**

| HTTP | Ответ                               | Причина                             |
| ---- | ----------------------------------- | ----------------------------------- |
| 404  | `{"error": "Courier not assigned"}` | Курьер не назначен данному стафферу |
| 404  | `{"error": "Courier not found"}`    | Курьер с указанным ID не существует |
| 500  | `{"error": "Package not added"}`    | Пакет не удалось сохранить          |

> При невалидном JSON в теле запроса сервер вернёт ошибку парсинга.

---

### 5. Создание пакета — `add_package` (устаревший)

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

| `json`        | HTTP-метод | Описание                    |
| ------------- | ---------- | --------------------------- |
| `couriers`    | GET        | Список курьеров             |
| `packages`    | GET        | Список пакетов (до 500)     |
| `labels`      | GET        | Лейблы пакета               |
| `new_package` | POST       | Создание пакета (JSON body) |
| `add_package` | POST       | Создание пакета (legacy)    |

## Примеры вызовов

**curl — список курьеров:**

```bash
curl "http://localhost:1174/api/stuffer/?json=couriers&api_key=YOUR_API_KEY"
```

**curl — список пакетов:**

```bash
curl "http://localhost:1174/api/stuffer/?json=packages&api_key=YOUR_API_KEY"
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

https://dash.stockhubdeal.com/api/stuffer/
APIKEY: JkGVN7pMR8zKRqAEpt4VePwS

# Stuffer API

REST-подобный JSON API для интеграции стафферов с панелью. Все запросы проходят через единую точку входа и различаются параметром `json` в query string.

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

### 2. Список пакетов — `packages`

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
      "labels": [
        {
          "track": "1Z999AA10123456784",
          "label_carrier": "UPS"
        }
      ],
      "labels_hash": "abc123...",
      "tracks": ["1Z999AA10123456784"],
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
      "labels_hash": "",
      "tracks": ["N/A"],
      "comments": []
    }
  ]
}
```

**Поля пакета**

| Поле                     | Тип    | Описание                                                                   |
| ------------------------ | ------ | -------------------------------------------------------------------------- |
| `id`                     | int    | ID пакета                                                                  |
| `name`                   | string | Название пакета                                                            |
| `status`                 | string | Текущий статус пакета                                                      |
| `labels`                 | array  | Массив лейблов (может отсутствовать, если лейблов нет)                     |
| `labels[].track`         | string | Трек-номер лейбла (может быть `[HIDDEN TRACK]` если скрыт для стаффера)    |
| `labels[].label_carrier` | string | Перевозчик лейбла                                                          |
| `labels_hash`            | string | Хеш лейблов для отслеживания изменений                                     |
| `tracks`                 | array  | Массив трек-номеров, добавленных при создании пакета (может отсутствовать) |
| `comments`               | array  | Комментарии от admin/support (собственные комментарии стаффера скрыты)     |

**Поля комментария**

| Поле           | Тип    | Описание                            |
| -------------- | ------ | ----------------------------------- |
| `id`           | int    | ID комментария                      |
| `date`         | string | Дата и время (`DD.MM.YYYY HH:MM`)   |
| `comment_text` | string | Текст комментария                   |
| `sender`       | string | Отправитель (`admin`, `support`, …) |
| `access`       | string | Уровни доступа через запятую        |

**Ошибки**

| HTTP | Ответ                                        | Причина                      |
| ---- | -------------------------------------------- | ---------------------------- |
| 200  | `{"success": false, "error": "<сообщение>"}` | Ошибка при обработке лейблов |

---

### 3. Лейблы пакета — `labels`

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

### 4. Создание пакета — `new_package` (рекомендуемый)

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
    "pay_option": "card",
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

| Поле                 | Тип    | Обязательный | По умолчанию | Описание                            |
| -------------------- | ------ | ------------ | ------------ | ----------------------------------- |
| `courier_id`         | int    | **да**       | —            | ID курьера из метода `couriers`     |
| `name`               | string | нет          | `""`         | Название пакета                     |
| `comment`            | string | нет          | —            | Комментарий (виден admin и support) |
| `holder_name`        | string | нет          | `""`         | Имя получателя                      |
| `weight`             | string | нет          | `"0"`        | Вес                                 |
| `quantity`           | int    | нет          | `0`          | Количество товаров                  |
| `shop`               | string | нет          | `""`         | Магазин                             |
| `price`              | float  | нет          | `0`          | Цена                                |
| `delivery_date`      | string | нет          | сегодня      | Дата доставки (`Y-m-d`)             |
| `pay_option`         | string | нет          | `""`         | Способ оплаты                       |
| `pickup`             | int    | нет          | `0`          | Флаг самовывоза                     |
| `asin`               | string | нет          | `""`         | ASIN товара                         |
| `upc`                | string | нет          | `""`         | UPC товара                          |
| `pickup_address`     | string | нет          | `""`         | Адрес самовывоза                    |
| `pickup_holder_name` | string | нет          | `""`         | Имя для самовывоза                  |
| `tracks`             | array  | нет          | —            | Трек-номера для отслеживания        |
| `tracks[].track`     | string | нет          | `"n/a"`      | Трек-номер                          |
| `tracks[].carrier`   | string | нет          | `"unknown"`  | Перевозчик                          |

**Пример успешного ответа**

```json
{
  "success": true,
  "package_id": 11517
}
```

**Ошибки**

| HTTP | Ответ                               | Причина                             |
| ---- | ----------------------------------- | ----------------------------------- |
| 404  | `{"error": "Courier not assigned"}` | Курьер не назначен данному стафферу |
| 404  | `{"error": "Courier not found"}`    | Курьер с указанным ID не существует |
| 500  | `{"error": "Package not added"}`    | Пакет не удалось сохранить          |

> При невалидном JSON в теле запроса сервер вернёт ошибку парсинга.

---

### 5. Создание пакета — `add_package` (устаревший)

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

| `json`        | HTTP-метод | Описание                    |
| ------------- | ---------- | --------------------------- |
| `couriers`    | GET        | Список курьеров             |
| `packages`    | GET        | Список пакетов (до 500)     |
| `labels`      | GET        | Лейблы пакета               |
| `new_package` | POST       | Создание пакета (JSON body) |
| `add_package` | POST       | Создание пакета (legacy)    |

## Примеры вызовов

**curl — список курьеров:**

```bash
curl "http://localhost:1174/api/stuffer/?json=couriers&api_key=YOUR_API_KEY"
```

**curl — список пакетов:**

```bash
curl "http://localhost:1174/api/stuffer/?json=packages&api_key=YOUR_API_KEY"
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
