# VaultBase — Documentation Index

**Version:** 2.11.3 · **Updated:** 2026-08-25

## Start here

| Document                                      | Description                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| [README.md](../README.md)                     | Main overview: feature map, run commands, layout, screenshots  |
| [AGENTS.md](../AGENTS.md)                     | Developer/agent guide (EN)                                     |
| [AGENTS.ru.md](../AGENTS.ru.md)               | Тоже самое по-русски (RU)                                      |
| [MASTER_CHECKLIST.md](../MASTER_CHECKLIST.md) | Live task checklist (183 items, statuses)                      |
| [PARALLEL_WORK.md](../PARALLEL_WORK.md)       | Parallel agent sessions: worktrees, streams, claiming protocol |
| [CHANGELOG.md](../CHANGELOG.md)               | Version history                                                |

## Architecture & security

| Document                                     | Description                                        |
| -------------------------------------------- | -------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | System architecture (EN)                           |
| [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md)     | Архитектура системы (RU)                           |
| [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md)       | Login flow: license → master password → auto-login |
| [ADMIN_AUTH.md](ADMIN_AUTH.md)               | Admin/operator auth model details                  |
| [PERMISSIONS.md](PERMISSIONS.md)             | Full permission flags reference                    |
| [COMPLIANCE.md](COMPLIANCE.md)               | Compliance notes                                   |
| [CSP_SECURITY_NOTE.md](CSP_SECURITY_NOTE.md) | Why `unsafe-inline` in style-src and mitigations   |
| [ICON_AND_BRANDING.md](ICON_AND_BRANDING.md) | Icons, branding assets                             |

## Design system

| Document                             | Description                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Полный справочник дизайн-системы (RU): 7 CSS-файлов, все токены, темы, шрифты, иконки, геометрия, z-index, карта страниц, правила «не трогать», плейбук редизайна |
| [UI_PAGES.md](UI_PAGES.md)           | Разметка и лейаут каждой страницы (RU): шапки, фильтры, таблицы, бейджи `.st-*`, модалки, float-окно, типографика, цветовые литералы, матрица влияния редизайна   |

## Configuration & operations

| Document                                       | Description                                 |
| ---------------------------------------------- | ------------------------------------------- |
| [CONFIGURATION.md](CONFIGURATION.md)           | TOML profiles: dev / staging / production   |
| [CONSTANTS.md](CONSTANTS.md)                   | All configuration constants reference       |
| [DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md)   | Deployment configuration                    |
| [RELEASE.md](RELEASE.md)                       | Release process                             |
| [LOGGING_QUICKSTART.md](LOGGING_QUICKSTART.md) | Logging: tracing, JSON logs, daily rotation |

## Integrations

| Document                                                       | Description                     |
| -------------------------------------------------------------- | ------------------------------- |
| [API_STUFFER.md](API_STUFFER.md)                               | Stuffer API (couriers/packages) |
| [COURIERS_STUFFER.md](COURIERS_STUFFER.md)                     | Couriers/Packages feature (EN)  |
| [COURIERS_STUFFER.ru.md](COURIERS_STUFFER.ru.md)               | Курьеры/Посылки (RU)            |
| [../cc-sync-server/docs/API.md](../cc-sync-server/docs/API.md) | Sync server WebSocket API       |

---

Removed on 2026-08-25 cleanup: `archive/` (sprint reports, old audits, websocket test
reports), `docs/AUDIT_2026-08-07.md`, `docs/BUGFIX_ROUND_7.md`, `docs/UI_FIXES.md`,
`docs/COMPONENT_REFACTOR.md`, `docs/TYPESCRIPT_MIGRATION.md`,
`docs/REDESIGN_OBSIDIAN_TERMINAL.md`, `PROJECT_STATUS.ru.md`, `ROADMAP.md` — all were
stale (≤ v2.5.0) or superseded; history lives in git.
