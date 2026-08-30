const express = require('express');
const { getDb } = require('../database');
const { requireToken } = require('../middleware');
const { applyCardPush, CardCreateForbiddenError, MAX_CARDS_PER_BATCH } = require('../card-push');
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

// MGR-016: группы и pair-коды выведены из эксплуатации (архитектура
// «воркер = потребитель»: карты создаёт только менеджер и раздаёт их
// запечатанными срезами через worker_keys). Легаси-члены сохраняют доступ
// к своим данным (info/leave/cards), но новый группы/коды/входы закрыты.
function groupsDeprecated(_req, res) {
  res.status(410).json({ error: 'groups_deprecated' });
}

// POST /sync/group/create — 410 Gone since MGR-016
router.post('/group/create', groupsDeprecated);

// POST /sync/group/pair — 410 Gone since MGR-016 (pair-коды больше не выдаются)
router.post('/group/pair', pairLimiter, groupsDeprecated);

// POST /sync/group/join — 410 Gone since MGR-016 (новые входы в группы закрыты)
router.post('/group/join', joinLimiter, groupsDeprecated);

// GET /sync/group/info — info about current group
router.get('/group/info', (req, res) => {
  const db = getDb();
  const installation_id = req.installationId;
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
  const installation_id = req.installationId;
  if (!installation_id) return res.status(403).json({ error: 'not_found' });

  db.prepare('DELETE FROM sync_group_members WHERE installation_id = ?').run(installation_id);

  res.json({ ok: true });
});

// POST /sync/cards — push card updates to group
router.post('/cards', (req, res) => {
  const db = getDb();
  const installation_id = req.installationId;
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
    // MGR-016: воркер — потребитель. Обновления статусов существующих карт
    // разрешены, создание новых карт с этого канала запрещено нацело.
    updated = applyCardPush(db, member.group_id, installation_id, cards, { allowCreate: false });
  } catch (e) {
    if (e instanceof CardCreateForbiddenError) {
      return res.status(403).json({ error: 'cards_import_disabled', rejected: e.hashes.length });
    }
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
  const installation_id = req.installationId;
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
  const installation_id = req.installationId;
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
