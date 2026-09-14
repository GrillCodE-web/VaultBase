# VaultBase — Редизайн синхронизации и безопасности

> Статус: ЧЕРНОВИК-ТЗ (проект, код не написан). Ничего из описанного ещё не реализовано,
> кроме отмеченного «СДЕЛАНО (в `main`, не собрано)».
> Релиз не собираем до отдельной команды.

## КРИТИЧНО: область — ВСЕ ТРИ КОМПОНЕНТА

Все улучшения применяются к **worker** (`manager-work/src-tauri`), **manager**
(`manager-app/src-tauri`) и **server** (`cc-sync-server`), где применимо. НЕ только воркер.

### Матрица текущего состояния (по коду, факт)

| Улучшение | worker | manager | server |
|---|---|---|---|
| Argon2id (П.1) | ✅ добавлен | ❌ PBKDF2 (`crypto.rs:12,24`) | ❌ SHA256 для админ-ключа (`auth.js:18`) |
| KEK/DEK envelope (П.4) | ✅ SEC-005 | ✅ envelope-wrap | n/a (слепой) |
| X25519 E2E (П.9) | ❌ НЕТ | ✅ есть (`crypto.rs:133-199`) | ✅ хранит только шифротекст (`database.js:132`) |
| Ed25519 подписи (П.10) | ❌ | ❌ | ❌ |
| SQLCipher (П.6) | ✅ (`db key`) | ✅ (`db.rs:16`) | ❌ обычный SQLite (`data.db`) |
| Rate-limit (П.13) | модуль есть | — | ⚠️ проверить подключение `rate-limit.js` |
| helmet/заголовки | n/a | n/a | ✅ (`index.js:20`) |

**Главный рассинхрон:** менеджер умеет X25519-E2E, воркер — нет. E2E не сойдётся,
пока воркер не получит тот же крипто-контракт. → П.31.

### Дополнительные пункты (найдены при аудите кода)

- **31. Портировать X25519-envelope из менеджера в воркер** — перенести готовый контракт
  (`manager-app/src-tauri/crypto.rs`), чтобы обе стороны совпадали байт-в-байт. НЕ переписывать заново.
- **32. Argon2 для админ-пароля сервера** — сейчас `auth.js:18` деривит ключ сессии простым
  SHA256. Заменить на Argon2/scrypt. Критично — это вход в админку.
- **33. Шифрование БД сервера в покое** — `data.db` обычный SQLite; контент шифротекст, но
  метаданные/футпринты/связи открыты. SQLCipher или FS-шифрование тома.
- **34. Единый крипто-контракт** — свести параметры (домены, версии KDF, HKDF-info, форматы
  обёртки) в один источник (общий модуль/сгенерированный из `docs/MANAGER_APP.md`), чтобы три
  компонента не разъехались. HKDF_INFO у менеджера сейчас `b"vb-mgr-telemetry-v1"` — версионировать.

### Уже реализовано (аудит подтвердил — НЕ делать заново)

- ✅ **П.25 (подпись апдейта)** — minisign pubkey в `tauri.conf.json` worker+manager
  (`updater.pubkey`, `createUpdaterArtifacts:true`). Осталось: приватный ключ офлайн/в GH Secrets.
- ✅ **П.28 (supply-chain)** — audit-шаги в `test.yml` есть. Осталось: сделать hard-gate (fail on vuln).
- ✅ **helmet** + HMAC cookie на сервере (`index.js:20`, `auth.js`).
- ✅ Логи воркера не палят секреты (`encryption.rs:108` — только длина).

### Ещё дыры (аудит канала/сервера)

- **35. WS replay/nonce защита ВЫКЛ по умолчанию** — `ws_require_nonce='0'` (`database.js:721`).
  Включить принудительно: без неё WS-сообщение можно переиграть.
- ~~**36. `rate-limit.js` НЕ подключён**~~ — **ОШИБКА аудита, снято.** Rate-limiting подключён:
  WS-каналы (`socket.js`, `ws-tauri.js`) → `rate-limit.js`; HTTP-роуты → `express-rate-limit`
  (`activate.js`, `admin-auth.js`, `footprint.js`). Остаётся лишь **проверить покрытие ВСЕХ**
  чувствительных роутов (manager-api, card-pool) и при желании добавить глобальный лимитер
  как defense-in-depth. Понижено до Should.
- **37. WS-авторизация только по токену** (`socket.js:36-44`) — нет device-binding/подписи
  на WS-канале. Токен утёк → вошли. Добавить привязку к устройству + nonce.
- **38. Приватный ключ подписи апдейта** — проверить, что НЕ в git-истории.

**Список: 38 пунктов. Аудит завершён — это полный охват (крипта покоя, E2E, изоляция,
канал, WS, сборка, цепочка поставки, живая сессия, восстановление, все 3 компонента).**

## 0. Зафиксированные решения

