const crypto = require('crypto');

const COOKIE_NAME = 'vb_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function adminUser() {
  return process.env.ADMIN_USER || 'admin';
}

/**
 * Cookie signing key. Derived from ADMIN_PASS unless SESSION_SECRET is set, so
 * rotating the admin password invalidates every outstanding session without
 * needing a server-side session store.
 */
function signingKey() {
  const base = process.env.SESSION_SECRET || process.env.ADMIN_PASS;
  if (!base) return null;
  return crypto.createHash('sha256').update(`vaultbase-admin-session:${base}`).digest();
}

function sign(payloadB64, key) {
  return crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
}

function issueSession(username) {
  const key = signingKey();
  if (!key) return null;
  const payload = JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64, key)}`;
}

function verifySession(cookieValue) {
  const key = signingKey();
  if (!key || typeof cookieValue !== 'string') return null;

  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = cookieValue.slice(0, dot);
  const provided = cookieValue.slice(dot + 1);
  const expected = sign(payloadB64, key);

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    if (payload.u !== adminUser()) return null;
    return payload;
  } catch (e) {
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, value) {
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (isSecureRequest(req)) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

/** Constant-time credential check against ADMIN_USER / ADMIN_PASS. */
function credentialsValid(user, pass) {
  const expectedUser = adminUser();
  const expectedPass = process.env.ADMIN_PASS;
  if (!expectedPass || typeof user !== 'string' || typeof pass !== 'string') return false;

  const userOk = user.length === expectedUser.length &&
    crypto.timingSafeEqual(Buffer.from(user), Buffer.from(expectedUser));
  const passOk = pass.length === expectedPass.length &&
    crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(expectedPass));

  // Evaluate both before returning so timing does not reveal which field failed.
  return userOk && passOk;
}

function basicAuthValid(req) {
  const match = (req.headers['authorization'] || '').match(/^Basic\s+(.+)$/i);
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  return credentialsValid(decoded.slice(0, sep), decoded.slice(sep + 1));
}

function wantsJson(req) {
  return req.xhr ||
    req.path.startsWith('/api') ||
    (req.headers.accept || '').includes('application/json');
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  adminUser,
  signingKey,
  issueSession,
  verifySession,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
  credentialsValid,
  basicAuthValid,
  wantsJson,
};
