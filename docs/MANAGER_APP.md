# VaultBase Manager — второе приложение (наблюдатель/управленец)

> Спецификация и контракт интеграции. Версия 0.1.0, 2026-08-25. Код: `manager-app/` (Tauri 2),
> серверное ядро в `cc-sync-server/` (миграция v11). Русская версия — первоисточник.

## 1. Назначение

VaultBase Manager — отдельное десктоп-приложение для тех, кто **смотрит и управляет**:
статистика и аналитика по всем воркерам, алерты, новости, приоритеты магазинов, политики
пользователей (баны/квоты/права/версии), контроль здоровья. Без доступа к сырым картам:
ключи групп карт (`sync_cards.enc_*`) менеджеру **не выдаются**, PAN/card-данные в
менеджерское приложение не попадают никогда — только агрегаты и счётчики, расшифрованные
E2E-конвертами.

Отдельный бинарь, отдельный identifier (`com.vaultbase.manager`), отдельная SQLCipher-база,
отдельный каталог данных `%APPDATA%/VaultBaseManager`.

## 2. Безопасность

### 2.1 Аутентификация — та же схема, что у воркера

1. Первый запуск: генерируются `installation_id` (`MGR-` + hex16) и `challenge`
   (SHA-256(iid | epoch_hour | rand8), hex32, uppercase) — хранятся в локальной БД.
2. Администратор регистрирует лицензию в админ-панели сервера c этим challenge и
   **role = `manager`**, возвращает `activation_key`.
3. `POST /activate {installation_id, challenge, activation_key}` → `{token, role}`.
   Приложение принимает только роли `manager` и `admin`.
4. Установка мастер-пароля → перевод открытой БД в SQLCipher (PBKDF2-SHA256,
   **1 000 000 итераций**, соль 32 байта, домен-сепарация `vaultbase-mgr-dek-v1`).
   DEK (32 random байта) оборачивается KEK от пароля и хранится в сайдкаре
   `vaultbase-manager.db.sidecar.json` (аналог SEC-005 воркера).
5. Дальше — unlock по мастер-паролю. Токен лицензии лежит только внутри зашифрованной БД
   и наружу не отдаётся (HTTP делает Rust-слой).

### 2.2 E2E-шифрование телеметрии (sealed box)

Обязательный контракт для воркер-стороны (поток backend/frontend).

Ключи: каждый менеджер генерирует X25519-пару; приватный ключ — только в его локальной
зашифрованной БД, публичный загружается на сервер (`POST /manager/api/keys`) и хранится в
`manager_keys` (ротация деактивирует прежние ключи менеджера).

Алгоритм запечатывания payload для менеджера с публичным ключом `B`:

1. Отправитель (воркер) генерирует эфемерный X25519 `(e, E)`.
2. `shared = X25519(e, B)`; `salt = B || E` (64 байта).
3. `key = HKDF-SHA256(ikm=shared, salt=salt, info=b"vb-mgr-telemetry-v1", L=32)`.
4. `ct = AES-256-GCM(key, nonce=12 random bytes, plaintext=UTF8-JSON)`.
5. Конверт: `{"key_id": <int id из manager_keys>, "ephemeral": hex(E),
"nonce": hex(12), "ct": base64(ct)}`.

Воркер отправляет массив конвертов — по одному на **каждый активный** менеджерский ключ
(`GET /api/telemetry/keys`), т.е. при нескольких менеджерах каждый прочитает свой.
Сервер хранит только ciphertext: `worker_heartbeats.envelope`, `stats_reports.envelopes`.
Реализация референс: `manager-app/src-tauri/src/crypto.rs` (seal_envelope/unseal_envelope,
unit-тесты на roundtrip).

HEARTBEAT: поддерживает частичное шифрование метаданных — `last_seen` (тайминг) пишется
plaintext-полем (единственная не-PII метка, нужна для offline-детектора), содержимое — конвертом.

### 2.3 Границы доверия