| Тема | Решение |
|---|---|
| Контент заказов (суммы/магазины/детали/профили) | **E2E, читает только менеджер.** Сервер хранит вслепую (шифротекст). |
| Авторитет при конфликте правок | **Менеджер главный.** Воркер подчиняется. |
| Антифрод-футпринты (email/дроп/прокси/BIN/phone/name) | **Общие необратимые хэши** для кросс-воркерного антифрода. Вне E2E (иначе агрегация невозможна). |
| Ключи | **Ключ-на-воркера** (X25519). Взлом одного воркера НЕ раскрывает других. Менеджер = центр доверия, раздаёт/отзывает. |
| Восстановление | **С recovery-ключом** (забыл пароль → восстановление отдельным keyslot). |
| Миграция данных | Не нужна — боевых данных нет, только seed. |

## 1. Два плана данных (ключевое различие)

**План 1 — Антифрод-футпринты (ОБЩИЕ).**
Воркеры видят друг друга по email/дропам/прокси/BIN/телефону/имени. Уже работает: футпринты
уходят как хэши, сервер агрегирует по всем установкам, `POST /footprint/check` возвращает
частоту/отказы. НЕ E2E (иначе сервер не сопоставит). Безопасно, т.к. односторонние соль-хэши.

**План 2 — Контент заказов (ПРИВАТНЫЙ).**
Суммы, магазины, детали, профили. E2E, сервер слепой, читает только менеджер. Воркеры контент
друг друга не видят.

## 2. Модель угроз (явно)

**Защищаемся от:**
- Кража диска / выключенный ноут → данные в покое не вскрыть.
- Дамп сервера → только шифротекст + необратимые хэши.
- Брутфорс пароля → Argon2id memory-hard делает перебор экономически нереальным.
- MITM / перехват трафика → TLS + cert pinning + подписи сообщений.
- Взлом ОДНОГО воркера → изолирован (ключ-на-воркера), остальные целы, ключ отзывается.
- Троянский автоапдейт → только подписанные релизы.

**НЕ защищаемся (принципиально нерешаемо шифрованием):**
- Живой стилер/RAT на РАЗБЛОКИРОВАННОЙ машине с введённым паролем — видит расшифрованное,
  как и у любого софта в мире (VeraCrypt/Signal тоже). Лечится гигиеной ОС + минимизацией
  окна разблокировки (автолок, duress).

**Честно:** «ноль дыр навсегда» гарантировать нельзя. Цель — закрыть все известные классы атак
и изолировать ущерб.

## 3. Крипто-архитектура — 30 улучшений

### A. Деривация ключа из пароля
1. **Argon2id** вместо PBKDF2-SHA256 (memory-hard, напр. 512 МБ / 3 прохода). Апгрейд №1.
2. **Калибровка под железо** (аналог PIM): разблокировка ~0.5–1с на слабой машине.
3. **Соль на БД + pepper** (статичный perец в бинаре) против офлайн-брутфорса.

### B. Иерархия ключей
4. **пароль → KEK → DEK.** Смена пароля = перешифровать только DEK (мгновенно), не всю базу.
5. **Несколько keyslot'ов** (LUKS-style): пароль + аппаратный ключ + recovery — любой открывает.

### C. Невскрываемость в покое
6. **Полный SQLCipher обязателен** (не опция) + чувствительные поля дополнительно (defense-in-depth).
7. **Ничего чувствительного мимо шифра:** логи, кэш, temp, IMAP, экспорт — через шифр или не на диск.
8. **Zeroize + mlock/VirtualLock** — ключ не улетает в своп/hiberfil.sys.

### D. E2E воркер ↔ менеджер (сервер слепой)
9. **X25519 пара на каждого воркера.** Менеджер шифрует контент под pubkey конкретного воркера.
10. **Ed25519 подписи** сообщений — защита от подмены карт/политик сервером/MITM.
11. **Double Ratchet (forward secrecy) для чата** (Signal-style). Для контента — опционально.
12. **Хэш-футпринты вне E2E** — осознанное исключение, необратимые соль-хэши. Задокументировано.

### E. Изоляция и отзыв компрометации
13. **Ключ-на-воркера + централизованный отзыв.** Менеджер отзывает ключ, перешифровывает остальным.
14. **Привязка к устройству** (installation_id уже есть) — база без машины бесполезна.
15. **Аппаратный фактор** (YubiKey/TPM) как второй keyslot — параноик-режим.

### F. Защита живой сессии
16. **Автолок** по бездействию + при сворачивании/сне (ужесточить существующий).
17. **Duress/паник-пароль** — открывает пустышку или затирает ключи (hidden-volume style).
18. **Anti-dump:** запрет отладчика, очистка clipboard после копирования карт, no-swap секретов.

### G. Целостность, аудит, восстановление
19. **AEAD везде** (AES-256-GCM уже есть) — подмена байта = ошибка, не тихий мусор. Оставляем.
20. **Подписанный append-only аудит-лог** — кто открывал/отзывал/синкал.
21. **Recovery-ключ** — одноразовый keyslot восстанавливает DEK при потере пароля.
22. **Зашифрованный бэкап БД** ключом менеджера, сервер хранит слепой blob.
23. **Явная модель угроз** (см. раздел 2) — против ложного «мы неуязвимы».

