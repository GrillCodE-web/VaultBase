const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-manager-')), 'test.db');
// requireAdmin/basicAuthValid читают env на каждый запрос — хватает установки до тестов.
process.env.ADMIN_PASS = 'manager-suite-admin-pass';

const { getDb, hashToken } = require('../database');
const managerApi = require('../routes/manager-api');
const adminApi = require('../routes/admin-api');
const telemetry = require('../routes/telemetry');
const alertsEngine = require('../alerts-engine');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/manager/api', managerApi);
app.use('/admin/api', adminApi);
app.use('/api/telemetry', telemetry);
app.use('/update', require('../routes/update'));

const MGR_TOKEN = 'mgr-token-1234567890abcdef';
const WRK_TOKEN = 'wrk-token-1234567890abcdef';
const ADM_TOKEN = 'adm-token-1234567890abcdef';
const MGR_IID = 'mgr-install-0001';
const WRK_IID = 'wrk-install-0001';
const ADM_IID = 'adm-install-0001';

let server;

function envelope(keyId) {
  return {
    key_id: keyId,
    ephemeral: 'ab'.repeat(32),
    nonce: 'cd'.repeat(12),
    ct: Buffer.from('sealed-payload').toString('base64'),
  };
}

async function req(method, p, token, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

async function activeKey() {
  const r = await req('GET', '/api/telemetry/keys', WRK_TOKEN);
  assert.equal(r.status, 200);
  assert.ok(r.json.keys.length >= 1, 'at least one active manager key expected');
  return r.json.keys[0].id;
}

test.before(async () => {
  const db = getDb();
  // MGR-008: в БД хранится только SHA-256 хеш токена (колонка token = NULL,
  // как после миграции v13). Открытые токены — только в заголовках запросов.
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(MGR_IID, 'CHALLENGE1', hashToken(MGR_TOKEN), 'Head Manager', 'manager');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(WRK_IID, 'CHALLENGE2', hashToken(WRK_TOKEN), 'Worker One', 'operator');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, token_hash, label, role, is_active) VALUES (?,?,NULL,?,?,?,1)")
    .run(ADM_IID, 'CHALLENGE3', hashToken(ADM_TOKEN), 'Boss Admin', 'admin');
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const { closeDb } = require('../database');
  closeDb();
});

test('telemetry requires a bearer token', async () => {
  const r = await req('GET', '/api/telemetry/policy');
  assert.equal(r.status, 401);
});

test('manager token cannot act as worker', async () => {
  const r = await req('POST', '/api/telemetry/heartbeat', MGR_TOKEN, { envelopes: [envelope(1)] });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'worker_required');
});

test('worker token cannot call manager api', async () => {
  const r = await req('GET', '/manager/api/overview', WRK_TOKEN);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'manager_required');
});

test('admin token is manager-side: manager api allowed, worker api not blocked', async () => {
  const ov = await req('GET', '/manager/api/overview', ADM_TOKEN);
  assert.equal(ov.status, 200);
  const policy = await req('GET', '/api/telemetry/policy', ADM_TOKEN);
  assert.equal(policy.status, 200);
});

test('manager key upload, exposure to workers and rotation', async () => {
  const pub = 'ab'.repeat(32);
  const r1 = await req('POST', '/manager/api/keys', MGR_TOKEN, { pubkey: pub, label: 'primary' });
  assert.equal(r1.status, 201);
  const firstId = r1.json.id;

  const badPub = await req('POST', '/manager/api/keys', MGR_TOKEN, { pubkey: 'xyz' });
  assert.equal(badPub.status, 400);

  const keys = await req('GET', '/api/telemetry/keys', WRK_TOKEN);
  assert.equal(keys.json.keys.length, 1);
  assert.equal(keys.json.keys[0].pubkey, pub);

  const r2 = await req('POST', '/manager/api/keys', MGR_TOKEN, { pubkey: 'cd'.repeat(32) });
  assert.equal(r2.status, 201);
  assert.notEqual(r2.json.id, firstId);

  const keys2 = await req('GET', '/api/telemetry/keys', WRK_TOKEN);
  assert.equal(keys2.json.keys.length, 1);
  assert.equal(keys2.json.keys[0].id, r2.json.id);

  const own = await req('GET', '/manager/api/keys', MGR_TOKEN);
  assert.equal(own.json.keys.length, 2);
  assert.equal(own.json.keys.filter((k) => k.is_active === 1).length, 1);
});