- Менеджер НЕ получает ключи групп карт (issue парных кодов для него не существует).
- Менеджерская лицензия не пускается в WS card-sync (`manager_ws_forbidden`).
- Бан воркера (`worker_policies.banned`) режет ВСЕ каналы: REST (`/sync`, `/footprints`,
  `/catalog`), WS и телеметрию — везде `403 {error:'banned', reason, policy}`.
- Все действия менеджера пишутся в `audit_log` (`manager_*`).

## 3. Серверные API

### /manager/api (Bearer token, role=manager или admin)

Роль `admin` — manager-side (с 2026-09-03): пускается на все менеджерские
каналы, kill-switch и воркерские баны её не касаются. В чате admin с активным
manager-ключом виден воркерам как менеджер (пир с role='manager'), писать ему
можно без общей группы; конверт принимается и на manager-ключ, и на worker-ключ
(та же лицензия может стоять на воркерской машине саппорта). Новости с
`target_role='manager'` через `/api/telemetry/news` получают роли manager и
admin (воркер-оператор — нет).

| Метод и путь                                            | Назначение                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/overview`                                         | счётчики: воркеры/онлайн/баны/алерты/новости/карты/группы/футпринты                                                                                       |
| GET `/workers`                                          | лицензии + последний heartbeat (конверт) + политика                                                                                                       |
| POST `/workers/:iid/policy`                             | бан/причина/до, квоты cards/orders, permissions_override (JSON bool), min_version, version_exempt (разлок), force_logout                                  |
| POST `/workers/:iid/force-logout`                       | одномоментный force_logout=1                                                                                                                              |
| GET/POST `/news`, PATCH/DELETE `/news/:id`              | черновики и правки                                                                                                                                        |
| POST `/news/:id/publish` \| `/unpublish`                | публикация → WS-broadcast `news` всем воркерам                                                                                                            |
| GET `/news/:id/readers`                                 | кто прочитал + размер аудитории                                                                                                                           |
| GET `/alerts?status=`, POST `/alerts/:id/ack`\|`/close` | алерты и их жизненный цикл                                                                                                                                |
| GET/POST/PATCH/DELETE `/priorities`                     | приоритеты магазинов (target: `\|iid:<id>\|role:operator\|role:admin`, weight 1–10)                                                                       |
| POST `/keys` (ротация), GET `/keys`                     | менеджерские X25519-ключи                                                                                                                                 |
| GET `/reports?from&to&kind`                             | зашифрованные отчёты (ciphertext)                                                                                                                         |
| GET `/groups`, GET `/releases`                          | только счётчики/метаданные                                                                                                                                |
| GET `/licenses`                                         | список лицензий: label/role/is_active/даты, `token_issued` + маскированный префикс хеша (открытых токенов нет), бан из политики                           |
| POST `/licenses`                                        | регистрация лицензии (installation_id + challenge, role `operator`\|`manager`); ответ — `activation_key` (деривация как в админке)                        |
| PATCH `/licenses/:iid`                                  | правка label/role (свою роль менять нельзя, `admin` — только в админке)                                                                                   |
| POST `/licenses/:iid/revoke` \| `/restore`              | деактивация (токен мёртв сразу, себя отозвать нельзя) / восстановление                                                                                    |
| PATCH `/releases/:version`                              | staged rollout manager-релиза: `{ channel?: stable\|beta, rollout_percent?: 0..100 }` (только file_type=manager-updater, аудит `manager_release_rollout`) |

### /api/telemetry (Bearer token, роль worker — manager запрещён)

| Метод и путь                                          | Назначение                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST `/heartbeat` `{envelopes:[…]}` (`X-App-Version`) | heartbeat; ответ `{policy, update_required}`; `ack_force_logout:true` сбрасывает флаг   |
| POST `/report` `{kind, date, envelopes}`              | kind ∈ `daily_stats`, `activity_tail`; уникальность (iid, kind, date) — повтор заменяет |
| GET `/keys`                                           | активные менеджерские публичные ключи                                                   |
| GET `/policy`                                         | своя политика                                                                           |
| GET `/news`, POST `/news/:id/read`                    | новости по таргетингу + отметки о прочтении                                             |
| GET `/priorities`                                     | применимые приоритеты магазинов                                                         |

### Пул карт с самообслуживанием (REDESIGN-05-5B1)

Дополняет адресную выдачу `POST /cards/issue`: менеджер заливает срезы в общий
пул, воркеры бронируют сами. Криптоконтракт:

- **Ключ пула** — случайные 32 байта, генерируются менеджером локально. Каждому
  воркеру шлётся `sealed_key` — тот же sealed-box конверт, что у срезов/
  телеметрии (`{key_id, ephemeral, nonce, ct}`, base64-поля), payload =
  hex(32 байта ключа пула), запечатан активным X25519-пубключом воркера из
  `worker_keys`.
- **Срез пула** — `sealed_data = base64(nonce[12] || AES-256-GCM(key=pool_key,
plaintext=payload))`, где payload — тот же JSON, что у адресной выдачи
  (`{v, card_hash, pan, exp, cvv?, extra, issued_at}`).
- Сервер хранит только шифротекст: ни срезы, ни ключ пула ему недоступны.

Жизненный цикл среза: `pooled → reserved → ack`; из `reserved` — `release`
(воркер вернул) / TTL-сгорание `CARD_POOL_RESERVE_TTL_HOURS` (24 ч по умолчанию)
/ `revoke` (менеджер изъял); из `ack` — outcome `used|burned` либо
менеджерский `return`. Сгоревшие карты в пул НЕ возвращаются (данные мертвы).

| Метод и путь (менеджер)              | Назначение                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/cards/pool/keys`              | `{label?, shares:[{installation_id, sealed_key}]}` — новый активный ключ, прежний ротируется (старые срезы остаются под старым ключом)                    |
| GET `/cards/pool/keys`               | ключи + кому розданы (label воркеров)                                                                                                                     |
| POST `/cards/pool/keys/:id/shares`   | дораздать существующий ключ новому воркеру                                                                                                                |
| POST `/cards/pool/upload`            | `{key_id, slices:[{card_hash, sealed_data}]}` ≤100; конфликт по `card_hash`: свободные/отозванные перезаписываются, занятые пропускаются (`skipped_busy`) |
| GET `/cards/pool?status&reserved_by` | «кто что взял, когда, статус» + counts; `sealed_data` не возвращается                                                                                     |
| POST `/cards/pool/revoke` `{ids}`    | изъять `pooled`/`reserved`                                                                                                                                |
| POST `/cards/pool/return` `{ids}`    | принудительно вернуть `reserved`/`ack` в пул (локальную карту у воркера не удаляет)                                                                       |

