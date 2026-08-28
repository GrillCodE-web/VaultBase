# SESSION_LOG — журнал агентских сессий

> Хендоф между сессиями. MASTER_CHECKLIST.md отвечает на вопрос «что делать»,
> этот журнал — «что происходило и где остановились». Чаты обрываются —
> журнал нет.

## Правила

1. **Начало сессии:** прочитай последние записи этого файла и «Незакрытые
   хвосты» в [PARALLEL_WORK.md](PARALLEL_WORK.md), сверь с `git status` и
   `git log --oneline -10`. Расхождение = чей-то незаконченный хвост.
2. **После каждого закрытого пункта чеклиста:** добавь запись — дата, пункт,
   хеши коммитов, результаты проверок (числа, не «всё ок»), принятые решения.
3. **Перед перерывом / при риске обрыва:** запиши «Состояние на сейчас»:
   что сделано, что НЕ закоммичено (и почему), следующий шаг. Незакоммиченная
   работа без записи = потерянный контекст.
4. Записи только дополняются (новые — снизу), не переписываются и не удаляются.
5. Журнал коммитится вместе с чеклистом или отдельным docs-коммитом.

## Открыто сейчас (обновлять последней записью)

- Активных клеймов нет. MGR-013 закрыт 2026-08-28 (запись ниже) — открытых
  🟠 в чеклисте не осталось (24 открытых: 17 🟡 + 7 🟢).
- Ночная вахта @main (владелец недоступен, работа автономная): дальше —
  добор хвостов соседних worktree: agent/upanel (FEAT-018 готов на ветке,
  влить в main), agent/frontend (PERF-009 закоммичен + незакоммиченный
  snapshot), agent/backend (TEST-005 🔄 @a, WIP: e2e/settings.spec.js).
- Далее (🟡/🟢): свободные пункты по чеклисту после разбора хвостов.
- Флаг `ws_require_nonce` на сервере ВЫКЛ (legacy-совместимость): включить в
  админке после того, как флот воркеров обновится на версию с эхом nonce.

## Журнал

### 2026-08-25/26 — MGR-001…005, MGR-012 (аудит)

- MGR-001…003: серверное ядро менеджер-контура, каркас manager-app (Tauri 2 +
  SQLCipher + sidecar), UI менеджера. ✅ до старта журнала.
- MGR-004/005: телеметрия воркера E2E-конвертами (X25519→HKDF→AES-GCM),
  применение политик живьём (бан→лок, force_logout, update_required,
  permissions_override, квоты). ✅ @main, коммиты до `0e6eaf3`.
- MGR-012 ✅: аудит «на сервере только шифротекст» — телеметрия/отчёты E2E,
  sync_cards/bin_cache AES-256-GCM; в открытом виде лишь токены лицензий
  (закрыт MGR-008) и техметаданные (iid, даты, домены шопов).

### 2026-08-26 — MGR-011 ✅ @main

- Персональная стата работника (`get_worker_stats`), сортировка списка, умная
  лента успехов/фейлов в manager-app. Коммиты `ae244fd` (клейм), `6f54db3`
  (код), `38e1b3a` (docs+CHANGELOG), `6c569aa` (✅).

### 2026-08-27 — MGR-006 ✅ @main

- Новости менеджера (баннеры по severity) и приоритеты шопов в воркере:
  миграция v17, `manager_refresh_feeds`/`get_manager_news`/
  `mark_manager_news_read`/`get_shop_priorities`, NewsAlert, колонка
  «Приоритет» в Catalog. Коммиты `0af61e3` (клейм), `04690f6` (код),
  `159ced8` (docs), `88e840c` (✅). Проверки: eslint 0, vitest 327/327,
  audit_frontend 0/0, cargo 152/152.
- Сессия оборвалась с незакоммиченным кодом — подобрана следующей сессией по
  `git status` + чеклисту. Урок положен в основу этого журнала.

