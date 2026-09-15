const express = require('express');
const crypto = require('crypto');
const { getDb, hashToken, getServerConfig, setServerConfig } = require('../database');
const { requireAdmin } = require('../middleware');
const { deriveActivationKey, normalizeChallenge } = require('./activate');
const cache = require('../cache');

const router = express.Router();
router.use(requireAdmin);

// ── Health (SPA status-dot) ───────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() });
});

// ── Audit log ─────────────────────────────────────────────────────────────────
router.get('/audit', (req, res) => {
  const rows = getDb().prepare(
    'SELECT action, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT 500'
  ).all();
  res.json({ audit: rows });
});

// ── CSV export (SPA links /api/export?type=licenses|invites) ─────────────────
router.get('/export', (req, res) => {
  const type = req.query.type;
  if (type === 'licenses') return res.redirect('licenses/export.csv');
  if (type === 'invites') return res.redirect('invites/export.csv');
  res.status(400).json({ error: 'unknown_type' });
});

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
// 7rn: реализация вынесена в ./admin-api-licenses.js (разбивка большого
// роутера). Маршруты, пути и ответы идентичны прежним — см. register().
require('./admin-api-licenses').register(router);

// ── Invite Codes ──────────────────────────────────────────────────────────────
// 7rn: реализация вынесена в ./admin-api-invites.js (разбивка большого роутера).
// Маршруты, пути и ответы идентичны прежним — см. register().
require('./admin-api-invites').register(router);

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
  const { domain, view } = req.query;
  if (view === 'domains') {
    const rows = db.prepare(`
      SELECT shop_domain AS domain, COUNT(*) AS count, MAX(created_at) AS last_at
      FROM footprints GROUP BY shop_domain ORDER BY last_at DESC LIMIT 500
    `).all();
    return res.json(rows);
  }
  const rows = domain
    ? db.prepare('SELECT * FROM footprints WHERE shop_domain LIKE ? ORDER BY created_at DESC LIMIT 2000').all(`%${domain}%`)
    : db.prepare('SELECT * FROM footprints ORDER BY created_at DESC LIMIT 2000').all();
  res.json(rows.map(r => ({ ...r, domain: r.shop_domain, hash: r.hash_value })));
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
    action: 'footprint_saved',
    description: `Saved ${r.cnt} footprint(s) for ${r.shop_domain}`,
    details: `Saved ${r.cnt} footprint(s) for ${r.shop_domain}`,
    installation_id: null,
    user_token: r.user_token, created_at: r.created_at,
  }));

  db.prepare(`
    SELECT installation_id, label, token, last_seen AS created_at FROM licenses
    WHERE token IS NOT NULL AND last_seen IS NOT NULL
    ORDER BY last_seen DESC LIMIT 40
  `).all().forEach(r => rows.push({
    event_type: 'verify',
    action: 'verify',
    description: `License verified: ${r.label || r.installation_id.slice(0,20)}`,
    details: `License verified: ${r.label || r.installation_id.slice(0,20)}`,
    installation_id: r.installation_id,
    user_token: r.token, created_at: r.created_at,
  }));

  // Invite usage
  db.prepare(`
    SELECT code, label, used_at AS created_at FROM invite_codes
    WHERE is_used=1 AND used_at IS NOT NULL
    ORDER BY used_at DESC LIMIT 40
  `).all().forEach(r => rows.push({
    event_type: 'invite_used',
    action: 'invite_used',
    description: `Invite used${r.label ? ': ' + r.label : ''} — ${r.code}`,
    details: `Invite used${r.label ? ': ' + r.label : ''} — ${r.code}`,
    installation_id: null,
    user_token: null, created_at: r.created_at,
  }));

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const filtered = type === 'all' ? rows : rows.filter(r => r.event_type.includes(type));
  res.json({ activity: filtered.slice(0, 100) });
});

// ── Sync Groups ────────────────────────────────────────────────────────────────
// 7rn: реализация вынесена в ./admin-api-sync-groups.js (разбивка большого
// роутера). Маршруты и поведение идентичны прежним — см. register().
require('./admin-api-sync-groups').register(router);

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
// Числовые ключи (не тоглы 0/1): TTL офлайн-пермита в часах (0 = офлайн запрещён),
// период авто-ротации лицензионных токенов в днях.
const SERVER_CONFIG_NUMERIC_KEYS = ['offline_ttl_hours', 'token_rotate_days'];

const serverConfigGet = (req, res) => {
  const out = {};
  for (const k of SERVER_CONFIG_KEYS) out[k] = getServerConfig(k, '0');
  out.offline_ttl_hours = getServerConfig('offline_ttl_hours', '72');
  out.token_rotate_days = getServerConfig('token_rotate_days', '30');
  res.json(out);
};

router.get('/server-config', serverConfigGet);
router.get('/config', serverConfigGet);

const serverConfigSet = (req, res) => {
  const { key, value } = req.body || {};
  if (SERVER_CONFIG_NUMERIC_KEYS.includes(key)) {
    if (!/^\d{1,5}$/.test(String(value))) return res.status(400).json({ error: 'invalid_value' });
    setServerConfig(key, String(value));
    getDb().prepare(
      'INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run('server_config', JSON.stringify({ key, value: String(value), by: req.adminUser || 'admin' }));
    return res.json({ ok: true, key, value: String(value) });
  }
  if (!SERVER_CONFIG_KEYS.includes(key)) return res.status(400).json({ error: 'unknown_key' });
  if (value !== '0' && value !== '1') return res.status(400).json({ error: 'invalid_value' });
  setServerConfig(key, value);
  getDb().prepare(
    'INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run('server_config', JSON.stringify({ key, value, by: req.adminUser || 'admin' }));
  res.json({ ok: true, key, value });
};

router.post('/server-config', serverConfigSet);
router.post('/config', serverConfigSet);

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
