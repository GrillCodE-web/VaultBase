const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-manager-')), 'test.db');

const { getDb } = require('../database');
const managerApi = require('../routes/manager-api');
const telemetry = require('../routes/telemetry');
const alertsEngine = require('../alerts-engine');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/manager/api', managerApi);
app.use('/api/telemetry', telemetry);

const MGR_TOKEN = 'mgr-token-1234567890abcdef';
const WRK_TOKEN = 'wrk-token-1234567890abcdef';
const MGR_IID = 'mgr-install-0001';
const WRK_IID = 'wrk-install-0001';

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
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, label, role, is_active) VALUES (?,?,?,?,?,1)")
    .run(MGR_IID, 'CHALLENGE1', MGR_TOKEN, 'Head Manager', 'manager');
  db.prepare("INSERT INTO licenses (installation_id, challenge, token, label, role, is_active) VALUES (?,?,?,?,?,1)")
    .run(WRK_IID, 'CHALLENGE2', WRK_TOKEN, 'Worker One', 'operator');
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
  assert.equal(r.json.workers_total, 1);
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