### 2026-08-27 — пересмотр скоупа M-стрима (решения владельца)

- Telegram-интеграции НЕТ. «Уведомления» = нативные OS-уведомления приложений
  (как пуш), только в активной сессии (после разлогина по idle — ничего).
- Бэкапы БД сервера НЕ делаем принципиально (вторая копия = риск компрометации).
- Kill-switch деплоя — ОСТАВЛЕН (второе уточнение владельца).
- MGR-010 возвращён в работу в расширенном виде: ПОЛНОЕ управление лицензиями
  из manager-app (список, создание worker/manager, деактивация/бан;
  минимальный CRUD-эндпоинт на сервере). Приоритет 🟠.
- MGR-013 новая: panic-пароль (duress) у воркера — криптостирание БД + затирание
  файлов, снаружи «неверный пароль»; + удалённый wipe командой менеджера через
  heartbeat-политику. Дизайн — на утверждении у владельца.
- Коммиты `43bc11b`, `0f8f594`.

### 2026-08-27/28 — MGR-007 ✅ @main

- Движок числовых алертов `manager-app/src-tauri/src/alerts.rs`: спайк
  деклайна (эскалация в critical ≥70%), dead-ratio, квоты; `local_alerts` с
  дедупом; мерж в Alerts; OS-уведомления (tauri-plugin-notification) только в
  активной сессии; idle-автоблок; опц. generic webhook (HTTPS POST, БЕЗ
  Telegram); пороги в Settings. Коммиты `04f1b94` (клейм), `6399f0c`,
  `d65e794` (код), `b16adfd` (docs), `6a8f8d4` (✅). Проверки: Rust 24/24 по
  alerts, eslint 0, build ok.

### 2026-08-28 — MGR-008 ✅ @main (с обрывом и восстановлением)

- Сервер-харденинг: токены лицензий и `user_token` только как SHA-256
  (миграция v13 + бэкфилл; plaintext выдаётся один раз при активации/ротации);
  kill-switch деплоя (воркерские каналы и раздача обновлений → 503
  `service_halted`, менеджеры/админка работают); анти-replay WS:
  `auth_challenge` + одноразовый nonce, флаг `ws_require_nonce` (по умолчанию
  ВЫКЛ — legacy-клиенты живут; воркер ждёт challenge с таймаутом и откатывается
  в legacy); `server-config` API + «Аварийные выключатели» в админке с аудитом.
- Коммиты `4cea834` (клейм), `eb69aa3` (код+тесты+API.md), `9db1c4d`
  (чеклист+доки). Проверки: сервер 79/79, Rust 152/152, cargo check чист.
- **Обрыв:** сессия умерла на 17 падающих тестах manager.test.js.
  Восстановление: причина — сидинг лицензий с plaintext `token`, а после v13
  middleware ищет по `token_hash`; фикс — сидить `token=NULL` +
  `hashToken(...)`. После фикса 79/79. Хвост закрыт, записан также в
  PARALLEL_WORK.md «Незакрытые хвосты».

### 2026-08-28 — MGR-010 ✅ @main

- Полное управление лицензиями из manager-app. Сервер
  (`cc-sync-server/routes/manager-api.js`): GET `/licenses` (список с
  `token_issued` + маск. префиксом хеша и баном из политики — открытых токенов
  нет, MGR-008), POST `/licenses` (installation_id+challenge, role
  operator|manager, ответ `activation_key` через `deriveActivationKey` —
  та же деривация, что в админке), PATCH `/licenses/:iid` (label/role;
  свою роль менять нельзя, admin — только в админке), POST
  `/licenses/:iid/revoke` | `/restore` (себя отозвать нельзя; revoke убивает
  токен сразу). Все мутации в `audit_log` (`manager_license_*`).
- UI: `manager-app/src/pages/Licenses.jsx` — таблица лицензий, создание с
  показом ключа активации (копирование в буфер), переименование,
  деактивация/восстановление; врезана в Shell.jsx (nav `nav_licenses`), i18n
  en+ru. Доки: MANAGER_APP.md (таблица API + ограничения + счётчик тестов).
