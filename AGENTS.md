# VaultBase — Agent Guide

> Russian version: [AGENTS.ru.md](AGENTS.ru.md). Version 2.11.3, updated 2026-08-25.

Secure desktop app (Tauri 2 + React 18 + Rust + SQLite/SQLCipher) for managing cards,
profiles, orders, shops, proxies and email. 206 Tauri commands, 306 unit tests.

## Project layout

```
src/                  # React frontend (Vite)
  pages/              # One file per page: DashboardRedesigned, Cards, Profiles,
                      # Orders, Catalog, Shops, Proxies, Couriers, Imap, Updates,
                      # ActivityLog, UsersPage, MyStats, Settings, Login, UserLogin,
                      # Activate, Onboarding, Drops (stub — feature lives in Profiles)
  components/         # Shared UI: Modal, EmptyState, ErrorBoundary, skeletons
  store/              # List stores (cards, orders)
  api/                # Thin wrappers over Tauri commands
  hooks/              # useAuth, useLang (i18n with {param} interpolation),
                      # useIdleTimer, useSmartToast, useConfirm, useKeyboardShortcuts
  i18n/               # en.js / ru.js — 530+ keys; keep both in sync
  styles/             # 7 consolidated CSS files — see warning below
  App.jsx             # Main shell: view router (activate → auth → user_login → app),
                      # sidebar NAV_DEFS + PAGE_MAP, badges, global search
src-tauri/src/
  main.rs             # Entry point + invoke_handler (206 commands)
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
  that and full ISO (see `fmtDate` in UsersPage/MyStats).
- **Adding a command:** implement in the right `commands/*.rs` domain, re-export in
  `commands/mod.rs`, register in `main.rs` `invoke_handler`, call via
  `invoke('cmd_name', { args })` from React.

## Commands

```bash
npm run dev          # Vite dev server :5173
npx tauri dev        # Full desktop app
npm run lint         # ESLint (0 errors required)
npx vitest run       # 306 unit tests
npm run test:e2e     # Playwright e2e
npm run tauri build  # Production bundles
```

## Auth flow

License activation (challenge → activation key via sync server) → master password
(unlocks SQLCipher DB, PBKDF2 600k) → auto-login in solo mode. Role (admin/operator)
comes from the license (`license_role` config, refreshed on verify). The first-run
admin password is random 32 bytes and never stored anywhere.