### H. Защита канала, сборки, цепочки поставки
24. **Certificate pinning** — воркер знает конкретный серт сервера, MITM невозможен.
25. **Подпись релизов + защищённый автоапдейт** (Tauri updater), приватный ключ офлайн.
26. **Code signing** бинарей (Windows Authenticode) против SmartScreen/подделок.
27. **Clean CI + секреты сборки** в GitHub Secrets, не в репо; воспроизводимость.
28. **Supply-chain:** `cargo audit` + `npm audit` + lock + Dependabot как гейт на PR.
29. **Anti-tamper** — проверка целостности своего кода при старте.
30. **Secure wipe** — `PRAGMA secure_delete=ON` + VACUUM при удалении/отзыве.

## 4. Приоритеты

- **Must (фундамент):** 1 (Argon2id), 4 (KEK/DEK), 6 (полный SQLCipher), 9 (X25519 ключ-на-воркера),
  10 (подписи), 13 (отзыв ключей), 23 (модель угроз).
- **Should:** 3, 8, 16, 20, 21, 22, 24, 25, 28.
- **Nice/параноик:** 5, 11 (Double Ratchet), 15 (YubiKey), 17 (duress), 18, 26, 27, 29, 30.

## 5. Функциональные пункты синхронизации (1–19 из обсуждения)

1. Собрать/выкатить текущие footprint-фиксы (**без релиза пока**).
2. Синк контента заказов наверх (E2E, только менеджер).
3. Зашифрованный бэкап локальной БД на сервер.
4. Курсор/пагинация + confirmed-delete для footprints (сейчас LIMIT 500).
5. Delivery/read receipts для чата.
6. UI-индикатор синка (всё синхронизировано / N в очереди / офлайн).
7. Idempotency-ключи (request_id) на исходящих POST + дедуп на сервере.
8. Экспоненциальный backoff вместо жёсткой паузы 600с после сбоев.
9. Durable-очередь для ВСЕГО исходящего (сейчас только footprints переживают офлайн).
10. Прозрачность телеметрии (что уходит наверх — в настройках + доки).
11. Разрешение конфликтов: менеджер-авторитет + version/updated_at.
12. Версионирование протокола (protocol_version + graceful degradation).
13. Rate-limiting на клиента + батчинг мелких событий.
14. E2E-шифрование payload'ов наверх (не только TLS) — см. раздел 3.D.
15. Серверный аудит-лог синка.
16. Мягкое удаление + tombstones (репликация удалений).
17. [решено] Контент — E2E, только менеджер.
18. [решено] Backfill не нужен (только seed).
19. Автотесты синка: конфликты / офлайн→онлайн / дубли.

## 6. Этапы реализации

- **Этап A — Крипто-фундамент (ПЕРВЫМ, до любого контент-синка):**
  Argon2id (1), KEK/DEK (4), полный SQLCipher (6), X25519 ключ-на-воркера (9),
  Ed25519 подписи (10), отзыв ключей (13), recovery-ключ (21), модель угроз (23).
  Схема БД (воркер+сервер): поля version/updated_at/request_id/tombstone, таблицы ключей/аудита.
- **Этап B — Надёжность транспорта:** durable-очередь (9-func), курсор/ack (4-func),
  backoff (8-func), rate-limit (13-func), idempotency (7-func), версия протокола (12-func).
- **Этап C — Контент вверх:** заказы/статусы E2E (2-func), receipts чата (5-func),
  шифр-бэкап (3-func), конфликты (11-func), tombstones (16-func).
- **Этап D — Прозрачность и канал:** UI-индикатор (6-func), настройки телеметрии (10-func),
  серверный аудит (15-func), cert pinning (24), подпись релизов (25), code signing (26),
  supply-chain гейт (28), secure wipe (30), anti-tamper (29).

## 7. Текущее состояние кода (факт)

- **СДЕЛАНО (в `main`, НЕ собрано, НЕ в клиентах):** near-real-time footprints —
  переочередь статуса заказа (3 пути), пинок потока `wake_sync()`, интервал 120с→30с.
  Файлы: `src-tauri/src/database/_orders.rs`, `background.rs`, `constants.rs`.
- **Текущая крипта:** PBKDF2-SHA256 + AES-256-GCM пополя (`encryption.rs`), SQLCipher-ключ
  существует (`encryption.rs:191`). До «VeraCrypt-grade» не хватает: Argon2id, сплошного
  SQLCipher, E2E/ключ-на-воркера (сейчас E2E между воркером и менеджером НЕТ).
- **ВАЖНО — П.4 (KEK/DEK) уже частично есть:** envelope-схема SEC-005 (`encryption.rs:227+`) —
  DEK случайный, оборачивается password-derived KEK; смена пароля переписывает только обёртку,
  без rekey всей базы. Осталось: перевести KDF обёртки на Argon2id и добавить keyslots (П.5).