test('heartbeat rejects unknown key and bad envelope shape', async () => {
  const unknown = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(999)] });
  assert.equal(unknown.status, 409);

  const malformed = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, {
    envelopes: [{ key_id: 1, ephemeral: 'nothex', nonce: 'cd'.repeat(12), ct: 'AAAA' }],
  });
  assert.equal(malformed.status, 400);
});

test('heartbeat stores envelope and returns default policy', async () => {
  const keyId = await activeKey();
  const r = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(keyId)] }, { 'x-app-version': '2.11.3' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.policy.banned, 0);
  assert.equal(r.json.update_required, false);

  const db = getDb();
  const hb = db.prepare('SELECT * FROM worker_heartbeats WHERE installation_id = ?').get(WRK_IID);
  assert.ok(hb);
  assert.equal(hb.key_id, keyId);
  const hist = db.prepare('SELECT COUNT(*) AS n FROM worker_heartbeat_history WHERE installation_id = ?').get(WRK_IID).n;
  assert.ok(hist >= 1);
});

test('overview counts workers, managers and online status', async () => {
  const r = await req('GET', '/manager/api/overview', MGR_TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.json.workers_total, 2); // WRK + admin-фикстура (в статистике флота admin — воркер)
  assert.equal(r.json.workers_online, 1);
  assert.equal(r.json.managers, 1);
  assert.equal(r.json.manager_keys_active, 1);
});

test('workers listing never exposes tokens', async () => {
  const r = await req('GET', '/manager/api/workers', MGR_TOKEN);
  assert.equal(r.status, 200);
  const row = r.json.workers.find((w) => w.installation_id === WRK_IID);
  assert.ok(row);
  assert.ok(!('token' in row));
  assert.ok(row.hb_key_id);
  assert.ok(typeof row.hb_envelope === 'string');
});

test('policy ban blocks channels and is delivered with the 403', async () => {
  const set = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, {
    banned: true,
    banned_reason: 'suspicious activity',
  });
  assert.equal(set.status, 200);
  assert.equal(set.json.policy.banned, 1);

  const hb = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(1)] });
  assert.equal(hb.status, 403);
  assert.equal(hb.json.error, 'banned');
  assert.equal(hb.json.policy.banned_reason, 'suspicious activity');

  const policy = await req('GET', '/api/telemetry/policy', WRK_TOKEN);
  assert.equal(policy.status, 403);
  assert.equal(policy.json.error, 'banned');

  const unban = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { banned: false });
  assert.equal(unban.status, 200);
  const keyId = await activeKey();
  const ok = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(keyId)] });
  assert.equal(ok.status, 200);
});

test('min_version policy flags update_required unless version_exempt', async () => {
  const keyId = await activeKey();
  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { min_version: '2.12.0' });
  const flagged = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(keyId)] }, { 'x-app-version': '2.11.3' });
  assert.equal(flagged.status, 200);
  assert.equal(flagged.json.update_required, true);

  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { version_exempt: true });
  const exempt = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(keyId)] }, { 'x-app-version': '2.11.3' });
  assert.equal(exempt.json.update_required, false);

  const restored = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { min_version: null, version_exempt: false });
  assert.equal(restored.json.policy.min_version, null);
});

test('force_logout flag is set, delivered and acked', async () => {
  await req('POST', `/manager/api/workers/${WRK_IID}/force-logout`, MGR_TOKEN);
  const policy = await req('GET', '/api/telemetry/policy', WRK_TOKEN);
  assert.equal(policy.json.policy.force_logout, 1);

  const keyId = await activeKey();
  const hb = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, {
    envelopes: [envelope(keyId)],
    ack_force_logout: true,
  });
  assert.equal(hb.json.policy.force_logout, 0);
});

test('reports are stored as ciphertext and returned to the manager', async () => {
  const keyId = await activeKey();
  const today = new Date().toISOString().slice(0, 10);

  const badKind = await req('POST', '/api/telemetry/report', WRK_TOKEN, { kind: 'nope', date: today, envelopes: [envelope(keyId)] });
  assert.equal(badKind.status, 400);

  const r = await req('POST', '/api/telemetry/report', WRK_TOKEN, { kind: 'daily_stats', date: today, envelopes: [envelope(keyId)] });
  assert.equal(r.status, 200);
  const again = await req('POST', '/api/telemetry/report', WRK_TOKEN, { kind: 'daily_stats', date: today, envelopes: [envelope(keyId)] });
  assert.equal(again.status, 200);

  const db = getDb();
  const n = db.prepare('SELECT COUNT(*) AS n FROM stats_reports WHERE installation_id = ?').get(WRK_IID).n;
  assert.equal(n, 1, 'resend replaces (unique per day/kind)');

  const fetched = await req('GET', `/manager/api/reports?from=${today}&to=${today}`, MGR_TOKEN);
  assert.equal(fetched.json.reports.length, 1);
  assert.equal(fetched.json.reports[0].label, 'Worker One');
  assert.ok(fetched.json.reports[0].envelopes.includes('sealed-payload') === false, 'envelope stays base64 ciphertext');
});

