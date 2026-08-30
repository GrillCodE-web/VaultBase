// REDESIGN-05-5B1: пул карт с самообслуживанием. Ключи пула (shares),
// заливка, бронирование воркером (reserve → ack), TTL-сгорание брони,
// release/outcome, менеджерский обзор «кто что взял», revoke/return,
// политики (пауза, квота) и разграничение ролей.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-card-pool-')), 'test.db');
process.env.SERVER_SECRET = 'card-pool-test-secret';

const { getDb, hashToken } = require('../database');
const cardPool = require('../routes/card-pool');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/manager/api', cardPool.managerRouter);
app.use('/sync', cardPool.workerRouter);

const MGR_TOKEN = 'mgr-pool-token-1234567890ab';
const W1_TOKEN = 'wrk1-pool-token-1234567890ab';
const W2_TOKEN = 'wrk2-pool-token-1234567890ab';
const MGR_IID = 'mgr-pool-install-01';
const W1_IID = 'wrk1-pool-install-01';
const W2_IID = 'wrk2-pool-install-01';

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

function mkSlice(tag) {
  return { card_hash: `pool-hash-${tag}`, sealed_data: `sealed-pool-${tag}`.padEnd(24, '0') };
}

async function upload(keyId, tags) {
  return req('POST', '/manager/api/cards/pool/upload', MGR_TOKEN, {
    key_id: keyId,
    slices: tags.map(mkSlice),
  });
}

test.before(async () => {
  const db = getDb();
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(MGR_IID, 'CH-M', hashToken(MGR_TOKEN), 'Head Manager', 'manager');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(W1_IID, 'CH-1', hashToken(W1_TOKEN), 'Worker One', 'operator');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(W2_IID, 'CH-2', hashToken(W2_TOKEN), 'Worker Two', 'operator');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../database');
  closeDb();
});

let keyId; // активный ключ пула, создаётся первым тестом

test('pool key create: валидация shares и ротация активного ключа', async () => {
  const empty = await req('POST', '/manager/api/cards/pool/keys', MGR_TOKEN, { shares: [] });
  assert.equal(empty.status, 400);

  const unknown = await req('POST', '/manager/api/cards/pool/keys', MGR_TOKEN, {
    shares: [{ installation_id: 'ghost-iid', sealed_key: 'x'.repeat(64) }],
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'unknown_installation');

  const toManager = await req('POST', '/manager/api/cards/pool/keys', MGR_TOKEN, {
    shares: [{ installation_id: MGR_IID, sealed_key: 'x'.repeat(64) }],
  });
  assert.equal(toManager.status, 400);
  assert.equal(toManager.json.error, 'manager_is_not_a_card_recipient');

  const ok = await req('POST', '/manager/api/cards/pool/keys', MGR_TOKEN, {
    label: 'pool-key-1',
    shares: [{ installation_id: W1_IID, sealed_key: 'sealed-key-for-w1-000000' }],
  });
  assert.equal(ok.status, 201);
  keyId = ok.json.key_id;
  assert.ok(Number.isInteger(keyId));

  // Второй ключ ротирует первый.
  const ok2 = await req('POST', '/manager/api/cards/pool/keys', MGR_TOKEN, {
    shares: [{ installation_id: W2_IID, sealed_key: 'sealed-key-for-w2-000000' }],
  });
  assert.equal(ok2.status, 201);
  const key2 = ok2.json.key_id;

  const keys = await req('GET', '/manager/api/cards/pool/keys', MGR_TOKEN);
  const k1 = keys.json.keys.find((k) => k.id === keyId);
  const k2 = keys.json.keys.find((k) => k.id === key2);
  assert.equal(k1.is_active, 0, 'прежний ключ ротирован');
  assert.ok(k1.rotated_at);
  assert.equal(k2.is_active, 1);
  assert.equal(k1.shares[0].worker_label, 'Worker One');

  // Заливка под ротированным ключом запрещена, под новым — можно; но у W2
  // нет share первого ключа, поэтому возвращаем активность первому для
  // остальных тестов (имитируем «ключ №1 — основной»).
  const staleUpload = await upload(keyId, ['stale-1']);
  assert.equal(staleUpload.status, 400);
  assert.equal(staleUpload.json.error, 'pool_key_rotated');
  getDb().prepare('UPDATE card_pool_keys SET is_active = 1, rotated_at = NULL WHERE id = ?').run(keyId);
  getDb().prepare('UPDATE card_pool_keys SET is_active = 0 WHERE id = ?').run(key2);
});

test('upload: валидация и upsert свободных срезов', async () => {
  const noKey = await req('POST', '/manager/api/cards/pool/upload', MGR_TOKEN, { slices: [mkSlice('x')] });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.json.error, 'key_id_required');

  const badKey = await upload(99999, ['x1']);
  assert.equal(badKey.status, 404);
  assert.equal(badKey.json.error, 'unknown_pool_key');

  const badSlices = await req('POST', '/manager/api/cards/pool/upload', MGR_TOKEN, {
    key_id: keyId, slices: [{ card_hash: 'short', sealed_data: 'y'.repeat(24) }],
  });
  assert.equal(badSlices.status, 400);

  const ok = await upload(keyId, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(ok.status, 201);
  assert.equal(ok.json.uploaded, 5);

  // Перезаливка свободного среза заменяет конверт.
  const re = await upload(keyId, ['a']);
  assert.equal(re.json.uploaded, 1);
  const row = getDb().prepare("SELECT sealed_data, status FROM card_pool_slices WHERE card_hash = 'pool-hash-a'").get();
  assert.equal(row.status, 'pooled');
  assert.equal(row.sealed_data, mkSlice('a').sealed_data);
});

test('worker key endpoint: share есть только у W1', async () => {
  const w1 = await req('GET', '/sync/cards/pool/key', W1_TOKEN);
  assert.equal(w1.status, 200);
  assert.equal(w1.json.key_id, keyId);
  assert.equal(w1.json.sealed_key, 'sealed-key-for-w1-000000');

  const w2 = await req('GET', '/sync/cards/pool/key', W2_TOKEN);
  assert.equal(w2.status, 200);
  assert.equal(w2.json.key_id, null, 'у W2 нет share активного ключа');

  // Менеджеру воркерский эндпоинт закрыт и наоборот.
  const asMgr = await req('GET', '/sync/cards/pool', MGR_TOKEN);
  assert.equal(asMgr.status, 403);
  const asWrk = await req('GET', '/manager/api/cards/pool', W1_TOKEN);
  assert.equal(asWrk.status, 403);
});

test('reserve: валидация count и лимит по shares', async () => {
  const bad = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 0 });
  assert.equal(bad.status, 400);
  const bad2 = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 999 });
  assert.equal(bad2.status, 400);

  // W2 видит 0 доступных (нет share), reserve даёт пусто.
  const st2 = await req('GET', '/sync/cards/pool', W2_TOKEN);
  assert.equal(st2.json.available, 0);
  const r2 = await req('POST', '/sync/cards/pool/reserve', W2_TOKEN, { count: 2 });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.reserved, 0);

  // W1 бронирует 2 из 5.
  const st1 = await req('GET', '/sync/cards/pool', W1_TOKEN);
  assert.equal(st1.json.available, 5);
  const r1 = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 2 });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.reserved, 2);
  assert.equal(r1.json.slices.length, 2);
  assert.ok(r1.json.slices[0].sealed_data);

  const after = await req('GET', '/sync/cards/pool', W1_TOKEN);
  assert.equal(after.json.available, 3);
  assert.equal(after.json.mine.length, 2);
  assert.equal(after.json.mine[0].status, 'reserved');
});

