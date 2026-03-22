# CC Manager — MASTER PLAN
> Последнее обновление: 2026-03-14 (Сессия 4)

---

## ЛЕГЕНДА
- ✅ Сделано (подтверждено)
- ❌ Не сделано
- 🔶 Частично / нужно проверить
- ⭐ Высокий приоритет

---

## БЛОК A — КРИТИЧЕСКИЕ БАГИ (все исправлены)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| A1 | `with_db!` вызывает `touch_activity()` | `main.rs` | ✅ |
| A2 | CONFIG_READABLE/WRITABLE расширены (always_on_top, dash_collapsed_*, badge_*) | `main.rs` | ✅ |
| A3 | `safeParseJSON` в App.jsx | `App.jsx` | ✅ |
| A4 | await-фиксы (float.jsx, Profiles.jsx) | multiple | ✅ |
| A5 | decrypt failed → fallback to cache (toast fix) | `imap.rs` | ✅ |
| A6 | Settings `confirm()` второй аргумент | `Settings.jsx` | ✅ |
| A7 | `handleAutoLock` awaits перед setState | `Settings.jsx` | ✅ |
| A8 | onNavigate prop в `Imap({ onNavigate })` — Email Pool tab не падает | `Imap.jsx` | ✅ |
| A9 | Forced `setTab("inbox")` в `selectFolder()` убран | `Imap.jsx` | ✅ |

---

## БЛОК B — macOS ПОВЕДЕНИЕ ОКНА (все готово)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| B1 | CloseRequested → hide вместо kill | `main.rs` | ✅ |
| B2 | Dock Reopen → показать скрытое окно | `main.rs` | ✅ |
| B3 | Dock badge (osascript + настройки) | `main.rs` + `Settings.jsx` | ✅ |
| B4 | Float window CloseRequested fix | `float.jsx` | ✅ |

---

## БЛОК C — CSS FOUNDATION (все готово)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| C1 | `--hover`, `--surface-hi` добавлены в tokens | `tokens.css` | ✅ |
| C2 | `--muted: #5a6a82` (лучший контраст) | `tokens.css` | ✅ |
| C3 | `.btn-icon`, `.btn-icon-only` + цвет-варианты | `buttons.css` | ✅ |
| C4 | `.period-bar width: 100%` | `panel.css` | ✅ |
| C5 | Stat card `border-top: 4px` | `dashboard.css` | ✅ |
| C6 | `.base-strip padding: 13px` | `dashboard.css` | ✅ |
| C7 | `.grid2 minmax(0,1fr)` + `@media ≤600px` | `content.css` | ✅ |
| C8 | `.ph-actions flex-wrap: wrap` | `content.css` | ✅ |
| C9 | `calc(100vh-270px)` → flex во всех файлах | Cards/Emails/Proxies/Profiles | ✅ |

---

## БЛОК D — EMOJI → LUCIDE (все заменено)

| Файл | Что заменено | Статус |
|------|-------------|--------|
| `Imap.jsx` | tabs emoji, folderIcon(), заголовок, кнопки compose | ✅ |
| `Dashboard.jsx` | `⚠` → AlertTriangle, `▶▼` → ChevronRight анимация, `↻⬇` → Lucide | ✅ |
| `Profiles.jsx` | `🎲 Auto` → Shuffle, `⬇ Export` → Download, `⚠️` → AlertTriangle, `👤` → User | ✅ |
| `Cards.jsx` | `⚡ BIN Enrich` → Zap, `⚠` → AlertTriangle x2, `🗂` → Archive, `⬆` → Upload | ✅ |
| `Shops.jsx` | `↗` → ExternalLink x2, `🏪` → Store x2, `🔍` убрано из placeholder | ✅ |
| `Orders.jsx` | `📦` → Package, `🔍` убрано из placeholder | ✅ |
| `Emails.jsx` | `🚫` → ShieldOff, `🗑` → Trash2, `📧` → Mail | ✅ |
| `ActivityLog.jsx` | `↻` → RefreshCw | ✅ |
| `Updates.jsx` | `↻` → RefreshCw (5 мест) | ✅ |
| `Proxies.jsx` | `🌐` → Globe, `🛡️` → Shield | ✅ |
| `Settings.jsx` | spinner RefreshCw на sync group loading | ✅ |
| `useToast.jsx` | emoji иконки → Lucide (CheckCircle/XCircle/AlertTriangle/Info) | ✅ |

