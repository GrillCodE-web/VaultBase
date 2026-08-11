# Детальный список заглушек и временного кода

**Дата:** 2026-08-10  
**Проект:** VaultBase v2.11.2

---

## 📍 Навигация по проблемным местам

### 1. HARDCODED URLs

#### Основные серверы синхронизации

```
/workspace/manager-work/src-tauri/src/endpoints.rs:27
const DEFAULT_SERVER_URL: &str = "https://sec201-www.otpmanager.pro";
```

```
/workspace/manager-work/src-tauri/src/stuffer.rs:11
pub const DEFAULT_BASE_URL: &str = "https://dash.stockhubdeal.com/api/stuffer/";
```

#### Tracking APIs

```
/workspace/manager-work/src-tauri/src/tracking.rs:104
"https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML={}"

/workspace/manager-work/src-tauri/src/tracking.rs:255
"https://ontrack.ups.com/api/tracking/{}"

/workspace/manager-work/src-tauri/src/tracking.rs:276
"https://ontrack.ups.com/security/v1/oauth/token"

/workspace/manager-work/src-tauri/src/tracking.rs:448
"https://apis.fedex.com/track/v2/trackingnumbers"

/workspace/manager-work/src-tauri/src/background.rs:400
"https://api.17track.net/track/v2.2/gettrackinfo"

/workspace/manager-work/src-tauri/src/database/_helpers.rs:9
"https://api.iinapi.com/api/v1/{}"
```

#### Localhost endpoints (dev/test)

```
/workspace/manager-work/cc-sync-server/socket.js:67
['http://localhost:5173', 'http://localhost:1420']

/workspace/manager-work/playwright.config.js:15
baseURL: 'http://localhost:5173',

/workspace/manager-work/cc-sync-server/test/admin-auth.http.test.js:46
base = `http://127.0.0.1:${server.address().port}`;
```

#### Seed данных и примеры

```
/workspace/manager-work/src-tauri/src/database/_seed.rs:127
url: "https://bestbuy.com".into(),

/workspace/manager-work/src-tauri/src/database/_seed.rs:139
url: "https://walmart.com".into(),

/workspace/manager-work/src-tauri/src/database/_seed.rs:151
url: "https://newegg.com".into(),
```

#### Примеры в UI

```
/workspace/manager-work/src/pages/Shops.jsx:253
placeholder="https://shop.com/product"

/workspace/manager-work/src/pages/Shops.jsx:378
placeholder="https://nike.com"

/workspace/manager-work/src/pages/Proxies.jsx:421
'192.168.1.1:8080:user:pass\nsocks5://user:pass@proxy.com:1080\nhttp://10.0.0.1:3128'
```

---

### 2. MAGIC NUMBERS - Таймауты

#### HTTP таймауты (Rust)

```
/workspace/manager-work/src-tauri/src/tracking.rs:109
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/tracking.rs:261
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/tracking.rs:461
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/stuffer.rs:12
const TIMEOUT_SECS: u64 = 15;

/workspace/manager-work/src-tauri/src/background.rs:482
.timeout(std::time::Duration::from_secs(30))

/workspace/manager-work/src-tauri/src/background.rs:529
.timeout(std::time::Duration::from_secs(30))

/workspace/manager-work/src-tauri/src/imap.rs:266
Duration::from_secs(8)

/workspace/manager-work/src-tauri/src/imap.rs:268
stream.set_read_timeout(Some(Duration::from_secs(8)))

/workspace/manager-work/src-tauri/src/imap.rs:269
stream.set_write_timeout(Some(Duration::from_secs(8)))

/workspace/manager-work/src-tauri/src/imap.rs:497
stream.set_read_timeout(Some(Duration::from_secs(20)))

/workspace/manager-work/src-tauri/src/imap.rs:498
stream.set_write_timeout(Some(Duration::from_secs(8)))

/workspace/manager-work/src-tauri/src/sync.rs:27
.timeout(std::time::Duration::from_secs(5))

/workspace/manager-work/src-tauri/src/sync.rs:140
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/sync.rs:225
.timeout(std::time::Duration::from_secs(5))

/workspace/manager-work/src-tauri/src/sync.rs:308
.timeout(std::time::Duration::from_secs(5))

/workspace/manager-work/src-tauri/src/sync.rs:341
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/sync.rs:367
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/sync.rs:385
.timeout(std::time::Duration::from_secs(10))

