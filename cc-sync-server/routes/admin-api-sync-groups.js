// 7rn: sync-groups эндпоинты админки, вынесены из admin-api.js (разбивка
// большого роутера). Поведение и пути идентичны прежним: обе формы маршрутов
// (/sync-groups и /sync/groups) регистрируются через register(router).
// Зависимости — только getDb и crypto; никакого состояния модуль не держит.
const crypto = require('crypto');
const { getDb } = require('../database');

const syncGroupsList = (req, res) => {
  const db = getDb();
  const groups = db.prepare('SELECT * FROM sync_groups ORDER BY created_at DESC').all();
  const result = groups.map(g => {
    const members = db.prepare(
      'SELECT installation_id, joined_at FROM sync_group_members WHERE group_id = ?'
    ).all(g.id);
    const card_count = db.prepare('SELECT COUNT(*) AS n FROM sync_cards WHERE group_id = ?').get(g.id).n;
    return { ...g, members, member_count: members.length, card_count };
  });
  res.json(result);
};

const syncGroupMembers = (req, res) => {
  const members = getDb().prepare(
    'SELECT installation_id, joined_at FROM sync_group_members WHERE group_id = ?'
  ).all(req.params.id);
  res.json({ members });
};

const syncGroupCreate = (req, res) => {
  const db = getDb();
  const { name, installation_ids } = req.body || {};
  const group_id = crypto.randomUUID();
  const group_key = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sync_groups (id, name, created_by, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .run(group_id, name || 'Admin Group', 'admin');
  if (Array.isArray(installation_ids)) {
    for (const iid of installation_ids) {
      db.prepare(
        'INSERT OR IGNORE INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      ).run(group_id, iid, group_key);
    }
  }
  res.json({ ok: true, group_id, group_key });
};

const syncGroupDelete = (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sync_cards WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sync_group_members WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sync_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
};

const syncGroupMemberAdd = (req, res) => {
  const db = getDb();
  const { installation_id } = req.body || {};
  if (!installation_id) return res.status(400).json({ error: 'installation_id required' });
  // Get group_key from first member
  const firstMember = db.prepare('SELECT group_key_encrypted FROM sync_group_members WHERE group_id = ? LIMIT 1').get(req.params.id);
  const group_key = firstMember?.group_key_encrypted || crypto.randomBytes(32).toString('hex');
  try {
    db.prepare(
      'INSERT INTO sync_group_members (group_id, installation_id, group_key_encrypted, joined_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
    ).run(req.params.id, installation_id, group_key);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'already_member' });
    throw e;
  }
};

const syncGroupMemberRemove = (req, res) => {
  getDb().prepare('DELETE FROM sync_group_members WHERE group_id = ? AND installation_id = ?')
    .run(req.params.id, req.params.iid);
  res.json({ ok: true });
};

// Зарегистрировать sync-groups маршруты на переданном роутере. Обе формы путей
// (дефис и слэш) сохранены ради обратной совместимости с существующим фронтом.
function register(router) {
  router.get('/sync-groups', syncGroupsList);
  router.get('/sync/groups', syncGroupsList);
  router.get('/sync/groups/:id/members', syncGroupMembers);
  router.post('/sync-groups', syncGroupCreate);
  router.post('/sync/groups', syncGroupCreate);
  router.delete('/sync-groups/:id', syncGroupDelete);
  router.delete('/sync/groups/:id', syncGroupDelete);
  router.post('/sync-groups/:id/members', syncGroupMemberAdd);
  router.post('/sync/groups/:id/members', syncGroupMemberAdd);
  router.delete('/sync-groups/:id/members/:iid', syncGroupMemberRemove);
  router.delete('/sync/groups/:id/members/:iid', syncGroupMemberRemove);
}

module.exports = { register };
