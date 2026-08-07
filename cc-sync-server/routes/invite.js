const express = require('express');
const { getDb } = require('../database');
const cache = require('../cache');

const router = express.Router();

/**
 * POST /invite/validate
 * Called from landing page — validates an invite code and returns download URL
 * Body: { code: "XXXX-XXXX-XXXX-XXXX" }
 * Supports multi-use codes via max_uses field (0 = unlimited, default = 1)
 */
router.post('/validate', (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code' });

  const normalized = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (normalized.length < 8) return res.status(400).json({ error: 'invalid_code' });

  const db = getDb();

  const formatted = `${normalized.slice(0,4)}-${normalized.slice(4,8)}-${normalized.slice(8,12)}-${normalized.slice(12,16)}`;

  try {
    const result = db.transaction(() => {
      const row = db.prepare(
        'SELECT * FROM invite_codes WHERE code = ?'
      ).get(formatted);

      if (!row) {
        return { status: 404, error: 'invalid_code' };
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return { status: 410, error: 'expired' };
      }

      // max_uses=0 means unlimited; max_uses=N means up to N uses
      const maxUses = row.max_uses ?? 1;
      const useCount = row.use_count ?? 0;

      if (maxUses > 0 && useCount >= maxUses) {
        return { status: 409, error: 'already_used' };
      }

      // Increment use_count atomically; set is_used when max reached
      const newCount = useCount + 1;
      const nowExhausted = maxUses > 0 && newCount >= maxUses ? 1 : 0;

      db.prepare(
        `UPDATE invite_codes
         SET use_count = use_count + 1,
             is_used   = CASE WHEN max_uses > 0 AND (use_count + 1) >= max_uses THEN 1 ELSE is_used END,
             used_at   = COALESCE(used_at, CURRENT_TIMESTAMP)
         WHERE code = ?`
      ).run(formatted);

      return { status: 200, row, useCount: newCount, maxUses, exhausted: nowExhausted };
    })();

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.error });
    }

    const { row } = result;

    let version = cache.get('invite:version');
    if (!version) {
      version = db.prepare('SELECT * FROM versions WHERE is_published=1 ORDER BY published_at DESC LIMIT 1').get();
      cache.set('invite:version', version, 5 * 60 * 1000);
    }

    let files = cache.get('invite:files');
    if (!files) {
      files = db.prepare(`SELECT file_type, download_url, file_size, platform, version FROM release_files WHERE is_published=1 AND file_type != 'updater' ORDER BY published_at DESC`).all();
      cache.set('invite:files', files, 5 * 60 * 1000);
    }

    return res.json({
      ok: true,
      label: row.label || '',
      uses_left: result.maxUses > 0 ? result.maxUses - result.useCount : null,
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
