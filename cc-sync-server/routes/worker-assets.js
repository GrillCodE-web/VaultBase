//! MGR-018 (этапы C/D): централизованные срезы прокси/email и share-ключи
//! конфигурации. Модель та же, что у карт (worker-cards.js): менеджер
//! запечатывает срез X25519-пубключом воркера и кладёт конверт на сервер —
//! сервер хранит только шифротекст и работает курьером:
//!
//!   менеджер  POST /manager/api/assets/issue        → срезы прокси/email воркеру
//!   менеджер  GET  /manager/api/assets/issued       → статус раздач
//!   менеджер  POST /manager/api/assets/issued/revoke→ отозвать недоставленное
//!   воркер    GET  /sync/assets/issued?kind=        → забрать неотмеченные срезы
//!   воркер    POST /sync/assets/issued/ack          → подтвердить импорт
//!   менеджер  POST /manager/api/config/share        → share-ключ (stuffer)
//!   воркер    GET  /sync/config/shares?kind=        → забрать конверт конфигурации
//!   воркер    POST /sync/config/shares/ack          → подтвердить применение
//!
//! PPTP/uPanel-секрет сюда НЕ ходит: он остаётся локальным у воркера.

const express = require('express');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_SLICES_PER_ISSUE = 200;
const MAX_SEALED_LEN = 16 * 1024;
const MAX_ASSET_HASH_LEN = 128;
const ASSET_KINDS = ['proxy', 'email'];
const CONFIG_KINDS = ['stuffer'];
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
    console.error('[worker-assets] audit insert failed:', e.message);
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

function isValidKind(kind, allowed) {
  return typeof kind === 'string' && allowed.includes(kind);
}

function sanitizeSlices(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SLICES_PER_ISSUE) return null;
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.asset_hash !== 'string' || s.asset_hash.length < 8 || s.asset_hash.length > MAX_ASSET_HASH_LEN) return null;
    if (typeof s.sealed_data !== 'string' || s.sealed_data.length < 16 || s.sealed_data.length > MAX_SEALED_LEN) return null;
    out.push({ asset_hash: s.asset_hash, sealed_data: s.sealed_data });
  }
  return out;
}

// Политики воркера: пауза/бан блокируют выдачу новых срезов (как у карт,
// MGR-019); закреплённое у воркера остаётся, revoke не блокируется.
function policyBlocksIssue(db, targetIid) {
  const pol = db.prepare('SELECT paused, banned, ban_until FROM worker_policies WHERE installation_id = ?').get(targetIid);
  if (pol && pol.banned === 1 && (pol.ban_until === null || pol.ban_until > new Date().toISOString())) {
    return 'worker_banned';
  }
  if (pol && pol.paused === 1) return 'worker_paused';
  return null;
}

// ── Manager: раздача срезов прокси/email ─────────────────────────────────────

