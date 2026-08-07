# Bugfix Round: 7 Confirmed Frontend Bugs

**Date:** 2026-08-07
**Scope:** React frontend only (no Rust changes)
**Verification:** ESLint 0 errors, Vite build clean (15.37s), Vitest 317/317 passing (no tests asserted buggy behavior)

## Bugs Fixed

### Bug 1 (CRITICAL) — Inert filters/pagination

**File:** `src/pages/Cards.jsx:225`, `src/store/cards.js:85-86,111-113,134-136`
Changed effect deps from `[]` to `[filters, page]`. Added monotonic `requestId` counter in the store; stale responses are discarded at set-time. Search debounce already existed via `useDebounce(searchInput, 300)`.

### Bug 2 (CRITICAL) — `setFilters` poisoned by function args

**File:** `src/store/cards.js:37-41`, `src/store/orders.js` (same pattern)
Store action now accepts both signatures: `typeof next === 'function' ? next(state.filters) : {...state.filters, ...next}`. All 13+ call sites (CardFilters, CardRow, OrderFilters) work unchanged.

### Bug 3 (CRITICAL) — `.has()`/`.size` on arrays

**File:** `src/pages/Cards.jsx:919` (.includes), `src/pages/Orders.jsx` (6 sites: `.length`, `.includes`)
Verified `selected`/`deletingIds` are arrays in both stores. Fixed all Array-incompatible calls. **Profiles.jsx uses genuine `useState(new Set())` -- correctly left untouched.**

### Bug 4 (HIGH security) — Plaintext `bin_api_key` in renderer

**File:** `src/pages/Settings.jsx:93,224,238`
Reads `bin_api_key_set` flag instead of the key. Write-only input with masked placeholder. Clear button resets flag. **Rust note:** `bin_api_key_set` is not in `CONFIG_READABLE` allowlist (`src-tauri/src/main.rs`); `bin_api_key` IS still in `CONFIG_READABLE`. Another agent must add `bin_api_key_set` to the allowlist and remove `bin_api_key` from `CONFIG_READABLE`.

### Bug 5 (HIGH perf+security) — Auto-reveal decrypts 50 cards/page

**File:** `src/store/cards.js` (removed `autoRevealBatch`, added `revealCard`), `src/pages/Cards.jsx:113,605,671`, `src/pages/Cards/CardRow.jsx:49,130-145`
Reveal is now on-demand per row click via Eye button. `autoRevealBatch` deleted (no-dead-code rule). CardRow's existing graceful degradation (`displayNum` falls back to masked BIN+last4) ensures nothing breaks.

### Bug 6 (HIGH) — Double-click duplicate creation

**File:** `src/pages/Orders.jsx` (3 submit paths: StatusMenu, RepeatOrderModal, Create modal)
Added `useRef(false)` in-flight guards on all three. Guards placed after validation so modals still open; `finally` resets the ref. Kept local (4 sites < threshold for extracting `useAsyncAction` hook).

### Bug 7 (HIGH) — Virtualized `.map()` missing keys

**File:** `src/pages/Profiles.jsx:1,1524`
Changed `<>` to `<React.Fragment key={p.id}>`. Added `React` to the import (was missing -- would have been a ReferenceError).

## Audit Discrepancies Found

- **Naming:** Audit says `setFilter`; the store action is `setFilters` (plural). `setFilter` is only a prop name.
- **Bug 6 line range (326-360):** Points at `StatusMenu.handleStatus`, not the create modal. All three paths guarded regardless.
- **Extra bug found:** Orders.jsx bulk handlers read `selected.length` after the store cleared selection, yielding "0 orders" in toasts. Fixed by capturing `const ids = [...selected]` before the async call.
- **CardFilters has 11 updater call sites** (audit said ~12, missed lines 200/212). All handled by the dual-signature store fix.