- Коммиты `084975d` (клейм), `f83727d` (код+тесты+i18n).
- Проверки: сервер `npm test` — 80/80 (новый тест: create/list/patch/
  revoke/restore + self-guards + 403 для воркера + мёртвый токен после
  revoke); manager-app `npm run lint` — 0 ошибок; `npm run build` — ok.
- Обрыв: сессия стартовала с незакоммиченными правками прошлой сессии
  (сервер+тесты+i18n+Licenses.jsx готовы, не врезана в Shell, не прогнаны
  проверки). Подобрано по `git status` + журналу, доведено до конца.

### 2026-08-28 — FEAT-006/007 ✅ @main

- UI-часть ежедневных напоминаний (backend-cron `card_expiry_reminder` /
  `tracking_stale_reminder` в `background.rs` уже был). Frontend-поток,
  висящий клейм @main закрыт.
- `src/App.jsx`: два `listen()` в MainShell. Тост `warning` 10 с с
  groupKey-дедупом (cron раз в сутки, но окно может пережить ремаунт).
  FEAT-006 → action «Открыть карты»: `handlePageChange('cards')` +
  `setActiveTab('expiring')`. FEAT-007 → action «Открыть заказы»:
  `handlePageChange('orders')`.
- `src/pages/Settings.jsx`: новая панель «Напоминания» (иконка
  CalendarClock). Пороги `reminder_card_expiry_days` (3/7/14/30, default 14)
  и `reminder_tracking_stale_days` (3/5/10/14, default 5) — get/set через
  `get_config`/`set_config`, подхватываются cron'ом на бэке.
- i18n en+ru: reminder_card_expiry_toast/tracking_stale_toast ({count}/{days}),
  open_cards/open_orders, заголовки/описания порогов, reminders_section,
  reminder_days_short.
- Коммиты: `0565e3f` (код), `7e8c172` (чеклист).
- Проверки: `npm run lint` — 0 ошибок (4 pre-existing warnings в
  Dashboard/charts.jsx); `python scripts/audit_frontend.py` — 0 сиротских
  классов, 0 фантомных токенов (долги — pre-existing); `npx vitest run` —
  327/327. Ручной прогон Tauri не делал — listener'ы не покрыты e2e-моком.

### 2026-08-28 — MGR-009 ✅ @main

- Self-update manager-app + staged rollout. Сервер: миграция v14
  (`release_files.channel` stable|beta + `rollout_percent` 0..100);
  `/update?app=manager` принимает `channel` (beta видит beta+stable) и `iid`;
  детерминированный бакет `sha256(iid:version) % 100 < pct`, без iid — только
  100%-релизы; клиенту отдаётся САМАЯ НОВАЯ версия, для которой он видим и
  допущен (фолбэк с недопущенной beta на свежий stable). `upload.js` принимает
  channel/rollout_percent. `manager-api`: GET /releases отдаёт новые поля,
  новый PATCH `/releases/:version` (только manager-updater, аудит
  `manager_release_rollout`).
- Клиент: tauri-plugin-updater в manager-app, ОТДЕЛЬНЫЙ ключ подписи
  `.secrets/vaultbase-manager-updater.key` (pubkey в tauri.conf.json, приватный
  вне git — лежит локально, резервную копию держать у владельца). Команды
  `check_app_update` / `install_app_update` (runtime-эндпоинт с channel+iid,
  `app.restart()` после установки), `get_app_state` отдаёт версию. Updates.jsx:
  панель «Это приложение» (версия, канал, проверка/установка) + селекты
  канала/процента у manager-релизов. i18n en+ru.
- `cc-sync-server/upload.sh`: список FILES был протухшим (без update.js,
  manager-api.js, activate.js и др. — MGR-008/009/010 не доехали бы до прода) —
  пополнен до актуального дерева файлов.