### Этап A — прогресс

- **П.1 (Argon2id) в ВОРКЕРЕ — СДЕЛАНО (✅ СКОМПИЛИРОВАНО + ТЕСТЫ ПРОШЛИ ЛОКАЛЬНО):**
  - `Cargo.toml`: добавлена зависимость `argon2 = "0.5"`.
  - `constants.rs`: параметры `ARGON2_MEMORY_KIB=256МиБ`, `ARGON2_TIME_COST=3`,
    `ARGON2_PARALLELISM=1`, `KDF_VERSION_ARGON2ID=2`.
  - `encryption.rs`: `derive_key_argon2id(password, salt, domain)` + 3 юнит-теста.
  - Сделано **аддитивно**: PBKDF2 оставлен для расшифровки legacy-данных. Следующий шаг —
    переключить `derive_db_key`/envelope-wrap на Argon2id с записью `KDF_VERSION` в заголовок
    обёртки (миграция: при первом успешном входе перевернуть на v2).
  - **Проверка (локально, MSVC + cargo):** `cargo test --bins argon2id` → 3 passed; 0 failed
    (240 filtered out), ~55с/тест — memory-hard KDF реально отрабатывает.

- **П.1 (Argon2id) в МЕНЕДЖЕРЕ — СДЕЛАНО (✅ СКОМПИЛИРОВАНО + ТЕСТ ПРОШЁЛ ЛОКАЛЬНО):**
  - `manager-app/src-tauri/Cargo.toml`: `argon2 = "0.5"`.
  - `manager-app/src-tauri/src/crypto.rs`: константы `ARGON2_*` (идентичны воркеру) +
    `derive_key_argon2id()` + тест `deterministic_and_domain_separated`. Единый контракт
    с воркером (П.34 в зачёт).
  - **Проверка:** `cargo test --bins argon2id` → 1 passed; 0 failed (47 filtered out), ~85с.

- **Пред-существующая поломка сборки (не по теме задачи, но чинилась для верификации):**
  в рабочем дереве обнаружен незакоммиченный незавершённый CHAT-функционал (offline-очередь
  `pending`): боевой вызов `chat_insert_outgoing` в офлайн-ветке `commands/chat.rs` не
  передавал новый аргумент `pending` → bin воркера не компилировался вовсе. Добавлен
  `pending=true` (офлайн-сообщение обязано досылаться). Онлайн-ветка уже имела `false`.
- **П.32 (Argon2/scrypt для админ-ключа сервера) — СДЕЛАНО (написано, НЕ задеплоено):**
  - `cc-sync-server/auth.js`: `signingKey()` переведён с одиночного SHA256 на
    `crypto.scryptSync` (N=32768, встроен в Node). Детерминизм сохранён (сессии переживают
    рестарт), результат кэшируется. **Требует redeploy сервера** (не релиз клиента).
    ⚠️ Существующие админ-сессии инвалидируются один раз — надо будет перелогиниться.

- **П.31 (X25519-envelope в воркере) — ✅ УЖЕ РЕАЛИЗОВАН (подтверждено ревью кода):**
  Предположение «воркер не умеет X25519-E2E» оказалось УСТАРЕВШИМ. Воркер имеет полный
  sealed-box в `commands/telemetry.rs`: `seal_envelope`/`unseal_envelope`/`derive_key`
  (+ `generate_x25519` в `commands/slices.rs`), активно используется в chat/pool/slices.
  **Wire-совместимость с менеджером подтверждена построчно:**
  - HKDF_INFO: воркер `b"vb-mgr-telemetry-v1"` == менеджер `b"vb-mgr-telemetry-v1"`;
  - соль HKDF: `recipient_pub || ephemeral_pub` — идентична в обоих;
  - шифр: AES-256-GCM, пустой AAD — идентично;
  - поля конверта: `key_id / ephemeral / nonce / ct` (менеджер — `serde_json::Value`,
    воркер — типизированный `TelemetryEnvelope`, но JSON-поля совпадают → совместимы).
  Крипто-примитив E2E между воркером и менеджером ГОТОВ в обе стороны. Порт НЕ требуется.
  → **Остаётся не крипто, а прикладная обвязка:** заставить воркер запечатывать сам
  КОНТЕНТ ЗАКАЗА (не только телеметрию/чат/срезы) и синкать его E2E — это пункт стадии
  синхронизации (Этап B/C), а не Этапа A.

