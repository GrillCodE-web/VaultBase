const express = require('express');
const { getDb } = require('../database');
const { requireBasicAuth } = require('../middleware');
const { deriveActivationKey } = require('./activate');

const router = express.Router();
router.use(requireBasicAuth);

// GET /admin/api/stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const active  = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 1').get().n;
  const revoked = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 0').get().n;
  const total_fp = db.prepare('SELECT COUNT(*) AS n FROM footprints').get().n;
  const fp_7d = db.prepare("SELECT COUNT(*) AS n FROM footprints WHERE created_at >= datetime('now','-7 days')").get().n;
  const latest_version = db.prepare('SELECT version FROM versions ORDER BY published_at DESC LIMIT 1').get();

  // Footprints per day — last 7 days
  const rawDays = db.prepare(`
    SELECT date(created_at) AS date, COUNT(*) AS count FROM footprints
    WHERE created_at >= datetime('now','-7 days')
    GROUP BY date(created_at) ORDER BY date ASC
  `).all();
  const dayMap = {};
  rawDays.forEach(r => { dayMap[r.date] = r.count; });
  const fp_by_day = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    fp_by_day.push({ date: key, count: dayMap[key] || 0 });
  }

  // Footprints by type
  const fp_by_type = db.prepare(
    'SELECT hash_type AS type, COUNT(*) AS count FROM footprints GROUP BY hash_type ORDER BY count DESC'
  ).all();

  res.json({ active_licenses: active, revoked_licenses: revoked,
    total_footprints: total_fp, footprints_7d: fp_7d,
    version: latest_version ? latest_version.version : '—',
    fp_by_day, fp_by_type });
});

// GET /admin/api/licenses
router.get('/licenses', (req, res) => {
  const db = getDb();
  res.json(db.prepare(
    'SELECT installation_id,label,challenge,token,is_active,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all());
});

// POST /admin/api/licenses
router.post('/licenses', (req, res) => {
  const { installation_id, challenge, label } = req.body || {};
  if (!installation_id || !challenge) return res.status(400).json({ error: 'installation_id and challenge required' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO licenses (installation_id,challenge,label) VALUES (?,?,?)').run(
      installation_id.trim(), challenge.trim().toUpperCase(), label || ''
    );
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'installation_id already exists' });
    throw e;
  }
  const activation_key = deriveActivationKey(installation_id.trim(), challenge.trim().toUpperCase());
  res.json({ ok: true, activation_key });
});

// POST /admin/api/licenses/:id/revoke
router.post('/licenses/:id/revoke', (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=0 WHERE installation_id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /admin/api/licenses/:id/restore
router.post('/licenses/:id/restore', (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=1 WHERE installation_id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /admin/api/versions
router.get('/versions', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM versions ORDER BY published_at DESC').all());
});

// POST /admin/api/versions
router.post('/versions', (req, res) => {
  const { version, notes } = req.body || {};
  if (!version) return res.status(400).json({ error: 'version required' });
  try {
    getDb().prepare('INSERT INTO versions (version,notes) VALUES (?,?)').run(version.trim(), notes || '');
    res.json({ ok: true });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'version already exists' });
    throw e;
  }
});

// GET /admin/api/footprints?domain=nike.com
router.get('/footprints', (req, res) => {
  const db = getDb();
  const { domain } = req.query;
  const rows = domain
    ? db.prepare('SELECT * FROM footprints WHERE shop_domain LIKE ? ORDER BY created_at DESC LIMIT 2000').all(`%${domain}%`)
    : db.prepare('SELECT * FROM footprints ORDER BY created_at DESC LIMIT 2000').all();
  res.json(rows);
});

// GET /admin/api/activity?type=all
router.get('/activity', (req, res) => {
  const db = getDb();
  const type = req.query.type || 'all';
  const rows = [];

  // Footprint saves grouped by token+domain+minute
  db.prepare(`
    SELECT user_token, shop_domain, COUNT(*) AS cnt,
           MAX(created_at) AS created_at, 'footprint_saved' AS event_type
    FROM footprints
    GROUP BY user_token, shop_domain, strftime('%Y-%m-%d %H:%M', created_at)
    ORDER BY created_at DESC LIMIT 60
  `).all().forEach(r => rows.push({
    event_type: 'footprint_saved',
    description: `Saved ${r.cnt} footprint(s) for ${r.shop_domain}`,
    user_token: r.user_token, created_at: r.created_at,
  }));

  // License last-seen activity (verifications)
  db.prepare(`
    SELECT installation_id, label, token, last_seen AS created_at FROM licenses
    WHERE token IS NOT NULL AND last_seen IS NOT NULL
    ORDER BY last_seen DESC LIMIT 40
  `).all().forEach(r => rows.push({
    event_type: 'verify',
    description: `License verified: ${r.label || r.installation_id.slice(0,20)}`,
    user_token: r.token, created_at: r.created_at,
  }));

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const filtered = type === 'all' ? rows : rows.filter(r => r.event_type.includes(type));
  res.json(filtered.slice(0, 100));
});

module.exports = router;
