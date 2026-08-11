# VaultBase — Developer Guide

> Russian version: [AGENTS.ru.md](AGENTS.ru.md).

## Project Structure

```
manager-work/
├── src/                          # React frontend (Vite)
│   ├── pages/                    # Page components
│   │   ├── DashboardRedesigned.jsx # Main dashboard
│   │   ├── Cards.jsx             # Card management
│   │   ├── Orders.jsx            # Order tracking
│   │   ├── Profiles.jsx          # Profile management
│   │   ├── Shops.jsx             # Shop catalog
│   │   ├── Proxies.jsx           # Proxy management
│   │   ├── Couriers.jsx          # Couriers / Packages (Stuffer)
│   │   ├── Imap.jsx              # Email accounts
│   │   ├── Updates.jsx           # System updates
│   │   ├── Settings.jsx          # Settings + audit log
│   │   ├── MyStats.jsx           # Operator self-stats
│   │   ├── UsersPage.jsx         # Admin user management
│   │   └── UserLogin.jsx         # User authentication
│   ├── components/               # Reusable components
│   ├── hooks/                    # Custom hooks
│   │   ├── useAuth.jsx           # Authentication context
│   │   ├── useIdleTimer.js       # Session timeout
│   │   ├── useLang.jsx           # i18n
│   │   ├── useSmartToast.jsx     # Toast notifications
│   │   └── useConfirm.jsx        # Confirmation dialogs
│   ├── styles/                   # CSS (design system) — 7 files, all consolidated
│   │   ├── index.css             # Entry point: @imports all 5 layers below
│   │   ├── tokens.css            # Design tokens (CSS vars: colors, spacing, shadows)
│   │   ├── base.css              # Reset + body + typography base (@layer app)
│   │   ├── layout.css            # Sidebar, topbar, content layout (@layer app)
│   │   ├── components.css        # Buttons, cards, badges, utility classes (@layer app)
│   │   ├── pages.css             # Page-specific styles: dashboard, cards, etc. (@layer app)
│   │   └── fonts.css             # @font-face definitions for Geist/GeistMono
│   ├── App.jsx                   # Main app component
│   ├── main.jsx                  # Entry point (imports src/index.css)
│   ├── float.jsx                 # Float window entry (imports src/index.css)
│   └── index.css                 # Re-exports styles/index.css (one-liner @import)
│
│   ⚠️  CSS IMPORTANT — READ BEFORE EDITING STYLES:
│   The OLD file names (tokens-redesign.css, layout/sidebar-redesign.css,
│   utilities-redesign.css, content-redesign.css, etc.) NO LONGER EXIST.
│   They were consolidated in v2.8.0. Editing those paths does nothing.
│   Always edit files inside src/styles/ — the 7 files listed above.
│   Import chain: main.jsx → src/index.css → src/styles/index.css → 5 files.
│
├── src-tauri/                    # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs               # Tauri commands + AppState
│   │   ├── models.rs             # Data models + permissions
│   │   ├── database/             # Database layer (11 submodules)
│   │   │   ├── mod.rs            # Database struct + impl wrapper
│   │   │   ├── _core.rs          # Core methods (open, pool, encryption)
│   │   │   ├── _cards.rs         # Card operations
│   │   │   ├── _analytics.rs     # Dashboard stats
│   │   │   ├── _imap.rs          # Email accounts
│   │   │   ├── _profiles.rs      # Profiles + drops
│   │   │   ├── _shops.rs         # Shops + catalog
│   │   │   ├── _orders.rs        # Orders
│   │   │   ├── _misc.rs          # Misc operations
│   │   │   ├── _users.rs         # User auth + permissions + auto-login
│   │   │   ├── _helpers.rs       # Helper functions
│   │   │   └── _migrations.rs    # Database migrations
│   │   ├── encryption.rs         # Field encryption
│   │   ├── imap.rs               # IMAP client
│   │   ├── smtp.rs               # SMTP client
│   │   ├── parser.rs             # Card parsing
│   │   ├── sync.rs               # WebSocket sync
│   │   ├── ws_sync.rs            # WS pool
│   │   ├── tracking.rs           # Order tracking
│   │   ├── rate_limiter.rs       # Rate limiting
│   │   ├── license.rs            # License validation
│   │   └── Cargo.toml
│   ├── tauri.conf.json           # Tauri config
│   └── icons/                    # App icons
│
├── package.json                  # Node dependencies
├── vite.config.js                # Vite config
└── AGENTS.md                     # This file
```

