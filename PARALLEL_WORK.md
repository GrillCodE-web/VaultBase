# PARALLEL_WORK — протокол параллельной работы агентов

> Прочитай этот файл ДО начала любой работы. Здесь описано, как 2+ агентских
> сессии работают одновременно и не топчут друг друга. Создан 2026-08-25.

## Суть в трёх правилах

1. **Одна сессия = один worktree = одна ветка.** Worktree — независимая копия
   репозитория в соседней папке. Пока два агента сидят в разных worktree,
   конфликта файлов физически не бывает.
2. **Каждая сессия работает ТОЛЬКО в своём потоке** (список путей ниже).
   Никто не берёт чужие пункты чеклиста, даже если они выглядят лёгкими.
3. **Пункт сначала клеймится в MASTER_CHECKLIST.md**, потом делается. Протокол ниже.

## Запуск (из основной копии, `manager-work`)

```powershell
.\scripts\agent-session.ps1 backend     # → ..\agent-backend,  ветка agent/backend
.\scripts\agent-session.ps1 frontend    # → ..\agent-frontend, ветка agent/frontend
```

Дальше открой новую сессию агента прямо в этой папке и вставь стартовый промпт
из раздела «Стартовые промпты» внизу. Первые команды внутри новой сессии:

```powershell
npm ci    # обязательно: без node_modules не сработает pre-commit хук (lint-staged)
# backend-потоку дополнительно: cd src-tauri; cargo check  (первая сборка долгая — норма)
```

Vite при занятом порту сам уходит на следующий свободный. Два `npx tauri dev`
одновременно не запускай: backend-потоку хватает `cargo test` / `cargo check`,
фронтенд-потоку — `npm run dev` + `npx vitest run`.

Удаление worktree после слияния:

```powershell
.\scripts\agent-session.ps1 backend -Remove
.\scripts\agent-session.ps1 frontend -Remove
```

## Потоки

### STREAM A «backend» — только эти пути

`src-tauri/**` · `cc-sync-server/**` · `e2e/**` · `.github/**` · `scripts/**` · `docs/**`

Пункты чеклиста (20 из 44 открытых):
FEAT-001, 002, 004, 006, 007, 008, 009, 010, 011, 012, 013 ·
TEST-001, 002, 003, 004, 005, 006 · DEVOPS-002, 003 · UX-012 (плагин уведомлений)

Рекомендованный порядок:

1. TEST-001, TEST-002 — единственные оставшиеся 🟠; скелет e2e уже есть
   (auth.spec.js, cards.spec.js, setup/tauri-mock.js).
2. FEAT-008 → FEAT-006/007 — cron в background.rs, затем напоминания на нём.
3. FEAT-002, FEAT-004 — Risk V2 и правила, чистый Rust.
4. FEAT-009..013 — курьеры/stuffer.

### STREAM B «frontend» — только эти пути

`src/**` (pages, components, hooks, store, api, i18n, styles, utils) ·
`index.html` · `vite.config.js` · конфиги eslint/prettier/postcss · `README*`

Пункты чеклиста (24 из 44 открытых):
ARCH-008 · UX-001, 002, 003, 004, 007, 010, 011, 013, 014, 018, 019 ·
BUG-016 · PERF-009, 010, 014 · CLEAN-001, 002, 003, 004, 009, 010 · FEAT-003, 005

Рекомендованный порядок:

1. ARCH-008 — разбивка Orders.jsx/Profiles.jsx: пока файлы большие, всё
   остальное в них мержится больно.
2. BUG-016, CLEAN-004 (остаток — магические числа в Cards.jsx), CLEAN-001/002 —
   быстрые победы.
3. UX-007, UX-004, UX-003, UX-001/002 — контраст, ARIA, состояния, токены.
4. UX-018, UX-019, PERF-009, PERF-014, CLEAN-009/010, UX-010/011/013/014,
   FEAT-003/005 — остальное.

## Стыки между потоками

