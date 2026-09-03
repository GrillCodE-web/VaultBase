// REDESIGN-05-5B4: E2E-чат — сервер opaque-relay (routes/chat.js).
// Сервер хранит/отдаёт только запечатанные конверты: проверяем маршрутизацию
// (группа/менеджер), валидацию формы конверта, принадлежность key_id цели,
// TTL-уборку и at-least-once fetch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-chat-')), 'test.db');
process.env.SERVER_SECRET = 'chat-test-secret';

const { getDb, hashToken } = require('../database');
const chat = require('../routes/chat');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/manager/api', chat.managerRouter);
app.use('/sync', chat.workerRouter);

const MGR_TOKEN = 'mgr-token-chat-00000000000001';
const W1_TOKEN = 'wrk1-token-chat-0000000000001';
const W2_TOKEN = 'wrk2-token-chat-0000000000002';
const WO_TOKEN = 'wrko-token-chat-0000000000003';
const ADM_TOKEN = 'adm-token-chat-0000000000004';
const MGR_IID = 'mgr-install-chat';
const W1_IID = 'wrk1-install-chat';
const W2_IID = 'wrk2-install-chat';
const WO_IID = 'wrko-install-chat'; // другая группа — изоляция
const ADM_IID = 'adm-install-chat'; // admin: manager-side, в grp-other, ключи в обеих таблицах

let W1_KEY_ID = 0;
let W2_KEY_ID = 0;
let WO_KEY_ID = 0;
let MGR_KEY_ID = 0;
let ADM_KEY_ID = 0;
let ADM_WKEY_ID = 0;

let server;

function envelope(keyId, ctTag) {
  return JSON.stringify({
    key_id: keyId,
    ephemeral: 'ab'.repeat(32),
    nonce: 'cd'.repeat(12),
    ct: Buffer.from(`ciphertext-${ctTag}`).toString('base64'),
  });
}