---

## БЛОК E — DASHBOARD REDESIGN (готово)

| # | Задача | Статус |
|---|--------|--------|
| E1 | Chart height 180 → 260 | ✅ |
| E2 | Heatmap minWidth 48 → 72, убраны maxWidth | ✅ |
| E3 | Heatmap opacity → 0.65/0.55/0.65 | ✅ |
| E4 | Collapse chevron с CSS анимацией (ChevronRight) | ✅ |
| E5 | "View all" → `btn btn-ghost btn-sm` | ✅ |
| E6 | Heatmap legend цвета обновлены | ✅ |

---

## БЛОК F — IMAP (BUGS + UX)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| F1 | Modal state разделён (showAddImap/editAccount/showAddSmtp/showCompose) | `Imap.jsx` | ✅ |
| F2 | Delete кнопка в MessageViewer (оптимистичное удаление) | `Imap.jsx` | ✅ |
| F3 | FolderIcon компонент с Lucide (вместо emoji функции) | `Imap.jsx` | ✅ |
| F4 | Modal widths → var(--modal-md/lg) | `Imap.jsx` | ✅ |
| F5 | Folder unread counts в FolderRow | `Imap.jsx` | ✅ |

---

## БЛОК G — ACTION BUTTONS REDESIGN

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| G1 | Создан `ActionsMenu.jsx` — dropdown с группами, fixed позиция | `components/` | ✅ |
| G2 | Cards: 8 кнопок → 2 иконки + ActionsMenu с группами | `Cards.jsx` | ✅ |
| G3 | Profiles: 6 кнопок → Float button + ActionsMenu | `Profiles.jsx` | ✅ |
| G4 | Shops: checkbox + bulk delete добавлен | `Shops.jsx` | ✅ |

---

## БЛОК H — МОДАЛКИ + ТОСТЫ

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| H1 | Modal widths по токенам (sm/md/lg) — Imap/Cards/Profiles | all | ✅ |
| H2 | Modal widths — Orders/Emails/Proxies | all | ✅ |
| H3 | Loading states в кнопках Save (AccountModal/SmtpModal) | `Imap.jsx` | ✅ |
| H4 | Toast warn баг (прозрачный текст) исправлен | `useToast.jsx` | ✅ |

---

## БЛОК I — ПРОФИЛИ (WORKFLOW ФИЧИ)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| I1 | Profile Templates (DB + Rust + React) | multiple | ✅ |
| I2 | Quick Create mode | `Profiles.jsx` | ✅ |
| I3 | Duplicate Profile кнопка | `Profiles.jsx` | ✅ |
| I4 | Keyboard navigation (↑↓ Enter e d Esc) | `Profiles.jsx` | ✅ |
| I5 | Smart Card Assign "Auto" (Shuffle icon) | `Profiles.jsx` | ✅ |
| I6 | autolock flexWrap (кнопки не overflow) | `Settings.jsx` | ✅ |

---

## БЛОК J — SYNC SERVER (cc-sync-server)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| J1 | SimpleCache с TTL | `cache.js` | ✅ |
| J2 | Migration v5 (sync_groups, sync_group_members, sync_pair_codes, sync_cards) | `database.js` | ✅ |
| J3 | HTTP роуты `/sync/*` | `routes/sync.js` | ✅ |
| J4 | socket.io инициализация | `socket.js` + `index.js` | ✅ |
| J5 | Admin API: sync-groups CRUD | `routes/admin-api.js` | ✅ |
| J6 | GET /admin/api/stats + /licenses — кеш | `routes/admin-api.js` | ✅ |
| J7 | GET /invite/version — кеш | `routes/invite.js` | ✅ |

---

## БЛОК K — SYNC (Rust + React)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| K1 | sync_create_group/pair_code/join_group/disconnect | `sync.rs` | ✅ |
| K2 | ws_sync.rs — WebSocket клиент (tokio-tungstenite) | `ws_sync.rs` | ✅ (файл есть) |
| K3 | Settings.jsx — Sync Groups секция (create/join/leave) | `Settings.jsx` | ✅ |
| K4 | React real-time обновление карт при WS событии | `Cards.jsx` | ✅ |

