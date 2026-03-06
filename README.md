# CC Manager

Desktop CRM for credit card operations.

**Stack:** Tauri v2 + Rust + React 18 + Vite + Tailwind CSS

## Quick Start

```bash
# Install frontend dependencies
npm install

# Run in dev mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Modules Completed
- M00 — Project skeleton, all IPC stubs, DB schema, React sidebar
- M01 — AES-256-GCM encryption, auth (setup/unlock/lock/change_password), Login UI
- M02 — CC parser (Luhn, auto-delimiter, column detection), CRUD, Cards page UI

## DB Location
`cc_manager.db` in the working directory (dev). Production uses `app_data_dir`.