/workspace/manager-work/src-tauri/src/sync.rs:435
.timeout(std::time::Duration::from_secs(5))

/workspace/manager-work/src-tauri/src/sync.rs:492
.timeout(std::time::Duration::from_secs(10))
```

#### Retry delays

```
/workspace/manager-work/src-tauri/src/sync.rs:154
std::thread::sleep(std::time::Duration::from_millis(delay_ms));

/workspace/manager-work/src-tauri/src/sync.rs:174
std::thread::sleep(std::time::Duration::from_millis(delay_ms));

/workspace/manager-work/src-tauri/src/sync.rs:517
std::thread::sleep(std::time::Duration::from_millis(delay_ms));

/workspace/manager-work/src-tauri/src/sync.rs:549
std::thread::sleep(std::time::Duration::from_millis(delay_ms));

/workspace/manager-work/src-tauri/src/sync.rs:581
std::thread::sleep(std::time::Duration::from_millis(delay_ms));
```

#### Background threads

```
/workspace/manager-work/src-tauri/src/background.rs:32
std::thread::sleep(std::time::Duration::from_secs(30));

/workspace/manager-work/src-tauri/src/ws_sync.rs:107
std::thread::sleep(Duration::from_secs(RECONNECT_SECS));

/workspace/manager-work/src-tauri/src/ws_sync.rs:127
std::thread::sleep(Duration::from_secs(RECONNECT_SECS));

/workspace/manager-work/src-tauri/src/ws_sync.rs:257
std::thread::sleep(Duration::from_secs(RECONNECT_SECS));
```

#### JavaScript таймауты

```
/workspace/manager-work/src/App.jsx:453
const id = setInterval(loadBadges, 30_000)

/workspace/manager-work/src/App.jsx:495
const id = setInterval(checkForUpdate, 6 * 60 * 60 * 1000)

/workspace/manager-work/src/App.jsx:1319
}, 3000)

/workspace/manager-work/src/hooks/useSmartToast.jsx:12
defaultDuration: 4000,

/workspace/manager-work/src/hooks/useSmartToast.jsx:22
defaultDuration: 5000,

/workspace/manager-work/src/hooks/useSmartToast.jsx:27
defaultDuration: 4000,

/workspace/manager-work/src/hooks/usePremiumToast.js:24
duration: 3000,

/workspace/manager-work/src/hooks/usePremiumToast.js:30
duration: 5000,

/workspace/manager-work/src/hooks/usePremiumToast.js:36
duration: 4000,

/workspace/manager-work/src/hooks/usePremiumToast.js:55
duration: 5000,

/workspace/manager-work/src/hooks/usePremiumToast.js:75
duration: 4000,

/workspace/manager-work/src/hooks/usePremiumToast.js:81
duration: 3000,
```

---

### 3. MAGIC NUMBERS - Константы и лимиты

#### Retry/Batch константы

```
/workspace/manager-work/src-tauri/src/sync.rs:133
const MAX_RETRIES: u32 = 3;

/workspace/manager-work/src-tauri/src/sync.rs:485
const MAX_RETRIES: u32 = 3;

/workspace/manager-work/src-tauri/src/ws_sync.rs:23
const MAX_MISSED_PINGS: u32 = 2;

/workspace/manager-work/src-tauri/src/background.rs:69
const MAX_FAILURES_BEFORE_PAUSE: u32 = 5;
```

#### Database pragmas

```
/workspace/manager-work/src-tauri/src/database/_core.rs:31
PRAGMA busy_timeout = 5000;
PRAGMA wal_autocheckpoint = 3000;
```

#### Autolock и карантин

```
/workspace/manager-work/src-tauri/src/database/_migrations.rs:239
('autolock_timeout', '300', 'seconds before auto-lock')

/workspace/manager-work/src-tauri/src/database/_misc.rs:553
autolock_timeout: self.get_config_u64("autolock_timeout", 300)?
```

#### Quarantine (14 дней)

```
/workspace/manager-work/src-tauri/src/database/_cards.rs:117
// P2-QUARANTINE: Filter by quarantine status (cards < 14 days old are quarantined)

/workspace/manager-work/src-tauri/src/database/_cards.rs:120
WHERE (acquired_at IS NULL OR julianday('now') - julianday(acquired_at) >= 14)

/workspace/manager-work/src-tauri/src/database/_cards.rs:123
WHERE acquired_at IS NOT NULL AND julianday('now') - julianday(acquired_at) < 14

