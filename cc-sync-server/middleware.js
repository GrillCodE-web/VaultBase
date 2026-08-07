const auth = require('./auth');
const { getDb } = require('./database');

// FIX API-H01: TOCTOU - Atomically check and update token in single transaction
function requireToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'missing_token' });

  const token = match[1].trim();

  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'invalid_token_format' });
  }

  const db = getDb();

  // FIX API-H01: Use transaction to atomically verify and update last_seen
  // This prevents race condition where token could be revoked between check and use
  try {
    const result = db.transaction(() => {
      // Check token exists and is active
      const row = db.prepare('SELECT token, is_active, installation_id FROM licenses WHERE token = ?').get(token);

      if (!row) {
        return { valid: false, error: 'invalid_token' };
      }

      if (!row.is_active) {
        return { valid: false, error: 'revoked' };
      }

      // Update last_seen atomically within the same transaction
      db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token = ? AND is_active = 1').run(token);

      // Verify the update succeeded (token wasn't revoked concurrently)
      const verifyRow = db.prepare('SELECT is_active FROM licenses WHERE token = ?').get(token);
      if (!verifyRow?.is_active) {
        return { valid: false, error: 'revoked_concurrent' };
      }

      return { valid: true, installation_id: row.installation_id };
    })();

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    // Exposed for request logging; never log the token itself.
    req.installationId = result.installation_id;

  } catch (e) {
    console.error('[middleware/requireToken] Transaction error:', e);
    return res.status(500).json({ error: 'database_error' });
  }

  req.userToken = token;
  next();
}

/**
 * Admin gate. Accepts either a signed session cookie (browser, set by the login
 * page) or HTTP Basic credentials (scripts and ops tooling such as check_all.py).
 *
 * Browsers are redirected to the login page rather than receiving a
 * WWW-Authenticate challenge, which is what produced the native credential
 * dialog. API callers still get a machine-readable 401.
 */
function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_PASS) {
    console.error('CRITICAL: ADMIN_PASS environment variable is not set. Admin API disabled for security.');
    return res.status(503).json({ error: 'admin_not_configured' });
  }
  if (process.env.ADMIN_PASS.length < 12) {
    console.error('WARNING: ADMIN_PASS is too short. Use at least 12 characters for security.');
  }

  const cookie = auth.readCookie(req, auth.COOKIE_NAME);
  if (cookie && auth.verifySession(cookie)) {
    req.adminUser = auth.adminUser();
    return next();
  }

  if (auth.basicAuthValid(req)) {
    req.adminUser = auth.adminUser();
    return next();
  }

  // Stale or tampered cookie: clear it so the login page starts from a clean slate.
  if (cookie) auth.clearSessionCookie(req, res);

  if (auth.wantsJson(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const adminPath = process.env.ADMIN_PATH || '/ghostadmin/1asfd-54-local';
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(302, `${adminPath}/login?next=${next_}`);
}

module.exports = { requireToken, requireAdmin };
