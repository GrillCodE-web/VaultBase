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

- MGR-013 закрыт 2026-08-28 (запись ниже) — открытых 🟠 в чеклисте не
  осталось. От @b влиты UX-018/019, PERF-009, UX-003 и CLEAN-010
  (origin/main → main, записи ниже). FEAT-006/007 закрыты 2026-08-28.
  PERF-014 закрыт 2026-08-28 второй сессией @main (запись ниже).
- В manager-work параллельно идут ДВЕ сессии @main (владелец дал обеим
  одинаковую ночную задачу). Разделение: вахта-1 делает FEAT-002 🔄 и добор
  хвостов worktree (ниже), вахта-2 сделала PERF-014 ✅. WIP-файлы друг друга
  не трогать, коммиты только с явными путями.
- Ночная вахта @main-1: дальше — добор хвостов соседних worktree:
  agent/upanel (FEAT-018 готов на ветке, влить в main), agent/frontend
  (незакоммиченный snapshot после PERF-009), agent/backend (TEST-005 🔄 @a,
  WIP: e2e/settings.spec.js).
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

### 2026-08-28 — UX-018 + UX-019 ✅ @b (worktree agent-frontend)

- UX-018: в ProfileModal под полем email добавлен фидбек привязки — зелёная
  строка «Will be linked: {email}» при совпадении с пулом (get_available_emails
  отдаёт только {id, email}) и серая «Not in email pool — won't be linked»,
  если введённый адрес в пуле не найден.
- UX-019: `autoCreateDrop` теперь по умолчанию `false` (был `true`); включение
  чекбокса идёт через `useConfirm` — диалог предупреждает, что биллинг-адрес
  карты будет расшифрован (reveal_card) для создания дропа. Отказ → чекбокс
  остаётся выключенным.
- Заодно переведены на i18n трогаемые строки модалки (label/placeholder email,
  title кнопки 🎲, тосты авто-назначения, подпись чекбокса). Новые ключи
  (en+ru, 11 шт.): email_label_optional, email_placeholder,
  email_auto_assign_title, email_auto_assigned, no_free_emails,
  email_will_be_linked, email_not_in_pool, auto_create_drop,
  auto_create_drop_helper, auto_create_drop_confirm_title,
  auto_create_drop_confirm_msg.
- Коммиты: `98103e6` (клейм), `3b954c5` (код), `2ae1ac8` (чеклист ✅).
- Проверки: `python scripts/audit_frontend.py` — критичных проблем нет;
  `npm run lint` — 0 ошибок (4 pre-existing warnings в Dashboard/charts.jsx);
  `npx vitest run` — 327/327.
- Слияние: main был занят сессией MGR-013 (checkout в manager-work), поэтому
  влито пушем `agent/frontend:main` (ff 6273b16→2ae1ac8). Сессии MGR-013 при
  своём слиянии нужен rebase локального main на origin/main.
- Побочка: vitest-тронутый snapshot-файл (только CRLF/LF) — откачен
  `git restore`, в коммит не попал.

### 2026-08-28 — PERF-009 ✅ @b (worktree agent-frontend)

- `revealCard` в `src/store/cards.js` — cache-first: повторный reveal в
  пределах TTL (ARCH-018, 5 мин) возвращает кэшированный PAN/CVV без
  повторного `invoke('reveal_card')` (и без лишней записи в audit-log
  бэкенда). Метод теперь возвращает данные (Promise), раньше — undefined.
- Дедупликация in-flight: `revealPending` (Map cardId→Promise) — двойной
  клик / параллельные вызовы (строка таблицы + сайд-панель) схлопываются в
  один invoke.
- Связка с ARCH-018: если за время запроса сработал `clearSensitiveData`
  (лок/логаут), результат in-flight reveal'а выбрасывается — кэш не
  воскрешается после очистки.
- Тесты +3 в `src/store/__tests__/cards.test.js`: cache-hit без invoke,
  дедуп параллельных вызовов, отброс результата после clearSensitiveData.