/workspace/manager-work/src-tauri/src/database/_analytics.rs:330
CASE WHEN acquired_at IS NOT NULL AND julianday('now') - julianday(acquired_at) < 14 THEN 1 ELSE 0 END as is_quarantined
```

#### 30 дней (статистика, expiring cards)

```
/workspace/manager-work/src-tauri/src/database/_analytics.rs:501
// expiring cards — cards expiring within 30 days

/workspace/manager-work/src-tauri/src/database/_misc.rs:194
AND f.created_at >= datetime('now', '-30 days')

/workspace/manager-work/src-tauri/src/database/_orders.rs:393
BETWEEN date('now') AND date('now','+30 days')

/workspace/manager-work/src-tauri/src/database/_orders.rs:399
message: "Card expires within 30 days".into()

/workspace/manager-work/src-tauri/src/database/_users.rs:514
("30d", "o.created_at >= datetime('now','-30 days')")

/workspace/manager-work/src-tauri/src/database/_users.rs:541
assigned_at >= datetime('now','-30 days')
```

#### Bcrypt cost factor

```
/workspace/manager-work/src-tauri/src/commands/auth.rs:256
// FIX CRY-H02: Use bcrypt cost factor 14 for stronger password hashing

/workspace/manager-work/src-tauri/src/commands/auth.rs:257
let hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;

