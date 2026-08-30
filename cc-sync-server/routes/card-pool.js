//! REDESIGN-05-5B1: пул карт с самообслуживанием (бронирование).
//!
//! Дополняет адресную выдачу (worker-cards.js): менеджер заливает срезы
//! в общий пул, зашифровав их симметричным ключом пула (AES-256-GCM), а сам
//! ключ раздаёт воркерам запечатанным их X25519-пубключами
//! (card_pool_key_shares — тот же sealed-box контракт, что у срезов).
//! Воркер сам бронирует карты из пула:
//!
//!   менеджер  POST /manager/api/cards/pool/keys            → создать ключ пула + раздать shares
//!   менеджер  GET  /manager/api/cards/pool/keys            → ключи и кому розданы
//!   менеджер  POST /manager/api/cards/pool/keys/:id/shares → дораздать ключ новому воркеру
//!   менеджер  POST /manager/api/cards/pool/upload          → залить срезы в пул
//!   менеджер  GET  /manager/api/cards/pool                 → кто что взял, когда, статус
//!   менеджер  POST /manager/api/cards/pool/revoke          → изъять срезы из пула
//!   менеджер  POST /manager/api/cards/pool/return          → принудительно вернуть бронь в пул
//!   воркер    GET  /sync/cards/pool/key                    → мой запечатанный ключ активного пула
//!   воркер    GET  /sync/cards/pool                        → доступно N + мои брони
//!   воркер    POST /sync/cards/pool/reserve                → забронировать N карт
//!   воркер    POST /sync/cards/pool/ack                    → подтвердить импорт
//!   воркер    POST /sync/cards/pool/release                → вернуть неиспользованную бронь
//!   воркер    POST /sync/cards/pool/outcome                → отчёт used/burned по взятым картам
//!
//! Бронь без ack сгорает по TTL (CARD_POOL_RESERVE_TTL_HOURS, дефолт 24) и
//! возвращается в пул — «возврат в пул при сгорании». Сервер хранит только
//! шифротекст: ни срезы, ни ключ пула в открытом виде ему недоступны.

const express = require('express');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_POOL_UPLOAD = 100;
const MAX_RESERVE_PER_CALL = 50;
const MAX_SEALED_LEN = 16 * 1024;
const MAX_CARD_HASH_LEN = 128;
const POOL_STATUSES = ['pooled', 'reserved', 'ack', 'revoked'];
const POOL_OUTCOMES = ['used', 'burned'];

const managerRouter = express.Router();
managerRouter.use(requireManagerToken);

const workerRouter = express.Router();
workerRouter.use(requireWorkerToken);

function reserveTtlHours() {
  const n = parseInt(process.env.CARD_POOL_RESERVE_TTL_HOURS || '24', 10);
  return Number.isInteger(n) && n >= 1 ? n : 24;
}

function audit(action, details) {
  try {
    getDb().prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run(
      action,
      JSON.stringify(details)
    );
  } catch (e) {
    console.error('[card-pool] audit insert failed:', e.message);
  }
}

// Событие для менеджерского UI: что-то в пуле изменилось (заливка, бронь,
// возврат). Полезной нагрузки нет — фронт сам перезапрашивает список.
function notifyPoolChange(req, reason) {
  const io = req.app.get('io');
  if (io) io.emit('manager:pool_update', { reason });
}

// Возврат сгоревших броней в пул. Зовётся лениво из reserve/листингов —
// отдельного таймера не надо: пул трогают только через эти точки.
function sweepExpiredReservations(db) {
  return db.prepare(`
    UPDATE card_pool_slices
    SET status = 'pooled', reserved_by = NULL, reserved_at = NULL
    WHERE status = 'reserved'
      AND reserved_at < datetime('now', ?)
  `).run(`-${reserveTtlHours()} hours`).changes;
}

function sanitizeSlices(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POOL_UPLOAD) return null;
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.card_hash !== 'string' || s.card_hash.length < 8 || s.card_hash.length > MAX_CARD_HASH_LEN) return null;
    if (typeof s.sealed_data !== 'string' || s.sealed_data.length < 16 || s.sealed_data.length > MAX_SEALED_LEN) return null;
    out.push({ card_hash: s.card_hash, sealed_data: s.sealed_data });
  }
  return out;
}

