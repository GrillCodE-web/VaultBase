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
//!   воркер    GET  /sync/chat/outbox?updated_since= → мои исходящие + delivered_at
//!   менеджер  GET  /manager/api/chat/peers       → все активные воркеры с ключами
//!   менеджер  POST /manager/api/chat/send        → один конверт одному воркеру
//!   менеджер  GET  /manager/api/chat/messages    → входящие блобы менеджера
//!   менеджер  GET  /manager/api/chat/outbox      → исходящие менеджера + delivered_at
//!
//! CHAT-2.0 (manager-work-0bp): delivered = серверная пометка delivered_at в
//! момент выдачи блоба получателю (fetch). Read — E2E: клиент шлёт обратно
//! sealed-конверт с payload {"v":1,"type":"read_receipt","ids":[server_id...]},
//! сервер релеит его как обычное сообщение и ничего о нём не знает.
//!
//! Живые уведомления — WS {"type":"chat_message"} (воркер) и socket.io
//! "manager:chat_message" (менеджер); полезная нагрузка всё равно забирается
//! HTTP fetch'ем, как у срезов (cards_issued → /sync/cards/issued).

const express = require('express');
const crypto = require('node:crypto');
const { getDb } = require('../database');
const { requireManagerToken, requireWorkerToken } = require('../middleware');

const MAX_ENVELOPES_PER_SEND = 50;
const MAX_SEALED_LEN = 16 * 1024;
const MAX_REF_LEN = 64;
const MAX_FETCH_LIMIT = 200;
const DEFAULT_TTL_HOURS = 24 * 30; // 30 дней — мягкий TTL по умолчанию
const MAX_TTL_HOURS = 24 * 30;
// room: 'dm:<iidA>:<iidB>' (iid'ы отсортированы — канонично для обеих сторон),
// 'group:<group_id>' (лицензионная группа) или 'room:<id>' (m4i: пользовательская
// комната, состав в chat_room_members).
const ROOM_RE = /^(dm:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+|group:[A-Za-z0-9-]+|room:[A-Za-z0-9_-]+)$/;
const MAX_ROOM_TITLE = 120;
const MAX_ROOM_MEMBERS = 100;
// avm: sealed-вложения. Чанк — base64 шифротекста; ключ содержимого едет в
// E2E-конверте сообщения и на сервер не попадает. blob_id — 16 байт hex.
const MAX_BLOB_CHUNK_LEN = 96 * 1024;
const MAX_BLOB_CHUNKS = 220; // ~20 МБ шифротекста на вложение
const BLOB_ID_RE = /^[0-9a-f]{32}$/;

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

// avm: ленивая уборка протухших чанков вложений (мягкий TTL, как у сообщений).
function purgeExpiredBlobs(db) {
  try {
    db.prepare("DELETE FROM chat_blobs WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").run();
  } catch (e) {
    console.error('[chat] blob purge failed:', e.message);
  }
}

function licenseByIid(db, iid) {
  return db.prepare('SELECT installation_id, role, is_active FROM licenses WHERE installation_id = ?').get(iid);
}

function groupOf(db, iid) {
  return db.prepare('SELECT group_id FROM sync_group_members WHERE installation_id = ?').get(iid)?.group_id || null;
}

// m4i: 'room:<id>' — пользовательская комната. Состав в chat_room_members.
function isRoomMember(db, room, iid) {
  return !!db.prepare(
    'SELECT 1 FROM chat_room_members WHERE room_id = ? AND installation_id = ?'
  ).get(room, iid);
}

function roomMembersOf(db, room) {
  return db.prepare(
    'SELECT installation_id FROM chat_room_members WHERE room_id = ? ORDER BY added_at'
  ).all(room).map((r) => r.installation_id);
}

function roomMeta(db, room) {
  return db.prepare('SELECT id, owner_iid, title, created_at FROM chat_rooms WHERE id = ?').get(room) || null;
}

function isManagerSide(role) {
  return role === 'manager' || role === 'admin';
}

