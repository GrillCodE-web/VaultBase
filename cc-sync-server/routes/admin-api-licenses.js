// 7rn: licenses-эндпоинты админки, вынесены из admin-api.js (разбивка большого
// роутера). Поведение, пути и ответы идентичны прежним — регистрируются через
// register(router). Зависимости — getDb, cache и деривация ключа активации из
// ./activate; собственного состояния модуль не держит.
const { getDb } = require('../database');
const { deriveActivationKey, normalizeChallenge } = require('./activate');
const cache = require('../cache');

const licensesList = (req, res) => {
  const cached = cache.get('admin:licenses');
  if (cached) return res.json(cached);
  const rows = getDb().prepare(
    'SELECT installation_id,label,challenge,token_hash,is_active,role,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  // MGR-008: открытых токенов в БД больше нет — маскируем хеш (диагностика,
  // «какой токен у какой лицензии» остаётся возможной по префиксу).
  const maskedRows = rows.map(r => ({
    ...r,
    token: r.token_hash ? `${r.token_hash.slice(0, 8)}...${r.token_hash.slice(-8)}` : null,
    token_hash: undefined,
  }));
  cache.set('admin:licenses', maskedRows, 10_000);
  res.json(maskedRows);
};

const licenseCreate = (req, res) => {
  const { installation_id, challenge, label, role } = req.body || {};
  if (!installation_id || !challenge) return res.status(400).json({ error: 'installation_id and challenge required' });
  // manager — полноценная роль manager-приложения; без неё админка не могла
  // выдать первую manager-лицензию (бутстрап-дыра: /manager/api/licenses
  // требует уже существующий manager-токен).
  const licRole = ['admin', 'operator', 'manager'].includes(role) ? role : 'operator';
  // Нормализуем challenge (дефисы/пробелы → «чистый» hex, верхний регистр):
  // воркер показывает код с дефисами, а /activate ищет лицензию по чистому hex.
  const iid = installation_id.trim();
  const ch = normalizeChallenge(challenge);
  const db = getDb();
  try {
    db.prepare('INSERT INTO licenses (installation_id,challenge,label,role) VALUES (?,?,?,?)').run(
      iid, ch, label || '', licRole
    );
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'installation_id already exists' });
    throw e;
  }
  const activation_key = deriveActivationKey(iid, ch);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true, activation_key });
};

// PATCH /admin/api/licenses/:id — edit label and/or role
const licensePatch = (req, res) => {
  const { label, role, expires_at } = req.body || {};
  if (label === undefined && role === undefined && expires_at === undefined) return res.status(400).json({ error: 'label, role or expires_at required' });
  const db = getDb();
  if (label !== undefined) {
    db.prepare('UPDATE licenses SET label=? WHERE installation_id=?').run(label.trim(), req.params.id);
  }
  if (role !== undefined) {
    if (!['admin', 'operator', 'manager'].includes(role)) return res.status(400).json({ error: 'role must be admin, operator or manager' });
    db.prepare('UPDATE licenses SET role=? WHERE installation_id=?').run(role, req.params.id);
  }
  if (expires_at !== undefined) {
    // Time-bomb: ISO-дата или null (бессрочно). Просроченная лицензия получает
    // 403 license_expired на /verify даже при живом сервере.
    if (expires_at !== null && Number.isNaN(Date.parse(expires_at))) return res.status(400).json({ error: 'expires_at must be ISO date or null' });
    db.prepare('UPDATE licenses SET expires_at=? WHERE installation_id=?').run(expires_at, req.params.id);
    db.prepare('INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
      .run('license_expiry', JSON.stringify({ installation_id: req.params.id, expires_at, by: req.adminUser || 'admin' }));
  }
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
};

// Ребинд лицензии на другое устройство (P3.9): после смены железа клиент
// показывает новый installation_id и challenge (код активации привязан к
// железу), менеджер перебивает привязку здесь. Старый токен умирает —
// перевыпускается при повторной активации на новом устройстве.
const licenseRebind = (req, res) => {
  const { installation_id, challenge } = req.body || {};
  if (!installation_id || typeof installation_id !== 'string' || installation_id.length < 8) {
    return res.status(400).json({ error: 'installation_id required' });
  }
  if (!challenge || typeof challenge !== 'string' || challenge.length < 8) {
    return res.status(400).json({ error: 'challenge required' });
  }
  const db = getDb();
  const row = db.prepare('SELECT installation_id FROM licenses WHERE installation_id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (db.prepare('SELECT 1 FROM licenses WHERE installation_id=?').get(installation_id)) {
    return res.status(409).json({ error: 'target_exists' });
  }
  db.prepare(
    'UPDATE licenses SET installation_id=?, challenge=?, token_hash=NULL, prev_token_hash=NULL, rotated_at=NULL WHERE installation_id=?'
  ).run(installation_id, normalizeChallenge(challenge), req.params.id);
  db.prepare('INSERT INTO audit_log (action, details, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run('license_rebind', JSON.stringify({ from: req.params.id, to: installation_id, by: req.adminUser || 'admin' }));
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true, installation_id });
};

