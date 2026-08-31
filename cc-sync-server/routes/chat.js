//! REDESIGN-05-5B4: E2E-шифрованная переписка (docs/CHAT_E2E.md).
//! Сервер — opaque-relay: хранит и отдаёт ТОЛЬКО запечатанные конверты
//! (sealed-box формат telemetry: {key_id, ephemeral, nonce, ct}) плюс
//! метаданные маршрутизации (sender/target/время/размер). Приватных ключей
//! на сервере нет, plaintext не существует — компрометация сервера = утечка
//! мёртвых шифротекстов.
//!
//!   воркер    GET  /sync/chat/peers              → каталог ключей (группа + менеджеры)
//!   воркер    POST /sync/chat/send               → fan-out: до 50 конвертов за раз
//!   воркер    GET  /sync/chat/messages?since_id= → входящие блобы (at-least-once, TTL)
//!   менеджер  GET  /manager/api/chat/peers       → все активные воркеры с ключами
//!   менеджер  POST /manager/api/chat/send        → один конверт одному воркеру
//!   менеджер  GET  /manager/api/chat/messages    → входящие блобы менеджера
//!
//! Живые уведомления — WS {"type":"chat_message"} (воркер) и socket.io
//! "manager:chat_message" (менеджер); полезная нагрузка всё равно забирается
//! HTTP fetch'ем, как у срезов (cards_issued → /sync/cards/issued).

const express = require('express');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_ENVELOPES_PER_SEND = 50;
const MAX_SEALED_LEN = 16 * 1024;
const MAX_REF_LEN = 64;
const MAX_FETCH_LIMIT = 200;
const DEFAULT_TTL_HOURS = 24 * 30; // 30 дней — мягкий TTL по умолчанию
const MAX_TTL_HOURS = 24 * 30;
// room: 'dm:<iidA>:<iidB>' (iid'ы отсортированы — канонично для обеих сторон)
// или 'group:<group_id>'.
const ROOM_RE = /^(dm:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+|group:[A-Za-z0-9-]+)$/;

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
    console.error('[chat] audit insert failed:', e.message);
  }
}

// Живое уведомление получателю. Полезная нагрузка не ездит по WS — только
// сигнал «приди и забери» (как cards_issued/config_shared).
function notifyRecipient(req, iid) {
  const wss = req.app.get('wssTauri');
  if (wss) {
    const { sendToInstallation } = require('../ws-tauri');
    sendToInstallation(iid, { type: 'chat_message' });
  }
  const io = req.app.get('io');
  if (io) io.emit('manager:chat_message', { installation_id: iid });
}

// Валидация формы конверта (сервер видит только форму — это и проверяем).
function parseEnvelope(sealed) {
  if (typeof sealed !== 'string' || sealed.length < 32 || sealed.length > MAX_SEALED_LEN) return null;
  let env;
  try { env = JSON.parse(sealed); } catch { return null; }
  if (!env || typeof env !== 'object') return null;
  if (!Number.isInteger(env.key_id) || env.key_id <= 0) return null;
  if (typeof env.ephemeral !== 'string' || !/^[0-9a-f]{64}$/.test(env.ephemeral)) return null;
  if (typeof env.nonce !== 'string' || !/^[0-9a-f]{24}$/.test(env.nonce)) return null;
  if (typeof env.ct !== 'string' || env.ct.length === 0) return null;
  return env;
}

function sanitizeRef(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const s = String(v).trim();
  if (s.length === 0) return null;
  if (s.length > MAX_REF_LEN) return undefined;
  return s;
}

function clampTtlHours(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_HOURS;
  return Math.min(n, MAX_TTL_HOURS);
}

// Ленивая уборка протухших блобов (мягкий TTL). Индекс по expires_at.
function purgeExpired(db) {
  try {
    db.prepare("DELETE FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  } catch (e) {
    console.error('[chat] purge failed:', e.message);
  }
}

function licenseByIid(db, iid) {
  return db.prepare('SELECT installation_id, role, is_active FROM licenses WHERE installation_id = ?').get(iid);
}

function groupOf(db, iid) {
  return db.prepare('SELECT group_id FROM sync_group_members WHERE installation_id = ?').get(iid)?.group_id || null;
}

// Конверт адресован ключу key_id; ключ обязан принадлежать получателю и быть
// активным (worker_keys для воркеров, manager_keys для менеджеров).
function keyBelongsToTarget(db, target, keyId) {
  const table = target.role === 'manager' ? 'manager_keys' : 'worker_keys';
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND installation_id = ? AND is_active = 1`)
    .get(keyId, target.installation_id);
}

function insertMessages(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO chat_messages (room, sender_iid, target_iid, sealed_data, ref_type, ref_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
  `);
  const ids = [];
  db.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(r.room, r.sender, r.target, r.sealed, r.refType, r.refId, `+${r.ttlHours} hours`);
      ids.push(info.lastInsertRowid);
    }
  })();
  return ids;
}