// Нормализация списка iid'ов из тела запроса: строки, активные лицензии,
// без дублей и без пустых. undefined → ошибка формы, [] → пусто.
function normalizeMemberList(db, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ROOM_MEMBERS) return undefined;
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0) return undefined;
    if (seen.has(v)) continue;
    const lic = licenseByIid(db, v);
    if (!lic || !lic.is_active) return undefined;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// Конверт адресован ключу key_id; ключ обязан принадлежать получателю и быть
// активным (worker_keys для воркеров, manager_keys для менеджеров).
// admin — manager-side роль: ключ может лежать в manager_keys (manager-app)
// или в worker_keys (та же лицензия на воркерской машине саппорта).
function keyBelongsToTarget(db, target, keyId) {
  const tables = target.role === 'manager' ? ['manager_keys']
    : target.role === 'admin' ? ['manager_keys', 'worker_keys']
    : ['worker_keys'];
  return tables.some((table) => !!db.prepare(
    `SELECT 1 FROM ${table} WHERE id = ? AND installation_id = ? AND is_active = 1`
  ).get(keyId, target.installation_id));
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
  const rows = db.prepare(`
    SELECT id, room, sender_iid, sealed_data, ref_type, ref_id, created_at
    FROM chat_messages
    WHERE target_iid = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `).all(iid, sinceId, limit);
  // Delivered = блоб выдан устройству. At-least-once: повторные fetch'и не
  // перезаписывают первый delivered_at (условие IS NULL). Разрешение %f
  // (миллисекунды), чтобы delivered_at строго > created_at той же секунды —
  // иначе курсор updated_since в outbox терял бы мгновенные доставки.
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    db.prepare(`
      UPDATE chat_messages SET delivered_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
      WHERE delivered_at IS NULL AND id IN (${placeholders})
    `).run(...rows.map((r) => r.id));
  }
  return rows;
}

// Исходящие отправителя для квитанций: курсор — метка времени, а не id, потому
// что delivered_at обновляется на УЖЕ известных клиенту строках. Возвращаем всё,
// что создано или доставлено после updated_since. sealed_data не отдаём никогда.
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

function fetchOutbox(db, iid, updatedSince, limit) {
  purgeExpired(db);
  return db.prepare(`
    SELECT id, room, target_iid, ref_type, ref_id, created_at, delivered_at
    FROM chat_messages
    WHERE sender_iid = ? AND COALESCE(delivered_at, created_at) > ?
    ORDER BY id ASC
    LIMIT ?
  `).all(iid, updatedSince, limit);
}

function outboxHandler(req, res) {
  const raw = req.query.updated_since;
  const updatedSince = typeof raw === 'string' && DATETIME_RE.test(raw)
    ? raw.replace('T', ' ').replace('Z', '').trim()
    : '1970-01-01 00:00:00';
  res.json({ messages: fetchOutbox(getDb(), req.installationId, updatedSince, MAX_FETCH_LIMIT) });
}

function latestKeysPerInstall(db, table, iids) {
  if (iids.length === 0) return [];
  const placeholders = iids.map(() => '?').join(',');
  return db.prepare(`
    SELECT k.installation_id, k.id AS key_id, k.pubkey, k.label AS key_label,
           l.label AS label, l.role, l.last_seen
    FROM ${table} k
    JOIN licenses l ON l.installation_id = k.installation_id AND l.is_active = 1
    WHERE k.is_active = 1 AND k.installation_id IN (${placeholders})
      AND k.id = (SELECT MAX(k2.id) FROM ${table} k2 WHERE k2.installation_id = k.installation_id AND k2.is_active = 1)
  `).all(...iids);
}

// CHAT-2.0 (iul): снапшот онлайна из WS-подключений. В юнит-тестах ws-tauri
// не инициализирован — тогда все оффлайн, но поле online присутствует.
function onlineSet() {
  try {
    const { getOnlineInstallations } = require('../ws-tauri');
    return new Set(getOnlineInstallations().map((o) => o.installation_id));
  } catch {
    return new Set();
  }
}

// ── Worker ───────────────────────────────────────────────────────────────────

