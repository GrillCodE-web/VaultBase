# Staging-полигон (DEVOPS-002)

Staging — это полигон, на котором всё опасное репетируется до боя: миграции БД
(в т.ч. «миграция пулов» из MGR-018/021), новые версии sync-сервера и клиентов,
серверная retention. Staging полностью изолирован от боевого сервера: свой
каталог, свой процесс, своя БД, свои секреты, свой порт.

Связанное: `docs/RELEASE.md` (боевой релиз), `docs/DEPLOYMENT_CONFIG.md`
(клиентские env), `scripts/deploy-server.py` (деплой).

## 1. Staging sync-сервер

Один и тот же код `cc-sync-server` запускается как отдельный инстанс:

- каталог на VPS: `/opt/cc-sync-server-staging` (бой: `/opt/cc-sync-server`);
- процесс pm2: `cc-sync-server-staging`;
- порт: `3100` (за nginx отдельный `server_name`/`location` — настраивается
  один раз вручную, деплой-скрипт nginx staging не трогает: `--skip-nginx`);
- БД: `staging.db` в каталоге инстанса — никаких данных из боя;
- админка на другом пути и с другим паролем.

Разовая настройка нового staging-хоста/каталога:

```bash
mkdir -p /opt/cc-sync-server-staging/public/releases
cp cc-sync-server/.env.staging.example /opt/cc-sync-server-staging/.env
# заполнить секреты: SERVER_SECRET/SESSION_SECRET/ADMIN_PASS/ADMIN_PATH/BASE_URL
#   openssl rand -hex 32
#   openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24
cd /opt/cc-sync-server-staging && npm ci --omit=dev
pm2 start index.js --name cc-sync-server-staging
pm2 save
```

Первичный nginx-конфиг для staging-хоста: проксировать на `127.0.0.1:3100`,
`TRUST_PROXY=loopback` уже в `.env.staging.example`.

## 2. Деплой кода на staging

`scripts/deploy-server.py` параметризован env-переменными (дефолты — боевые,
боевой деплой не меняется):

```bash
VPS_HOST=<staging-host> VPS_USER=root \
VPS_APP_DIR=/opt/cc-sync-server-staging \
VPS_PM2_APP=cc-sync-server-staging \
VPS_BASE_URL=https://<staging-host> \
VPS_HEALTH_PORT=3100 \
python scripts/deploy-server.py --skip-nginx
```

Скрипт делает то же, что и для боя: бэкап (БД + код) → заливка → `.env`
→ `npm ci` → `pm2 restart` → health-check (`/version`, `/update`) →
авто-откат из бэкапа при неудаче. Сначала стоит прогнать с `--dry-run`.

## 3. Клиенты против staging

Адрес staging-сервера задаётся env (см. `docs/DEPLOYMENT_CONFIG.md`), профиль
конфига — env-переменной. Важно: в release-сборках профиль принудительно
`production` (DEVOPS-005), поэтому staging-клиент — **debug/dev-сборка**
(`npx tauri dev` или `cargo build`, без `--release`).

Воркер (worker-приложение):

```powershell
$env:VAULTBASE_PROFILE='staging'                      # возьмёт VaultBase.staging.toml
$env:VAULTBASE_CONFIG_DIR='C:\PROJECT\by GrillCodE\VaultBase'   # где лежит TOML
$env:VAULTBASE_SERVER_URL='https://<staging-host>'
# $env:VAULTBASE_SYNC_WS_URL='wss://<staging-host>/ws'   # если WS не выводится из базы
npx tauri dev
```

Менеджер (manager-app): те же переменные — `VAULTBASE_SERVER_URL`
подхватывается его `http.rs`, деплой/dev-цикл тот же, что в `docs/MANAGER_APP.md`.

Что это даёт: PBKDF2 600k (быстрее вход в dev-цикле, но не release-слабее),
ошибки и логи видны, Sentry отключён (пустой DSN в `VaultBase.staging.toml`).

## 4. Репетиция миграций на копии боевых данных

Главный сценарий полигона — проверить миграции БД до прод-деплоя:

1. Снять бэкап боевой БД на проде (на время остановленного pm2-процесса либо
   с `sqlite3 data.db ".backup staging.db"` — без остановки).
2. Забрать бэкап на staging как `staging.db` (`DB_PATH` staging-инстанса).
3. Задеплоить новую версию кода на staging (п. 2), дождаться health-check.
4. Прогнать смок: `/version`, админка (`ADMIN_PATH`), авторизация воркера,
   telemetry-конверты от staging-клиента (шаг 5 ниже), retention-тик.
5. Сверить схему/данные: sqlite3 `staging.db` — целостность ключевых таблиц
   (cards/orders/worker_*) после миграций.
6. Только после этого — релиз на бой по `docs/RELEASE.md`.

Для чистого прогона «с нуля» достаточно удалить `staging.db*` и перезапустить
`pm2 restart cc-sync-server-staging` — схема создастся миграциями заново.

## 5. Клиентские сборки для staging (когда нужен пакет)

Релизные сборки всегда стучатся в бой, и это защита, а не баг (DEVOPS-005).
Если нужен пакедженный staging-клиент, собирают debug-вариант с env:

```powershell
$env:VAULTBASE_PROFILE='staging'; $env:VAULTBASE_SERVER_URL='https://<staging-host>'
npm run tauri build -- --debug
```

Артефакты staging-канала заливаются в `RELEASES_DIR` staging-сервера через
`scripts/upload-artifacts.py` с env staging-инстанса: `SERVER_URL=https://<staging-host>`,
`ADMIN_PATH=<ADMIN_PATH из staging .env>`, `ADMIN_USER`/`ADMIN_PASS` staging.
Боевой auto-updater их не увидит, т.к. клиенты смотрят на другой сервер.

## 6. Чеклист перед боевым релизом

- [ ] staging-сервер поднялся, `/version` отвечает новой версией
- [ ] миграции на копии боевой БД прошли (лог staging без ошибок)
- [ ] staging-воркер активируется и синхронизируется (heartbeat, daily_stats)
- [ ] менеджер видит флота-статистику/insights без ошибок
- [ ] e2e-набор на сборке против staging (`npm run test:e2e`, `TAURI_MOCK=0` при живом стенде)
- [ ] после прогона staging-БД можно очистить (п. 4) — она не боевые данные
