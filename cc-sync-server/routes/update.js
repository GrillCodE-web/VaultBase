const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

/**
 * GET /update
 * Tauri v2 updater compatible endpoint.
 * Returns the latest published version in Tauri's update JSON format.
 *
 * Tauri app config (tauri.conf.json):
 *   "updater": {
 *     "endpoints": ["https://sec201-www.otpmanager.pro/update?current_version={{current_version}}"],
 *     "pubkey": "<your ed25519 public key>"
 *   }
 *
 * Версия приходит в query — именно поэтому в endpoints шаблон
 * `?current_version={{current_version}}`, а не путь `{{target}}/{{arch}}/...`:
 * такой путь этот роутер не обслуживает и вернул бы 404.
 *
 * Response format Tauri expects:
 * {
 *   "version": "1.2.0",
 *   "notes": "What's new",
 *   "pub_date": "2024-01-01T00:00:00Z",
 *   "platforms": {
 *     "darwin-aarch64": { "url": "...", "signature": "..." }
 *   }
 * }
 *
 * If current version >= latest → respond 204 No Content (no update needed)
 */
router.get('/', (req, res) => {
  const db = getDb();

  const row = db.prepare(`
    SELECT * FROM versions
    WHERE is_published = 1 AND download_url IS NOT NULL AND signature IS NOT NULL
    ORDER BY published_at DESC
    LIMIT 1
  `).get();

  if (!row) {
    return res.status(204).end(); // no update available
  }

  // Tauri sends current version in User-Agent: tauri/1.0.0 or query ?current_version=x.y.z
  const currentVersion = req.query.current_version || '';

  // Simple semver compare — if same or newer, no update
  if (currentVersion && !isNewer(row.version, currentVersion)) {
    return res.status(204).end();
  }

  // Собираем ВСЕ платформы этой версии из release_files.
  //
  // Раньше здесь отдавалась одна платформа из строки `versions` (по умолчанию
  // darwin-aarch64), поэтому апдейт работал ровно для одной ОС, а всем
  // остальным Tauri отвечал «нет подходящей платформы». Теперь берём каждую
  // строку с file_type='updater' для этой версии — Windows, Linux и обе macOS
  // обновляются с одного эндпоинта.
  const platforms = {};
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT platform, download_url, signature, file_size
      FROM release_files
      WHERE version = ? AND file_type = 'updater' AND is_published = 1
        AND download_url IS NOT NULL AND signature IS NOT NULL
    `).all(row.version);
  } catch (e) {
    // release_files может отсутствовать на старых БД — не роняем апдейтер,
    // просто откатываемся на одиночную платформу из versions ниже.
    console.error('[update] release_files query failed:', e.message);
  }

  for (const r of rows) {
    platforms[r.platform || 'darwin-aarch64'] = {
      url: r.download_url,
      signature: r.signature,
      ...(r.file_size ? { size: r.file_size } : {}),
    };
  }

  // Фолбэк: если в release_files ничего нет (залили только через versions),
  // отдаём одну платформу — прежнее поведение, чтобы не сломать старые релизы.
  if (Object.keys(platforms).length === 0) {
    const plat = row.platform || 'darwin-aarch64';
    platforms[plat] = { url: row.download_url, signature: row.signature };
    if (row.file_size) platforms[plat].size = row.file_size;
  }

  return res.json({
    version: row.version,
    notes: row.notes || '',
    pub_date: row.published_at
      ? new Date(row.published_at + 'Z').toISOString()
      : new Date().toISOString(),
    platforms,
  });
});

/**
 * GET /update/check?current_version=1.0.0
 * Human-readable update check (for curl / debug)
 */
router.get('/check', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT version, notes, published_at, is_published, download_url, file_size
    FROM versions
    WHERE is_published = 1
    ORDER BY published_at DESC LIMIT 1
  `).get();

  if (!row) return res.json({ update_available: false, message: 'No published versions' });

  const current = req.query.current_version || '0.0.0';
  const update_available = isNewer(row.version, current);

  res.json({
    update_available,
    latest_version: row.version,
    current_version: current,
    notes: row.notes,
    published_at: row.published_at,
    download_url: row.download_url || null,
    file_size_mb: row.file_size ? (row.file_size / 1024 / 1024).toFixed(1) : null,
  });
});

// Simple semver: is `a` newer than `b`?
function isNewer(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false; // equal
}

module.exports = router;