// GET /sync/chat/peers — с кем я могу говорить: члены моей sync-группы
// (legacy-группы живут, MGR-016) + активные менеджеры. Соло-воркер без группы
// видит только менеджеров. Публичные ключи не секретны (CHAT_E2E.md §4).
workerRouter.get('/chat/peers', (req, res) => {
  const db = getDb();
  const gid = groupOf(db, req.installationId);
  // admin — manager-side (как в middleware): воркеры видят его как менеджера,
  // если у него есть активный manager-ключ (т.е. он реально запускает manager-app).
  const managerIids = db.prepare(
    "SELECT installation_id FROM licenses WHERE role IN ('manager', 'admin') AND is_active = 1"
  ).all().map((r) => r.installation_id);
  const managers = latestKeysPerInstall(db, 'manager_keys', managerIids)
    .map((m) => ({ ...m, role: 'manager' }));
  const managerPeerIids = new Set(managers.map((m) => m.installation_id));
  let workers = [];
  const workerIids = new Set();
  if (gid) {
    db.prepare(
      'SELECT installation_id FROM sync_group_members WHERE group_id = ? AND installation_id != ?'
    ).all(gid, req.installationId).forEach((r) => workerIids.add(r.installation_id));
  }
  // mgt: со-участники моих пользовательских комнат (m4i) тоже видны как peers —
  // иначе fan-out в комнату не сможет запечатать им конверты (в т.ч. тем, кого
  // пригласили по Chat-ID из другой группы).
  db.prepare(
    `SELECT DISTINCT m2.installation_id
       FROM chat_room_members m1
       JOIN chat_room_members m2 ON m2.room_id = m1.room_id
      WHERE m1.installation_id = ? AND m2.installation_id != ?`
  ).all(req.installationId, req.installationId).forEach((r) => workerIids.add(r.installation_id));
  if (workerIids.size) {
    // Дедупликация: admin с manager-ключом не дублируется воркером.
    workers = latestKeysPerInstall(db, 'worker_keys', [...workerIids])
      .filter((w) => !managerPeerIids.has(w.installation_id));
  }
  const online = onlineSet();
  // 19d: свой label (licenses.label) — для отображения/редактирования профиля.
  const selfLic = db.prepare(
    'SELECT label FROM licenses WHERE installation_id = ?'
  ).get(req.installationId);
  res.json({
    self: req.installationId,
    self_label: (selfLic && selfLic.label) || '',
    group_id: gid,
    peers: [...workers, ...managers].map((p) => ({
      installation_id: p.installation_id,
      key_id: p.key_id,
      pubkey: p.pubkey,
      label: p.label || '',
      role: p.role === 'manager' ? 'manager' : 'worker',
      // CHAT-2.0 (iul): presence — online по живому WS, last_seen из licenses.
      online: online.has(p.installation_id),
      last_seen: p.last_seen || null,
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
  // qhi: комната объявлений — read-only. Писать в неё может только менеджер
  // (через /manager/api/chat/send); воркеру доступно лишь чтение.
  if (room.startsWith('room:announcements-')) {
    return res.status(403).json({ error: 'announcements_readonly' });
  }
  // m4i: в пользовательскую комнату пишет только её член.
  if (room.startsWith('room:') && !isRoomMember(db, room, sender)) {
    return res.status(403).json({ error: 'not_room_member' });
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
    // m4i: в комнате адресатом может быть любой её член.
    const sameRoom = room.startsWith('room:') && isRoomMember(db, room, targetIid);
    // admin manager-side: писать ему можно без общей группы (как менеджеру).
    const targetIsManagerSide = isManagerSide(target.role);
    if (!sameGroup && !sameRoom && !targetIsManagerSide) {
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

// GET /sync/chat/outbox?updated_since=<datetime> — мои исходящие: статус
// delivered для своих сообщений (read приходит E2E-конвертом от получателя).
workerRouter.get('/chat/outbox', outboxHandler);

// CHAT-2.0 (g80): POST /sync/chat/typing — { room, target_iid }. Эфемерный
// сигнал «печатает…»: НИЧЕГО не храним, релеим по WS получателю кадром
// {"type":"chat_typing", room, from}. Те же правила адресации, что у
// /chat/send (своя группа или менеджер). Серверный троттлинг 2с на пару
// sender→target — защита от спама; клиент троттлит сам (3с).
const TYPING_THROTTLE_MS = 2000;
const typingLast = new Map(); // "sender>target" -> ts; чистим лениво
workerRouter.post('/chat/typing', (req, res) => {
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const targetIid = typeof body.target_iid === 'string' ? body.target_iid : '';
  const sender = req.installationId;
  if (!targetIid || targetIid === sender) return res.status(400).json({ error: 'target_invalid' });
  if (room.startsWith('dm:') && !room.split(':').slice(1).includes(sender)) {
    return res.status(400).json({ error: 'dm_room_without_sender' });
  }
  const db = getDb();
  const myGroup = groupOf(db, sender);
  if (room.startsWith('group:') && room !== `group:${myGroup}`) {
    return res.status(403).json({ error: 'not_my_group' });
  }
  // qhi: в комнате объявлений воркер не печатает (read-only).
  if (room.startsWith('room:announcements-')) {
    return res.status(403).json({ error: 'announcements_readonly' });
  }
  if (room.startsWith('room:') && !isRoomMember(db, room, sender)) {
    return res.status(403).json({ error: 'not_room_member' });
  }
  const target = licenseByIid(db, targetIid);
  if (!target) return res.status(404).json({ error: 'unknown_installation', target_iid: targetIid });
  if (!target.is_active) return res.status(400).json({ error: 'license_revoked', target_iid: targetIid });
  const sameGroup = myGroup && groupOf(db, targetIid) === myGroup;
  const sameRoom = room.startsWith('room:') && isRoomMember(db, room, targetIid);
  const targetIsManagerSide = isManagerSide(target.role);
  if (!sameGroup && !sameRoom && !targetIsManagerSide) {
    return res.status(403).json({ error: 'target_not_allowed', target_iid: targetIid });
  }
  const key = `${sender}>${targetIid}`;
  const now = Date.now();
  if (now - (typingLast.get(key) || 0) < TYPING_THROTTLE_MS) {
    return res.json({ ok: true, throttled: true });
  }
  typingLast.set(key, now);
  if (typingLast.size > 5000) {
    for (const [k, ts] of typingLast) if (now - ts > 60_000) typingLast.delete(k);
  }
  const wss = req.app.get('wssTauri');
  if (wss) {
    const { sendToInstallation } = require('../ws-tauri');
    sendToInstallation(targetIid, { type: 'chat_typing', room, from: sender });
  }
  const io = req.app.get('io');
  if (io) io.emit('manager:chat_typing', { installation_id: targetIid, room, from: sender });
  res.json({ ok: true });
});

// ── Manager ──────────────────────────────────────────────────────────────────

// GET /manager/api/chat/peers — все активные воркеры с активными ключами.
managerRouter.get('/chat/peers', (req, res) => {
  const db = getDb();
  const iids = db.prepare(
    "SELECT installation_id FROM licenses WHERE role != 'manager' AND is_active = 1"
  ).all().map((r) => r.installation_id);
  const workers = latestKeysPerInstall(db, 'worker_keys', iids);
  const online = onlineSet();
  res.json({
    self: req.installationId,
    peers: workers.map((p) => ({
      installation_id: p.installation_id,
      key_id: p.key_id,
      pubkey: p.pubkey,
      label: p.label || '',
      role: 'worker',
      // CHAT-2.0 (iul): presence, как и на worker-роуте.
      online: online.has(p.installation_id),
      last_seen: p.last_seen || null,
    })),
  });
});

// qhi: рассылка объявления — { room, envelopes:[{target_iid,key_id,sealed_data}],
// ref_type?, ref_id?, ttl_hours? }. Менеджер запечатывает объявление каждому
// адресату (fan-out per-recipient), сервер лишь релеит непрозрачные конверты.
function managerFanoutSend(req, res) {
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
    if (!keyBelongsToTarget(db, target, env.key_id)) {
      return res.status(409).json({ error: 'key_not_active_for_target', target_iid: targetIid });
    }
    rows.push({ room, sender, target: targetIid, sealed: e.sealed_data, refType, refId, ttlHours });
  }

  purgeExpired(db);
  const ids = insertMessages(db, rows);
  audit('manager_chat_fanout', { manager: sender, room, count: rows.length });
  const targets = [...new Set(rows.map((r) => r.target))];
  for (const t of targets) notifyRecipient(req, t);
  res.status(201).json({ ok: true, delivered: rows.length, ids });
}

// POST /manager/api/chat/send — { target_iid, key_id, sealed_data, room?,
// ref_type?, ref_id?, ttl_hours? }. Один конверт одному воркеру; room по
// умолчанию — канонический dm (сортированные iid'ы).
managerRouter.post('/chat/send', (req, res) => {
  const body = req.body || {};
  // qhi: fan-out — массив конвертов в комнату (рассылка объявлений). Один POST
  // доставляет одно объявление всем адресатам, каждому свой sealed-конверт.
  if (Array.isArray(body.envelopes)) return managerFanoutSend(req, res);
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

// GET /manager/api/chat/outbox?updated_since=<datetime> — исходящие менеджера.
managerRouter.get('/chat/outbox', outboxHandler);

// CHAT (t8l): POST /chat/delete — hard-delete БЕЗ «могилки». Удалять можно
// ТОЛЬКО свои конверты (sender_iid == вызывающий): при fan-out это все строки
// сообщения на сервере, ещё не забранные получателями. У получателей, уже
// скачавших конверт, стирание идёт E2E-конвертом {type:"delete"} через
// /chat/send — сервер эту семантику не видит. Идемпотентно.
function deleteHandler(req, res) {
  const body = req.body || {};
  const ids = Array.isArray(body.ids)
    ? body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0 || ids.length > MAX_FETCH_LIMIT) {
    return res.status(400).json({ error: 'ids_invalid' });
  }
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(
    `DELETE FROM chat_messages WHERE id IN (${placeholders}) AND sender_iid = ?`
  ).run(...ids, req.installationId);
  audit('chat_delete', { sender: req.installationId, requested: ids.length, deleted: info.changes });
  res.json({ ok: true, deleted: info.changes });
}

workerRouter.post('/chat/delete', deleteHandler);
managerRouter.post('/chat/delete', deleteHandler);

// ── Комнаты (m4i) ─────────────────────────────────────────────────────────────
// POST /chat/rooms { title, members?:[iid] } — создать комнату. Создатель —
// владелец и первый член. Возвращает room-ключ 'room:<id>'.
// yyt: доступ к комнате для чтения/пина. Менеджер/админ видит всё; иначе —
// член своей группы (group:), участник dm: или член room:.
function canAccessRoom(db, iid, room) {
  const lic = licenseByIid(db, iid);
  if (lic && isManagerSide(lic.role)) return true;
  if (room.startsWith('group:')) return room === `group:${groupOf(db, iid)}`;
  if (room.startsWith('dm:')) return room.split(':').slice(1).includes(iid);
  if (room.startsWith('room:')) return isRoomMember(db, room, iid);
  return false;
}

// avm: приём одного зашифрованного чанка вложения. Тело:
// { room, blob_id, chunk_index, chunk_count, data, ttlHours? }. Сервер не
// расшифровывает data — только проверяет форму, доступ к комнате и лимиты.
function blobUploadHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  if (!canAccessRoom(db, iid, room)) return res.status(403).json({ error: 'forbidden' });
  const blobId = typeof body.blob_id === 'string' ? body.blob_id : '';
  if (!BLOB_ID_RE.test(blobId)) return res.status(400).json({ error: 'blob_id_invalid' });
  const count = Number.isInteger(body.chunk_count) ? body.chunk_count : parseInt(body.chunk_count, 10);
  if (!Number.isInteger(count) || count <= 0 || count > MAX_BLOB_CHUNKS) {
    return res.status(400).json({ error: 'chunk_count_invalid' });
  }
  const idx = Number.isInteger(body.chunk_index) ? body.chunk_index : parseInt(body.chunk_index, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
    return res.status(400).json({ error: 'chunk_index_invalid' });
  }
  const data = typeof body.data === 'string' ? body.data : '';
  if (data.length === 0 || data.length > MAX_BLOB_CHUNK_LEN) {
    return res.status(400).json({ error: 'data_invalid' });
  }
  const ttlHours = clampTtlHours(body.ttlHours);
  db.prepare(`
    INSERT INTO chat_blobs (blob_id, chunk_index, chunk_count, data, owner_iid, room, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))
    ON CONFLICT(blob_id, chunk_index) DO UPDATE SET
      data = excluded.data, chunk_count = excluded.chunk_count, expires_at = excluded.expires_at
  `).run(blobId, idx, count, data, iid, room, `+${ttlHours} hours`);
  res.status(201).json({ ok: true, blob_id: blobId, chunk_index: idx });
}

// avm: отдать вложение целиком (все чанки по порядку) участнику комнаты.
function blobGetHandler(req, res) {
  const db = getDb();
  purgeExpiredBlobs(db);
  const blobId = typeof req.params.blobId === 'string' ? req.params.blobId : '';
  if (!BLOB_ID_RE.test(blobId)) return res.status(400).json({ error: 'blob_id_invalid' });
  const meta = db.prepare('SELECT room, chunk_count FROM chat_blobs WHERE blob_id = ? LIMIT 1').get(blobId);
  if (!meta) return res.status(404).json({ error: 'blob_unknown' });
  if (!canAccessRoom(db, req.installationId, meta.room)) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare(
    'SELECT chunk_index, data FROM chat_blobs WHERE blob_id = ? ORDER BY chunk_index ASC'
  ).all(blobId);
  if (rows.length !== meta.chunk_count) {
    return res.status(409).json({ error: 'blob_incomplete', have: rows.length, need: meta.chunk_count });
  }
  res.json({ blob_id: blobId, chunk_count: meta.chunk_count, chunks: rows.map((r) => r.data) });
}

// yyt: список закреплённых сообщений комнаты (id + кто/когда закрепил).
function pinsListHandler(req, res) {
  const db = getDb();
  const room = typeof req.query.room === 'string' ? req.query.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  if (!canAccessRoom(db, req.installationId, room)) return res.status(403).json({ error: 'forbidden' });
  const pins = db.prepare(
    'SELECT message_id, pinned_by, pinned_at FROM chat_pins WHERE room = ? ORDER BY pinned_at DESC'
  ).all(room).map((p) => ({ message_id: p.message_id, pinned_by: p.pinned_by, pinned_at: p.pinned_at }));
  res.json({ room, pins });
}

// yyt: закрепить/открепить сообщение. Тело: { room, message_id, pinned:bool }.
function pinSetHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const messageId = Number.isInteger(body.message_id) ? body.message_id : parseInt(body.message_id, 10);
  if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'message_id_invalid' });
  if (!canAccessRoom(db, iid, room)) return res.status(403).json({ error: 'forbidden' });
  const pinned = body.pinned !== false;
  if (pinned) {
    db.prepare(
      'INSERT OR IGNORE INTO chat_pins (room, message_id, pinned_by) VALUES (?, ?, ?)'
    ).run(room, messageId, iid);
  } else {
    db.prepare('DELETE FROM chat_pins WHERE room = ? AND message_id = ?').run(room, messageId);
  }
  audit('chat_pin', { room, message_id: messageId, by: iid, pinned });
  const pins = db.prepare(
    'SELECT message_id, pinned_by, pinned_at FROM chat_pins WHERE room = ? ORDER BY pinned_at DESC'
  ).all(room).map((p) => ({ message_id: p.message_id, pinned_by: p.pinned_by, pinned_at: p.pinned_at }));
  res.json({ ok: true, room, pins });
}

// 6if: агрегированные реакции комнаты — [{message_id, emoji, count, reactors[]}].
function reactionsListHandler(req, res) {
  const db = getDb();
  const room = typeof req.query.room === 'string' ? req.query.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  if (!canAccessRoom(db, req.installationId, room)) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare(
    'SELECT message_id, emoji, reactor FROM chat_reactions WHERE room = ? ORDER BY created_at ASC'
  ).all(room);
  const map = new Map();
  for (const r of rows) {
    const key = `${r.message_id}\u0000${r.emoji}`;
    if (!map.has(key)) map.set(key, { message_id: r.message_id, emoji: r.emoji, reactors: [] });
    map.get(key).reactors.push(r.reactor);
  }
  const reactions = [...map.values()].map((x) => ({ ...x, count: x.reactors.length }));
  res.json({ room, reactions });
}

// 6if: поставить/снять реакцию (toggle). Тело: { room, message_id, emoji }.
function reactionSetHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!ROOM_RE.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const messageId = Number.isInteger(body.message_id) ? body.message_id : parseInt(body.message_id, 10);
  if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'message_id_invalid' });
  const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : '';
  if (!emoji || emoji.length > 16) return res.status(400).json({ error: 'emoji_invalid' });
  if (!canAccessRoom(db, iid, room)) return res.status(403).json({ error: 'forbidden' });
  const existing = db.prepare(
    'SELECT 1 FROM chat_reactions WHERE room = ? AND message_id = ? AND reactor = ? AND emoji = ?'
  ).get(room, messageId, iid, emoji);
  let active;
  if (existing) {
    db.prepare('DELETE FROM chat_reactions WHERE room = ? AND message_id = ? AND reactor = ? AND emoji = ?')
      .run(room, messageId, iid, emoji);
    active = false;
  } else {
    db.prepare('INSERT OR IGNORE INTO chat_reactions (room, message_id, reactor, emoji) VALUES (?, ?, ?, ?)')
      .run(room, messageId, iid, emoji);
    active = true;
  }
  audit('chat_reaction', { room, message_id: messageId, by: iid, emoji, active });
  const rows = db.prepare(
    'SELECT message_id, emoji, reactor FROM chat_reactions WHERE room = ? ORDER BY created_at ASC'
  ).all(room);
  const map = new Map();
  for (const r of rows) {
    const key = `${r.message_id}\u0000${r.emoji}`;
    if (!map.has(key)) map.set(key, { message_id: r.message_id, emoji: r.emoji, reactors: [] });
    map.get(key).reactors.push(r.reactor);
  }
  const reactions = [...map.values()].map((x) => ({ ...x, count: x.reactors.length }));
  res.json({ ok: true, room, active, reactions });
}

// 19d: сменить свой публичный label (licenses.label). Пустая строка — сброс.
function profileSetHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const body = req.body || {};
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (label.length > 48) return res.status(400).json({ error: 'label_too_long' });
  db.prepare('UPDATE licenses SET label = ? WHERE installation_id = ?').run(label, iid);
  audit('chat_profile', { by: iid, label });
  res.json({ ok: true, label });
}

function createRoomHandler(req, res) {
  const db = getDb();
  const owner = req.installationId;
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_ROOM_TITLE) return res.status(400).json({ error: 'title_invalid' });
  const members = normalizeMemberList(db, body.members);
  if (members === undefined) return res.status(400).json({ error: 'members_invalid' });
  const roomId = `room:${crypto.randomBytes(9).toString('hex')}`;
  const all = [...new Set([owner, ...members])];
  const insRoom = db.prepare('INSERT INTO chat_rooms (id, owner_iid, title) VALUES (?, ?, ?)');
  const insMem = db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, installation_id) VALUES (?, ?)');
  db.transaction(() => {
    insRoom.run(roomId, owner, title);
    for (const m of all) insMem.run(roomId, m);
  })();
  audit('chat_room_create', { owner, room: roomId, members: all.length });
  res.status(201).json({ ok: true, room: roomId, title, owner_iid: owner, members: all });
}

