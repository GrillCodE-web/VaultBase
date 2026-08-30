//! REDESIGN-05-5B2: панель воркеров внутри sync-группы.
//!
//! Воркерское приложение показывает команде (группе синхронизации) друг друга:
//! кто онлайн (WS-presence), последний heartbeat, сколько карт выдано/взято
//! (issued_card_slices + card_pool_slices — серверные счётчики) и
//! самопубликованные оперативные агрегаты воркера (заказы/деклайны — E2E
//! контент заказов серверу недоступен, поэтому воркер шлёт агрегаты сам).
//!
//!   воркер  POST /sync/group/stats   — опубликовать свои агрегаты (JSON ≤ 2 КБ)
//!   воркер  GET  /sync/group/workers — агрегированная панель по моей группе

const express = require('express');
const { getDb } = require('../database');
const { requireWorkerToken } = require('../middleware');
const wsTauri = require('../ws-tauri');

const MAX_STATS_BYTES = 2048;
const MAX_STATS_KEYS = 40;

const workerRouter = express.Router();
workerRouter.use(requireWorkerToken);

function myGroupId(db, iid) {
  const row = db.prepare(`
    SELECT group_id FROM sync_group_members
    WHERE installation_id = ? ORDER BY joined_at DESC LIMIT 1
  `).get(iid);
  return row ? row.group_id : null;
}

// POST /sync/group/stats — { stats: { orders_today, decline_rate_week, ... } }.
// Ключи/значения не валидируются по составу (контракт эволюционирует на
// клиентах), ограничения: объект, ≤ MAX_STATS_KEYS ключей, ≤ MAX_STATS_BYTES
// в JSON, без строк длиннее 200 символов.
workerRouter.post('/group/stats', (req, res) => {
  const stats = (req.body || {}).stats;
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return res.status(400).json({ error: 'stats_object_required' });
  }
  const keys = Object.keys(stats);
  if (keys.length > MAX_STATS_KEYS) {
    return res.status(400).json({ error: 'stats_too_many_keys', max: MAX_STATS_KEYS });
  }
  for (const k of keys) {
    const v = stats[k];
    const t = typeof v;
    if (t !== 'number' && t !== 'string' && t !== 'boolean' && v !== null) {
      return res.status(400).json({ error: 'stats_scalar_values_only' });
    }
    if (t === 'string' && v.length > 200) {
      return res.status(400).json({ error: 'stats_value_too_long' });
    }
  }
  const payload = JSON.stringify(stats);
  if (payload.length > MAX_STATS_BYTES) {
    return res.status(400).json({ error: 'stats_too_large', max: MAX_STATS_BYTES });
  }

  const db = getDb();
  const groupId = myGroupId(db, req.installationId);
  if (!groupId) return res.status(409).json({ error: 'no_sync_group' });

  db.prepare(`
    INSERT INTO worker_group_stats (installation_id, group_id, stats_json)
    VALUES (?, ?, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      group_id = excluded.group_id,
      stats_json = excluded.stats_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.installationId, groupId, payload);

  res.json({ ok: true, updated_at: new Date().toISOString() });
});

// GET /sync/group/workers — панель по моей группе. Воркер вне группы получает
// панель из одного себя (group=null).
workerRouter.get('/group/workers', (req, res) => {
  const db = getDb();
  const me = req.installationId;
  const groupId = myGroupId(db, me);

  const group = groupId
    ? db.prepare('SELECT id, name, created_by, created_at FROM sync_groups WHERE id = ?').get(groupId) || null
    : null;

  const memberIds = groupId
    ? db.prepare('SELECT installation_id, joined_at FROM sync_group_members WHERE group_id = ? ORDER BY joined_at ASC').all(groupId)
    : [{ installation_id: me, joined_at: null }];

  const online = new Set(
    (typeof wsTauri.getOnlineInstallations === 'function' ? wsTauri.getOnlineInstallations() : [])
      .map((o) => o.installation_id)
  );

  const licStmt = db.prepare('SELECT label, role, is_active FROM licenses WHERE installation_id = ?');
  const hbStmt = db.prepare('SELECT last_seen FROM worker_heartbeats WHERE installation_id = ?');
  const issuedStmt = db.prepare(`
    SELECT status, COUNT(*) AS n FROM issued_card_slices
    WHERE target_iid = ? GROUP BY status
  `);
  const poolStmt = db.prepare(`
    SELECT status, outcome, COUNT(*) AS n FROM card_pool_slices
    WHERE reserved_by = ? GROUP BY status, outcome
  `);
  const statsStmt = db.prepare(`
    SELECT stats_json, updated_at FROM worker_group_stats WHERE installation_id = ?
  `);

  const workers = memberIds.map((m) => {
    const iid = m.installation_id;
    const lic = licStmt.get(iid) || {};
    const hb = hbStmt.get(iid);
    const cards = {
      issued_pending: 0, issued_delivered: 0, issued_ack: 0,
      pool_reserved: 0, pool_ack: 0, pool_used: 0, pool_burned: 0,
    };
    for (const r of issuedStmt.all(iid)) {
      if (r.status === 'pending') cards.issued_pending = r.n;
      else if (r.status === 'delivered') cards.issued_delivered = r.n;
      else if (r.status === 'ack') cards.issued_ack = r.n;
    }
    for (const r of poolStmt.all(iid)) {
      if (r.status === 'reserved') cards.pool_reserved = r.n;
      else if (r.status === 'ack') {
        cards.pool_ack += r.n;
        if (r.outcome === 'used') cards.pool_used = r.n;
        else if (r.outcome === 'burned') cards.pool_burned = r.n;
      }
    }
    const srow = statsStmt.get(iid);
    let stats = null;
    if (srow) {
      try { stats = JSON.parse(srow.stats_json); } catch { stats = null; }
    }
    return {
      installation_id: iid,
      label: lic.label || null,
      role: lic.role || null,
      is_active: lic.is_active !== undefined ? !!lic.is_active : null,
      is_group_admin: !!(group && group.created_by === iid),
      joined_at: m.joined_at || null,
      online: online.has(iid),
      last_seen: hb ? hb.last_seen : null,
      cards,
      stats,
      stats_updated_at: srow ? srow.updated_at : null,
    };
  });

  res.json({ group, me, workers });
});

module.exports = { workerRouter };