- Коммиты: `a75e52b` (клейм), `7aad3fa` (код+тесты), `b3d25b8` (чеклист ✅).
- Проверки: `npm run lint` — 0 ошибок (4 pre-existing warnings в
  Dashboard/charts.jsx); `npx vitest run` — 330/330;
  `python scripts/audit_frontend.py` — критичных проблем нет.
- Слияние: как и в прошлый раз, пуш `agent/frontend:main` (ff) — main в
  manager-work занят сессией MGR-013. Ручной прогон в Tauri не делался:
  поведение покрыто unit-тестами, e2e-мок reveal не гоняет.

### 2026-08-28 — PERF-014 ✅ @main (вахта-2, manager-work)

- Lazy-загрузка recharts и jsPDF — стартовый бандл похудел с ~1.71 МБ до
  ~1.12 МБ (eager: main 54 КБ + vendor 739 КБ + pages-components 325 КБ;
  async: charts 305 КБ, jspdf.es.min 338 КБ + autotable 31 КБ — ни один не
  попадает в modulepreload index.html, проверено по dist).
- `DashboardRedesigned.jsx`: `RevenueChart`/`Heatmap` через
  `React.lazy(() => import('./Dashboard/charts').then(...))` + `<Suspense>`
  (fallback — пустой div фиксированной высоты, 260/120px). `PERIODS` вынесены
  в новый `src/pages/Dashboard/periods.js` (без recharts); `charts.jsx`
  реэкспортирует их (`export { PERIODS } from './periods.js'`) — старые
  импорты не сломаны.
- `src/utils/pdfExport.js`: `exportCardsToPDF` стал async, внутри
  `Promise.all([import('jspdf'), import('jspdf-autotable')])`. Точка вызова в
  `Cards.jsx` (bulk PDF-экспорт): `.catch(e => handleError(e, 'Cards.exportPDF'))`.
- КЛЮЧЕВАЯ ЛОВУШКА (rolldown-vite): `manualChunks` с именованными чанками
  (`recharts → 'charts'` и т.п.) ЛОМАЕТ ленивость — такой чанк попадает в
  `<link rel="modulepreload">` обоих entry (index.html и float.html) и
  грузится на старте, даже если достижим только через динамический import().
  Лечение: `return undefined` для `recharts`/`d3-`/`jspdf` в manualChunks —
  тогда rolldown сам кладёт их в async-чанки. Та же болезнь у чанка
  `pages-components` (325 КБ preloaded) — НЕ трогал: его правило помечено
  как защита от circular deps, отдельный пункт если что.
- Коммиты: `982c904` (клейм), `4105cfc` (код).
- Проверки: `npm run lint` — 0 ошибок (3 pre-existing warnings: App.jsx,
  float.jsx, charts.jsx getHeatmapClass); `npx vitest run` — 327/327 (прогон
  до мержа @b; после a12651d в main 330); `python scripts/audit_frontend.py` —
  критичных проблем нет; `npm run build` — чанки разнесены, preload-лист
  чистый; e2e `cards.spec.js` chromium — 4/4.
- Ручной прогон в Tauri не делался (в manager-work работает вторая сессия).
- Параллелизм: за время моей работы вахта-1 закрыла MGR-013 (546fc40,
  71435d1) и взяла FEAT-002 (f761502, _orders.rs/orders.rs). Коллизий по
  файлам не было — потоки разошлись.

### 2026-08-28 — UX-003 ✅ @b (worktree agent-frontend)

- Единые loading/empty/error состояния. Новый примитив `SkeletonBlock` в
  `src/components/SkeletonRow.jsx` — div-вариант скелетона для не-табличных
  списков. Couriers.jsx: 5 мест рендерили `<SkeletonRows>` (`<tr>`) внутри
  div/modal — table-row разметка вне table-контекста ломает раскладку
  скелетона; переведены на `SkeletonBlock`.