| Метод и путь (воркер)           | Назначение                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/sync/cards/pool/key`      | мой запечатанный share активного ключа (`{key_id, sealed_key}` или nulls)                                                                 |
| GET `/sync/cards/pool`          | `{available, mine}`; `sealed_data` — только у `reserved` (at-least-once до ack)                                                           |
| POST `/sync/cards/pool/reserve` | `{count}` ≤50; пауза → 403 `worker_paused`, квота → 429 (в квоту идут и адресные выдачи, и брони за сутки; release/TTL квоту освобождают) |
| POST `/sync/cards/pool/ack`     | `{ids}` — импорт подтверждён                                                                                                              |
| POST `/sync/cards/pool/release` | `{ids}` — вернуть неиспользованную бронь                                                                                                  |
| POST `/sync/cards/pool/outcome` | `{ids, outcome: used                                                                                                                      | burned}` по подтверждённым; повтор не перезаписывает |

Изменения пула эмитят `manager:pool_update` в Socket.IO (фронт менеджера
перезапрашивает список). Локально воркер связывает карту со срезом через
таблицу `card_pool_links` (миграция v24) — серверный `card_hash` менеджера
солёный и в локальную схему не переносится.

### Прочее

- `GET /update?app=manager&current_version=x.y.z` — канал апдейтера менеджера:
  строки `release_files` с `file_type='manager-updater'` (worker-канал без изменений).
- WS воркерам: сервер шлёт `{"type":"policy_update"}` адресно (по iid) и
  `{"type":"news", "news":{id,severity,title,published_at}}` broadcast.
- Alerts-engine (60 c): offline > `MANAGER_OFFLINE_MINUTES` (10 по умолчанию) → алерт
  `worker_offline` (dedupe по эпизоду `offline:<iid>:<last_seen>`), возврат онлайн закрывает.
- Retention-engine (1 ч, MGR-021): чистит транзитные данные — `stats_reports` по
  `report_date` старше `TELEMETRY_RETENTION_DAYS` (45 по умолчанию) и
  `worker_heartbeat_history` старше `HB_HISTORY_RETENTION_DAYS` (30). Менеджер хранит
  расшифрованные отчёты локально + месячные rollups, поэтому серверная копия нужна
  только как буфер доставки. `worker_heartbeats` (последний конверт на воркера) не чистится.

## 4. Формат daily_stats (контракт воркер → менеджер)

Собирается воркером раз в сутки за дату, запечатывается конвертами:

```json
{
  "date": "2026-08-25",
  "app_version": "2.11.3",
  "orders": {
    "total": 0,
    "by_status": { "pending": 0, "shipped": 0, "delivered": 0, "declined": 0, "cancelled": 0 }
  },
  "cards": { "taken": 0, "used": 0, "dead": 0, "by_bin": { "411111": { "used": 0, "dead": 0 } } },
  "drops": { "taken": 0, "by_destination": { "shop.example.com": 0 } },
  "shops": {
    "shop.example.com": {
      "orders": 0,
      "delivered": 0,
      "declined": 0,
      "cancelled": 0,
      "revenue": 0.0
    }
  },
  "health": {
    "imap_ok": 0,
    "imap_fail": 0,
    "smtp_ok": 0,
    "smtp_fail": 0,
    "proxy_ok": 0,
    "proxy_fail": 0
  },
  "sync": { "ws_ok": true, "push_ok": 0, "push_fail": 0 }
}
```

Payload heartbeat (в конверте):

```json
{"ts": "ISO", "app_version": "…", "platform": "windows",
 "sync_ws": "ok|down", "db_ok": true,
 "imap_ok": true|null, "smtp_ok": true|null, "proxy_ok": true|null, "errors_24h": 0}
