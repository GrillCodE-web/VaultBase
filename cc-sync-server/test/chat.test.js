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

// ── CHAT-2.0 (manager-work-0bp): delivered/read квитанции ────────────────────

test('outbox: исходящие без sealed_data, delivered_at появляется после fetch получателем', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'ob1') }],
  });
  assert.equal(s.status, 201);
  const id = s.json.ids[0];

  let ob = await req('GET', '/sync/chat/outbox', W1_TOKEN);
  assert.equal(ob.status, 200);
  let row = ob.json.messages.find((m) => m.id === id);
  assert.ok(row, 'своя исходящая строка видна');
  assert.equal(row.delivered_at, null, 'до fetch получателем — не доставлено');
  assert.equal(row.sealed_data, undefined, 'sealed_data не отдаётся в outbox');
  assert.equal(row.target_iid, W2_IID);

  await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN);

  ob = await req('GET', '/sync/chat/outbox', W1_TOKEN);
  row = ob.json.messages.find((m) => m.id === id);
  assert.ok(row.delivered_at, 'delivered_at выставлен после выдачи блоба устройству');
});

test('outbox: курсор updated_since ловит свежие delivered_at и отсекает старое', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'ob2') }],
  });
  const id = s.json.ids[0];

  // Будущее → пусто.
  const future = await req('GET', `/sync/chat/outbox?updated_since=${encodeURIComponent('2999-01-01 00:00:00')}`, W1_TOKEN);
  assert.equal(future.json.messages.length, 0);

  // Мусорный курсор не роняет роут — трактуется как «с начала времён».
  const bad = await req('GET', '/sync/chat/outbox?updated_since=not-a-date', W1_TOKEN);
  assert.equal(bad.status, 200);
  assert.ok(bad.json.messages.some((m) => m.id === id));

  // После fetch получателем строка всплывает по курсору created_at + 1 сек
  // (delivered_at > курсора), хотя id строки давно известен клиенту.
  await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN);
  const db = getDb();
  const created = db.prepare('SELECT created_at FROM chat_messages WHERE id = ?').get(id).created_at;
  const ob = await req('GET', `/sync/chat/outbox?updated_since=${encodeURIComponent(created)}`, W1_TOKEN);
  const row = ob.json.messages.find((m) => m.id === id);
  assert.ok(row && row.delivered_at, 'обновление delivered_at видно по курсору');
});

test('read receipt едет обратно отправителю обычным sealed-конвертом (opaque)', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'rc-subj') }],
  });
  const id = s.json.ids[0];
  await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN);

  // Реальный клиент прячет {"type":"read_receipt","ids":[id]} внутрь ct;
  // сервер видит только форму конверта — проверяем именно релей обратно.
  const r = await req('POST', '/sync/chat/send', W2_TOKEN, {
    room,
    envelopes: [{ target_iid: W1_IID, key_id: W1_KEY_ID, sealed_data: envelope(W1_KEY_ID, `read_receipt:${id}`) }],
    ttl_hours: 72, // квитанции живут меньше обычных сообщений
  });
  assert.equal(r.status, 201);

  const f = await req('GET', '/sync/chat/messages?since_id=0', W1_TOKEN);
  const receipt = f.json.messages.find(
    (m) => m.room === room && m.sender_iid === W2_IID
      && JSON.parse(m.sealed_data).ct === Buffer.from(`ciphertext-read_receipt:${id}`).toString('base64')
  );
  assert.ok(receipt, 'квитанция долетела до отправителя через существующий релей');
});