- **П.10 (Ed25519 подписи) — ПОДТВЕРЖДЕНО: РЕАЛЬНО НЕ СДЕЛАНО (ревью кода):**
  Грепом по обоим клиентам Ed25519/SigningKey/VerifyingKey НЕ найдено. Совпадения в
  воркере (`license.rs`, `auth.rs`, `cards.rs` и т.д.) — это substring («signature» =
  сигнатуры функций, «design»/«assign»), НЕ криптоподписи. В менеджере совпадений нет
  вообще. → П.10 — следующая реальная задача Этапа A. Потребует:
  - зависимость `ed25519-dalek = "2"` в обоих `Cargo.toml`;
  - генерацию keypair устройства (по аналогии с X25519 в `slices.rs`/`crypto.rs`);
  - подпись исходящих sync-полезных нагрузок + проверку на приёме (anti-tamper).
  ВАЖНО: minisign-подпись автоапдейтера (П.25, в `tauri.conf.json`) — это ДРУГОЕ,
  она уже есть; П.10 — подпись данных синка, отдельная инфраструктура.

### Осталось в Этапе A (следующие шаги)
1. ~~Переключить envelope-wrap воркера И менеджера на Argon2id + миграция~~ — ✅ СДЕЛАНО.
2. ~~П.31 — X25519-envelope в воркере~~ — ✅ УЖЕ ГОТОВ (порт не нужен, см. выше).
3. ~~П.10 — Ed25519 крипто-примитивы~~ — ✅ СДЕЛАНО (примитивы + тесты, см. ниже).
4. П.33 — шифрование БД сервера в покое (анализ ниже, реализацию НЕ начинал).
5. П.37 — device-binding ✅ СДЕЛАНО (сервер, оба WS-канала). П.35 — nonce-инфра уже есть, флаг off.

- **П.37 (device-binding) — ✅ РЕАЛИЗОВАНО на сервере (написано, `node --check` OK, НЕ задеплоено):**
  - `socket.js` (Socket.IO middleware): claimed `installation_id` из `handshake.auth`
    или заголовка `x-installation-id`; если задан и ≠ привязанному в `licenses` — реджект
    `device_binding_mismatch` + `registerViolation`. Обратно совместимо (без claim — как раньше).
  - `ws-tauri.js` (raw-WS auth): claimed `msg.installation_id`; если ≠ `auth.installationId`
    — `auth_error: device_binding_mismatch` + close. Обратно совместимо.
  - ✅ Клиенты ДОБАВИЛИ отправку своего `installation_id` в WS-auth (device-binding строгий):
    - воркер `src-tauri/src/ws_sync.rs` — iid из `crate::license::get_or_create_installation_id`
      через `STATE.get()/state.db.lock()`, кладётся в auth-фрейм рядом с `token`/`nonce`.
      `cargo check --bins` OK (1m46s).
    - менеджер `manager-app/src-tauri/src/ws.rs` — iid из `db.get_config("installation_id")`
      через `app.state::<AppState>()`, кладётся в auth-фрейм. `cargo check --bins` OK (50s).
    - Оба обратносовместимы: если iid пустой/недоступен — поле не отправляется, сервер
      работает как раньше (мягкий режим).
- **П.35 (WS-nonce) — ИНФРАСТРУКТУРА УЖЕ ЕСТЬ (raw-WS):** `ws-tauri.js:130-139` —
  `isWsNonceRequired()` + одноразовый `ws.authNonce`, при флаге `ws_require_nonce='1'`
  неверный nonce отклоняется (`bad_nonce`). Осталось: включить флаг после выката клиентов,
  умеющих присылать `msg.nonce` (проверить их поддержку). Ничего дописывать на сервере не надо.

- **П.35/37 (WS-nonce + device-binding) — ИСХОДНЫЙ АНАЛИЗ (для истории):**
  - **Текущая WS-аутентификация** (`socket.js:35-47`): только `token` из
    `handshake.auth.token` (или заголовок `x-license-token`) → `hashToken` → проверка в
    `licenses`. Nonce в самом WS-handshake НЕ применяется (проверка nonce живёт отдельно,
    флаг `ws_require_nonce` в `server_config` default `'0'` — см. `database.js:721`).
  - **`installation_id` уже есть** в схеме (`licenses` PK, `sync_group_members`,
    `worker_heartbeats` и т.д.) и приходит в handshake (`socket.js:83` tokenMap) —
    инфраструктура для device-binding в основном есть, не привязана к WS-аутентификации.
  - **П.37 device-binding (сервер):** при первом WS-подключении зафиксировать
    `installation_id` за токеном лицензии; при последующих — сверять и реджектить
    несовпадение (одна лицензия = одно устройство, антишеринг). Правка в `socket.js`
    middleware + колонка/проверка в `licenses`.
  - **П.35 WS-nonce принудительно:** перевести `ws_require_nonce` в `'1'` и требовать
    подписанный/одноразовый nonce в handshake (защита от replay токена). Требует парной
    правки клиента (воркер `ws-tauri.js` + менеджер `ws.rs`) — компиляция обоих.
  - ⚠️ Кросс-компонентный пункт: сервер + оба клиента. Делать атомарно, иначе клиенты
    отвалятся от сервера. Начинать с обратносовместимого флага (default off), включать
    после выката всех троих.

