// MGR-016: воркер = потребитель. worker_keys (X25519-пубключи), регистрация
// ключа при активации и через /sync/worker-key/register, доставка запечатанных
// срезов (issued_card_slices), гашение легаси-групп (410) и запрет создания
// карт воркером через REST /sync/cards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-worker-cards-')), 'test.db');
process.env.SERVER_SECRET = 'worker-cards-test-secret';

const { getDb, hashToken } = require('../database');
const managerApi = require('../routes/manager-api');
const workerCards = require('../routes/worker-cards');
const activate = require('../routes/activate');
const { deriveActivationKey } = activate;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/activate', activate);
app.use('/manager/api', managerApi);
app.use('/manager/api', workerCards.managerRouter);
app.use('/sync', require('../routes/sync'));
app.use('/sync', workerCards.workerRouter);

const MGR_TOKEN = 'mgr-token-1234567890abcdef';
const WRK_TOKEN = 'wrk-token-1234567890abcdef';
const MGR_IID = 'mgr-install-0001';
const WRK_IID = 'wrk-install-0001';
const ACT_IID = 'act-install-0001';
const PUBKEY_A = 'ab'.repeat(32);
const PUBKEY_B = 'cd'.repeat(32);

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
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(MGR_IID, 'CHALLENGE-M', hashToken(MGR_TOKEN), 'Head Manager', 'manager');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(WRK_IID, 'CHALLENGE-W', hashToken(WRK_TOKEN), 'Worker One', 'operator');
  // ACT_IID остаётся без token_hash — пройдёт живую активацию в тесте ниже.
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,NULL,?,?,1)")
    .run(ACT_IID, 'CHALLENGE-A', 'To Be Activated', 'operator');
  // Легаси-группа воркера: seeded напрямую, т.к. /group/create теперь 410.
  db.prepare("INSERT INTO sync_groups (id, name, created_by, created_at) VALUES ('legacy-group', 'Legacy', ?, CURRENT_TIMESTAMP)").run(WRK_IID);
  db.prepare("INSERT INTO sync_group_members (group_id, installation_id, joined_at) VALUES ('legacy-group', ?, CURRENT_TIMESTAMP)").run(WRK_IID);
  db.prepare(`INSERT INTO sync_cards (card_hash, group_id, encrypted_data, status, notes, updated_by, updated_at)
              VALUES ('hash-exist', 'legacy-group', 'enc-old', 'free', 'seed', 'seed', CURRENT_TIMESTAMP)`).run();
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../database');
  closeDb();
});

// ── Гашение легаси-групп ─────────────────────────────────────────────────────

test('group create/pair/join return 410 groups_deprecated (MGR-016)', async () => {
  const create = await req('POST', '/sync/group/create', WRK_TOKEN, { name: 'G' });
  assert.equal(create.status, 410);
  assert.equal(create.json.error, 'groups_deprecated');

  const pair = await req('POST', '/sync/group/pair', WRK_TOKEN, {});
  assert.equal(pair.status, 410);
  assert.equal(pair.json.error, 'groups_deprecated');

  const join = await req('POST', '/sync/group/join', WRK_TOKEN, { code: 'ANYCODE' });
  assert.equal(join.status, 410);
  assert.equal(join.json.error, 'groups_deprecated');
});

test('legacy member keeps card sync but cannot create cards (403 cards_import_disabled)', async () => {
  const rejected = await req('POST', '/sync/cards', WRK_TOKEN, {
    cards: [{ card_hash: 'hash-new1', status: 'in_use', encrypted_data: 'blob' }],
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.json.error, 'cards_import_disabled');

  const ok = await req('POST', '/sync/cards', WRK_TOKEN, {
    cards: [{ card_hash: 'hash-exist', status: 'in_use', encrypted_data: 'upd' }],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.updated, 1);
  const row = getDb().prepare("SELECT status, updated_by FROM sync_cards WHERE card_hash = 'hash-exist'").get();
  assert.equal(row.status, 'in_use');
  assert.equal(row.updated_by, WRK_IID);
});

// ── worker_keys: регистрация, ротация, листинг ──────────────────────────────

test('worker key register: bad pubkey rejected, rotation keeps a single active key', async () => {
  const bad = await req('POST', '/sync/worker-key/register', WRK_TOKEN, { pubkey: 'zz' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'pubkey_must_be_64_hex_chars');

  const okA = await req('POST', '/sync/worker-key/register', WRK_TOKEN, { pubkey: PUBKEY_A, label: 'main' });
  assert.equal(okA.status, 201);
  assert.ok(Number.isInteger(okA.json.key_id));

  const okB = await req('POST', '/sync/worker-key/register', WRK_TOKEN, { pubkey: PUBKEY_B, label: 'rotated' });
  assert.equal(okB.status, 201);

  const rows = getDb().prepare('SELECT pubkey, is_active FROM worker_keys WHERE installation_id = ? ORDER BY id').all(WRK_IID);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].is_active, 0, 'old key revoked by rotation');
  assert.equal(rows[1].is_active, 1);
  assert.equal(rows[1].pubkey, PUBKEY_B);
});

test('manager sees active worker keys; roles are enforced both ways', async () => {
  const managerView = await req('GET', '/manager/api/workers/keys', MGR_TOKEN);
  assert.equal(managerView.status, 200);
  const mine = managerView.json.keys.filter(k => k.installation_id === WRK_IID);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].pubkey, PUBKEY_B);
  assert.equal(mine[0].worker_label, 'Worker One');

  const asWorker = await req('GET', '/manager/api/workers/keys', WRK_TOKEN);
  assert.equal(asWorker.status, 403);
  const asManager = await req('GET', '/sync/cards/issued', MGR_TOKEN);
  assert.equal(asManager.status, 403);
});

