# VaultBase

> Русская версия этого файла: [README.ru.md](README.ru.md).

A secure desktop CRM application for managing credit card operations with advanced encryption, IMAP integration, and real-time synchronization capabilities.

## Overview

VaultBase is a cross-platform desktop application built with Tauri 2 that provides a comprehensive solution for credit card lifecycle management. It features end-to-end encryption, automated email parsing, risk assessment, and multi-device synchronization.

**Key Capabilities:**

- Secure card data management with AES-256-GCM encryption
- Automated IMAP email monitoring and parsing
- Real-time WebSocket synchronization across devices
- Advanced risk scoring and health monitoring
- Bulk operations and CSV import/export
- Multi-language support (i18n ready)

## Tech Stack

### Frontend

- **React 18** - UI framework
- **Vite 7** - Build tool and dev server
- **Tailwind CSS 3** - Utility-first styling
- **Lucide React** - Icon library
- **Recharts** - Data visualization

### Backend

- **Rust** - Core application logic
- **Tauri 2** - Desktop framework (~190 commands)
- **SQLite** - Local database (15+ tables)
- **rusqlite** - Database interface

### Security & Encryption

- **aes-gcm** - AES-256-GCM encryption
- **bcrypt** - Password hashing
- **pbkdf2** - Key derivation

### Communication

- **imap** - Email monitoring
- **lettre** - SMTP client
- **tungstenite** - WebSocket client
- **ureq** - HTTP client

## Features

### Card Management

- Create, edit, and delete card records
- Track card status lifecycle (active, blocked, expired, etc.)
- Attach notes, tags, and custom metadata
- Health scoring based on usage patterns
- Bulk operations support

### Email Integration

- IMAP connection to multiple providers (Gmail, Outlook, Yahoo, etc.)
- Automatic email parsing for card notifications
- Transaction detection and categorization
- Email-to-card linking

### Security & Access

- License validation (challenge/activation key against the sync server)
- Master password protection (unlocks the encrypted database)
- Solo-mode auto-login after unlock — no separate login screen
- License-driven roles: each license carries `admin` or `operator`, applied on the client after activation/verify
- AES-256-GCM encryption for sensitive data
- Secure key derivation with PBKDF2 (600,000 iterations)
- Encrypted database storage
- Auto-lock on inactivity

### Login flow

```
1. Activate license   → challenge code exchanged for activation key (sync server)
2. Master password    → derives the key that decrypts the database
3. Auto-login         → single-user (solo) installs enter straight into the app;
                         the role (admin/operator) comes from the license
```

The temporary admin password generated on first run is **never written to logs or files** —
access is protected by the master password, so no password prompt is needed in solo mode.

### Synchronization

- WebSocket-based real-time sync
- Conflict resolution
- Multi-device support
- Offline-first architecture

### Analytics & Reporting

- Risk assessment dashboard
- Card health monitoring
- Transaction analytics
- Export to CSV/Excel

## Project Structure

```
vaultbase/
├── src/                      # Frontend source
│   ├── components/          # React components (5 core components)
│   ├── pages/               # Page-level components
│   ├── hooks/               # Custom React hooks
│   ├── utils/               # Utility functions
│   │   ├── cardHealth.js    # Health scoring logic
│   │   ├── clipboard.js     # Clipboard operations
│   │   ├── csv.js           # CSV parsing/export
│   │   ├── formatting.js    # Date, currency, text formatting
│   │   ├── pagination.js    # Pagination helpers
│   │   └── validation.js    # Input validation
│   ├── constants/           # Application constants
│   │   ├── cardTypes.js     # Card type definitions
│   │   ├── colors.js        # Color palette & themes
│   │   ├── emailProviders.js # IMAP provider configs
│   │   └── status.js        # Status definitions
│   ├── i18n/                # Internationalization
│   └── styles/              # CSS modules
│       ├── components/      # Component styles
│       ├── layout/          # Layout styles
│       └── pages/           # Page styles
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── main.rs          # Entry point (~190 Tauri commands)
│   │   ├── database/        # SQLite operations, split by domain
│   │   │   ├── _core.rs      # Connection, config, migrations glue
│   │   │   ├── _cards.rs     # Cards
│   │   │   ├── _orders.rs    # Orders + tracking
│   │   │   ├── _profiles.rs  # Profiles + drops (delivery addresses)
│   │   │   ├── _shops.rs     # Shops / catalog stats
│   │   │   ├── _imap.rs      # IMAP accounts + parsed mail
│   │   │   ├── _users.rs     # Users, sessions, roles, auto-login
│   │   │   ├── _analytics.rs # Dashboard / risk stats
│   │   │   └── _migrations.rs# Schema migrations
│   │   ├── encryption.rs    # Crypto operations
│   │   ├── imap.rs          # Email monitoring
│   │   ├── smtp.rs          # Email sending
│   │   ├── parser.rs        # Email parsing
│   │   ├── sync.rs          # HTTP sync client
│   │   ├── ws_sync.rs       # WebSocket sync
│   │   ├── tracking.rs      # Carrier tracking (UPS/FedEx/USPS)
│   │   ├── rate_limiter.rs  # Token-bucket rate limiting
│   │   ├── models.rs        # Data models
│   │   └── license.rs       # License validation + role
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── public/                  # Static assets
├── dist/                    # Build output
└── package.json             # Node dependencies
```