- **П.33 (шифрование БД сервера в покое) — ✅ РЕАЛИЗОВАНО (написано, `node --check` OK, НЕ задеплоено):**
  - `database.js`: если задан `DB_ENCRYPTION_KEY` — драйвер `better-sqlite3-multiple-ciphers`
    (drop-in) + `PRAGMA key` до любого обращения к данным; без ключа — обычный
    `better-sqlite3` (обратная совместимость, деплой не падает). Ключ — ТОЛЬКО из ENV.
  - **Деплой (разово, отдельно от релиза клиента):**
    1. `cd cc-sync-server && npm i better-sqlite3-multiple-ciphers`
    2. Сгенерировать ключ: `openssl rand -hex 32` → положить в ENV `DB_ENCRYPTION_KEY`
       (systemd unit / `.env`, НЕ в git).
    3. Ре-энкрипт существующего `data.db` (открыть старой sqlcipher-утилитой без ключа →
       `PRAGMA rekey`, либо дамп→импорт в новый зашифрованный файл). Пока БД маленькая (seed).
    4. Перезапустить сервер. ⚠️ БЕЗ шага 3 сервис не откроет старый нешифрованный файл
       зашифрованным драйвером.
  - Что защищает: метаданные (лицензии, footprints, audit_log, heartbeats, invite_codes).
    Контент карт/заказов и так E2E-шифротекст.

- **П.33 — ПРЕЖНИЙ анализ (для истории):**
  - Драйвер: `better-sqlite3 ^12.11.1` (`database.js:1`) — **чистый SQLite без SQLCipher**.
    Файл `data.db` (`DB_PATH`, `database.js:5`), `journal_mode=WAL`.
  - Что уже защищено: контент карт/заказов лежит как **E2E-шифротекст** (`sync_cards.
    encrypted_data`, `manager_keys` и т.п.) — сервер слепой. At-rest-шифрование БД защитит
    в основном **метаданные**: лицензии, footprints, audit_log, heartbeats, invite_codes.
  - **Два пути (выбрать в следующем прогоне):**
    1. **`better-sqlite3-multiple-ciphers`** — drop-in замена, тот же API + `db.pragma(
       "key='...'")` (SQLCipher/wxSQLite3). Минимальный код, но пересборка нативного модуля
       на VPS и один разовый ре-энкрипт `data.db`. **Рекомендуется.**
    2. LUKS/dm-crypt на диске VPS — вне кода, но защищает только от «унесли диск», не от
       доступа к живому процессу. Можно как дополнение.
  - Ключ БД — из ENV (`DB_ENCRYPTION_KEY`), НЕ в репозитории. При деплое — разовый ре-энкрипт
    существующего `data.db` (`sqlcipher_export` или дамп→импорт). ⚠️ требует отдельного
    redeploy, как и П.32.

- **П.10 (Ed25519) — крипто-примитивы ГОТОВЫ (✅ СКОМПИЛИРОВАНО + ТЕСТЫ ПРОШЛИ):**
  - Зависимость `ed25519-dalek = "2"` (feature `rand_core`) в обоих `Cargo.toml`.
  - Воркер `commands/telemetry.rs`: `generate_ed25519`/`ed25519_pub_from_seed`/
    `ed25519_sign`/`ed25519_verify` + тест `sign_verify_roundtrip_and_tamper`.
  - Менеджер `crypto.rs`: те же 4 функции + идентичный тест. **Единый контракт:**
    seed/pub — hex(32), подпись — hex(64), тот же примитив в обоих.
  - **Проверка:** `cargo test --bins ed25519` → воркер 1 passed (2м58с сборка),
    менеджер 1 passed (2м19с). Тест ловит и roundtrip, и подделку сообщения, и чужой ключ.
  - **Осталась прикладная обвязка (Этап B/C, НЕ A):** генерить seed устройства в config-KV,
    публиковать pub на сервер, подписывать исходящий sync-payload и проверять на приёме.
    Примитив к этому готов.

- **Ещё одна пред-существующая поломка (не моя, чинилась для верификации):** второй боевой
  вызов в `commands/chat.rs` (offline-flush, `try_online_send`/`chat_insert_outgoing`
  ~строки 987/450) — часть того же незакоммиченного CHAT-фичи; в актуальном дереве
  компилируется (ошибка в логе была из битой сборки с дублем ключа в Cargo.toml,
  который я удалил).
3. П.10 — Ed25519 подписи в обоих клиентах.
4. П.33 — шифрование БД сервера в покое.
5. П.35/37 — включить WS-nonce принудительно + device-binding на WS.
- **E2E наверх сейчас нет** — контент заказов вообще не уходит, только хэш-футпринты.

---

## ЭТАП B — E2E-синхронизация контента заказов (КОД НАПИСАН и КОМПИЛИРУЕТСЯ; НЕ закоммичен, сервер НЕ задеплоен)

### СТАТУС РЕАЛИЗАЦИИ (обновлено)
Все три компонента написаны и проходят проверку сборки. НЕ закоммичено, сервер НЕ передеплоен, сквозной E2E-прогон на живой БД НЕ выполнялся.

