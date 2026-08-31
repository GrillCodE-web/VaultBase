import { safeGetJSON, safeSetJSON } from './localStorage'

const LS_KEY = 'vb_order_presets_v1'
const MAX_PRESETS = 20

/**
 * REDESIGN-05-4 (порция 4): шаблоны ордеров «магазин + профиль + дроп»
 * (не путать с backend-шаблонами items save_order_template — те про список
 * товаров). Хранятся локально, применяются из ⌘K: палитра диспатчит
 * APPLY_ORDER_PRESET_EVENT, страница Orders открывает CreateOrderModal
 * с предзаполнением.
 *
 * preset: { id, name, profile_id, profile_label, shop_id, shop_domain,
 *           shop_name, drop_id, created_at }
 */
export const APPLY_ORDER_PRESET_EVENT = 'vb:apply-order-preset'

export function getOrderPresets() {
  const list = safeGetJSON(LS_KEY, [])
  return Array.isArray(list) ? list : []
}

export function saveOrderPreset(preset) {
  const list = getOrderPresets()
  const withMeta = { ...preset, id: Date.now(), created_at: new Date().toISOString() }
  list.unshift(withMeta)
  safeSetJSON(LS_KEY, list.slice(0, MAX_PRESETS))
  return withMeta
}

export function deleteOrderPreset(id) {
  safeSetJSON(
    LS_KEY,
    getOrderPresets().filter(p => p.id !== id)
  )
}
