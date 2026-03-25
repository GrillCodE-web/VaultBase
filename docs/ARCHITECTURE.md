# CC Manager — Architecture Documentation

**Version:** 2.2.0
**Last Updated:** 2026-03-25

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CC Manager Desktop                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   React 18  │  │   Tauri 2   │  │      Rust Backend       │  │
│  │   Frontend  │◄─┤    IPC      │◄─┤  ┌───────────────────┐  │  │
│  │  (15 pages) │  │   Bridge    │  │  │   SQLite (rusqlite)│  │  │
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
│   ├── Cards.jsx       # Cards management (962 lines)
│   ├── Orders.jsx      # Orders management (1704 lines)
│   ├── Profiles.jsx    # Profiles management (1578 lines)
│   ├── Imap.jsx        # Email integration (2063 lines)
│   ├── Dashboard.jsx   # Analytics dashboard
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
│   ├── Dashboard
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
├── main.rs           # Entry point + Tauri commands (156 commands)
├── database.rs       # SQLite operations (4100+ lines)
├── encryption.rs     # Crypto operations (AES-256-GCM, PBKDF2)
├── license.rs        # License validation + challenge-response
├── sync.rs           # HTTP sync client
├── ws_sync.rs        # WebSocket real-time sync
├── imap.rs           # Email monitoring + parsing
├── smtp.rs           # Email sending (lettre)
├── parser.rs         # Email parser (card detection)
├── models.rs         # Data structures
└── rate_limiter.rs   # Rate limiting (token bucket)
```

### Database Schema (15+ tables)

```sql
-- Core tables
cards              -- Card records (encrypted fields)
card_meta          -- Card metadata (BIN, country, bank)
transactions       -- Transaction history
emails             -- Parsed email data
email_accounts     -- IMAP account configs (encrypted)
smtp_accounts      -- SMTP account configs (encrypted)

-- Organization
profiles           -- Customer profiles
orders             -- Order records
shops              -- Shop/merchant data
proxies            -- Proxy configurations

-- System
config             -- App settings (key-value)
sync_log           -- Sync tracking
audit_log          -- Security audit trail
sessions           -- Active sessions
invite_codes       -- Invite code management
```

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
│  - Connection pooling (r2d2, 4 conn)    │
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

| Endpoint                             | Method    | Auth  | Rate Limit |
| ------------------------------------ | --------- | ----- | ---------- |
| /api/health                          | GET       | No    | None       |
| /api/catalog/items                   | GET       | Yes   | 100/min    |
| /api/catalog/shops                   | GET       | Yes   | 100/min    |
| /api/bin/:bin                        | GET       | Yes   | 30/min     |
| /api/bin                             | POST      | Yes   | 30/min     |
| /api/footprint/check                 | POST      | Yes   | 50/min     |
| /api/footprint                       | POST      | Yes   | 50/min     |
| /api/invite/generate                 | POST      | Yes   | 20/min     |
| /api/invite/validate                 | POST      | Yes   | 20/min     |
| /admin/api/licenses                  | GET       | Basic | 20/min     |
| /admin/api/licenses/:id/rotate-token | POST      | Basic | 20/min     |
| /ws                                  | WebSocket | Token | N/A        |

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

- Connection pooling (r2d2, 4 concurrent)
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