function fetchMessages(db, iid, sinceId, limit) {
  purgeExpired(db);
  return db.prepare(`
    SELECT id, room, sender_iid, sealed_data, ref_type, ref_id, created_at
    FROM chat_messages
    WHERE target_iid = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `).all(iid, sinceId, limit);
}

function latestKeysPerInstall(db, table, iids) {
  if (iids.length === 0) return [];
  const placeholders = iids.map(() => '?').join(',');
  return db.prepare(`
    SELECT k.installation_id, k.id AS key_id, k.pubkey, k.label AS key_label,
           l.label AS label, l.role
    FROM ${table} k
    JOIN licenses l ON l.installation_id = k.installation_id AND l.is_active = 1
    WHERE k.is_active = 1 AND k.installation_id IN (${placeholders})
      AND k.id = (SELECT MAX(k2.id) FROM ${table} k2 WHERE k2.installation_id = k.installation_id AND k2.is_active = 1)
  `).all(...iids);
}

// ── Worker ───────────────────────────────────────────────────────────────────

// GET /sync/chat/peers — с кем я могу говорить: члены моей sync-группы
// (legacy-группы живут, MGR-016) + активные менеджеры. Соло-воркер без группы
// видит только менеджеров. Публичные ключи не секретны (CHAT_E2E.md §4).
workerRouter.get('/chat/peers', (req, res) => {
  const db = getDb();
  const gid = groupOf(db, req.installationId);
  let workers = [];
  if (gid) {
    const iids = db.prepare(
      'SELECT installation_id FROM sync_group_members WHERE group_id = ? AND installation_id != ?'
    ).all(gid, req.installationId).map((r) => r.installation_id);
    workers = latestKeysPerInstall(db, 'worker_keys', iids);
  }
  const managerIids = db.prepare(
    "SELECT installation_id FROM licenses WHERE role = 'manager' AND is_active = 1"
  ).all().map((r) => r.installation_id);
  const managers = latestKeysPerInstall(db, 'manager_keys', managerIids)
    .map((m) => ({ ...m, role: 'manager' }));
  res.json({
    self: req.installationId,
    group_id: gid,
    peers: [...workers, ...managers].map((p) => ({
      installation_id: p.installation_id,
      key_id: p.key_id,
      pubkey: p.pubkey,
      label: p.label || '',
      role: p.role === 'manager' ? 'manager' : 'worker',
    })),
  });
});

// POST /sync/chat/send — { room, envelopes: [{target_iid, key_id, sealed_data}],
//                          ref_type?, ref_id?, ttl_hours? }. Атомарно: любой
// невалидный адресат — 400 на всё. Доступные адресаты: члены моей группы
// (для dm обязательно, для group: — room обязана быть моей группой) и любой
// активный менеджер (воркер ↔ менеджер работает и в соло-режиме).
workerRouter.post('/chat/send', (req, res) => {
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const envelopes = body.envelopes;
  if (!Array.isArray(envelopes) || envelopes.length === 0 || envelopes.length > MAX_ENVELOPES_PER_SEND) {
    return res.status(400).json({ error: 'envelopes_invalid' });
  }
  const refType = sanitizeRef(body.ref_type);
  const refId = sanitizeRef(body.ref_id);
  if (refType === undefined || refId === undefined) return res.status(400).json({ error: 'ref_invalid' });
  const ttlHours = clampTtlHours(body.ttl_hours);

  const db = getDb();
  const sender = req.installationId;
  const myGroup = groupOf(db, sender);

  if (room.startsWith('group:') && room !== `group:${myGroup}`) {
    return res.status(403).json({ error: 'not_my_group' });
  }
  if (room.startsWith('dm:') && !room.split(':').slice(1).includes(sender)) {
    return res.status(400).json({ error: 'dm_room_without_sender' });
  }

  const rows = [];
  for (const e of envelopes) {
    if (!e || typeof e !== 'object') return res.status(400).json({ error: 'envelopes_invalid' });
    const targetIid = typeof e.target_iid === 'string' ? e.target_iid : '';
    if (!targetIid || targetIid === sender) return res.status(400).json({ error: 'target_invalid' });
    const env = parseEnvelope(e.sealed_data);
    if (!env || env.key_id !== e.key_id) return res.status(400).json({ error: 'sealed_data_invalid' });
    const target = licenseByIid(db, targetIid);
    if (!target) return res.status(404).json({ error: 'unknown_installation', target_iid: targetIid });
    if (!target.is_active) return res.status(400).json({ error: 'license_revoked', target_iid: targetIid });
    const sameGroup = myGroup && groupOf(db, targetIid) === myGroup;
    if (!sameGroup && target.role !== 'manager') {
      return res.status(403).json({ error: 'target_not_allowed', target_iid: targetIid });
    }
    if (!keyBelongsToTarget(db, target, env.key_id)) {
      return res.status(409).json({ error: 'key_not_active_for_target', target_iid: targetIid });
    }
    rows.push({ room, sender, target: targetIid, sealed: e.sealed_data, refType, refId, ttlHours });
  }

  purgeExpired(db);
  const ids = insertMessages(db, rows);
  audit('chat_send', { sender, room, count: rows.length });
  const targets = [...new Set(rows.map((r) => r.target))];
  for (const t of targets) notifyRecipient(req, t);
  res.status(201).json({ ok: true, delivered: rows.length, ids });
});

