const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const AUTH_PATH = path.join(__dirname, '..', 'auth.js');

/**
 * auth.js reads process.env at call time, so each case sets the environment it
 * needs. The module is re-required fresh to guarantee no cached derived state.
 */
function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[require.resolve(AUTH_PATH)];
  try {
    return fn(require(AUTH_PATH));
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const GOOD = { ADMIN_USER: 'admin', ADMIN_PASS: 'correct-horse-battery' };

test('valid session round-trips', () => {
  withEnv(GOOD, (auth) => {
    const s = auth.issueSession('admin');
    assert.ok(s, 'session should be issued');
    const payload = auth.verifySession(s);
    assert.ok(payload);
    assert.strictEqual(payload.u, 'admin');
  });
});

test('tampered payload is rejected', () => {
  withEnv(GOOD, (auth) => {
    const s = auth.issueSession('admin');
    const [, sig] = s.split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: 'admin', exp: Date.now() + 9e6 }), 'utf8'
    ).toString('base64url');
    assert.strictEqual(auth.verifySession(`${forged}.${sig}`), null);
  });
});

test('tampered signature is rejected', () => {
  withEnv(GOOD, (auth) => {
    const s = auth.issueSession('admin');
    const [body, sig] = s.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    assert.strictEqual(auth.verifySession(`${body}.${flipped}`), null);
  });
});

test('unsigned / malformed cookies are rejected', () => {
  withEnv(GOOD, (auth) => {
    for (const bad of ['', '.', 'nodot', '.onlysig', 'a.b', 'null.null']) {
      assert.strictEqual(auth.verifySession(bad), null, `accepted: ${bad}`);
    }
    assert.strictEqual(auth.verifySession(undefined), null);
    assert.strictEqual(auth.verifySession(null), null);
    assert.strictEqual(auth.verifySession({}), null);
  });
});

test('expired session is rejected', () => {
  withEnv(GOOD, (auth) => {
    // Sign an already-expired payload with the real key, so only exp can reject it.
    const crypto = require('crypto');
    const key = auth.signingKey();
    const body = Buffer.from(
      JSON.stringify({ u: 'admin', exp: Date.now() - 1000 }), 'utf8'
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
    assert.strictEqual(auth.verifySession(`${body}.${sig}`), null);
  });
});

test('rotating ADMIN_PASS invalidates outstanding sessions', () => {
  const issued = withEnv(GOOD, (auth) => auth.issueSession('admin'));
  withEnv({ ...GOOD, ADMIN_PASS: 'a-brand-new-password' }, (auth) => {
    assert.strictEqual(auth.verifySession(issued), null);
  });
});

test('renaming ADMIN_USER invalidates outstanding sessions', () => {
  const issued = withEnv(GOOD, (auth) => auth.issueSession('admin'));
  withEnv({ ...GOOD, ADMIN_USER: 'root' }, (auth) => {
    assert.strictEqual(auth.verifySession(issued), null);
  });
});

test('no ADMIN_PASS means no sessions at all', () => {
  const issued = withEnv(GOOD, (auth) => auth.issueSession('admin'));
  withEnv({ ADMIN_USER: 'admin', ADMIN_PASS: '', SESSION_SECRET: '' }, (auth) => {
    assert.strictEqual(auth.signingKey(), null);
    assert.strictEqual(auth.issueSession('admin'), null);
    assert.strictEqual(auth.verifySession(issued), null);
  });
});

test('SESSION_SECRET decouples sessions from password rotation', () => {
  const env = { ...GOOD, SESSION_SECRET: 'independent-secret-value' };
  const issued = withEnv(env, (auth) => auth.issueSession('admin'));
  withEnv({ ...env, ADMIN_PASS: 'rotated-password' }, (auth) => {
    assert.ok(auth.verifySession(issued), 'session should survive rotation');
  });
});

test('credentialsValid accepts only exact credentials', () => {
  withEnv(GOOD, (auth) => {
    assert.strictEqual(auth.credentialsValid('admin', 'correct-horse-battery'), true);
    assert.strictEqual(auth.credentialsValid('admin', 'wrong'), false);
    assert.strictEqual(auth.credentialsValid('root', 'correct-horse-battery'), false);
    assert.strictEqual(auth.credentialsValid('admin', 'correct-horse-batter'), false);
    assert.strictEqual(auth.credentialsValid('admin', 'correct-horse-batteryX'), false);
    assert.strictEqual(auth.credentialsValid('', ''), false);
    assert.strictEqual(auth.credentialsValid(undefined, undefined), false);
    assert.strictEqual(auth.credentialsValid(null, null), false);
  });
});

test('credentialsValid always fails when ADMIN_PASS is unset', () => {
  withEnv({ ADMIN_USER: 'admin', ADMIN_PASS: '' }, (auth) => {
    assert.strictEqual(auth.credentialsValid('admin', ''), false);
    assert.strictEqual(auth.credentialsValid('admin', 'anything'), false);
  });
});

test('basicAuthValid parses passwords containing colons', () => {
  withEnv({ ADMIN_USER: 'admin', ADMIN_PASS: 'pa:ss:word:123' }, (auth) => {
    const enc = Buffer.from('admin:pa:ss:word:123', 'utf8').toString('base64');
    assert.strictEqual(
      auth.basicAuthValid({ headers: { authorization: `Basic ${enc}` } }), true);
    assert.strictEqual(auth.basicAuthValid({ headers: {} }), false);
    assert.strictEqual(
      auth.basicAuthValid({ headers: { authorization: 'Bearer xyz' } }), false);
    assert.strictEqual(
      auth.basicAuthValid({ headers: { authorization: 'Basic bm9jb2xvbg==' } }), false);
  });
});

test('readCookie extracts the right cookie among several', () => {
  withEnv(GOOD, (auth) => {
    const req = { headers: { cookie: 'other=1; vb_admin=abc.def; trailing=2' } };
    assert.strictEqual(auth.readCookie(req, 'vb_admin'), 'abc.def');
    assert.strictEqual(auth.readCookie(req, 'missing'), null);
    assert.strictEqual(auth.readCookie({ headers: {} }, 'vb_admin'), null);
    // Must not match on a name that merely ends with the target.
    assert.strictEqual(
      auth.readCookie({ headers: { cookie: 'xvb_admin=nope' } }, 'vb_admin'), null);
  });
});

test('session cookie carries HttpOnly and SameSite, Secure only over TLS', () => {
  withEnv(GOOD, (auth) => {
    const collect = () => {
      const out = [];
      return { res: { append: (_, v) => out.push(v) }, out };
    };

    const plain = collect();
    auth.setSessionCookie({ secure: false, headers: {} }, plain.res, 'v');
    assert.match(plain.out[0], /HttpOnly/);
    assert.match(plain.out[0], /SameSite=Strict/);
    assert.ok(!/Secure/.test(plain.out[0]), 'no Secure without TLS');

    const tls = collect();
    auth.setSessionCookie(
      { secure: false, headers: { 'x-forwarded-proto': 'https' } }, tls.res, 'v');
    assert.match(tls.out[0], /Secure/);

    const cleared = collect();
    auth.clearSessionCookie({ secure: true, headers: {} }, cleared.res);
    assert.match(cleared.out[0], /Max-Age=0/);
  });
});
