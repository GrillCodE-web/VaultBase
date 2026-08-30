//! Shared card-push logic for all sync channels (raw WS, Socket.io, REST).
//! Previously the same validation + conflict-resolution SQL lived in three
//! copies (ws-tauri.js, socket.js, routes/sync.js) and had already drifted:
//! REST accepted invalid statuses, short hashes, unbounded notes and batches.

const STATUS_WEIGHT = { dead: 5, declined: 4, archive: 3, in_use: 2, free: 1 };
const VALID_STATUSES = ['free', 'in_use', 'archive', 'declined', 'dead'];
const MAX_CARDS_PER_BATCH = 100;
const MAX_NOTES_LEN = 500;

function weight(s) { return STATUS_WEIGHT[s] || 0; }

/** SQL expression computing the monotonic status weight of `col`. */
function weightExpr(col) {
  return Object.entries(STATUS_WEIGHT)
    .map(([s, w]) => `${w} * (${col}='${s}')`)
    .join(' + ');
}

/**
 * Validate one pushed card. Returns sanitized { card_hash, status, notes,
 * encrypted_data } or null when the row must be skipped.
 */
function sanitizeCard(card) {
  if (!card || typeof card !== 'object') return null;
  if (!card.card_hash || typeof card.card_hash !== 'string' || card.card_hash.length < 8) return null;
  if (!card.status || !VALID_STATUSES.includes(card.status)) return null;
  return {
    card_hash: card.card_hash,
    status: card.status,
    notes: typeof card.notes === 'string' ? card.notes.slice(0, MAX_NOTES_LEN) : null,
    encrypted_data: typeof card.encrypted_data === 'string' ? card.encrypted_data : null,
  };
}

/**
 * Error thrown when a push channel is not allowed to create cards
 * (MGR-016: воркер = потребитель, карты создаёт только менеджер).
 * The HTTP layer maps it to 403 cards_import_disabled.
 */
class CardCreateForbiddenError extends Error {
  constructor(hashes) {
    super('card creation is disabled on this channel');
    this.code = 'cards_import_disabled';
    this.hashes = hashes;
  }
}

/**
 * Apply a batch of card updates atomically.
 *
 * The conflict resolver uses monotonic status weights (higher always wins), so a
 * partially-applied batch can never be repaired by a later sync — the client
 * believes it already pushed those rows. All writes go through a single
 * better-sqlite3 transaction. Transactions are synchronous: nothing inside the
 * transaction callback may await.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowCreate=true] when false, the batch must only
 *   update cards that already exist in this group (worker channels after
 *   MGR-016); a batch containing an unknown card_hash is rejected whole.
 * @returns {Array<{card_hash: string, status: string}>} rows that were written
 */
function applyCardPush(db, groupId, installationId, cards, opts = {}) {
  const allowCreate = opts.allowCreate !== false;
  const cur = weightExpr('status');
  const inc = weightExpr('excluded.status');
  const stmt = db.prepare(`
    INSERT INTO sync_cards (card_hash, group_id, encrypted_data, status, notes, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(card_hash, group_id) DO UPDATE SET
      encrypted_data = CASE WHEN (${inc}) > (${cur}) THEN excluded.encrypted_data ELSE sync_cards.encrypted_data END,
      status         = CASE WHEN (${inc}) > (${cur}) THEN excluded.status         ELSE sync_cards.status         END,
      notes          = CASE WHEN (${inc}) > (${cur}) THEN excluded.notes          ELSE sync_cards.notes          END,
      updated_by     = CASE WHEN (${inc}) > (${cur}) THEN excluded.updated_by     ELSE sync_cards.updated_by     END,
      updated_at     = CASE WHEN (${inc}) > (${cur}) THEN CURRENT_TIMESTAMP       ELSE sync_cards.updated_at     END
  `);

  return db.transaction(() => {
    const rows = cards.map(sanitizeCard).filter(Boolean);
    if (!allowCreate && rows.length > 0) {
      const placeholders = rows.map(() => '?').join(',');
      const known = new Set(db.prepare(
        `SELECT card_hash FROM sync_cards WHERE group_id = ? AND card_hash IN (${placeholders})`
      ).all(groupId, ...rows.map(r => r.card_hash)).map(r => r.card_hash));
      const missing = [...new Set(rows.map(r => r.card_hash))].filter(h => !known.has(h));
      if (missing.length > 0) throw new CardCreateForbiddenError(missing);
    }
    const written = [];
    for (const row of rows) {
      stmt.run(row.card_hash, groupId, row.encrypted_data, row.status, row.notes, installationId);
      written.push({ card_hash: row.card_hash, status: row.status });
    }
    return written;
  })();
}

module.exports = {
  STATUS_WEIGHT,
  VALID_STATUSES,
  MAX_CARDS_PER_BATCH,
  weight,
  weightExpr,
  sanitizeCard,
  applyCardPush,
  CardCreateForbiddenError,
};
