const express = require('express');
const rateLimit = require('express-rate-limit');
const { getDb, hashToken } = require('../database');
const { requireToken } = require('../middleware');

const router = express.Router();

// FIX API-H06: Stricter rate limiting for footprint endpoints
// 100 requests per minute for general endpoints
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.userToken || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

// FIX API-H06: Much stricter limit for /check endpoint to prevent enumeration attacks
// Only 10 requests per minute for cross-user footprint lookup
const checkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.userToken || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limit_exceeded' },
});

// POST /footprint — batch insert footprint hashes
router.post('/', requireToken, limiter, (req, res) => {
  const { footprints } = req.body || {};

  if (!Array.isArray(footprints) || footprints.length === 0) {
    return res.status(400).json({ error: 'missing_footprints' });
  }

  const VALID_TYPES = ['email', 'ip', 'drop', 'bin', 'phone', 'name'];
  const db = getDb();
  // MGR-008: user_token хранится только как SHA-256 хеш (миграция v13).
  const tokenHash = hashToken(req.userToken);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO footprints (shop_domain, hash_type, hash_value, user_token)
    VALUES (?, ?, ?, ?)
  `);

  let saved = 0;
  let skipped = 0;

  const runAll = db.transaction(() => {
    for (const fp of footprints) {
      const { shop_domain, hash_type, hash_value } = fp;
      if (!shop_domain || !hash_type || !hash_value) { skipped++; continue; }
      if (!VALID_TYPES.includes(hash_type)) { skipped++; continue; }

      const info = insert.run(
        shop_domain.toLowerCase().trim(),
        hash_type,
        hash_value,
        tokenHash
      );
      if (info.changes > 0) saved++;
      else skipped++; // duplicate
    }
  });

  runAll();

  return res.json({ saved, duplicates: skipped });
});

// POST /check — cross-user footprint lookup for a shop
// FIX API-H06: Added stricter rate limit and limited response to prevent enumeration
router.post('/check', requireToken, checkLimiter, (req, res) => {
  const { shop_domain, hashes } = req.body || {};

  if (!shop_domain || !Array.isArray(hashes) || hashes.length === 0) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  // FIX API-H06: Limit number of hashes per request to prevent bulk enumeration
  if (hashes.length > 20) {
    return res.status(400).json({ error: 'too_many_hashes' });
  }

  const db = getDb();
  const domain = shop_domain.toLowerCase().trim();

  const matches = [];

  for (const { hash_type, hash_value } of hashes) {
    if (!hash_type || !hash_value) continue;

    let count;
    if (hash_type === 'bin') {
      // BIN is stored as plaintext — exact match
      const row = db.prepare(`
        SELECT COUNT(*) AS cnt FROM footprints
        WHERE shop_domain = ? AND hash_type = 'bin' AND hash_value = ?
      `).get(domain, hash_value);
      count = row ? row.cnt : 0;
    } else {
      const row = db.prepare(`
        SELECT COUNT(*) AS cnt FROM footprints
        WHERE shop_domain = ? AND hash_type = ? AND hash_value = ?
      `).get(domain, hash_type, hash_value);
      count = row ? row.cnt : 0;
    }

    // FIX API-H06: Only return boolean match, not count (prevents data enumeration)
    if (count > 0) {
      matches.push({ hash_type, match: true });
    }
  }

  return res.json({ matches });
});

module.exports = router;
