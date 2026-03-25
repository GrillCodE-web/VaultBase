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
      const row = db.prepare('SELECT token, is_active FROM licenses WHERE token = ?').get(token);

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

      return { valid: true };
    })();

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

  } catch (e) {
    console.error('[middleware/requireToken] Transaction error:', e);
    return res.status(500).json({ error: 'database_error' });
  }

  req.userToken = token;
  next();
}

function requireBasicAuth(req, res, next) {
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS;

  // Critical security check: ADMIN_PASS must be set and strong
  if (!ADMIN_PASS) {
    console.error('CRITICAL: ADMIN_PASS environment variable is not set. Admin API disabled for security.');
    return res.status(503).send('Admin API disabled - ADMIN_PASS not configured');
  }
  if (ADMIN_PASS.length < 12) {
    console.error('WARNING: ADMIN_PASS is too short. Use at least 12 characters for security.');
  }

  const header = req.headers['authorization'] || '';
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) {
    res.set('WWW-Authenticate', 'Basic realm="CC Manager Admin"');
    return res.status(401).send('Unauthorized');
  }
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const [user, ...passParts] = decoded.split(':');
  const pass = passParts.join(':');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="CC Manager Admin"');
    return res.status(401).send('Unauthorized');
  }
  next();
}

module.exports = { requireToken, requireBasicAuth };