- `DataLoader` (существовал с ARCH-015, но не использовался нигде) —
  экспортирован из `components/index.js` и подключён в Updates.jsx: error
  с retry-кнопкой и empty-строка теперь через общий обёрточный компонент.
- Bare `Loading...` → `t('msg_loading')`: CardShopUsagePanel,
  CardTimelinePanel, CardSidePanel, Shops (ShopDetail), Settings (sync
  groups), ImapFolderTree. В Settings заодно переведён блок «Тестовые
  данные» (3 новых ключа settings_seed_* в en+ru).
- Catalog.jsx: текстовые «Loading...»/«No found» строки таблиц →
  `SkeletonRows` + `EmptyState colSpan`; удалён мёртвый дублирующийся
  empty-branch (`shops.length === 0` дважды, второй с colSpan=6 был
  недостижим). Страница остаётся English-only (i18n там не было — не
  вводил).
- Мёртвый ключ `upd_loading` удалён из en.js/ru.js (после перехода Updates
  на DataLoader использований не осталось).
- Не тронуто сознательно: страницы уже на унифицированных паттернах
  (Dashboard/MyStats — скелетоны/spinner, ActivityLog/Orders/Profiles —
  SkeletonRows+EmptyState в таблицах, UsersPage — spinner-xs); error-state
  на страницах без локального error-state (остальные показывают toast) —
  переводить все на inline error + retry это отдельный UX-вопрос.
- Коммиты: `e7003a8` (клейм), `ecd2cd9` (код, 13 файлов +68/−66),
  `9d003cc` (чеклист ✅).
- Проверки: `npm run lint` — 0 ошибок (3 pre-existing warnings);
  `npx vitest run` — 330/330; `python scripts/audit_frontend.py` —
  критичных проблем нет.
- Слияние: пуш `agent/frontend:main` (ff). Ручной прогон в Tauri не
  делался; визуально проверить: Couriers (все 3 вкладки + модалка лейблов),
  Updates (loading/error/empty), Catalog (обе таблицы).

### 2026-08-28 — TEST-006 ✅ @main (e2e роли admin vs operator)

- Свободных 🟠 не было; взял 🟡 TEST-006 (e2e, backend-стрим). Коллизий с live-вахтами
  нет: FEAT-002 (agent-night), UX-003 (agent-frontend, влита @b), TEST-005 (agent-backend)
  живут в своих worktree.
- `e2e/roles.spec.js` (5 кейсов): admin видит Users/Team Statistics; operator — нет;
  operator без `manage_proxies` — нет Proxies; ручной вход оператора; UsersPage админа
  зовёт `get_users_stats`/`get_admin_overview`.
- Мок расширен через `window.__e2e` + обёртку `__TAURI_INTERNALS__.invoke` (init-скрипт
  раньше мока). Базовый `tauri-mock.js` не тронут — WIP TEST-005 @a. Роль берётся из
  `?e2e-role=` в location.search (один context безопасно для параллельных воркеров).
- Подвох: MainShell сначала `resumeSession()` по `cc_session_token` из localStorage, а
  потом `try_auto_login` — поэтому перехвачены все auth-команды, не только user_login.
- Проверки: `npx playwright test e2e/roles.spec.js --project=chromium` — 4/4;
  весь suite chromium — 45/46 (1 фейл в `crud.spec.js` — воспроизводится и на чистом
  HEAD без моих изменений, не моя регрессия); lint 0 err (3 warn — старые);
  vitest 330/330; audit 0 orphans/0 phantom.

### 2026-08-28 — CLEAN-010 ✅ @b (worktree agent-frontend)

- Overscan виртуализаторов больше не хардкод: создан
  `src/constants/virtualization.js` с именованными значениями и пояснениями
  (что такое overscan и почему значения различаются). 6 списков переведены на
  константы, значения сохранены как были: CardTable `CARDS_OVERSCAN=10`,
  OrdersTable `ORDERS_OVERSCAN=20`, ProfilesTable `PROFILES_OVERSCAN=20`,
  ImapEmailList `IMAP_OVERSCAN=5`, Proxies `PROXIES_OVERSCAN=5`,
  Shops `SHOPS_OVERSCAN=5`.