test('manager outbox: исходящие менеджера, delivered_at после fetch воркером', async () => {
  const s = await req('POST', '/manager/api/chat/send', MGR_TOKEN, {
    target_iid: W1_IID,
    key_id: W1_KEY_ID,
    sealed_data: envelope(W1_KEY_ID, 'ob-mgr'),
  });
  assert.equal(s.status, 201);
  const id = s.json.id;

  let ob = await req('GET', '/manager/api/chat/outbox', MGR_TOKEN);
  let row = ob.json.messages.find((m) => m.id === id);
  assert.ok(row && row.delivered_at === null);

  await req('GET', '/sync/chat/messages?since_id=0', W1_TOKEN);
  ob = await req('GET', '/manager/api/chat/outbox', MGR_TOKEN);
  row = ob.json.messages.find((m) => m.id === id);
  assert.ok(row.delivered_at, 'менеджер видит доставку воркеру');

  const noAuth = await req('GET', '/sync/chat/outbox', null);
  assert.equal(noAuth.status, 401);
  const wrkOnMgr = await req('GET', '/manager/api/chat/outbox', W1_TOKEN);
  assert.ok([401, 403].includes(wrkOnMgr.status));
});

// CHAT-2.0 (g80): typing-релей — эфемерно, валидация адресата как у send,
// серверный троттлинг 2с на пару.
test('typing: валидация room/target и троттлинг', async () => {
  const bad1 = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: 'junk', target_iid: W2_IID });
  assert.equal(bad1.status, 400);
  const bad2 = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W1_IID, W2_IID), target_iid: W1_IID });
  assert.equal(bad2.status, 400); // сам себе нельзя
  const bad3 = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W2_IID, WO_IID), target_iid: W2_IID });
  assert.equal(bad3.status, 400); // чужой dm-room
  const noAuth = await req('POST', '/sync/chat/typing', null, { room: dmRoom(W1_IID, W2_IID), target_iid: W2_IID });
  assert.equal(noAuth.status, 401);

  const ok = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W1_IID, W2_IID), target_iid: W2_IID });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.ok(!ok.json.throttled, 'первый сигнал проходит');

  const again = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W1_IID, W2_IID), target_iid: W2_IID });
  assert.equal(again.status, 200);
  assert.equal(again.json.throttled, true, 'второй подряд — троттлится');
});

test('typing: изоляция групп и доступ к менеджеру', async () => {
  const outsider = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W1_IID, WO_IID), target_iid: WO_IID });
  assert.equal(outsider.status, 403); // чужая группа

  const toMgr = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: dmRoom(W1_IID, MGR_IID), target_iid: MGR_IID });
  assert.equal(toMgr.status, 200); // менеджеру можно без общей группы

  const group = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: 'group:grp-chat', target_iid: W2_IID });
  assert.equal(group.status, 200);
  const notMine = await req('POST', '/sync/chat/typing', W1_TOKEN, { room: 'group:grp-other', target_iid: W2_IID });
  assert.equal(notMine.status, 403);
});

// CHAT-2.0 (iul): presence — peers отдаёт online/last_seen обоим сторонам.
test('peers: online/last_seen присутствуют у каждого пира (worker-роут)', async () => {
  const r = await req('GET', '/sync/chat/peers', W1_TOKEN);
  assert.equal(r.status, 200);
  assert.ok(r.json.peers.length > 0);
  for (const p of r.json.peers) {
    assert.equal(typeof p.online, 'boolean', `online у ${p.installation_id}`);
    assert.ok('last_seen' in p, `last_seen у ${p.installation_id}`);
  }
  // WS в этом тесте не поднят — все оффлайн, но last_seen свежий от HTTP.
  assert.ok(r.json.peers.every((p) => p.online === false));
});

test('peers: online/last_seen на manager-роуте', async () => {
  const r = await req('GET', '/manager/api/chat/peers', MGR_TOKEN);
  assert.equal(r.status, 200);
  assert.ok(r.json.peers.length > 0);
  for (const p of r.json.peers) {
    assert.equal(typeof p.online, 'boolean');
    assert.ok('last_seen' in p);
  }
});

