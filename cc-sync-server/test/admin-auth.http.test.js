/**
 * HTTP-level tests for the admin auth flow.
 *
 * The unit suite in auth.test.js covers the crypto primitives. This suite covers
 * what those tests cannot: Express mount ordering, the redirect-vs-401 branch,
 * and the cookie actually surviving a round trip through real requests.
 *
 * The app here mirrors index.js's admin mount order exactly, but omits the
 * DB-backed routers so the suite runs without a compiled better-sqlite3.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const ADMIN_PATH = '/ghostadmin/1asfd-54-local';
const ADMIN_PASS = 'integration-test-pass';

process.env.ADMIN_PATH = ADMIN_PATH;
process.env.ADMIN_PASS = ADMIN_PASS;
delete process.env.ADMIN_USER;
delete process.env.SESSION_SECRET;

const express = require('express');
const { requireAdmin } = require('../middleware');

function buildApp() {
  const app = express();
  // Mirrors index.js. 'loopback' rather than true: trusting every hop would let
  // a client spoof X-Forwarded-For and defeat per-IP rate limiting.
  app.set('trust proxy', 'loopback');
  // Same order as index.js: unauthenticated login routes first, guarded static last.
  app.use(ADMIN_PATH, require('../routes/admin-auth'));
  app.use(ADMIN_PATH, requireAdmin, express.static(path.join(__dirname, '..', 'admin'), {
    index: 'index.html',
  }));
  return app;
}

let server;
let base;

test.before(async () => {
  server = http.createServer(buildApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

/** Minimal fetch wrapper: never follows redirects, so we can assert on them. */
function req(pathname, opts = {}) {
  return fetch(base + pathname, { redirect: 'manual', ...opts });
}

/** Pulls one cookie's value out of a Set-Cookie header list. */
function cookieFrom(res, name) {
  const raw = res.headers.getSetCookie();
  const hit = raw.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1).split(';')[0] : null;
}