```

### 4.1 Версионирование и контракт-тесты (MGR-021)

Оба payload'а несут `payload_version` (текущая: **2**) и `worker_sent_at`.
Правило: любое изменение набора полей = бамп версии. Это зафиксировано тестами:

- **Golden** (`src-tauri/.../telemetry.rs::test_contract_golden_payload_v2`) —
  пинит полный набор ключей heartbeat и daily_stats; дрейф схемы без бампа
  версии роняет CI воркера.
- **Матрица** (`manager-app/.../telemetry.rs::contract_*_payload_tolerated`) —
  «старый воркер → новый менеджер» (v1 без `bin_shop`/`sla`/`by_user`/`pool`:
  дефолты 0, без паник) и «новый воркер → старый менеджер» (v99 + неизвестные
  поля: неизвестное игнорируется, известное парсится как обычно).

## 5. Интеграция воркер-приложения (фаза 2, поток backend/frontend)

1. `commands/telemetry.rs` (новый): heartbeat каждые N минут (по умолчанию 5) —
   собрать payload, получить `GET /api/telemetry/keys`, запечатать конверты,
   POST с `X-App-Version`; обработать `403 banned` → лок-приложение с причиной;
   `update_required=true` → блокирующий экран «обнови приложение» (кроме version_exempt);
   `policy.force_logout=1` → разлогин + `ack_force_logout:true` на следующем heartbeat.
2. Сборка `daily_stats` за прошедшие сутки из локальной SQLite (таблицы cards/orders/drops)
   в 00:05 локального времени + немедленный resend при старте, если вчерашний не отправлен.
3. Применение `permissions_override` (мерж поверх `models::perms`) и квот.
4. UI: новости (баннером по severity), приоритеты магазинов (сортировка каталога по весу),
   причину бана — на экране лока.
5. Числовые алерты (спайк деклайна, dead-ratio, квоты) считаются в менеджер-аппе на
   расшифрованных отчётах — движок правил `manager-app/src-tauri/src/alerts.rs`
   (MGR-007): локальная таблица `local_alerts` с дедупом, OS-уведомления при активной
   сессии, опциональный generic webhook. БЕЗ Telegram.

## 6. Ограничения текущей версии (0.1.0)

- Менеджерский Tauri-апдейтер: эндпоинт готов, плагин обновления в бинарь не включён
  (включается в фазе 2 вместе с отдельным signing key).
- Аналитика работает по факту появления отчётов; пока воркер не шлёт телеметрию — пустые
  состояния (заложены в UI).
- Управление лицензиями (MGR-010) выполнено: список, создание (operator/manager),
  переименование, деактивация/восстановление — прямо из manager-app (страница
  «Лицензии»). Создание `role=admin` и ротация токена намеренно остаются только
  в веб-админке сервера. Открытые токены менеджеру не показываются — только факт
  выдачи и префикс хеша (MGR-008).
- Self-update (MGR-009) выполнен: tauri-plugin-updater с ОТДЕЛЬНЫМ ключом
  подписи (`.secrets/vaultbase-manager-updater.key`, pubkey — в
  `manager-app/src-tauri/tauri.conf.json`). Проверка/установка — команды
  `check_app_update`/`install_app_update` (страница «Апдейты» → «Это
  приложение»): эндпоинт строится в рантайме с `channel` (stable|beta, в
  config `update_channel`) и `installation_id`. Сервер `/update?app=manager`
  применяет staged rollout: beta-клиент видит beta+stable, stable — только
  stable; `rollout_percent` — детерминированный бакет `sha256(iid:version) %