test('issue rejects unknown recipient, manager-as-target, and missing worker key', async () => {
  const slice = [{ card_hash: 'hash-zzz', sealed_data: 'x'.repeat(64) }];

  const unknown = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, { target_iid: 'nobody-here', slices: slice });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'unknown_installation');

  const asManager = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: MGR_IID, slices: slice,
  });
  assert.equal(asManager.status, 400);
  assert.equal(asManager.json.error, 'manager_is_not_a_card_recipient');

  const noKey = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: ACT_IID, slices: slice,
  });
  assert.equal(noKey.status, 409);
  assert.equal(noKey.json.error, 'worker_key_not_registered');
});

test('issue validates payload', async () => {
  const noSlices = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, { target_iid: WRK_IID, slices: [] });
  assert.equal(noSlices.status, 400);
  const badSlice = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID, slices: [{ card_hash: 'short', sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(badSlice.status, 400);
});

test('manager issues sealed slices, worker fetches until ack, re-issue resets', async () => {
  const sealed1 = 'sealed-envelope-0001';
  const sealed2 = 'sealed-envelope-0002';

  const issue = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    slices: [
      { card_hash: 'hash-card-1', sealed_data: sealed1 },
      { card_hash: 'hash-card-2', sealed_data: sealed2 },
    ],
  });
  assert.equal(issue.status, 201);
  assert.equal(issue.json.issued, 2);

  // at-least-once: срезы приходят при каждом запросе до явного ack.
  const first = await req('GET', '/sync/cards/issued', WRK_TOKEN);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.slices.map(s => s.card_hash), ['hash-card-1', 'hash-card-2']);
  assert.equal(first.json.slices[0].sealed_data, sealed1);
  const refetch = await req('GET', '/sync/cards/issued', WRK_TOKEN);
  assert.equal(refetch.json.slices.length, 2);

  const ack = await req('POST', '/sync/cards/issued/ack', WRK_TOKEN, { ids: first.json.slices.map(s => s.id) });
  assert.equal(ack.status, 200);
  assert.equal(ack.json.acked, 2);

  const afterAck = await req('GET', '/sync/cards/issued', WRK_TOKEN);
  assert.equal(afterAck.json.slices.length, 0);

  const managerView = await req('GET', `/manager/api/cards/issued?target_iid=${WRK_IID}`, MGR_TOKEN);
  assert.equal(managerView.json.slices.length, 2);
  assert.ok(managerView.json.slices.every(s => s.status === 'ack'));
  assert.ok(!('sealed_data' in managerView.json.slices[0]));
});

test('re-issue replaces the envelope and returns the slice to pending', async () => {
  const reissue = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    slices: [{ card_hash: 'hash-card-1', sealed_data: 'sealed-envelope-0001-v2' }],
  });
  assert.equal(reissue.status, 201);

  const fetched = await req('GET', '/sync/cards/issued', WRK_TOKEN);
  assert.equal(fetched.json.slices.length, 1);
  assert.equal(fetched.json.slices[0].card_hash, 'hash-card-1');
  assert.equal(fetched.json.slices[0].sealed_data, 'sealed-envelope-0001-v2');
});

