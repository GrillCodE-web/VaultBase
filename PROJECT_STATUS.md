# VaultBase — Project Status

**Last Updated:** 2026-08-09
**Version:** 2.11.2

> Russian version: [PROJECT_STATUS.ru.md](PROJECT_STATUS.ru.md).

> This document reflects the **real** current state of the project.
> For the granular task list see [CHECKLIST.md](CHECKLIST.md); for planned work see [ROADMAP.md](ROADMAP.md).

---

## Module status

| Module                                     | Status         | Notes                                                              |
| ------------------------------------------ | -------------- | ------------------------------------------------------------------ |
| Encryption (AES-256-GCM, PBKDF2 600k)      | ✅ Done        | Field-level encryption, keys zeroized on lock                      |
| License activation                         | ✅ Done        | Challenge → activation key via sync server                         |
| Master password / unlock                   | ✅ Done        | Derives DB key; auto-lock on inactivity                            |
| Solo-mode auto-login                       | ✅ Done        | Single-user installs skip the login screen                         |
| License-driven roles (admin/operator)      | ✅ Done        | Role stored on the license, applied on activate/verify             |
| Sync server (licenses, footprints, groups) | ✅ Done        | Node.js, deployed separately on VPS                                |
| Server migration v9 (`role` on licenses)   | ✅ Done (code) | Applies on first request after server restart                      |
| Cards                                      | ✅ Done        | Import/export, filters, health scoring                             |
| Profiles + Drops                           | ✅ Done        | Drops live inside Profiles (expand row)                            |
| Orders + carrier tracking                  | ⚠️ Partial     | UPS/FedEx/USPS tracking; Stuffer packages live in Couriers section |
| Catalog / Shops                            | ✅ Done        | Stats: success/decline rates                                       |
| IMAP mail + parsing                        | ✅ Done        | Multi-account, transaction parsing                                 |
| Proxies                                    | ⚠️ Partial     | CRUD + health check; no history/alerts/rotation                    |
| Activity log                               | ✅ Done        | Audit of all actions                                               |
| Users / My Stats                           | ✅ Done        | Admin manages users; operators see own stats                       |
| **Couriers / Packages (Stuffer)**          | ✅ Done        | Full backend + UI, real-time proxy of Stuffer API (v2.5.0)         |
| Smart automation (auto-archive, risk V2)   | ⬜ Planned     | See SMART_AUTOMATION_PLAN.md                                       |
| UI redesign (native macOS style)           | 🔄 In progress | Tokens ~80% migrated, cleanup pending                              |

Legend: ✅ done · ⚠️ partial · 🔄 in progress · ⬜ planned / not started

---

## Security

The March 2026 audit drove extensive remediation; details in
[SECURITY_AUDIT_COMPLETE.md](SECURITY_AUDIT_COMPLETE.md) and
[SECURITY_AUDIT_FIXES.md](SECURITY_AUDIT_FIXES.md). Its headline "119/119 fixed"
figure does not reconcile with its sources and should not be quoted — see the
note in [README.md](README.md#security-audit).

A further audit in August 2026 found and fixed a cross-user card-data exposure
and a password-hash migration that had never executed. Current status and the
remaining open items: [docs/AUDIT_2026-08-07.md](docs/AUDIT_2026-08-07.md).

Key properties:

- **Encryption:** AES-256-GCM (field-level)
- **Key derivation:** PBKDF2, 600,000 iterations
- **Password hashing:** bcrypt, cost 14 (all accounts since August 2026)
- **Rate limiting:** token bucket on sensitive operations
- **Memory safety:** keys zeroized on lock (ZeroizeOnDrop)
- **Secrets:** the first-run admin password is never logged or written to disk
- **Permissions:** 15 enforced granular permissions — [docs/PERMISSIONS.md](docs/PERMISSIONS.md)

---

## Verification commands

```bash
# Rust
cd src-tauri && cargo check

# Frontend lint + tests
npm run lint
npx vitest run

# Sync server syntax (deps require native build; runs on VPS)
node --check cc-sync-server/routes/activate.js

# Production build
npm run tauri build
```

Last verified locally (2026-08-06): `cargo check` ok · ESLint 0 problems · Vitest 317/317.

---

## Known gaps / next steps

1. **Couriers / Packages (Stuffer API)** — ✅ done (v2.5.0); read-only endpoints validated live, pending a live write test (`add_courier`/`new_package`) and optional profile/order linking.
2. **Proxies** — add health history, background checks, alerts, rotation.
3. **UI redesign** — finish token migration, clean dead CSS, rework shell.
4. **Smart automation** — auto-archive burned cards, risk scoring V2, config UI.

See [ROADMAP.md](ROADMAP.md) for the phased plan.