100 < pct`, без iid доступны только 100%-релизы; клиенту отдаётся самая
  новая версия, для которой он видим и допущен. Управление каналом/процентом —
  PATCH `/manager/api/releases/:version` или страница «Апдейты».
- WS для менеджер-приложения (live-feed) — опрос 30 с (轮будет заменён на WS в фазе 3).
- Сервер-харденинг (MGR-008) выполнен: токены лицензий и user_token в footprints
  хранятся только как SHA-256 (миграция v13), kill-switch деплоя глушит
  воркерские каналы и раздачу обновлений (менеджеры/админка продолжают работать),
  WS-аутентификация защищена одноразовым nonce (флаг `ws_require_nonce`, пока
  выкл — включить после обновления флота воркеров).
- Шифрованные бэкапы БД сервера осознанно НЕ делаются (бэкап = вторая копия
  данных и риск компрометации); серверная ротация ключей менеджера — план MGR-009+.

## 7. Проверки

- Сервер: `cd cc-sync-server && npm test` — 81 интеграционный тест
  (роли, бан на всех каналах, конверты, новости+таргетинг+прочтения, приоритеты,
  алерты, аудит, админ-сессии, rate-limit, WS: nonce-anti-replay и kill-switch,
  CRUD лицензий менеджером).
- Менеджер-приложение: `cd manager-app && npm run lint && npm run build`
  (0 error), `cd manager-app/src-tauri && cargo test` (unit: crypto roundtrip,
  sidecar, SQLCipher-миграция, challenge).
- Сборка на машине: toolchain GNU (`rust-toolchain.toml`), для dlltool в PATH нужен
  `C:\msys64\mingw64\bin`.
