const auth = require('./auth');
const { getDb, hashToken, isKillSwitchOn } = require('./database');

// Shared token authentication for license-token channels.
//
// rolePolicy:
//   'any'     — any active license (historical requireToken behaviour)
//   'manager' — only licenses with role='manager'
//   'worker'  — any active license except role='manager'
//
// FIX API-H01: verification and last_seen update run in one transaction, so a
// token revoked between the SELECT and the UPDATE cannot slip through.
//
// Worker bans (worker_policies.banned) reject every authenticated channel with
// 403 + the full policy row, so the client can display *why* it is locked and
// every entry point (REST sync, footprint, WS, telemetry) stays consistent.
function authenticateToken(req, rolePolicy) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { status: 401, body: { error: 'missing_token' } };

  const token = match[1].trim();
  if (!token || token.length < 10) {
    return { status: 401, body: { error: 'invalid_token_format' } };
  }

  const db = getDb();
  // MGR-008: токены хранятся только как SHA-256 — ищем по хешу, открытый токен
  // в БД не попадает нигде.
  const tokenHash = hashToken(token);
  try {
    return db.transaction(() => {
      const row = db.prepare('SELECT token_hash, is_active, installation_id, role FROM licenses WHERE token_hash = ?').get(tokenHash);

      if (!row) return { status: 401, body: { error: 'invalid_token' } };
      if (!row.is_active) return { status: 401, body: { error: 'revoked' } };

      // admin — надроль уровня manager: менеджер-приложение принимает admin
      // при активации, поэтому manager-каналы обязаны его пускать. Kill-switch
      // и воркерские баны на него не действуют. Worker-каналы админу по-прежнему
      // открыты (та же лицензия может стоять на воркерской машине у саппорта).
      const managerSide = row.role === 'manager' || row.role === 'admin';

      if (rolePolicy === 'manager' && !managerSide) {
        return { status: 403, body: { error: 'manager_required' } };
      }
      if (rolePolicy === 'worker' && row.role === 'manager') {
        return { status: 403, body: { error: 'worker_required' } };
      }

      // MGR-008 kill-switch: воркерские каналы глушатся 503, менеджеры и
      // админка продолжают работать (иначе выключатель не вернуть).
      if (!managerSide && isKillSwitchOn()) {
        return { status: 503, body: { error: 'service_halted' } };
      }

      db.prepare('UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token_hash = ? AND is_active = 1').run(tokenHash);
      const verifyRow = db.prepare('SELECT is_active FROM licenses WHERE token_hash = ?').get(tokenHash);
      if (!verifyRow?.is_active) return { status: 401, body: { error: 'revoked_concurrent' } };

      if (!managerSide) {
        const banned = db.prepare(`
          SELECT banned, banned_reason, ban_until, permissions_override,
                 quota_cards_day, quota_orders_day, min_version, version_exempt,
                 force_logout, updated_by, updated_at
          FROM worker_policies
          WHERE installation_id = ? AND banned = 1
            AND (ban_until IS NULL OR ban_until > datetime('now'))
        `).get(row.installation_id);
        if (banned) {
          return { status: 403, body: { error: 'banned', reason: banned.banned_reason || '', policy: banned } };
        }
      }

      return { status: 0, installation_id: row.installation_id, role: row.role, token };
    })();
  } catch (e) {
    console.error('[middleware/authenticateToken] Transaction error:', e);
    return { status: 500, body: { error: 'database_error' } };
  }
}

function finishAuth(req, res, next, result) {
  if (result.status !== 0) return res.status(result.status).json(result.body);
  req.installationId = result.installation_id;
  req.licenseRole = result.role;
  req.userToken = result.token;
  next();
}

function requireToken(req, res, next) {
  finishAuth(req, res, next, authenticateToken(req, 'any'));
}

function requireManagerToken(req, res, next) {
  finishAuth(req, res, next, authenticateToken(req, 'manager'));
}

function requireWorkerToken(req, res, next) {
  finishAuth(req, res, next, authenticateToken(req, 'worker'));
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

module.exports = { requireToken, requireManagerToken, requireWorkerToken, requireAdmin };
