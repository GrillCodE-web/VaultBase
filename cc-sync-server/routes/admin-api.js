const express = require('express');
const crypto = require('crypto');
const { getDb, hashToken, getServerConfig, setServerConfig } = require('../database');
const { requireAdmin } = require('../middleware');
const { deriveActivationKey } = require('./activate');
const cache = require('../cache');

const router = express.Router();
router.use(requireAdmin);

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

  const inviteTotal      = db.prepare('SELECT COUNT(*) AS n FROM invite_codes').get().n;
  const inviteUsed       = db.prepare('SELECT COUNT(*) AS n FROM invite_codes WHERE is_used=1').get().n;
  const inviteActive     = db.prepare("SELECT COUNT(*) AS n FROM invite_codes WHERE is_used=0 AND (expires_at IS NULL OR expires_at > datetime('now'))").get().n;
  const inviteTotalUses  = db.prepare('SELECT COALESCE(SUM(use_count),0) AS n FROM invite_codes').get().n;

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
    invite_total_uses: inviteTotalUses,
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
    'SELECT installation_id,label,challenge,token_hash,is_active,role,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  // MGR-008: открытых токенов в БД больше нет — маскируем хеш (диагностика,
  // «какой токен у какой лицензии» остаётся возможной по префиксу).
  const maskedRows = rows.map(r => ({
    ...r,
    token: r.token_hash ? `${r.token_hash.slice(0, 8)}...${r.token_hash.slice(-8)}` : null,
    token_hash: undefined,
  }));
  cache.set('admin:licenses', maskedRows, 10_000);
  res.json(maskedRows);
});