function dmRoom(a, b) {
  return `dm:${[a, b].sort().join(':')}`;
}

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
  const insLic = db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)");
  insLic.run(MGR_IID, 'CH-M', hashToken(MGR_TOKEN), 'Head Manager', 'manager');
  insLic.run(W1_IID, 'CH-1', hashToken(W1_TOKEN), 'Worker One', 'operator');
  insLic.run(W2_IID, 'CH-2', hashToken(W2_TOKEN), 'Worker Two', 'operator');
  insLic.run(WO_IID, 'CH-3', hashToken(WO_TOKEN), 'Outsider', 'operator');
  insLic.run(ADM_IID, 'CH-A', hashToken(ADM_TOKEN), 'Boss Admin', 'admin');

  db.prepare("INSERT INTO sync_groups (id, name) VALUES ('grp-chat', 'Chat Group')").run();
  db.prepare("INSERT INTO sync_groups (id, name) VALUES ('grp-other', 'Other Group')").run();
  const insMem = db.prepare('INSERT INTO sync_group_members (group_id, installation_id) VALUES (?, ?)');
  insMem.run('grp-chat', W1_IID);
  insMem.run('grp-chat', W2_IID);
  insMem.run('grp-other', WO_IID);
  insMem.run('grp-other', ADM_IID);

  W1_KEY_ID = db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(W1_IID, 'aa'.repeat(32), 'w1').lastInsertRowid;
  W2_KEY_ID = db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(W2_IID, 'bb'.repeat(32), 'w2').lastInsertRowid;
  WO_KEY_ID = db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(WO_IID, 'ee'.repeat(32), 'wo').lastInsertRowid;
  MGR_KEY_ID = db.prepare('INSERT INTO manager_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(MGR_IID, 'ff'.repeat(32), 'mgr').lastInsertRowid;
  ADM_KEY_ID = db.prepare('INSERT INTO manager_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(ADM_IID, '11'.repeat(32), 'adm-mgr').lastInsertRowid;
  ADM_WKEY_ID = db.prepare('INSERT INTO worker_keys (installation_id, pubkey, label) VALUES (?, ?, ?)')
    .run(ADM_IID, '22'.repeat(32), 'adm-wrk').lastInsertRowid;

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('peers: воркер видит свою группу и менеджеров (включая admin с manager-ключом), но не чужую группу', async () => {
  const r = await req('GET', '/sync/chat/peers', W1_TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.json.self, W1_IID);
  const iids = r.json.peers.map((p) => p.installation_id).sort();
  assert.deepEqual(iids, [MGR_IID, ADM_IID, W2_IID].sort());
  const mgr = r.json.peers.find((p) => p.installation_id === MGR_IID);
  assert.equal(mgr.role, 'manager');
  assert.equal(mgr.key_id, MGR_KEY_ID);
  // admin отдаётся воркеру как менеджер с его manager-ключом
  const adm = r.json.peers.find((p) => p.installation_id === ADM_IID);
  assert.equal(adm.role, 'manager');
  assert.equal(adm.key_id, ADM_KEY_ID);
});

test('peers: admin в группе воркера не дублируется — manager-запись побеждает worker', async () => {
  const r = await req('GET', '/sync/chat/peers', WO_TOKEN);
  assert.equal(r.status, 200);
  const admHits = r.json.peers.filter((p) => p.installation_id === ADM_IID);
  assert.equal(admHits.length, 1, 'admin с ключами в обеих таблицах — ровно один пир');
  assert.equal(admHits[0].role, 'manager');
  assert.equal(admHits[0].key_id, ADM_KEY_ID);
});

test('воркер → admin (manager-side) без общей группы: и manager-ключ, и worker-ключ', async () => {
  // W1 не в grp-other: до фикса было 403 target_not_allowed.
  const byMgrKey = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: dmRoom(W1_IID, ADM_IID),
    envelopes: [{ target_iid: ADM_IID, key_id: ADM_KEY_ID, sealed_data: envelope(ADM_KEY_ID, 'to-adm-mgr') }],
  });
  assert.equal(byMgrKey.status, 201);

  const f = await req('GET', '/manager/api/chat/messages?since_id=0', ADM_TOKEN);
  assert.equal(f.status, 200, 'admin manager-side: менеджерский inbox доступен');
  assert.ok(f.json.messages.some((m) => m.sender_iid === W1_IID && m.room === dmRoom(W1_IID, ADM_IID)));

  // В общей группе (grp-other) конверт можно адресовать и worker-ключу admin'а.
  const byWrkKey = await req('POST', '/sync/chat/send', WO_TOKEN, {
    room: dmRoom(WO_IID, ADM_IID),
    envelopes: [{ target_iid: ADM_IID, key_id: ADM_WKEY_ID, sealed_data: envelope(ADM_WKEY_ID, 'to-adm-wrk') }],
  });
  assert.equal(byWrkKey.status, 201);
});

test('admin отвечает воркеру через manager-роут', async () => {
  const s = await req('POST', '/manager/api/chat/send', ADM_TOKEN, {
    target_iid: WO_IID,
    key_id: WO_KEY_ID,
    sealed_data: envelope(WO_KEY_ID, 'from-adm'),
  });
  assert.equal(s.status, 201);

  const f = await req('GET', '/sync/chat/messages?since_id=0', WO_TOKEN);
  assert.ok(f.json.messages.some((m) => m.sender_iid === ADM_IID && m.room === dmRoom(ADM_IID, WO_IID)));
});

test('send→fetch: конверт доезжает до адресата, server_id монотонен', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'm1') }],
    ref_type: 'order',
    ref_id: '12345',
  });
  assert.equal(s.status, 201);
  assert.equal(s.json.delivered, 1);

  const f = await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN);
  assert.equal(f.status, 200);
  assert.equal(f.json.messages.length, 1);
  const m = f.json.messages[0];
  assert.equal(m.room, room);
  assert.equal(m.sender_iid, W1_IID);
  assert.equal(m.ref_type, 'order');
  assert.equal(m.ref_id, '12345');
  assert.equal(JSON.parse(m.sealed_data).ct, Buffer.from('ciphertext-m1').toString('base64'));

  // since_id отсекает уже забранное
  const f2 = await req('GET', `/sync/chat/messages?since_id=${m.id}`, W2_TOKEN);
  assert.equal(f2.json.messages.length, 0);
});

