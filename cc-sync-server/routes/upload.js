const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');
const { requireAdmin } = require('../middleware');
const router = express.Router();

const RELEASES_DIR = process.env.RELEASES_DIR || path.join(__dirname, '../public/releases');
fs.mkdirSync(RELEASES_DIR, { recursive: true });

// Типы артефактов. `updater` — архив/инсталлятор, который скачивает встроенный
// апдейтер Tauri (к нему обязательна подпись). Остальные — то, что человек
// качает руками со страницы загрузки.
const FILE_TYPES = [
  'updater',
  'installer-dmg',   // macOS
  'installer-app',   // macOS .app.tar.gz
  'installer-msi',   // Windows MSI
  'installer-nsis',  // Windows NSIS .exe
  'installer-deb',   // Linux Debian/Ubuntu
  'installer-appimage', // Linux AppImage
];
// Расширения были только macOS-овские (.dmg/.tar.gz/.zip), из-за чего Windows- и
// Linux-сборки залить было физически нельзя — аплоад отбивал их по расширению.
const ALLOWED_EXTENSIONS = ['.dmg', '.tar.gz', '.zip', '.msi', '.exe', '.deb', '.AppImage', '.sig'];
const MAX_FILE_SIZE = 600 * 1024 * 1024; // 600MB

/**
 * Sanitize filename to prevent path traversal attacks
 * Removes directory components and dangerous characters
 */
function sanitizeFilename(filename) {
  // Remove any path components (prevent ../../etc/passwd attacks)
  let base = path.basename(filename);
  // Remove dangerous characters
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Ensure it doesn't start with a dot (hidden files)
  if (base.startsWith('.')) base = '_' + base;
  return base || 'upload.bin';
}

/**
 * Проверка расширения по белому списку.
 *
 * Сравнение регистронезависимое с обеих сторон: `.AppImage` в списке записан в
 * «родном» регистре, а path.extname отдаёт как есть — без нормализации обеих
 * сторон AppImage-сборка отбивалась бы как недопустимая.
 * Составное `.tar.gz` path.extname не понимает (вернёт `.gz`), поэтому отдельно.
 */
function validateExtension(filename) {
  const lower = filename.toLowerCase();
  const ext = lower.endsWith('.tar.gz') ? '.tar.gz' : path.extname(lower);
  return ALLOWED_EXTENSIONS.some(a => a.toLowerCase() === ext);
}

