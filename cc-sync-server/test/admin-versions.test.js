/**
 * HTTP tests for release management endpoints (ADMIN-001):
 *   PATCH  /admin/api/versions/:version  — publish/channel/rollout правки
 *   DELETE /admin/api/versions/:version  — удаление с опциональной платформой
 *
 * Покрывает мультиплатформенную схему release_files v17: правки и удаления
 * обязаны работать по ключу (version, file_type, platform), а не сносить все
 * ОС одной версии разом.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ADMIN_PATH = '/ghostadmin/test-versions';
process.env.ADMIN_PATH = ADMIN_PATH;
process.env.ADMIN_PASS = 'versions-test-pass';
delete process.env.ADMIN_USER;
delete process.env.SESSION_SECRET;
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-admver-')), 'test.db');

const express = require('express');
const { getDb } = require('../database');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(`${ADMIN_PATH}/api`, require('../routes/admin-api'));
app.use('/update', require('../routes/update'));

let server;
let base;
const AUTH = 'Basic ' + Buffer.from(`admin:${process.env.ADMIN_PASS}`).toString('base64');

function req(method, p, body) {
  return fetch(base + p, {
    method,
    headers: {
      Authorization: AUTH,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function seed() {
  const db = getDb();
  const ins = db.prepare(`INSERT INTO release_files
    (version, file_type, platform, download_url, signature, notes, is_published, channel, rollout_percent)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  // Воркерский релиз 3.0.0 — три ОС
  for (const plat of ['windows-x86_64', 'linux-x86_64', 'darwin-aarch64'])
    ins.run('3.0.0', 'updater', plat, `https://x/w-300-${plat}`, 'sigW', 'worker 3.0.0', 1, 'stable', 100);
  db.prepare(`INSERT INTO versions (version, notes, download_url, signature, file_size, platform, is_published)
    VALUES ('3.0.0','worker 3.0.0','https://x/w-300','sigW',1,'windows-x86_64',1)`).run();
  // Менеджерский релиз 4.0.0 — две ОС, stable/100
  ins.run('4.0.0', 'manager-updater', 'windows-x86_64', 'https://x/m-400-win', 'sigM', 'mgr 4.0.0', 1, 'stable', 100);
  ins.run('4.0.0', 'manager-updater', 'darwin-aarch64', 'https://x/m-400-mac', 'sigM', 'mgr 4.0.0', 1, 'stable', 100);
}

test.before(async () => {
  seed();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('PATCH channel+rollout применяется ко всем платформам релиза менеджера', async () => {
  const res = await req('PATCH', `${ADMIN_PATH}/api/versions/4.0.0`, {
    file_type: 'manager-updater', channel: 'beta', rollout_percent: 25,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changed, 2);

  const rows = getDb().prepare(
    "SELECT channel, rollout_percent FROM release_files WHERE version='4.0.0' AND file_type='manager-updater'"
  ).all();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.channel, 'beta');
    assert.equal(r.rollout_percent, 25);
  }
});

test('beta-канал виден beta-клиенту менеджера и невидим stable-клиенту', async () => {
  // 4.0.0 теперь beta/25% — stable-клиент без iid её не увидит вообще.
  const stable = await fetch(`${base}/update?app=manager&current_version=3.9.9`);
  assert.equal(stable.status, 204);
  const beta = await fetch(`${base}/update?app=manager&current_version=3.9.9&channel=beta&iid=test-iid-1`);
  // rollout 25%: конкретный iid может не попасть в бакет — важно, что не 500
  // и что при попадании отдаётся именно 4.0.0.
  assert.ok([200, 204].includes(beta.status));
  if (beta.status === 200) assert.equal((await beta.json()).version, '4.0.0');
});

test('PATCH отклоняет кривые значения', async () => {
  assert.equal((await req('PATCH', `${ADMIN_PATH}/api/versions/4.0.0`, { channel: 'nightly' })).status, 400);
  assert.equal((await req('PATCH', `${ADMIN_PATH}/api/versions/4.0.0`, { rollout_percent: 101 })).status, 400);
  assert.equal((await req('PATCH', `${ADMIN_PATH}/api/versions/4.0.0`, {})).status, 400);
  assert.equal((await req('PATCH', `${ADMIN_PATH}/api/versions/9.9.9`, { is_published: false })).status, 404);
});

test('PATCH is_published воркерского updater зеркалится в versions', async () => {
  const res = await req('PATCH', `${ADMIN_PATH}/api/versions/3.0.0`, { is_published: false });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changed, 3);
  assert.equal(getDb().prepare("SELECT is_published FROM versions WHERE version='3.0.0'").get().is_published, 0);

  // Снятая с публикации версия исчезает из /update
  const upd = await fetch(`${base}/update?current_version=2.0.0`);
  assert.equal(upd.status, 204);

  await req('PATCH', `${ADMIN_PATH}/api/versions/3.0.0`, { is_published: true });
  assert.equal(getDb().prepare("SELECT is_published FROM versions WHERE version='3.0.0'").get().is_published, 1);
});

test('DELETE с platform убирает только одну ОС, versions остаётся', async () => {
  const res = await req('DELETE', `${ADMIN_PATH}/api/versions/3.0.0?file_type=updater&platform=darwin-aarch64`);
  assert.equal(res.status, 200);
  const left = getDb().prepare(
    "SELECT platform FROM release_files WHERE version='3.0.0' AND file_type='updater'"
  ).all().map((r) => r.platform).sort();
  assert.deepEqual(left, ['linux-x86_64', 'windows-x86_64']);
  // versions жива, пока есть хоть один updater-артефакт
  assert.ok(getDb().prepare("SELECT version FROM versions WHERE version='3.0.0'").get());

  // Остальные платформы продолжают отдаваться в /update
  const upd = await fetch(`${base}/update?current_version=2.0.0`);
  assert.equal(upd.status, 200);
  const j = await upd.json();
  assert.ok(j.platforms['windows-x86_64']);
  assert.ok(j.platforms['linux-x86_64']);
  assert.equal(j.platforms['darwin-aarch64'], undefined);
});

test('DELETE последнего updater-артефакта сносит и строку versions', async () => {
  await req('DELETE', `${ADMIN_PATH}/api/versions/3.0.0?file_type=updater&platform=windows-x86_64`);
  const res = await req('DELETE', `${ADMIN_PATH}/api/versions/3.0.0?file_type=updater&platform=linux-x86_64`);
  assert.equal(res.status, 200);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM release_files WHERE version='3.0.0'").get().n, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) n FROM versions WHERE version='3.0.0'").get().n, 0);

  // Несуществующее — 404
  assert.equal((await req('DELETE', `${ADMIN_PATH}/api/versions/3.0.0?file_type=updater`)).status, 404);
});

test('PATCH пишет в audit_log', () => {
  const n = getDb().prepare("SELECT COUNT(*) n FROM audit_log WHERE action='release_patch'").get().n;
  assert.ok(n >= 3, `expected >= 3 release_patch audit rows, got ${n}`);
});

test('без авторизации — 401', async () => {
  const res = await fetch(`${base}${ADMIN_PATH}/api/versions/4.0.0`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ is_published: false }),
  });
  assert.equal(res.status, 401);
});
