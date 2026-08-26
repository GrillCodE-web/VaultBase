// FEAT-010: sync тегов курьеров ("использован под zoro.com").
// Валидация + upsert, общие для всех каналов (сейчас — POST /sync/courier_tag).
// Сервер видит только provider + SHA-256 хеш личности + тег: имена и адреса
// курьеров десктопный клиент не отправляет.

const MAX_TAG_LEN = 100;
const MAX_PROVIDER_LEN = 32;

/** null = невалидный payload; иначе нормализованная строка тега. */
function sanitizeCourierTag(body) {
  if (!body || typeof body !== 'object') return null;
  const { provider, courier_hash, tag, action } = body;
  if (typeof courier_hash !== 'string' || !/^[0-9a-f]{64}$/.test(courier_hash)) return null;
  if (typeof tag !== 'string') return null;
  const normTag = tag.trim().toLowerCase();
  if (normTag.length === 0 || normTag.length > MAX_TAG_LEN) return null;
  if (action !== 'add' && action !== 'remove') return null;
  const prov = (typeof provider === 'string' && provider.trim())
    ? provider.trim().slice(0, MAX_PROVIDER_LEN)
    : 'swat';
  return { provider: prov, courier_hash, tag: normTag, action };
}

/** Последнее действие побеждает (upsert по PK группы). История не ведётся. */
function applyCourierTag(db, groupId, installationId, row) {
  db.prepare(`
    INSERT INTO sync_courier_tags (group_id, provider, courier_hash, tag, action, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, provider, courier_hash, tag)
    DO UPDATE SET action = excluded.action, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).run(groupId, row.provider, row.courier_hash, row.tag, row.action, installationId);
}

module.exports = { sanitizeCourierTag, applyCourierTag };