## Development Setup

### Prerequisites

- **Node.js** 18+ and npm
- **Rust** 1.70+ (install via [rustup](https://rustup.rs/))
- **System dependencies** (varies by OS)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd vaultbase

# Install frontend dependencies
npm install

# Install Rust dependencies (automatic on first build)
```

### Running Development Server

```bash
# Start Vite dev server + Tauri app
npm run dev

# Frontend only (for UI development)
npm run dev -- --no-tauri
```

The app will open automatically. Hot reload is enabled for both frontend and backend changes.

### Building for Production

```bash
# Build optimized bundle
npm run build

# Build Tauri app (creates installer)
npm run tauri build
```

Installers will be in `src-tauri/target/release/bundle/`.

**Build Optimization:**

The build process includes:

- **Code Splitting:** Separate chunks for vendor, charts, UI components, and large pages
- **Lazy Loading:** Page components loaded on-demand
- **Minification:** esbuild minification for production
- **Gzip Compression:** Optimized for distribution
- **Bundle Analysis:** `dist/stats.html` shows detailed bundle breakdown

**Bundle Size:**

- Main chunk: ~49 KB (gzip: 15 KB)
- Vendor chunk: ~1.1 MB (gzip: 356 KB)
- Total JS: ~2.1 MB (gzip: ~600 KB)
- CSS: ~269 KB (gzip: 43 KB)

## Code Quality Tools

### ESLint

Configured with React, Prettier, and accessibility rules.

```bash
# Lint all files
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Prettier

Enforces consistent code formatting.

```bash
# Format all files
npm run format

# Check formatting
npm run format:check
```

### Husky + lint-staged

Pre-commit hooks automatically lint and format staged files.

```bash
# Manually run pre-commit checks
npx lint-staged
```

Configuration in `package.json`:

```json
"lint-staged": {
  "*.{js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{css,md,json}": ["prettier --write"]
}
```

## Utility Functions

### Formatting (`src/utils/formatting.js`)

```javascript
import { formatDate, formatCurrency, formatCardNumber } from './utils/formatting'

formatDate('2024-03-22') // "22.03.2024"
formatCurrency(1234.56, 'USD') // "$1,234.56"
formatCardNumber('4111111111111111') // "4111 1111 1111 1111"
```

### Validation (`src/utils/validation.js`)

```javascript
import { validateEmail, validateCardNumber, validateCVV } from './utils/validation'

validateEmail('user@example.com') // true
validateCardNumber('4111111111111111') // true (Luhn check)
validateCVV('123') // true
```

### Card Health (`src/utils/cardHealth.js`)

```javascript
import { calculateCardHealth } from './utils/cardHealth'

const health = calculateCardHealth(card)
// Returns: { score: 85, status: 'good', factors: [...] }
```

### Pagination (`src/utils/pagination.js`)

```javascript
import { paginate, getPaginationInfo } from './utils/pagination'

const page = paginate(items, 1, 20) // page 1, 20 items per page
const info = getPaginationInfo(items.length, 1, 20)
```

### Clipboard (`src/utils/clipboard.js`)

```javascript
import { copyToClipboard } from './utils/clipboard'

await copyToClipboard('text to copy')
```

### CSV (`src/utils/csv.js`)

```javascript
import { parseCSV, generateCSV } from './utils/csv'

const data = parseCSV(csvString)
const csv = generateCSV(data)
```

## Constants

### Card Types (`src/constants/cardTypes.js`)

Defines supported card types (Visa, Mastercard, Amex, etc.) with validation patterns.

### Colors (`src/constants/colors.js`)

Centralized color palette and theme definitions for consistent UI.

### Email Providers (`src/constants/emailProviders.js`)

Pre-configured IMAP settings for major email providers (Gmail, Outlook, Yahoo, etc.).

### Status (`src/constants/status.js`)

Card status definitions with colors and labels (active, blocked, expired, etc.).

## Scripts

| Command                   | Description                              |
| ------------------------- | ---------------------------------------- |
| `npm run dev`             | Start development server with hot reload |
| `npm run build`           | Build optimized production bundle        |
| `npm run preview`         | Preview production build locally         |
| `npm run tauri`           | Run Tauri CLI commands                   |
| `npm run lint`            | Lint JavaScript/JSX files                |
| `npm run lint:fix`        | Auto-fix linting issues                  |
| `npm run format`          | Format all source files                  |
| `npm run format:check`    | Check if files are formatted             |
| `npm run test:e2e`        | Run E2E tests with Playwright            |
| `npm run test:e2e:ui`     | Run E2E tests with UI                    |
| `npm run test:e2e:report` | Show E2E test report                     |

## Architecture

### Frontend/Backend Separation

- **Frontend (React)**: UI rendering, user interactions, state management
- **Backend (Rust)**: Business logic, database operations, encryption, network I/O
- **Communication**: Tauri IPC bridge with ~190 commands

### Data Flow

```
User Action → React Component → Tauri Command → Rust Handler → SQLite
                                      ↓
                                 Encryption Layer
                                      ↓
                                 Network Sync (optional)
```

### Database Schema

15+ tables including:

- `cards` - Card records
- `transactions` - Transaction history
- `emails` - Parsed email data
- `notes` - Card notes
- `tags` - Tagging system
- `sync_log` - Synchronization tracking
- `settings` - Application settings
- And more...

### Security Model

1. License activation gates access and assigns the role (admin/operator)
2. Master password unlocks the application
3. Derived key (PBKDF2, 600k iterations) encrypts sensitive data (AES-256-GCM)
4. Database stores encrypted blobs
5. Keys never leave memory unencrypted (zeroized on lock)
6. Automatic lock on inactivity

See [docs/AUTH_AND_ROLES.md](docs/AUTH_AND_ROLES.md) for the full auth/roles design.

## Contributing

### Code Style

- Follow ESLint and Prettier configurations
- Use functional components with hooks
- Keep components small and focused
- Extract reusable logic to utils/
- Define constants in constants/

### Commit Conventions

```
feat: Add new feature
fix: Bug fix
refactor: Code refactoring
style: Formatting changes
docs: Documentation updates
test: Add or update tests
chore: Maintenance tasks
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commits
3. Ensure all tests pass and code is formatted
4. Submit PR with description of changes
5. Address review feedback

### Testing

```bash
# Run linters
npm run lint

# Check formatting
npm run format:check

# Build to verify no errors
npm run build
```

## Security

### Security Audit

VaultBase underwent a security audit in March 2026, followed by further audits in
August 2026. Substantial hardening has been done, but the project is **not** in a
"zero known issues" state — see below.

**Status:**

- Extensive remediation completed across the Rust backend, React frontend and
  sync server. Details: [SECURITY_AUDIT_FIXES.md](SECURITY_AUDIT_FIXES.md),
  [SECURITY_AUDIT_COMPLETE.md](SECURITY_AUDIT_COMPLETE.md).
- Findings from the August 2026 round, including a cross-user card-data exposure
  and a password-hash migration that had never executed, are recorded in
  [docs/AUDIT_2026-08-07.md](docs/AUDIT_2026-08-07.md).
- **Open items requiring action** are listed in that same document — most
  urgently, credential rotation on the live server.

> **A note on the "119/119 vulnerabilities fixed (100%)" figure** that previously
> appeared here and in several other documents: it does not reconcile with its own
> sources and should not be relied on. [AUDIT_REPORT.md](AUDIT_REPORT.md) totals
> 261+ findings (26 critical / 88 high / 126+ medium / 21 low), which matches
> neither the total nor the 34/30/36/19 breakdown; and
> `SECURITY_AUDIT_COMPLETE.md` contradicts itself, closing with "119 analysed, 86
> fixed (72%)". The August 2026 audit then confirmed that at least one item marked
> fixed — the bcrypt cost-factor migration — had never run once, because of a
> string-slice bug that silently swallowed the parse failure. Treat security
> posture as an ongoing process, not a completed score.

**Documentation:**

- [CHECKLIST.md](CHECKLIST.md) — Full feature/status checklist (done / in progress / planned)
- [ROADMAP.md](ROADMAP.md) — Planned work (extended Proxies, automation, UI redesign)
- [docs/COURIERS_STUFFER.md](docs/COURIERS_STUFFER.md) — Couriers / Packages (Stuffer) integration
- [Auth & Roles](docs/AUTH_AND_ROLES.md) — Login flow, master key, license roles
- [API Documentation](cc-sync-server/docs/API.md) — Sync-server API reference
- [Architecture](docs/ARCHITECTURE.md) — System architecture overview
- [Compliance](docs/COMPLIANCE.md) — GDPR and PCI DSS compliance

### Security Features

- **Encryption:** AES-256-GCM for sensitive data
- **Password Hashing:** bcrypt with cost factor 14 (master password and all user
  accounts; user accounts used cost 12 until August 2026)
- **Key Derivation:** PBKDF2 with 600,000 iterations
- **Rate Limiting:** Token bucket algorithm for sensitive operations
- **Connection Pooling:** r2d2 with 8 concurrent connections
- **Memory Safety:** zeroize for secure memory cleanup
- **HMAC:** SHA-256 with secret key (no weak fallbacks)
- **Permissions:** 15 enforced granular permissions on top of admin/operator
  roles — see [docs/PERMISSIONS.md](docs/PERMISSIONS.md)

## License

Proprietary - All rights reserved

---

**Version:** 2.5.0
**Built with:** Tauri 2 + React 18 + Rust
**Security:** see [docs/AUDIT_2026-08-07.md](docs/AUDIT_2026-08-07.md) for current status and open items
