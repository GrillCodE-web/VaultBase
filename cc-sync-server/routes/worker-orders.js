//! SEC Этап B (specs/security-sync-redesign.md): E2E-контент заказов.
//!
//! ЗЕРКАЛО механизма issued_card_slices, но направление ОБРАТНОЕ —
//! воркер → менеджер. Контент заказа шифрует ВОРКЕР под X25519-пубключ
//! менеджера (seal_envelope), читает ТОЛЬКО менеджер (unseal). Сервер —
//! слепой курьер: хранит sealed_data как есть, plaintext ему недоступен.
//!
//!   воркер   GET  /sync/manager-key        → узнать pubkey+key_id менеджера группы
//!   воркер   POST /sync/orders/upload      → залить запечатанные срезы заказов
//!   менеджер GET  /manager/api/orders/inbox → забрать неотмеченные срезы
//!   менеджер POST /manager/api/orders/ack   → подтвердить расшифровку/приём
//!
//! Футпринты заказа (хэши email/ip/drop/bin/...) идут отдельным каналом
//! (POST /footprint) и ОСТАЮТСЯ вне E2E — сервер их видит для дедупликации.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_SLICES_PER_UPLOAD = 100;
const MAX_SEALED_LEN = 64 * 1024;   // заказ крупнее карты (items_json)
const MAX_ORDER_REF_LEN = 128;
const MAX_ORDER_HASH_LEN = 128;

const managerRouter = express.Router();
managerRouter.use(requireManagerToken);

const workerRouter = express.Router();
workerRouter.use(requireWorkerToken);

function audit(action, details) {
  try {
    getDb().prepare('INSERT INTO audit_log (action, details) VALUES (?, ?)').run(
      action,
      JSON.stringify(details)
    );
  } catch (e) {
    console.error('[worker-orders] audit insert failed:', e.message);
  }
}

function notifyManager(req, iid, message) {
  try {
    const io = req.app.get('io');
    if (io && message && message.type) io.emit(`manager:${message.type}`, { installation_id: iid });
  } catch (_e) { /* best-effort */ }
}

// Найти менеджера для группы воркера: его группа → участники с ролью
// manager/admin → у кого есть активный manager_keys. Возвращает
// { target_iid, pubkey, key_id } или null.
function resolveManagerKeyForWorker(db, workerIid) {
  const grp = db.prepare(`
    SELECT group_id FROM sync_group_members
    WHERE installation_id = ? ORDER BY joined_at DESC LIMIT 1
  `).get(workerIid);
  if (!grp || !grp.group_id) return null;
  return db.prepare(`
    SELECT k.installation_id AS target_iid, k.pubkey AS pubkey, k.id AS key_id
    FROM sync_group_members m
    JOIN licenses l ON l.installation_id = m.installation_id
    JOIN manager_keys k ON k.installation_id = m.installation_id AND k.is_active = 1
    WHERE m.group_id = ? AND (l.role = 'manager' OR l.role = 'admin')
    ORDER BY k.id DESC
    LIMIT 1
  `).get(grp.group_id) || null;
}

function sanitizeOrderSlices(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SLICES_PER_UPLOAD) return null;
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.order_ref !== 'string' || s.order_ref.length < 1 || s.order_ref.length > MAX_ORDER_REF_LEN) return null;
    if (typeof s.sealed_data !== 'string' || s.sealed_data.length < 16 || s.sealed_data.length > MAX_SEALED_LEN) return null;
    const orderHash = (typeof s.order_hash === 'string' && s.order_hash.length <= MAX_ORDER_HASH_LEN) ? s.order_hash : null;
    const keyId = Number.isInteger(s.key_id) && s.key_id > 0 ? s.key_id : 1;
    out.push({ order_ref: s.order_ref, sealed_data: s.sealed_data, order_hash: orderHash, key_id: keyId });
  }
  return out;
}

