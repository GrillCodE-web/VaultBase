// card-push.js: validation (sanitizeCard) + monotonic conflict resolution
// (applyCardPush). better-sqlite3 has no prebuilt binding for this machine's
// Node, so the SQL runs on the built-in node:sqlite driver wrapped in a tiny
// better-sqlite3-shaped adapter — the SQL dialect is identical.
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const { sanitizeCard, applyCardPush, weight } = require('../card-push');

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE sync_cards (
      card_hash      TEXT NOT NULL,
      group_id       TEXT NOT NULL,
      encrypted_data TEXT,
      status         TEXT NOT NULL DEFAULT 'free',
      notes          TEXT,
      updated_by     TEXT,
      updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (card_hash, group_id)
    );
  `);
  return {
    prepare: (sql) => raw.prepare(sql),
    transaction: (fn) => (...args) => {
      raw.exec('BEGIN');
      try {
        const r = fn(...args);
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
    },
    get: (sql, ...params) => raw.prepare(sql).get(...params),
  };
}

const GET_ONE = 'SELECT status, notes, encrypted_data, updated_by FROM sync_cards WHERE card_hash = ? AND group_id = ?';

test('sanitizeCard rejects malformed rows', () => {
  assert.equal(sanitizeCard(null), null);
  assert.equal(sanitizeCard('str'), null);
  assert.equal(sanitizeCard({}), null);
  assert.equal(sanitizeCard({ card_hash: 'short', status: 'free' }), null);
  assert.equal(sanitizeCard({ card_hash: 'hash-12345' }), null);
  assert.equal(sanitizeCard({ card_hash: 'hash-12345', status: 'bogus' }), null);
});

test('sanitizeCard truncates notes to 500 and nulls non-strings', () => {
  const row = sanitizeCard({ card_hash: 'hash-12345', status: 'free', notes: 'x'.repeat(600), encrypted_data: 42 });
  assert.equal(row.notes.length, 500);
  assert.equal(row.encrypted_data, null);
  assert.equal(sanitizeCard({ card_hash: 'hash-12345', status: 'free', notes: 7 }).notes, null);
});

test('weight is monotonic and unknown statuses weigh 0', () => {
  assert.equal(weight('dead'), 5);
  assert.equal(weight('free'), 1);
  assert.equal(weight('nope'), 0);
  assert.ok(weight('dead') > weight('declined'));
  assert.ok(weight('declined') > weight('archive'));
  assert.ok(weight('archive') > weight('in_use'));
  assert.ok(weight('in_use') > weight('free'));
});

test('applyCardPush inserts valid rows and skips invalid ones', () => {
  const db = makeDb();
  const written = applyCardPush(db, 'g1', 'inst-1', [
    { card_hash: 'hash-aaaa', status: 'free', notes: 'n1', encrypted_data: 'blob' },
    { card_hash: 'x', status: 'free' },            // short hash — skip
    { card_hash: 'hash-bbbb', status: 'bogus' },   // bad status — skip
    { card_hash: 'hash-cccc', status: 'in_use' },
  ]);
  assert.deepEqual(written, [
    { card_hash: 'hash-aaaa', status: 'free' },
    { card_hash: 'hash-cccc', status: 'in_use' },
  ]);
  assert.equal(db.get(GET_ONE, 'hash-aaaa', 'g1').notes, 'n1');
  assert.equal(db.get(GET_ONE, 'hash-bbbb', 'g1'), undefined);
});

test('applyCardPush: higher status weight overwrites', () => {
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'old', encrypted_data: 'enc-old' }]);
  applyCardPush(db, 'g1', 'inst-2', [{ card_hash: 'hash-aaaa', status: 'dead', notes: 'new', encrypted_data: 'enc-new' }]);
  const row = db.get(GET_ONE, 'hash-aaaa', 'g1');
  assert.equal(row.status, 'dead');
  assert.equal(row.notes, 'new');
  assert.equal(row.encrypted_data, 'enc-new');
  assert.equal(row.updated_by, 'inst-2');
});

test('applyCardPush: lower status weight does not overwrite', () => {
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'dead', notes: 'dead-note', encrypted_data: 'enc-dead' }]);
  applyCardPush(db, 'g1', 'inst-2', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'free-note', encrypted_data: 'enc-free' }]);
  const row = db.get(GET_ONE, 'hash-aaaa', 'g1');
  assert.equal(row.status, 'dead');
  assert.equal(row.notes, 'dead-note');
  assert.equal(row.encrypted_data, 'enc-dead');
  assert.equal(row.updated_by, 'inst-1');
});

test('applyCardPush: equal weight keeps the existing row (strict >)', () => {
  // Regression: the old socket.js resolver used >=, so a same-status push
  // (e.g. free -> free) wiped notes/encrypted_data with stale client data.
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'first', encrypted_data: 'enc-1' }]);
  applyCardPush(db, 'g1', 'inst-2', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'second', encrypted_data: 'enc-2' }]);
  const row = db.get(GET_ONE, 'hash-aaaa', 'g1');
  assert.equal(row.status, 'free');
  assert.equal(row.notes, 'first');
  assert.equal(row.encrypted_data, 'enc-1');
  assert.equal(row.updated_by, 'inst-1');
});

test('applyCardPush: groups are isolated', () => {
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'dead' }]);
  applyCardPush(db, 'g2', 'inst-2', [{ card_hash: 'hash-aaaa', status: 'free' }]);
  assert.equal(db.get(GET_ONE, 'hash-aaaa', 'g1').status, 'dead');
  assert.equal(db.get(GET_ONE, 'hash-aaaa', 'g2').status, 'free');
});

test('applyCardPush: a failing batch rolls back atomically', () => {
  const db = makeDb();
  const bad = { card_hash: 'hash-bbbb', status: 'free' };
  Object.defineProperty(bad, 'notes', { get() { throw new Error('boom'); } });
  assert.throws(() => applyCardPush(db, 'g1', 'inst-1', [
    { card_hash: 'hash-aaaa', status: 'free' },
    bad,
  ]), /boom/);
  // The first (valid) row must not survive the rolled-back transaction.
  assert.equal(db.get(GET_ONE, 'hash-aaaa', 'g1'), undefined);
});

// ── MGR-016: воркер = потребитель, каналы без allowCreate ────────────────────

test('allowCreate:false throws cards_import_disabled for an unknown card', () => {
  const db = makeDb();
  assert.throws(
    () => applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free' }], { allowCreate: false }),
    (e) => e.code === 'cards_import_disabled' && Array.isArray(e.hashes) && e.hashes.length === 1
  );
  assert.equal(db.get(GET_ONE, 'hash-aaaa', 'g1'), undefined);
});

test('allowCreate:false still allows status updates of existing cards', () => {
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'old' }]);
  const written = applyCardPush(db, 'g1', 'inst-2', [{ card_hash: 'hash-aaaa', status: 'in_use' }], { allowCreate: false });
  assert.deepEqual(written, [{ card_hash: 'hash-aaaa', status: 'in_use' }]);
  const row = db.get(GET_ONE, 'hash-aaaa', 'g1');
  assert.equal(row.status, 'in_use');
  assert.equal(row.updated_by, 'inst-2');
});

test('allowCreate:false rejects the whole batch when any card is new', () => {
  const db = makeDb();
  applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free', notes: 'keep' }]);
  assert.throws(
    () => applyCardPush(db, 'g1', 'inst-2', [
      { card_hash: 'hash-aaaa', status: 'dead', notes: 'legit update' },
      { card_hash: 'hash-new1', status: 'in_use' },
    ], { allowCreate: false }),
    (e) => e.code === 'cards_import_disabled' && e.hashes.length === 1 && e.hashes[0] === 'hash-new1'
  );
  // Ни обновление существующей, ни вставка новой не должны примениться.
  const row = db.get(GET_ONE, 'hash-aaaa', 'g1');
  assert.equal(row.status, 'free');
  assert.equal(row.notes, 'keep');
});

test('allowCreate is opt-in: default remains create-allowed (legacy admin channel)', () => {
  const db = makeDb();
  const written = applyCardPush(db, 'g1', 'inst-1', [{ card_hash: 'hash-aaaa', status: 'free' }]);
  assert.equal(written.length, 1);
});