---

## БЛОК L — FOOTPRINT UI ⭐

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| L1 | Footprint API реализован в Rust | `database.rs` + `main.rs` | ✅ |
| L2 | Cards: CardShopUsagePanel side panel | `Cards.jsx` | ✅ (есть, строки 676-808) |
| L3 | Cards: CardTimelinePanel | `Cards.jsx` | ✅ (есть) |
| L4 | Emails: колонка "Shops" + EmailShopsCell | `Emails.jsx` | ✅ |
| L5 | Shops: ShopRiskBadge + колонка "Risk" | `Shops.jsx` | ✅ |
| L6 | Orders: toast "Mark as dead" при declined/cancelled | `Orders.jsx` | ✅ |

---

## БЛОК M — УЛУЧШЕНИЯ (Сессия 5)

| # | Задача | Статус |
|---|--------|--------|
| M1 | Flash animation на строке карты при sync события | ✅ (inline styles + 2s timer) |
| M2 | Bulk BIN Enrich с live прогрессом | ✅ (enrichProgress state, done/total) |
| M3 | Export Selected cards (TXT/CSV) | ✅ (кнопки в bulk toolbar) |
| M4 | Автостатус при declined → mark dead toast | ✅ (confirm dialog в StatusMenu) |
| M5 | Invite кеш на сервере | ✅ (5-min TTL) |

---

## БЛОК N — НИЗКИЙ ПРИОРИТЕТ / ОПЦИОНАЛЬНО

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| N1 | Hover handlers в Profiles.jsx → CSS `.icon-btn-*` | `Profiles.jsx` + `buttons.css` | ✅ (7 кнопок) |
| N4 | BIN lookup кеш в SQLite (30-day TTL) | `database.rs` | ✅ (migration_v5) |
| N5 | WS ping keepalive клиент (каждые 30 сек) | `ws_sync.rs` | ✅ |
| N6 | Flash animation → `@keyframes row-flash` + CSS class | `animations.css` | ✅ |
| N7 | Status dots Shops → CSS `.status-dot` (Orders `<option>` оставлены) | `panel.css` + `Shops.jsx` | ✅ |
| N8 | `🏦` → `<Landmark>`, `💳` → `<CreditCard>` в Cards | `Cards.jsx` | ✅ |
| N9 | `🔍` убрано из placeholder ActivityLog | `ActivityLog.jsx` | ✅ |

---

## БЛОК O — ПРОИЗВОДИТЕЛЬНОСТЬ + КАЧЕСТВО (Сессия 6)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| O1 | `useMemo` для groupedCards, orderedColumns, visibleHeaders | `Cards.jsx` | ✅ |
| O2 | Rate limiting на `/sync/group/join` (10 req/15min) и `/group/pair` (20 req/hr) | `cc-sync-server/routes/sync.js` | ✅ |
| O3 | i18n: hardcoded "Cancel/Save/Delete/Columns" → `t()` (5 файлов) | multiple | ✅ |

---

## БЛОК P — ФИНАЛЬНАЯ ЧИСТКА (Сессия 7)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| P1 | i18n: "Group" → `t("cc_group_by_bank")`, "Archive Dead" → `t("cc_archive_dead")` | `Cards.jsx` + `en.js` + `ru.js` | ✅ |
| P2 | Updates.jsx: emoji иконки → Lucide (Package/CheckCircle/Receipt/XCircle/AlertTriangle/Pin) | `Updates.jsx` | ✅ |
| P3 | Все 🔶 статусы проверены и подтверждены выполненными | MASTER_PLAN.md | ✅ |
| P4 | `.upd-icon` color tokens добавлены для SVG иконок (trk/del/can/con/wrn) | `updates.css` | ✅ |
| P5 | GlobalSearch: добавлена секция profiles + email + i18n ("No results", "N results", ShortcutsHint) | `App.jsx` + `en.js` + `ru.js` | ✅ |
| P6 | GlobalSearch Rust: profile search через drops.recipient_name JOIN | `database.rs` | ✅ |
| P7 | Sidebar ←/→ unicode → Lucide ChevronLeft/ChevronRight | `App.jsx` | ✅ |
| P8 | TYPE_PAGE mapping: profile → "profiles" добавлен | `App.jsx` | ✅ |

