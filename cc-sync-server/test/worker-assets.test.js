// MGR-018 (этапы C/D): централизованные срезы прокси/email (issued_asset_slices)
// и share-ключи конфигурации (worker_config_shares, kind='stuffer'). Сервер —
// курьер шифротекста: issue/issued/ack/revoke, at-least-once доставка,
// политики паузы/бана на выдаче.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-worker-assets-')), 'test.db');
process.env.SERVER_SECRET = 'worker-assets-test-secret';

const { getDb, hashToken } = require('../database');
const workerAssets = require('../routes/worker-assets');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/manager/api', workerAssets.managerRouter);
app.use('/sync', workerAssets.workerRouter);

const MGR_TOKEN = 'mgr-token-assets-0000000001';
const WRK_TOKEN = 'wrk-token-assets-0000000001';
const MGR_IID = 'mgr-install-assets';
const WRK_IID = 'wrk-install-assets';
const NOKEY_IID = 'wrk-install-nokey';
const PUBKEY = 'ef'.repeat(32);

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
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(NOKEY_IID, 'CHALLENGE-N', hashToken('nokey-token-000000000000001'), 'No Key', 'operator');
  db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(WRK_IID, PUBKEY, 'test');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../database');
  closeDb();
});

// ── Срезы прокси/email ───────────────────────────────────────────────────────

test('assets issue: валидация kind/slices/target', async () => {
  const badKind = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'card', slices: [{ asset_hash: 'a'.repeat(16), sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(badKind.status, 400);
  assert.equal(badKind.json.error, 'kind_invalid');

  const empty = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'proxy', slices: [],
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error, 'slices_invalid');

  const unknown = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: 'nobody', kind: 'proxy', slices: [{ asset_hash: 'a'.repeat(16), sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(unknown.status, 404);

  const asManager = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: MGR_IID, kind: 'proxy', slices: [{ asset_hash: 'a'.repeat(16), sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(asManager.status, 400);
  assert.equal(asManager.json.error, 'manager_is_not_a_recipient');

  const noKey = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: NOKEY_IID, kind: 'proxy', slices: [{ asset_hash: 'a'.repeat(16), sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(noKey.status, 409);
  assert.equal(noKey.json.error, 'worker_key_not_registered');

  const asWorker = await req('POST', '/manager/api/assets/issue', WRK_TOKEN, {
    target_iid: WRK_IID, kind: 'proxy', slices: [{ asset_hash: 'a'.repeat(16), sealed_data: 'x'.repeat(64) }],
  });
  assert.equal(asWorker.status, 403);
});

test('proxy slices: issue → fetch (at-least-once) → ack; перевыпуск сбрасывает', async () => {
  const issue = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    kind: 'proxy',
    slices: [
      { asset_hash: 'proxy-hash-0001', sealed_data: 'sealed-proxy-0000001' },
      { asset_hash: 'proxy-hash-0002', sealed_data: 'sealed-proxy-0000002' },
    ],
  });
  assert.equal(issue.status, 201);
  assert.equal(issue.json.issued, 2);

  const first = await req('GET', '/sync/assets/issued?kind=proxy', WRK_TOKEN);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.slices.map((s) => s.asset_hash), ['proxy-hash-0001', 'proxy-hash-0002']);

  // email-канал изолирован: чужого kind там нет
  const emails = await req('GET', '/sync/assets/issued?kind=email', WRK_TOKEN);
  assert.equal(emails.json.slices.length, 0);

  const refetch = await req('GET', '/sync/assets/issued?kind=proxy', WRK_TOKEN);
  assert.equal(refetch.json.slices.length, 2, 'at-least-once до ack');

  const ack = await req('POST', '/sync/assets/issued/ack', WRK_TOKEN, {
    ids: first.json.slices.map((s) => s.id),
  });
  assert.equal(ack.json.acked, 2);
  const afterAck = await req('GET', '/sync/assets/issued?kind=proxy', WRK_TOKEN);
  assert.equal(afterAck.json.slices.length, 0);

  // Перевыпуск того же asset: конверт перезаписан, статус снова pending.
  const reissue = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    kind: 'proxy',
    slices: [{ asset_hash: 'proxy-hash-0001', sealed_data: 'sealed-proxy-v2-00001' }],
  });
  assert.equal(reissue.status, 201);
  const fetched = await req('GET', '/sync/assets/issued?kind=proxy', WRK_TOKEN);
  assert.equal(fetched.json.slices.length, 1);
  assert.equal(fetched.json.slices[0].sealed_data, 'sealed-proxy-v2-00001');
  await req('POST', '/sync/assets/issued/ack', WRK_TOKEN, { ids: [fetched.json.slices[0].id] });
});

test('assets revoke: отозванное не доставляется и не ack-ается', async () => {
  await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID,
    kind: 'email',
    slices: [{ asset_hash: 'email-hash-00001', sealed_data: 'sealed-email-0000001' }],
  });
  const listed = await req('GET', `/manager/api/assets/issued?kind=email&target_iid=${WRK_IID}`, MGR_TOKEN);
  assert.equal(listed.status, 200);
  const mine = listed.json.slices.find((s) => s.asset_hash === 'email-hash-00001');
  assert.ok(mine);
  assert.ok(!('sealed_data' in mine), 'sealed_data менеджеру не возвращается');

  const bad = await req('POST', '/manager/api/assets/issued/revoke', MGR_TOKEN, { ids: 'nope' });
  assert.equal(bad.status, 400);

  const revoke = await req('POST', '/manager/api/assets/issued/revoke', MGR_TOKEN, { ids: [mine.id] });
  assert.equal(revoke.json.revoked, 1);

  const fetched = await req('GET', '/sync/assets/issued?kind=email', WRK_TOKEN);
  assert.equal(fetched.json.slices.length, 0);

  const ack = await req('POST', '/sync/assets/issued/ack', WRK_TOKEN, { ids: [mine.id] });
  assert.equal(ack.json.acked, 0);
});