test('news lifecycle: create, publish, targeting, reads, readers', async () => {
  const all = await req('POST', '/manager/api/news', MGR_TOKEN, { severity: 'warning', title: 'Maintenance', body: 'Sync at 03:00', target_role: 'all' });
  assert.equal(all.status, 201);
  const adminOnly = await req('POST', '/manager/api/news', MGR_TOKEN, { severity: 'info', title: 'Admin only', body: 'x', target_role: 'admin' });
  assert.equal(adminOnly.status, 201);
  const targeted = await req('POST', '/manager/api/news', MGR_TOKEN, { severity: 'critical', title: 'For worker', body: 'y', target_iid: WRK_IID });
  assert.equal(targeted.status, 201);
  const badSeverity = await req('POST', '/manager/api/news', MGR_TOKEN, { severity: 'mega', title: 't', body: 'b', target_role: 'all' });
  assert.equal(badSeverity.status, 400);

  const pub = await req('POST', `/manager/api/news/${targeted.json.id}/publish`, MGR_TOKEN);
  assert.equal(pub.status, 200);

  const list = await req('GET', '/api/telemetry/news', WRK_TOKEN);
  assert.equal(list.json.news.length, 1);
  assert.equal(list.json.news[0].id, targeted.json.id);
  assert.equal(list.json.news[0].is_read, 0);

  await req('POST', `/api/telemetry/news/${targeted.json.id}/read`, WRK_TOKEN);
  const list2 = await req('GET', '/api/telemetry/news', WRK_TOKEN);
  assert.equal(list2.json.news[0].is_read, 1);

  const readers = await req('GET', `/manager/api/news/${targeted.json.id}/readers`, MGR_TOKEN);
  assert.equal(readers.json.audience_count, 1);
  assert.equal(readers.json.read_count, 1);

  await req('POST', `/manager/api/news/${adminOnly.json.id}/publish`, MGR_TOKEN);
  const list3 = await req('GET', '/api/telemetry/news', WRK_TOKEN);
  assert.ok(!list3.json.news.some((n) => n.id === adminOnly.json.id), 'role-targeted news hidden from other roles');

  const del = await req('DELETE', `/manager/api/news/${all.json.id}`, MGR_TOKEN);
  assert.equal(del.status, 200);
});

test('shop priorities: target visibility and validation', async () => {
  const glob = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'Shop-One.example', target: '', weight: 9 });
  assert.equal(glob.status, 201);
  const personal = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'shop-two.example', target: `iid:${WRK_IID}`, weight: 7 });
  assert.equal(personal.status, 201);
  const roleBased = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'shop-three.example', target: 'role:admin', weight: 8 });
  assert.equal(roleBased.status, 201);

  const dup = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'shop-one.example', target: '', weight: 3 });
  assert.equal(dup.status, 409);
  const badTarget = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'shop-x.example', target: 'iid:unknown', weight: 3 });
  assert.equal(badTarget.status, 404);
  const badWeight = await req('POST', '/manager/api/priorities', MGR_TOKEN, { shop_domain: 'shop-y.example', target: '', weight: 11 });
  assert.equal(badWeight.status, 400);

  const view = await req('GET', '/api/telemetry/priorities', WRK_TOKEN);
  const domains = view.json.priorities.map((p) => p.shop_domain);
  assert.ok(domains.includes('shop-one.example'));
  assert.ok(domains.includes('shop-two.example'));
  assert.ok(!domains.includes('shop-three.example'));

  const patch = await req('PATCH', `/manager/api/priorities/${glob.json.id}`, MGR_TOKEN, { weight: 10 });
  assert.equal(patch.status, 200);
  const del = await req('DELETE', `/manager/api/priorities/${roleBased.json.id}`, MGR_TOKEN);
  assert.equal(del.status, 200);
});

