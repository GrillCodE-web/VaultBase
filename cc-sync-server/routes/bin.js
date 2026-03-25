// BIN cache — shared across all users to reduce API calls.
// GET /api/bin/:bin  -> returns cached BIN data (30-day TTL, encrypted at rest)
// POST /api/bin      -> saves encrypted BIN data to shared cache
'use strict';
const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { requireToken } = require('../middleware');

const BIN_DB_PATH = process.env.BIN_DB || path.join(__dirname, '../bin_cache.db');
const binDb = new Database(BIN_DB_PATH);
binDb.exec(`
  CREATE TABLE IF NOT EXISTS bin_cache (
    bin       TEXT    PRIMARY KEY,
    data_enc  TEXT    NOT NULL,  -- Encrypted with AES-256-GCM
    iv        TEXT    NOT NULL,  -- Initialization vector
    auth_tag  TEXT    NOT NULL,  -- Authentication tag
    cached_at INTEGER NOT NULL
  )
`);

const TTL_SECS = 30 * 24 * 3600; // 30 days

// FIX A-MED-01: Encryption key derived from SERVER_SECRET
function getEncryptionKey() {
  const secret = process.env.SERVER_SECRET;
  if (!secret || secret === 'CHANGE_ME') {
    throw new Error('SERVER_SECRET not configured');
  }
  // Derive 32-byte key using PBKDF2
  return crypto.pbkdf2Sync(secret, 'bin-cache-salt', 600000, 32, 'sha256');
}

// FIX A-MED-01: Encrypt BIN data with AES-256-GCM
function encryptBinData(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(data);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
}

// FIX A-MED-01: Decrypt BIN data with AES-256-GCM
function decryptBinData(encrypted, ivBase64, authTagBase64) {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

// FIX API-H05 + A-MED-01: Auth + encryption for BIN cache
router.get('/:bin', requireToken, (req, res) => {
  const bin = req.params.bin.replace(/\D/g, '').slice(0, 8);
  if (!bin || bin.length < 6) return res.status(400).end();
  const cutoff = Math.floor(Date.now() / 1000) - TTL_SECS;

  const row = binDb.prepare(
    'SELECT data_enc, iv, auth_tag FROM bin_cache WHERE bin=? AND cached_at>?'
  ).get(bin, cutoff);

  if (row) {
    try {
      const decrypted = decryptBinData(row.data_enc, row.iv, row.auth_tag);
      return res.json(decrypted);
    } catch (e) {
      console.error('BIN decryption error:', e.message);
      return res.status(500).json({ error: 'decryption_failed' });
    }
  }
  res.status(404).end();
});

// FIX API-H05 + A-MED-01: Auth + encryption for BIN cache
router.post('/', requireToken, (req, res) => {
  const { bin, data } = req.body;
  if (!bin || !data || typeof data !== 'object') return res.status(400).end();
  const cleanBin = String(bin).replace(/\D/g, '').slice(0, 8);
  if (cleanBin.length < 6) return res.status(400).end();
  const now = Math.floor(Date.now() / 1000);

  try {
    const { encrypted, iv, authTag } = encryptBinData(data);
    binDb.prepare(
      'INSERT OR REPLACE INTO bin_cache(bin, data_enc, iv, auth_tag, cached_at) VALUES(?, ?, ?, ?, ?)'
    ).run(cleanBin, encrypted, iv, authTag, now);
    res.json({ ok: true });
  } catch (e) {
    console.error('BIN encryption error:', e.message);
    res.status(500).end();
  }
});

module.exports = router;
