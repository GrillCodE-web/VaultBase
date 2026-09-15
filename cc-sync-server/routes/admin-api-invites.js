// 7rn: invite-codes эндпоинты админки, вынесены из admin-api.js (разбивка
// большого роутера). Маршруты, пути и ответы идентичны прежним — регистрируются
// через register(router). Зависимости — getDb и crypto; своего состояния нет.
const crypto = require('crypto');
const { getDb } = require('../database');

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I confusion
  const randomBytes = crypto.randomBytes(16);
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[randomBytes[i] % chars.length];
  }
  return code;
}

// GET /admin/api/invites
const invitesList = (req, res) => {
  res.json(getDb().prepare(
    'SELECT * FROM invite_codes ORDER BY created_at DESC'
  ).all());
};

// POST /admin/api/invites — create one or many
const invitesCreate = (req, res) => {
  const { label, count = 1, expires_days, max_uses = 1 } = req.body || {};
  const db = getDb();
  const created = [];
  const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  const maxUses = Math.max(parseInt(max_uses) || 1, 0); // 0 = unlimited

  const expires_at = expires_days
    ? new Date(Date.now() + parseInt(expires_days) * 86400000).toISOString().slice(0, 19)
    : null;

  for (let i = 0; i < n; i++) {
    let code, attempts = 0;
    do {
      code = generateInviteCode();
      attempts++;
    } while (db.prepare('SELECT 1 FROM invite_codes WHERE code=?').get(code) && attempts < 10);

    db.prepare(
      'INSERT INTO invite_codes (code, label, expires_at, max_uses, use_count) VALUES (?,?,?,?,0)'
    ).run(code, label || '', expires_at, maxUses);
    created.push(code);
  }

  res.json({ ok: true, codes: created });
};

// PATCH /admin/api/invites/:code — edit label and/or max_uses
const invitesPatch = (req, res) => {
  const { label, max_uses } = req.body || {};
  const db = getDb();
  if (label !== undefined) db.prepare('UPDATE invite_codes SET label=? WHERE code=?').run(label || '', req.params.code);
  if (max_uses !== undefined) db.prepare('UPDATE invite_codes SET max_uses=? WHERE code=?').run(Math.max(parseInt(max_uses) || 0, 0), req.params.code);
  res.json({ ok: true });
};

// DELETE /admin/api/invites/:code
const invitesDelete = (req, res) => {
  getDb().prepare('DELETE FROM invite_codes WHERE code=?').run(req.params.code);
  res.json({ ok: true });
};

// POST /admin/api/invites/:code/reset — reset use counter
const invitesReset = (req, res) => {
  getDb().prepare('UPDATE invite_codes SET is_used=0, used_at=NULL, use_count=0 WHERE code=?').run(req.params.code);
  res.json({ ok: true });
};

// GET /admin/api/invites/export.csv
const invitesExportCsv = (req, res) => {
  const rows = getDb().prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all();
  const header = 'code,label,use_count,max_uses,is_used,used_at,created_at,expires_at\n';
  const csv = header + rows.map(r =>
    [r.code, r.label, r.use_count ?? 0, r.max_uses ?? 1, r.is_used, r.used_at || '', r.created_at, r.expires_at || '']
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="invites.csv"');
  res.send(csv);
};

// Зарегистрировать invite-маршруты на переданном роутере. Порядок сохранён:
// специфичный /invites/export.csv не конфликтует с /invites/:code, так как
// Express матчит в порядке регистрации — как и было в исходном admin-api.js.
function register(router) {
  router.get('/invites', invitesList);
  router.post('/invites', invitesCreate);
  router.patch('/invites/:code', invitesPatch);
  router.delete('/invites/:code', invitesDelete);
  router.post('/invites/:code/reset', invitesReset);
  router.get('/invites/export.csv', invitesExportCsv);
}

module.exports = { register };
