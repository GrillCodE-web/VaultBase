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

### /manager/api (Bearer token, role=manager)

| Метод и путь                                            | Назначение                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET `/overview`                                         | счётчики: воркеры/онлайн/баны/алерты/новости/карты/группы/футпринты                                                      |
| GET `/workers`                                          | лицензии + последний heartbeat (конверт) + политика                                                                      |
| POST `/workers/:iid/policy`                             | бан/причина/до, квоты cards/orders, permissions_override (JSON bool), min_version, version_exempt (разлок), force_logout |
| POST `/workers/:iid/force-logout`                       | одномоментный force_logout=1                                                                                             |
| GET/POST `/news`, PATCH/DELETE `/news/:id`              | черновики и правки                                                                                                       |
| POST `/news/:id/publish` \| `/unpublish`                | публикация → WS-broadcast `news` всем воркерам                                                                           |
| GET `/news/:id/readers`                                 | кто прочитал + размер аудитории                                                                                          |
| GET `/alerts?status=`, POST `/alerts/:id/ack`\|`/close` | алерты и их жизненный цикл                                                                                               |
| GET/POST/PATCH/DELETE `/priorities`                     | приоритеты магазинов (target: `\|iid:<id>\|role:operator\|role:admin`, weight 1–10)                                      |
| POST `/keys` (ротация), GET `/keys`                     | менеджерские X25519-ключи                                                                                                |
| GET `/reports?from&to&kind`                             | зашифрованные отчёты (ciphertext)                                                                                        |
| GET `/groups`, GET `/releases`                          | только счётчики/метаданные                                                                                               |

### /api/telemetry (Bearer token, роль worker — manager запрещён)

| Метод и путь                                          | Назначение                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST `/heartbeat` `{envelopes:[…]}` (`X-App-Version`) | heartbeat; ответ `{policy, update_required}`; `ack_force_logout:true` сбрасывает флаг   |
| POST `/report` `{kind, date, envelopes}`              | kind ∈ `daily_stats`, `activity_tail`; уникальность (iid, kind, date) — повтор заменяет |
| GET `/keys`                                           | активные менеджерские публичные ключи                                                   |
| GET `/policy`                                         | своя политика                                                                           |
| GET `/news`, POST `/news/:id/read`                    | новости по таргетингу + отметки о прочтении                                             |
| GET `/priorities`                                     | применимые приоритеты магазинов                                                         |

### Прочее

- `GET /update?app=manager&current_version=x.y.z` — канал апдейтера менеджера:
  строки `release_files` с `file_type='manager-updater'` (worker-канал без изменений).
- WS воркерам: сервер шлёт `{"type":"policy_update"}` адресно (по iid) и
  `{"type":"news", "news":{id,severity,title,published_at}}` broadcast.
- Alerts-engine (60 c): offline > `MANAGER_OFFLINE_MINUTES` (10 по умолчанию) → алерт
  `worker_offline` (dedupe по эпизоду `offline:<iid>:<last_seen>`), возврат онлайн закрывает.

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
   расшифрованных отчётах (фаза 3 — движок правил в `manager-app`).

## 6. Ограничения текущей версии (0.1.0)

- Менеджерский Tauri-апдейтер: эндпоинт готов, плагин обновления в бинарь не включён
  (включается в фазе 2 вместе с отдельным signing key).
- Аналитика работает по факту появления отчётов; пока воркер не шлёт телеметрию — пустые
  состояния (заложены в UI).
- Список лицензий/создание менеджерских лицензий — только через веб-админку сервера
  (`role=manager` в форме создания лицензии уже поддержано моделью БД).
  Из manager-app лицензии не создаются (MGR-010 отменён: сервер — тупой relay,
  без админ-API).
- WS для менеджер-приложения (live-feed) — опрос 30 с (轮будет заменён на WS в фазе 3).
- Токены в БД сервера по-прежнему хранятся как есть (sha-256-хеширование — фаза 2,
  см. ROADMAP в MASTER_CHECKLIST MGR-008).
- Kill-switch деплоя, шифрованные бэкапы БД сервера, серверная ротация ключей
  менеджера — план MGR-008+.

## 7. Проверки

- Сервер: `cd cc-sync-server && npm test` — 18 интеграционных тестов
  (роли, бан на всех каналах, конверты, новости+таргетинг+прочтения, приоритеты,
  алерты, аудит).
- Менеджер-приложение: `cd manager-app && npm run lint && npm run build`
  (0 error), `cd manager-app/src-tauri && cargo test` (unit: crypto roundtrip,
  sidecar, SQLCipher-миграция, challenge).
- Сборка на машине: toolchain GNU (`rust-toolchain.toml`), для dlltool в PATH нужен
  `C:\msys64\mingw64\bin`.
