# CC Manager

A secure desktop application for managing payment cards, profiles, orders, and related data. Built with Tauri v2, React 18, and Rust.

## Features

- **Encrypted Storage** — All sensitive data (card numbers, CVVs) encrypted at rest with AES-256
- **Card Management** — Import, organize, and manage payment cards with BIN enrichment
- **Profile Management** — Link cards to delivery profiles and drops
- **Order Tracking** — Full order lifecycle management with status tracking
- **Dashboard** — Revenue analytics, heatmaps, and statistics
- **Updates Feed** — Activity log for all data changes
- **Multi-language** — English and Russian UI
- **Auto-lock** — Configurable inactivity timeout

## Requirements

- **macOS** 12.0+ (Monterey or later)
- **Node.js** 18+ and npm
- **Rust** 1.75+  (`rustup install stable`)
- **Xcode Command Line Tools** (`xcode-select --install`)

## Development Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd manager-work

# 2. Install frontend dependencies
npm install

# 3. Run in development mode (hot reload)
npm run tauri dev
```

## Building for Production

```bash
# Build the app bundle (.app + .dmg) — Intel
npm run tauri build

# Build for Apple Silicon (M1/M2/M3)
npm run tauri build -- --target aarch64-apple-darwin

# Build for Intel Mac explicitly
npm run tauri build -- --target x86_64-apple-darwin
```

Output files will be in `src-tauri/target/release/bundle/`:
- `macos/CC Manager.app` — Application bundle
- `dmg/CC Manager_*.dmg` — Disk image installer

## Generating Icons

If you update `icon.svg`, regenerate all icon sizes:

```bash
# Requires: pip3 install Pillow
cd src-tauri
python3 generate_icons.py
```

This generates `src-tauri/icons/` with all required sizes including `.icns` and `.ico`.

## Project Structure

```
manager-work/
├── src/                    # React frontend
│   ├── pages/              # Page components (Cards, Orders, Profiles, etc.)
│   ├── hooks/              # Custom hooks (useToast, useConfirm, useLang)
│   ├── components/         # Shared components
│   ├── i18n/               # Translations (en.js, ru.js)
│   └── App.jsx             # Root component + navigation
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Tauri commands entry point
│   │   ├── database.rs     # SQLite database operations
│   │   ├── models.rs       # Data models
│   │   └── license.rs      # License validation
│   ├── icons/              # App icons (generated)
│   ├── generate_icons.py   # Icon generation script
│   └── tauri.conf.json     # Tauri configuration
└── package.json
```

## Database

The SQLite database is stored at:
- macOS: `~/Library/Application Support/com.ccmanager.app/cc_manager.db`

The database is automatically created and migrated on first launch.

## Security

- Master password is required on launch
- All card data encrypted with the derived key
- Auto-lock after configurable timeout (1m, 5m, 15m, 30m, or never)
- Card numbers only decrypted on explicit "Reveal" action

## Module Summary

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

## Rust Dependencies

Key crates used in `src-tauri/Cargo.toml`:

```toml
ureq = { version = "2", features = ["json"] }
serde_json = "1"
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
```

## License

Proprietary. License key required for activation.