test('ack → outcome; release возвращает в пул', async () => {
  const mine = await req('GET', '/sync/cards/pool', W1_TOKEN);
  const ids = mine.json.mine.map((s) => s.id);
  assert.equal(ids.length, 2);

  // outcome до ack отклоняется обновлением 0 строк
  const early = await req('POST', '/sync/cards/pool/outcome', W1_TOKEN, { ids, outcome: 'used' });
  assert.equal(early.status, 200);
  assert.equal(early.json.updated, 0);

  const ack = await req('POST', '/sync/cards/pool/ack', W1_TOKEN, { ids: [ids[0]] });
  assert.equal(ack.json.acked, 1);

  const used = await req('POST', '/sync/cards/pool/outcome', W1_TOKEN, { ids: [ids[0]], outcome: 'used' });
  assert.equal(used.json.updated, 1);
  // повторный outcome не перезаписывает
  const again = await req('POST', '/sync/cards/pool/outcome', W1_TOKEN, { ids: [ids[0]], outcome: 'burned' });
  assert.equal(again.json.updated, 0);
  const badOutcome = await req('POST', '/sync/cards/pool/outcome', W1_TOKEN, { ids: [ids[0]], outcome: 'lost' });
  assert.equal(badOutcome.status, 400);

  // Второй (ещё не ack) — release обратно в пул.
  const rel = await req('POST', '/sync/cards/pool/release', W1_TOKEN, { ids: [ids[1]] });
  assert.equal(rel.json.released, 1);
  const st = await req('GET', '/sync/cards/pool', W1_TOKEN);
  assert.equal(st.json.available, 4);
  assert.equal(st.json.mine.length, 1);
  assert.equal(st.json.mine[0].status, 'ack');
  assert.equal(st.json.mine[0].sealed_data, null, 'sealed_data после ack не отдаётся');

  // Менеджер видит «кто что взял».
  const mgrView = await req('GET', '/manager/api/cards/pool', MGR_TOKEN);
  assert.equal(mgrView.json.counts.ack, 1);
  assert.equal(mgrView.json.counts.pooled, 4);
  const taken = mgrView.json.slices.find((s) => s.status === 'ack');
  assert.equal(taken.reserved_by, W1_IID);
  assert.equal(taken.worker_label, 'Worker One');
  assert.equal(taken.outcome, 'used');
  assert.ok(!('sealed_data' in taken));
});

