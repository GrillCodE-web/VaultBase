/**
 * SEC-ITER1: ужесточение /verify и /activate.
 *  - kill-switch глушит оба эндпоинта (503 service_halted)
 *  - привязка лицензии к installation_id (device_mismatch)
 *  - офлайн-пермит (offline_until) только при присланном iid; 0ч = запрет
 *  - time-bomb expires_at → 403 license_expired
 *  - ротация токена: new_token выдаётся, старый живёт 24ч grace по prev_token_hash
 *  - POST /admin/api/licenses/:id/rebind перевешивает лицензию на новое железо
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN_PATH = '/ghostadmin/test-lichard';
process.env.ADMIN_PATH = ADMIN_PATH;
process.env.ADMIN_PASS = 'lichard-test-pass';
delete process.env.ADMIN_USER;
delete process.env.SESSION_SECRET;
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-lichard-')), 'test.db');
process.env.SERVER_SECRET = 'lichard-secret';

const express = require('express');
const { getDb, hashToken, setServerConfig } = require('../database');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/verify', require('../routes/verify'));
app.use('/activate', require('../routes/activate'));
app.use(`${ADMIN_PATH}/api`, require('../routes/admin-api'));

const AUTH = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASS}`).toString('base64');
let server;
let base;

function seedLicense(iid = 'iid-alpha-0001', token = 'tok-alpha', opts = {}) {
  getDb().prepare(
    `INSERT INTO licenses (installation_id, challenge, token_hash, label, is_active, role, expires_at)
     VALUES (?, 'chal', ?, 'test', 1, 'operator', ?)`
  ).run(iid, hashToken(token), opts.expires_at || null);
}

function post(p, body) {
  return fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

test('verify: валидный токен + iid → valid + offline_until', async () => {
  seedLicense();
  const r = await post('/verify', { token: 'tok-alpha', installation_id: 'iid-alpha-0001' });
  assert.strictEqual(r.status, 200);
  const d = await r.json();
  assert.strictEqual(d.valid, true);
  assert.ok(d.offline_until, 'offline permit expected');
  assert.ok(Date.parse(d.offline_until) > Date.now());
});

test('verify: чужой installation_id → 401 device_mismatch + audit', async () => {
  // Свежая лицензия, чтобы ротации из соседних тестов не двигали токен
  seedLicense('iid-bind-01', 'tok-bind');
  const r = await post('/verify', { token: 'tok-bind', installation_id: 'iid-evil-9999' });
  assert.strictEqual(r.status, 401);
  const d = await r.json();
  assert.strictEqual(d.error, 'device_mismatch');
  const log = getDb().prepare("SELECT * FROM audit_log WHERE action='device_mismatch'").all();
  assert.ok(log.length >= 1);
});

test('verify: kill-switch → 503 service_halted', async () => {
  seedLicense('iid-ks-01', 'tok-ks');
  setServerConfig('kill_switch', '1');
  const r = await post('/verify', { token: 'tok-ks', installation_id: 'iid-ks-01' });
  assert.strictEqual(r.status, 503);
  assert.strictEqual((await r.json()).error, 'service_halted');
  const ra = await post('/activate', { installation_id: 'iid-ks-01', challenge: 'chal', activation_key: 'XXXX-XXXX-XXXX-XXXX' });
  assert.strictEqual(ra.status, 503);
  setServerConfig('kill_switch', '0');
});

test('verify: просроченная лицензия → 403 license_expired', async () => {
  seedLicense('iid-expired-01', 'tok-expired', { expires_at: '2020-01-01T00:00:00Z' });
  const r = await post('/verify', { token: 'tok-expired', installation_id: 'iid-expired-01' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual((await r.json()).error, 'license_expired');
});

test('verify: ротация — new_token выдаётся, старый живёт в grace', async () => {
  seedLicense('iid-rot-01', 'tok-rot');
  setServerConfig('token_rotate_days', '1');
  // rotated_at NULL → stale → ротация при первом verify
  const r1 = await post('/verify', { token: 'tok-rot', installation_id: 'iid-rot-01' });
  const d1 = await r1.json();
  assert.ok(d1.new_token, 'expected rotated token');
  assert.notStrictEqual(d1.new_token, 'tok-rot');
  // новый токен валиден
  const r2 = await post('/verify', { token: d1.new_token, installation_id: 'iid-rot-01' });
  assert.strictEqual(r2.status, 200);
  // старый токен ещё валиден (prev grace) и провоцирует новую ротацию
  const r3 = await post('/verify', { token: 'tok-rot', installation_id: 'iid-rot-01' });
  assert.strictEqual(r3.status, 200);
  const d3 = await r3.json();
  assert.ok(d3.new_token, 'prev match triggers fresh rotation');
  assert.notStrictEqual(d3.new_token, d1.new_token);
  // ручная ротация через админку не сломана
  const ra = await fetch(`${base}${ADMIN_PATH}/api/licenses/iid-rot-01/rotate-token`, {
    method: 'POST', headers: { Authorization: AUTH },
  });
  assert.strictEqual(ra.status, 200);
});

test('verify: офлайн запрещён при offline_ttl_hours=0', async () => {
  seedLicense('iid-noff-01', 'tok-noff');
  setServerConfig('offline_ttl_hours', '0');
  const r = await post('/verify', { token: 'tok-noff', installation_id: 'iid-noff-01' });
  const d = await r.json();
  assert.strictEqual(d.offline_until, null);
  setServerConfig('offline_ttl_hours', '72');
});

test('rebind: перевешивает лицензию на новое железо, старый токен умирает', async () => {
  seedLicense('iid-old-01', 'tok-old');
  const r = await fetch(`${base}${ADMIN_PATH}/api/licenses/iid-old-01/rebind`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installation_id: 'iid-new-01', challenge: 'new-challenge-01' }),
  });
  assert.strictEqual(r.status, 200);
  // старый токен мёртв
  const rv = await post('/verify', { token: 'tok-old', installation_id: 'iid-new-01' });
  assert.strictEqual(rv.status, 401);
  // повторный ребинд на существующий iid → 409
  const r409 = await fetch(`${base}${ADMIN_PATH}/api/licenses/iid-new-01/rebind`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ installation_id: 'iid-alpha-0001', challenge: 'x-12345678' }),
  });
  assert.strictEqual(r409.status, 409);
});

test('config API: числовые ключи offline_ttl_hours / token_rotate_days', async () => {
  const rg = await fetch(`${base}${ADMIN_PATH}/api/config`, { headers: { Authorization: AUTH } });
  const cfg = await rg.json();
  assert.ok('offline_ttl_hours' in cfg && 'token_rotate_days' in cfg);
  const rs = await fetch(`${base}${ADMIN_PATH}/api/config`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'offline_ttl_hours', value: '48' }),
  });
  assert.strictEqual(rs.status, 200);
  assert.strictEqual(getServerConfigSafe('offline_ttl_hours'), '48');
  const bad = await fetch(`${base}${ADMIN_PATH}/api/config`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'offline_ttl_hours', value: 'abc' }),
  });
  assert.strictEqual(bad.status, 400);
  setServerConfig('offline_ttl_hours', '72');
});

function getServerConfigSafe(k) {
  return getDb().prepare('SELECT value FROM server_config WHERE key=?').get(k)?.value;
}