router.post('/licenses', (req, res) => {
  const { installation_id, challenge, label, role } = req.body || {};
  if (!installation_id || !challenge) return res.status(400).json({ error: 'installation_id and challenge required' });
  // manager — полноценная роль manager-приложения; без неё админка не могла
  // выдать первую manager-лицензию (бутстрап-дыра: /manager/api/licenses
  // требует уже существующий manager-токен).
  const licRole = ['admin', 'operator', 'manager'].includes(role) ? role : 'operator';
  const db = getDb();
  try {
    db.prepare('INSERT INTO licenses (installation_id,challenge,label,role) VALUES (?,?,?,?)').run(
      installation_id.trim(), challenge.trim().toUpperCase(), label || '', licRole
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

// PATCH /admin/api/licenses/:id — edit label and/or role
router.patch('/licenses/:id', (req, res) => {
  const { label, role } = req.body || {};
  if (label === undefined && role === undefined) return res.status(400).json({ error: 'label or role required' });
  const db = getDb();
  if (label !== undefined) {
    db.prepare('UPDATE licenses SET label=? WHERE installation_id=?').run(label.trim(), req.params.id);
  }
  if (role !== undefined) {
    if (!['admin', 'operator', 'manager'].includes(role)) return res.status(400).json({ error: 'role must be admin, operator or manager' });
    db.prepare('UPDATE licenses SET role=? WHERE installation_id=?').run(role, req.params.id);
  }
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
// Security note: tokens are masked to prevent mass token theft
router.get('/licenses/export.csv', (req, res) => {
  const rows = getDb().prepare(
    'SELECT installation_id,label,challenge,token,is_active,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  const header = 'installation_id,label,challenge,token_masked,is_active,created_at,last_seen\n';
  const csv = header + rows.map(r =>
    [
      r.installation_id,
      r.label,
      r.challenge,
      r.token ? `${r.token.slice(0, 8)}...${r.token.slice(-8)}` : '', // Masked token
      r.is_active,
      r.created_at,
      r.last_seen || ''
    ]
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
  const randomBytes = crypto.randomBytes(16);
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[randomBytes[i] % chars.length];
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
  const { label, count = 1, expires_days, max_uses = 1 } = req.body || {};
  const db = getDb();
  const created = [];
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  const maxUses = Math.max(parseInt(max_uses) || 1, 0); // 0 = unlimited

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
      'INSERT INTO invite_codes (code, label, expires_at, max_uses, use_count) VALUES (?,?,?,?,0)'
    ).run(code, label || '', expires_at, maxUses);
    created.push(code);
  }

  res.json({ ok: true, codes: created });
});

// PATCH /admin/api/invites/:code — edit label and/or max_uses
router.patch('/invites/:code', (req, res) => {
  const { label, max_uses } = req.body || {};
  const db = getDb();
  if (label !== undefined) db.prepare('UPDATE invite_codes SET label=? WHERE code=?').run(label || '', req.params.code);
  if (max_uses !== undefined) db.prepare('UPDATE invite_codes SET max_uses=? WHERE code=?').run(Math.max(parseInt(max_uses) || 0, 0), req.params.code);
  res.json({ ok: true });
});

// DELETE /admin/api/invites/:code
router.delete('/invites/:code', (req, res) => {
  getDb().prepare('DELETE FROM invite_codes WHERE code=?').run(req.params.code);
  res.json({ ok: true });
});

// POST /admin/api/invites/:code/reset — reset use counter
router.post('/invites/:code/reset', (req, res) => {
  getDb().prepare('UPDATE invite_codes SET is_used=0, used_at=NULL, use_count=0 WHERE code=?').run(req.params.code);
  res.json({ ok: true });
});

// GET /admin/api/invites/export.csv
router.get('/invites/export.csv', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all();
  const header = 'code,label,use_count,max_uses,is_used,used_at,created_at,expires_at\n';
  const csv = header + rows.map(r =>
    [r.code, r.label, r.use_count ?? 0, r.max_uses ?? 1, r.is_used, r.used_at || '', r.created_at, r.expires_at || '']
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

// PATCH /admin/api/versions/:version
// Тело: { file_type='updater', platform?, is_published?, channel?, rollout_percent? }.
// Без platform правка применяется ко всем ОС этого типа (канал и роллаут —
// свойства релиза целиком, а не одной платформы). channel/rollout_percent
// читает ветка /update?app=manager (MGR-009 staged rollout).
router.patch('/versions/:version', (req, res) => {
  const db = getDb();
  const version = req.params.version;
  const file_type = String(req.body?.file_type || 'updater');
  const platform = req.body?.platform ? String(req.body.platform) : null;

  const sets = [];
  const vals = [];
  if (req.body?.is_published !== undefined) {
    sets.push('is_published = ?');
    vals.push(req.body.is_published ? 1 : 0);
  }
  if (req.body?.channel !== undefined) {
    const ch = String(req.body.channel);
    if (!['stable', 'beta'].includes(ch))
      return res.status(400).json({ error: 'channel: stable|beta' });
    sets.push('channel = ?');
    vals.push(ch);
  }
  if (req.body?.rollout_percent !== undefined) {
    const pct = Number(req.body.rollout_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100)
      return res.status(400).json({ error: 'rollout_percent: 0..100' });
    sets.push('rollout_percent = ?');
    vals.push(Math.round(pct));
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

  const where = platform ? 'version=? AND file_type=? AND platform=?' : 'version=? AND file_type=?';
  const wvals = platform ? [version, file_type, platform] : [version, file_type];
  const changed = db.prepare(`UPDATE release_files SET ${sets.join(', ')} WHERE ${where}`)
    .run(...vals, ...wvals).changes;
  if (!changed) return res.status(404).json({ error: 'not found' });

  // is_published воркерского updater-а зеркалится в versions — /update читает
  // оттуда «последнюю версию». manager-updater в versions не пишется никогда.
  if (file_type === 'updater' && req.body?.is_published !== undefined)
    db.prepare('UPDATE versions SET is_published=? WHERE version=?')
      .run(req.body.is_published ? 1 : 0, version);

  db.prepare('INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('release_patch', JSON.stringify({ version, file_type, platform, set: req.body }));
  res.json({ ok: true, changed });
});

// DELETE /admin/api/versions/:version?file_type=xxx[&platform=yyy] — removes file entries
router.delete('/versions/:version', (req, res) => {
  const db = getDb();
  const file_type = req.query.file_type || 'updater';
  const platform = req.query.platform || null;
  const where = platform ? 'version=? AND file_type=? AND platform=?' : 'version=? AND file_type=?';
  const wvals = platform ? [req.params.version, file_type, platform] : [req.params.version, file_type];
  const rows = db.prepare(`SELECT download_url FROM release_files WHERE ${where}`).all(...wvals);
  if (!rows.length) return res.status(404).json({ error: 'not found' });

  const fs = require('fs');
  const path = require('path');
  const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, '../public/releases');
  for (const row of rows) {
    if (!row.download_url) continue;
    const filename = row.download_url.split('/').pop();
    const filepath = path.join(RELEASES_DIR, filename);
    // Deleting the binary is best-effort: the DB row must be removed either way, so
    // a missing or locked file cannot fail the request. It is still logged, because
    // a leftover file silently consuming disk is an operational problem.
    try {
      fs.unlinkSync(filepath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.warn(`[admin-api] release binary already absent: ${filename}`);
      } else {
        console.error(`[admin-api] failed to delete release binary ${filename} (${e.code}): ${e.message}`);
      }
    }
  }

  db.prepare(`DELETE FROM release_files WHERE ${where}`).run(...wvals);
  // Строку versions трогаем, только когда не осталось updater-артефактов этой
  // версии: при удалении одной ОС из трёх остальные должны продолжать обновляться.
  // manager-updater в versions не пишется, поэтому там чистить нечего.
  if (file_type === 'updater') {
    const left = db.prepare(
      "SELECT COUNT(*) AS n FROM release_files WHERE version=? AND file_type='updater'"
    ).get(req.params.version).n;
    if (left === 0) db.prepare('DELETE FROM versions WHERE version=?').run(req.params.version);
  }
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

// ── Token Rotation ─────────────────────────────────────────────────────────────
// FIX A-MED-06: Add token rotation endpoint for security
router.post('/licenses/:id/rotate-token', (req, res) => {
  try {
    const db = getDb();
    const installationId = req.params.id;

    // Get current license (PK is installation_id TEXT — there is no `id` column)
    const license = db.prepare('SELECT * FROM licenses WHERE installation_id = ?').get(installationId);
    if (!license) {
      return res.status(404).json({ error: 'license_not_found' });
    }

    // Generate new secure token. MGR-008: в БД — только SHA-256 хеш;
    // открытый токен возвращается админу один раз в ответе.
    const newToken = crypto.randomBytes(32).toString('hex');

    // Update token
    db.prepare('UPDATE licenses SET token_hash = ?, token = NULL, token_rotated_at = CURRENT_TIMESTAMP WHERE installation_id = ?')
      .run(hashToken(newToken), installationId);

    // Log rotation
    db.prepare(
      "INSERT INTO audit_log (action, details, created_at) VALUES ('token_rotation', ?, CURRENT_TIMESTAMP)"
    ).run(JSON.stringify({ installation_id: installationId }));

    res.json({
      success: true,
      new_token: newToken,
      message: 'Token rotated successfully. Old token is now invalid.'
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Server config (MGR-008): kill-switch и анти-replay WS ─────────────────────
// kill_switch=1: воркерские каналы (sync/footprint/WS-auth) и раздача
// обновлений отвечают 503; менеджерские каналы и админка продолжают работать.
// ws_require_nonce=1: WS auth обязан эхом возвращать одноразовый nonce из
// auth_challenge (включать после обновления флота воркеров).
const SERVER_CONFIG_KEYS = ['kill_switch', 'ws_require_nonce'];

router.get('/server-config', (req, res) => {
  const out = {};
  for (const k of SERVER_CONFIG_KEYS) out[k] = getServerConfig(k, '0');
  res.json(out);
});

router.post('/server-config', (req, res) => {
  const { key, value } = req.body || {};
  if (!SERVER_CONFIG_KEYS.includes(key)) return res.status(400).json({ error: 'unknown_key' });
  if (value !== '0' && value !== '1') return res.status(400).json({ error: 'invalid_value' });
  setServerConfig(key, value);
  getDb().prepare(
    'INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run('server_config', JSON.stringify({ key, value, by: req.adminUser || 'admin' }));
  res.json({ ok: true, key, value });
});

// FIX A-MED-06 отменён 2026-08-07: эндпоинт `POST /licenses/:id/set-auto-rotate`
// удалён, вместе с ним не удалена только колонка `licenses.auto_rotate`
// (миграция в database.js оставлена, чтобы не ломать существующие БД).
//
// Почему удалён, а не доделан. Флаг писался ровно в одном месте — здесь — и не
// читался НИГДЕ: ни планировщика ротации, ни проверки в requireToken или
// /verify не существует. То есть политика «ротация раз в 90 дней» была заявлена
// в UI-контракте, но не выполнялась.
//
// Дописать планировщик нельзя без изменений на клиенте: клиент сохраняет токен
// при активации (license.rs) и НИКОГДА его не обновляет — обработки смены
// токена там нет вовсе. Включённая серверная авторотация просто разорвала бы
// связь со всеми клиентами на 90-й день, причём молча.
//
// Чтобы вернуть фичу, нужны обе половины: (1) клиент умеет принимать новый
// токен в ответе /verify и перезаписывать license_token, (2) сервер получает
// планировщик. Ручная ротация (`POST /licenses/:id/rotate-token` выше) осталась
// и работает — она осознанно отзывает доступ, что и требуется.

module.exports = router;
