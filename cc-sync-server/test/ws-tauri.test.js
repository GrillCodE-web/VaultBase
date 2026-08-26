// SEC-022/SEC-023: WS auth transaction + rate limit with per-IP backoff.
// better-sqlite3 has no prebuilt binding for this machine's Node, so the
// database module is stubbed via require cache — the test covers the WS
// handler logic, not SQL.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const WebSocket = require('ws');

// ── Stub ../database before ws-tauri loads it ──────────────────────────
const licenses = new Map([
  ['tok-ok', { installation_id: 'inst-ok', is_active: 1 }],
  ['tok-dead', { installation_id: 'inst-dead', is_active: 0 }],
  ['tok-mgr', { installation_id: 'inst-mgr', is_active: 1, role: 'manager' }],
  ['tok-banned', { installation_id: 'inst-banned', is_active: 1 }],
  ['tok-boom', { installation_id: 'inst-boom', is_active: 1 }],
]);
const members = new Map([['inst-ok', { group_id: 'g1' }]]);
const bannedWorkers = new Map([['inst-banned', { banned_reason: 'fraud_suspected' }]]);

const fakeDb = {
  // 'tok-boom' simulates a DB failure inside the auth transaction: the throw
  // must surface as auth_error internal_error, never as an uncaught crash.
  transaction(fn) {
    return (tkn) => {
      if (tkn === 'tok-boom') throw new Error('simulated DB failure');
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
  exports: { getDb: () => fakeDb },
};

const { WebSocketServer } = require('ws');
const initWsTauri = require('../ws-tauri');

let server;
let wss;
let port;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
}

function closed(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) return resolve(undefined);
    ws.once('close', (code) => resolve(code));
  });
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
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-ok' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_ok');
  assert.equal(msg.installation_id, 'inst-ok');
  assert.equal(msg.group_id, 'g1');
  ws.close();
});

test('auth_error for deactivated license (SEC-022)', async () => {
  const ws = await connect();
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-dead' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'invalid_token');
  await closed(ws);
});

test('auth_error for unknown token', async () => {
  const ws = await connect();
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-nope' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_error');
  await closed(ws);
});

test('manager-role license is rejected from the worker WS channel (MGR-001)', async () => {
  const ws = await connect();
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-mgr' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'manager_ws_forbidden');
  await closed(ws);
});

test('banned worker is rejected with the ban reason (MGR-001 worker_policies)', async () => {
  const ws = await connect();
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-banned' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'banned');
  assert.equal(msg.reason, 'fraud_suspected');
  await closed(ws);
});

test('DB failure during auth answers internal_error instead of hanging (MGR-001 regression)', async () => {
  const ws = await connect();
  const reply = nextMessage(ws);
  ws.send(JSON.stringify({ type: 'auth', token: 'tok-boom' }));
  const msg = await reply;
  assert.equal(msg.type, 'auth_error');
  assert.equal(msg.error, 'internal_error');
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