test('group-room: fan-out двум членам группы одним вызовом', async () => {
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: 'group:grp-chat',
    envelopes: [
      { target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'g-w2') },
      { target_iid: MGR_IID, key_id: MGR_KEY_ID, sealed_data: envelope(MGR_KEY_ID, 'g-mgr') },
    ],
  });
  assert.equal(s.status, 201);
  assert.equal(s.json.delivered, 2);

  const fm = await req('GET', '/manager/api/chat/messages?since_id=0', MGR_TOKEN);
  assert.equal(fm.status, 200);
  assert.equal(fm.json.messages.length, 1);
  assert.equal(fm.json.messages[0].room, 'group:grp-chat');
});

test('group-room: чужая группа запрещена', async () => {
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: 'group:grp-other',
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'x') }],
  });
  assert.equal(s.status, 403);
  assert.equal(s.json.error, 'not_my_group');
});

test('изоляция: воркер чужой группы недоступен для DM', async () => {
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: dmRoom(W1_IID, WO_IID),
    envelopes: [{ target_iid: WO_IID, key_id: WO_KEY_ID, sealed_data: envelope(WO_KEY_ID, 'iso') }],
  });
  assert.equal(s.status, 403);
  assert.equal(s.json.error, 'target_not_allowed');
});

test('воркер → менеджер напрямую (без общей группы не нужно)', async () => {
  const s = await req('POST', '/sync/chat/send', WO_TOKEN, {
    room: dmRoom(WO_IID, MGR_IID),
    envelopes: [{ target_iid: MGR_IID, key_id: MGR_KEY_ID, sealed_data: envelope(MGR_KEY_ID, 'to-mgr') }],
  });
  assert.equal(s.status, 201);
});

test('key_id чужого ключа отклоняется', async () => {
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: dmRoom(W1_IID, W2_IID),
    envelopes: [{ target_iid: W2_IID, key_id: W1_KEY_ID, sealed_data: envelope(W1_KEY_ID, 'wrong-key') }],
  });
  assert.equal(s.status, 409);
  assert.equal(s.json.error, 'key_not_active_for_target');
});

test('битый конверт и мусорный room отклоняются', async () => {
  const bad1 = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: dmRoom(W1_IID, W2_IID),
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: '{"key_id":1}' }],
  });
  assert.equal(bad1.status, 400);
  const bad2 = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: 'dm:',
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'z') }],
  });
  assert.equal(bad2.status, 400);
});

test('manager → worker: канонический dm-room по умолчанию, worker его забирает', async () => {
  const s = await req('POST', '/manager/api/chat/send', MGR_TOKEN, {
    target_iid: W1_IID,
    key_id: W1_KEY_ID,
    sealed_data: envelope(W1_KEY_ID, 'from-mgr'),
  });
  assert.equal(s.status, 201);

  const f = await req('GET', '/sync/chat/messages?since_id=0', W1_TOKEN);
  const mine = f.json.messages.filter((m) => m.sender_iid === MGR_IID);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].room, dmRoom(MGR_IID, W1_IID));
});

test('manager не может писать менеджеру', async () => {
  const s = await req('POST', '/manager/api/chat/send', MGR_TOKEN, {
    target_iid: MGR_IID,
    key_id: MGR_KEY_ID,
    sealed_data: envelope(MGR_KEY_ID, 'mgr2mgr'),
  });
  assert.equal(s.status, 400);
  assert.equal(s.json.error, 'manager_is_not_a_recipient');
});

test('TTL: протухшие блобы чистятся и не отдаются', async () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO chat_messages (room, sender_iid, target_iid, sealed_data, expires_at)
    VALUES ('dm:x:y', ?, ?, ?, datetime('now', '-1 hour'))
  `).run(MGR_IID, W2_IID, envelope(MGR_KEY_ID, 'expired'));
  const before = (await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN)).json.messages.length;
  const found = db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE expires_at <= datetime('now')").get().n;
  assert.equal(found, 0, 'протухший блоб удалён ленивой уборкой при fetch');
  const after = (await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN)).json.messages.length;
  assert.equal(before, after);
});

test('auth: без токена — 401, менеджерский токен на worker-роуте — 403', async () => {
  const noAuth = await req('GET', '/sync/chat/peers', null);
  assert.equal(noAuth.status, 401);
  const mgrOnWorker = await req('GET', '/sync/chat/peers', MGR_TOKEN);
  assert.ok([401, 403].includes(mgrOnWorker.status));
  const wrkOnMgr = await req('GET', '/manager/api/chat/peers', W1_TOKEN);
  assert.ok([401, 403].includes(wrkOnMgr.status));
});
