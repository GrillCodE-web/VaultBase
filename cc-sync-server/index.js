require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const { requireAdmin } = require('./middleware');

const app = express();
const server = http.createServer(app);

// Behind nginx, req.ip is the proxy's address unless this is set, which would
// make every per-IP rate limiter share a single bucket: one attacker could then
// lock out all admins. 'loopback' trusts only a same-host proxy, so a client
// cannot spoof its IP by sending its own X-Forwarded-For.
// Override with TRUST_PROXY (e.g. a hop count) if the proxy is not on localhost.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

// ── Structured request logging ──────────────────────────────────────────────
// Logs method, path, status, duration, and installation_id when available.
// Sensitive values (tokens, activation keys, card payloads) are never logged.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const entry = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - start,
    };
    if (req.installationId) {
      // Set by requireToken once a license token authenticated the request.
      // The token itself is deliberately never logged.
      entry.installation_id = req.installationId;
    }
    console.log(JSON.stringify(entry));
  });
  next();
});

// Static: release binaries
const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, 'public/releases');
fs.mkdirSync(RELEASES_DIR, { recursive: true });
app.use('/releases', express.static(RELEASES_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.dmg'))    res.set('Content-Type', 'application/x-apple-diskimage');
    if (fp.endsWith('.tar.gz')) res.set('Content-Type', 'application/gzip');
  }
}));

// Socket.io (for browser admin panel / future use)
const io = require('./socket').init(server);
app.set('io', io);

// Raw WebSocket for Tauri desktop client (path: /ws)
const { WebSocketServer } = require('ws');
const wssTauri = new WebSocketServer({ server, path: '/ws' });
require('./ws-tauri')(wssTauri, io);
app.set('wssTauri', wssTauri);

// Public API
app.use('/activate',  require('./routes/activate'));
app.use('/verify',    require('./routes/verify'));
app.use('/footprint', require('./routes/footprint'));
app.use('/version',   require('./routes/version'));
app.use('/update',    require('./routes/update'));
app.use('/invite',    require('./routes/invite'));
app.use('/sync',      require('./routes/sync'));
// SEC-019: CSP violation reports from Tauri clients (see tauri.conf.json report-uri)
app.use('/csp-report', require('./routes/csp-report'));

// Catalog sync
app.use('/api/catalog',  require('./routes/catalog'));

// BIN cache (shared across all clients)
app.use('/api/bin',      require('./routes/bin'));

// Admin (hidden path for security)
const ADMIN_PATH = process.env.ADMIN_PATH || '/ghostadmin/1asfd-54-local';
// Login routes mount first and are deliberately unauthenticated — the gate below
// redirects here, so guarding it would create a redirect loop.
app.use(ADMIN_PATH,             require('./routes/admin-auth'));
app.use(`${ADMIN_PATH}/api`,    require('./routes/admin-api'));
app.use(`${ADMIN_PATH}/upload`, require('./routes/upload'));
app.use(ADMIN_PATH, requireAdmin, express.static(path.join(__dirname, 'admin'), {
  // login.html is reachable via GET /login; blocking the direct filename keeps
  // one canonical URL for the page.
  index: 'index.html',
}));

// Health check — verifies the SQLite database is readable.
app.get('/health', (req, res) => {
  try {
    const { getDb } = require('./database');
    const row = getDb().prepare('SELECT 1 AS ok').get();
    if (!row || row.ok !== 1) throw new Error('db_read_check_failed');
    res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
  } catch (e) {
    console.error('[health] DB check failed:', e.message);
    res.status(503).json({ status: 'error', error: e.message, uptime: process.uptime(), ts: Date.now() });
  }
});

// Public releases API (no auth — used by download page)
app.get('/api/releases', (req, res) => {
  const { getDb } = require('./database');
  try {
    const rows = getDb().prepare(
      'SELECT version, file_type, platform, download_url, file_size, notes, published_at FROM release_files WHERE is_published=1 ORDER BY published_at DESC'
    ).all();
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ releases: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Favicon — served explicitly; public/ is deliberately not statically mounted
app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.svg')));

// Root — nothing revealed
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.use((req, res) => res.status(404).end());
app.use((err, req, res, _next) => { console.error(err.stack || err.message); res.status(500).end(); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[vaultbase-sync] port ${PORT}`));

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Stop accepting new connections, close both WebSocket servers, then close the
// SQLite handle so WAL data is checkpointed. Force-exits if clients hang.
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[vaultbase-sync] ${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('[vaultbase-sync] shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Close live WebSocket clients first: server.close() only invokes its callback
  // once every open connection has ended, and WS connections are long-lived.
  require('./ws-tauri').shutdown();
  wssTauri.close();
  io.close();

  server.close(() => {
    require('./database').closeDb();
    console.log('[vaultbase-sync] shutdown complete');
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io };