// ── Worker: узнать pubkey менеджера для запечатывания ────────────────────────

const keyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.installationId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

// GET /sync/manager-key — активный X25519-пубключ менеджера группы воркера.
// Ответ: { target_iid, pubkey, key_id } или 404 если менеджер/ключ не найден.
workerRouter.get('/manager-key', keyLimiter, (req, res) => {
  const mk = resolveManagerKeyForWorker(getDb(), req.installationId);
  if (!mk) return res.status(404).json({ error: 'manager_key_unavailable' });
  res.json({ target_iid: mk.target_iid, pubkey: mk.pubkey, key_id: mk.key_id });
});

// ── Worker: залить запечатанные срезы заказов ────────────────────────────────

// POST /sync/orders/upload — тело: { slices: [{ order_ref, sealed_data,
// order_hash?, key_id? }], target_iid? }. Повторная загрузка того же
// (order_ref, source_iid) перезаписывает конверт и возвращает в pending.
workerRouter.post('/orders/upload', (req, res) => {
  const body = req.body || {};
  const slices = sanitizeOrderSlices(body.slices);
  if (!slices) return res.status(400).json({ error: 'slices_array_required' });

  const db = getDb();
  let targetIid = typeof body.target_iid === 'string' ? body.target_iid : null;
  if (!targetIid) {
    const mk = resolveManagerKeyForWorker(db, req.installationId);
    if (!mk) return res.status(409).json({ error: 'manager_unavailable' });
    targetIid = mk.target_iid;
  }

  const upsert = db.prepare(`
    INSERT INTO issued_order_slices
      (order_ref, source_iid, target_iid, key_id, order_hash, sealed_data, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(order_ref, source_iid) DO UPDATE SET
      target_iid   = excluded.target_iid,
      key_id       = excluded.key_id,
      order_hash   = excluded.order_hash,
      sealed_data  = excluded.sealed_data,
      status       = 'pending',
      updated_at   = CURRENT_TIMESTAMP,
      delivered_at = NULL,
      acked_at     = NULL,
      revoked_at   = NULL
  `);
  const stored = db.transaction((rows) => {
    let n = 0;
    for (const s of rows) {
      upsert.run(s.order_ref, req.installationId, targetIid, s.key_id, s.order_hash, s.sealed_data);
      n += 1;
    }
    return n;
  })(slices);

  audit('worker_orders_upload', { source: req.installationId, target: targetIid, count: stored });
  notifyManager(req, targetIid, { type: 'orders_pending' });
  res.status(201).json({ ok: true, stored });
});

// ── Manager: забрать и подтвердить срезы заказов ─────────────────────────────

// GET /manager/api/orders/inbox — неотмеченные срезы (pending+delivered,
// at-least-once до ack), помечаем доставку.
managerRouter.get('/orders/inbox', (req, res) => {
  const db = getDb();
  const slices = db.prepare(`
    SELECT id, order_ref, source_iid, key_id, order_hash, sealed_data,
           created_at, updated_at, delivered_at
    FROM issued_order_slices
    WHERE target_iid = ? AND status IN ('pending','delivered')
    ORDER BY id ASC
    LIMIT 500
  `).all(req.installationId);
  if (slices.length > 0) {
    db.prepare(`
      UPDATE issued_order_slices SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
      WHERE target_iid = ? AND status = 'pending'
    `).run(req.installationId);
  }
  res.json({ slices });
});

// POST /manager/api/orders/ack — менеджер подтвердил расшифровку/приём.
// Тело: { ids: [id, ...] }. Отозванные (revoked) не подтверждаются.
managerRouter.post('/orders/ack', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE issued_order_slices SET status = 'ack', acked_at = CURRENT_TIMESTAMP
    WHERE target_iid = ? AND status != 'revoked' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  res.json({ ok: true, acked: info.changes });
});

module.exports = { managerRouter, workerRouter, MAX_SLICES_PER_UPLOAD };
