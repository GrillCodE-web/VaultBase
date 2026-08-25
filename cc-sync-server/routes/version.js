const express = require('express');
const { getDb } = require('../database');

const router = express.Router();

// GET /version — returns latest published version
router.get('/', (req, res) => {
  const db = getDb();
  // FIX: без фильтра is_published черновик версии (залитая, но не опубликованная)
  // утекал наружу как «последний релиз».
  const row = db.prepare(
    'SELECT version, notes FROM versions WHERE is_published = 1 ORDER BY published_at DESC LIMIT 1'
  ).get();

  if (!row) {
    return res.json({ version: '0.0.0', notes: '' });
  }

  return res.json({ version: row.version, notes: row.notes });
});

module.exports = router;