// t8l: hard-delete — стереть можно только свои строки (sender_iid), идемпотентно.
test('delete: автор стирает свою строку, чужой — не может, повтор идемпотентен', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'del-subj') }],
  });
  assert.equal(s.status, 201);
  const id = s.json.ids[0];

  // Не автор (W2) — 0 удалено, строка на месте.
  const foreign = await req('POST', '/sync/chat/delete', W2_TOKEN, { ids: [id] });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.json.deleted, 0);

  // Автор (W1) — строка стёрта.
  const own = await req('POST', '/sync/chat/delete', W1_TOKEN, { ids: [id] });
  assert.equal(own.status, 200);
  assert.equal(own.json.deleted, 1);

  // Повтор — идемпотентно, 0 удалено.
  const again = await req('POST', '/sync/chat/delete', W1_TOKEN, { ids: [id] });
  assert.equal(again.status, 200);
  assert.equal(again.json.deleted, 0);

  // Валидация формы.
  const bad = await req('POST', '/sync/chat/delete', W1_TOKEN, { ids: [] });
  assert.equal(bad.status, 400);
  const noAuth = await req('POST', '/sync/chat/delete', null, { ids: [id] });
  assert.equal(noAuth.status, 401);
});

// m4i: пользовательские комнаты — создание, релей по членству (в т.ч. между
// разными лицензионными группами), список, правка состава, изоляция.
test('rooms: создание, релей только членам, список и правка состава', async () => {
  // W1 создаёт комнату и добавляет WO (из ДРУГОЙ группы) — членство важнее группы.
  const created = await req('POST', '/sync/chat/rooms', W1_TOKEN, {
    title: 'Отдел доставки',
    members: [WO_IID],
  });
  assert.equal(created.status, 201);
  const room = created.json.room;
  assert.match(room, /^room:[0-9a-f]+$/);
  assert.deepEqual(created.json.members.sort(), [W1_IID, WO_IID].sort());

  // Член (W1) шлёт другому члену (WO) — 201, хотя они в разных группах.
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room,
    envelopes: [{ target_iid: WO_IID, key_id: WO_KEY_ID, sealed_data: envelope(WO_KEY_ID, 'room-hi') }],
  });
  assert.equal(s.status, 201);
  const f = await req('GET', '/sync/chat/messages?since_id=0', WO_TOKEN);
  assert.ok(f.json.messages.some((m) => m.room === room && m.sender_iid === W1_IID));

  // Не член (W2) писать в комнату не может.
  const notMember = await req('POST', '/sync/chat/send', W2_TOKEN, {
    room,
    envelopes: [{ target_iid: WO_IID, key_id: WO_KEY_ID, sealed_data: envelope(WO_KEY_ID, 'sneak') }],
  });
  assert.equal(notMember.status, 403);

  // Владелец видит комнату в своём списке; посторонний (W2) — нет.
  const mine = await req('GET', '/sync/chat/rooms', W1_TOKEN);
  assert.ok(mine.json.rooms.some((r) => r.room === room));
  const other = await req('GET', '/sync/chat/rooms', W2_TOKEN);
  assert.ok(!other.json.rooms.some((r) => r.room === room));

  // Менеджер видит все комнаты (m4i: «менеджер видит всех»).
  const mgr = await req('GET', '/manager/api/chat/rooms', MGR_TOKEN);
  assert.ok(mgr.json.rooms.some((r) => r.room === room));

  // Владелец добавляет W2 и удаляет WO; владельца выкинуть нельзя (игнор).
  const upd = await req('POST', '/sync/chat/rooms/members', W1_TOKEN, {
    room, add: [W2_IID], remove: [WO_IID, W1_IID],
  });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.json.members.sort(), [W1_IID, W2_IID].sort());

  // Теперь W2 — член и может писать, WO — уже нет.
  const s2 = await req('POST', '/sync/chat/send', W2_TOKEN, {
    room,
    envelopes: [{ target_iid: W1_IID, key_id: W1_KEY_ID, sealed_data: envelope(W1_KEY_ID, 'now-member') }],
  });
  assert.equal(s2.status, 201);
  const woGone = await req('POST', '/sync/chat/send', WO_TOKEN, {
    room,
    envelopes: [{ target_iid: W1_IID, key_id: W1_KEY_ID, sealed_data: envelope(W1_KEY_ID, 'kicked') }],
  });
  assert.equal(woGone.status, 403);
});

