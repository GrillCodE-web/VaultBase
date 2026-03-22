const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { requireBasicAuth } = require('../middleware');
const { deriveActivationKey } = require('./activate');
const cache = require('../cache');

const router = express.Router();
router.use(requireBasicAuth);

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const cached = cache.get('admin:stats');
  if (cached) return res.json(cached);

  const db = getDb();
  const active   = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 1').get().n;
  const revoked  = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 0').get().n;
  const total_fp = db.prepare('SELECT COUNT(*) AS n FROM footprints').get().n;
  const fp_7d    = db.prepare("SELECT COUNT(*) AS n FROM footprints WHERE created_at >= datetime('now','-7 days')").get().n;
  const latest   = db.prepare('SELECT version FROM versions WHERE is_published=1 ORDER BY published_at DESC LIMIT 1').get();

  const inviteTotal  = db.prepare('SELECT COUNT(*) AS n FROM invite_codes').get().n;
  const inviteUsed   = db.prepare('SELECT COUNT(*) AS n FROM invite_codes WHERE is_used=1').get().n;
  const inviteActive = db.prepare("SELECT COUNT(*) AS n FROM invite_codes WHERE is_used=0 AND (expires_at IS NULL OR expires_at > datetime('now'))").get().n;

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

  const fp_by_type = db.prepare(
    'SELECT hash_type AS type, COUNT(*) AS count FROM footprints GROUP BY hash_type ORDER BY count DESC'
  ).all();

  const result = {
    active_licenses: active,
    revoked_licenses: revoked,
    total_footprints: total_fp,
    footprints_7d: fp_7d,
    version: latest ? latest.version : '—',
    invite_total: inviteTotal,
    invite_used: inviteUsed,
    invite_active: inviteActive,
    fp_by_day,
    fp_by_type,
  };

  cache.set('admin:stats', result, 30_000);
  res.json(result);
});

// ── Licenses ──────────────────────────────────────────────────────────────────
router.get('/licenses', (req, res) => {
  const cached = cache.get('admin:licenses');
  if (cached) return res.json(cached);
  const rows = getDb().prepare(
    'SELECT installation_id,label,challenge,token,is_active,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  cache.set('admin:licenses', rows, 10_000);
  res.json(rows);
});

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
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true, activation_key });
});

