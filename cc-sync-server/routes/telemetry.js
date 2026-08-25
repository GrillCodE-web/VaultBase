const express = require('express');
const { getDb } = require('../database');
const { requireWorkerToken } = require('../middleware');

const router = express.Router();
router.use(requireWorkerToken);

const REPORT_KINDS = ['daily_stats', 'activity_tail'];

// Envelope: {key_id, ephemeral: <32-byte x25519 pub, hex>, nonce: <12-byte hex>,
//            ct: <AES-256-GCM ciphertext, base64>} — see docs/MANAGER_APP.md.
// The server never sees plaintext: it validates the shape only.
function validateEnvelopes(envelopes) {
  if (!Array.isArray(envelopes) || envelopes.length === 0 || envelopes.length > 8) return false;
  for (const e of envelopes) {
    if (!e || typeof e !== 'object') return false;
    if (!Number.isInteger(e.key_id)) return false;
    if (typeof e.ephemeral !== 'string' || !/^[0-9a-f]{64}$/i.test(e.ephemeral)) return false;
    if (typeof e.nonce !== 'string' || !/^[0-9a-f]{24}$/i.test(e.nonce)) return false;
    if (typeof e.ct !== 'string' || e.ct.length === 0 || e.ct.length > 300000) return false;
  }
  return true;
}

function activeManagerKeysExist(db, envelopes) {
  for (const e of envelopes) {
    const row = db.prepare('SELECT 1 FROM manager_keys WHERE id = ? AND is_active = 1').get(e.key_id);
    if (!row) return false;
  }
  return true;
}

function getPolicy(db, iid) {
  const row = db.prepare(`
    SELECT banned, banned_reason, ban_until, permissions_override,
           quota_cards_day, quota_orders_day, min_version, version_exempt,
           force_logout, updated_by, updated_at
    FROM worker_policies WHERE installation_id = ?
  `).get(iid);
  return row || {
    banned: 0,
    banned_reason: null,
    ban_until: null,
    permissions_override: null,
    quota_cards_day: null,
    quota_orders_day: null,
    min_version: null,
    version_exempt: 0,
    force_logout: 0,
    updated_by: null,
    updated_at: null,
  };
}

function compareSemver(a, b) {
  const pa = (a || '0').split('.').map(Number);
  const pb = (b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

router.post('/heartbeat', (req, res) => {
  const { envelopes, ack_force_logout } = req.body || {};
  if (!validateEnvelopes(envelopes)) return res.status(400).json({ error: 'invalid_envelopes' });
  const db = getDb();
  if (!activeManagerKeysExist(db, envelopes)) return res.status(409).json({ error: 'no_active_manager_keys' });

  db.transaction(() => {
    db.prepare(`
      INSERT INTO worker_heartbeats (installation_id, last_seen, key_id, envelope, received_at)
      VALUES (?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(installation_id) DO UPDATE SET
        last_seen = CURRENT_TIMESTAMP,
        key_id = excluded.key_id,
        envelope = excluded.envelope,
        received_at = CURRENT_TIMESTAMP
    `).run(req.installationId, envelopes[0].key_id, JSON.stringify(envelopes));
    db.prepare('INSERT INTO worker_heartbeat_history (installation_id, ts) VALUES (?, CURRENT_TIMESTAMP)')
      .run(req.installationId);
    if (ack_force_logout === true) {
      db.prepare('UPDATE worker_policies SET force_logout = 0 WHERE installation_id = ?').run(req.installationId);
    }
    db.prepare(`
      UPDATE worker_policies SET banned = 0, banned_reason = NULL
      WHERE installation_id = ? AND banned = 1
        AND ban_until IS NOT NULL AND ban_until <= datetime('now')
    `).run(req.installationId);
  })();

  const policy = getPolicy(db, req.installationId);
  let update_required = false;
  if (policy.min_version && !policy.version_exempt) {
    const v = req.headers['x-app-version'];
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v.trim()) && compareSemver(policy.min_version, v.trim()) > 0) {
      update_required = true;
    }
  }
  res.json({ ok: true, policy, update_required });
});

router.post('/report', (req, res) => {
  const { kind, date, envelopes } = req.body || {};
  if (!REPORT_KINDS.includes(kind)) return res.status(400).json({ error: 'invalid_kind' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'invalid_date' });
  if (!validateEnvelopes(envelopes)) return res.status(400).json({ error: 'invalid_envelopes' });
  const db = getDb();
  if (!activeManagerKeysExist(db, envelopes)) return res.status(409).json({ error: 'no_active_manager_keys' });
  db.prepare(`
    INSERT INTO stats_reports (installation_id, kind, report_date, key_id, envelopes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(installation_id, kind, report_date) DO UPDATE SET
      key_id = excluded.key_id,
      envelopes = excluded.envelopes,
      received_at = CURRENT_TIMESTAMP
  `).run(req.installationId, kind, date, envelopes[0].key_id, JSON.stringify(envelopes));
  res.json({ ok: true });
});

router.get('/keys', (req, res) => {
  const rows = getDb().prepare('SELECT id, pubkey, key_type, label FROM manager_keys WHERE is_active = 1').all();
  res.json({ keys: rows });
});

router.get('/policy', (req, res) => {
  res.json({ policy: getPolicy(getDb(), req.installationId) });
});

router.get('/news', (req, res) => {
  const db = getDb();
  const news = db.prepare(`
    SELECT n.id, n.severity, n.title, n.body, n.published_at, n.expires_at,
           CASE WHEN r.news_id IS NOT NULL THEN 1 ELSE 0 END AS is_read
    FROM manager_news n
    LEFT JOIN news_reads r ON r.news_id = n.id AND r.installation_id = ?
    WHERE n.is_published = 1
      AND (n.expires_at IS NULL OR n.expires_at > datetime('now'))
      AND (n.target_role = 'all' OR n.target_role = ?)
      AND (n.target_iid IS NULL OR n.target_iid = ?)
    ORDER BY n.published_at DESC
    LIMIT 100
  `).all(req.installationId, req.licenseRole || 'operator', req.installationId);
  res.json({ news });
});

router.post('/news/:id/read', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_news_id' });
  getDb().prepare('INSERT OR IGNORE INTO news_reads (news_id, installation_id) VALUES (?, ?)')
    .run(id, req.installationId);
  res.json({ ok: true });
});

router.get('/priorities', (req, res) => {
  const role = req.licenseRole || 'operator';
  const targets = ['', `iid:${req.installationId}`, `role:${role}`];
  const placeholders = targets.map(() => '?').join(', ');
  const rows = getDb().prepare(`
    SELECT shop_domain, target, weight, notes, updated_at
    FROM shop_priorities
    WHERE target IN (${placeholders})
    ORDER BY weight DESC, shop_domain ASC
  `).all(...targets);
  res.json({ priorities: rows });
});

module.exports = router;
