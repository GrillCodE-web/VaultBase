// courier-tags.js: валидация (sanitizeCourierTag) + upsert (applyCourierTag).
// Тот же приём, что в card-push.test.js: встроенный node:sqlite вместо
// better-sqlite3 — диалект SQL идентичен.
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const { sanitizeCourierTag, applyCourierTag } = require('../courier-tags');

const HASH = 'ab'.repeat(32);

function makeDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE sync_courier_tags (
      group_id     TEXT NOT NULL,
      provider     TEXT NOT NULL DEFAULT 'swat',
      courier_hash TEXT NOT NULL,
      tag          TEXT NOT NULL,
      action       TEXT NOT NULL DEFAULT 'add' CHECK (action IN ('add','remove')),
      updated_by   TEXT,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, provider, courier_hash, tag)
    );
  `);
  return {
    prepare: (sql) => raw.prepare(sql),
    get: (sql, ...params) => raw.prepare(sql).get(...params),
    all: (sql, ...params) => raw.prepare(sql).all(...params),
  };
}

const GET_ONE = 'SELECT action, updated_by FROM sync_courier_tags WHERE group_id = ? AND provider = ? AND courier_hash = ? AND tag = ?';

test('sanitizeCourierTag rejects malformed payloads', () => {
  assert.equal(sanitizeCourierTag(null), null);
  assert.equal(sanitizeCourierTag({}), null);
  assert.equal(sanitizeCourierTag({ courier_hash: 'short', tag: 'x', action: 'add' }), null);
  assert.equal(sanitizeCourierTag({ courier_hash: HASH.toUpperCase(), tag: 'x', action: 'add' }), null, 'только lowercase hex');
  assert.equal(sanitizeCourierTag({ courier_hash: HASH, action: 'add' }), null, 'нет тега');
  assert.equal(sanitizeCourierTag({ courier_hash: HASH, tag: '   ', action: 'add' }), null, 'пустой тег');
  assert.equal(sanitizeCourierTag({ courier_hash: HASH, tag: 'x'.repeat(101), action: 'add' }), null, 'слишком длинный');
  assert.equal(sanitizeCourierTag({ courier_hash: HASH, tag: 'x', action: 'delete' }), null, 'неизвестный action');
});

test('sanitizeCourierTag normalizes tag and provider', () => {
  const row = sanitizeCourierTag({ provider: ' SWAT ', courier_hash: HASH, tag: ' Zoro.COM ', action: 'add' });
  assert.equal(row.provider, 'SWAT', 'provider trim-ается, регистр сохраняется');
  assert.equal(row.tag, 'zoro.com');
  assert.equal(sanitizeCourierTag({ courier_hash: HASH, tag: 'x', action: 'remove' }).provider, 'swat');
  const long = sanitizeCourierTag({ provider: 'p'.repeat(64), courier_hash: HASH, tag: 'x', action: 'add' });
  assert.equal(long.provider.length, 32);
});

test('applyCourierTag inserts and latest action wins', () => {
  const db = makeDb();
  const row = sanitizeCourierTag({ courier_hash: HASH, tag: 'zoro.com', action: 'add' });
  applyCourierTag(db, 'g1', 'inst-1', row);
  assert.equal(db.get(GET_ONE, 'g1', 'swat', HASH, 'zoro.com').action, 'add');

  applyCourierTag(db, 'g1', 'inst-2', { ...row, action: 'remove' });
  const r = db.get(GET_ONE, 'g1', 'swat', HASH, 'zoro.com');
  assert.equal(r.action, 'remove');
  assert.equal(r.updated_by, 'inst-2');
  assert.equal(db.all('SELECT * FROM sync_courier_tags WHERE group_id = ?', 'g1').length, 1, 'upsert, не дубли');
});

test('applyCourierTag: groups and providers are isolated', () => {
  const db = makeDb();
  const row = sanitizeCourierTag({ courier_hash: HASH, tag: 'bond', action: 'add' });
  applyCourierTag(db, 'g1', 'i1', row);
  applyCourierTag(db, 'g2', 'i2', row);
  applyCourierTag(db, 'g1', 'i1', { ...row, provider: 'other' });
  assert.equal(db.all('SELECT * FROM sync_courier_tags').length, 3);
  applyCourierTag(db, 'g1', 'i3', { ...row, action: 'remove' });
  assert.equal(db.get(GET_ONE, 'g1', 'swat', HASH, 'bond').action, 'remove');
  assert.equal(db.get(GET_ONE, 'g2', 'swat', HASH, 'bond').action, 'add');
  assert.equal(db.get(GET_ONE, 'g1', 'other', HASH, 'bond').action, 'add');
});