Кто что ждёт от другого. Пока стык не готов — работаешь по свою сторону стыка:
команда/событие без UI или UI с заглушкой-обработчиком.

- FEAT-001: A делает команду авто-архива dead-карт → B вешает кнопку в Cards.
- FEAT-006/007: A эмитит события из background.rs → B рисует напоминания.
- UX-012: A ставит Tauri notifications plugin + emit → B вызывает из UI.
- A нужен новый i18n-ключ → записать строку в раздел «Запросы» ниже; en.js/ru.js
  правит только B (в своей ветке).

## Протокол клейма задач (обязателен)

1. Нашёл в MASTER_CHECKLIST.md пункт своего потока со статусом ⬜.
2. Меняешь статус на `🔄 @a` или `🔄 @b`. Сразу коммитишь ТОЛЬКО чеклист:
   `git commit MASTER_CHECKLIST.md -m "claim: <ID> @<stream>"`.
3. Работаешь. Коммитишь часто и ЯВНЫМИ путями: `git add файл1 файл2`.
   **Никогда** `git add -A` / `git commit -a` — так подбирается чужая работа.
4. Закончил: статус ✅ + коммит `checklist: <ID> ✅ что-сделано`.
5. Сливаешься в main (ниже) и только потом берёшь следующий пункт.

## Слияние в main (одна сессия за раз)

```powershell
git fetch origin
git rebase origin/main        # конфликт → правишь, git add <файлы>, git rebase --continue
npm run lint && npx vitest run        # фронтенд-поток
cd src-tauri && cargo test            # backend-поток (потом вернуться cd ..)
git switch main && git merge --ff-only agent/<стрим> && git push origin main
```

Push отклонили (кто-то уже влился) → снова `fetch` + `rebase`. В main не force-push.
Чужую уже запушенную ветку не rebase и не force-push никогда.

## Режим 2: обе сессии в одном каталоге (fallback, хуже)

Допустимо, только если worktree невозможен. Потоки и клейм — те же, плюс:

- коммиты строго явными путями;
- перед началом `git status`: чужие незакоммиченные файлы не трогать и не
  коммитить — ждать или писать в «Запросы»;
- dev-сервер: два vite на одном порту не живут — второй запускают
  `npm run dev -- --port 5174`.

## Оборванная сессия (краш, лимит кредитов таймаут) — что делать при рестарте

0. Прочитай хвост [SESSION_LOG.md](SESSION_LOG.md) — там последнее известное
   состояние, активные клеймы и следующий шаг. Каждая сессия обязана вести
   журнал (правила — в его шапке).
1. `git status` в основной копии и во всех worktree. Незакоммиченное = чья-то
   чужая работа, обращаться аккуратно:
   - изменение явно завершает уже закоммиченный код (пример: 2026-08-25 staged
     i18n-ключ `select_all`, который уже использовал закоммиченный CardTable) →
     закоммитить с пометкой «хвост оборванной сессии»;
   - недоделанное/непонятное → `git stash push -m "aborted-<дата>" -- <файлы>`
     и записать в «Незакрытые хвосты» ниже.
2. Убитая worktree-папка: коммиты живут в ветке `agent/<стрим>`. Пересоздай
   worktree скриптом без `-Remove` потерянной ветки — вернёшься к последнему коммиту.

## Незакрытые хвосты (проверить перед стартом)

- [x] 2026-08-25 — staged i18n `select_all` (en/ru), ключ уже использовался
      CardTable: закоммичен (f09d4cf).
- [x] 2026-08-25 — ветка-сирота `worktree-agent-aba31a50` (без уникальных
      коммитов): удалена.
- [x] 2026-08-25 — статистика MASTER_CHECKLIST.md была 121/93, реально
      184/140: обновлена.