// GET /chat/rooms — комнаты вызывающего; менеджер/админ видит все (m4i).
function listRoomsHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const lic = licenseByIid(db, iid);
  const seeAll = lic && isManagerSide(lic.role);
  const rows = seeAll
    ? db.prepare('SELECT id, owner_iid, title, created_at FROM chat_rooms ORDER BY created_at DESC').all()
    : db.prepare(
        `SELECT r.id, r.owner_iid, r.title, r.created_at
         FROM chat_rooms r JOIN chat_room_members m ON m.room_id = r.id
         WHERE m.installation_id = ? ORDER BY r.created_at DESC`
      ).all(iid);
  res.json({
    rooms: rows.map((r) => ({
      room: r.id,
      owner_iid: r.owner_iid,
      title: r.title,
      created_at: r.created_at,
      members: roomMembersOf(db, r.id),
    })),
  });
}

// POST /chat/rooms/members { room, add?:[iid], remove?:[iid] } — правит состав.
// Разрешено владельцу комнаты или менеджеру/админу. Владельца выкинуть нельзя.
function roomMembersHandler(req, res) {
  const db = getDb();
  const iid = req.installationId;
  const body = req.body || {};
  const room = typeof body.room === 'string' ? body.room : '';
  if (!/^room:[A-Za-z0-9_-]+$/.test(room)) return res.status(400).json({ error: 'room_invalid' });
  const meta = roomMeta(db, room);
  if (!meta) return res.status(404).json({ error: 'room_unknown' });
  const lic = licenseByIid(db, iid);
  const canManage = meta.owner_iid === iid || (lic && isManagerSide(lic.role));
  if (!canManage) return res.status(403).json({ error: 'not_room_owner' });
  const add = normalizeMemberList(db, body.add);
  if (add === undefined) return res.status(400).json({ error: 'members_invalid' });
  const removeRaw = body.remove === undefined || body.remove === null ? [] : body.remove;
  if (!Array.isArray(removeRaw) || removeRaw.length > MAX_ROOM_MEMBERS
    || removeRaw.some((v) => typeof v !== 'string' || v.length === 0)) {
    return res.status(400).json({ error: 'members_invalid' });
  }
  const insMem = db.prepare('INSERT OR IGNORE INTO chat_room_members (room_id, installation_id) VALUES (?, ?)');
  const delMem = db.prepare('DELETE FROM chat_room_members WHERE room_id = ? AND installation_id = ?');
  db.transaction(() => {
    for (const m of add) insMem.run(room, m);
    for (const m of removeRaw) {
      if (m === meta.owner_iid) continue; // владельца не выкидываем
      delMem.run(room, m);
    }
  })();
  audit('chat_room_members', { room, by: iid, added: add.length, removed: removeRaw.length });
  res.json({ ok: true, room, members: roomMembersOf(db, room) });
}