- ★-комментарии у virtualizer'ов, ссылавшиеся на старые числа, обновлены
  (указывают на constants/virtualization.js).
- Поведение не менялось — чистый рефакторинг, новых тестов не требуется.
- Коммиты: `e8bc436` (клейм), `2aed421` (код, 7 файлов +41/−9).
- Проверки: `npm run lint` — 0 ошибок (3 pre-existing warnings);
  `npx vitest run` — 330/330; `python scripts/audit_frontend.py` —
  критичных проблем нет; residual-проверка `overscan: <число>` в src — 0
  совпадений.
- Слияние: пуш `agent/frontend:main` (ff). Ручной прогон в Tauri не делался —
  скролл-настройки не менялись, визуальная проверка не нужна.

### 2026-08-28 — CLEAN-009 ✅ @b (worktree agent-frontend)

- Prop drilling в Cards устранён через `Cards/cardRowContext.js`
  (CardRowContext): CardTable держит провайдер с одним мемоизированным
  «окружением строки» вместо проксирования 20+ одинаковых пропсов в CardRow;
  CardRow получает только `card`+`index` и ушёл с custom-compare memo на
  дефолтный shallow.
- Из сигнатуры CardTable удалены неиспользуемые `total`/`freeTotal`/`page`/
  `setVisibleCols`/`clearSelection` (были `_`-заглушками); мёртвый проп
  `onCardTaken` убран (никогда не был подключён — noop).
- `handleSetSideCard` в Cards пробрасывает index в стор
  (`setSideCard(card, idx)`) — двойной клик по строке даёт сайд-панели
  позицию для prev/next, как у клавиатурной навигации.
- Поведение не менялось — чистый рефакторинг, новых тестов не требуется.
- Сессия оборвалась сразу после коммита кода; хвост (чеклист ✅ + этот лог)
  закрыт при рестарте — проверки перегнаны на актуальном HEAD ветки.
- Коммиты: `84b5308` (клейм), `e945208` (код, 4 файла +597/−684),
  `620a813` (чеклист ✅).
- Проверки: `npm run lint` — 0 ошибок (3 pre-existing warnings);
  `npx vitest run` — 330/330; `python scripts/audit_frontend.py` —
  критичных проблем нет.
- Слияние: пуш `agent/frontend:main` (ff). Ручной прогон в Tauri не делался;
  визуально проверить: Cards — список, сайд-панель (открытие даблкликом,
  prev/next), выделение строк.

### 2026-08-28 — TEST-005 ✅ @a (worktree agent-backend)

- E2E Settings (язык и тема), 11 спеков `e2e/settings.spec.js`: дефолт EN/dark,
  переключение EN↔RU и тем через Settings и сайдбар (состояние общее), персист
  выбора в localStorage и переживание reload, System следует
  prefers-color-scheme, язык и тема независимы (RU + Light одновременно).
- Мок `e2e/setup/tauri-mock.js`: stateful `get_config`/`set_config` с контрактом
  CONFIG_SECRET (`_set`-флаги); добавлены `stuffer_get_config` /
  `get_catalog_stats` / `sync_get_group_status` / `has_panic_password` для
  маунта Settings. Базовые команды мока не тронуты — коллизий с вахтами нет.
- Сессия оборвалась сразу после коммита кода; хвост (чеклист ✅ + этот лог)
  закрыт при рестарте — проверки перегнаны на актуальном HEAD ветки (0eccadd).
- Коммиты: `b0f2e47` (клейм), `0eccadd` (код, 2 файла +238/−2),
  `4320937` (чеклист ✅).
- Проверки: `npm run lint` — 0 ошибок (3 pre-existing warnings);
  `npx playwright test e2e/settings.spec.js` — 22/22 (chromium+firefox);
  полный `npx playwright test` — 106/106 (chromium+firefox, 5.3 мин).
