const express = require('express');
const { getDb } = require('../database');
const { requireManagerToken } = require('../middleware');
const { deriveActivationKey } = require('./activate');

const router = express.Router();
router.use(requireManagerToken);

const NEWS_SEVERITIES = ['info', 'warning', 'critical'];
const NEWS_TARGET_ROLES = ['all', 'admin', 'operator'];
const PRIORITY_TARGET_ROLES = ['operator', 'admin'];

function audit(managerIid, action, details) {
  try {
    getDb().prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run(
      action,
      JSON.stringify({ manager: managerIid, ...details })
    );
  } catch (e) {
    console.error('[manager-api] audit insert failed:', e.message);
  }
}

function notifyWorker(req, iid, message) {
  const wss = req.app.get('wssTauri');
  if (wss) {
    const { sendToInstallation } = require('../ws-tauri');
    sendToInstallation(iid, message);
  }
  const io = req.app.get('io');
  if (io && message.type) io.emit(`manager:${message.type}`, { installation_id: iid });
}

function normalizeIsoToDb(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const t = value.trim().replace('T', ' ').replace('Z', '');
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(t)) return undefined;
  if (t.length === 10) return `${t} 23:59:59`;
  if (t.length === 16) return `${t}:00`;
  return t;
}

function getPolicy(db, iid) {
  const row = db.prepare('SELECT * FROM worker_policies WHERE installation_id = ?').get(iid);
  return row || {
    installation_id: iid,
    banned: 0,
    banned_reason: null,
    ban_until: null,
    permissions_override: null,
    quota_cards_day: null,
    quota_orders_day: null,
    min_version: null,
    version_exempt: 0,
    force_logout: 0,
    wipe: 0,
    updated_by: null,
    updated_at: null,
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

router.get('/overview', (req, res) => {
  const db = getDb();
  const online = db.prepare(`
    SELECT COUNT(*) AS n FROM worker_heartbeats hb
    WHERE hb.last_seen >= datetime('now','-15 minutes')
      AND hb.installation_id IN (SELECT installation_id FROM licenses WHERE is_active=1 AND role != 'manager')
  `).get().n;
  const workers = db.prepare("SELECT COUNT(*) AS n FROM licenses WHERE role != 'manager'").get().n;
  const workersActive = db.prepare("SELECT COUNT(*) AS n FROM licenses WHERE role != 'manager' AND is_active = 1").get().n;
  const managers = db.prepare("SELECT COUNT(*) AS n FROM licenses WHERE role = 'manager' AND is_active = 1").get().n;
  const banned = db.prepare(`
    SELECT COUNT(*) AS n FROM worker_policies
    WHERE banned = 1 AND (ban_until IS NULL OR ban_until > datetime('now'))
      AND installation_id IN (SELECT installation_id FROM licenses WHERE role != 'manager')
  `).get().n;
  const alertsNew = db.prepare("SELECT COUNT(*) AS n FROM manager_alerts WHERE status = 'new'").get().n;
  const alertsOpen = db.prepare("SELECT COUNT(*) AS n FROM manager_alerts WHERE status IN ('new','ack')").get().n;
  const newsPublished = db.prepare('SELECT COUNT(*) AS n FROM manager_news WHERE is_published = 1').get().n;
  const cards = db.prepare('SELECT COUNT(*) AS n FROM sync_cards').get().n;
  const groups = db.prepare('SELECT COUNT(*) AS n FROM sync_groups').get().n;
  const footprints24h = db.prepare("SELECT COUNT(*) AS n FROM footprints WHERE created_at >= datetime('now','-1 day')").get().n;
  const latest = db.prepare('SELECT version FROM versions WHERE is_published = 1 ORDER BY published_at DESC LIMIT 1').get();
  const reports24h = db.prepare("SELECT COUNT(*) AS n FROM stats_reports WHERE received_at >= datetime('now','-1 day')").get().n;
  const managerKeys = db.prepare('SELECT COUNT(*) AS n FROM manager_keys WHERE is_active = 1').get().n;
  res.json({
    workers_total: workers,
    workers_active: workersActive,
    workers_online: online,
    workers_banned: banned,
    managers,
    alerts_new: alertsNew,
    alerts_open: alertsOpen,
    news_published: newsPublished,
    cards_in_groups: cards,
    sync_groups: groups,
    footprints_24h: footprints24h,
    latest_release: latest ? latest.version : null,
    reports_24h: reports24h,
    manager_keys_active: managerKeys,
    server_time: new Date().toISOString(),
  });
});

// ── Workers & policies ────────────────────────────────────────────────────────

router.get('/workers', (req, res) => {
  const rows = getDb().prepare(`
    SELECT l.installation_id, l.label, l.role, l.is_active, l.created_at, l.last_seen,
           hb.last_seen AS hb_last_seen, hb.envelope AS hb_envelope, hb.key_id AS hb_key_id,
           hb.received_at AS hb_received_at,
           p.banned, p.banned_reason, p.ban_until, p.permissions_override,
           p.quota_cards_day, p.quota_orders_day, p.min_version, p.version_exempt, p.force_logout, p.wipe
    FROM licenses l
    LEFT JOIN worker_heartbeats hb ON hb.installation_id = l.installation_id
    LEFT JOIN worker_policies p ON p.installation_id = l.installation_id
    ORDER BY l.created_at DESC
  `).all();
  res.json({ workers: rows, server_time: new Date().toISOString() });
});

router.post('/workers/:iid/policy', (req, res) => {
  const { iid } = req.params;
  const db = getDb();
  const lic = db.prepare('SELECT installation_id, role FROM licenses WHERE installation_id = ?').get(iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (lic.role === 'manager') return res.status(400).json({ error: 'manager_not_policied' });

  const b = req.body || {};
  if (Object.keys(b).length === 0) return res.status(400).json({ error: 'empty_policy' });

  const cur = getPolicy(db, iid);
  const next = {
    banned: cur.banned,
    banned_reason: cur.banned_reason,
    ban_until: cur.ban_until,
    permissions_override: cur.permissions_override,
    quota_cards_day: cur.quota_cards_day,
    quota_orders_day: cur.quota_orders_day,
    min_version: cur.min_version,
    version_exempt: cur.version_exempt,
    force_logout: cur.force_logout,
  };

  if (b.banned !== undefined) {
    if (typeof b.banned !== 'boolean') return res.status(400).json({ error: 'banned_must_be_boolean' });
    next.banned = b.banned ? 1 : 0;
  }
  if (b.banned_reason !== undefined) {
    if (b.banned_reason !== null && typeof b.banned_reason !== 'string') return res.status(400).json({ error: 'banned_reason_invalid' });
    next.banned_reason = b.banned_reason ? b.banned_reason.slice(0, 500) : null;
  }
  if (b.ban_until !== undefined) {
    const norm = normalizeIsoToDb(b.ban_until);
    if (norm === undefined) return res.status(400).json({ error: 'ban_until_invalid' });
    next.ban_until = norm;
  }
  if (b.permissions_override !== undefined) {
    if (b.permissions_override === null) {
      next.permissions_override = null;
    } else {
      if (typeof b.permissions_override !== 'object' || Array.isArray(b.permissions_override)) {
        return res.status(400).json({ error: 'permissions_override_invalid' });
      }
      const keys = Object.keys(b.permissions_override);
      if (keys.length > 64) return res.status(400).json({ error: 'too_many_permission_keys' });
      for (const k of keys) {
        if (k.length === 0 || k.length > 64) return res.status(400).json({ error: 'invalid_permission_key' });
        if (typeof b.permissions_override[k] !== 'boolean') return res.status(400).json({ error: 'permission_values_must_be_boolean' });
      }
      next.permissions_override = JSON.stringify(b.permissions_override);
    }
  }
  for (const f of ['quota_cards_day', 'quota_orders_day']) {
    if (b[f] !== undefined) {
      if (b[f] === null) {
        next[f] = null;
      } else {
        const n = Number(b[f]);
        if (!Number.isInteger(n) || n < 0 || n > 100000) return res.status(400).json({ error: `${f}_invalid` });
        next[f] = n;
      }
    }
  }
  if (b.min_version !== undefined) {
    if (b.min_version === null || b.min_version === '') {
      next.min_version = null;
    } else {
      if (!/^\d+\.\d+\.\d+$/.test(String(b.min_version))) return res.status(400).json({ error: 'min_version_invalid' });
      next.min_version = String(b.min_version);
    }
  }
  if (b.version_exempt !== undefined) {
    if (typeof b.version_exempt !== 'boolean') return res.status(400).json({ error: 'version_exempt_must_be_boolean' });
    next.version_exempt = b.version_exempt ? 1 : 0;
  }
  if (b.force_logout !== undefined) {
    if (typeof b.force_logout !== 'boolean') return res.status(400).json({ error: 'force_logout_must_be_boolean' });
    next.force_logout = b.force_logout ? 1 : 0;
  }

  db.prepare(`
    INSERT INTO worker_policies (installation_id, banned, banned_reason, ban_until,
      permissions_override, quota_cards_day, quota_orders_day, min_version,
      version_exempt, force_logout, updated_by, updated_at)
    VALUES (@iid, @banned, @banned_reason, @ban_until, @permissions_override,
      @quota_cards_day, @quota_orders_day, @min_version, @version_exempt,
      @force_logout, @updated_by, CURRENT_TIMESTAMP)
    ON CONFLICT(installation_id) DO UPDATE SET
      banned = excluded.banned,
      banned_reason = excluded.banned_reason,
      ban_until = excluded.ban_until,
      permissions_override = excluded.permissions_override,
      quota_cards_day = excluded.quota_cards_day,
      quota_orders_day = excluded.quota_orders_day,
      min_version = excluded.min_version,
      version_exempt = excluded.version_exempt,
      force_logout = excluded.force_logout,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).run({ iid, updated_by: req.installationId, ...next });

  audit(req.installationId, 'manager_policy_set', { installation_id: iid, policy: next });
  notifyWorker(req, iid, { type: 'policy_update' });
  res.json({ ok: true, policy: getPolicy(db, iid) });
});

router.post('/workers/:iid/force-logout', (req, res) => {
  const db = getDb();
  const lic = db.prepare('SELECT installation_id FROM licenses WHERE installation_id = ?').get(req.params.iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  db.prepare(`
    INSERT INTO worker_policies (installation_id, force_logout, updated_by)
    VALUES (?, 1, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      force_logout = 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).run(req.params.iid, req.installationId);
  audit(req.installationId, 'manager_force_logout', { installation_id: req.params.iid });
  notifyWorker(req, req.params.iid, { type: 'policy_update' });
  res.json({ ok: true });
});

// MGR-013: удалённый wipe воркера. Флаг уезжает в политику на следующем
// heartbeat; воркер подтверждает (wipe_ack) и стирает локальную БД.
// Отменить после ack нельзя — wipe уже выполнен. Требует confirm:true.
router.post('/workers/:iid/wipe', (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm_required' });
  const db = getDb();
  const lic = db.prepare('SELECT installation_id, role FROM licenses WHERE installation_id = ?').get(req.params.iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (lic.role === 'manager') return res.status(400).json({ error: 'manager_not_policied' });
  db.prepare(`
    INSERT INTO worker_policies (installation_id, wipe, updated_by)
    VALUES (?, 1, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      wipe = 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).run(req.params.iid, req.installationId);
  audit(req.installationId, 'manager_remote_wipe', { installation_id: req.params.iid });
  notifyWorker(req, req.params.iid, { type: 'policy_update' });
  res.json({ ok: true, policy: getPolicy(db, req.params.iid) });
});

// ── News ──────────────────────────────────────────────────────────────────────

router.get('/news', (req, res) => {
  const rows = getDb().prepare(`
    SELECT n.*, (SELECT COUNT(*) FROM news_reads r WHERE r.news_id = n.id) AS read_count
    FROM manager_news n
    ORDER BY n.created_at DESC
    LIMIT 200
  `).all();
  res.json({ news: rows });
});

function validateNewsPayload(req, res, partial) {
  const b = req.body || {};
  const out = {};
  if (b.severity !== undefined || !partial) {
    const sev = b.severity === undefined ? 'info' : b.severity;
    if (!NEWS_SEVERITIES.includes(sev)) return res.status(400).json({ error: 'severity_invalid' });
    out.severity = sev;
  }
  if (b.title !== undefined || !partial) {
    if (typeof b.title !== 'string' || b.title.trim().length === 0) return res.status(400).json({ error: 'title_required' });
    out.title = b.title.trim().slice(0, 200);
  }
  if (b.body !== undefined || !partial) {
    const bodyVal = b.body === undefined ? '' : b.body;
    if (typeof bodyVal !== 'string') return res.status(400).json({ error: 'body_invalid' });
    out.body = bodyVal.slice(0, 8000);
  }
  if (b.target_role !== undefined || !partial) {
    const tr = b.target_role === undefined ? 'all' : b.target_role;
    if (!NEWS_TARGET_ROLES.includes(tr)) return res.status(400).json({ error: 'target_role_invalid' });
    out.target_role = tr;
  }
  if (b.target_iid !== undefined || !partial) {
    const v = b.target_iid;
    if (v === null || v === undefined || v === '') {
      out.target_iid = null;
    } else {
      if (typeof v !== 'string' || v.length > 64) return res.status(400).json({ error: 'target_iid_invalid' });
      if (!getDb().prepare('SELECT 1 FROM licenses WHERE installation_id = ?').get(v)) return res.status(404).json({ error: 'unknown_target_iid' });
      out.target_iid = v;
    }
  }
  if (b.expires_at !== undefined || !partial) {
    const norm = normalizeIsoToDb(b.expires_at);
    if (norm === undefined) return res.status(400).json({ error: 'expires_at_invalid' });
    out.expires_at = norm;
  }
  return out;
}

router.post('/news', (req, res) => {
  const payload = validateNewsPayload(req, res, false);
  if (res.headersSent) return;
  const r = getDb().prepare(`
    INSERT INTO manager_news (severity, title, body, target_role, target_iid, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(payload.severity, payload.title, payload.body, payload.target_role, payload.target_iid, req.installationId);
  audit(req.installationId, 'manager_news_create', { news_id: Number(r.lastInsertRowid) });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.patch('/news/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM manager_news WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const payload = validateNewsPayload(req, res, true);
  if (res.headersSent) return;
  if (!payload || Object.keys(payload).length === 0) return res.status(400).json({ error: 'nothing_to_update' });
  const sets = Object.keys(payload).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE manager_news SET ${sets} WHERE id = ?`).run(...Object.values(payload), req.params.id);
  audit(req.installationId, 'manager_news_edit', { news_id: Number(req.params.id), fields: Object.keys(payload) });
  res.json({ ok: true });
});

router.delete('/news/:id', (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM manager_news WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM news_reads WHERE news_id = ?').run(req.params.id);
  audit(req.installationId, 'manager_news_delete', { news_id: Number(req.params.id) });
  res.json({ ok: true });
});

router.post('/news/:id/publish', (req, res) => {
  const db = getDb();
  const news = db.prepare('SELECT * FROM manager_news WHERE id = ?').get(req.params.id);
  if (!news) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE manager_news SET is_published = 1, published_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  audit(req.installationId, 'manager_news_publish', { news_id: Number(req.params.id) });

  const message = {
    type: 'news',
    news: {
      id: news.id,
      severity: news.severity,
      title: news.title,
      published_at: new Date().toISOString(),
    },
  };
  const wss = req.app.get('wssTauri');
  if (wss) {
    const { broadcastAll } = require('../ws-tauri');
    broadcastAll(wss, message);
  }
  const io = req.app.get('io');
  if (io) io.emit('manager:news', message.news);
  res.json({ ok: true });
});

router.post('/news/:id/unpublish', (req, res) => {
  const db = getDb();
  const info = db.prepare('UPDATE manager_news SET is_published = 0 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  audit(req.installationId, 'manager_news_unpublish', { news_id: Number(req.params.id) });
  res.json({ ok: true });
});

router.get('/news/:id/readers', (req, res) => {
  const db = getDb();
  const news = db.prepare('SELECT * FROM manager_news WHERE id = ?').get(req.params.id);
  if (!news) return res.status(404).json({ error: 'not_found' });
  const readers = db.prepare(`
    SELECT r.installation_id, r.read_at, l.label, l.role
    FROM news_reads r
    LEFT JOIN licenses l ON l.installation_id = r.installation_id
    WHERE r.news_id = ?
    ORDER BY r.read_at DESC
  `).all(req.params.id);
  const audienceRows = db.prepare(`
    SELECT installation_id FROM licenses
    WHERE is_active = 1 AND role != 'manager'
      AND role = COALESCE(NULLIF(?, 'all'), role)
      AND installation_id = COALESCE(?, installation_id)
  `).all(news.target_role, news.target_iid);
  res.json({
    audience_count: audienceRows.length,
    read_count: readers.length,
    readers,
  });
});

// ── Alerts ────────────────────────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  const status = ['new', 'ack', 'closed'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM manager_alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM manager_alerts ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ alerts: rows });
});

router.post('/alerts/:id/ack', (req, res) => {
  const info = getDb().prepare(`
    UPDATE manager_alerts SET status = 'ack', acked_by = ?, acked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'new'
  `).run(req.installationId, req.params.id);
  if (info.changes === 0) return res.status(409).json({ error: 'not_new' });
  audit(req.installationId, 'manager_alert_ack', { alert_id: Number(req.params.id) });
  res.json({ ok: true });
});

router.post('/alerts/:id/close', (req, res) => {
  const info = getDb().prepare(`
    UPDATE manager_alerts SET status = 'closed', closed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('new','ack')
  `).run(req.params.id);
  if (info.changes === 0) return res.status(409).json({ error: 'not_open' });
  audit(req.installationId, 'manager_alert_close', { alert_id: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Shop priorities ───────────────────────────────────────────────────────────

router.get('/priorities', (req, res) => {
  const rows = getDb().prepare(`
    SELECT sp.*, l.label AS target_label
    FROM shop_priorities sp
    LEFT JOIN licenses l ON sp.target = 'iid:' || l.installation_id
    ORDER BY sp.weight DESC, sp.shop_domain ASC
  `).all();
  res.json({ priorities: rows });
});

function validatePriorityPayload(req, res, partial) {
  const b = req.body || {};
  const out = {};
  if (b.shop_domain !== undefined || !partial) {
    if (typeof b.shop_domain !== 'string' || b.shop_domain.trim().length === 0 || b.shop_domain.length > 190) {
      return res.status(400).json({ error: 'shop_domain_invalid' });
    }
    out.shop_domain = b.shop_domain.trim().toLowerCase();
  }
  if (b.target !== undefined || !partial) {
    const t = b.target === undefined || b.target === null || b.target === '' ? '' : String(b.target);
    if (t === '') {
      out.target = '';
    } else if (t.startsWith('iid:')) {
      const iid = t.slice(4);
      if (!getDb().prepare('SELECT 1 FROM licenses WHERE installation_id = ?').get(iid)) {
        return res.status(404).json({ error: 'unknown_target_iid' });
      }
      out.target = `iid:${iid}`;
    } else if (PRIORITY_TARGET_ROLES.includes(t.replace('role:', '')) && t.startsWith('role:')) {
      out.target = t;
    } else {
      return res.status(400).json({ error: 'target_invalid' });
    }
  }
  if (b.weight !== undefined || !partial) {
    const w = Number(b.weight);
    if (!Number.isInteger(w) || w < 1 || w > 10) return res.status(400).json({ error: 'weight_must_be_1_to_10' });
    out.weight = w;
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== 'string') return res.status(400).json({ error: 'notes_invalid' });
    out.notes = b.notes.slice(0, 500);
  }
  return out;
}

router.post('/priorities', (req, res) => {
  const payload = validatePriorityPayload(req, res, false);
  if (res.headersSent) return;
  const db = getDb();
  try {
    const r = db.prepare(`
      INSERT INTO shop_priorities (shop_domain, target, weight, notes, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(payload.shop_domain, payload.target, payload.weight, payload.notes || '', req.installationId);
    audit(req.installationId, 'manager_priority_create', { id: Number(r.lastInsertRowid) });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'already_exists' });
    throw e;
  }
});

router.patch('/priorities/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM shop_priorities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const payload = validatePriorityPayload(req, res, true);
  if (res.headersSent) return;
  if (!payload || Object.keys(payload).length === 0) return res.status(400).json({ error: 'nothing_to_update' });
  const sets = Object.keys(payload).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE shop_priorities SET ${sets}, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(payload), req.installationId, req.params.id);
  audit(req.installationId, 'manager_priority_edit', { id: Number(req.params.id), fields: Object.keys(payload) });
  res.json({ ok: true });
});

router.delete('/priorities/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM shop_priorities WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found' });
  audit(req.installationId, 'manager_priority_delete', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ── Worker keys (MGR-016: X25519-пубключи для запечатывания срезов карт) ─────

// GET /workers/keys — активные публичключи воркеров. Менеджер запечатывает
// срез карт именно этим ключом; выдача через POST /cards/issue (worker-cards).
router.get('/workers/keys', (req, res) => {
  const rows = getDb().prepare(`
    SELECT k.id, k.installation_id, k.pubkey, k.key_type, k.label, k.created_at,
           l.label AS worker_label
    FROM worker_keys k
    LEFT JOIN licenses l ON l.installation_id = k.installation_id
    WHERE k.is_active = 1
    ORDER BY k.id DESC
  `).all();
  res.json({ keys: rows });
});

// ── Manager keys (E2E sealed envelopes) ───────────────────────────────────────

router.get('/keys', (req, res) => {
  const rows = getDb().prepare(`
    SELECT id, pubkey, key_type, label, is_active, created_at, revoked_at
    FROM manager_keys WHERE installation_id = ? ORDER BY id DESC
  `).all(req.installationId);
  res.json({ keys: rows });
});

router.post('/keys', (req, res) => {
  const { pubkey, label } = req.body || {};
  if (typeof pubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: 'pubkey_must_be_64_hex_chars' });
  }
  const db = getDb();
  const keyId = db.transaction(() => {
    db.prepare(`
      UPDATE manager_keys SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
      WHERE installation_id = ? AND is_active = 1
    `).run(req.installationId);
    const r = db.prepare('INSERT INTO manager_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
      .run(req.installationId, pubkey.toLowerCase(), typeof label === 'string' ? label.slice(0, 100) : '');
    return Number(r.lastInsertRowid);
  })();
  audit(req.installationId, 'manager_key_upload', { key_id: keyId });
  res.status(201).json({ id: keyId });
});

// ── Encrypted reports (ciphertext passthrough) ────────────────────────────────

router.get('/reports', (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const kind = ['daily_stats', 'activity_tail'].includes(req.query.kind || '') ? req.query.kind : null;
  let sql = `
    SELECT r.installation_id, r.kind, r.report_date, r.key_id, r.envelopes, r.received_at, l.label
    FROM stats_reports r
    LEFT JOIN licenses l ON l.installation_id = r.installation_id
  `;
  const where = [];
  const params = [];
  if (from) { where.push('r.report_date >= ?'); params.push(from); }
  if (to) { where.push('r.report_date <= ?'); params.push(to); }
  if (kind) { where.push('r.kind = ?'); params.push(kind); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY r.report_date DESC, r.installation_id ASC LIMIT 2000';
  res.json({ reports: getDb().prepare(sql).all(...params) });
});

// ── Groups & releases (read-only views) ───────────────────────────────────────

router.get('/groups', (req, res) => {
  const rows = getDb().prepare(`
    SELECT g.id, g.name, g.created_at,
      (SELECT COUNT(*) FROM sync_group_members m WHERE m.group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM sync_cards c WHERE c.group_id = g.id) AS card_count
    FROM sync_groups g
    ORDER BY g.created_at DESC
  `).all();
  res.json({ groups: rows });
});

router.get('/releases', (req, res) => {
  const rows = getDb().prepare(`
    SELECT version, file_type, platform, download_url, file_size, notes, is_published, published_at,
           channel, rollout_percent
    FROM release_files
    ORDER BY published_at DESC, version DESC
    LIMIT 200
  `).all();
  res.json({ releases: rows });
});

// MGR-009: staged rollout manager-релизов — канал (stable|beta) и процент
// флота. Менять можно только file_type=manager-updater: воркерские релизы
// управляются через админку сервера.
router.patch('/releases/:version', (req, res) => {
  const db = getDb();
  const version = req.params.version;
  const file_type = req.query.file_type || 'manager-updater';
  if (file_type !== 'manager-updater') {
    return res.status(400).json({ error: 'only manager-updater releases are manageable here' });
  }
  const row = db
    .prepare('SELECT version, channel, rollout_percent FROM release_files WHERE version = ? AND file_type = ?')
    .get(version, file_type);
  if (!row) return res.status(404).json({ error: 'release not found' });

  const { channel, rollout_percent } = req.body || {};
  let nextChannel = row.channel;
  let nextPct = row.rollout_percent;
  if (channel !== undefined) {
    if (!['stable', 'beta'].includes(channel)) {
      return res.status(400).json({ error: 'channel must be stable or beta' });
    }
    nextChannel = channel;
  }
  if (rollout_percent !== undefined) {
    const pct = Number(rollout_percent);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'rollout_percent must be an integer 0..100' });
    }
    nextPct = pct;
  }

  db.prepare('UPDATE release_files SET channel = ?, rollout_percent = ? WHERE version = ? AND file_type = ?')
    .run(nextChannel, nextPct, version, file_type);
  audit(req.managerIid, 'manager_release_rollout', `${file_type}:${version} channel=${nextChannel} pct=${nextPct}`);
  res.json({ ok: true, version, file_type, channel: nextChannel, rollout_percent: nextPct });
});

// ── Licenses (MGR-010: CRUD лицензий из manager-app) ──────────────────────────
// Открытых токенов здесь нет и не будет (MGR-008): выдача — только один раз на
// /activate, список показывает лишь факт выдачи и маскированный префикс хеша.
// Создание админ-лицензий и rotate-token намеренно остаются только в админке.

const LICENSE_ROLES = ['operator', 'manager'];

router.get('/licenses', (req, res) => {
  const rows = getDb().prepare(`
    SELECT l.installation_id, l.label, l.role, l.is_active, l.created_at, l.last_seen,
           (l.token_hash IS NOT NULL) AS token_issued,
           substr(l.token_hash, 1, 8) AS token_prefix,
           p.banned, p.banned_reason
    FROM licenses l
    LEFT JOIN worker_policies p ON p.installation_id = l.installation_id
    ORDER BY l.created_at DESC
  `).all();
  res.json({ licenses: rows });
});

router.post('/licenses', (req, res) => {
  const { installation_id, challenge, label, role } = req.body || {};
  if (typeof installation_id !== 'string' || typeof challenge !== 'string') {
    return res.status(400).json({ error: 'installation_id_and_challenge_required' });
  }
  const iid = installation_id.trim();
  const ch = challenge.trim().toUpperCase();
  if (iid.length < 4 || iid.length > 128 || !/^[\w-]+$/.test(iid)) {
    return res.status(400).json({ error: 'installation_id_invalid' });
  }
  if (ch.length < 4 || ch.length > 128 || !/^[0-9A-F]+$/.test(ch)) {
    return res.status(400).json({ error: 'challenge_invalid' });
  }
  const licRole = role === undefined ? 'operator' : role;
  if (!LICENSE_ROLES.includes(licRole)) {
    return res.status(400).json({ error: 'role_must_be_operator_or_manager' });
  }
  const lbl = typeof label === 'string' ? label.slice(0, 200) : '';
  const db = getDb();
  try {
    db.prepare('INSERT INTO licenses (installation_id, challenge, label, role) VALUES (?,?,?,?)')
      .run(iid, ch, lbl, licRole);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'installation_id_already_exists' });
    throw e;
  }
  const activation_key = deriveActivationKey(iid, ch);
  audit(req.installationId, 'manager_license_create', { installation_id: iid, role: licRole, label: lbl });
  res.status(201).json({ ok: true, installation_id: iid, role: licRole, activation_key });
});