router.post('/', requireAdmin, (req, res) => {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) return res.status(400).json({ error: 'multipart required' });
  const boundary = ct.split('boundary=')[1];
  if (!boundary) return res.status(400).json({ error: 'no boundary' });

  // Enforce size limit BEFORE reading data (prevent DoS)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_FILE_SIZE) {
    return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` });
  }

  const chunks = [];
  let total = 0;
  let aborted = false;

  req.on('data', c => {
    total += c.length;
    if (total > MAX_FILE_SIZE) {
      aborted = true;
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', () => {
    if (aborted) {
      return res.status(413).json({ error: 'Request too large' });
    }
    try {
      const body = Buffer.concat(chunks);
      const parsed = parseMultipart(body, boundary);
      const version   = (parsed.fields.version   || '').trim();
      const notes     = (parsed.fields.notes     || '').trim();
      const platform  = (parsed.fields.platform  || 'darwin-aarch64').trim();
      const signature = (parsed.fields.signature || '').trim();
      const publish   = parsed.fields.publish === '1';

      // MGR-009: staged rollout для manager-updater (для остальных типов
      // поля просто сохраняются, использует их только /update?app=manager).
      const rawChannel = (parsed.fields.channel || 'stable').trim();
      if (!['stable', 'beta'].includes(rawChannel)) {
        return res.status(400).json({ error: 'Invalid channel. Allowed: stable, beta' });
      }
      const channel = rawChannel;
      const rollout_percent = Number.parseInt(parsed.fields.rollout_percent || '100', 10);
      if (!Number.isInteger(rollout_percent) || rollout_percent < 0 || rollout_percent > 100) {
        return res.status(400).json({ error: 'Invalid rollout_percent. Allowed: 0..100' });
      }

      // Validate file_type BEFORE processing
      const rawFileType = parsed.fields.file_type || 'updater';
      if (!FILE_TYPES.includes(rawFileType)) {
        return res.status(400).json({ error: `Invalid file_type. Allowed: ${FILE_TYPES.join(', ')}` });
      }
      const file_type = rawFileType;

      if (!version) return res.status(400).json({ error: 'version required' });
      if (!parsed.file) return res.status(400).json({ error: 'file required' });

      // Sanitize filename to prevent path traversal
      const orig = sanitizeFilename(parsed.file.filename || 'release.dmg');

      // Validate file extension
      if (!validateExtension(orig)) {
        return res.status(400).json({ error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` });
      }

      const ext  = orig.toLowerCase().endsWith('.tar.gz') ? '.tar.gz' : path.extname(orig) || '.dmg';
      const safeFilename = `vaultbase-${version}-${platform.replace(/[^a-z0-9-_]/gi,'_')}-${file_type}${ext}`;

      // Final safety check: ensure filename doesn't contain path separators
      if (safeFilename.includes('/') || safeFilename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      fs.writeFileSync(path.join(RELEASES_DIR, safeFilename), parsed.file.data);

      // BASE_URL должен указывать на боевой домен: он попадает в download_url,
      // который потом раздаётся клиентам и апдейтеру. Прежний дефолт
      // api.eulivehub.com на 2026-08-07 не резолвится вообще (NXDOMAIN) —
      // ссылки на скачивание вели бы в никуда.
      const base = (process.env.BASE_URL || 'https://sec201-www.otpmanager.pro').replace(/\/+$/, '');
      const download_url = `${base}/releases/${safeFilename}`;
      const file_size = parsed.file.data.length;
      const db = getDb();

      // Write to release_files
      const existing_rf = db.prepare('SELECT id FROM release_files WHERE version=? AND file_type=?').get(version, file_type);
      if (existing_rf) {
        db.prepare(`UPDATE release_files SET notes=?,download_url=?,signature=?,file_size=?,
          platform=?,is_published=?,channel=?,rollout_percent=?,published_at=CURRENT_TIMESTAMP WHERE version=? AND file_type=?`)
          .run(notes, download_url, signature||null, file_size, platform, publish?1:0, channel, rollout_percent, version, file_type);
      } else {
        db.prepare(`INSERT INTO release_files (version,file_type,notes,download_url,signature,file_size,platform,is_published,channel,rollout_percent)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(version, file_type, notes, download_url, signature||null, file_size, platform, publish?1:0, channel, rollout_percent);
      }

      // Backward compat: also write to versions for updater (Tauri /update endpoint)
      if (file_type === 'updater') {
        const ex = db.prepare('SELECT version FROM versions WHERE version=?').get(version);
        if (ex) {
          db.prepare(`UPDATE versions SET notes=?,download_url=?,signature=?,file_size=?,
            platform=?,is_published=?,published_at=CURRENT_TIMESTAMP WHERE version=?`)
            .run(notes, download_url, signature||null, file_size, platform, publish?1:0, version);
        } else {
          db.prepare(`INSERT INTO versions (version,notes,download_url,signature,file_size,platform,is_published)
            VALUES (?,?,?,?,?,?,?)`)
            .run(version, notes, download_url, signature||null, file_size, platform, publish?1:0);
        }
      }

      res.json({ ok:true, version, filename: safeFilename, download_url, file_type,
        file_size_mb:(file_size/1024/1024).toFixed(2), is_published:publish, needs_signature:!signature });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

router.post('/signature', requireAdmin, express.json(), (req, res) => {
  const { version, signature, file_type = 'updater' } = req.body || {};
  if (!version || !signature) return res.status(400).json({ error: 'version and signature required' });
  const db = getDb();
  if (!db.prepare('SELECT id FROM release_files WHERE version=? AND file_type=?').get(version, file_type))
    return res.status(404).json({ error: 'version/type not found' });
  db.prepare('UPDATE release_files SET signature=? WHERE version=? AND file_type=?').run(signature.trim(), version, file_type);
  if (file_type === 'updater')
    db.prepare('UPDATE versions SET signature=? WHERE version=?').run(signature.trim(), version);
  res.json({ ok: true });
});

router.post('/publish', requireAdmin, express.json(), (req, res) => {
  const { version, publish, file_type = 'updater' } = req.body || {};
  if (!version) return res.status(400).json({ error: 'version required' });
  const db = getDb();
  db.prepare('UPDATE release_files SET is_published=? WHERE version=? AND file_type=?').run(publish?1:0, version, file_type);
  if (file_type === 'updater')
    db.prepare('UPDATE versions SET is_published=? WHERE version=?').run(publish?1:0, version);
  res.json({ ok: true });
});

function indexOf(buf, search) {
  for (let i = 0; i <= buf.length-search.length; i++) {
    let ok = true;
    for (let j = 0; j < search.length; j++) if (buf[i+j]!==search[j]){ok=false;break;}
    if (ok) return i;
  }
  return -1;
}
function splitBuffer(buf, sep) {
  const parts=[]; let start=0;
  while(true){const idx=indexOf(buf.slice(start),sep);if(idx===-1)break;
    const c=buf.slice(start,start+idx);if(c.length)parts.push(c[0]===0x0d?c.slice(2):c);
    start+=idx+sep.length;}
  return parts;
}
function parseMultipart(body, boundary) {
  const result={fields:{},file:null};
  const sep=Buffer.from('--'+boundary);
  const crlf2=Buffer.from('\r\n\r\n');
  for(const part of splitBuffer(body,sep)){
    if(!part.length)continue;
    const hdrEnd=indexOf(part,crlf2);if(hdrEnd===-1)continue;
    const hdr=part.slice(0,hdrEnd).toString('utf8');
    let data=part.slice(hdrEnd+4);
    if(data[data.length-2]===0x0d&&data[data.length-1]===0x0a)data=data.slice(0,-2);
    const dm=hdr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    const fm=hdr.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"/i);
    if(!dm)continue;
    if(fm)result.file={filename:fm[1],data};
    else result.fields[dm[1]]=data.toString('utf8');
  }
  return result;
}
module.exports = router;
