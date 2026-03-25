const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

function getCatalogDb(readonly = true) {
  const dbPath = path.join(__dirname, '..', 'catalog.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    const Database = require('better-sqlite3');
    return new Database(dbPath, { readonly });
  } catch { return null; }
}

// Alias kept for existing GET routes
function openCatalogDb() { return getCatalogDb(false); }

const requireSecret = (req, res, next) => {
  const secret = process.env.SERVER_SECRET;
  if (!secret || req.headers['x-server-secret'] !== secret) return res.status(401).json({ error: 'unauthorized' });
  next();
};

// FIX API-03: Add X-Content-Type-Options header to prevent MIME sniffing XSS
router.get('/items', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const db = getCatalogDb(true);
  if (!db) return res.json({ items: [], total: 0, note: 'catalog.db not found on server' });
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const per_page = Math.min(100, parseInt(req.query.per_page) || 50);
    const offset = (page - 1) * per_page;

    // Parameterized query to prevent SQL injection
    const search = req.query.search || '';
    let items, total;

    if (search) {
      // Escape LIKE wildcards and use parameterized query
      const escapedSearch = search.replace(/[%_]/g, '\\$&');
      const likePattern = `%${escapedSearch}%`;
      total = db.prepare('SELECT COUNT(*) as c FROM catalog_items WHERE name LIKE ? ESCAPE \'\\\'').get(likePattern)?.c ?? 0;
      items = db.prepare('SELECT id, name, asin, price, pct, category, stop FROM catalog_items WHERE name LIKE ? ESCAPE \'\\\' ORDER BY name LIMIT ? OFFSET ?').all(likePattern, per_page, offset);
    } else {
      total = db.prepare('SELECT COUNT(*) as c FROM catalog_items').get()?.c ?? 0;
      items = db.prepare('SELECT id, name, asin, price, pct, category, stop FROM catalog_items ORDER BY name LIMIT ? OFFSET ?').all(per_page, offset);
    }

    db.close();
    res.json({ items, total, page, per_page, pages: Math.ceil(total / per_page) });
  } catch(e) { try { db.close(); } catch {} res.status(500).json({ items: [], total: 0, error: e.message }); }
});

// FIX API-03: Add X-Content-Type-Options header to prevent MIME sniffing XSS
router.get('/shops', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const db = getCatalogDb(true);
  if (!db) return res.json({ shops: [], total: 0, note: 'catalog.db not found on server' });
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const per_page = Math.min(100, parseInt(req.query.per_page) || 50);
    const offset = (page - 1) * per_page;

    // Parameterized query to prevent SQL injection
    const search = req.query.search || '';
    let items, total;

    if (search) {
      // Escape LIKE wildcards and use parameterized query
      const escapedSearch = search.replace(/[%_]/g, '\\$&');
      const likePattern = `%${escapedSearch}%`;
      total = db.prepare('SELECT COUNT(*) as c FROM catalog_shops WHERE domain LIKE ? ESCAPE \'\\\'').get(likePattern)?.c ?? 0;
      items = db.prepare('SELECT id, domain, category, score, ship_us, fraud_level FROM catalog_shops WHERE domain LIKE ? ESCAPE \'\\\' ORDER BY domain LIMIT ? OFFSET ?').all(likePattern, per_page, offset);
    } else {
      total = db.prepare('SELECT COUNT(*) as c FROM catalog_shops').get()?.c ?? 0;
      items = db.prepare('SELECT id, domain, category, score, ship_us, fraud_level FROM catalog_shops ORDER BY domain LIMIT ? OFFSET ?').all(per_page, offset);
    }

    db.close();
    res.json({ items, total, page, per_page, pages: Math.ceil(total / per_page) });
  } catch(e) { try { db.close(); } catch {} res.status(500).json({ items: [], total: 0, error: e.message }); }
});

