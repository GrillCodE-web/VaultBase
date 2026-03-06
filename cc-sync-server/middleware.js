const { getDb } = require('./database');

/**
 * Middleware: validate Bearer token from Authorization header.
 * Attaches req.userToken on success.
 */
function requireToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'missing_token' });
  }

  const token = match[1].trim();
  const db = getDb();
  const row = db.prepare(
    'SELECT token, is_active FROM licenses WHERE token = ?'
  ).get(token);

  if (!row) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  // Update last_seen
  db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token = ?').run(token);

  req.userToken = token;
  next();
}

/**
 * Middleware: HTTP Basic Auth for admin panel.
 */
function requireBasicAuth(req, res, next) {
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

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