async function login(username = 'admin', password = ADMIN_PASS) {
  return req(`${ADMIN_PATH}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

test('unauthenticated browser request redirects to the login page', async () => {
  const res = await req(`${ADMIN_PATH}/`, { headers: { Accept: 'text/html' } });
  assert.strictEqual(res.status, 302);
  const loc = res.headers.get('location');
  assert.ok(loc.startsWith(`${ADMIN_PATH}/login?next=`), `unexpected redirect: ${loc}`);
});

test('redirect does not challenge with WWW-Authenticate', async () => {
  // The whole point of this change: no native browser credential dialog.
  const res = await req(`${ADMIN_PATH}/`, { headers: { Accept: 'text/html' } });
  assert.strictEqual(res.headers.get('www-authenticate'), null);
});

test('the login page itself is reachable without auth (no redirect loop)', async () => {
  const res = await req(`${ADMIN_PATH}/login`);
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.match(body, /<form/i);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('the ?next= target round-trips through the redirect', async () => {
  const res = await req(`${ADMIN_PATH}/settings.html`, { headers: { Accept: 'text/html' } });
  const loc = new URL(res.headers.get('location'), base);
  assert.strictEqual(loc.searchParams.get('next'), `${ADMIN_PATH}/settings.html`);
});

test('an API-style request gets JSON 401 instead of a redirect', async () => {
  const res = await req(`${ADMIN_PATH}/`, { headers: { Accept: 'application/json' } });
  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(await res.json(), { error: 'unauthorized' });
});

test('correct credentials set a session cookie', async () => {
  const res = await login();
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });

  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('vb_admin='));
  assert.ok(setCookie, 'no vb_admin cookie issued');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  // Plain HTTP in this test, so Secure must be absent or the cookie would be dropped.
  assert.ok(!/;\s*Secure/i.test(setCookie), 'Secure set on a non-TLS request');
});

test('the issued cookie unlocks the panel', async () => {
  const cookie = cookieFrom(await login(), 'vb_admin');
  const res = await req(`${ADMIN_PATH}/`, {
    headers: { Accept: 'text/html', Cookie: `vb_admin=${cookie}` },
  });
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /<!DOCTYPE html>/i);
});

test('visiting /login while signed in redirects into the panel', async () => {
  const cookie = cookieFrom(await login(), 'vb_admin');
  const res = await req(`${ADMIN_PATH}/login`, { headers: { Cookie: `vb_admin=${cookie}` } });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), `${ADMIN_PATH}/`);
});

test('a wrong password is rejected and issues no cookie', async () => {
  const res = await login('admin', 'not-the-password');
  assert.strictEqual(res.status, 401);
  assert.deepStrictEqual(await res.json(), { error: 'invalid_credentials' });
  assert.strictEqual(cookieFrom(res, 'vb_admin'), null);
});

test('a wrong username is rejected', async () => {
  const res = await login('root', ADMIN_PASS);
  assert.strictEqual(res.status, 401);
});

test('a tampered cookie is rejected and actively cleared', async () => {
  const cookie = cookieFrom(await login(), 'vb_admin');
  const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
  const res = await req(`${ADMIN_PATH}/`, {
    headers: { Accept: 'text/html', Cookie: `vb_admin=${tampered}` },
  });
  assert.strictEqual(res.status, 302);
  const cleared = res.headers.getSetCookie().find((c) => c.startsWith('vb_admin='));
  assert.ok(cleared, 'stale cookie was not cleared');
  assert.match(cleared, /Max-Age=0/i);
});

test('HTTP Basic still authenticates, so ops scripts keep working', async () => {
  const creds = Buffer.from(`admin:${ADMIN_PASS}`).toString('base64');
  const res = await req(`${ADMIN_PATH}/`, {
    headers: { Accept: 'text/html', Authorization: `Basic ${creds}` },
  });
  assert.strictEqual(res.status, 200);
});

test('HTTP Basic with a bad password does not authenticate', async () => {
  const creds = Buffer.from('admin:wrong').toString('base64');
  const res = await req(`${ADMIN_PATH}/`, {
    headers: { Accept: 'application/json', Authorization: `Basic ${creds}` },
  });
  assert.strictEqual(res.status, 401);
});

test('logout clears the cookie and re-locks the panel', async () => {
  const cookie = cookieFrom(await login(), 'vb_admin');

  const out = await req(`${ADMIN_PATH}/logout`, {
    method: 'POST',
    headers: { Cookie: `vb_admin=${cookie}` },
  });
  assert.strictEqual(out.status, 200);
  const cleared = out.headers.getSetCookie().find((c) => c.startsWith('vb_admin='));
  assert.match(cleared, /Max-Age=0/i);

  // The browser would now send nothing; confirm that state is locked out.
  const after = await req(`${ADMIN_PATH}/`, { headers: { Accept: 'text/html' } });
  assert.strictEqual(after.status, 302);
});

test('rotating ADMIN_PASS invalidates already-issued cookies', async () => {
  const cookie = cookieFrom(await login(), 'vb_admin');
  const original = process.env.ADMIN_PASS;
  process.env.ADMIN_PASS = 'a-completely-different-pass';
  try {
    const res = await req(`${ADMIN_PATH}/`, {
      headers: { Accept: 'text/html', Cookie: `vb_admin=${cookie}` },
    });
    assert.strictEqual(res.status, 302);
  } finally {
    process.env.ADMIN_PASS = original;
  }
});

test('login.html is not served as a bare static file', async () => {
  // One canonical URL for the page: GET /login. The static mount is behind the
  // gate, so the direct filename must not bypass it.
  const res = await req(`${ADMIN_PATH}/login.html`, { headers: { Accept: 'text/html' } });
  assert.strictEqual(res.status, 302);
});

test('X-Forwarded-Proto: https makes the cookie Secure (nginx case)', async () => {
  const res = await req(`${ADMIN_PATH}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASS }),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('vb_admin='));
  assert.match(setCookie, /;\s*Secure/i);
});
