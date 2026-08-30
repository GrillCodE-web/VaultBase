import { safeGetJSON, safeSetJSON } from './localStorage'

/**
 * REDESIGN-05-4 (порция 1): «последние сущности» для ⌘K.
 * localStorage, max MAX записей, дедуп по type+id, свежие сверху.
 * entry: { type: 'card'|'order'|'profile'|'shop'|'email'|'proxy', id, label, sub? }
 */
const KEY = 'vb_recent_entities_v1'
const MAX = 8

export function getRecentEntities() {
  const list = safeGetJSON(KEY, [])
  return Array.isArray(list) ? list.filter(e => e && e.type && e.id != null) : []
}

export function recordRecentEntity(entry) {
  if (!entry || entry.id == null || !entry.type) return
  const rest = getRecentEntities().filter(
    e => !(e.type === entry.type && String(e.id) === String(entry.id))
  )
  rest.unshift({
    type: entry.type,
    id: entry.id,
    label: String(entry.label ?? ''),
    sub: String(entry.sub ?? ''),
    at: Date.now(),
  })
  safeSetJSON(KEY, rest.slice(0, MAX))
}
