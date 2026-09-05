# VaultBase — Agent Guide

> Version 2.12.1, updated 2026-09-05. Трекинг: задачи — `bd` (beads), память/журнал — engram (`mem_context`/`mem_save`). Файлов SESSION_LOG/MASTER_CHECKLIST/PARALLEL_WORK больше нет (удалены 2026-09-05, история — в git).

## Режим экономии (читать первым, обязателен)

**Старт сессии:** 1) `engram.mem_context` (проект VaultBase); 2) `bd ready --json`; 3) `codebase-memory.index_status` → `index_repository` один раз, далее `detect_changes`; 4) `docs/*`, `.claude/*` — не читать, если задача прямо не про них (этот файл уже содержит всё нужное).

**Навигация:** структура/вызовы (React ↔ Tauri commands ↔ Rust database/*) — через codebase-memory (`search_graph`, `trace_path`, `get_code_snippet`), не `file_read` целиком; ≤ 3 файлов целиком за задачу. Игнор: node_modules, dist, target, coverage, playwright-report, test-results, audit-shots, design-mockups, .release-artifacts, *.log.

**Правки:** одна строка плана → минимальный дифф → гейт: затронутый JS-тест (`vitest`) и/или `cargo test` по модулю, не полный прогон. i18n: правка ключа — сразу в `en.js` и `ru.js`. API библиотек (Tauri 2, React 18) — `context7`.

**Цикл работы:** фича > 1 сессии → `specs/<slug>.md` (5–15 строк, критерий готовности) → «ок» → `bd create` по задачам → одна задача за сессию → гейт → `bd close` → `git commit -m "<id>: ..."`. Скилл `spec-plan`. Трекер только `.beads/`, никаких PLAN/TODO.md.

**Против хлама:** не создавать непрошеные файлы (SUMMARY/NOTES/CHANGES.md, *_old, *_backup, *_v2). Логи, скриншоты, `dev-server-mw.log` — не коммитить. Временные скрипты → `scripts/tmp/`, удалить в конце. Перед коммитом `git status`.

**Конец:** `engram.mem_save` (что/почему/что не трогать) → `bd sync`. Ответ — результат и статус проверки, без пересказа.

**Модели:** Kimi K3 / GLM — выполнение задач, i18n, простые правки; Claude Thinking — спека, Rust/SQLCipher-архитектура, баг после двух неудач.

Secure desktop app (Tauri 2 + React 18 + Rust + SQLite/SQLCipher) for managing cards,
profiles, orders, shops, proxies and email. 248 worker + 19 manager Tauri
commands, 337 JS + 185 Rust unit tests.

## Project layout

```
src/                  # React frontend (Vite)
  pages/              # One file per page: DashboardRedesigned, Cards, Profiles,
                      # Orders, Catalog, Shops, Proxies, Couriers, Imap, Updates,
                      # ActivityLog, Settings, Login, UserLogin,
                      # Activate, Onboarding, Drops (stub — feature lives in Profiles)
  components/         # Shared UI: Modal, EmptyState, ErrorBoundary, skeletons
  store/              # List stores (cards, orders)
  api/                # Thin wrappers over Tauri commands
  hooks/              # useAuth, useLang (i18n with {param} interpolation),
                      # useIdleTimer, useSmartToast, useConfirm, useKeyboardShortcuts
  i18n/               # en.js / ru.js — 1018 keys; keep both in sync
  styles/             # 7 consolidated CSS files — see warning below
  App.jsx             # Main shell: view router (activate → auth → user_login → app),
                      # sidebar NAV_DEFS + PAGE_MAP, badges, global search
src-tauri/src/
  main.rs             # Entry point + invoke_handler (248 commands)
  commands/           # Tauri commands by domain (cards, orders, dashboard, imap,
                      # smtp, auth, license, sync, stuffer, catalog, config, misc)
  database/           # SQLCipher DB layer: _core, _cards, _orders, _analytics,
                      # _imap, _profiles, _shops, _users, _misc, _helpers,
                      # _migrations, _seed
  models.rs           # Data models + permission flags (perms)
  encryption.rs       # AES-256-GCM field encryption
  imap.rs / smtp.rs   # Mail clients
  sync.rs / ws_sync.rs # HTTP + WebSocket sync
  license.rs          # License validation via sync server
  config.rs           # TOML profiles (dev/staging/production)
e2e/                  # Playwright tests with Tauri mock (setup/tauri-mock.js)
scripts/
  audit_frontend.py   # Drift audit: orphan CSS classes, phantom tokens, dead i18n
  visual-audit.mjs    # Screenshots every page with mock data into audit-shots/
cc-sync-server/       # Own Node.js WebSocket sync server (docs/API.md)
docs/                 # Reference docs (index: docs/README.md)
```

## CSS — read before touching styles

The ONLY style sources are the 7 files in `src/styles/`:
`index.css` (imports) → `tokens.css` (design tokens) → `base.css` → `layout.css` →
`components.css` → `pages.css` → `fonts.css`. Old names (`tokens-redesign.css`,
`layout/sidebar-redesign.css`, `utilities-redesign.css`…) were consolidated in v2.8.0
and no longer exist — editing those paths does nothing.

Token rules: use existing tokens (`--accent`, `--green-t`, `--text-2`, `--border`…).
Phantom tokens (referenced but never defined) silently break colors — run
`python scripts/audit_frontend.py` after CSS/JSX changes; it must report
0 orphan classes / 0 phantom tokens.

## Conventions

- **Frontend state:** React Context (useAuth, useLang, useSmartToast, useConfirm).
- **i18n:** `t(key, { n })` supports `{placeholder}` interpolation. New UI strings go
  into BOTH `en.js` and `ru.js` — missing keys render as raw `key_name` to the user.
- **Backend:** all commands return `Result<T, String>`; permissions checked via
  `models::perms::*` on both frontend (`hasPerm`) and backend.
- **Dates:** DB stores UTC `YYYY-MM-DD HH:MM:SS`; frontend formatters must accept both
  that and full ISO (see `fmtDate` in src/utils/formatting.js).
- **Adding a command:** implement in the right `commands/*.rs` domain, re-export in
  `commands/mod.rs`, register in `main.rs` `invoke_handler`, call via
  `invoke('cmd_name', { args })` from React.

## Commands

```bash
npm run dev          # Vite dev server :5173
npx tauri dev        # Full desktop app
npm run lint         # ESLint (0 errors required)
npx vitest run       # 337 unit tests
npm run test:e2e     # Playwright e2e
npm run tauri build  # Production bundles
```

## Parallel agent sessions

If other agent sessions may be running simultaneously: one session = one git
worktree = one branch. Create yours with `scripts/agent-session.ps1 backend|frontend`
(run in the main checkout). Streams are strictly disjoint:

- **backend**: `src-tauri/**`, `cc-sync-server/**`, `e2e/**`, `.github/**`, `scripts/**`, `docs/**`
- **frontend**: `src/**`, `index.html`, `vite.config.js`, eslint/prettier/postcss configs

Claim work in **bd** (`bd update <id> --claim`), not in markdown files. Commit with
explicit paths only — never `git add -A` / `git commit -a`: another agent may have
WIP in the same tree. Merge into main one session at a time (rebase → checks → push;
no force-push). Session continuity: `engram.mem_context` at start, `engram.mem_save`
after each completed task (`bd close`) — chats die, memory survives.

## Auth flow

License activation (challenge → activation key via sync server) → master password
(unlocks SQLCipher DB, PBKDF2 1M) → auto-login in solo mode. Role (admin/operator)
comes from the license (`license_role` config, refreshed on verify). The first-run
admin password is random 32 bytes and never stored anywhere.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