workerRouter.post('/chat/rooms', createRoomHandler);
managerRouter.post('/chat/rooms', createRoomHandler);
workerRouter.get('/chat/rooms', listRoomsHandler);
managerRouter.get('/chat/rooms', listRoomsHandler);
workerRouter.post('/chat/rooms/members', roomMembersHandler);
managerRouter.post('/chat/rooms/members', roomMembersHandler);
// yyt: закреплённые сообщения — доступны обеим сторонам relay'я.
workerRouter.get('/chat/pins', pinsListHandler);
managerRouter.get('/chat/pins', pinsListHandler);
workerRouter.post('/chat/pins', pinSetHandler);
managerRouter.post('/chat/pins', pinSetHandler);
workerRouter.post('/chat/profile', profileSetHandler);
managerRouter.post('/chat/profile', profileSetHandler);
// 6if: реакции-эмодзи — доступны обеим сторонам relay'я.
workerRouter.get('/chat/reactions', reactionsListHandler);
managerRouter.get('/chat/reactions', reactionsListHandler);
workerRouter.post('/chat/reactions', reactionSetHandler);
managerRouter.post('/chat/reactions', reactionSetHandler);
// avm: sealed-вложения (blob-relay) — доступны обеим сторонам relay'я.
workerRouter.post('/chat/blob/upload', blobUploadHandler);
managerRouter.post('/chat/blob/upload', blobUploadHandler);
workerRouter.get('/chat/blob/:blobId', blobGetHandler);
managerRouter.get('/chat/blob/:blobId', blobGetHandler);

module.exports = { managerRouter, workerRouter };
