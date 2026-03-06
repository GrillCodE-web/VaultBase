const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../database');
const { requireBasicAuth } = require('../middleware');

const router = express.Router();

const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, '../public/releases');
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

// Ensure directory exists
fs.mkdirSync(RELEASES_DIR, { recursive: true });

/**
 * POST /admin/upload
 * Multipart upload: receives .dmg or .tar.gz build file + .sig file
 *
 * Fields:
 *   - file: the binary (.dmg for macOS, .tar.gz for others)
 *   - signature: the .sig file content (text)
 *   - version: semver string
 *   - notes: release notes
 *   - platform: e.g. darwin-aarch64
 *   - publish: "1" to publish immediately, "0" to save as draft
 */
router.post('/', requireBasicAuth, (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'multipart/form-data required' });
  }

  // Manual multipart parsing (no extra deps)
  const boundary = contentType.split('boundary=')[1];
  if (!boundary) return res.status(400).json({ error: 'no boundary' });

  const chunks = [];
  let totalSize = 0;

  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > MAX_SIZE) {
      req.destroy();
      return res.status(413).json({ error: 'file_too_large' });
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const parsed = parseMultipart(body, boundary);

      const version   = (parsed.fields.version  || '').trim();
      const notes     = (parsed.fields.notes    || '').trim();
      const platform  = (parsed.fields.platform || 'darwin-aarch64').trim();
      const signature = (parsed.fields.signature || '').trim();
      const publish   = parsed.fields.publish === '1';

      if (!version) return res.status(400).json({ error: 'version required' });
      if (!parsed.file) return res.status(400).json({ error: 'file required' });

      // Determine extension
      const origName = parsed.file.filename || 'release.dmg';
      const ext = origName.endsWith('.tar.gz') ? '.tar.gz' :
                  path.extname(origName) || '.dmg';

      // Save file as version-platform.ext
      const safePlat = platform.replace(/[^a-z0-9-_]/gi, '_');
      const filename = `cc-manager-${version}-${safePlat}${ext}`;
      const filepath = path.join(RELEASES_DIR, filename);

      fs.writeFileSync(filepath, parsed.file.data);

      const baseUrl = process.env.BASE_URL || `https://api.eulivehub.com`;
      const download_url = `${baseUrl}/releases/${filename}`;
      const file_size = parsed.file.data.length;

      // Save or update version in DB
      const db = getDb();
      const existing = db.prepare('SELECT version FROM versions WHERE version=?').get(version);

      if (existing) {
        db.prepare(`
          UPDATE versions SET notes=?, download_url=?, signature=?, file_size=?,
            platform=?, is_published=?, published_at=CURRENT_TIMESTAMP
          WHERE version=?
        `).run(notes, download_url, signature || null, file_size, platform,
               publish ? 1 : 0, version);
      } else {
        db.prepare(`
          INSERT INTO versions (version, notes, download_url, signature, file_size, platform, is_published)
          VALUES (?,?,?,?,?,?,?)
        `).run(version, notes, download_url, signature || null, file_size, platform, publish ? 1 : 0);
      }

      res.json({
        ok: true,
        version,
        filename,
        download_url,
        file_size_mb: (file_size / 1024 / 1024).toFixed(2),
        is_published: publish,
        needs_signature: !signature,
      });
    } catch(e) {
      console.error('[upload]', e);
      res.status(500).json({ error: e.message });
    }
  });
});

/**
 * POST /admin/upload/signature
 * Add/update signature for an existing version (upload .sig file separately)
 */
router.post('/signature', requireBasicAuth, express.json(), (req, res) => {
  const { version, signature } = req.body || {};
  if (!version || !signature) return res.status(400).json({ error: 'version and signature required' });
  const db = getDb();
  const row = db.prepare('SELECT version FROM versions WHERE version=?').get(version);
  if (!row) return res.status(404).json({ error: 'version not found' });
  db.prepare('UPDATE versions SET signature=? WHERE version=?').run(signature.trim(), version);
  res.json({ ok: true });
});

/**
 * POST /admin/upload/publish
 * Toggle publish state for a version
 */
router.post('/publish', requireBasicAuth, express.json(), (req, res) => {
  const { version, publish } = req.body || {};
  if (!version) return res.status(400).json({ error: 'version required' });
  const db = getDb();
  db.prepare('UPDATE versions SET is_published=? WHERE version=?').run(publish ? 1 : 0, version);
  res.json({ ok: true });
});

// ── Minimal multipart parser (no busboy/multer dep) ──────────────────────────
function parseMultipart(body, boundary) {
  const result = { fields: {}, file: null };
  const sep = Buffer.from('--' + boundary);
  const parts = splitBuffer(body, sep);

  for (const part of parts) {
    if (!part.length || part.equals(Buffer.from('--\r\n')) || part.equals(Buffer.from('--'))) continue;

    // Split headers from body
    const crlf2 = Buffer.from('\r\n\r\n');
    const hdrEnd = indexOf(part, crlf2);
    if (hdrEnd === -1) continue;

    const headerStr = part.slice(0, hdrEnd).toString('utf8');
    let data = part.slice(hdrEnd + 4);
    // Remove trailing \r\n
    if (data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.slice(0, -2);
    }

    const dispMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    const fileMatch = headerStr.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"/i);
    if (!dispMatch) continue;

    const fieldName = dispMatch[1];
    if (fileMatch) {
      result.file = { filename: fileMatch[1], data };
    } else {
      result.fields[fieldName] = data.toString('utf8');
    }
  }
  return result;
}

function indexOf(buf, search) {
  for (let i = 0; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

function splitBuffer(buf, sep) {
  const parts = [];
  let start = 0;
  while (true) {
    const idx = indexOf(buf.slice(start), sep);
    if (idx === -1) break;
    const chunk = buf.slice(start, start + idx);
    if (chunk.length) {
      // strip leading \r\n
      parts.push(chunk[0] === 0x0d ? chunk.slice(2) : chunk);
    }
    start += idx + sep.length;
  }
  return parts;
}

module.exports = router;
