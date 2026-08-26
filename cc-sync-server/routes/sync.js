const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { requireToken } = require('../middleware');
const { applyCardPush, MAX_CARDS_PER_BATCH } = require('../card-push');
const { sanitizeCourierTag, applyCourierTag } = require('../courier-tags');
const rateLimit = require('express-rate-limit');

// Max 10 join attempts per IP per 15 minutes (pair codes expire in 15min)
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
  skip: (req) => false,
});

// Max 20 pair code generations per hour per token
const pairLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.userToken || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many pair code requests.' },
});

const router = express.Router();
router.use(requireToken);

function generateGroupKey() {
  return crypto.randomBytes(32).toString('hex');
}

// FIX API-H04: Use crypto.randomBytes instead of Math.random for unpredictable pair codes
function generatePairCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomBytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return code;
}

// POST /sync/group/create — create a group, get group_key
router.post('/group/create', (req, res) => {
  const db = getDb();
  const { name, group_key: client_gk } = req.body || {};
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  // Check if already in a group
  const existing = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (existing) return res.status(409).json({ error: 'already_in_group', group_id: existing.group_id });

  const group_id = crypto.randomUUID();
  // SEC-008: клиент присылает свой blob ключа группы (зашифрован его
  // мастер-паролем — сервер видит только opaque-строку). Если не прислал —
  // legacy-режим: генерируем ключ на сервере, как раньше.
  const group_key = (typeof client_gk === 'string' && client_gk.length >= 16 && client_gk.length <= 2048)
    ? client_gk
    : generateGroupKey();

  db.prepare('INSERT INTO sync_groups (id, name, created_by, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .run(group_id, name || 'Sync Group', installation_id);

  // В E2E-режиме group_key_encrypted действительно содержит зашифрованный
  // клиентом ключ; в legacy-режиме — открытый hex (старое поведение).
  db.prepare(`
    INSERT INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(group_id, installation_id, group_key);

  res.json({ ok: true, group_id, group_key });
});

// POST /sync/group/pair — create a pair code (TTL 15 min)
router.post('/group/pair', pairLimiter, (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  const member = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (!member) return res.status(404).json({ error: 'not_in_group' });

  const { code_hash, enc_group_key } = req.body || {};
  // expires_at храним в формате CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS"),
  // иначе строковое сравнение с 'T'-разделителем ломает TTL.
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  // SEC-008 zero-knowledge flow: клиент генерирует код сам и присылает только
  // его SHA-256 хеш + ключ группы, зашифрованный ключом, выведенным из кода.
  // Сервер никогда не видит ни сам код, ни открытый ключ группы.
  if (typeof code_hash === 'string' && /^[0-9a-f]{64}$/.test(code_hash)
      && typeof enc_group_key === 'string' && enc_group_key.length >= 16 && enc_group_key.length <= 4096) {
    const existing = db.prepare(
      'SELECT 1 FROM sync_pair_codes WHERE code_hash = ? AND expires_at > CURRENT_TIMESTAMP'
    ).get(code_hash);
    if (existing) return res.status(409).json({ error: 'code_collision' });

    db.prepare(
      'INSERT INTO sync_pair_codes (code, code_hash, enc_group_key, group_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code_hash, code_hash, enc_group_key, member.group_id, installation_id, expires_at);

    return res.json({ ok: true, expires_at });
  }

  // Legacy flow: сервер генерирует код в открытом виде (старые клиенты).
  let code, attempts = 0;
  do {
    code = generatePairCode();
    attempts++;
  } while (db.prepare('SELECT 1 FROM sync_pair_codes WHERE code = ? AND expires_at > CURRENT_TIMESTAMP').get(code) && attempts < 10);

  db.prepare(
    'INSERT INTO sync_pair_codes (code, group_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
  ).run(code, member.group_id, installation_id, expires_at);

  res.json({ ok: true, code, expires_at });
});

// POST /sync/group/join — join by pair code, get group_key + current cards
router.post('/group/join', joinLimiter, (req, res) => {
  const db = getDb();
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });

  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  // Check if already in a group
  const existing = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (existing) return res.status(409).json({ error: 'already_in_group', group_id: existing.group_id });

  // SEC-008: код сначала хешируем — zero-knowledge строки хранят только
  // SHA-256 от кода; OR по открытому коду оставлен для legacy-кодов.
  const codeUpper = code.toUpperCase();
  const codeHash = crypto.createHash('sha256').update(codeUpper).digest('hex');
  const pairCode = db.prepare(`
    SELECT rowid, * FROM sync_pair_codes
    WHERE (code_hash = ? OR code = ?) AND expires_at > CURRENT_TIMESTAMP AND used_by IS NULL
  `).get(codeHash, codeUpper);

  if (!pairCode) return res.status(404).json({ error: 'invalid_or_expired_code' });

  // Get group_key from creator's membership
  const creatorMember = db.prepare(
    'SELECT group_key_encrypted FROM sync_group_members WHERE installation_id = ? AND group_id = ?'
  ).get(pairCode.created_by, pairCode.group_id);

  if (!creatorMember) return res.status(500).json({ error: 'group_key_not_found' });

  // SEC-008: если пара создана zero-knowledge клиентом, отдаём E2E-blob
  // (зашифрован ключом из pair-кода — расшифрует только тот, кто знает код).
  // Иначе legacy: blob/hex из записи создателя группы.
  const group_key = pairCode.enc_group_key || creatorMember.group_key_encrypted;

  // Add to group
  db.prepare(
    'INSERT INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
  ).run(pairCode.group_id, installation_id, group_key);

  // Mark code as used (rowid — потому что у ZK-строк code хранит хеш)
  db.prepare('UPDATE sync_pair_codes SET used_by = ? WHERE rowid = ?').run(installation_id, pairCode.rowid);

  // Get current cards for this group
  const cards = db.prepare(
    'SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at FROM sync_cards WHERE group_id = ? ORDER BY updated_at DESC'
  ).all(pairCode.group_id);

  // Get group info
  const group = db.prepare('SELECT id, name FROM sync_groups WHERE id = ?').get(pairCode.group_id);

  // Notify via socket.io if available
  const io = req.app.get('io');
  if (io) {
    io.emitToGroup(pairCode.group_id, 'group:member_joined', { installation_id });
  }

  res.json({
    ok: true,
    group_id: pairCode.group_id,
    group_key,
    group_name: group?.name || 'Sync Group',
    cards,
  });
});

// GET /sync/group/info — info about current group
router.get('/group/info', (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  const member = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (!member) return res.status(404).json({ error: 'not_in_group' });

  const group = db.prepare('SELECT id, name, created_by, created_at FROM sync_groups WHERE id = ?').get(member.group_id);
  const members = db.prepare(
    'SELECT installation_id, joined_at FROM sync_group_members WHERE group_id = ? ORDER BY joined_at ASC'
  ).all(member.group_id);
  const card_count = db.prepare('SELECT COUNT(*) AS n FROM sync_cards WHERE group_id = ?').get(member.group_id).n;

  res.json({
    group_id: member.group_id,
    name: group?.name || 'Sync Group',
    created_by: group?.created_by,
    created_at: group?.created_at,
    members: members.map(m => ({ installation_id: m.installation_id, joined_at: m.joined_at })),
    card_count,
  });
});

// POST /sync/group/leave — leave current group
router.post('/group/leave', (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  db.prepare('DELETE FROM sync_group_members WHERE installation_id = ?').run(installation_id);

  res.json({ ok: true });
});

// POST /sync/cards — push card updates to group
router.post('/cards', (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  const member = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (!member) return res.status(404).json({ error: 'not_in_group' });

  const { cards } = req.body || {};
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards array required' });
  // Валидация и conflict-resolution общие для всех каналов синка (card-push.js).
  if (cards.length > MAX_CARDS_PER_BATCH) {
    return res.status(400).json({ error: 'too_many_cards' });
  }

  let updated;
  try {
    updated = applyCardPush(db, member.group_id, installation_id, cards);
  } catch (e) {
    console.error('[sync/cards] batch transaction failed:', e.message);
    return res.status(500).json({ error: 'push_failed' });
  }

  // Broadcast via socket.io
  const io = req.app.get('io');
  if (io && updated.length > 0) {
    io.emitToGroup(member.group_id, 'card:update', {
      cards: updated,
      updated_by: installation_id,
      updated_at: new Date().toISOString(),
    });
  }

  res.json({ ok: true, updated: updated.length });
});

// POST /sync/courier_tag — FEAT-010: push courier tag to group (real-time).
// Payload: { provider, courier_hash (sha256 hex), tag, action: 'add'|'remove' }.
// The server stores and relays hashes only — courier names/addresses never
// leave the desktop client.
router.post('/courier_tag', (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  const member = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (!member) return res.status(404).json({ error: 'not_in_group' });

  // Валидация и upsert общие для всех каналов синка (courier-tags.js).
  const row = sanitizeCourierTag(req.body);
  if (!row) return res.status(400).json({ error: 'invalid_courier_tag' });

  try {
    applyCourierTag(db, member.group_id, installation_id, row);
  } catch (e) {
    console.error('[sync/courier_tag] upsert failed:', e.message);
    return res.status(500).json({ error: 'push_failed' });
  }

  const event = {
    type: 'courier_tag',
    ...row,
    updated_by: installation_id,
    updated_at: new Date().toISOString(),
  };
  // Tauri clients: group-scoped broadcast, excluding the sender.
  const { broadcastToGroup } = require('../ws-tauri');
  broadcastToGroup(member.group_id, event, installation_id);
  // Browser admin (socket.io room).
  const io = req.app.get('io');
  if (io) io.to(`group:${member.group_id}`).emit('courier_tag', event);

  res.json({ ok: true });
});

// GET /sync/cards — pull all cards for current group
router.get('/cards', (req, res) => {
  const db = getDb();
  const installation_id = db.prepare(
    'SELECT installation_id FROM licenses WHERE token = ?'
  ).get(req.userToken)?.installation_id;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  const member = db.prepare(
    'SELECT group_id FROM sync_group_members WHERE installation_id = ?'
  ).get(installation_id);
  if (!member) return res.status(404).json({ error: 'not_in_group' });

  const since = req.query.since; // ISO timestamp for incremental sync
  let cards;
  if (since) {
    cards = db.prepare(
      'SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at FROM sync_cards WHERE group_id = ? AND updated_at > ? ORDER BY updated_at DESC'
    ).all(member.group_id, since);
  } else {
    cards = db.prepare(
      'SELECT card_hash, encrypted_data, status, notes, updated_by, updated_at FROM sync_cards WHERE group_id = ? ORDER BY updated_at DESC'
    ).all(member.group_id);
  }

  res.json({ cards });
});

module.exports = router;
