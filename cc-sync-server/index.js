require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { requireBasicAuth } = require('./middleware');

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

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

// Catalog sync
app.use('/api/catalog',  require('./routes/catalog'));

// BIN cache (shared across all clients)
app.use('/api/bin',      require('./routes/bin'));

// Admin
app.use('/admin/api',    require('./routes/admin-api'));
app.use('/admin/upload', require('./routes/upload'));
app.use('/admin', requireBasicAuth, express.static(path.join(__dirname, 'admin')));

// Root — nothing revealed
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.use((req, res) => res.status(404).end());
app.use((err, req, res, _next) => { console.error(err.message); res.status(500).end(); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[cc-manager-sync] port ${PORT}`));

module.exports = { app, server, io };