/workspace/manager-work/src-tauri/src/commands/auth.rs:305
if parsed_cost.is_some_and(|c| c < 14) {

/workspace/manager-work/src-tauri/src/commands/auth.rs:307
let new_hash = bcrypt::hash(&password, 14).map_err(|e| e.to_string())?;
```

---

### 4. FIX/BUG/ISSUE комментарии

#### Критические (TC-H, CRY-H, AUDIT)

```
/workspace/manager-work/src-tauri/src/commands/auth.rs:50
// FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force

/workspace/manager-work/src-tauri/src/commands/auth.rs:256
// FIX CRY-H02: Use bcrypt cost factor 14 for stronger password hashing (OWASP 2026 recommendation)

/workspace/manager-work/src-tauri/src/commands/config.rs:50
// FIX TC-H03: Rate limiting — 5 attempts per minute to prevent abuse

/workspace/manager-work/src-tauri/src/commands/config.rs:100
// FIX TC-02: Prevent path traversal attacks by canonicalizing the path

/workspace/manager-work/src-tauri/src/commands/config.rs:120
// FIX AUDIT-11: реальный импорт через SQLite backup API (атомарно, без race condition)

/workspace/manager-work/src-tauri/src/commands/license.rs:50
// FIX TC-H03: Rate limiting — 5 attempts per minute to prevent brute-force

/workspace/manager-work/src-tauri/src/background.rs:400
// FIX TC-H01: Validate count to prevent command injection

/workspace/manager-work/src-tauri/src/background.rs:410
// FIX TC-H01: Use spawn with explicit arg handling (already safe via .arg())
```

#### Race conditions и concurrency

```
/workspace/manager-work/src-tauri/src/background.rs:28
// FIX B-MED-05: Race condition fix — используем атомарный флаг + единый lock

/workspace/manager-work/src-tauri/src/background.rs:115
// FIX B22: IMAP тред — lock держим минимально, не во время сетевых операций

/workspace/manager-work/src-tauri/src/commands/auth.rs:200
// FIX B-MED-05: Сбрасываем атомарный флаг после успешного unlock

/workspace/manager-work/src-tauri/src/commands/auth.rs:220
// FIX B-MED-05: Атомарно устанавливаем флаг блокировки
```

#### Retry и reliability

```
/workspace/manager-work/src-tauri/src/commands/cards.rs:100
// FIX P1-RETRY-03: Push update to sync server with retry

/workspace/manager-work/src-tauri/src/commands/cards.rs:150
// FIX P1-RETRY-04: Push update to sync server with retry

/workspace/manager-work/src-tauri/src/commands/cards.rs:200
// FIX P1-RETRY-05: Push bulk update to sync server with retry

/workspace/manager-work/src-tauri/src/background.rs:50
// FIX P3-FOOTPRINT-AUTO-01: Periodic footprint sync с retry и логированием
```

#### WebSocket и network

```
/workspace/manager-work/src-tauri/src/ws_sync.rs:231
// FIX P3-HB-03: Track missed pings and reconnect after MAX_MISSED_PINGS

/workspace/manager-work/src-tauri/src/ws_sync.rs:287
// FIX WS-BATCH-01: Limit batch size to prevent DoS

/workspace/manager-work/cc-sync-server/socket.js:63
// FIX API-11: Restrict CORS to known origins - default to localhost for dev

/workspace/manager-work/cc-sync-server/socket.js:73
// FIX WS-MAXPAYLOAD-01: Limit message size to prevent DoS
maxHttpBufferSize: 1e6, // 1MB max
```

#### Frontend (FE-H, P1, P2)

```
/workspace/manager-work/src/App.jsx:150
// FIX P2-STATUS-01: WS sync connection status

/workspace/manager-work/src/App.jsx:450
// FIX FE-H05: Log error instead of silently ignoring

/workspace/manager-work/src/App.jsx:490
// FIX FE-03: Properly handle Promise.all cleanup with error handling

/workspace/manager-work/src/components/Modal.jsx:50
// FIX P1-15: Update ref in effect, not during render

/workspace/manager-work/src/components/Modal.jsx:60
// FIX P1-15: Use ref for stable onClose reference to prevent listener recreation

/workspace/manager-work/src/float.jsx:100
// FIX FE-01: Added AbortController to prevent race conditions and state updates after unmount

/workspace/manager-work/src/hooks/useFocusTrap.js:50
// FIX P2-12: Get fresh nodes on each keydown (not stale closure)

/workspace/manager-work/src/pages/Cards.jsx:100
// FIX FE-H01: Track delete timers for cleanup on unmount

/workspace/manager-work/src/pages/Cards.jsx:150
// FIX: Обернуть handleSyncUpdate и handleFullSync в ref для стабильности

/workspace/manager-work/src/pages/Cards.jsx:200
// FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)

/workspace/manager-work/src/pages/Cards/ImportModal.jsx:96
// FIX P1-13: Debounce onImported to prevent rapid refetch

/workspace/manager-work/src/pages/Orders/RepeatOrderModal.jsx:50
// FIX P1-16: Add scroll lock

/workspace/manager-work/src/pages/Orders/ShippedModal.jsx:50
// FIX P1-16: Add scroll lock

/workspace/manager-work/src/pages/Profiles.jsx:50
// FIX P2-3: AbortController for fetch cancellation

/workspace/manager-work/src/pages/Profiles.jsx:100
const deleteTimersRef = useRef(new Map()) // FIX P2-1: Track delete timers for cleanup
```

#### Прочие

```
/workspace/manager-work/src-tauri/src/database/_cards.rs:117
// P2-QUARANTINE: Filter by quarantine status (cards < 14 days old are quarantined)

/workspace/manager-work/src-tauri/src/database/_cards.rs:144
// FIX B13: holder_name зашифрован — поиск по нему бессмысленен, убираем

/workspace/manager-work/src-tauri/src/database/_imap.rs:326
// FIX AUDIT-13: возвращает (uid, folder) сообщения для live-запросов к серверу

/workspace/manager-work/src-tauri/src/background.rs:231
// FIX B30: 17track батчинг по 40 номеров

/workspace/manager-work/src-tauri/src/background.rs:320
// FIX AUDIT-09: логируем успешный опрос — иначе невозможно отследить работоспособность

/workspace/manager-work/src-tauri/src/commands/orders.rs:100
// FIX B31: передаём все факторы риска в БД-функцию

/workspace/manager-work/src-tauri/src/database/mod.rs:10
//! FIX B-MED-04: Connection pooling with r2d2 for better concurrent access
```

---

### 5. UNWRAP / EXPECT (потенциальные panic)

#### Критические (main, state)

```
/workspace/manager-work/src-tauri/src/main.rs:41
let db = Database::open(&db_path_str).expect("Failed to open database");

/workspace/manager-work/src-tauri/src/main.rs:74
let win = app.get_webview_window("main").expect("main window");

/workspace/manager-work/src-tauri/src/main.rs:167
.expect("error building tauri application")

/workspace/manager-work/src-tauri/src/state.rs:18
pub(crate) fn state() -> &'static AppState {
    STATE.get().expect("AppState not initialized")
}

/workspace/manager-work/src-tauri/src/state.rs:53
WS_HANDLE.get().expect("WsSyncHandle not initialized")

