const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database');

const router = express.Router();

/**
 * Derive the expected activation key for a given installation_id + challenge.
 * HMAC-SHA256(installation_id + challenge, SERVER_SECRET) → first 16 hex chars
 * formatted as XXXX-XXXX-XXXX-XXXX
 */
function deriveActivationKey(installation_id, challenge) {
  const secret = process.env.SERVER_SECRET;
  if (!secret) {
    throw new Error('SERVER_SECRET environment variable is not set. This is a critical security requirement.');
  }
  const raw = crypto
    .createHmac('sha256', secret)
    .update(installation_id + challenge)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

// POST /activate
router.post('/', (req, res) => {
  const { installation_id, challenge, activation_key } = req.body || {};

  if (!installation_id || !challenge || !activation_key) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM licenses WHERE installation_id = ? AND challenge = ?'
  ).get(installation_id, challenge);

  if (!row) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  const expected = deriveActivationKey(installation_id, challenge);
  if (activation_key !== expected) {
    return res.status(401).json({ error: 'invalid_key' });
  }

  // Generate token if not already assigned
  let token = row.token;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      'UPDATE licenses SET token = ?, last_seen = CURRENT_TIMESTAMP WHERE installation_id = ?'
    ).run(token, installation_id);
  } else {
    db.prepare(
      'UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE installation_id = ?'
    ).run(installation_id);
  }

  return res.json({ token });
});

module.exports = router;
module.exports.deriveActivationKey = deriveActivationKey;
