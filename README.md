# CC Manager — Delivered Files (M00 → M09)

## Quick Integration Guide

### File map — where each file goes in your project

```
cc-manager/
├── src-tauri/src/
│   ├── license.rs                    ← REPLACE stub (M08)
│   ├── main_license_patch.rs         ← PATCH instructions for main.rs (M08)
│   ├── models_dashboard_patch.rs     ← APPEND to models.rs (M09)
│   ├── database_dashboard_patch.rs   ← APPEND inside impl Database in database.rs (M09)
│   └── main_dashboard_patch.rs       ← PATCH instructions for main.rs (M09)
│
└── src/
    ├── App.jsx                        ← REPLACE (M09 — badges + 5-state machine)
    ├── pages/
    │   ├── Activate.jsx               ← NEW page (M08)
    │   └── Dashboard.jsx              ← REPLACE stub (M09)
    ├── components/
    │   └── LicenseSection.jsx         ← NEW component (M08) — import in Settings.jsx
    └── i18n/
        ├── i18n_license_patch.js      ← MERGE keys into en.js + ru.js (M08)
        └── i18n_dashboard_patch.js    ← MERGE keys into en.js + ru.js (M09)
```

---

## Step-by-step integration

### 1. license.rs
Replace `src-tauri/src/license.rs` entirely.

### 2. models.rs
Append the contents of `models_dashboard_patch.rs` to the bottom of `models.rs`.

### 3. database.rs
Append the contents of `database_dashboard_patch.rs` inside `impl Database { ... }`.

> Note: The `period_bounds()` and `trend_pct()` helpers go **outside** `impl Database`,
> just before the `impl Database` block (or as free functions in the same file).

### 4. main.rs
Follow the patch comments in `main_license_patch.rs` and `main_dashboard_patch.rs`:
- Add the `#[tauri::command]` functions
- Add them to `invoke_handler![ ... ]`
- Replace the `.setup()` closure with the license boot flow (see `main_license_patch.rs`)

### 5. Cargo.toml — confirm these deps are present
```toml
ureq = { version = "2", features = ["json"] }
serde_json = "1"
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

### 6. React files
- Copy `App.jsx` → `src/App.jsx`
- Copy `Activate.jsx` → `src/pages/Activate.jsx`
- Copy `Dashboard.jsx` → `src/pages/Dashboard.jsx`
- Copy `LicenseSection.jsx` → `src/components/LicenseSection.jsx`
- Merge i18n patch keys into `src/i18n/en.js` and `ru.js`

### 7. Settings.jsx — add LicenseSection
```jsx
import { LicenseSection } from "../components/LicenseSection";
// ... inside Settings render:
<LicenseSection />
```

### 8. recharts dependency
```bash
npm install recharts
```

### 9. Dashboard navigation
`Dashboard.jsx` calls `onNavigate(page, props)` — this is wired through `App.jsx`'s
`MainShell` → `handleNavigate`. All page components should accept an `onNavigate` prop
for cross-page routing.

---

## Module summary

| Module | Contents |
|--------|----------|
| M00 | Scaffolding — all stubs, Tauri config, migrations |
| M01 | Auth — encryption, password setup/unlock/lock/change |
| M02 | Cards — parser, import wizard, bulk ops, BIN enrichment |
| M03 | Profiles + Drops — CRUD, duplicate detection, import |
| M04 | Email Pool + Proxies — bulk import, shop tracking |
| M05 | Shops — stats, smart suggestions, products |
| M06 | Orders — 9-step create modal, risk check, footprints |
| M07 | Sync server, admin panel, auto-updater |
| M08 | License — challenge-response activation, startup check |
| M09 | Dashboard — analytics, heatmap, charts, sidebar badges |
