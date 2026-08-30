// REDESIGN-05-5B2: панель воркеров — публикация групповой статистики и
// агрегация presence/heartbeat/счётчиков карт/статов по sync-группе.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-group-panel-')), 'test.db');
process.env.SERVER_SECRET = 'group-panel-test-secret';

const { getDb, hashToken } = require('../database');
const groupPanel = require('../routes/group-panel');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/sync', groupPanel.workerRouter);

const MGR_TOKEN = 'mgr-panel-token-1234567890ab';
const W1_TOKEN = 'wrk1-panel-token-1234567890ab';
const W2_TOKEN = 'wrk2-panel-token-1234567890ab';
const W3_TOKEN = 'solo-panel-token-1234567890ab';
const MGR_IID = 'mgr-panel-install-01';
const W1_IID = 'wrk1-panel-install-01';
const W2_IID = 'wrk2-panel-install-01';
const W3_IID = 'solo-panel-install-01';

let server;

async function req(method, p, token, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

test.before(async () => {
  const db = getDb();
  const ins = db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)");
  ins.run(MGR_IID, 'CH-M', hashToken(MGR_TOKEN), 'Head Manager', 'manager');
  ins.run(W1_IID, 'CH-1', hashToken(W1_TOKEN), 'Worker One', 'operator');
  ins.run(W2_IID, 'CH-2', hashToken(W2_TOKEN), 'Worker Two', 'operator');
  ins.run(W3_IID, 'CH-3', hashToken(W3_TOKEN), 'Solo Worker', 'operator');

  // Группа: W1 (создатель) + W2. W3 — без группы.
  db.prepare("INSERT INTO sync_groups (id, name, created_by) VALUES ('grp-1', 'Team A', ?)").run(W1_IID);
  db.prepare('INSERT INTO sync_group_members (group_id, installation_id) VALUES (?, ?)').run('grp-1', W1_IID);
  db.prepare("INSERT INTO sync_group_members (group_id, installation_id, joined_at) VALUES ('grp-1', ?, datetime('now','+1 second'))").run(W2_IID);

  // heartbeat только у W1
  db.prepare("INSERT INTO worker_heartbeats (installation_id, last_seen) VALUES (?, datetime('now'))").run(W1_IID);

  // адресные срезы W1: 2 ack + 1 pending
  const insIssued = db.prepare("INSERT INTO issued_card_slices (card_hash, sealed_data, target_iid, status) VALUES (?,?,?,?)");
  insIssued.run('hash-i1', 'x'.repeat(24), W1_IID, 'ack');
  insIssued.run('hash-i2', 'x'.repeat(24), W1_IID, 'ack');
  insIssued.run('hash-i3', 'x'.repeat(24), W1_IID, 'pending');

  // пул: ключ + 2 среза для W1 (ack+used, reserved)
  db.prepare("INSERT INTO card_pool_keys (label, is_active) VALUES ('k', 1)").run();
  const keyId = Number(getDb().prepare('SELECT MAX(id) AS id FROM card_pool_keys').get().id);
  const insPool = db.prepare("INSERT INTO card_pool_slices (card_hash, key_id, sealed_data, status, reserved_by, outcome) VALUES (?,?,?,?,?,?)");
  insPool.run('hash-p1', keyId, 'x'.repeat(24), 'ack', W1_IID, 'used');
  insPool.run('hash-p2', keyId, 'x'.repeat(24), 'reserved', W1_IID, null);

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../database');
  closeDb();
});

test('stats publish: валидация и апсерт', async () => {
  const noObj = await req('POST', '/sync/group/stats', W1_TOKEN, { stats: 'nope' });
  assert.equal(noObj.status, 400);

  const manyKeys = { stats: {} };
  for (let i = 0; i < 41; i += 1) manyKeys.stats[`k${i}`] = i;
  const tooMany = await req('POST', '/sync/group/stats', W1_TOKEN, manyKeys);
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.json.error, 'stats_too_many_keys');

  const longStr = await req('POST', '/sync/group/stats', W1_TOKEN, { stats: { note: 'x'.repeat(201) } });
  assert.equal(longStr.status, 400);

  const nested = await req('POST', '/sync/group/stats', W1_TOKEN, { stats: { deep: { a: 1 } } });
  assert.equal(nested.status, 400);
  assert.equal(nested.json.error, 'stats_scalar_values_only');

  const ok = await req('POST', '/sync/group/stats', W1_TOKEN, {
    stats: { orders_today: 3, orders_week: 12, decline_rate_week: 0.25, cards_free: 8 },
  });
  assert.equal(ok.status, 200);

  // апсерт: второй пост заменяет первый
  const ok2 = await req('POST', '/sync/group/stats', W1_TOKEN, {
    stats: { orders_today: 4, decline_rate_week: 0.3 },
  });
  assert.equal(ok2.status, 200);
  const row = getDb().prepare('SELECT stats_json FROM worker_group_stats WHERE installation_id = ?').get(W1_IID);
  assert.deepEqual(JSON.parse(row.stats_json), { orders_today: 4, decline_rate_week: 0.3 });

  // воркер без группы — 409
  const noGroup = await req('POST', '/sync/group/stats', W3_TOKEN, { stats: { a: 1 } });
  assert.equal(noGroup.status, 409);
  assert.equal(noGroup.json.error, 'no_sync_group');
});

test('panel: агрегация по группе', async () => {
  const r = await req('GET', '/sync/group/workers', W1_TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.json.me, W1_IID);
  assert.equal(r.json.group.id, 'grp-1');
  assert.equal(r.json.group.name, 'Team A');
  assert.equal(r.json.workers.length, 2);

  const w1 = r.json.workers.find((w) => w.installation_id === W1_IID);
  const w2 = r.json.workers.find((w) => w.installation_id === W2_IID);

  assert.equal(w1.label, 'Worker One');
  assert.equal(w1.is_group_admin, true, 'W1 — создатель группы');
  assert.equal(w2.is_group_admin, false);
  assert.ok(w1.last_seen, 'heartbeat W1');
  assert.equal(w2.last_seen, null);
  assert.equal(w1.online, false, 'WS-подключений в тесте нет — online=false');
  assert.equal(w2.joined_at !== null, true);

  // счётчики карт W1
  assert.equal(w1.cards.issued_ack, 2);
  assert.equal(w1.cards.issued_pending, 1);
  assert.equal(w1.cards.pool_ack, 1);
  assert.equal(w1.cards.pool_used, 1);
  assert.equal(w1.cards.pool_reserved, 1);
  assert.equal(w2.cards.issued_ack, 0);

  // самопубликованная статистика W1
  assert.deepEqual(w1.stats, { orders_today: 4, decline_rate_week: 0.3 });
  assert.ok(w1.stats_updated_at);
  assert.equal(w2.stats, null);
});

test('panel: воркер без группы видит себя одного', async () => {
  const r = await req('GET', '/sync/group/workers', W3_TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.json.group, null);
  assert.equal(r.json.workers.length, 1);
  assert.equal(r.json.workers[0].installation_id, W3_IID);
  assert.equal(r.json.workers[0].label, 'Solo Worker');
});

test('panel: менеджерский токен запрещён, без токена 401', async () => {
  const asMgr = await req('GET', '/sync/group/workers', MGR_TOKEN);
  assert.equal(asMgr.status, 403);
  const anon = await req('GET', '/sync/group/workers', null);
  assert.equal(anon.status, 401);
});