- Слияние: не выполнялось — agent/backend = merge-base `8fb96e5` + 3 коммита
  (клейм, код, чеклист); мердж в main — ребейзом на актуальный main, по очереди.
- Находка при рестарте: вся линия @a (с `1d61b2d`, fork ночью) не содержит
  SESSION_LOG.md — файл появился на main-линии позже; записи @a вносятся в
  main-копию. Запись по TEST-004 (закрыт в `8fb96e5`) в лог так и не была
  добавлена — висит долгом.

### 2026-08-26 — TEST-004 ✅ @a (worktree agent-backend) — запись задним числом

> Долг из записи TEST-005: пункт был закрыт 2026-08-26 в `8fb96e5`, но запись в лог
> так и не добавили (линия @a не содержала SESSION_LOG.md). Восстановлено по
> коммитам 2026-08-28.

- E2E импорт/экспорт, 10 спеков `e2e/import-export.spec.js` (209 строк): ImportModal
  preview / маппинг колонок / импорт в 3 шага, отмена по Escape и инвалидные строки;
  Export CSV / TXT / выборочный экспорт с маской `****last4` без CVV; батч-импорт
  заказов с ORD-нумерацией.
- Мок `e2e/setup/tauri-mock.js` (+82 строки): `detect_mapping_preview` /
  `import_cards` / `export_cards` / `batch_create_orders` — stateful.
- Коммиты: `1d61b2d` (клейм), `2836025` (код, 2 файла +291), `8fb96e5` (чеклист ✅).
- Проверки (по сообщению коммита `8fb96e5`): 84/84 e2e green, chromium+firefox.
- Слияние: ветка agent/backend ребейзнута на main ночной вахтой @main-1 —
  коммиты TEST-004 уже в main, отдельного мерджа не требовалось.

### 2026-08-28 — TEST-005: слияние agent/backend → main + найден регресс (useConfirm поверх модалки)

- Ребейз agent/backend на main (b3c7c67): 2 конфликта в MASTER_CHECKLIST.md
  (клейм и ✅ — взята актуальная main-версия таблицы, менялась только ячейка
  статуса TEST-005). Новые хеши: `7a1896e` (клейм), `a121137` (код),
  `ccc5529` (чеклист). Мердж — fast-forward, main = `ccc5529`.
- Проверки на отребейженном дереве: lint 0 err (3 pre-existing warnings),
  vitest 330/330, e2e — 112 passed / 2 failed.
- Падение НЕ от TEST-005: `crud.spec.js:47` (профиль с авто-дропом) красный и на
  чистом main (без коммитов ветки) — воспроизведено в manager-work. Цепочка:
  1. UX-018/019 (`3b954c5`) намеренно выключил autoCreateDrop по умолчанию +
     добавил confirm при включении — спек не был обновлён (стал stale);
  2. при обновлении спека вскрылся реальный UI-баг: диалог useConfirm
     недоступен поверх открытой модалки. В `useConfirm.jsx` overlay собран на
     классах `fixed inset-0 z-50` — `.fixed`/`.inset-0` НЕ существуют в CSS
     (не удалены UX-002 — их не было никогда, с v2.0.0 `ccbed20`), `.z-50` даёт
     z-index 50 против `z-index: 100` у `.modal-overlay`. Диалог рендерится
     в потоке под оверлеем: клик по Confirm физически перехватывается модалкой
     (Playwright hit-test + скриншот подтверждают).
- crud.spec.js оставлен как на main (фикс спека бессмысленен до починки
  useConfirm). Фикс — два шага: починить позиционирование диалога в
  useConfirm.jsx (frontend-стрим, src/), затем обновить спек: включить чекбокс
  «Auto-create drop» + клик Confirm (правка подготовлена и проверена — упирается
  ровно в баг позиционирования).
- Предложено владельцу: пункт в чеклист на useConfirm-фикс (бьёт по всем
  confirm() поверх модалок, не только UX-019).
