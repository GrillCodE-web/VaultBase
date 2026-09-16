const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const logger = require('../logger');

const router = express.Router();

// Brute-force guard. Keyed by IP; successful logins are not counted so a shared
// office NAT cannot lock out a legitimate admin who types a password correctly.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

router.get('/login', (req, res) => {
  // Already signed in — skip the form.
  const cookie = auth.readCookie(req, auth.COOKIE_NAME);
  if (cookie && auth.verifySession(cookie)) {
    return res.redirect(302, req.baseUrl + '/');
  }
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'admin', 'login.html'));
});

router.post('/login', loginLimiter, express.json(), (req, res) => {
  if (!process.env.ADMIN_PASS) {
    logger.error('CRITICAL: ADMIN_PASS not set; login rejected.');
    return res.status(503).json({ error: 'admin_not_configured' });
  }

  const { username, password } = req.body || {};
  if (!auth.credentialsValid(username, password)) {
    logger.warn({ event: 'admin_login_failed', ip: req.ip });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const session = auth.issueSession(auth.adminUser());
  if (!session) return res.status(503).json({ error: 'admin_not_configured' });

  auth.setSessionCookie(req, res, session);
  logger.info({ event: 'admin_login_ok', ip: req.ip });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(req, res);
  res.json({ ok: true });
});

module.exports = router;