test('activation registers worker pubkey (and rejects malformed one)', async () => {
  const bad = await req('POST', '/activate', null, {
    installation_id: ACT_IID, challenge: 'CHALLENGE-A',
    activation_key: deriveActivationKey(ACT_IID, 'CHALLENGE-A'), worker_pubkey: 'zz',
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'worker_pubkey_invalid');

  const act = await req('POST', '/activate', null, {
    installation_id: ACT_IID, challenge: 'CHALLENGE-A',
    activation_key: deriveActivationKey(ACT_IID, 'CHALLENGE-A'), worker_pubkey: PUBKEY_B,
  });
  assert.equal(act.status, 200);
  assert.ok(act.json.token);

  const stored = getDb().prepare('SELECT pubkey, label, is_active FROM worker_keys WHERE installation_id = ? AND is_active = 1').get(ACT_IID);
  assert.equal(stored.pubkey, PUBKEY_B);
  assert.equal(stored.label, 'activation');
});

test('manager can revoke pending/delivered slices (recall to pool)', async () => {
  // Выдаём два среза, отзываем один, воркер должен получить только один.
  const issue = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    slices: [
      { card_hash: 'hash-revoked-1', sealed_data: 'sealed-r1-000000000' },
      { card_hash: 'hash-kept-1', sealed_data: 'sealed-keep1-000000' },
    ],
  });
  assert.equal(issue.status, 201);

  const bad = await req('POST', '/manager/api/cards/issued/revoke', MGR_TOKEN, { ids: 'nope' });
  assert.equal(bad.status, 400);

  const listed = await req('GET', `/manager/api/cards/issued?target_iid=${WRK_IID}`, MGR_TOKEN);
  const open = listed.json.slices.filter(s => s.status !== 'ack' && s.status !== 'revoked');
  assert.ok(open.length >= 2, 'should have open slices to revoke');
  const revokeIds = open.map(s => s.id);
  const revoke = await req('POST', '/manager/api/cards/issued/revoke', MGR_TOKEN, { ids: revokeIds });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.json.ok, true);
  assert.equal(revoke.json.revoked, revokeIds.length);

  // Отозванное воркеру больше не доставляется.
  const fetchAfter = await req('GET', '/sync/cards/issued', WRK_TOKEN);
  assert.deepEqual(fetchAfter.json.slices.map(s => s.card_hash), []);
});

test('audit trail records key registrations and card issues', () => {
  const rows = getDb().prepare(
    "SELECT action, COUNT(*) AS n FROM audit_log WHERE action IN ('worker_key_register','manager_cards_issue') GROUP BY action"
  ).all();
  const byAction = Object.fromEntries(rows.map(r => [r.action, r.n]));
  assert.ok((byAction.worker_key_register || 0) >= 1);
  assert.ok((byAction.manager_cards_issue || 0) >= 1);
});

// ── MGR-019: политики воркера на выдаче ──────────────────────────────────────

test('policy: пауза блокирует выдачу срезов (worker_paused), revoke продолжает работать', async () => {
  const slice = { card_hash: 'hash-pause-1', sealed_data: 'sealed-pause-0000001' };
  const okIssue = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, { target_iid: WRK_IID, slices: [slice] });
  assert.equal(okIssue.status, 201, `issue до паузы: ${okIssue.text}`);

  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { paused: true });
  const paused = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID, slices: [{ card_hash: 'hash-pause-2', sealed_data: 'sealed-pause-0000002' }],
  });
  assert.equal(paused.status, 403);
  assert.equal(paused.json.error, 'worker_paused');

  // revoke (забрать в пул) паузой не блокируется
  const list = await req('GET', `/manager/api/cards/issued?target_iid=${WRK_IID}`, MGR_TOKEN);
  const mine = list.json.slices.find(s => s.card_hash === 'hash-pause-1');
  assert.ok(mine, 'срез hash-pause-1 виден менеджеру');
  const revoke = await req('POST', '/manager/api/cards/issued/revoke', MGR_TOKEN, { ids: [mine.id] });
  assert.equal(revoke.status, 200);

  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { paused: false });
  const unpaused = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID, slices: [{ card_hash: 'hash-pause-2', sealed_data: 'sealed-pause-0000002' }],
  });
  assert.equal(unpaused.status, 201);
});

test('policy: квота карт/день ограничивает выдачу (quota_cards_exceeded)', async () => {
  // квота 0: сегодня уже что-то выдавалось ранее тестов — любая выдача сверх 0 запрещена
  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { quota_cards_day: 0 });
  const over = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID, slices: [{ card_hash: 'hash-quota-1', sealed_data: 'sealed-quota-0000001' }],
  });
  assert.equal(over.status, 429);
  assert.equal(over.json.error, 'quota_cards_exceeded');
  assert.equal(over.json.quota, 0);
  assert.ok(over.json.issued_today >= 0);

  // снять квоту — выдача снова проходит
  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { quota_cards_day: null });
  const ok = await req('POST', '/manager/api/cards/issue', MGR_TOKEN, {
    target_iid: WRK_IID, slices: [{ card_hash: 'hash-quota-1', sealed_data: 'sealed-quota-0000001' }],
  });
  assert.equal(ok.status, 201);
});