test('assets issue: пауза воркера блокирует выдачу (worker_paused)', async () => {
  getDb().prepare('INSERT INTO worker_policies (installation_id, paused) VALUES (?, 1)').run(WRK_IID);
  const paused = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'email', slices: [{ asset_hash: 'email-hash-pause', sealed_data: 'sealed-email-pause-001' }],
  });
  assert.equal(paused.status, 403);
  assert.equal(paused.json.error, 'worker_paused');
  getDb().prepare('UPDATE worker_policies SET paused = 0 WHERE installation_id = ?').run(WRK_IID);
  const ok = await req('POST', '/manager/api/assets/issue', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'email', slices: [{ asset_hash: 'email-hash-pause', sealed_data: 'sealed-email-pause-001' }],
  });
  assert.equal(ok.status, 201);
});

// ── Share-ключи конфигурации (stuffer) ───────────────────────────────────────

test('config share: выдача → доставка → ack; повторная выдача перезаписывает', async () => {
  const badKind = await req('POST', '/manager/api/config/share', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'binance', sealed_data: 'x'.repeat(64),
  });
  assert.equal(badKind.status, 400);
  assert.equal(badKind.json.error, 'kind_invalid');

  const share = await req('POST', '/manager/api/config/share', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'stuffer', sealed_data: 'sealed-stuffer-key-v1',
  });
  assert.equal(share.status, 201);

  const fetched = await req('GET', '/sync/config/shares?kind=stuffer', WRK_TOKEN);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.shares.length, 1);
  assert.equal(fetched.json.shares[0].sealed_data, 'sealed-stuffer-key-v1');

  // повторная выдача — тот же слот, новый конверт, снова pending
  await req('POST', '/manager/api/config/share', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'stuffer', sealed_data: 'sealed-stuffer-key-v2',
  });
  const refetch = await req('GET', '/sync/config/shares', WRK_TOKEN);
  assert.equal(refetch.json.shares.length, 1);
  assert.equal(refetch.json.shares[0].sealed_data, 'sealed-stuffer-key-v2');

  const ack = await req('POST', '/sync/config/shares/ack', WRK_TOKEN, { ids: [refetch.json.shares[0].id] });
  assert.equal(ack.json.acked, 1);
  const afterAck = await req('GET', '/sync/config/shares', WRK_TOKEN);
  assert.equal(afterAck.json.shares.length, 0);

  const managerView = await req('GET', `/manager/api/config/shares?target_iid=${WRK_IID}`, MGR_TOKEN);
  assert.equal(managerView.json.shares.length, 1);
  assert.equal(managerView.json.shares[0].status, 'ack');
  assert.ok(!('sealed_data' in managerView.json.shares[0]));
});

test('config share: revoke до доставки — воркер ничего не получает', async () => {
  await req('POST', '/manager/api/config/share', MGR_TOKEN, {
    target_iid: WRK_IID, kind: 'stuffer', sealed_data: 'sealed-stuffer-key-v3',
  });
  const listed = await req('GET', `/manager/api/config/shares?target_iid=${WRK_IID}`, MGR_TOKEN);
  const mine = listed.json.shares[0];
  const revoke = await req('POST', '/manager/api/config/shares/revoke', MGR_TOKEN, { ids: [mine.id] });
  assert.equal(revoke.json.revoked, 1);
  const fetched = await req('GET', '/sync/config/shares', WRK_TOKEN);
  assert.equal(fetched.json.shares.length, 0);
});

test('audit trail фиксирует issue и share', () => {
  const rows = getDb().prepare(
    "SELECT action, COUNT(*) AS n FROM audit_log WHERE action IN ('manager_assets_issue','manager_config_share') GROUP BY action"
  ).all();
  const byAction = Object.fromEntries(rows.map((r) => [r.action, r.n]));
  assert.ok((byAction.manager_assets_issue || 0) >= 1);
  assert.ok((byAction.manager_config_share || 0) >= 1);
});
