# VaultBase — Architecture Documentation

**Version:** 2.5.0
**Last Updated:** 2026-08-06

> Russian version: [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md).

---

## Access & Auth flow

```
┌────────────┐   activation key   ┌──────────────┐   master password   ┌──────────────┐
│  Activate  │ ─────────────────► │  Master key  │ ──────────────────► │  Auto-login  │
│  license   │  (role from server)│  unlock DB   │  derive AES key     │  (solo mode) │
└────────────┘                    └──────────────┘                     └──────────────┘
      │                                                                        │
      └── config license_role (admin/operator), refreshed on every /verify ────┘
```

- **Role** is carried by the license (server side) and applied on the client at
  activate/verify time. In solo mode (single local user) there is no login screen — the app
  enters directly after the master password.
- Full details: [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md).

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CC Manager Desktop                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   React 18  │  │   Tauri 2   │  │      Rust Backend       │  │
│  │   Frontend  │◄─┤    IPC      │◄─┤  ┌───────────────────┐  │  │
│  │  (12 nav +  │  │   Bridge    │  │  │   SQLite (rusqlite)│  │  │
│  └─────────────┘  └─────────────┘  │  │   15+ tables       │  │  │
│         │                          │  └───────────────────┘  │  │
│         │                          │  ┌───────────────────┐  │  │
│  ┌─────────────┐                  │  │   Encryption      │  │  │
│  │  Zustand    │                  │  │   AES-256-GCM     │  │  │
│  │  Store      │                  │  │   PBKDF2 600K     │  │  │
│  └─────────────┘                  │  └───────────────────┘  │  │
│                                    │  ┌───────────────────┐  │  │
│                                    │  │   IMAP/SMTP       │  │  │
│                                    │  │   WebSocket       │  │  │
│                                    │  └───────────────────┘  │  │
│                                    └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   Sync Server     │
                    │   (Node.js + Express)│
                    │   - Catalog API   │
                    │   - BIN Cache     │
                    │   - Admin Panel   │
                    └───────────────────┘
```

---

## Frontend Architecture

### Directory Structure

```
src/
├── components/          # Reusable UI components
│   ├── AppShell.jsx    # Main layout (Navbar + content)
│   ├── Navbar.jsx      # Navigation sidebar
│   ├── GlobalSearch.jsx # Search across all entities
│   ├── Modal.jsx       # Base modal component
│   ├── EmptyState.jsx  # Empty state component
│   └── Skeleton*.jsx   # Loading skeletons
├── pages/              # Page-level components
│   ├── DashboardRedesigned.jsx # Analytics dashboard (old Dashboard.jsx removed)
│   ├── Cards.jsx       # Cards management (962 lines)
│   ├── Orders.jsx      # Orders management (1704 lines)
│   ├── Profiles.jsx    # Profiles + drops (1578 lines)
│   ├── Imap.jsx        # Email integration (2063 lines)
│   ├── Drops.jsx       # Stub — drops live inside Profiles (88 lines)
│   ├── Settings.jsx    # Application settings
│   └── ...
├── hooks/              # Custom React hooks
│   ├── useLang.jsx     # i18n (840+ keys en/ru)
│   ├── useToast.jsx    # Toast notifications
│   ├── useConfirm.jsx  # Confirmation dialogs
│   ├── useFocusTrap.jsx # Accessibility focus trap
│   └── useDebounce.js  # Debounce utility
├── store/              # Zustand stores
│   ├── cards.js        # Cards state + actions
│   ├── orders.js       # Orders state + actions
│   ├── profiles.js     # Profiles state + actions
│   └── settings.js     # Settings state
├── utils/              # Utility functions
│   ├── formatting.js   # Date, currency, card formatting
│   ├── validation.js   # Input validation (Luhn, email, CVV)
│   ├── cardHealth.js   # Health scoring algorithm
│   ├── csv.js          # CSV parse/generate
│   ├── pagination.js   # Pagination helpers
│   ├── clipboard.js    # Clipboard operations
│   ├── errorHandler.js # Centralized error handling
│   └── escape.js       # XSS prevention
├── constants/          # Application constants
│   ├── cardTypes.js    # Visa, MC, Amex patterns
│   ├── status.js       # Status definitions + colors
│   ├── emailProviders.js # IMAP provider configs
│   └── colors.js       # Theme colors
├── i18n/               # Internationalization
│   ├── en.js           # English translations (840 keys)
│   └── ru.js           # Russian translations (840 keys)
└── styles/             # Global styles
    ├── index.css       # Main stylesheet
    └── components/     # Component-specific styles
```

### Component Hierarchy

```
App.jsx (Root)
├── AppShell
│   ├── Navbar (navigation)
│   │   └── LicenseSection
│   └── GlobalSearch
├── Page Router
│   ├── DashboardRedesigned
│   │   └── Recharts components
│   ├── Cards
│   │   ├── CardFilters
│   │   ├── CardRow (virtualized)
│   │   │   ├── CardField
│   │   │   ├── ExpiryCell
│   │   │   └── NoteCell
│   │   ├── CardSidePanel
│   │   │   ├── CardTimelinePanel
│   │   │   └── CardShopUsagePanel
│   │   └── ImportModal
│   ├── Orders
│   │   ├── OrderFilters
│   │   ├── OrderRow (virtualized)
│   │   └── BatchImportModal
│   ├── Profiles
│   │   ├── ProfileFilters
│   │   ├── ProfileRow (virtualized)
│   │   └── ProfileModal
│   ├── Imap
│   │   ├── AccountModal
│   │   ├── SmtpModal
│   │   ├── FolderTree
│   │   └── EmailList (virtualized)
│   └── Settings
│       └── LicenseSection
└── ToastProvider
└── ConfirmDialog
```

### State Management

**Zustand Stores (5 total):**

| Store       | Purpose                 | Persistence          |
| ----------- | ----------------------- | -------------------- |
| cards.js    | Cards CRUD + filters    | Session (5min cache) |
| orders.js   | Orders CRUD + filters   | Session (5min cache) |
| profiles.js | Profiles CRUD + filters | Session (5min cache) |
| settings.js | App settings            | localStorage         |
| sync.js     | Sync state              | Session              |

**State Flow:**

```
User Action → Component → Store Action → Tauri Command → Rust Handler
                ↑                                              │
                └───────────── Response ◄──────────────────────┘
```

---

## Backend Architecture (Rust)

### Module Structure

```
src-tauri/src/
├── main.rs           # Entry point + Tauri commands (190 commands)
├── database/         # SQLite operations, split by domain (11 submodules)
│   ├── mod.rs        # Database struct + impl wrapper
│   ├── _core.rs      # Connection, pool, config, encryption glue
│   ├── _cards.rs     # Cards
│   ├── _orders.rs    # Orders + tracking
│   ├── _profiles.rs  # Profiles + drops (delivery addresses)
│   ├── _shops.rs     # Shops / catalog stats
│   ├── _imap.rs      # IMAP accounts + parsed mail
│   ├── _users.rs     # Users, sessions, roles, auto-login
│   ├── _analytics.rs # Dashboard / risk stats
│   ├── _misc.rs      # Misc operations
│   ├── _helpers.rs   # Helper functions
│   └── _migrations.rs# Schema migrations
├── encryption.rs     # Crypto operations (AES-256-GCM, PBKDF2)
├── license.rs        # License validation + challenge-response
├── sync.rs           # HTTP sync client
├── ws_sync.rs        # WebSocket real-time sync
├── imap.rs           # Email monitoring + parsing
├── smtp.rs           # Email sending (lettre)
├── parser.rs         # Email parser (card detection)
├── tracking.rs       # Carrier tracking (UPS/FedEx/USPS, 17track fallback)
├── stuffer.rs        # Stuffer API client (couriers / packages)
├── models.rs         # Data structures + permissions
└── rate_limiter.rs   # Rate limiting (token bucket)
```

### Database Schema (27 tables)

Defined in `src-tauri/src/database/_migrations.rs`.

```sql
-- Core tables
credit_cards       -- Card records (encrypted fields)
card_assignments   -- Card-to-user assignments
bin_cache          -- BIN lookup cache (bank, country, level)

-- Email
imap_accounts      -- IMAP account configs (encrypted)
imap_messages      -- Fetched IMAP messages
smtp_configs       -- SMTP account configs (encrypted)
sent_emails        -- Outbound email log
email_pool         -- Reusable email addresses

-- Organization
profiles           -- Customer profiles
profile_templates  -- Reusable profile presets
drops              -- Drop addresses
orders             -- Order records
order_templates    -- Reusable order presets
shops              -- Shop/merchant data
shop_products      -- Products per shop
shop_footprints    -- Per-shop footprint hashes
proxies            -- Proxy configurations
proxy_shop_bindings -- Proxy-to-shop pinning

-- Catalog (synced from server)
catalog_items      -- Catalog item cache
catalog_shops      -- Catalog shop cache

-- Users & system
users              -- Local user accounts
user_permissions   -- Per-user permission grants
user_sessions      -- Active sessions
user_activity      -- Per-user activity trail
activity_log       -- Application activity log
automation_config  -- Automation settings
config             -- App settings (key-value)
```

The sync server keeps a separate SQLite schema (`cc-sync-server/database.js`):
`licenses`, `invite_codes`, `footprints`, `versions`, `release_files`,
`audit_log`, `sync_groups`, `sync_group_members`, `sync_cards`,
`sync_pair_codes`.

### Security Layers

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  - Rate limiting (token bucket)         │
│  - Input validation                     │
│  - SQL injection prevention             │
├─────────────────────────────────────────┤
│         Encryption Layer                │
│  - AES-256-GCM (data at rest)           │
│  - PBKDF2 600K iterations (key deriv)   │
│  - bcrypt cost 14 (password hash)       │
│  - ZeroizeOnDrop (memory safety)        │
├─────────────────────────────────────────┤
│         Database Layer                  │
│  - WAL mode (concurrent reads)          │
│  - Connection pooling (r2d2, 8 conn)    │
│  - Foreign keys enforced                │
│  - Integrity checks                     │
└─────────────────────────────────────────┘
```

---

## Sync Server Architecture

### Directory Structure

```
cc-sync-server/
├── routes/
│   ├── catalog.js      # Catalog API (items, shops)
│   ├── bin.js          # BIN cache (encrypted)
│   ├── admin-api.js    # Admin endpoints (licenses)
│   ├── activate.js     # License activation
│   ├── upload.js       # File upload (updates)
│   ├── sync.js         # Sync endpoints
│   ├── footprint.js    # Footprint API
│   └── invite.js       # Invite codes API
├── middleware.js       # Auth + rate limiting
├── socket.js           # WebSocket server
├── database.js         # SQLite + migrations
├── docs/
│   ├── API.md          # API documentation
│   └── COMPLIANCE.md   # GDPR/PCI DSS docs
└── .env.example        # Environment template
```

### API Endpoints

| Endpoint                             | Method    | Auth   | Rate Limit |
| ------------------------------------ | --------- | ------ | ---------- |
| /health                              | GET       | No     | None       |
| /api/releases                        | GET       | No     | None       |
| /activate                            | POST      | No     | 10/15min   |
| /verify                              | POST      | No     | 60/15min   |
| /invite/validate                     | POST      | No     | None       |
| /api/catalog/items                   | GET       | No     | None       |
| /api/catalog/shops                   | GET       | No     | None       |
| /api/catalog/items                   | POST      | Secret | None       |
| /api/catalog/shops                   | POST      | Secret | None       |
| /api/bin/:bin                        | GET       | Token  | None       |
| /api/bin                             | POST      | Token  | None       |
| /footprint                           | POST      | Token  | 100/min    |
| /footprint/check                     | POST      | Token  | 10/min     |
| /sync/cards                          | GET/POST  | Token  | None       |
| /sync/group/join                     | POST      | Token  | 10/15min   |
| /sync/group/pair                     | POST      | Token  | 20/hour    |
| /admin/api/licenses                  | GET       | Admin  | None       |
| /admin/api/licenses/:id/rotate-token | POST      | Admin  | None       |
| /admin/api/invites                   | POST      | Admin  | None       |
| /ws                                  | WebSocket | Token  | N/A        |

Auth column: **Token** = `Authorization: Bearer <license-token>`; **Admin** =
signed session cookie or HTTP Basic; **Secret** = `X-Server-Secret` header.
Admin routes live under the configurable `ADMIN_PATH` prefix, not `/admin`.

---

## Build Pipeline

### Development

```bash
npm run dev
├── Vite dev server (port 5173)
│   └── Hot Module Replacement
└── Tauri dev
    └── Rust hot reload
```

### Production

```bash
npm run build
├── Vite build
│   ├── Code splitting (vendor, charts, ui)
│   ├── Minification (esbuild)
│   └── Bundle analysis (stats.html)
└── Tauri build
    └── Native binary + installer
```

### Bundle Optimization

| Chunk  | Size (gzip) | Purpose                  |
| ------ | ----------- | ------------------------ |
| vendor | ~150 KB     | React, React-DOM         |
| charts | ~200 KB     | Recharts                 |
| ui     | ~50 KB      | Lucide, TanStack Virtual |
| main   | ~300 KB     | Application code         |

---

## TypeScript Migration Plan

### Phase 1: Core Types (Week 1)

1. Create `src/types/` directory
2. Define base interfaces:
   - `Card`, `Order`, `Profile`, `Email`
   - `ApiResponse<T>`, `StoreState<T>`
3. Add JSDoc comments to existing code

### Phase 2: Utility Migration (Week 2)

1. Convert `src/utils/*.js` → `src/utils/*.ts`
2. Add type definitions for all functions
3. Configure `tsconfig.json`

### Phase 3: Hooks Migration (Week 3)

1. Convert `src/hooks/*.jsx` → `src/hooks/*.tsx`
2. Type all hook parameters and return values
3. Add generic type support

### Phase 4: Component Migration (Week 4-6)

1. Start with smallest components
2. Add prop types
3. Convert to `.tsx` extension
4. Migrate pages last (largest files)

### Phase 5: Store Migration (Week 7)

1. Add generic types to Zustand stores
2. Type all actions
3. Ensure type safety across store boundaries

---

## Performance Considerations

### Virtualization

- `@tanstack/react-virtual` for all large lists
- Cards, Orders, Profiles, Emails all virtualized
- Typical render: 10-20 DOM nodes regardless of data size

### Caching Strategy

| Layer         | Duration   | Invalidation   |
| ------------- | ---------- | -------------- |
| Zustand store | 5 minutes  | Manual refresh |
| React Query   | Not used   | N/A            |
| SQLite        | Persistent | On write       |
| BIN cache     | 24 hours   | TTL-based      |

### Database Optimization

- Connection pooling (r2d2, 8 concurrent)
- WAL mode for concurrent reads
- Composite indexes on frequently queried columns
- Query optimization (JOINs instead of N+1)

---

## Security Checklist

- [x] AES-256-GCM encryption
- [x] PBKDF2 600K iterations
- [x] bcrypt cost factor 14
- [x] ZeroizeOnDrop for sensitive data
- [x] Rate limiting on all sensitive operations
- [x] SQL injection prevention (parameterized queries)
- [x] XSS prevention (escaping, CSP)
- [x] Path traversal prevention (canonicalize)
- [x] Memory safety (password zeroization)
- [x] Audit logging enabled
- [x] Token rotation mechanism
- [x] CORS whitelist (WebSocket)
- [x] Security headers (HSTS, CSP, X-Frame-Options)

---

## Future Improvements

1. **TypeScript Migration** — Full type safety
2. **Component Refactoring** — Split large components (>1000 lines)
3. **E2E Tests** — Expand Playwright test coverage
4. **API Documentation** — OpenAPI/Swagger UI
5. **Bundle Optimization** — Further code splitting
6. **Performance Monitoring** — React Profiler integration
7. **Accessibility** — WCAG 2.1 AA compliance
8. **Offline Support** — Enhanced offline-first architecture

---

## Contact

For architecture questions: dev@ccmanager.local
