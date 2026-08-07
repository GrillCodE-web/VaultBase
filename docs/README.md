# VaultBase — Documentation Index

**Version:** 2.5.0
**Last Updated:** 2026-08-07

> Русскоязычные дубли ключевых документов: [../README.ru.md](../README.ru.md) ·
> [../PROJECT_STATUS.ru.md](../PROJECT_STATUS.ru.md) · [../AGENTS.ru.md](../AGENTS.ru.md) ·
> [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md) · [COURIERS_STUFFER.ru.md](COURIERS_STUFFER.ru.md).
> Документы CHECKLIST.md и ROADMAP.md уже на русском.

---

## 📚 Available Documentation

### Status & Planning

| Document                                  | Description                            |
| ----------------------------------------- | -------------------------------------- |
| [PROJECT_STATUS.md](../PROJECT_STATUS.md) | Real per-module status                 |
| [CHECKLIST.md](../CHECKLIST.md)           | Full feature/status checklist          |
| [ROADMAP.md](../ROADMAP.md)               | Planned work (Proxies, automation, UI) |
| [CHANGELOG.md](../CHANGELOG.md)           | Version history                        |

### Architecture & Auth

| Document                                     | Description                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | System architecture overview                                                |
| [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md)       | Login flow, master key, license roles                                       |
| [PERMISSIONS.md](PERMISSIONS.md)             | Granular permissions: guards, command map, and the 4 non-functional toggles |
| [DEPLOYMENT_CONFIG.md](DEPLOYMENT_CONFIG.md) | Server URL configuration — `VAULTBASE_SERVER_URL`, and the domain mismatch  |
| [ADMIN_AUTH.md](ADMIN_AUTH.md)               | Sync-server admin panel: session cookies, login page, trust-proxy fix       |
| [COURIERS_STUFFER.md](COURIERS_STUFFER.md)   | Couriers / Packages (Stuffer) integration                                   |
| [API_STUFFER.md](API_STUFFER.md)             | Stuffer API reference                                                       |
| [API.md](../cc-sync-server/docs/API.md)      | Sync-server API reference                                                   |

### Plans (design / hardening / automation)

| Document                                                        | Description                        |
| --------------------------------------------------------------- | ---------------------------------- |
| [DESIGN_MACOS_PLAN.md](../DESIGN_MACOS_PLAN.md)                 | Native macOS UI redesign plan      |
| [SMART_AUTOMATION_PLAN.md](../SMART_AUTOMATION_PLAN.md)         | Smart automation plan              |
| [ENCRYPTION_HARDENING_PLAN.md](../ENCRYPTION_HARDENING_PLAN.md) | Encryption/E2E hardening plan      |
| [PREMIUM_ENHANCEMENTS.md](../PREMIUM_ENHANCEMENTS.md)           | Design system / premium components |

### Security (audit history)

| Document                                                    | Description                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [SECURITY_AUDIT_COMPLETE.md](../SECURITY_AUDIT_COMPLETE.md) | Final security audit report                                                         |
| [AUDIT_2026-08-07.md](AUDIT_2026-08-07.md)                  | Sync/permissions/domain audit: what was fixed, and 2 audit findings that were wrong |
| [SECURITY_AUDIT_FIXES.md](../SECURITY_AUDIT_FIXES.md)       | Detailed fix list                                                                   |
| [AUDIT_REPORT.md](../AUDIT_REPORT.md)                       | Audit report                                                                        |
| [COMPLIANCE.md](COMPLIANCE.md)                              | GDPR and PCI DSS compliance                                                         |

### Development Guides (reference)

| Document                                           | Description                                                   |
| -------------------------------------------------- | ------------------------------------------------------------- |
| [COMPONENT_REFACTOR.md](COMPONENT_REFACTOR.md)     | Large component splitting guide                               |
| [UI_FIXES.md](UI_FIXES.md)                         | UI bug fixes: modals, stats nav, CSS namespacing rules        |
| [ICON_AND_BRANDING.md](ICON_AND_BRANDING.md)       | VaultBase icon design, legibility measurement, file inventory |
| [TYPESCRIPT_MIGRATION.md](TYPESCRIPT_MIGRATION.md) | TypeScript migration guide (not currently planned)            |

---

## 🚀 Quick Start for New Developers

1. Read [../README.md](../README.md) for the project overview.
2. Review [ARCHITECTURE.md](ARCHITECTURE.md) for system design.
3. Read [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md) to understand the login/roles model,
   then [PERMISSIONS.md](PERMISSIONS.md) for what an operator can actually do.
4. Check [CHECKLIST.md](../CHECKLIST.md) and [ROADMAP.md](../ROADMAP.md) for what's done and what's next.

---

## 🔗 External Resources

- **Tauri Documentation:** https://tauri.app
- **React Documentation:** https://react.dev
- **SQLite Documentation:** https://www.sqlite.org/docs.html
