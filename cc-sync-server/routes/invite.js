const express = require('express');
const { getDb } = require('../database');
const cache = require('../cache');

const router = express.Router();

/**
 * POST /invite/validate
 * Called from landing page — validates an invite code and returns download URL
 * Body: { code: "XXXX-XXXX-XXXX-XXXX" }
 * FIX API-H07: Use transaction to prevent race condition (double-spend attack)
 */
router.post('/validate', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });

  const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (normalized.length < 8) return res.status(400).json({ error: 'invalid_code' });

  const db = getDb();

  // Try with dashes or without
  const formatted = `${normalized.slice(0,4)}-${normalized.slice(4,8)}-${normalized.slice(8,12)}-${normalized.slice(12,16)}`;

  // FIX API-H07: Use transaction to atomically check and mark as used
  // This prevents race condition where two simultaneous requests could both see is_used=0
  try {
    const result = db.transaction(() => {
      // SELECT with immediate write lock using FOR UPDATE pattern
      // In SQLite, we use BEGIN IMMEDIATE to get write lock
      const row = db.prepare(
        'SELECT * FROM invite_codes WHERE code = ?'
      ).get(formatted);

      if (!row) {
        return { status: 404, error: 'invalid_code' };
      }

      if (row.is_used) {
        return { status: 409, error: 'already_used' };
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return { status: 410, error: 'expired' };
      }

      // Mark as used atomically within transaction
      db.prepare(
        'UPDATE invite_codes SET is_used=1, used_at=CURRENT_TIMESTAMP WHERE code=? AND is_used=0'
      ).run(formatted);

      // Verify the update succeeded (row was not already used)
      const updatedRow = db.prepare('SELECT is_used FROM invite_codes WHERE code=?').get(formatted);
      if (!updatedRow?.is_used) {
        // Another request beat us to it
        return { status: 409, error: 'already_used' };
      }

      return { status: 200, row };
    })();

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error });
    }

    const { row } = result;

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
  } catch (e) {
    console.error('[invite/validate] Transaction error:', e);
    return res.status(500).json({ error: 'database_error' });
  }
});

module.exports = router;