// POST /manager/api/assets/issue — положить запечатанные срезы воркеру.
// Тело: { target_iid, kind: 'proxy'|'email', slices: [{ asset_hash, sealed_data }] }.
// Повторная выдача того же asset тому же воркеру перезаписывает конверт и
// возвращает его в pending (перевыпуск после wipe/переактивации).
managerRouter.post('/assets/issue', (req, res) => {
  const { target_iid, kind } = req.body || {};
  if (typeof target_iid !== 'string' || !target_iid) {
    return res.status(400).json({ error: 'target_iid_required' });
  }
  if (!isValidKind(kind, ASSET_KINDS)) return res.status(400).json({ error: 'kind_invalid' });
  const slices = sanitizeSlices((req.body || {}).slices);
  if (!slices) return res.status(400).json({ error: 'slices_invalid' });

  const db = getDb();
  const lic = db.prepare('SELECT role, is_active FROM licenses WHERE installation_id = ?').get(target_iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (lic.role === 'manager') return res.status(400).json({ error: 'manager_is_not_a_recipient' });
  if (!lic.is_active) return res.status(400).json({ error: 'license_revoked' });
  const hasKey = db.prepare('SELECT 1 FROM worker_keys WHERE installation_id = ? AND is_active = 1').get(target_iid);
  if (!hasKey) return res.status(409).json({ error: 'worker_key_not_registered' });

  const blocked = policyBlocksIssue(db, target_iid);
  if (blocked) return res.status(403).json({ error: blocked });

  db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO issued_asset_slices (kind, asset_hash, target_iid, sealed_data, status, issued_by, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(kind, asset_hash, target_iid) DO UPDATE SET
        sealed_data = excluded.sealed_data,
        status = 'pending',
        issued_by = excluded.issued_by,
        delivered_at = NULL,
        acked_at = NULL,
        revoked_at = NULL
    `);
    for (const s of slices) stmt.run(kind, s.asset_hash, target_iid, s.sealed_data, req.installationId);
  })();

  audit('manager_assets_issue', { manager: req.installationId, target_iid, kind, count: slices.length });
  notifyWorker(req, target_iid, { type: 'assets_issued', kind });
  res.status(201).json({ ok: true, issued: slices.length, target_iid, kind });
});

// GET /manager/api/assets/issued?kind=&target_iid=&status= — статус раздач.
// sealed_data не возвращается (сервер не может его расшифровать, а менеджеру
// он не нужен: срез можно выдать заново).
managerRouter.get('/assets/issued', (req, res) => {
  const kind = isValidKind(req.query.kind, ASSET_KINDS) ? req.query.kind : null;
  const target = typeof req.query.target_iid === 'string' && req.query.target_iid ? req.query.target_iid : null;
  const status = SLICE_STATUSES.includes(req.query.status || '') ? req.query.status : null;
  let sql = `
    SELECT s.id, s.kind, s.asset_hash, s.target_iid, s.status, s.issued_by, s.created_at,
           s.delivered_at, s.acked_at, s.revoked_at, l.label AS worker_label
    FROM issued_asset_slices s
    LEFT JOIN licenses l ON l.installation_id = s.target_iid
  `;
  const conds = [];
  const params = [];
  if (kind) { conds.push('s.kind = ?'); params.push(kind); }
  if (target) { conds.push('s.target_iid = ?'); params.push(target); }
  if (status) { conds.push('s.status = ?'); params.push(status); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY s.id DESC LIMIT 500';
  res.json({ slices: getDb().prepare(sql).all(...params) });
});

// POST /manager/api/assets/issued/revoke — менеджер отзывает недоставленные
// срезы. Отозванные воркер не получает и ack на них не проходит.
managerRouter.post('/assets/issued/revoke', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE issued_asset_slices SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
    WHERE status IN ('pending','delivered') AND id IN (${placeholders})
  `).run(...ids);
  if (info.changes > 0) {
    audit('manager_assets_revoke', { manager: req.installationId, revoked: info.changes });
  }
  res.json({ ok: true, revoked: info.changes });
});

// ── Manager: share-ключи конфигурации (stuffer base_url + API key) ───────────

// POST /manager/api/config/share — выдать воркеру запечатанный конверт
// конфигурации. Тело: { target_iid, kind: 'stuffer', sealed_data }. Один
// актуальный конверт на (kind, target_iid): повторная выдача перезаписывает.
managerRouter.post('/config/share', (req, res) => {
  const { target_iid, kind, sealed_data } = req.body || {};
  if (typeof target_iid !== 'string' || !target_iid) {
    return res.status(400).json({ error: 'target_iid_required' });
  }
  if (!isValidKind(kind, CONFIG_KINDS)) return res.status(400).json({ error: 'kind_invalid' });
  if (typeof sealed_data !== 'string' || sealed_data.length < 16 || sealed_data.length > MAX_SEALED_LEN) {
    return res.status(400).json({ error: 'sealed_data_invalid' });
  }

  const db = getDb();
  const lic = db.prepare('SELECT role, is_active FROM licenses WHERE installation_id = ?').get(target_iid);
  if (!lic) return res.status(404).json({ error: 'unknown_installation' });
  if (lic.role === 'manager') return res.status(400).json({ error: 'manager_is_not_a_recipient' });
  if (!lic.is_active) return res.status(400).json({ error: 'license_revoked' });
  const hasKey = db.prepare('SELECT 1 FROM worker_keys WHERE installation_id = ? AND is_active = 1').get(target_iid);
  if (!hasKey) return res.status(409).json({ error: 'worker_key_not_registered' });

  db.prepare(`
    INSERT INTO worker_config_shares (kind, target_iid, sealed_data, status, issued_by, created_at)
    VALUES (?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(kind, target_iid) DO UPDATE SET
      sealed_data = excluded.sealed_data,
      status = 'pending',
      issued_by = excluded.issued_by,
      delivered_at = NULL,
      acked_at = NULL,
      revoked_at = NULL
  `).run(kind, target_iid, sealed_data, req.installationId);

  audit('manager_config_share', { manager: req.installationId, target_iid, kind });
  notifyWorker(req, target_iid, { type: 'config_shared', kind });
  res.status(201).json({ ok: true, target_iid, kind });
});

// GET /manager/api/config/shares?kind=&target_iid= — статус share-раздач
// (без sealed_data, как и у срезов).
managerRouter.get('/config/shares', (req, res) => {
  const kind = isValidKind(req.query.kind, CONFIG_KINDS) ? req.query.kind : null;
  const target = typeof req.query.target_iid === 'string' && req.query.target_iid ? req.query.target_iid : null;
  let sql = `
    SELECT s.id, s.kind, s.target_iid, s.status, s.issued_by, s.created_at,
           s.delivered_at, s.acked_at, s.revoked_at, l.label AS worker_label
    FROM worker_config_shares s
    LEFT JOIN licenses l ON l.installation_id = s.target_iid
  `;
  const conds = [];
  const params = [];
  if (kind) { conds.push('s.kind = ?'); params.push(kind); }
  if (target) { conds.push('s.target_iid = ?'); params.push(target); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY s.id DESC LIMIT 500';
  res.json({ shares: getDb().prepare(sql).all(...params) });
});

// POST /manager/api/config/shares/revoke — отозвать share (воркер перестанет
// его получать; уже применённый локально ключ воркер не трогаем — воркер
// хранит его read-only до явной замены новым конвертом).
managerRouter.post('/config/shares/revoke', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE worker_config_shares SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
    WHERE status IN ('pending','delivered') AND id IN (${placeholders})
  `).run(...ids);
  if (info.changes > 0) {
    audit('manager_config_share_revoke', { manager: req.installationId, revoked: info.changes });
  }
  res.json({ ok: true, revoked: info.changes });
});

// ── Worker: доставка ─────────────────────────────────────────────────────────

// GET /sync/assets/issued?kind=proxy|email — забрать запечатанные срезы.
// At-least-once до явного ack (pending + delivered), как у карт.
workerRouter.get('/assets/issued', (req, res) => {
  const kind = req.query.kind;
  if (!isValidKind(kind, ASSET_KINDS)) return res.status(400).json({ error: 'kind_invalid' });
  const db = getDb();
  const slices = db.prepare(`
    SELECT id, asset_hash, sealed_data, created_at AS issued_at, delivered_at
    FROM issued_asset_slices
    WHERE target_iid = ? AND kind = ? AND status IN ('pending','delivered')
    ORDER BY id ASC
    LIMIT 200
  `).all(req.installationId, kind);
  if (slices.length > 0) {
    db.prepare(`
      UPDATE issued_asset_slices SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
      WHERE target_iid = ? AND kind = ? AND status = 'pending'
    `).run(req.installationId, kind);
  }
  res.json({ slices });
});

// POST /sync/assets/issued/ack — воркер подтвердил импорт. Тело: { ids }.
// Отменённые (revoked) не подтверждаются.
workerRouter.post('/assets/issued/ack', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_SLICES_PER_ISSUE
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE issued_asset_slices SET status = 'ack', acked_at = CURRENT_TIMESTAMP
    WHERE target_iid = ? AND status != 'revoked' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  res.json({ ok: true, acked: info.changes });
});

// GET /sync/config/shares?kind=stuffer — забрать конверт(ы) конфигурации.
workerRouter.get('/config/shares', (req, res) => {
  const db = getDb();
  const kind = req.query.kind;
  const conds = ['target_iid = ?', "status IN ('pending','delivered')"];
  const params = [req.installationId];
  if (kind !== undefined) {
    if (!isValidKind(kind, CONFIG_KINDS)) return res.status(400).json({ error: 'kind_invalid' });
    conds.push('kind = ?');
    params.push(kind);
  }
  const shares = db.prepare(`
    SELECT id, kind, sealed_data, created_at AS issued_at, delivered_at
    FROM worker_config_shares
    WHERE ${conds.join(' AND ')}
    ORDER BY id ASC
    LIMIT 50
  `).all(...params);
  if (shares.length > 0) {
    db.prepare(`
      UPDATE worker_config_shares SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP
      WHERE target_iid = ? AND status = 'pending'
    `).run(req.installationId);
  }
  res.json({ shares });
});

// POST /sync/config/shares/ack — воркер применил конфигурацию. Тело: { ids }.
workerRouter.post('/config/shares/ack', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50
      || !ids.every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ error: 'ids_array_required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(`
    UPDATE worker_config_shares SET status = 'ack', acked_at = CURRENT_TIMESTAMP
    WHERE target_iid = ? AND status != 'revoked' AND id IN (${placeholders})
  `).run(req.installationId, ...ids);
  res.json({ ok: true, acked: info.changes });
});

module.exports = { managerRouter, workerRouter, ASSET_KINDS, CONFIG_KINDS };