function sanitizeShares(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.installation_id !== 'string' || !s.installation_id) return null;
    if (typeof s.sealed_key !== 'string' || s.sealed_key.length < 16 || s.sealed_key.length > MAX_SEALED_LEN) return null;
    out.push({ installation_id: s.installation_id, sealed_key: s.sealed_key });
  }
  return out;
}

function parseIds(raw, max) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max
      || !raw.every((n) => Number.isInteger(n) && n > 0)) return null;
  return raw;
}

// ── Manager: ключи пула ──────────────────────────────────────────────────────

// POST /manager/api/cards/pool/keys — создать ключ пула и раздать shares
// воркерам. Новый ключ становится активным, прежний активный ротируется
// (is_active=0). Ротация НЕ перешифровывает лежащие в пуле срезы — они
// остаются под старым ключом, shares которого у воркеров уже есть; новые
// заливки идут под новым. Тело: { label?, shares: [{installation_id, sealed_key}] }.
managerRouter.post('/cards/pool/keys', (req, res) => {
  const body = req.body || {};
  const shares = sanitizeShares(body.shares);
  if (!shares) return res.status(400).json({ error: 'shares_invalid' });

  const db = getDb();
  const licStmt = db.prepare('SELECT role FROM licenses WHERE installation_id = ?');
  for (const s of shares) {
    const lic = licStmt.get(s.installation_id);
    if (!lic) return res.status(404).json({ error: 'unknown_installation', installation_id: s.installation_id });
    if (lic.role === 'manager') return res.status(400).json({ error: 'manager_is_not_a_card_recipient' });
  }

  const keyId = db.transaction(() => {
    db.prepare('UPDATE card_pool_keys SET is_active = 0, rotated_at = CURRENT_TIMESTAMP WHERE is_active = 1').run();
    const r = db.prepare('INSERT INTO card_pool_keys (label, created_by) VALUES (?, ?)')
      .run(typeof body.label === 'string' ? body.label.slice(0, 100) : '', req.installationId);
    const id = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO card_pool_key_shares (key_id, installation_id, sealed_key) VALUES (?, ?, ?)');
    for (const s of shares) ins.run(id, s.installation_id, s.sealed_key);
    return id;
  })();

  audit('pool_key_create', { manager: req.installationId, key_id: keyId, shares: shares.length });
  res.status(201).json({ ok: true, key_id: keyId });
});

// GET /manager/api/cards/pool/keys — список ключей и их получателей.
managerRouter.get('/cards/pool/keys', (req, res) => {
  const db = getDb();
  const keys = db.prepare(`
    SELECT id, label, created_by, is_active, created_at, rotated_at
    FROM card_pool_keys ORDER BY id DESC LIMIT 50
  `).all();
  const shares = db.prepare(`
    SELECT s.key_id, s.installation_id, s.created_at, l.label AS worker_label
    FROM card_pool_key_shares s
    LEFT JOIN licenses l ON l.installation_id = s.installation_id
  `).all();
  const byKey = {};
  for (const s of shares) {
    (byKey[s.key_id] = byKey[s.key_id] || []).push({
      installation_id: s.installation_id,
      worker_label: s.worker_label,
      shared_at: s.created_at,
    });
  }
  res.json({ keys: keys.map((k) => ({ ...k, shares: byKey[k.id] || [] })) });
});

// POST /manager/api/cards/pool/keys/:id/shares — дораздать существующий ключ
// (новый воркер в команде). Тело: { shares: [{installation_id, sealed_key}] }.
managerRouter.post('/cards/pool/keys/:id/shares', (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ error: 'key_id_invalid' });
  const shares = sanitizeShares((req.body || {}).shares);
  if (!shares) return res.status(400).json({ error: 'shares_invalid' });

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM card_pool_keys WHERE id = ?').get(keyId)) {
    return res.status(404).json({ error: 'unknown_pool_key' });
  }
  const licStmt = db.prepare('SELECT 1 FROM licenses WHERE installation_id = ?');
  for (const s of shares) {
    if (!licStmt.get(s.installation_id)) {
      return res.status(404).json({ error: 'unknown_installation', installation_id: s.installation_id });
    }
  }
  const ins = db.prepare(`
    INSERT INTO card_pool_key_shares (key_id, installation_id, sealed_key)
    VALUES (?, ?, ?)
    ON CONFLICT(key_id, installation_id) DO UPDATE SET
      sealed_key = excluded.sealed_key, created_at = CURRENT_TIMESTAMP
  `);
  db.transaction(() => {
    for (const s of shares) ins.run(keyId, s.installation_id, s.sealed_key);
  })();
  audit('pool_key_share_add', { manager: req.installationId, key_id: keyId, shares: shares.length });
  res.json({ ok: true, key_id: keyId, shares: shares.length });
});