// POST /api/catalog/items — add or update a catalog item (authenticated)
router.post('/items', requireSecret, (req, res) => {
  const { name, asin, price, pct, category, notes_en, stop } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const db = openCatalogDb();
    if (!db) return res.status(503).json({ error: 'catalog.db not available' });
    const existing = db.prepare('SELECT id FROM catalog_items WHERE name=?').get(name);
    let id;
    const itemData = { name, asin: asin||null, price: price!=null?price:null, pct: pct!=null?pct:null, category: category||null, notes_en: notes_en||null, stop: stop?true:false };
    if (existing) {
      db.prepare('UPDATE catalog_items SET asin=?, price=?, pct=?, category=?, notes_en=?, stop=? WHERE id=?')
        .run(asin||null, price!=null?price:null, pct!=null?pct:null, category||null, notes_en||null, stop?1:0, existing.id);
      id = existing.id;
      db.close();
      const payload = { id, ...itemData };
      const wss = req.app.get('wssTauri');
      if (wss) { const { broadcastCatalogUpdate } = require('../ws-tauri'); broadcastCatalogUpdate(wss, 'item', payload); }
      const io = req.app.get('io');
      if (io) io.emit('catalog_update', { type: 'item', data: payload });
      res.json({ id, updated: true });
    } else {
      const r = db.prepare('INSERT INTO catalog_items (name, asin, price, pct, category, notes_en, stop) VALUES (?,?,?,?,?,?,?)')
        .run(name, asin||null, price!=null?price:null, pct!=null?pct:null, category||null, notes_en||null, stop?1:0);
      id = Number(r.lastInsertRowid);
      db.close();
      const payload = { id, ...itemData };
      const wss = req.app.get('wssTauri');
      if (wss) { const { broadcastCatalogUpdate } = require('../ws-tauri'); broadcastCatalogUpdate(wss, 'item', payload); }
      const io = req.app.get('io');
      if (io) io.emit('catalog_update', { type: 'item', data: payload });
      res.json({ id, created: true });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/catalog/shops — add or update a catalog shop (authenticated)
router.post('/shops', requireSecret, (req, res) => {
  const { domain, category, score, ship_us, fraud_level, top_brands, top_products, excluded } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  try {
    const db = openCatalogDb();
    if (!db) return res.status(503).json({ error: 'catalog.db not available' });
    const existing = db.prepare('SELECT id FROM catalog_shops WHERE domain=?').get(domain);
    let id;
    const shopData = { domain, category: category||null, score: score!=null?score:null, ship_us: ship_us?true:false, fraud_level: fraud_level||null, top_brands: top_brands||null, top_products: top_products||null, excluded: excluded?true:false };
    if (existing) {
      db.prepare('UPDATE catalog_shops SET category=?, score=?, ship_us=?, fraud_level=?, top_brands=?, top_products=?, excluded=? WHERE id=?')
        .run(category||null, score!=null?score:null, ship_us?1:0, fraud_level||null, top_brands||null, top_products||null, excluded?1:0, existing.id);
      id = existing.id;
      db.close();
      const payload = { id, ...shopData };
      const wss = req.app.get('wssTauri');
      if (wss) { const { broadcastCatalogUpdate } = require('../ws-tauri'); broadcastCatalogUpdate(wss, 'shop', payload); }
      const io = req.app.get('io');
      if (io) io.emit('catalog_update', { type: 'shop', data: payload });
      res.json({ id, updated: true });
    } else {
      const r = db.prepare('INSERT INTO catalog_shops (domain, category, score, ship_us, fraud_level, top_brands, top_products, excluded) VALUES (?,?,?,?,?,?,?,?)')
        .run(domain, category||null, score!=null?score:null, ship_us?1:0, fraud_level||null, top_brands||null, top_products||null, excluded?1:0);
      id = Number(r.lastInsertRowid);
      db.close();
      const payload = { id, ...shopData };
      const wss = req.app.get('wssTauri');
      if (wss) { const { broadcastCatalogUpdate } = require('../ws-tauri'); broadcastCatalogUpdate(wss, 'shop', payload); }
      const io = req.app.get('io');
      if (io) io.emit('catalog_update', { type: 'shop', data: payload });
      res.json({ id, created: true });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
