# Couriers / Packages — Stuffer Integration

**Version:** 2.5.0
**Status:** Implemented (backend + UI)

> Russian version: [COURIERS_STUFFER.ru.md](COURIERS_STUFFER.ru.md).
> API reference: [API_STUFFER.md](API_STUFFER.md).

The "Couriers / Packages" section integrates the external **Stuffer** panel. The desktop
app is a thin real-time proxy: it does not persist couriers or packages locally (yet), it
calls the Stuffer API on demand and renders the response.

---

## Architecture

```
React (Couriers.jsx)  ──invoke──►  Tauri commands (main.rs)  ──►  stuffer.rs (ureq)  ──►  Stuffer API
        ▲                                   │                                                  │
        │                                   └── reads base_url + api_key from config (short DB lock)
        └──────────────────────────── JSON response (couriers / packages / labels) ───────────┘
```

- **`src-tauri/src/stuffer.rs`** — HTTP client (`ureq`), serde models, error mapping.
  Network calls happen **outside** the DB mutex; only credential reads take a short lock.
- **`src-tauri/src/main.rs`** — Tauri commands + permission checks + audit logging.
- **`src/pages/Couriers.jsx`** — three tabs and the create-package form.

---

## Configuration

Set in **Settings → Stuffer API**:

| Field    | Config key         | Default                                      |
| -------- | ------------------ | -------------------------------------------- |
| Base URL | `stuffer_base_url` | `https://dash.stockhubdeal.com/api/stuffer/` |
| API key  | `stuffer_api_key`  | — (secret)                                   |

**Security:**

- The API key is stored in the `config` table and treated as a secret.
- It is **not** in the `CONFIG_READABLE` whitelist, so the generic `get_config` command
  cannot read it — only backend code reads it internally.
- `stuffer_get_config` returns only `{ api_key_set: bool, base_url }` — never the key value.
- Leaving the key field empty on save keeps the previously stored key.

---

## Tauri commands

| Command                           | Permission        | Maps to Stuffer                   |
| --------------------------------- | ----------------- | --------------------------------- |
| `stuffer_get_config`              | —                 | (local config view)               |
| `stuffer_set_config`              | `manage_couriers` | (local config write)              |
| `stuffer_list_couriers`           | `view_couriers`   | `GET ?json=couriers`              |
| `stuffer_list_available_couriers` | `view_couriers`   | `GET ?json=available_couriers`    |
| `stuffer_add_courier`             | `manage_couriers` | `POST ?json=add_courier`          |
| `stuffer_list_packages`           | `view_packages`   | `GET ?json=packages`              |
| `stuffer_get_labels`              | `view_packages`   | `GET ?json=labels&package_id=...` |
| `stuffer_create_package`          | `create_packages` | `POST ?json=new_package`          |

Argument names follow Tauri camelCase (e.g. `courierId`, `packageId`, `package`).

### Permissions (`models.rs`)

- `view_couriers`, `view_packages`, `create_packages` — granted to operators by default.
- `manage_couriers` (add couriers, save API config) — admin or explicit permission.

---

## UI (`src/pages/Couriers.jsx`)

- **My Couriers** — assigned couriers (name, status, address, expiry, package counts).
- **Available** — couriers that can be added; "Add courier" calls `stuffer_add_courier`.
- **Packages** — up to 500 recent packages; per-package "Labels" opens a modal to view and
  download each label as a PDF (base64 → Blob). "New package" opens the create form.
- The create form maps to the Stuffer `new_package` payload (courier, name, holder, weight,
  quantity, shop, price, delivery date, pay option, ASIN, UPC, comment, and a repeatable
  track/carrier list).

Navigation, sub-tabs (`assigned` / `available` / `packages`) and lazy loading are wired in
`App.jsx`.

---

## Error handling

`stuffer.rs` maps failures to stable string codes surfaced to the UI:

- `stuffer_not_configured` — no API key set.
- `stuffer_network_error` — transport failure.
- `stuffer_http_<code>` — non-JSON HTTP error.
- `stuffer_api_error[:<code>]: <msg>` — Stuffer returned `{"error": ...}`.
- `stuffer_missing_field` / `stuffer_parse_error` / `stuffer_decode_error` — unexpected body.

---

## Validation status

- **Read-only endpoints verified against the live Stuffer API** (2026-08-06):
  `couriers` (16 records), `available_couriers` (840), `packages` (41). All parsed cleanly;
  the serde structs match the live shapes (an extra `comments[].sender_name` field returned
  by the server is safely ignored).
- **Write endpoints not yet exercised live:** `add_courier` and `new_package` were verified
  only against the documented request/response contract (no test mutations were sent).
- Also green: `cargo check`, `npm run lint`, `vite build`, `vitest` 317/317.

## Not done yet

- Live run of the write endpoints (`add_courier`, `new_package`) with a real mutation.
- Optional local caching of couriers/packages in the DB.
- Optional linking of a courier to a profile and a package to a local order (rationale for
  keeping them separate: [DESIGN_MACOS_PLAN.md](../DESIGN_MACOS_PLAN.md) §13).
- **PPTP API** — to be added by analogy once documentation is available.