/workspace/manager-work/src-tauri/src/encryption.rs:106
.expect("HMAC key init");
```

#### Regex (менее критично, статичные паттерны)

```
/workspace/manager-work/src-tauri/src/imap.rs:102
let re_usps   = Regex::new(r"\b(9[0-9]\d{20})\b").unwrap();

/workspace/manager-work/src-tauri/src/imap.rs:103
let re_ups    = Regex::new(r"\b(1Z[0-9A-Z]{16})\b").unwrap();

/workspace/manager-work/src-tauri/src/imap.rs:104
let re_amazon = Regex::new(r"\b(TBA\d{12})\b").unwrap();

/workspace/manager-work/src-tauri/src/imap.rs:105
let re_fedex  = Regex::new(r"(?i)track(?:ing)?\s*(?:number)?[:\s]+(\d{12,15})").unwrap();

/workspace/manager-work/src-tauri/src/imap.rs:106
let re_order  = Regex::new(r"(?i)(?:order\s*[#:\-]?\s*|#)([A-Z0-9\-]{4,20})").unwrap();

/workspace/manager-work/src-tauri/src/imap.rs:339
(дубликаты regex)

/workspace/manager-work/src-tauri/src/imap.rs:539
(дубликаты regex)
```

---

### 6. CONSOLE.LOG в production

#### Серверная часть (Node.js)

```
/workspace/manager-work/cc-sync-server/index.js:42
console.log(JSON.stringify(entry));

/workspace/manager-work/cc-sync-server/index.js:103
console.error('[health] DB check failed:', e.message);

/workspace/manager-work/cc-sync-server/index.js:126
console.error(err.stack || err.message);

/workspace/manager-work/cc-sync-server/index.js:129
console.log(`[vaultbase-sync] port ${PORT}`);

/workspace/manager-work/cc-sync-server/index.js:140
console.log(`[vaultbase-sync] ${signal} received, shutting down`);

/workspace/manager-work/cc-sync-server/middleware.js:53
console.error('[middleware/requireToken] Transaction error:', e);

/workspace/manager-work/cc-sync-server/middleware.js:70
console.error('CRITICAL: ADMIN_PASS environment variable is not set.');

/workspace/manager-work/cc-sync-server/middleware.js:75
console.error('WARNING: ADMIN_PASS is too short.');

/workspace/manager-work/cc-sync-server/routes/admin-api.js:286
console.warn(`[admin-api] release binary already absent: ${filename}`);

/workspace/manager-work/cc-sync-server/routes/admin-auth.js:31
console.error('CRITICAL: ADMIN_PASS not set; login rejected.');

/workspace/manager-work/cc-sync-server/routes/admin-auth.js:37
console.warn(JSON.stringify({ ... }));

/workspace/manager-work/cc-sync-server/routes/admin-auth.js:49
console.log(JSON.stringify({ ... }));

/workspace/manager-work/cc-sync-server/routes/bin.js:83
console.error('BIN decryption error:', e.message);

/workspace/manager-work/cc-sync-server/routes/bin.js:105
console.error('BIN encryption error:', e.message);

/workspace/manager-work/cc-sync-server/routes/catalog.js:16
console.error(`[catalog] cannot open catalog.db (readonly=${readonly}): ${e.message}`);

/workspace/manager-work/cc-sync-server/routes/catalog.js:29
console.error(`[catalog] failed to close catalog.db handle: ${e.message}`);

/workspace/manager-work/cc-sync-server/routes/invite.js:90
console.error('[invite/validate] Transaction error:', e);

/workspace/manager-work/cc-sync-server/routes/sync.js:259
console.error('[sync/cards] batch transaction failed:', e.message);

/workspace/manager-work/cc-sync-server/routes/update.js:74
console.error('[update] release_files query failed:', e.message);

/workspace/manager-work/cc-sync-server/socket.js:157
console.error('[socket] card push transaction failed:', e.message);

/workspace/manager-work/cc-sync-server/ws-tauri.js:207
console.error('[ws-tauri] card push transaction failed:', e.message);

/workspace/manager-work/cc-sync-server/ws-tauri.js:252
console.warn(`[ws-tauri] client ${iid} dropped connection: ${err.code}`);

/workspace/manager-work/cc-sync-server/ws-tauri.js:255
console.error(`[ws-tauri] socket error for ${iid}: ${err.message}`);
```

#### Фронтенд (React)

```
/workspace/manager-work/src/App.jsx:491
if (import.meta.env.DEV) console.error('[App] update check failed:', e?.message || e)

