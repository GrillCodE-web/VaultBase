const express = require('express');
const { getDb } = require('../database');
const cache = require('../cache');

const router = express.Router();

/**
 * POST /invite/validate
 * Called from landing page — validates an invite code and returns download URL
 * Body: { code: "XXXX-XXXX-XXXX-XXXX" }
 */
router.post('/validate', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });

  const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (normalized.length < 8) return res.status(400).json({ error: 'invalid_code' });

  const db = getDb();

  // Try with dashes or without
  const formatted = `${normalized.slice(0,4)}-${normalized.slice(4,8)}-${normalized.slice(8,12)}-${normalized.slice(12,16)}`;
  const row = db.prepare(
    'SELECT * FROM invite_codes WHERE code = ?'
  ).get(formatted);

  if (!row) {
    return res.status(404).json({ error: 'invalid_code' });
  }

  if (row.is_used) {
    return res.status(409).json({ error: 'already_used' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(410).json({ error: 'expired' });
  }

  // Mark as used
  db.prepare(
    'UPDATE invite_codes SET is_used=1, used_at=CURRENT_TIMESTAMP WHERE code=?'
  ).run(formatted);

  // Get latest published version (cached 5 min)
  let version = cache.get('invite:version');
  if (!version) {
    version = db.prepare('SELECT * FROM versions WHERE is_published=1 ORDER BY published_at DESC LIMIT 1').get();
    cache.set('invite:version', version, 5 * 60 * 1000);
  }

  // Get all published installer files (cached 5 min)
  let files = cache.get('invite:files');
  if (!files) {
    files = db.prepare(`SELECT file_type, download_url, file_size, platform, version FROM release_files WHERE is_published=1 AND file_type != 'updater' ORDER BY published_at DESC`).all();
    cache.set('invite:files', files, 5 * 60 * 1000);
  }

  return res.json({
    ok: true,
    label: row.label || '',
    version: version ? version.version : null,
    download_url: version ? version.download_url : null,
    file_size: version ? version.file_size : null,
    notes: version ? version.notes : null,
    files,
  });
});

module.exports = router;
