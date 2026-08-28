const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb, hashToken } = require('../database');

const router = express.Router();

// /verify validates a bearer-equivalent license token supplied in the body, so it
// is brute-forceable and needs a limiter.
//
// Limit choice: the Tauri client (src-tauri/src/license.rs) calls /verify only in
// verify_at_startup() and from retry_verify() behind the Settings "Retry
// Connection" button — there is no polling loop. 60 requests per IP per 15 min is
// therefore far above normal usage even for several installations sharing one NAT
// egress IP, while still cutting online token guessing to a useless rate.
//
// Keyed on IP deliberately, NOT on the submitted token: keying on the token would
// give an attacker a fresh bucket for every guess, defeating the limiter.
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

// POST /verify
router.post('/', verifyLimiter, (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  const db = getDb();
  const tokenHash = hashToken(token);
  const row = db.prepare(
    'SELECT token_hash, label, is_active, role FROM licenses WHERE token_hash = ?'
  ).get(tokenHash);

  if (!row) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  db.prepare(
    'UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token_hash = ?'
  ).run(tokenHash);

  return res.json({ valid: true, label: row.label || '', role: row.role || 'operator' });
});

module.exports = router;