router.patch('/licenses/:iid', (req, res) => {
  const { label, role } = req.body || {};
  if (label === undefined && role === undefined) return res.status(400).json({ error: 'label_or_role_required' });
  const db = getDb();
  const lic = db.prepare('SELECT installation_id, role FROM licenses WHERE installation_id = ?').get(req.params.iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (role !== undefined) {
    if (req.params.iid === req.installationId) return res.status(400).json({ error: 'cannot_change_own_role' });
    if (!LICENSE_ROLES.includes(role)) return res.status(400).json({ error: 'role_must_be_operator_or_manager' });
    if (lic.role === 'admin') return res.status(400).json({ error: 'admin_role_managed_in_admin_panel' });
    db.prepare('UPDATE licenses SET role = ? WHERE installation_id = ?').run(role, req.params.iid);
  }
  if (label !== undefined) {
    if (typeof label !== 'string' || label.length > 200) return res.status(400).json({ error: 'label_invalid' });
    db.prepare('UPDATE licenses SET label = ? WHERE installation_id = ?').run(label.trim(), req.params.iid);
  }
  audit(req.installationId, 'manager_license_update', { installation_id: req.params.iid, label, role });
  res.json({ ok: true });
});

router.post('/licenses/:iid/revoke', (req, res) => {
  if (req.params.iid === req.installationId) return res.status(400).json({ error: 'cannot_revoke_self' });
  const db = getDb();
  const r = db.prepare('UPDATE licenses SET is_active = 0 WHERE installation_id = ?').run(req.params.iid);
  if (r.changes === 0) return res.status(404).json({ error: 'unknown_installation' });
  audit(req.installationId, 'manager_license_revoke', { installation_id: req.params.iid });
  res.json({ ok: true });
});

router.post('/licenses/:iid/restore', (req, res) => {
  const db = getDb();
  const r = db.prepare('UPDATE licenses SET is_active = 1 WHERE installation_id = ?').run(req.params.iid);
  if (r.changes === 0) return res.status(404).json({ error: 'unknown_installation' });
  audit(req.installationId, 'manager_license_restore', { installation_id: req.params.iid });
  res.json({ ok: true });
});

module.exports = router;