test('alerts engine opens and closes offline alerts per episode', async () => {
  const db = getDb();
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, label, role, is_active) VALUES (?,?,?,?,?,1)")
    .run('wrk-install-0002', 'CH3', 'wrk2-token-1234567890', 'Worker Two', 'operator');
  db.prepare("INSERT INTO worker_heartbeats (installation_id, last_seen) VALUES (?, datetime('now','-1 hour'))")
    .run('wrk-install-0002');

  alertsEngine.tick();
  const open = db.prepare("SELECT * FROM manager_alerts WHERE installation_id = 'wrk-install-0002' AND status = 'new'").get();
  assert.ok(open, 'offline alert created');
  assert.equal(open.category, 'worker_offline');
  assert.equal(open.severity, 'warning');

  alertsEngine.tick();
  const cnt = db.prepare("SELECT COUNT(*) AS n FROM manager_alerts WHERE installation_id = 'wrk-install-0002'").get().n;
  assert.equal(cnt, 1, 'same episode does not duplicate');

  db.prepare("UPDATE worker_heartbeats SET last_seen = CURRENT_TIMESTAMP WHERE installation_id = 'wrk-install-0002'").run();
  alertsEngine.tick();
  const closed = db.prepare("SELECT status FROM manager_alerts WHERE installation_id = 'wrk-install-0002'").get();
  assert.equal(closed.status, 'closed');
});

test('alerts ack/close endpoints validate state transitions', async () => {
  const db = getDb();
  db.prepare("INSERT INTO manager_alerts (severity, category, title, message) VALUES ('info','manual','T','M')").run();
  const id = db.prepare('SELECT id FROM manager_alerts ORDER BY id DESC LIMIT 1').get().id;

  const ackNonexistent = await req('POST', '/manager/api/alerts/999999/ack', MGR_TOKEN);
  assert.equal(ackNonexistent.status, 409);

  const ack = await req('POST', `/manager/api/alerts/${id}/ack`, MGR_TOKEN);
  assert.equal(ack.status, 200);
  const ackAgain = await req('POST', `/manager/api/alerts/${id}/ack`, MGR_TOKEN);
  assert.equal(ackAgain.status, 409);

  const close = await req('POST', `/manager/api/alerts/${id}/close`, MGR_TOKEN);
  assert.equal(close.status, 200);
  const closeAgain = await req('POST', `/manager/api/alerts/${id}/close`, MGR_TOKEN);
  assert.equal(closeAgain.status, 409);

  const list = await req('GET', '/manager/api/alerts?status=closed', MGR_TOKEN);
  assert.ok(list.json.alerts.some((a) => a.id === id));
});

test('group and release views are count-only', async () => {
  const groups = await req('GET', '/manager/api/groups', MGR_TOKEN);
  assert.equal(groups.status, 200);
  assert.ok(Array.isArray(groups.json.groups));

  const releases = await req('GET', '/manager/api/releases', MGR_TOKEN);
  assert.equal(releases.status, 200);
  assert.ok(Array.isArray(releases.json.releases));
});

test('manager mutating actions are audited', async () => {
  const db = getDb();
  const n = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'manager_%'").get().n;
  assert.ok(n >= 5, `expected >= 5 audited manager actions, got ${n}`);
  const sample = db.prepare("SELECT details FROM audit_log WHERE action = 'manager_policy_set' LIMIT 1").get();
  assert.ok(sample);
  const parsed = JSON.parse(sample.details);
  assert.equal(parsed.manager, MGR_IID);
});


// ── MGR-010: CRUD лицензий через manager-api ─────────────────────────────────

