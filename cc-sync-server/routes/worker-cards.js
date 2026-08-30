//! MGR-016: доставка карт в архитектуре «воркер = потребитель».
//!
//! Карты создаёт ТОЛЬКО менеджер. Он запечатывает срез карты X25519-пубключом
//! воркера (см. worker_keys) и кладёт конверт в issued_card_slices — сервер
//! хранит только шифротекст и работает курьером:
//!
//!   менеджер  POST /manager/api/cards/issue        → положить срезы воркеру
//!   менеджер  GET  /manager/api/cards/issued       → статус раздач
//!   воркер    POST /sync/worker-key/register       → регистрация/ротация pubkey
//!   воркер    GET  /sync/cards/issued             → забрать неотмеченные срезы
//!   воркер    POST /sync/cards/issued/ack         → подтвердить импорт
//!
//! Легаси-канал групп остаётся только для обновлений статусов существующих
//! карт (см. card-push.js allowCreate:false) — создавать карты воркер не может.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_SLICES_PER_ISSUE = 100;
const MAX_SEALED_LEN = 16 * 1024;
const MAX_CARD_HASH_LEN = 128;
const SLICE_STATUSES = ['pending', 'delivered', 'ack', 'revoked'];

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
    console.error('[worker-cards] audit insert failed:', e.message);
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

function sanitizeSlices(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SLICES_PER_ISSUE) return null;
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.card_hash !== 'string' || s.card_hash.length < 8 || s.card_hash.length > MAX_CARD_HASH_LEN) return null;
    if (typeof s.sealed_data !== 'string' || s.sealed_data.length < 16 || s.sealed_data.length > MAX_SEALED_LEN) return null;
    out.push({ card_hash: s.card_hash, sealed_data: s.sealed_data });
  }
  return out;
}

// ── Manager: раздача запечатанных срезов ─────────────────────────────────────

// POST /manager/api/cards/issue — положить запечатанные срезы воркеру.
// Тело: { target_iid, slices: [{ card_hash, sealed_data }] }. Повторная выдача
// той же карты тому же воркеру перезаписывает конверт и возвращает её в
// pending (перевыпуск после wipe/переактивации).
managerRouter.post('/cards/issue', (req, res) => {
  const { target_iid } = req.body || {};
  if (typeof target_iid !== 'string' || !target_iid) {
    return res.status(400).json({ error: 'target_iid_required' });
  }
  const slices = sanitizeSlices((req.body || {}).slices);
  if (!slices) return res.status(400).json({ error: 'slices_invalid' });

  const db = getDb();
  const lic = db.prepare('SELECT role, is_active FROM licenses WHERE installation_id = ?').get(target_iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (lic.role === 'manager') return res.status(400).json({ error: 'manager_is_not_a_card_recipient' });
  if (!lic.is_active) return res.status(400).json({ error: 'license_revoked' });
  const hasKey = db.prepare('SELECT 1 FROM worker_keys WHERE installation_id = ? AND is_active = 1').get(target_iid);
  if (!hasKey) return res.status(409).json({ error: 'worker_key_not_registered' });

  db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO issued_card_slices (card_hash, target_iid, sealed_data, status, issued_by, created_at)
      VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(card_hash, target_iid) DO UPDATE SET
        sealed_data = excluded.sealed_data,
        status = 'pending',
        issued_by = excluded.issued_by,
        delivered_at = NULL,
        acked_at = NULL
    `);
    for (const s of slices) stmt.run(s.card_hash, target_iid, s.sealed_data, req.installationId);
  })();

  audit('manager_cards_issue', { manager: req.installationId, target_iid, count: slices.length });
  notifyWorker(req, target_iid, { type: 'cards_issued' });
  res.status(201).json({ ok: true, issued: slices.length, target_iid });
});

// GET /manager/api/cards/issued?target_iid=&status= — статус раздач.
// sealed_data не возвращается: сервер не может его расшифровать, а менеджеру
// он не нужен (срез можно выдать заново).
managerRouter.get('/cards/issued', (req, res) => {
  const target = typeof req.query.target_iid === 'string' && req.query.target_iid ? req.query.target_iid : null;
  const status = SLICE_STATUSES.includes(req.query.status || '') ? req.query.status : null;
  let sql = `
    SELECT s.id, s.card_hash, s.target_iid, s.status, s.issued_by, s.created_at,
           s.delivered_at, s.acked_at, l.label AS worker_label
    FROM issued_card_slices s
    LEFT JOIN licenses l ON l.installation_id = s.target_iid
  `;
  const conds = [];
  const params = [];
  if (target) { conds.push('s.target_iid = ?'); params.push(target); }
  if (status) { conds.push('s.status = ?'); params.push(status); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY s.id DESC LIMIT 500';
  res.json({ slices: getDb().prepare(sql).all(...params) });
});

// ── Worker: ключ и доставка срезов ───────────────────────────────────────────

// Ротация ключа — не чаще 20 раз в час на установку (heartbeat-петля защиты).
const keyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.installationId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

// POST /sync/worker-key/register — регистрация/ротация X25519-пубключа
// воркера. Один активный ключ на установку: прошлый отзывается автоматически.
workerRouter.post('/worker-key/register', keyLimiter, (req, res) => {
  const { pubkey, label } = req.body || {};
  if (typeof pubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    return res.status(400).json({ error: 'pubkey_must_be_64_hex_chars' });
  }
  const db = getDb();
  const keyId = db.transaction(() => {
    db.prepare(`
      UPDATE worker_keys SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
      WHERE installation_id = ? AND is_active = 1
    `).run(req.installationId);
    const r = db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
      .run(req.installationId, pubkey.toLowerCase(), typeof label === 'string' ? label.slice(0, 100) : '');
    return Number(r.lastInsertRowid);
  })();
  audit('worker_key_register', { installation_id: req.installationId, key_id: keyId });
  res.status(201).json({ ok: true, key_id: keyId });
});

// GET /sync/cards/issued — забрать запечатанные срезы. Отдаём всё, что ещё
// не подтверждено (pending + delivered — at-least-once до явного ack),
// отмечаем доставку; убирается из выдачи только после ack.
workerRouter.get('/cards/issued', (req, res) => {
  const db = getDb();
  const slices = db.prepare(`
    SELECT id, card_hash, sealed_data, created_at AS issued_at, delivered_at
    FROM issued_card_slices
    WHERE target_iid = ? AND status IN ('pending','delivered')
    ORDER BY id ASC
    LIMIT 200
  `).all(req.installationId);
  if (slices.length > 0) {
    db.prepare(`
      UPDATE issued_card_slices SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
      WHERE target_iid = ? AND status = 'pending'
    `).run(req.installationId);
  }
  res.json({ slices });
});

// POST /sync/cards/issued/ack — воркер подтвердил импорт срезов. Тело:
// { ids: [id, ...] }. Отменённые (revoked) не подтверждаются.
workerRouter.post('/cards/issued/ack', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SLICES_PER_ISSUE
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE issued_card_slices SET status = 'ack', acked_at = CURRENT_TIMESTAMP
    WHERE target_iid = ? AND status != 'revoked' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  res.json({ ok: true, acked: info.changes });
});

module.exports = { managerRouter, workerRouter, MAX_SLICES_PER_ISSUE };
