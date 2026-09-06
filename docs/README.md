# VaultBase — Documentation Index

**Version:** 2.11.3 · **Updated:** 2026-08-25

## Start here

| Document                        | Description                                                   |
| ------------------------------- | ------------------------------------------------------------- |
| [README.md](../README.md)       | Main overview: feature map, run commands, layout, screenshots |
| [AGENTS.md](../AGENTS.md)       | Developer/agent guide (EN)                                    |
| Tasks & memory                  | `bd ready` (beads) + engram (`mem_context`/`mem_save`)        |
| [CHANGELOG.md](../CHANGELOG.md) | Version history                                               |

## Architecture & security

| Document                                             | Description                                        |
| ---------------------------------------------------- | -------------------------------------------------- |
| [TELEMETRY.md](TELEMETRY.md)                         | Телеметрия и мониторинг (RU)                       |
| [SECURITY.md](SECURITY.md)                           | Модель безопасности, шифрование, аудит (RU)        |
| [ARCHITECTURE.md](ARCHITECTURE.md)                   | System architecture (EN)                           |
| [ARCHITECTURE.ru.md](archive/ARCHITECTURE.ru.md)     | Архитектура системы (RU)                           |
| [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md)               | Login flow: license → master password → auto-login |
| [ADMIN_AUTH.md](ADMIN_AUTH.md)                       | Admin/operator auth model details                  |
| [PERMISSIONS.md](PERMISSIONS.md)                     | Full permission flags reference                    |
| [COMPLIANCE.md](archive/COMPLIANCE.md)               | Compliance notes                                   |
| [CSP_SECURITY_NOTE.md](CSP_SECURITY_NOTE.md)         | Why `unsafe-inline` in style-src and mitigations   |
| [ICON_AND_BRANDING.md](archive/ICON_AND_BRANDING.md) | Icons, branding assets                             |

## Design system

| Document                                     | Description                                                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN_SYSTEM.md](archive/DESIGN_SYSTEM.md) | Полный справочник дизайн-системы (RU): 7 CSS-файлов, все токены, темы, шрифты, иконки, геометрия, z-index, карта страниц, правила «не трогать», плейбук редизайна |
| [UI_PAGES.md](archive/UI_PAGES.md)           | Разметка и лейаут каждой страницы (RU): шапки, фильтры, таблицы, бейджи `.st-*`, модалки, float-окно, типографика, цветовые литералы, матрица влияния редизайна   |
| [REDESIGN_05_PLAN.md](REDESIGN_05_PLAN.md)   | Контракт редизайна 05 «Adaptive» + полный пакет фич: этапы, зависимости, что отклонено, трекинг/перебивка                                                         |
| [CHAT_E2E.md](CHAT_E2E.md)                   | E2E-шифрованная переписка (X25519 на worker_keys): модель, ключи, паник-стойкость, что видит сервер                                                               |

## Configuration & operations

| Document                                               | Description                                 |
| ------------------------------------------------------ | ------------------------------------------- |
| [CONFIGURATION.md](CONFIGURATION.md)                   | TOML profiles: dev / staging / production   |
| [CONSTANTS.md](CONSTANTS.md)                           | All configuration constants reference       |
| [DEPLOYMENT_CONFIG.md](archive/DEPLOYMENT_CONFIG.md)   | Deployment configuration                    |
| [RELEASE.md](RELEASE.md)                               | Release process                             |
| [LOGGING_QUICKSTART.md](archive/LOGGING_QUICKSTART.md) | Logging: tracing, JSON logs, daily rotation |

## Integrations

| Document                                                       | Description                     |
| -------------------------------------------------------------- | ------------------------------- |
| [API_STUFFER.md](archive/API_STUFFER.md)                       | Stuffer API (couriers/packages) |
| [COURIERS_STUFFER.md](archive/COURIERS_STUFFER.md)             | Couriers/Packages feature (EN)  |
| [COURIERS_STUFFER.ru.md](archive/COURIERS_STUFFER.ru.md)       | Курьеры/Посылки (RU)            |
| [../cc-sync-server/docs/API.md](../cc-sync-server/docs/API.md) | Sync server WebSocket API       |

---

Removed on 2026-08-25 cleanup: `archive/` (sprint reports, old audits, websocket test
reports), `docs/AUDIT_2026-08-07.md`, `docs/BUGFIX_ROUND_7.md`, `docs/UI_FIXES.md`,
`docs/COMPONENT_REFACTOR.md`, `docs/TYPESCRIPT_MIGRATION.md`,
`docs/REDESIGN_OBSIDIAN_TERMINAL.md`, `PROJECT_STATUS.ru.md`, `ROADMAP.md` — all were
stale (≤ v2.5.0) or superseded; history lives in git.