test('TTL: сгоревшая бронь возвращается в пул', async () => {
  const r = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 1 });
  assert.equal(r.json.reserved, 1);
  const id = r.json.slices[0].id;

  // Имитируем протухание: reserved_at старше TTL.
  getDb().prepare("UPDATE card_pool_slices SET reserved_at = datetime('now', '-48 hours') WHERE id = ?").run(id);

  const st = await req('GET', '/sync/cards/pool', W1_TOKEN);
  assert.equal(st.json.available, 4, 'сгоревшая бронь вернулась в пул');
  assert.equal(st.json.mine.length, 1, 'осталась только ack-карта');
  const row = getDb().prepare('SELECT status, reserved_by FROM card_pool_slices WHERE id = ?').get(id);
  assert.equal(row.status, 'pooled');
  assert.equal(row.reserved_by, null);
});

test('policy: пауза блокирует reserve, квота учитывает брони', async () => {
  await req('POST', '/manager/api/cards/pool/upload', MGR_TOKEN, {}); // 400 на пустом теле — игнор
  // paused
  getDb().prepare('INSERT OR REPLACE INTO worker_policies (installation_id, paused) VALUES (?, 1)').run(W1_IID);
  const paused = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 1 });
  assert.equal(paused.status, 403);
  assert.equal(paused.json.error, 'worker_paused');
  getDb().prepare('UPDATE worker_policies SET paused = 0 WHERE installation_id = ?').run(W1_IID);

  // quota: у W1 уже 1 ack сегодня → при квоте 1 новая бронь запрещена.
  getDb().prepare('UPDATE worker_policies SET quota_cards_day = 1 WHERE installation_id = ?').run(W1_IID);
  const over = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 1 });
  assert.equal(over.status, 429);
  assert.equal(over.json.error, 'quota_cards_exceeded');
  assert.equal(over.json.reserved_today, 1);
  getDb().prepare('UPDATE worker_policies SET quota_cards_day = NULL WHERE installation_id = ?').run(W1_IID);

  const ok = await req('POST', '/sync/cards/pool/reserve', W1_TOKEN, { count: 1 });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.reserved, 1);
});

test('manager revoke/return и перезаливка занятого среза', async () => {
  const mgrView = await req('GET', '/manager/api/cards/pool?status=reserved', MGR_TOKEN);
  assert.equal(mgrView.json.slices.length, 1);
  const reserved = mgrView.json.slices[0];

  // Перезаливка забронированного — пропускается.
  const tag = reserved.card_hash.replace('pool-hash-', '');
  const busy = await upload(keyId, [tag]);
  assert.equal(busy.json.uploaded, 0);
  assert.equal(busy.json.skipped_busy, 1);

  // return возвращает бронь в пул.
  const ret = await req('POST', '/manager/api/cards/pool/return', MGR_TOKEN, { ids: [reserved.id] });
  assert.equal(ret.json.returned, 1);
  const row = getDb().prepare('SELECT status, reserved_by FROM card_pool_slices WHERE id = ?').get(reserved.id);
  assert.equal(row.status, 'pooled');
  assert.equal(row.reserved_by, null);

  // revoke свободного среза.
  const rev = await req('POST', '/manager/api/cards/pool/revoke', MGR_TOKEN, { ids: [reserved.id] });
  assert.equal(rev.json.revoked, 1);
  const st = await req('GET', '/sync/cards/pool', W1_TOKEN);
  assert.equal(st.json.available, 3);

  // Перезаливка отозванного — разрешена (возврат в оборот).
  const re = await upload(keyId, [tag]);
  assert.equal(re.json.uploaded, 1);
});

test('shares add: новый воркер получает доступ к существующему ключу', async () => {
  const add = await req('POST', `/manager/api/cards/pool/keys/${keyId}/shares`, MGR_TOKEN, {
    shares: [{ installation_id: W2_IID, sealed_key: 'sealed-key1-for-w2-00000' }],
  });
  assert.equal(add.status, 200);

  const w2key = await req('GET', '/sync/cards/pool/key', W2_TOKEN);
  assert.equal(w2key.json.key_id, keyId);
  assert.equal(w2key.json.sealed_key, 'sealed-key1-for-w2-00000');

  const st = await req('GET', '/sync/cards/pool', W2_TOKEN);
  assert.ok(st.json.available >= 3, 'W2 видит пул после выдачи share');

  const missing = await req('POST', '/manager/api/cards/pool/keys/424242/shares', MGR_TOKEN, {
    shares: [{ installation_id: W2_IID, sealed_key: 'x'.repeat(24) }],
  });
  assert.equal(missing.status, 404);
});

test('audit trail фиксирует операции пула', () => {
  const rows = getDb().prepare(
    "SELECT action, COUNT(*) AS n FROM audit_log WHERE action IN ('pool_key_create','pool_upload','pool_reserve','pool_release','pool_revoke','pool_return') GROUP BY action"
  ).all();
  const byAction = Object.fromEntries(rows.map((r) => [r.action, r.n]));
  for (const a of ['pool_key_create', 'pool_upload', 'pool_reserve', 'pool_release', 'pool_revoke', 'pool_return']) {
    assert.ok((byAction[a] || 0) >= 1, `audit ${a} записан`);
  }
});
