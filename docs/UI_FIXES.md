# VaultBase — UI Fixes (Modals, Buttons, Statistics, Design Tokens)

**Date:** 2026-08-06
**Scope:** Frontend only (`src/`). No Rust/backend changes.
**Verification:** `npm run build` ✓ · `npx eslint` ✓ (0 errors) · `npx vitest run` ✓ (317/317 in 21 files)

---

## 1. Statistics section was unreachable

**Symptom:** "Статистика" nowhere in the app — the page existed but no nav entry rendered for
most users.

**Root cause:** `src/App.jsx` built the sidebar with a ternary that made _Users_ and _My Stats_
mutually exclusive. Admins saw only `users`; everyone else saw only `my_stats` — and because the
non-admin branch sat in the `else` arm of an unrelated permission check, in practice neither
rendered for regular accounts.

**Fix:** Split into two independent entries. `users` stays admin-gated via spread; `my_stats`
is unconditional.

```jsx
...(isAdmin ? [{
  key: 'users', icon: UserCog, page: 'users', label: t('nav_users'), badgeKey: null,
}] : []),
{ key: 'my_stats', icon: BarChart2, page: 'my_stats', label: t('nav_my_stats'), badgeKey: null },
```

`MyStats.jsx` itself needed no change — it was already wired to
`get_users_stats`, `get_user_period_stats`, `get_user_activity_log`, and
`get_my_card_assignments`.

---

## 2. Hardcoded nav labels (i18n gap)

Three sidebar entries shipped literal strings instead of `t()` calls, so they stayed English
under the Russian locale (`label: 'Catalog'`, and the two labels above).

**Fix:** Added parallel keys to both dictionaries and switched the labels to `t()`.

| Key            | `en.js`       | `ru.js`        |
| -------------- | ------------- | -------------- |
| `nav_users`    | Users         | Пользователи   |
| `nav_my_stats` | My Statistics | Моя статистика |
| `nav_catalog`  | Catalog       | Каталог        |

---

## 3. Couriers stylesheet was clobbering global form styles

**Symptom:** Form labels and modal chrome looked wrong on pages unrelated to Couriers.

**Root cause — the important one.** `src/styles/pages/couriers-redesign.css` defined _unprefixed,
global_ class names: `.form-label`, `.form-grid`, `.form-field`, `.modal-card`, `.modal-head`,
`.modal-foot`, `.label-row`, `.track-row`, `.spin`. Because every page stylesheet is bundled into
the same `app` cascade layer, whichever file imported last won. `.form-label` and `.modal-card`
already had canonical definitions in `components/forms-redesign.css` and
`components/modal-redesign.css`, so the Couriers copies silently overrode them across roughly
twenty form labels in Imap, Orders, Emails, Cards, and the batch-import modals. Nothing on the
Couriers page looked broken — the damage was entirely off-page, which is why it went unnoticed.

Worst offender: `.modal-card { background: var(--surface) }` fought the canonical
`background: var(--card)`, giving modals the wrong surface colour app-wide.

**Fix:** Rewrote the file. Every Couriers-owned class is now namespaced with a `cou-` prefix, and
the classes that duplicated a canonical global were deleted outright rather than renamed.

| Removed (global)                            | Replacement                                              |
| ------------------------------------------- | -------------------------------------------------------- |
| `.form-grid`                                | `.cou-form-grid`                                         |
| `.form-field` / `.form-field--full`         | `.cou-form-field` / `.cou-form-field--full`              |
| `.label-list` / `.label-row`                | `.cou-label-list` / `.cou-label-row`                     |
| `.form-tracks` / `.track-row`               | `.cou-form-tracks` / `.cou-track-row`                    |
| `.modal-card`, `.modal-head`, `.modal-foot` | deleted — use shared `Modal` (§4)                        |
| `.form-label`                               | deleted — canonical def lives in `forms-redesign.css:18` |
| `.spin`                                     | deleted — use `.animate-spin` (§6)                       |

`Couriers.jsx` was updated to the new class names in the same pass.

---

## 4. Couriers bypassed the shared Modal component

**Symptom:** "Модалки … всё разъебано, не ровно" — misaligned headers, inconsistent padding,
and neither dialog closed on Escape or trapped focus.

**Root cause:** Both Couriers dialogs were hand-rolled
`<div className="modal-overlay"><div className="modal-card">` markup. They reimplemented the
chrome by hand and inherited none of the shared behaviour.

**Fix:** Migrated both to `components/Modal.jsx`. This is a pure deletion of duplicated markup —
the shared component already provides focus trap (`useFocusTrap`), Escape-to-close,
focus restoration to the previously-focused element, `role="dialog"` / `aria-modal` /
`aria-labelledby`, backdrop click-to-close, and size tokens.

```jsx
<Modal isOpen={showForm} onClose={() => setShowForm(false)} title={t('pkg_new')} size="lg"
       footer={<>…</>}>
```

Accessibility gained for free: both dialogs are now keyboard-navigable and screen-reader
announced, which the hand-rolled versions were not.

---

## 5. Modal.jsx used inline Tailwind instead of its own stylesheet