// GET /sync/chat/messages?since_id=N — мои входящие блобы. Жизненный цикл —
// TTL на сервере; клиент дедуплицирует по id (UNIQUE server_id локально).
workerRouter.get('/chat/messages', (req, res) => {
  const sinceId = Number.isInteger(Number(req.query.since_id)) && Number(req.query.since_id) > 0
    ? Number(req.query.since_id) : 0;
  const messages = fetchMessages(getDb(), req.installationId, sinceId, MAX_FETCH_LIMIT);
  res.json({ messages });
});

// ── Manager ──────────────────────────────────────────────────────────────────

// GET /manager/api/chat/peers — все активные воркеры с активными ключами.
managerRouter.get('/chat/peers', (req, res) => {
  const db = getDb();
  const iids = db.prepare(
    "SELECT installation_id FROM licenses WHERE role != 'manager' AND is_active = 1"
  ).all().map((r) => r.installation_id);
  const workers = latestKeysPerInstall(db, 'worker_keys', iids);
  res.json({
    self: req.installationId,
    peers: workers.map((p) => ({
      installation_id: p.installation_id,
      key_id: p.key_id,
      pubkey: p.pubkey,
      label: p.label || '',
      role: 'worker',
    })),
  });
});

// POST /manager/api/chat/send — { target_iid, key_id, sealed_data, room?,
// ref_type?, ref_id?, ttl_hours? }. Один конверт одному воркеру; room по
// умолчанию — канонический dm (сортированные iid'ы).
managerRouter.post('/chat/send', (req, res) => {
  const body = req.body || {};
  const targetIid = typeof body.target_iid === 'string' ? body.target_iid : '';
  if (!targetIid) return res.status(400).json({ error: 'target_iid_required' });
  const sender = req.installationId;
  const room = typeof body.room === 'string' && body.room
    ? body.room
    : `dm:${[sender, targetIid].sort().join(':')}`;
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const env = parseEnvelope(body.sealed_data);
  if (!env || env.key_id !== body.key_id) return res.status(400).json({ error: 'sealed_data_invalid' });
  const refType = sanitizeRef(body.ref_type);
  const refId = sanitizeRef(body.ref_id);
  if (refType === undefined || refId === undefined) return res.status(400).json({ error: 'ref_invalid' });
  const ttlHours = clampTtlHours(body.ttl_hours);

  const db = getDb();
  const target = licenseByIid(db, targetIid);
  if (!target) return res.status(404).json({ error: 'unknown_installation' });
  if (target.role === 'manager') return res.status(400).json({ error: 'manager_is_not_a_recipient' });
  if (!target.is_active) return res.status(400).json({ error: 'license_revoked' });
  if (!keyBelongsToTarget(db, target, env.key_id)) {
    return res.status(409).json({ error: 'key_not_active_for_target' });
  }

  purgeExpired(db);
  const ids = insertMessages(db, [{
    room, sender, target: targetIid, sealed: body.sealed_data, refType, refId, ttlHours,
  }]);
  audit('manager_chat_send', { manager: sender, target_iid: targetIid, room });
  notifyRecipient(req, targetIid);
  res.status(201).json({ ok: true, id: ids[0] });
});

// GET /manager/api/chat/messages?since_id=N — входящие блобы менеджера.
managerRouter.get('/chat/messages', (req, res) => {
  const sinceId = Number.isInteger(Number(req.query.since_id)) && Number(req.query.since_id) > 0
    ? Number(req.query.since_id) : 0;
  const messages = fetchMessages(getDb(), req.installationId, sinceId, MAX_FETCH_LIMIT);
  res.json({ messages });
});

module.exports = { managerRouter, workerRouter };
