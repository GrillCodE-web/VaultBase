require('dotenv').config();
const express = require('express');
const path = require('path');
const { requireBasicAuth } = require('./middleware');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '1mb' }));
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

// Public API
app.use('/activate',     require('./routes/activate'));
app.use('/verify',       require('./routes/verify'));
app.use('/footprint',    require('./routes/footprint'));
app.use('/version',      require('./routes/version'));
app.use('/update',       require('./routes/update'));

// Admin
app.use('/admin/api',    require('./routes/admin-api'));
app.use('/admin/upload', require('./routes/upload'));
app.use('/admin', requireBasicAuth, express.static(path.join(__dirname, 'admin')));

// Root — nothing revealed
app.get('/', (req, res) => res.status(200).end());
app.use((req, res) => res.status(404).end());
app.use((err, req, res, _next) => { console.error(err.message); res.status(500).end(); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[cc-manager-sync] port ${PORT}`));
module.exports = app;