- **Сервер `cc-sync-server/` — готов, `node --check` OK по всем файлам:**
  - `database.js`: миграция **v30** — таблица `issued_order_slices` (зеркало issued_card_slices,
    направление воркер→менеджер): `id, order_ref, source_iid, target_iid, key_id, order_hash,
    sealed_data, status(pending/delivered/ack/revoked), created_at/updated_at/delivered_at/
    acked_at/revoked_at`, `UNIQUE(order_ref, source_iid)`, 2 индекса. `PRAGMA user_version=30`.
  - `routes/worker-orders.js` (новый): `GET /sync/manager-key` (workerRouter,
    `resolveManagerKeyForWorker`), `POST /sync/orders/upload` (workerRouter, upsert по
    (order_ref, source_iid)→pending, MAX_SEALED_LEN=64КБ), `GET /manager/api/orders/inbox`
    (managerRouter, pending+delivered→mark delivered), `POST /manager/api/orders/ack`.
  - `index.js`: смонтирован `managerRouter`→`/manager/api`, `workerRouter`→`/sync`.
- **Воркер `src-tauri/` — готов, `cargo check --bins` OK:**
  - `database/_migrations.rs`: `LATEST_VERSION` 33→**34**, `migration_v34` — таблица
    `order_sync_queue(order_id PK→orders(id) ON DELETE CASCADE, synced, updated_at)` + индекс.
  - `database/_orders.rs`: enqueue в `create_order` и `requeue_footprint_status`; методы
    `enqueue_order_sync`, `get_unsynced_order_ids`, `mark_order_synced`, `build_order_e2e_payload`
    (JSON: v=1, order_id, order_number, status, items_json, total_amount, tracking_number,
    carrier, notes, created_at, updated_at).
  - `commands/slices.rs`: `fetch_manager_key` (GET /sync/manager-key, кэш в config-KV),
    `sync_orders` (build payload→seal_envelope под pub менеджера→батч POST /sync/orders/upload→
    mark_order_synced).
  - `sync.rs`: `SyncClient::sync_orders`; `background.rs`: вызов в sync-цикле (emit
    "sync_completed" type=orders, ошибки не влияют на счётчик сбоев футпринтов).
- **Менеджер `manager-app/` — готов, `cargo check --bins` OK + `vite build` OK:**
  - `src-tauri/src/db.rs`: таблица `synced_orders(server_slice_id PK, source_iid, order_ref,
    payload, order_number, status, total_amount, tracking_number, carrier, notes, created_at,
    updated_at, received_at, UNIQUE(source_iid, order_ref))` + индекс.
  - `src-tauri/src/telemetry.rs`: `fetch_worker_orders` (GET inbox→unseal_envelope→upsert
    synced_orders→POST ack), вызывается внутри `sync()`; в ответ sync добавлены `orders_synced`,
    `order_unseal_failures`. Функция чтения `synced_orders(db, iid?)`.
  - `src-tauri/src/commands.rs` + `main.rs`: Tauri-команда `get_synced_orders`.
  - **UI (Этап C выполнен):** `src/pages/Orders.jsx` (список E2E-заказов + фильтр по воркеру +
    модалка деталей), регистрация в `Shell.jsx` (nav `orders`), i18n `nav_orders`+ключи заказов
    (ru/en), API-обёртка `getSyncedOrders`.

### СЛЕДУЮЩИЙ КОНКРЕТНЫЙ ШАГ (после Этапа B)
Сквозной прогон E2E на живой БД (сервер задеплоить, воркер создаёт заказ → менеджер видит
расшифрованный контент). Затем — следующие этапы 38-пунктного плана. Деплой и коммиты — по
явному решению пользователя (жёсткий констрейнт: НЕ собирать релиз / НЕ ставить теги).

---

## ЭТАП B — исходная РАЗВЕДКА (архив, ниже — как планировалось)

### Ключевой факт по направлению (важно, легко ошибиться)
Существующий slice-механизм (issued_card_slices / issued_asset_slices) работает
**менеджер → воркер**: менеджер `seal_envelope` под pub-ключ воркера, воркер `unseal`.
Контент заказов по решению пользователя идёт **в обратную сторону — воркер → менеджер**:
шифрует воркер под pub-ключ МЕНЕДЖЕРА, читает только менеджер, сервер слепой.
Значит Этап B = **зеркало** существующего паттерна, а не его копия 1:1.

### Что уже есть в коде (переиспользуем, НЕ пишем заново)
- X25519-конверт `TelemetryEnvelope { key_id, ephemeral, nonce, ct }`
  (`src-tauri/src/commands/telemetry.rs:28-32`), `seal_envelope`/`unseal_envelope`
  идентичны в воркере (telemetry.rs) и менеджере (`manager-app/src-tauri/src/crypto.rs`).
  HKDF_INFO=`b"vb-mgr-telemetry-v1"`, соль recipient||ephemeral, AES-256-GCM.