// PATCH /admin/api/licenses/:id — edit label
router.patch('/licenses/:id', (req, res) => {
  const { label } = req.body || {};
  if (label === undefined) return res.status(400).json({ error: 'label required' });
  getDb().prepare('UPDATE licenses SET label=? WHERE installation_id=?').run(label.trim(), req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
});

router.post('/licenses/:id/revoke', (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=0 WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
});

router.post('/licenses/:id/restore', (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=1 WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
});

// DELETE /admin/api/licenses/:id
router.delete('/licenses/:id', (req, res) => {
  getDb().prepare('DELETE FROM licenses WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
});

// GET /admin/api/licenses/analytics — license analytics summary
router.get('/licenses/analytics', (req, res) => {
  try {
    const db = getDb();
    const total    = db.prepare('SELECT COUNT(*) AS n FROM licenses').get()?.n || 0;
    const active   = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 1').get()?.n || 0;
    const recent   = db.prepare(
      'SELECT installation_id, label, is_active, created_at FROM licenses ORDER BY created_at DESC LIMIT 20'
    ).all() || [];
    res.json({ total, active, inactive: total - active, recent });
  } catch (e) {
    res.json({ total: 0, active: 0, inactive: 0, recent: [], error: e.message });
  }
});

// GET /admin/api/licenses/export.csv
router.get('/licenses/export.csv', (req, res) => {
  const rows = getDb().prepare(
    'SELECT installation_id,label,challenge,token,is_active,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  const header = 'installation_id,label,challenge,token,is_active,created_at,last_seen\n';
  const csv = header + rows.map(r =>
    [r.installation_id, r.label, r.challenge, r.token || '', r.is_active, r.created_at, r.last_seen || '']
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="licenses.csv"');
  res.send(csv);
});

// ── Invite Codes ──────────────────────────────────────────────────────────────

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I confusion
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// GET /admin/api/invites
router.get('/invites', (req, res) => {
  res.json(getDb().prepare(
    'SELECT * FROM invite_codes ORDER BY created_at DESC'
  ).all());
});

// POST /admin/api/invites — create one or many
router.post('/invites', (req, res) => {
  const { label, count = 1, expires_days } = req.body || {};
  const db = getDb();
  const created = [];
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);

  const expires_at = expires_days
    ? new Date(Date.now() + parseInt(expires_days) * 86400000).toISOString().slice(0, 19)
    : null;

  for (let i = 0; i < n; i++) {
    let code, attempts = 0;
    do {
      code = generateInviteCode();
      attempts++;
    } while (db.prepare('SELECT 1 FROM invite_codes WHERE code=?').get(code) && attempts < 10);

    db.prepare(
      'INSERT INTO invite_codes (code, label, expires_at) VALUES (?,?,?)'
    ).run(code, label || '', expires_at);
    created.push(code);
  }

  res.json({ ok: true, codes: created });
});

// PATCH /admin/api/invites/:code — edit label
router.patch('/invites/:code', (req, res) => {
  const { label } = req.body || {};
  getDb().prepare('UPDATE invite_codes SET label=? WHERE code=?').run(label || '', req.params.code);
  res.json({ ok: true });
});

// DELETE /admin/api/invites/:code
router.delete('/invites/:code', (req, res) => {
  getDb().prepare('DELETE FROM invite_codes WHERE code=?').run(req.params.code);
  res.json({ ok: true });
});

// POST /admin/api/invites/:code/reset — mark as unused again
router.post('/invites/:code/reset', (req, res) => {
  getDb().prepare('UPDATE invite_codes SET is_used=0, used_at=NULL WHERE code=?').run(req.params.code);
  res.json({ ok: true });
});

// GET /admin/api/invites/export.csv
router.get('/invites/export.csv', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all();
  const header = 'code,label,is_used,used_at,created_at,expires_at\n';
  const csv = header + rows.map(r =>
    [r.code, r.label, r.is_used, r.used_at || '', r.created_at, r.expires_at || '']
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="invites.csv"');
  res.send(csv);
});

// ── Versions (reads from release_files for multi-type support) ───────────────
router.get('/versions', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM release_files ORDER BY published_at DESC').all());
});

// DELETE /admin/api/versions/:version?file_type=xxx — removes one file entry
router.delete('/versions/:version', (req, res) => {
  const db = getDb();
  const file_type = req.query.file_type || 'updater';
  const row = db.prepare('SELECT download_url FROM release_files WHERE version=? AND file_type=?').get(req.params.version, file_type);
  if (!row) return res.status(404).json({ error: 'not found' });

  if (row.download_url) {
    try {
      const fs = require('fs');
      const path = require('path');
      const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, '../public/releases');
      const filename = row.download_url.split('/').pop();
      const filepath = path.join(RELEASES_DIR, filename);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch(e) { /* non-fatal */ }
  }

  db.prepare('DELETE FROM release_files WHERE version=? AND file_type=?').run(req.params.version, file_type);
  // Also remove from versions table if it was an updater
  if (file_type === 'updater')
    db.prepare('DELETE FROM versions WHERE version=?').run(req.params.version);
  res.json({ ok: true });
});

// ── Footprints ────────────────────────────────────────────────────────────────
router.get('/footprints', (req, res) => {
  const db = getDb();
  const { domain } = req.query;
  const rows = domain
    ? db.prepare('SELECT * FROM footprints WHERE shop_domain LIKE ? ORDER BY created_at DESC LIMIT 2000').all(`%${domain}%`)
    : db.prepare('SELECT * FROM footprints ORDER BY created_at DESC LIMIT 2000').all();
  res.json(rows);
});

// ── Activity ──────────────────────────────────────────────────────────────────
router.get('/activity', (req, res) => {
  const db = getDb();
  const type = req.query.type || 'all';
  const rows = [];

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

  db.prepare(`
    SELECT installation_id, label, token, last_seen AS created_at FROM licenses
    WHERE token IS NOT NULL AND last_seen IS NOT NULL
    ORDER BY last_seen DESC LIMIT 40
  `).all().forEach(r => rows.push({
    event_type: 'verify',
    description: `License verified: ${r.label || r.installation_id.slice(0,20)}`,
    user_token: r.token, created_at: r.created_at,
  }));

  // Invite usage
  db.prepare(`
    SELECT code, label, used_at AS created_at FROM invite_codes
    WHERE is_used=1 AND used_at IS NOT NULL
    ORDER BY used_at DESC LIMIT 40
  `).all().forEach(r => rows.push({
    event_type: 'invite_used',
    description: `Invite used${r.label ? ': ' + r.label : ''} — ${r.code}`,
    user_token: null, created_at: r.created_at,
  }));

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const filtered = type === 'all' ? rows : rows.filter(r => r.event_type.includes(type));
  res.json(filtered.slice(0, 100));
});

// ── Sync Groups ────────────────────────────────────────────────────────────────

router.get('/sync-groups', (req, res) => {
  const db = getDb();
  const groups = db.prepare('SELECT * FROM sync_groups ORDER BY created_at DESC').all();
  const result = groups.map(g => {
    const members = db.prepare(
      'SELECT installation_id, joined_at FROM sync_group_members WHERE group_id = ?'
    ).all(g.id);
    const card_count = db.prepare('SELECT COUNT(*) AS n FROM sync_cards WHERE group_id = ?').get(g.id).n;
    return { ...g, members, card_count };
  });
  res.json(result);
});

router.post('/sync-groups', (req, res) => {
  const db = getDb();
  const { name, installation_ids } = req.body || {};
  const group_id = require('crypto').randomUUID();
  const group_key = require('crypto').randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sync_groups (id, name, created_by, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .run(group_id, name || 'Admin Group', 'admin');
  if (Array.isArray(installation_ids)) {
    for (const iid of installation_ids) {
      db.prepare(
        'INSERT OR IGNORE INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      ).run(group_id, iid, group_key);
    }
  }
  res.json({ ok: true, group_id, group_key });
});

router.delete('/sync-groups/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sync_cards WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sync_group_members WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sync_pair_codes WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sync_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/sync-groups/:id/members', (req, res) => {
  const db = getDb();
  const { installation_id } = req.body || {};
  if (!installation_id) return res.status(400).json({ error: 'installation_id required' });
  // Get group_key from first member
  const firstMember = db.prepare('SELECT group_key_encrypted FROM sync_group_members WHERE group_id = ? LIMIT 1').get(req.params.id);
  const group_key = firstMember?.group_key_encrypted || require('crypto').randomBytes(32).toString('hex');
  try {
    db.prepare(
      'INSERT INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
    ).run(req.params.id, installation_id, group_key);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'already_member' });
    throw e;
  }
});

router.delete('/sync-groups/:id/members/:iid', (req, res) => {
  getDb().prepare('DELETE FROM sync_group_members WHERE group_id = ? AND installation_id = ?')
    .run(req.params.id, req.params.iid);
  res.json({ ok: true });
});

// ── Live Connections ───────────────────────────────────────────────────────────
router.get('/connections', (req, res) => {
  try {
    const { activeConnections } = require('../socket');
    const list = Array.from(activeConnections.entries()).map(([id, data]) => ({ socket_id: id, ...data }));
    res.json({ connections: list, total: list.length });
  } catch(e) { res.json({ connections: [], total: 0, error: e.message }); }
});

router.get('/events', (req, res) => {
  try {
    const { eventLog } = require('../socket');
    res.json({ events: [...eventLog].reverse().slice(0, 50) });
  } catch(e) { res.json({ events: [], error: e.message }); }
});

// ── Group Stats ────────────────────────────────────────────────────────────────
router.get('/groups/stats', (req, res) => {
  try {
    const db = getDb();
    const groups = db.prepare('SELECT id, name, created_by, created_at FROM sync_groups ORDER BY created_at DESC').all();
    const result = groups.map(g => {
      const member_count = db.prepare('SELECT COUNT(*) AS n FROM sync_group_members WHERE group_id = ?').get(g.id).n;
      const card_count   = db.prepare('SELECT COUNT(*) AS n FROM sync_cards WHERE group_id = ?').get(g.id).n;
      return { ...g, member_count, card_count };
    });
    res.json({ groups: result, total: result.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