// ── Manager: заливка и обзор пула ────────────────────────────────────────────

// POST /manager/api/cards/pool/upload — залить срезы в пул.
// Тело: { key_id, slices: [{card_hash, sealed_data}] }. Конфликт по card_hash:
// свободные/отозванные перезаписываются (перезаливка), забронированные и
// подтверждённые пропускаются (счётчик skipped_busy).
managerRouter.post('/cards/pool/upload', (req, res) => {
  const body = req.body || {};
  const keyId = Number(body.key_id);
  if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ error: 'key_id_required' });
  const slices = sanitizeSlices(body.slices);
  if (!slices) return res.status(400).json({ error: 'slices_invalid' });

  const db = getDb();
  const key = db.prepare('SELECT is_active FROM card_pool_keys WHERE id = ?').get(keyId);
  if (!key) return res.status(404).json({ error: 'unknown_pool_key' });
  if (!key.is_active) return res.status(400).json({ error: 'pool_key_rotated' });

  let uploaded = 0;
  let skippedBusy = 0;
  db.transaction(() => {
    const find = db.prepare('SELECT status FROM card_pool_slices WHERE card_hash = ?');
    const ins = db.prepare(`
      INSERT INTO card_pool_slices (card_hash, key_id, sealed_data, uploaded_by)
      VALUES (?, ?, ?, ?)
    `);
    const upd = db.prepare(`
      UPDATE card_pool_slices SET key_id = ?, sealed_data = ?, status = 'pooled',
        reserved_by = NULL, reserved_at = NULL, acked_at = NULL,
        outcome = NULL, outcome_at = NULL, uploaded_by = ?, created_at = CURRENT_TIMESTAMP
      WHERE card_hash = ?
    `);
    for (const s of slices) {
      const existing = find.get(s.card_hash);
      if (existing && (existing.status === 'reserved' || existing.status === 'ack')) {
        skippedBusy += 1;
        continue;
      }
      if (existing) {
        upd.run(keyId, s.sealed_data, req.installationId, s.card_hash);
      } else {
        ins.run(s.card_hash, keyId, s.sealed_data, req.installationId);
      }
      uploaded += 1;
    }
  })();

  audit('pool_upload', { manager: req.installationId, key_id: keyId, uploaded, skipped_busy: skippedBusy });
  notifyPoolChange(req, 'upload');
  res.status(201).json({ ok: true, uploaded, skipped_busy: skippedBusy });
});