test('licenses: create/list/patch/revoke/restore + self-guards', async () => {
  process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'mgr010-test-secret';
  const { deriveActivationKey } = require('../routes/activate');

  const NEW_IID = '11111111-2222-4333-8444-555555555555';
  const NEW_CH = 'ABCDEF0123456789ABCDEF0123456789';

  // Создание воркер-лицензии: ключ активации совпадает с деривацией админки.
  const created = await req('POST', '/manager/api/licenses', MGR_TOKEN, {
    installation_id: NEW_IID, challenge: NEW_CH.toLowerCase(), label: 'New Worker', role: 'operator',
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.activation_key, deriveActivationKey(NEW_IID, NEW_CH));

  const dup = await req('POST', '/manager/api/licenses', MGR_TOKEN, {
    installation_id: NEW_IID, challenge: NEW_CH,
  });
  assert.equal(dup.status, 409);

  const badRole = await req('POST', '/manager/api/licenses', MGR_TOKEN, {
    installation_id: '22222222-2222-4333-8444-555555555555', challenge: NEW_CH, role: 'admin',
  });
  assert.equal(badRole.status, 400);
  const badCh = await req('POST', '/manager/api/licenses', MGR_TOKEN, {
    installation_id: '33333333-2222-4333-8444-555555555555', challenge: 'not-hex!!',
  });
  assert.equal(badCh.status, 400);

  // Воркер не может пользоваться менеджерским CRUD.
  const asWorker = await req('GET', '/manager/api/licenses', WRK_TOKEN);
  assert.equal(asWorker.status, 403);

  // Список: токен не выдан, открытых токенов нет, только префикс хеша.
  const list = await req('GET', '/manager/api/licenses', MGR_TOKEN);
  assert.equal(list.status, 200);
  const row = list.json.licenses.find((l) => l.installation_id === NEW_IID);
  assert.ok(row, 'created license listed');
  assert.equal(row.token_issued, 0);
  assert.equal(row.token_prefix, null);
  assert.ok(!('token' in row) && !('token_hash' in row), 'no token material in list');
  const mgrRow = list.json.licenses.find((l) => l.installation_id === MGR_IID);
  assert.equal(mgrRow.token_issued, 1);
  assert.match(mgrRow.token_prefix, /^[0-9a-f]{8}$/);

  // Patch: метка и роль; свою роль менять нельзя.
  const patchLabel = await req('PATCH', `/manager/api/licenses/${NEW_IID}`, MGR_TOKEN, { label: 'Renamed' });
  assert.equal(patchLabel.status, 200);
  const ownRole = await req('PATCH', `/manager/api/licenses/${MGR_IID}`, MGR_TOKEN, { role: 'operator' });
  assert.equal(ownRole.status, 400);
  assert.equal(ownRole.json.error, 'cannot_change_own_role');
  const toMgr = await req('PATCH', `/manager/api/licenses/${NEW_IID}`, MGR_TOKEN, { role: 'manager' });
  assert.equal(toMgr.status, 200);

  // Revoke: себя отозвать нельзя; после revoke токен лицензии мёртв.
  const selfRevoke = await req('POST', `/manager/api/licenses/${MGR_IID}/revoke`, MGR_TOKEN);
  assert.equal(selfRevoke.status, 400);
  assert.equal(selfRevoke.json.error, 'cannot_revoke_self');

  const db = getDb();
  db.prepare('UPDATE licenses SET token_hash = ? WHERE installation_id = ?')
    .run(hashToken('new-lic-token-abcdefghij'), NEW_IID);
  const revoked = await req('POST', `/manager/api/licenses/${NEW_IID}/revoke`, MGR_TOKEN);
  assert.equal(revoked.status, 200);
  const deadAuth = await req('GET', '/manager/api/overview', 'new-lic-token-abcdefghij');
  assert.equal(deadAuth.status, 401);
  assert.equal(deadAuth.json.error, 'revoked');

  const restored = await req('POST', `/manager/api/licenses/${NEW_IID}/restore`, MGR_TOKEN);
  assert.equal(restored.status, 200);
  const liveAuth = await req('GET', '/manager/api/overview', 'new-lic-token-abcdefghij');
  assert.equal(liveAuth.status, 200);

  const noLic = await req('POST', '/manager/api/licenses/no-such-iid/revoke', MGR_TOKEN);
  assert.equal(noLic.status, 404);

  const audited = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'manager_license_%'"
  ).get().n;
  assert.ok(audited >= 4, `expected >= 4 audited license actions, got ${audited}`);
});

