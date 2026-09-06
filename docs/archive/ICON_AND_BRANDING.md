# Icon & Branding

## VaultBase Icon

### Design

A bold white **V** letterform with a **keyhole cutout** at the base, on a blue rounded-square tile.

- **Tile**: 512x512 with `rx=112` (macOS/iOS squircle convention)
- **Gradient**: `#1a8cff` → `#0057cc` (derived from the app's `--accent: #0a84ff`; deliberately avoids the generic purple-on-white cliche)
- **Shine overlay**: subtle top-down white gradient (`0.14` → `0` opacity at 45%) for depth
- **V glyph**: spans x=96→416 to maximize ink coverage; bold enough to read at 16px
- **Keyhole**: circle (r=27) + trapezoid cut from the V's base, rendering in the background gradient to create negative-space — the "vault" identity

### Legibility Verification

Each icon revision was rasterized at 16/24/32/48px and measured for ink coverage (white pixels vs background). The target band is 10–45%.

| Size | Coverage |
| ---- | -------- |
| 16px | 16.3%    |
| 24px | 18.3%    |
| 32px | 18.4%    |
| 48px | 18.0%    |

A prior revision (shield outline) measured only 6–8% and was rejected as "reads as a blob at small sizes."

### Source File

`public/vaultbase-icon.svg` — the single source of truth. All other icons are derived from it.

### `<text>` vs `<path>` Portability

The old server favicon used `<text font-family="system-ui">V</text>`. SVG `<text>` resolves fonts on the client OS, so glyph width, weight, and position vary across platforms — and can vanish entirely in headless rasterizers. The new icon bakes the V as a `<path>`, making geometry deterministic everywhere.

## File Inventory

### Client (Tauri desktop app)

| File                        | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `public/vaultbase-icon.svg` | Master SVG, used as browser favicon via Vite                             |
| `index.html`                | `<link rel="icon" href="/vaultbase-icon.svg">`                           |
| `float.html`                | Same                                                                     |
| `src-tauri/icons/*`         | Generated via `npx @tauri-apps/cli icon` — ICO, ICNS, AppX, iOS, Android |

`tauri.conf.json` references 5 icons: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`. All regenerated from the master SVG.

### Server (`cc-sync-server/`)

| File                   | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `public/favicon.svg`   | Byte-identical copy of the master icon                                                 |
| `index.js`             | `app.get('/favicon.svg', ...)` — explicit route (public/ is not statically mounted)    |
| `public/landing.html`  | `<link rel="icon" href="/favicon.svg">`, header logo replaced with inline V path       |
| `public/download.html` | `<link rel="icon" href="/favicon.svg">`, logo replaced with `<img src="/favicon.svg">` |
| `admin/index.html`     | `<link rel="icon" href="/favicon.svg">`, sidebar mark uses `<img src="/favicon.svg">`  |

### Key Finding

The client favicon was previously broken — both `index.html` and `float.html` linked to `/cc-icon.svg`, which did not exist in `public/`. On the server side, `public/` is deliberately not served via `express.static` (only `/releases` and the admin path are mounted), so `/favicon.svg` 404'd for all pages until the explicit `sendFile` route was added.

## Branding Fixes

`landing.html` carried 7 stale "Carto" strings (the previous project name). All replaced with "VaultBase", copyright updated to 2026. The 4-square grid logo mark was replaced with the V+keyhole glyph adapted to the page's warm tan palette (`--accent: #d4b896`).

`download.html`'s CSS-text "V" logo (purple→teal gradient, Inter font) was replaced with an `<img>` referencing the canonical icon.

`admin/index.html` sidebar brand was updated with the icon mark alongside the text.