---

## БЛОК Q — IMAP ОПТИМИЗАЦИЯ + i18n (Сессия 8)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| Q1 | FolderRow/FolderTree/MessageList вынесены на верхний уровень (remount bug fix) | `Imap.jsx` | ✅ |
| Q2 | `loadAccounts` stale closure исправлен (functional setState update) | `Imap.jsx` | ✅ |
| Q3 | ComposeModal `onSent` prop добавлен (обновление Sent таба после отправки) | `Imap.jsx` | ✅ |
| Q4 | Клик по аккаунту в FolderTree — убран принудительный selectFolder | `Imap.jsx` | ✅ |
| Q5 | Пагинация: Next кнопка disabled при последней странице (`totalPages`) | `Imap.jsx` | ✅ |
| Q6 | ~30 hardcoded строк → `t()` во всех модалках IMAP | `Imap.jsx` + `en.js` + `ru.js` | ✅ |
| Q7 | i18n синтаксис исправлен (IMAP ключи были вне экспортного объекта) | `en.js` + `ru.js` | ✅ |

---

## БЛОК R — КАТАЛОГ + UNIFIED INBOX + FLOAT + ДЕПЛОЙ (Сессия 9)

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| R1 | Float window: macOS transparency (blur 24px) + glassmorphism CSS | `float.jsx` + `tauri.conf.json` | ✅ |
| R2 | Float footer: + Order кнопка, убраны emoji | `float.jsx` | ✅ |
| R3 | DB migration v6: `catalog_items` + `catalog_shops` таблицы | `database.rs` | ✅ |
| R4 | Rust commands: `search_catalog_items`, `search_catalog_shops`, `import_catalog_*`, `get_catalog_stats` | `main.rs` + `database.rs` + `models.rs` | ✅ |
| R5 | Orders.jsx: catalog autocomplete в item name (dropdown с name/ASIN/price) | `Orders.jsx` | ✅ |
| R6 | Orders.jsx: shop поиск = local + catalog (с auto-create при выборе из каталога) | `Orders.jsx` | ✅ |
| R7 | Orders.jsx: email Pool/Custom toggle (можно вписать email напрямую) | `Orders.jsx` | ✅ |
| R8 | IMAP: убраны 5 вкладок → unified 3-column inbox всегда видим | `Imap.jsx` | ✅ |
| R9 | IMAP: AccountsPanel (gear icon) = IMAP + SMTP управление в одном месте | `Imap.jsx` | ✅ |
| R10 | IMAP: SMTP auto-detect при добавлении аккаунта (23 домена) | `Imap.jsx` | ✅ |
| R11 | IMAP: auto-create SMTP при добавлении IMAP аккаунта (checkbox) | `Imap.jsx` | ✅ |
| R12 | cc-sync-server деплой → 159.198.47.15:3001, nginx /sync + /socket.io | `server` | ✅ |

---

## ✅ ПРОЕКТ ЗАВЕРШЁН

Все задачи реализованы. Билд чистый: ✓ 0 ошибок (Rust + React).

**Последнее обновление:** 2026-03-15 (Сессия 9)

---

## ФАЙЛЫ ПРОЕКТА

```
/Users/jellybeats/Documents/CC_Manager/manager-work
├── src/                    # React frontend
│   ├── pages/              # Все страницы
│   ├── components/         # ActionsMenu, EmptyState, SkeletonRow
│   ├── hooks/              # useToast, useConfirm, useLang
│   └── styles/             # tokens.css, buttons.css, etc.
├── src-tauri/src/          # Rust backend
│   ├── main.rs             # Tauri commands (~60+ команд)
│   ├── database.rs         # SQLite методы
│   ├── imap.rs             # IMAP polling + fetch
│   ├── smtp.rs             # SMTP sending
│   ├── sync.rs             # Sync HTTP clients
│   ├── ws_sync.rs          # WebSocket sync client
│   └── models.rs           # Structs
└── cc-sync-server/         # Node.js sync сервер
    ├── routes/             # sync.js, admin-api.js, invite.js
    ├── socket.js           # Socket.io логика
    ├── cache.js            # SimpleCache с TTL
    └── database.js         # SQLite + migrations
```