test('rooms: валидация и права на правку состава', async () => {
  const created = await req('POST', '/sync/chat/rooms', W1_TOKEN, { title: 'Room X' });
  const room = created.json.room;

  // Пустой заголовок отклоняется.
  const noTitle = await req('POST', '/sync/chat/rooms', W1_TOKEN, { title: '   ' });
  assert.equal(noTitle.status, 400);

  // Неизвестный участник в составе — 400.
  const badMember = await req('POST', '/sync/chat/rooms', W1_TOKEN, {
    title: 'Bad', members: ['nope-iid'],
  });
  assert.equal(badMember.status, 400);

  // Не владелец и не менеджер править состав не может.
  const notOwner = await req('POST', '/sync/chat/rooms/members', W2_TOKEN, {
    room, add: [W2_IID],
  });
  assert.equal(notOwner.status, 403);

  // Менеджер может править любой состав.
  const byMgr = await req('POST', '/manager/api/chat/rooms/members', MGR_TOKEN, {
    room, add: [W2_IID],
  });
  assert.equal(byMgr.status, 200);
  assert.ok(byMgr.json.members.includes(W2_IID));

  // Неизвестная комната — 404.
  const noRoom = await req('POST', '/sync/chat/rooms/members', W1_TOKEN, {
    room: 'room:deadbeef', add: [W2_IID],
  });
  assert.equal(noRoom.status, 404);

  const noAuth = await req('POST', '/sync/chat/rooms', null, { title: 'x' });
  assert.equal(noAuth.status, 401);
});

// qhi: комната объявлений — read-only рассылка от менеджера.
const ANNOUNCE_ROOM = 'room:announcements-grp-chat';

test('announce: менеджер рассылает fan-out, оба воркера получают', async () => {
  const s = await req('POST', '/manager/api/chat/send', MGR_TOKEN, {
    room: ANNOUNCE_ROOM,
    ref_type: 'news',
    ref_id: '7',
    envelopes: [
      { target_iid: W1_IID, key_id: W1_KEY_ID, sealed_data: envelope(W1_KEY_ID, 'ann-w1') },
      { target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'ann-w2') },
    ],
  });
  assert.equal(s.status, 201);
  assert.equal(s.json.delivered, 2);

  const f1 = await req('GET', '/sync/chat/messages?since_id=0', W1_TOKEN);
  assert.ok(f1.json.messages.some((m) => m.room === ANNOUNCE_ROOM && m.sender_iid === MGR_IID));
  const f2 = await req('GET', '/sync/chat/messages?since_id=0', W2_TOKEN);
  assert.ok(f2.json.messages.some((m) => m.room === ANNOUNCE_ROOM && m.sender_iid === MGR_IID));
});

test('announce: воркер не может писать в комнату объявлений (403)', async () => {
  const s = await req('POST', '/sync/chat/send', W1_TOKEN, {
    room: ANNOUNCE_ROOM,
    envelopes: [{ target_iid: W2_IID, key_id: W2_KEY_ID, sealed_data: envelope(W2_KEY_ID, 'nope') }],
  });
  assert.equal(s.status, 403);
  assert.equal(s.json.error, 'announcements_readonly');
});

test('announce: воркер не может слать «печатает…» в комнату объявлений (403)', async () => {
  const s = await req('POST', '/sync/chat/typing', W1_TOKEN, {
    room: ANNOUNCE_ROOM, target_iid: W2_IID,
  });
  assert.equal(s.status, 403);
  assert.equal(s.json.error, 'announcements_readonly');
});