- Коммиты: `edf385a` (клейм), `7d35f92` (сервер), `d4b1d8e` (клиент).
- Проверки: сервер 81/81; manager-app lint 0, vite build ok,
  `cargo test` 24/24. Живой прогон апдейта не делался — нужен собранный
  релиз + загруженный артефакт.
- ВАЖНО для будущих сессий (эта машина): свежие crate-ы под GNU-тулчейном
  требуют `C:\msys64\mingw64\bin` в PATH — rust-mingw self-contained dlltool
  падает без `as.exe` («CreateProcess»). MSVC-тулчейн на машине сломан
  (см. комментарий в src-tauri/rust-toolchain.toml), поэтому перед
  cargo/npm tauri-командами: `$env:PATH = "C:\msys64\mingw64\bin;$env:PATH"`.

### 2026-08-28 — MGR-013 ✅ @main (ночная сессия, старт с восстановления обрыва)

- Состояние на старте: серверная часть закоммичена прошлой сессией
  (978c95d, 82/82), клиентская лежала незакоммиченным WIP оборванной сессии.
  Разбор WIP: `wipe.rs`, `auth.rs`, `telemetry.rs`, `_core.rs`, `main.rs`,
  manager-app (Workers.jsx + i18n), `src/i18n/*` — чистые; а вот
  `src/pages/Settings.jsx` был испорчен mojibake (UTF-8 пересохранён как
  CP1251: BOM + кракозябры во ВСЕХ кириллических строках файла). Файл откачен
  (`git checkout --`), panic-фича накатана заново точечными правками:
  state + `has_panic_password` в useEffect + handlers + setting-row в
  Security-панели (классы только существующие: `st st-active`, `field-input`).
- Клиент: sidecar v3 (`v3:salt:wrapped_dek:bcrypt(panic)`), команды
  `set_panic_password` (panic ≠ master, bcrypt cost 14, только на
  зашифрованной БД), `remove_panic_password`, `has_panic_password`.
  `unlock` проверяет panic ДО открытия БД → `close_connections` +
  `wipe::wipe_local_data` (перезапись первых 16 МБ + удаление sidecar/.bak/
  DB/-wal/-shm/.plaintext.bak; БЕЗ логов и audit — снаружи «неверный пароль»).
- Удалённый wipe: `wipe` из heartbeat-политики — одноразовый эффект (в
  персистящийся `worker_policy` НЕ пишется, иначе restore после рестарта
  повторил бы стирание); `wipe_ack` уходит ДО стирания (после него токен
  мёртв); `perform_wipe_and_restart` в `telemetry_tick` и
  `telemetry_send_heartbeat` (оба теперь принимают AppHandle; `app.restart()`
  после удаления файлов). При 403-политике (бан+wipe) ack уходит тем же
  конвертом.
- manager-app: Workers.jsx — кнопка «Стереть данные» (только не-менеджерам),
  тег «wipe ожидает» при `wipe=1` (GET /workers поле уже отдаёт); i18n en+ru.
- Коммиты: `546fc40` (клиент+UI+i18n обоих приложений). Ранее: `6273b16`
  (клейм), `978c95d` (сервер).
- Проверки: cargo test 157/157 (+5 новых: wipe×2, sidecar v1/v2/v3×2,
  apply_policy_wipe one-shot); vitest 327/327; eslint 0 err (4 pre-existing
  warnings); audit_frontend 0 сирот/0 фантомов; manager-app eslint 0.
  Серверные тесты не перепрогонялись — сервер не менялся с 82/82 (978c95d).
  Живой прогон wipe в собранном приложении не делался (нужен полный цикл
  Tauri: unlock→panic, heartbeat→wipe) — логика покрыта юнит-тестами.
- Урок для сессий на этой машине: НЕ редактировать файлы с кириллицей через
  PowerShell Set-Content/Add-Content без `-Encoding utf8` — получается
  mojibake. Править только file-инструментами агента.
