const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');
const { requireToken } = require('../middleware');
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

const STATUS_WEIGHT = { dead: 5, declined: 4, archive: 3, in_use: 2, free: 1 };

/** SQL expression computing the monotonic status weight of `col`. */
const weightExpr = (col) => Object.entries(STATUS_WEIGHT)
  .map(([s, w]) => `${w} * (${col}='${s}')`)
  .join(' + ');

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
  const { name } = req.body || {};
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
  const group_key = generateGroupKey();

  db.prepare('INSERT INTO sync_groups (id, name, created_by, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .run(group_id, name || 'Sync Group', installation_id);

  // group_key хранится на сервере в открытом виде; реальное шифрование данных выполняется на клиенте
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

  let code, attempts = 0;
  do {
    code = generatePairCode();
    attempts++;
  } while (db.prepare('SELECT 1 FROM sync_pair_codes WHERE code = ? AND expires_at > CURRENT_TIMESTAMP').get(code) && attempts < 10);

  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 19);
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

  const pairCode = db.prepare(`
    SELECT * FROM sync_pair_codes
    WHERE code = ? AND expires_at > CURRENT_TIMESTAMP AND used_by IS NULL
  `).get(code.toUpperCase());

  if (!pairCode) return res.status(404).json({ error: 'invalid_or_expired_code' });

  // Get group_key from creator's membership
  const creatorMember = db.prepare(
    'SELECT group_key_encrypted FROM sync_group_members WHERE installation_id = ? AND group_id = ?'
  ).get(pairCode.created_by, pairCode.group_id);

  if (!creatorMember) return res.status(500).json({ error: 'group_key_not_found' });

  // Add to group
  db.prepare(
    'INSERT INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
  ).run(pairCode.group_id, installation_id, creatorMember.group_key_encrypted);

  // Mark code as used
  db.prepare('UPDATE sync_pair_codes SET used_by = ? WHERE code = ?').run(installation_id, code.toUpperCase());

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
    group_key: creatorMember.group_key_encrypted,
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

  const stmt = db.prepare(`
    INSERT INTO sync_cards (card_hash, group_id, encrypted_data, status, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(card_hash, group_id) DO UPDATE SET
      encrypted_data = CASE WHEN (${weightExpr('status')}) >= (${weightExpr('excluded.status')})
                            THEN sync_cards.encrypted_data ELSE excluded.encrypted_data END,
      status = CASE WHEN (${weightExpr('status')}) >= (${weightExpr('excluded.status')})
                    THEN sync_cards.status ELSE excluded.status END,
      notes  = CASE WHEN (${weightExpr('status')}) >= (${weightExpr('excluded.status')})
                    THEN sync_cards.notes ELSE excluded.notes END,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `);

  // The conflict resolver uses monotonic status weights (higher always wins), so a
  // partially-applied batch can never be repaired by a later sync — the client
  // believes it already pushed those rows. All writes go through one transaction.
  // better-sqlite3 transactions are synchronous; nothing inside may await.
  let updated;
  try {
    updated = db.transaction(() => {
      const written = [];
      for (const card of cards) {
        if (!card.card_hash || !card.status) continue;
        stmt.run(card.card_hash, member.group_id, card.encrypted_data || null, card.status, card.notes || null, installation_id);
        written.push({ card_hash: card.card_hash, status: card.status });
      }
      return written;
    })();
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