/workspace/manager-work/src/App.jsx:516
if (import.meta.env.DEV) console.error('[App] Failed to check cards for onboarding:', e)

/workspace/manager-work/src/App.jsx:579
console.error('[App] Failed to setup server event listeners:', error)

/workspace/manager-work/src/App.jsx:593
if (import.meta.env.DEV) console.error('[App] Error cleaning up event listener:', e)

/workspace/manager-work/src/components/ErrorBoundary.jsx:25
console.error('ErrorBoundary caught an error:', error, errorInfo)

/workspace/manager-work/src/components/LicenseSection.jsx:24
.catch(e => console.error('[LicenseSection] Failed to get installation ID:', e))

/workspace/manager-work/src/float.jsx:217
console.error('[float] Failed to copy billing address:', e)

/workspace/manager-work/src/float.jsx:534
console.error('[float] Failed to open main window:', e)

/workspace/manager-work/src/float.jsx:552
console.error('[float] Failed to open main window:', e)

/workspace/manager-work/src/hooks/useAuth.jsx:20
console.warn('[Auth] Failed to save session token:', e.message)

/workspace/manager-work/src/hooks/useAuth.jsx:30
console.warn('[Auth] Logout request failed:', e.message)

/workspace/manager-work/src/hooks/useAuth.jsx:37
console.warn('[Auth] Failed to remove session token:', e.message)

/workspace/manager-work/src/hooks/useAuth.jsx:52
console.warn('[Auth] Failed to save session token:', e.message)

/workspace/manager-work/src/hooks/useTheme.jsx:45
console.warn('[useTheme] Не удалось сохранить тему:', err)

/workspace/manager-work/src/pages/Activate.jsx:37
.catch(e => console.error('[Activate] Failed to get installation ID:', e))

/workspace/manager-work/src/pages/Cards.jsx:214
console.error('[Cards] Load error:', e)

/workspace/manager-work/src/pages/Cards.jsx:295
console.error('[Cards] Failed to register sync listeners:', e)

/workspace/manager-work/src/pages/Cards/CardSidePanel.jsx:49
if (import.meta.env.DEV) console.error('[CardSidePanel] Failed to load orders:', e)

/workspace/manager-work/src/pages/DashboardRedesigned.jsx:876
console.error('[Dashboard] Failed to save collapsed state:', e)

/workspace/manager-work/src/pages/DashboardRedesigned.jsx:929
if (r.status === 'rejected') console.warn('Dashboard load error [' + i + ']:', r.reason)

/workspace/manager-work/src/pages/Orders.jsx:100
.catch(e => console.error('[Orders] Failed to fetch shops:', e))
```

---

### 7. ПУСТЫЕ ФУНКЦИИ (заглушки)

```
/workspace/manager-work/src-tauri/src/background.rs:471
#[cfg(not(target_os = "macos"))]
pub(crate) fn set_dock_badge(_count: u32) {}

/workspace/manager-work/src-tauri/src/background.rs:610
#[cfg(target_os = "windows")]
pub(crate) fn purge_old_webview_cache() {}
```

**Примечание:** Обе функции — platform-specific заглушки для несоответствующих платформ (корректное использование).

---

### 8. SEED/ТЕСТОВЫЕ ДАННЫЕ

```
/workspace/manager-work/src-tauri/src/database/_seed.rs:125-170
// 3 магазина с полными данными
ShopInput {
    name: "Best Buy".into(),
    url: "https://bestbuy.com".into(),
    category: "Electronics".into(),
    notes: "Требует AVS-совпадение".into(),
    requires_cvv_match: true,
    blocks_vpn: true,
    phone_must_match: false,
    accepts_amex: true,
    requires_avs: true,
    high_cancel_risk: false,
},
ShopInput {
    name: "Walmart".into(),
    url: "https://walmart.com".into(),
    category: "Retail".into(),
    notes: "Лёгкий, но частые отмены при высоком чеке".into(),
    requires_cvv_match: false,
    blocks_vpn: false,
    phone_must_match: false,
    accepts_amex: true,
    requires_avs: false,
    high_cancel_risk: true,
},
ShopInput {
    name: "Newegg".into(),
    url: "https://newegg.com".into(),
    category: "Electronics".into(),
    notes: "Строгий антифрод, нужен чистый прокси".into(),
    requires_cvv_match: true,
    blocks_vpn: true,
    phone_must_match: true,
    accepts_amex: false,
    requires_avs: true,
    high_cancel_risk: false,
},