- [x] 2026-08-28 — обрыв сессии MGR-008: незакоммиченный сервер-харденинг
      (13 файлов) + 17 падающих тестов manager.test.js. Причина падений: сидинг
      лицензий с plaintext `token` вместо post-v13 `token=NULL`+`hashToken(...)`.
      Закрыто новой сессией по SESSION_LOG/git status: фикс сидинга, 79/79
      сервер + 152/152 Rust, закоммичено (eb69aa3, 9db1c4d).

## Запросы между потоками

- 2026-08-25 — **M → A (backend)**: MGR-004/005 — воркер должен начать слать телеметрию и
  применять политики по контракту `docs/MANAGER_APP.md` (§2.2 seal, §4 daily_stats,
  §5 порядок интеграции). Референс-реализация шифрования — `manager-app/src-tauri/src/crypto.rs`.
- 2026-08-25 — **M → B (frontend)**: MGR-006 — баннер новостей по severity + сортировка
  каталога по `GET /api/telemetry/priorities`; i18n-ключи новые — добавить в обе локали.
- 2026-08-26 — **@main → B (frontend)**: FEAT-006/007, UI-часть. Backend (cron в
  `background.rs`) эмитит раз в сутки (только при непустом списке) события:
  - `card_expiry_reminder` — `{count, days, cards: [{id, bin, last4, expiry_date, days_left}]}`
  - `tracking_stale_reminder` — `{count, days, orders: [{id, order_number, tracking_number, carrier, days_since_update}]}`
    Пороги — config-ключи `reminder_card_expiry_days` (деф. 14) и
    `reminder_tracking_stale_days` (деф. 5). Нужно: тосты/баннеры по этим событиям
    (i18n en+ru); опционально — поля порогов в Settings.
- 2026-08-28 — **B → A (backend)**: UX-010 (DnD-импорт CSV) — фронт на HTML5 drop,
  но в десктопе OS-дроп перехватывается нативно (Tauri `dragDropEnabled` по умолчанию
  true) и до webview не доходит. Просьба: в `src-tauri/tauri.conf.json` для окна `main`
  выставить `"dragDropEnabled": false` — тогда drop придёт как HTML5-событие. Либо дать
  `fs:allow-read-text-file` в capabilities — тогда дочитаю путь из `onFileDropEvent`.

## Стартовые промпты для сессий

**STREAM A — открыть сессию в `C:\PROJECT\by GrillCodE\VaultBase\agent-backend`:**

> Ты — backend-поток агентов VaultBase. Сначала `npm ci`. Работай ТОЛЬКО по
> src-tauri/, cc-sync-server/, e2e/, .github/, scripts/, docs/. Прочитай AGENTS.md
> и PARALLEL_WORK.md в корне репозитория. Затем открой MASTER_CHECKLIST.md, возьми
> первый ⬜-пункт из раздела STREAM A файла PARALLEL_WORK.md, заклеймь его по
> протоколу и делай. Не трогай src/ фронтенда и чужие клеймы (🔄). Коммить явными
> путями. Закончив — слей в main по протоколу из PARALLEL_WORK.md, потом возьми
> следующий пункт. Оборвался — восстановление описано в PARALLEL_WORK.md.

**STREAM B — открыть сессию в `C:\PROJECT\by GrillCodE\VaultBase\agent-frontend`:**

> Ты — frontend-поток агентов VaultBase. Сначала `npm ci`. Работай ТОЛЬКО по src/,
> index.html, vite.config.js, конфигам линтеров. Прочитай AGENTS.md (особенно
> раздел про CSS-токены) и PARALLEL_WORK.md в корне репозитория. Затем открой
> MASTER_CHECKLIST.md, возьми первый ⬜-пункт из раздела STREAM B файла
> PARALLEL_WORK.md, заклеймь его по протоколу и делай. После каждой правки —
> `python scripts/audit_frontend.py` (0 orphan / 0 phantom) и `npm run lint`.
> Не трогай src-tauri/, cc-sync-server/, e2e/ и чужие клеймы (🔄). Коммить явными
> путями. Закончив — слей в main по протоколу из PARALLEL_WORK.md, потом возьми
> следующий пункт.
