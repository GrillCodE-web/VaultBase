# CC Manager

A secure desktop CRM application for managing credit card operations with advanced encryption, IMAP integration, and real-time synchronization capabilities.

## Overview

CC Manager is a cross-platform desktop application built with Tauri 2 that provides a comprehensive solution for credit card lifecycle management. It features end-to-end encryption, automated email parsing, risk assessment, and multi-device synchronization.

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
- **Tauri 2** - Desktop framework (156 commands)
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

### Security

- Master password protection
- AES-256-GCM encryption for sensitive data
- Secure key derivation with PBKDF2
- Encrypted database storage
- License validation system

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
cc-manager/
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
│   │   ├── main.rs          # Entry point (156 Tauri commands)
│   │   ├── database.rs      # SQLite operations (15+ tables)
│   │   ├── encryption.rs    # Crypto operations
│   │   ├── imap.rs          # Email monitoring
│   │   ├── smtp.rs          # Email sending
│   │   ├── parser.rs        # Email parsing
│   │   ├── sync.rs          # HTTP sync client
│   │   ├── ws_sync.rs       # WebSocket sync
│   │   ├── models.rs        # Data models
│   │   └── license.rs       # License validation
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
cd cc-manager

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
- **Communication**: Tauri IPC bridge with 156 commands

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

1. Master password unlocks the application
2. Derived key encrypts sensitive data (AES-256-GCM)
3. Database stores encrypted blobs
4. Keys never leave memory unencrypted
5. Automatic lock on inactivity

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

CC Manager underwent a comprehensive security audit in March 2026. **All 119 vulnerabilities have been fixed.**

**Security Status:**

- **Rating:** 10/10 (improved from 3/10)
- **Fixed:** 119 of 119 vulnerabilities (100%) ✅
- **Critical:** 34/34 fixed (100%) ✅
- **High:** 30/30 fixed (100%) ✅
- **Medium:** 36/36 fixed (100%) ✅
- **Low:** 19/19 fixed (100%) ✅

See [SECURITY_AUDIT_FIXES.md](SECURITY_AUDIT_FIXES.md) for detailed information.
See [SECURITY_AUDIT_COMPLETE.md](SECURITY_AUDIT_COMPLETE.md) for completion summary.

**Documentation:**

- [API Documentation](cc-sync-server/docs/API.md) — OpenAPI-style API reference
- [Compliance](docs/COMPLIANCE.md) — GDPR and PCI DSS compliance
- [Architecture](docs/ARCHITECTURE.md) — System architecture overview
- [TypeScript Migration](docs/TYPESCRIPT_MIGRATION.md) — Step-by-step migration guide
- [Component Refactoring](docs/COMPONENT_REFACTOR.md) — Large component splitting guide

### Security Features

- **Encryption:** AES-256-GCM for sensitive data
- **Password Hashing:** bcrypt with cost factor 14
- **Key Derivation:** PBKDF2 with 600,000 iterations
- **Rate Limiting:** Token bucket algorithm for sensitive operations
- **Connection Pooling:** r2d2 with 4 concurrent connections
- **Memory Safety:** zeroize for secure memory cleanup
- **HMAC:** SHA-256 with secret key (no weak fallbacks)

## License

Proprietary - All rights reserved

---

**Version:** 2.2.0
**Built with:** Tauri 2 + React 18 + Rust
**Security Rating:** 10/10 ✅
**Security Audit:** 119/119 vulnerabilities fixed (100%)