**Root cause:** `Modal.jsx` imports `modal-redesign.css`, but its header/body/footer were styled
with inline Tailwind utilities (`flex items-center justify-between py-5 px-6 border-b`). The
imported CSS defined `.modal-header` / `.modal-body` / `.modal-footer` that nothing ever used, so
the design tokens in that file were dead and every modal in the app rendered with Tailwind's
spacing scale rather than the `--sp-*` scale.

**Fix:**

- `Modal.jsx` now emits `.modal-header`, `.modal-header__title`, `.modal-close`, `.modal-body`,
  `.modal-footer`.
- `modal-redesign.css` gained a `.modal-header__title` rule (the header previously had no title
  style of its own) and `margin-top: var(--sp-4)` on `.modal-body`.
- Deleted three dead `.modal-close-btn` rule blocks.

---

## 6. Phantom CSS custom properties

Several files referenced tokens that are not declared anywhere in `tokens-redesign.css`. An
undefined `var()` with no fallback resolves to nothing, so these silently fell back to inherited
or initial colours — text rendered at the wrong contrast rather than visibly breaking.

| Phantom          | Actual token   | Occurrences     |
| ---------------- | -------------- | --------------- |
| `--text-muted`   | `--muted`      | 53              |
| `--text-primary` | `--text`       | 9               |
| `--surface-2`    | `--surface-hi` | in couriers CSS |
| `--input-bg`     | `--card`       | in couriers CSS |

Affected files: `MyStats.jsx`, `UsersPage.jsx`, `UserLogin.jsx`, `couriers-redesign.css`.

**Related:** `.spin` was defined only in `couriers-redesign.css` but consumed by `Cards.jsx:897`
— a cross-page dependency that would have broken the Cards spinner the moment Couriers CSS was
touched. Both now use `.animate-spin` from `utilities-redesign.css`.

---

## 7. Hardcoded pixel values in Couriers CSS

The file used raw px throughout (`gap: 12px`, `border-radius: 10px`, `font-size: 14px`), so it
drifted from the rest of the app whenever the token scale changed. All replaced with
`var(--sp-*)`, `var(--r-*)`, and `var(--fs-*)`.

---

## 8. Layout jump while the Packages tab loaded

**Symptom:** The packages toolbar (Refresh / New package) appeared only _after_ the request
resolved, so the content below shifted downward on every load.

**Root cause:** `Couriers.jsx` early-returned the skeleton before the toolbar was rendered:

```jsx
if (loading) return <SkeletonRows count={6} /> // ← toolbar not yet mounted
```

**Fix:** The loading branch moved _inside_ each tab's own return. On the Packages tab the toolbar
stays mounted with the refresh button disabled and its icon spinning, and only the table area
swaps to a skeleton. Zero cumulative layout shift.

---

## 9. Rebrand: CC MANAGER → VAULTBASE

Header comments updated in `src/index.css`, `src/styles/index-redesign.css`,
`src/styles/tokens-redesign.css`, `src/styles/pages/premium-enhancements.css`.

---

## Files changed

| File                                                      | Change                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `src/App.jsx`                                             | Stats nav fix, `t()` labels                             |
| `src/i18n/en.js`, `src/i18n/ru.js`                        | 3 nav keys each                                         |
| `src/styles/pages/couriers-redesign.css`                  | Full rewrite — namespaced, tokenised                    |
| `src/pages/Couriers.jsx`                                  | Shared `Modal`, new class names, loading fix            |
| `src/components/Modal.jsx`                                | Tailwind → canonical CSS classes                        |
| `src/styles/components/modal-redesign.css`                | `.modal-header__title`, body spacing, dead-rule removal |
| `src/pages/MyStats.jsx`, `UsersPage.jsx`, `UserLogin.jsx` | Phantom token fixes                                     |
| `src/pages/Cards.jsx`                                     | `.spin` → `.animate-spin`                               |
| `src/index.css` + 3 stylesheets                           | Rebrand                                                 |

---

## Known remaining work

- **`MyStats.jsx` uses inline styles** with hardcoded values (e.g. `borderRadius: 12`) rather
  than design tokens. Functional, but inconsistent with the rest of the app — worth extracting to
  a stylesheet.
- **No visual regression testing yet.** Build, lint, and unit tests pass, but these changes are
  visual by nature and have not been confirmed in a running browser. The Tauri dev build is
  currently blocked (below).
- **Stale Cargo build cache.** `cargo check` fails because the build artefacts still embed
  absolute paths from `C:\PROJECT\CC_Manager`, the directory this project was moved from.
  Requires `cargo clean` (destructive — awaiting confirmation).

---

## Guidance for future page stylesheets

The §3 bug is the one most likely to recur, and it is invisible on the page that causes it.

1. **Namespace every page-scoped class.** `couriers-redesign.css` owns `cou-*`, and nothing else.
2. **Before adding a class name, grep for it across `src/styles/`.** If a canonical definition
   already exists in `components/`, use it — do not redefine it locally.
3. **Never redefine a `components/` class from a `pages/` file.** Page files load into the same
   `app` layer; there is no scoping, only import order.
4. **Use tokens, never raw px.** `--sp-*` / `--r-*` / `--fs-*`.
5. **Grep the token before using it.** `var(--nonexistent)` fails silently.
6. **Use the shared `Modal`.** Hand-rolled dialogs lose focus trap, Escape, and ARIA.