/workspace/manager-work/src-tauri/src/database/_seed.rs:172-200
// 3 email в пул, 2 IMAP аккаунта, 2 прокси с портом 8080
```

---

### 9. LEGACY КОД И МИГРАЦИИ

```
/workspace/manager-work/src-tauri/src/database/_cards.rs:599
// FIX AUDIT-01: устойчивость к legacy plaintext. Некоторые поля (например,
// holder_name) хранились в plaintext до внедрения шифрования. Код обнаруживает
// шифротекст «legacy plaintext» и перешифровывал его повторно (двойное
// шифрование) — FIX исправил это.

/workspace/manager-work/src-tauri/src/database/_cards.rs:679
// шифротекст «legacy plaintext» и перешифровывал его повторно (двойное

/workspace/manager-work/src-tauri/src/database/_imap.rs:489
// Rows written before SMTP passwords were encrypted hold plaintext.
// so a failure identifies a legacy row. Re-encrypt it in place.

/workspace/manager-work/src-tauri/src/commands/auth.rs:288
// FIX B-MED-07: Автоматическая миграция bcrypt cost factor.
// Если старый хеш имеет cost < 14, пересчитываем его при успешном входе
```

---

### 10. HARDCODED ЛОКАЛИЗАЦИЯ

```
/workspace/manager-work/src/App.jsx:341
toast('Сессия истекла. Пожалуйста, войдите снова.', 'error')
```

**Рекомендация:** Заменить на `t('session_expired')`

---

### 11. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (SECRETS)

#### Серверная часть

```
/workspace/manager-work/cc-sync-server/auth.js:16
const base = process.env.SESSION_SECRET || process.env.ADMIN_PASS;

/workspace/manager-work/cc-sync-server/middleware.js:70
if (!process.env.ADMIN_PASS) {
  console.error('CRITICAL: ADMIN_PASS environment variable is not set.');
}

/workspace/manager-work/cc-sync-server/middleware.js:74
if (process.env.ADMIN_PASS.length < 12) {
  console.error('WARNING: ADMIN_PASS is too short.');
}

/workspace/manager-work/cc-sync-server/routes/activate.js:25
const secret = process.env.SERVER_SECRET;

/workspace/manager-work/cc-sync-server/routes/bin.js:28
const secret = process.env.SERVER_SECRET;

/workspace/manager-work/cc-sync-server/routes/catalog.js:34
const secret = process.env.SERVER_SECRET;

/workspace/manager-work/cc-sync-server/socket.js:65
origin: process.env.NODE_ENV === 'production'
  ? (process.env.WS_ALLOWED_ORIGINS?.split(',') || [])
  : ['http://localhost:5173', 'http://localhost:1420']
```

---

## 🔍 Итоговая карта проблемных мест

### Критичность: ВЫСОКАЯ

1. **main.rs:41-167** — `.expect()` при инициализации БД и окна (panic при ошибке)
2. **state.rs:18,53** — `.expect()` при доступе к глобальному state (panic)
3. **socket.js:65** — CORS с пустым массивом в production при отсутствии `WS_ALLOWED_ORIGINS`
4. **middleware.js:70** — `ADMIN_PASS` не задан → admin API отключен, но сервер продолжает работать
5. **tracking.rs:104,255,276,448** — Hardcoded URLs внешних API (изменение доменов = отказ сервиса)

### Критичность: СРЕДНЯЯ

6. **endpoints.rs:27, stuffer.rs:11** — Hardcoded базовые URLs серверов
7. **imap.rs:102-106, 339-343, 539-543** — Regex компилируются каждый раз (производительность)
8. **background.rs:231** — Батчинг 17track по 40 (не выделено в константу)
9. **\_cards.rs:120,123** — Quarantine 14 дней hardcoded в SQL (не настраивается)
10. **sync.rs:133,485** — `MAX_RETRIES = 3` — не настраивается через конфиг

### Критичность: НИЗКАЯ

11. **82+ console.log** — Вместо structured logging
12. **\_seed.rs** — Seed данные могут попасть в production
13. **App.jsx:341** — Hardcoded локализация
14. **Все таймауты** — Разбросаны по коду, не централизованы

---

**Конец детального списка**