## Setup & Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Tauri CLI: `npm install -g @tauri-apps/cli`

### Installation

```bash
cd manager-work
npm install
```

### Development

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Tauri dev app
npm run tauri dev
```

### Build

```bash
# Build for production
npm run build
npm run tauri build
```

## Architecture

### Frontend (React 18 + Vite)

- **State Management:** React Context (useAuth, useLang, useSmartToast, useConfirm)
- **Styling:** CSS variables + Tailwind utilities
- **Design System:** src/styles/tokens.css (CSS vars: colors, spacing, shadows, typography)
- **Components:** Lazy-loaded pages, reusable UI components
- **Async:** Tauri invoke() for backend calls, Promise-based error handling

### Backend (Rust + Tauri v2)

- **Database:** SQLite with r2d2 connection pooling
- **Encryption:** AES-256-GCM for sensitive fields (card numbers, passwords)
- **Authentication:** bcrypt password hashing, JWT-like session tokens
- **Permissions:** Role-based (admin, operator) with granular permission checks
- **Sync:** WebSocket for real-time updates across clients
- **Email:** IMAP/SMTP for email account integration

## Key Features

### User Management

- **Roles:** admin (full access), operator (limited access) — assigned by the **license**
- **Login flow:** license activation → master password → solo-mode auto-login
- **Permissions:** Granular permission system (view_own_cards_full, take_cards, transfer_cards, etc.)
- **Sessions:** Token-based with expiration, auto-cleanup of expired sessions
- **Activity Log:** All user actions logged with timestamp and details
- **Session Timeout:** 30-minute idle timeout with auto-logout

### Card Management

- **Encryption:** Card numbers encrypted at rest (AES-256-GCM)
- **BIN Lookup:** Automatic bank info enrichment via iinapi.com
- **Card Isolation:** Operators can only see/manage their own cards
- **Card Status:** free, in_use, dead, archived
- **Card Timeline:** Full history of card usage across shops

### Order Tracking

- **Order Status:** pending, processing, shipped, delivered, failed, cancelled
- **Tracking:** Direct carrier APIs (UPS/FedEx/USPS) with 17track.net fallback for unknown carriers
- **Email Footprint:** Track which email was used for each order
- **Risk Assessment:** Automatic risk scoring based on shop, card, profile

### Admin Dashboard

- **Live Notifications:** Toast alerts when operators take cards or create orders
- **User Stats:** Overview of all users, their activity, card assignments
- **Audit Log:** Searchable log of all system events
- **Online Sessions:** View and revoke active user sessions

### Operator Dashboard

- **My Stats:** Personal statistics (cards taken, orders created, conversion rate)
- **My Cards:** List of cards assigned to current operator
- **Activity Log:** Personal activity history
- **Change Password:** Self-service password change

## Development Workflow

### Adding a New Tauri Command

1. **Define the command in `main.rs`:**

```rust
#[tauri::command]
fn my_new_command(param: String) -> Result<String, String> {
    // Implementation
    Ok("result".to_string())
}
```

2. **Register in `invoke_handler`:**

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    my_new_command,
])
```

3. **Call from React:**

```javascript
const result = await invoke('my_new_command', { param: 'value' })
```

### Adding a New Database Method

1. **Add to appropriate submodule in `src-tauri/src/database/`:**

```rust
// In _cards.rs (for example)
impl Database {
    pub fn my_new_method(&self, id: i64) -> Result<MyType, String> {
        // Implementation
    }
}
```

2. **Call from Tauri command:**

```rust
#[tauri::command]
fn my_command(id: i64) -> Result<MyType, String> {
    with_db!(db, { db.my_new_method(id) })
}
```

### Adding a New React Page

1. **Create component in `src/pages/MyPage.jsx`:**

```javascript
export default function MyPage({ onNavigate, activeTab }) {
  return <div>My Page</div>
}
```

2. **Add to `PAGE_MAP` in `App.jsx`:**

