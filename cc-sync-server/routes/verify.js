const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

// POST /verify
router.post('/', (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'missing_token' });
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT token, label, is_active FROM licenses WHERE token = ?'
  ).get(token);

  if (!row) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'revoked' });
  }

  db.prepare(
    'UPDATE licenses SET last_seen = CURRENT_TIMESTAMP WHERE token = ?'
  ).run(token);

  return res.json({ valid: true, label: row.label || '' });
});

module.exports = router;
