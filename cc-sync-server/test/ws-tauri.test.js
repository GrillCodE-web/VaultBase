// SEC-022/SEC-023: WS auth transaction + rate limit with per-IP backoff.
// better-sqlite3 has no prebuilt binding for this machine's Node, so the
// database module is stubbed via require cache — the test covers the WS
// handler logic, not SQL.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');

// ── Stub ../database before ws-tauri loads it ──────────────────────────
// MGR-008: сервер ищет лицензии по SHA-256 хешу токена, поэтому стаб
// ключевой мапы — по хешам. Реальный ../database требует better-sqlite3,
// которого на тестовой машине нет — хеш считаем здесь так же, как в database.js.
const crypto = require('crypto');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

const licenses = new Map([
  [hashToken('tok-ok'), { installation_id: 'inst-ok', is_active: 1 }],
  [hashToken('tok-dead'), { installation_id: 'inst-dead', is_active: 0 }],
  [hashToken('tok-mgr'), { installation_id: 'inst-mgr', is_active: 1, role: 'manager' }],
  [hashToken('tok-banned'), { installation_id: 'inst-banned', is_active: 1 }],
  [hashToken('tok-boom'), { installation_id: 'inst-boom', is_active: 1 }],
]);
const members = new Map([['inst-ok', { group_id: 'g1' }]]);
const bannedWorkers = new Map([['inst-banned', { banned_reason: 'fraud_suspected' }]]);

const fakeDb = {
  // 'tok-boom' simulates a DB failure inside the auth transaction: the throw
  // must surface as auth_error internal_error, never as an uncaught crash.
  transaction(fn) {
    return (tkn) => {
      if (tkn === hashToken('tok-boom')) throw new Error('simulated DB failure');
      return fn(tkn);
    };
  },
  prepare(sql) {
    if (sql.includes('FROM licenses')) {
      return { get: (token) => licenses.get(token) };
    }
    if (sql.includes('UPDATE licenses SET last_seen')) {
      return { run: () => ({ changes: 1 }) };
    }
    if (sql.includes('worker_policies')) {
      return { get: (iid) => bannedWorkers.get(iid) };
    }
    if (sql.includes('sync_group_members')) {
      return { get: (iid) => members.get(iid) };
    }
    throw new Error(`unexpected SQL in stub: ${sql}`);
  },
};

const dbModulePath = require.resolve('../database');
require.cache[dbModulePath] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: {
    getDb: () => fakeDb,
    hashToken,
    isKillSwitchOn: () => process.env.TEST_KILL_SWITCH === '1',
    isWsNonceRequired: () => process.env.WS_REQUIRE_NONCE === '1',
  },
};

const { WebSocketServer } = require('ws');
const initWsTauri = require('../ws-tauri');

let server;
let wss;
let port;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    // MGR-008: сервер шлёт auth_challenge сразу при коннекте — возможно раньше,
    // чем тест успеет повесить once('message'). Буферизуем входящие сообщения
    // в очередь: ws.next() забирает первое необработанное (FIFO).
    const queue = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (waiters.length) waiters.shift()(m);
      else queue.push(m);
    });
    ws.next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return ws.next();
}

function closed(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) return resolve(undefined);
    ws.once('close', (code) => resolve(code));
  });
}

// MGR-008: сервер первым фреймом шлёт auth_challenge (одноразовый nonce).
// По умолчанию auth эхом возвращает этот nonce; opts.nonce === null — legacy auth без nonce.
async function authenticate(ws, token, opts = {}) {
  const challenge = await nextMessage(ws);
  assert.equal(challenge.type, 'auth_challenge');
  assert.ok(typeof challenge.nonce === 'string' && challenge.nonce.length >= 16);
  const auth = { type: 'auth', token };
  if (opts.nonce !== null) auth.nonce = opts.nonce ?? challenge.nonce;
  ws.send(JSON.stringify(auth));
  return nextMessage(ws);
}