- Раздача pub-ключей через REST:
  - воркер публикует свой pub: `POST /sync/worker-key/register`
    (`commands/slices.rs:70-86,195-210` → сервер `routes/worker-cards.js:167-186`
    → таблица `worker_keys` v16, `database.js:406-419`).
  - менеджер публикует свой pub: `POST /manager/api/keys` (`manager-api.js:668-690`
    → `manager_keys` v11, `database.js:227-237`). Ротация: старые `is_active=0, revoked_at`.
  - менеджер забирает pub-ключи воркеров: `GET /manager/api/workers/keys`
    (`manager-api.js:649-664`).
  - ⚠️ **ПРОБЕЛ:** воркер сейчас НЕ забирает pub-ключ менеджера (не нужен был — слайсы
    шли к воркеру). Для заказов воркеру НУЖЕН pub менеджера → добавить роут
    `GET /sync/manager-key` (отдаёт активный manager_keys.pubkey + key_id) и клиентский
    запрос в воркере (кэш в config-KV, обновлять при ротации/при key_id-mismatch).
- Футпринты заказа уже уходят слепо: воркер `record_order_footprint`
  (`database/_orders.rs:88-157`) → `sync_footprints` (`sync.rs:37-190`) →
  `POST /footprint` → таблица `footprints`. Остаются ВНЕ E2E (сервер видит хэши).
- Схема заказа воркера: `orders` (`_migrations.rs:215-234`) — profile_id, shop_id,
  drop_id, email_pool_id, proxy_id, order_number, status, **items_json**, total_amount,
  tracking_number, carrier, notes, created_at, updated_at.
- Менеджер локальной таблицы заказов НЕ имеет (`db.rs` — только config/snapshots/reports/
  card_vault/chat...). Нужна новая таблица кэша расшифрованных заказов.

### Классификация полей заказа
- **E2E (шифруется, сервер слепой):** items_json, total_amount, notes,
  order_number (если считаем чувствительным — уточнить), tracking_number, carrier.
- **Открытые футпринты/метаданные (как сейчас, хэши):** email_hash, ip_hash, drop_hash,
  bin, phone_hash, name_hash, shop_domain, status, created_at/updated_at, installation_id.

### План шагов-коммитов Этапа B (каждый оставляет проект компилируемым)
Порядок выката: сервер → воркер → менеджер (все аддитивно, обратносовместимо).
1. **Сервер БД:** миграция `issued_order_slices` (зеркало issued_asset_slices, но
   направление worker→manager): `order_id/order_ref, source_iid (воркер-автор),
   target_manager_iid, key_id, sealed_data, order_hash (футпринт-связка), status
   pending/delivered/ack/revoked, created_at/...`. UNIQUE(order_ref, source_iid).
2. **Сервер роут `GET /sync/manager-key`** — воркер получает активный pub менеджера+key_id.
3. **Сервер роуты заказов:** `POST /sync/orders/upload` (воркер шлёт запечатанный срез,
   сервер хранит как есть), `GET /manager/api/orders/inbox` (менеджер забирает
   pending), `POST /manager/api/orders/ack`. По аналогии с worker-cards.js/worker-assets.js,
   но зеркально по направлению.
4. **Воркер:** клиент `GET /sync/manager-key` + кэш (config-KV). Функция
   `seal_order_for_manager(order)` — собрать E2E-payload, `seal_envelope(key_id, json,
   manager_pub)`, положить в локальную очередь `order_sync_queue`. Точка вызова — после
   `insert_order` (`_orders.rs:70-77`), рядом с record_order_footprint.
5. **Воркер:** `sync.rs::sync_orders()` — отправка очереди на `POST /sync/orders/upload`,
   пометка synced (аналог sync_footprints). Разбудить через wake_sync.
6. **Менеджер:** таблица `synced_orders` (db.rs), Tauri-команда `fetch_worker_orders`
   (`GET /manager/api/orders/inbox`) → `unseal_envelope(mgr_priv, sealed)` → кэш +
   `POST /manager/api/orders/ack`.
7. **Менеджер UI:** список заказов по воркеру (React) — Этап C.

### Риски
- **Направление конверта:** worker→manager — воркеру нужен pub менеджера (пробел выше).
  Убедиться, что seal/unseal контракт симметричен (он симметричен по построению X25519).
- Ротация ключа менеджера: key_id в конверте; сервер держит overlap активных manager_keys,
  воркер при ack-fail/refetch перечитывает актуальный key_id.
- Размер sealed_data (items_json несколько КБ) — норм для TEXT/base64.
- Авторитет менеджера при конфликте — заказы идут только вверх (воркер-источник), менеджер
  read-only по контенту; конфликтов контента почти нет, статусы разруливает менеджер.

### СЛЕДУЮЩИЙ КОНКРЕТНЫЙ ШАГ
Начать с коммита 1+2 на сервере (миграция `issued_order_slices` + роут `GET /sync/manager-key`),
`node --check`. Затем воркер (коммит 4-5), затем менеджер (коммит 6). НЕ деплоить — только код.