// GET /manager/api/cards/pool?status=&reserved_by= — «кто что взял, когда,
// статус». sealed_data не возвращается (как и в /cards/issued).
managerRouter.get('/cards/pool', (req, res) => {
  const db = getDb();
  const swept = sweepExpiredReservations(db);
  const status = POOL_STATUSES.includes(req.query.status || '') ? req.query.status : null;
  const reservedBy = typeof req.query.reserved_by === 'string' && req.query.reserved_by ? req.query.reserved_by : null;
  let sql = `
    SELECT p.id, p.card_hash, p.key_id, p.status, p.reserved_by, p.reserved_at,
           p.acked_at, p.outcome, p.outcome_at, p.uploaded_by, p.created_at,
           l.label AS worker_label
    FROM card_pool_slices p
    LEFT JOIN licenses l ON l.installation_id = p.reserved_by
  `;
  const conds = [];
  const params = [];
  if (status) { conds.push('p.status = ?'); params.push(status); }
  if (reservedBy) { conds.push('p.reserved_by = ?'); params.push(reservedBy); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY p.id DESC LIMIT 500';
  const slices = db.prepare(sql).all(...params);
  const counts = db.prepare('SELECT status, COUNT(*) AS n FROM card_pool_slices GROUP BY status').all();
  res.json({
    slices,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    swept_expired: swept,
    reserve_ttl_hours: reserveTtlHours(),
  });
});

// POST /manager/api/cards/pool/revoke — изъять срезы из пула (свободные или
// забронированные; подтверждённые уже у воркера — их revoke бессмысленен).
managerRouter.post('/cards/pool/revoke', (req, res) => {
  const ids = parseIds((req.body || {}).ids, 500);
  if (!ids) return res.status(400).json({ error: 'ids_array_required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE card_pool_slices SET status = 'revoked'
    WHERE status IN ('pooled','reserved') AND id IN (${placeholders})
  `).run(...ids);
  if (info.changes > 0) {
    audit('pool_revoke', { manager: req.installationId, revoked: info.changes });
    notifyPoolChange(req, 'revoke');
  }
  res.json({ ok: true, revoked: info.changes });
});

// POST /manager/api/cards/pool/return — принудительно вернуть бронь в пул
// (залипшая бронь, воркер недоступен). Для ack-срезов — только бухгалтерия:
// локальную карту у воркера это не удаляет.
managerRouter.post('/cards/pool/return', (req, res) => {
  const ids = parseIds((req.body || {}).ids, 500);
  if (!ids) return res.status(400).json({ error: 'ids_array_required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE card_pool_slices SET status = 'pooled', reserved_by = NULL, reserved_at = NULL,
      acked_at = NULL, outcome = NULL, outcome_at = NULL
    WHERE status IN ('reserved','ack') AND id IN (${placeholders})
  `).run(...ids);
  if (info.changes > 0) {
    audit('pool_return', { manager: req.installationId, returned: info.changes });
    notifyPoolChange(req, 'return');
  }
  res.json({ ok: true, returned: info.changes });
});

// ── Worker: ключ, обзор, бронирование ────────────────────────────────────────

// GET /sync/cards/pool/key — мой запечатанный share активного ключа пула.
// { key_id, sealed_key } либо { key_id: null }, если share мне не выдавали.
workerRouter.get('/cards/pool/key', (req, res) => {
  const row = getDb().prepare(`
    SELECT s.key_id, s.sealed_key
    FROM card_pool_key_shares s
    JOIN card_pool_keys k ON k.id = s.key_id AND k.is_active = 1
    WHERE s.installation_id = ?
    ORDER BY s.key_id DESC LIMIT 1
  `).get(req.installationId);
  if (!row) return res.json({ key_id: null, sealed_key: null });
  res.json({ key_id: row.key_id, sealed_key: row.sealed_key });
});

// GET /sync/cards/pool — сколько свободно (с учётом моих shares) и мои брони.
// sealed_data отдаётся только для status='reserved' — at-least-once до ack,
// как в /sync/cards/issued.
workerRouter.get('/cards/pool', (req, res) => {
  const db = getDb();
  sweepExpiredReservations(db);
  const available = db.prepare(`
    SELECT COUNT(*) AS n FROM card_pool_slices p
    JOIN card_pool_key_shares s ON s.key_id = p.key_id AND s.installation_id = ?
    WHERE p.status = 'pooled'
  `).get(req.installationId).n;
  const mine = db.prepare(`
    SELECT id, card_hash, key_id, status, reserved_at, acked_at, outcome,
      CASE WHEN status = 'reserved' THEN sealed_data ELSE NULL END AS sealed_data
    FROM card_pool_slices
    WHERE reserved_by = ? AND status IN ('reserved','ack')
    ORDER BY id ASC LIMIT 200
  `).all(req.installationId);
  res.json({ available, mine });
});

// POST /sync/cards/pool/reserve — забронировать N карт из пула.
// Тело: { count }. Учитываются только срезы под ключами, розданными мне.
// Политики: пауза (403 worker_paused) и квота карт/день (429) — те же, что
// на адресной выдаче; в квоту идут и адресные выдачи, и бронирования за
// сутки. Освобождённые (release/TTL) брони квоту освобождают — осознанно:
// потолок держит фактически удерживаемые карты, а не число попыток.
workerRouter.post('/cards/pool/reserve', (req, res) => {
  const count = Number((req.body || {}).count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESERVE_PER_CALL) {
    return res.status(400).json({ error: 'count_invalid', max: MAX_RESERVE_PER_CALL });
  }

  const db = getDb();
  const pol = db.prepare('SELECT paused, quota_cards_day FROM worker_policies WHERE installation_id = ?').get(req.installationId);
  if (pol && pol.paused === 1) return res.status(403).json({ error: 'worker_paused' });

  const swept = sweepExpiredReservations(db);

  if (pol && pol.quota_cards_day !== null) {
    const issuedToday = db.prepare(`
      SELECT COUNT(*) AS n FROM issued_card_slices
      WHERE target_iid = ? AND created_at >= datetime('now','start of day') AND status != 'revoked'
    `).get(req.installationId).n;
    const reservedToday = db.prepare(`
      SELECT COUNT(*) AS n FROM card_pool_slices
      WHERE reserved_by = ? AND reserved_at >= datetime('now','start of day')
    `).get(req.installationId).n;
    if (issuedToday + reservedToday + count > pol.quota_cards_day) {
      return res.status(429).json({
        error: 'quota_cards_exceeded',
        quota: pol.quota_cards_day,
        issued_today: issuedToday,
        reserved_today: reservedToday,
      });
    }
  }

  const picked = db.transaction(() => {
    const rows = db.prepare(`
      SELECT p.id FROM card_pool_slices p
      JOIN card_pool_key_shares s ON s.key_id = p.key_id AND s.installation_id = ?
      WHERE p.status = 'pooled'
      ORDER BY p.id ASC LIMIT ?
    `).all(req.installationId, count);
    if (rows.length === 0) return rows;
    const upd = db.prepare(`
      UPDATE card_pool_slices SET status = 'reserved', reserved_by = ?, reserved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pooled'
    `);
    const okIds = [];
    for (const r of rows) {
      if (upd.run(req.installationId, r.id).changes === 1) okIds.push(r.id);
    }
    if (okIds.length === 0) return [];
    const placeholders = okIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT id, card_hash, key_id, sealed_data, reserved_at FROM card_pool_slices
      WHERE id IN (${placeholders}) ORDER BY id ASC
    `).all(...okIds);
  })();

  if (picked.length > 0) {
    audit('pool_reserve', { installation_id: req.installationId, count: picked.length });
    notifyPoolChange(req, 'reserve');
  }
  res.status(201).json({ ok: true, reserved: picked.length, swept_expired: swept, slices: picked });
});

// POST /sync/cards/pool/ack — подтвердить импорт забронированных срезов.
workerRouter.post('/cards/pool/ack', (req, res) => {
  const ids = parseIds((req.body || {}).ids, MAX_POOL_UPLOAD);
  if (!ids) return res.status(400).json({ error: 'ids_array_required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE card_pool_slices SET status = 'ack', acked_at = CURRENT_TIMESTAMP
    WHERE reserved_by = ? AND status = 'reserved' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  res.json({ ok: true, acked: info.changes });
});

// POST /sync/cards/pool/release — вернуть неиспользованную бронь в пул
// (до ack; подтверждённые срезы возвращает менеджер через /cards/pool/return).
workerRouter.post('/cards/pool/release', (req, res) => {
  const ids = parseIds((req.body || {}).ids, MAX_POOL_UPLOAD);
  if (!ids) return res.status(400).json({ error: 'ids_array_required' });
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE card_pool_slices SET status = 'pooled', reserved_by = NULL, reserved_at = NULL
    WHERE reserved_by = ? AND status = 'reserved' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  if (info.changes > 0) {
    audit('pool_release', { installation_id: req.installationId, released: info.changes });
    notifyPoolChange(req, 'release');
  }
  res.json({ ok: true, released: info.changes });
});

// POST /sync/cards/pool/outcome — отчёт по взятым картам: { ids, outcome:
// 'used'|'burned' }. Только подтверждённые (ack) свои срезы. Сгоревшие карты
// в пул НЕ возвращаются — их данные мертвы; возврат при сгорании брони делает
// TTL-sweep.
workerRouter.post('/cards/pool/outcome', (req, res) => {
  const body = req.body || {};
  const ids = parseIds(body.ids, MAX_POOL_UPLOAD);
  if (!ids) return res.status(400).json({ error: 'ids_array_required' });
  if (!POOL_OUTCOMES.includes(body.outcome)) return res.status(400).json({ error: 'outcome_invalid' });
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE card_pool_slices SET outcome = ?, outcome_at = CURRENT_TIMESTAMP
    WHERE reserved_by = ? AND status = 'ack' AND outcome IS NULL AND id IN (${placeholders})
  `).run(body.outcome, req.installationId, ...ids);
  if (info.changes > 0) notifyPoolChange(req, 'outcome');
  res.json({ ok: true, updated: info.changes });
});

module.exports = { managerRouter, workerRouter, sweepExpiredReservations, MAX_POOL_UPLOAD };