test.before(async () => {
  server = http.createServer();
  wss = new WebSocketServer({ server, path: '/ws' });
  initWsTauri(wss, null);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

test.after(async () => {
  initWsTauri.shutdown();
  wss.close();
  await new Promise((r) => server.close(r));
});

test('auth_ok with valid active license (SEC-022 transaction path)', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-ok');
  assert.equal(msg.type, 'auth_ok');
  assert.equal(msg.installation_id, 'inst-ok');
  assert.equal(msg.group_id, 'g1');
  ws.close();
});

test('legacy auth without nonce still works while ws_require_nonce is off', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-ok', { nonce: null });
  assert.equal(msg.type, 'auth_ok');
  ws.close();
});

test('auth_error for deactivated license (SEC-022)', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-dead');
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'invalid_token');
  await closed(ws);
});

test('auth_error for unknown token', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-nope');
  assert.equal(msg.type, 'auth_error');
  await closed(ws);
});

test('manager-role license is rejected from the worker WS channel (MGR-001)', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-mgr');
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'manager_ws_forbidden');
  await closed(ws);
});

test('banned worker is rejected with the ban reason (MGR-001 worker_policies)', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-banned');
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'banned');
  assert.equal(msg.reason, 'fraud_suspected');
  await closed(ws);
});

test('DB failure during auth answers internal_error instead of hanging (MGR-001 regression)', async () => {
  const ws = await connect();
  const msg = await authenticate(ws, 'tok-boom');
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'internal_error');
  await closed(ws);
});

test('MGR-008: ws_require_nonce=1 rejects auth without or with foreign nonce (anti-replay)', async (t) => {
  process.env.WS_REQUIRE_NONCE = '1';
  t.after(() => { delete process.env.WS_REQUIRE_NONCE; });

  // Без nonce — отказ.
  const ws1 = await connect();
  const msg1 = await authenticate(ws1, 'tok-ok', { nonce: null });
  assert.equal(msg1.type, 'auth_error');
  assert.equal(msg1.error, 'bad_nonce');
  await closed(ws1);

  // Чужой (переигранный) nonce с другого подключения — отказ: перехваченное
  // auth-сообщение нельзя переиспользовать.
  const ws2a = await connect();
  const challenge2 = await nextMessage(ws2a);
  const foreignNonce = challenge2.nonce;
  ws2a.close();
  const ws2 = await connect();
  const msg2 = await authenticate(ws2, 'tok-ok', { nonce: foreignNonce });
  assert.equal(msg2.type, 'auth_error');
  assert.equal(msg2.error, 'bad_nonce');
  await closed(ws2);

  // Свежий nonce своего подключения — успех.
  const ws3 = await connect();
  const msg3 = await authenticate(ws3, 'tok-ok');
  assert.equal(msg3.type, 'auth_ok');
  ws3.close();
});

test('MGR-008: kill-switch rejects worker WS auth with service_halted', async (t) => {
  process.env.TEST_KILL_SWITCH = '1';
  t.after(() => { delete process.env.TEST_KILL_SWITCH; });

  const ws = await connect();
  const msg = await authenticate(ws, 'tok-ok');
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'service_halted');
  await closed(ws);
});

test('SEC-023: >20 msg/sec closes with 4002 and reconnect is backoff-banned', async (t) => {
  // Rate-limit ban is per-IP (127.0.0.1 here), so this test runs last and
  // clears the violation state afterwards to not affect other files' state
  // (node --test isolates files per process, but keep it clean regardless).
  const ws = await connect();
  const wasClosed = closed(ws);
  for (let i = 0; i < 25; i++) ws.send(JSON.stringify({ type: 'ping' }));
  assert.equal(await wasClosed, 4002);

  const ws2 = await connect();
  assert.equal(await closed(ws2), 4002);

  t.after(() => initWsTauri._clearViolationsForTest());
});
