// BIN cache — shared across all users to reduce API calls.
// GET /api/bin/:bin  -> returns cached BIN data (30-day TTL)
// POST /api/bin      -> saves BIN data to shared cache
'use strict';
const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const BIN_DB_PATH = process.env.BIN_DB || path.join(__dirname, '../bin_cache.db');
const binDb = new Database(BIN_DB_PATH);
binDb.exec(`
  CREATE TABLE IF NOT EXISTS bin_cache (
    bin       TEXT    PRIMARY KEY,
    data_json TEXT    NOT NULL,
    cached_at INTEGER NOT NULL
  )
`);

const TTL_SECS = 30 * 24 * 3600; // 30 days

router.get('/:bin', (req, res) => {
  const bin = req.params.bin.replace(/\D/g, '').slice(0, 8);
  if (!bin || bin.length < 6) return res.status(400).end();
  const cutoff = Math.floor(Date.now() / 1000) - TTL_SECS;
  const row = binDb.prepare('SELECT data_json FROM bin_cache WHERE bin=? AND cached_at>?').get(bin, cutoff);
  if (row) {
    try { return res.json(JSON.parse(row.data_json)); }
    catch { return res.status(404).end(); }
  }
  res.status(404).end();
});

router.post('/', (req, res) => {
  const { bin, data } = req.body;
  if (!bin || !data || typeof data !== 'object') return res.status(400).end();
  const cleanBin = String(bin).replace(/\D/g, '').slice(0, 8);
  if (cleanBin.length < 6) return res.status(400).end();
  const now = Math.floor(Date.now() / 1000);
  try {
    binDb.prepare('INSERT OR REPLACE INTO bin_cache(bin,data_json,cached_at) VALUES(?,?,?)').run(cleanBin, JSON.stringify(data), now);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).end();
  }
});

module.exports = router;