// mgt: peers знает о со-участниках моих комнат — иначе fan-out в комнату не
// сможет запечатать конверт тому, кто не в моей лицензионной группе.
test('mgt: peers включает со-участника комнаты из другой группы', async () => {
  const created = await req('POST', '/sync/chat/rooms', W1_TOKEN, {
    title: 'Кросс-группа',
    members: [WO_IID],
  });
  assert.equal(created.status, 201);
  // WO живёт в grp-other, не в группе W1 — но теперь виден W1 как peer.
  const r = await req('GET', '/sync/chat/peers', W1_TOKEN);
  assert.equal(r.status, 200);
  const wo = r.json.peers.find((p) => p.installation_id === WO_IID);
  assert.ok(wo, 'WO виден W1 через общую комнату');
  assert.equal(wo.key_id, WO_KEY_ID);
  assert.ok(wo.pubkey && wo.pubkey.length > 0);
});

test('yyt: пин/анпин сообщения — список, идемпотентность, доступ обеих сторон', async () => {
  const room = dmRoom(W1_IID, W2_IID);
  // Пусто до первого пина.
  const empty = await req('GET', `/sync/chat/pins?room=${room}`, W1_TOKEN);
  assert.equal(empty.status, 200);
  assert.equal(empty.json.pins.length, 0);

  // W1 закрепляет сообщение 42.
  const p1 = await req('POST', '/sync/chat/pins', W1_TOKEN, { room, message_id: 42, pinned: true });
  assert.equal(p1.status, 200);
  assert.equal(p1.json.pins.length, 1);
  assert.equal(p1.json.pins[0].message_id, 42);
  assert.equal(p1.json.pins[0].pinned_by, W1_IID);

  // Повторный пин идемпотентен (INSERT OR IGNORE) — по-прежнему одна запись.
  const p1again = await req('POST', '/sync/chat/pins', W1_TOKEN, { room, message_id: 42, pinned: true });
  assert.equal(p1again.json.pins.length, 1);

  // Вторая сторона DM (W2) видит тот же пин.
  const w2list = await req('GET', `/sync/chat/pins?room=${room}`, W2_TOKEN);
  assert.equal(w2list.status, 200);
  assert.equal(w2list.json.pins.length, 1);
  assert.equal(w2list.json.pins[0].message_id, 42);

  // Анпин — список пустеет.
  const un = await req('POST', '/sync/chat/pins', W1_TOKEN, { room, message_id: 42, pinned: false });
  assert.equal(un.status, 200);
  assert.equal(un.json.pins.length, 0);
});

test('yyt: доступ к пинам — менеджер видит всё, чужак получает 403', async () => {
  const room = 'group:grp-chat';
  const pinned = await req('POST', '/sync/chat/pins', W1_TOKEN, { room, message_id: 7, pinned: true });
  assert.equal(pinned.status, 200);

  // Менеджер (manager-side) видит пины любой комнаты.
  const mgr = await req('GET', `/manager/api/chat/pins?room=${room}`, MGR_TOKEN);
  assert.equal(mgr.status, 200);
  assert.ok(mgr.json.pins.some((p) => p.message_id === 7));

  // WO не член grp-chat и не менеджер — 403 и на чтение, и на пин.
  const woList = await req('GET', `/sync/chat/pins?room=${room}`, WO_TOKEN);
  assert.equal(woList.status, 403);
  const woPin = await req('POST', '/sync/chat/pins', WO_TOKEN, { room, message_id: 9, pinned: true });
  assert.equal(woPin.status, 403);
});

test('yyt: валидация room и message_id', async () => {
  const badRoom = await req('POST', '/sync/chat/pins', W1_TOKEN, { room: 'garbage', message_id: 1 });
  assert.equal(badRoom.status, 400);
  assert.equal(badRoom.json.error, 'room_invalid');

  const badId = await req('POST', '/sync/chat/pins', W1_TOKEN, { room: dmRoom(W1_IID, W2_IID), message_id: 0 });
  assert.equal(badId.status, 400);
  assert.equal(badId.json.error, 'message_id_invalid');
});