const licenseRevoke = (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=0 WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
};

const licenseRestore = (req, res) => {
  getDb().prepare('UPDATE licenses SET is_active=1 WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
};

// DELETE /admin/api/licenses/:id
const licenseDelete = (req, res) => {
  getDb().prepare('DELETE FROM licenses WHERE installation_id=?').run(req.params.id);
  cache.invalidate('admin:licenses');
  cache.invalidate('admin:stats');
  res.json({ ok: true });
};

// GET /admin/api/licenses/analytics — license analytics summary
const licenseAnalytics = (req, res) => {
  try {
    const db = getDb();
    const total    = db.prepare('SELECT COUNT(*) AS n FROM licenses').get()?.n || 0;
    const active   = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE is_active = 1').get()?.n || 0;
    const recent   = db.prepare(
      'SELECT installation_id, label, is_active, created_at FROM licenses ORDER BY created_at DESC LIMIT 20'
    ).all() || [];
    res.json({ total, active, inactive: total - active, recent });
  } catch (e) {
    res.json({ total: 0, active: 0, inactive: 0, recent: [], error: e.message });
  }
};

// GET /admin/api/licenses/export.csv
// Security note: tokens are masked to prevent mass token theft
const licenseExportCsv = (req, res) => {
  const rows = getDb().prepare(
    'SELECT installation_id,label,challenge,token,is_active,created_at,last_seen FROM licenses ORDER BY created_at DESC'
  ).all();
  const header = 'installation_id,label,challenge,token_masked,is_active,created_at,last_seen\n';
  const csv = header + rows.map(r =>
    [
      r.installation_id,
      r.label,
      r.challenge,
      r.token ? `${r.token.slice(0, 8)}...${r.token.slice(-8)}` : '', // Masked token
      r.is_active,
      r.created_at,
      r.last_seen || ''
    ]
      .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="licenses.csv"');
  res.send(csv);
};

// Зарегистрировать licenses-маршруты на переданном роутере. Порядок сохранён:
// специфичные пути (/analytics, /export.csv) не конфликтуют с /:id, так как
// Express матчит в порядке регистрации — как и было в исходном admin-api.js.
function register(router) {
  router.get('/licenses', licensesList);
  router.post('/licenses', licenseCreate);
  router.patch('/licenses/:id', licensePatch);
  router.post('/licenses/:id/rebind', licenseRebind);
  router.post('/licenses/:id/revoke', licenseRevoke);
  router.post('/licenses/:id/restore', licenseRestore);
  router.delete('/licenses/:id', licenseDelete);
  router.get('/licenses/analytics', licenseAnalytics);
  router.get('/licenses/export.csv', licenseExportCsv);
}

module.exports = { register };