```javascript
const PAGE_MAP = {
  // ... existing pages ...
  my_page: lazy(() => import('./pages/MyPage')),
}
```

3. **Add to `NAV_DEFS` in `App.jsx`:**

```javascript
const NAV_DEFS = [
  // ... existing items ...
  { key: 'my_page', icon: MyIcon, page: 'my_page', label: 'My Page' },
]
```

## Permissions System

### Permission Flags (in `models.rs`)

```rust
pub mod perms {
    pub const VIEW_OWN_CARDS_FULL: &str = "view_own_cards_full";
    pub const TAKE_CARDS: &str = "take_cards";
    pub const TRANSFER_CARDS: &str = "transfer_cards";
    pub const CREATE_ORDERS: &str = "create_orders";
    pub const VIEW_AUDIT_LOG: &str = "view_audit_log";
    // ... more permissions
}
```

### Checking Permissions in Rust

```rust
#[tauri::command]
fn my_protected_command() -> Result<(), String> {
    let user = require_perm(models::perms::MY_PERMISSION)?;
    // User has permission, proceed
    Ok(())
}
```

### Checking Permissions in React

```javascript
const { hasPerm, isAdmin } = useAuth()

if (hasPerm('take_cards')) {
  // Show button
}
```

## Error Handling

### Frontend

- **useSmartToast:** Centralized toast notifications
- **try-catch:** All async operations wrapped
- **Fallback UI:** Empty states, error boundaries
- **User Feedback:** Clear error messages in Russian
- **401 Handling:** Auto-logout and redirect to login on session expiration

### Backend

- **Result<T, String>:** All operations return Result
- **Custom Errors:** Specific error messages for different scenarios
- **Logging:** All errors logged to activity log
- **Graceful Degradation:** Operations fail safely without data corruption

## Testing

### Manual Testing Checklist

- [ ] User login/logout works
- [ ] Session timeout triggers after 30 minutes of inactivity
- [ ] Admin can view all users and their stats
- [ ] Operator can only see their own cards
- [ ] Card encryption/decryption works
- [ ] Order creation and tracking works
- [ ] Email sync works
- [ ] WebSocket sync works
- [ ] Audit log records all actions
- [ ] Permissions are enforced correctly

### First run / access

- On first run a single `admin` user is created with a **random 32-byte password that is
  never stored** (no log, no file). In solo mode the app auto-logs-in after the master
  password is entered, so no username/password is needed.
- The role (`admin`/`operator`) comes from the activated license (config `license_role`),
  refreshed on every license verify.
- See [docs/AUTH_AND_ROLES.md](docs/AUTH_AND_ROLES.md).

## Performance Tips

1. **Database:** Use connection pooling (r2d2) for concurrent requests
2. **Frontend:** Lazy-load pages, use React.memo for expensive components
3. **Encryption:** Cache decrypted values in memory (with caution)
4. **Sync:** Use WebSocket for real-time updates instead of polling
5. **CSS:** Use CSS variables for theming, avoid inline styles

## Security Considerations

1. **Passwords:** Always hash with bcrypt (cost 14)
2. **Encryption:** Use AES-256-GCM for sensitive data
3. **Sessions:** Validate token on every request
4. **Permissions:** Check permissions on both frontend and backend
5. **Logging:** Log all sensitive operations (but not passwords/keys)
6. **HTTPS:** Always use HTTPS in production
7. **CORS:** Restrict API access to trusted origins

## Troubleshooting

### "database_locked" error

- Check if another instance is running
- Restart the app

### "permission_denied" error

- Check user role and permissions
- Verify token is valid

### "card_not_found" error

- Card may have been deleted
- Check card ID is correct

### WebSocket connection fails

- Check network connectivity
- Verify sync server is running
- Check firewall rules

## Contributing

1. Follow existing code style
2. Add comments for complex logic
3. Test changes locally before committing
4. Update AGENTS.md if adding new features
5. Keep commits atomic and descriptive

## Resources

- [Tauri Docs](https://tauri.app/docs/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [React Docs](https://react.dev/)
- [SQLite Docs](https://www.sqlite.org/docs.html)
- [Tailwind CSS](https://tailwindcss.com/)

---

**Last Updated:** August 9, 2026  
**Version:** 2.11.1