test('admin panel issues and edits manager licenses (bootstrap hole closed)', async () => {
  process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'mgr010-test-secret';
  const basic = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASS}`).toString('base64');
  const iid = 'adm-made-mgr-0001';

  const created = await req('POST', '/admin/api/licenses', null, {
    installation_id: iid, challenge: 'CH-ADMINMGR', label: 'From panel', role: 'manager',
  }, { authorization: basic });
  assert.equal(created.status, 200);
  assert.ok(created.json.activation_key);
  const db = getDb();
  assert.equal(db.prepare('SELECT role FROM licenses WHERE installation_id = ?').get(iid).role, 'manager');

  const patched = await req('PATCH', `/admin/api/licenses/${iid}`, null, { role: 'operator' }, { authorization: basic });
  assert.equal(patched.status, 200);
  assert.equal(db.prepare('SELECT role FROM licenses WHERE installation_id = ?').get(iid).role, 'operator');

  const bad = await req('PATCH', `/admin/api/licenses/${iid}`, null, { role: 'superuser' }, { authorization: basic });
  assert.equal(bad.status, 400);
});

test('news: admin (manager-side) видит manager-таргетированные новости, operator — нет', async () => {
  const mgrOnly = await req('POST', '/manager/api/news', MGR_TOKEN, { severity: 'info', title: 'Mgrs only', body: 'z', target_role: 'manager' });
  assert.equal(mgrOnly.status, 201);
  await req('POST', `/manager/api/news/${mgrOnly.json.id}/publish`, MGR_TOKEN);

  const asAdmin = await req('GET', '/api/telemetry/news', ADM_TOKEN);
  assert.equal(asAdmin.status, 200);
  assert.ok(asAdmin.json.news.some((n) => n.id === mgrOnly.json.id), 'admin получает manager-новости');

  const asWorker = await req('GET', '/api/telemetry/news', WRK_TOKEN);
  assert.ok(!asWorker.json.news.some((n) => n.id === mgrOnly.json.id), 'operator не видит manager-новости');
});


// ── MGR-009: staged rollout manager-релизов (channel + rollout_percent) ─────

test('manager updater: channels, deterministic rollout, PATCH rollout', async () => {
  const db = getDb();
  const { rolloutBucket } = require('../routes/update');

  const ins = db.prepare(`INSERT INTO release_files
    (version, file_type, platform, download_url, signature, notes, is_published, channel, rollout_percent)
    VALUES (?,?,?,?,?,?,1,?,?)`);
  ins.run('1.0.0', 'manager-updater', 'windows-x86_64', 'https://x/m-100.zip', 'sig100', 'stable', 'stable', 100);
  ins.run('1.1.0', 'manager-updater', 'windows-x86_64', 'https://x/m-110.zip', 'sig110', 'beta', 'beta', 50);

  // stable-клиент видит только stable.
  const stable = await req('GET', '/update?app=manager&current_version=0.9.0');
  assert.equal(stable.status, 200);
  assert.equal(stable.json.version, '1.0.0');

  // beta-клиент: 1.1.0 доступна только при бакете < 50; иначе — фолбэк на
  // свежий stable (1.0.0), т.к. current_version 0.9.0 старше его.
  const iid = 'mgr-rollout-iid';
  const bucket = rolloutBucket(iid, '1.1.0');
  const betaUrl = `/update?app=manager&current_version=0.9.0&channel=beta&iid=${iid}`;
  const beta = await req('GET', betaUrl);
  if (bucket < 50) {
    assert.equal(beta.status, 200);
    assert.equal(beta.json.version, '1.1.0');
    assert.equal(beta.json.platforms['windows-x86_64'].signature, 'sig110');
  } else {
    assert.equal(beta.status, 200);
    assert.equal(beta.json.version, '1.0.0');
  }
  // Бакет детерминирован: повторный запрос даёт тот же ответ.
  const beta2 = await req('GET', betaUrl);
  assert.equal(beta2.status, beta.status);
  assert.ok((beta2.json?.version || null) === (beta.json?.version || null));

  // Без iid частичный роллаут не отдаётся, но 100% stable — да.
  const noIid = await req('GET', '/update?app=manager&current_version=1.0.0&channel=beta');
  assert.equal(noIid.status, 204);

  // PATCH от менеджера: 100% → beta отдаётся и без iid.
  const patch = await req('PATCH', '/manager/api/releases/1.1.0', MGR_TOKEN, { rollout_percent: 100 });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.rollout_percent, 100);
  const after = await req('GET', '/update?app=manager&current_version=1.0.0&channel=beta');
  assert.equal(after.status, 200);
  assert.equal(after.json.version, '1.1.0');

  // beta→stable: stable-клиенты тоже получают 1.1.0.
  const toStable = await req('PATCH', '/manager/api/releases/1.1.0', MGR_TOKEN, { channel: 'stable' });
  assert.equal(toStable.status, 200);
  const stableNow = await req('GET', '/update?app=manager&current_version=1.0.0');
  assert.equal(stableNow.status, 200);
  assert.equal(stableNow.json.version, '1.1.0');

  // Валидация и ограничения PATCH.
  const badPct = await req('PATCH', '/manager/api/releases/1.1.0', MGR_TOKEN, { rollout_percent: 101 });
  assert.equal(badPct.status, 400);
  const badCh = await req('PATCH', '/manager/api/releases/1.1.0', MGR_TOKEN, { channel: 'nightly' });
  assert.equal(badCh.status, 400);
  const notFound = await req('PATCH', '/manager/api/releases/9.9.9', MGR_TOKEN, { rollout_percent: 50 });
  assert.equal(notFound.status, 404);
  const workerType = await req('PATCH', '/manager/api/releases/1.1.0?file_type=updater', MGR_TOKEN, { rollout_percent: 50 });
  assert.equal(workerType.status, 400);
  const asWorker = await req('PATCH', '/manager/api/releases/1.1.0', WRK_TOKEN, { rollout_percent: 50 });
  assert.equal(asWorker.status, 403);

  // GET /releases отдаёт channel/rollout_percent.
  const list = await req('GET', '/manager/api/releases', MGR_TOKEN);
  const rel = list.json.releases.find((r) => r.version === '1.1.0' && r.file_type === 'manager-updater');
  assert.ok(rel, 'manager release listed');
  assert.equal(rel.channel, 'stable');
  assert.equal(rel.rollout_percent, 100);

  const audited = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'manager_release_rollout'"
  ).get().n;
  assert.ok(audited >= 2, `expected >= 2 audited rollout actions, got ${audited}`);
});


// ── DEVOPS-006: мультиплатформенные релизы (UNIQUE по платформе) ───────────

test('worker updater: one version keeps per-platform rows, /update serves all', async () => {
  const db = getDb();

  // До миграции v17 UNIQUE(version, file_type) не давал хранить 3 платформы
  // одной версии: заливка CI затирала строку, и в /update выживала последняя
  // ОС (по факту Linux). Теперь ключ — (version, file_type, platform).
  const ins = db.prepare(`INSERT INTO release_files
    (version, file_type, platform, download_url, signature, notes, is_published)
    VALUES (?,?,?,?,?,?,1)`);
  ins.run('9.0.0', 'updater', 'windows-x86_64', 'https://x/w-900.msi', 'sigWin', 'multi');
  ins.run('9.0.0', 'updater', 'linux-x86_64', 'https://x/w-900.AppImage', 'sigLin', 'multi');
  ins.run('9.0.0', 'updater', 'darwin-aarch64', 'https://x/w-900.app.tar.gz', 'sigMac', 'multi');
  db.prepare(`INSERT INTO versions (version, notes, download_url, signature, file_size, platform, is_published)
    VALUES ('9.0.0','multi','https://x/w-900.msi','sigWin',1,'windows-x86_64',1)`).run();

  const r = await req('GET', '/update?current_version=8.0.0');
  assert.equal(r.status, 200);
  assert.equal(r.json.version, '9.0.0');
  for (const p of ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64']) {
    assert.ok(r.json.platforms[p], `platform ${p} present`);
    assert.ok(r.json.platforms[p].signature, `platform ${p} signed`);
  }

  // Повторная заливка той же платформы — обновление строки, а не дубликат
  // (именно этот upsert делает routes/upload.js по ключу version+type+platform).
  db.prepare(`UPDATE release_files SET download_url=?, signature=?, published_at=CURRENT_TIMESTAMP
    WHERE version=? AND file_type=? AND platform=?`)
    .run('https://x/w-900-v2.msi', 'sigWin2', '9.0.0', 'updater', 'windows-x86_64');
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM release_files WHERE version='9.0.0' AND file_type='updater'")
    .get().n;
  assert.equal(n, 3, 're-upload updates in place, no duplicate rows');

  // Тот же ключ работает и для manager-updater: две ОС одной версии видны обе.
  // (Версия 2.0.0 > 1.1.0 из MGR-009 выше — тот тест уже отработал.)
  ins.run('2.0.0', 'manager-updater', 'windows-x86_64', 'https://x/m-200.exe', 'sigMWin', 'multi');
  ins.run('2.0.0', 'manager-updater', 'darwin-aarch64', 'https://x/m-200.app.tar.gz', 'sigMMac', 'multi');
  const m = await req('GET', '/update?app=manager&current_version=1.9.9');
  assert.equal(m.status, 200);
  assert.equal(m.json.version, '2.0.0');
  assert.ok(m.json.platforms['windows-x86_64']);
  assert.ok(m.json.platforms['darwin-aarch64']);
});


// ── MGR-013: удалённый wipe воркера через heartbeat-политику ────────────────

test('remote wipe: manager sets flag, worker sees it in policy, ack clears it', async () => {
  const db = getDb();

  // Без confirm — отказ.
  const noConfirm = await req('POST', `/manager/api/workers/${WRK_IID}/wipe`, MGR_TOKEN, {});
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.json.error, 'confirm_required');

  // Воркер не может вызвать wipe-endpoint.
  const asWorker = await req('POST', `/manager/api/workers/${WRK_IID}/wipe`, WRK_TOKEN, { confirm: true });
  assert.equal(asWorker.status, 403);

  // Неизвестная инсталляция и manager-лицензия — отказ.
  const unknown = await req('POST', '/manager/api/workers/no-such-iid/wipe', MGR_TOKEN, { confirm: true });
  assert.equal(unknown.status, 404);
  const onManager = await req('POST', `/manager/api/workers/${MGR_IID}/wipe`, MGR_TOKEN, { confirm: true });
  assert.equal(onManager.status, 400);
  assert.equal(onManager.json.error, 'manager_not_policied');

  // Менеджер ставит флаг.
  const set = await req('POST', `/manager/api/workers/${WRK_IID}/wipe`, MGR_TOKEN, { confirm: true });
  assert.equal(set.status, 200);
  assert.equal(set.json.policy.wipe, 1);

  // Флаг виден в GET /workers.
  const list = await req('GET', '/manager/api/workers', MGR_TOKEN);
  const w = list.json.workers.find((x) => x.installation_id === WRK_IID);
  assert.equal(w.wipe, 1);

  // Воркер получает wipe в политике на heartbeat.
  const keyId = await activeKey();
  const hb = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, { envelopes: [envelope(keyId)] });
  assert.equal(hb.status, 200);
  assert.equal(hb.json.policy.wipe, 1);

  // Ack: воркер подтверждает — сервер сбрасывает флаг, wipe больше не отдаётся.
  const ack = await req('POST', '/api/telemetry/heartbeat', WRK_TOKEN, {
    envelopes: [envelope(keyId)],
    wipe_ack: true,
  });
  assert.equal(ack.status, 200);
  assert.equal(ack.json.policy.wipe, 0);
  const after = db.prepare('SELECT wipe FROM worker_policies WHERE installation_id = ?').get(WRK_IID);
  assert.equal(after.wipe, 0);

  // Аудит записан.
  const audited = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'manager_remote_wipe'"
  ).get().n;
  assert.ok(audited >= 1, `expected audited remote wipe, got ${audited}`);
});

// ── MGR-019: расширенные политики ────────────────────────────────────────────

test('policy: новые поля (can_add_cards/paused/cooldown/limits/shop_blacklist) сохраняются и возвращаются', async () => {
  const r = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, {
    can_add_cards: false,
    paused: false,
    decline_cooldown_minutes: 90,
    max_profiles: 7,
    max_drops: 3,
    shop_blacklist: ['Evil-Shop.com', 'bad.example', 'bad.example'],
  });
  assert.equal(r.status, 200);
  const p = r.json.policy;
  assert.equal(p.can_add_cards, 0);
  assert.equal(p.paused, 0);
  assert.equal(p.decline_cooldown_minutes, 90);
  assert.equal(p.max_profiles, 7);
  assert.equal(p.max_drops, 3);
  assert.deepEqual(JSON.parse(p.shop_blacklist), ['evil-shop.com', 'bad.example'], 'домены нормализованы и дедуплицированы');

  // воркер видит политику через /api/telemetry/policy
  const wp = await req('GET', '/api/telemetry/policy', WRK_TOKEN);
  assert.equal(wp.json.policy.decline_cooldown_minutes, 90);
  assert.equal(wp.json.policy.max_profiles, 7);
  assert.deepEqual(JSON.parse(wp.json.policy.shop_blacklist), ['evil-shop.com', 'bad.example']);

  // сброс обратно в null
  const reset = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, {
    decline_cooldown_minutes: null, max_profiles: null, max_drops: null, shop_blacklist: null,
  });
  assert.equal(reset.json.policy.decline_cooldown_minutes, null);
  assert.equal(reset.json.policy.shop_blacklist, null);
});

test('policy: пресеты novice/trusted/probation раскрываются на сервере', async () => {
  const bad = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'nope' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'preset_invalid');

  const novice = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'novice' });
  assert.equal(novice.status, 200);
  assert.equal(novice.json.policy.quota_cards_day, 10);
  assert.equal(novice.json.policy.decline_cooldown_minutes, 60);
  assert.equal(novice.json.policy.max_profiles, 5);

  // пресет + точечное переопределение тем же запросом
  const novicePlus = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'novice', max_profiles: 9 });
  assert.equal(novicePlus.json.policy.max_profiles, 9);
  assert.equal(novicePlus.json.policy.quota_cards_day, 10, 'остальные поля пресета сохранились');

  const trusted = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'trusted' });
  assert.equal(trusted.json.policy.quota_cards_day, null);
  assert.equal(trusted.json.policy.decline_cooldown_minutes, null);

  const probation = await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'probation' });
  assert.equal(probation.json.policy.quota_cards_day, 3);
  assert.equal(probation.json.policy.decline_cooldown_minutes, 180);

  // вернуть дефолт
  await req('POST', `/manager/api/workers/${WRK_IID}/policy`, MGR_TOKEN, { preset: 'trusted' });
});


