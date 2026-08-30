import { create } from 'zustand'
import { safeGetJSON, safeSetJSON } from '../utils/localStorage'

export const LITE_RULES_LS_KEY = 'vb_lite_rules_v1'

/**
 * REDESIGN-05-4 (порция 3): правила-автоматизации lite. Одна инстанция на
 * шаблон (без конструктора): включение + порог. Хранятся в localStorage.
 * target — куда вешается подсветка ('orders' | 'cards' | null).
 */
export const RULE_TEMPLATES = [
  {
    id: 'order_pending',
    unit: 'rules_unit_hours',
    defaultThreshold: 24,
    defaultEnabled: true,
    target: 'orders',
  },
  {
    id: 'shop_decline_streak',
    unit: 'rules_unit_count',
    defaultThreshold: 3,
    defaultEnabled: true,
    target: null, // действие — только уведомление
  },
  {
    id: 'card_expiring',
    unit: 'rules_unit_days',
    defaultThreshold: 14,
    defaultEnabled: false,
    target: 'cards',
  },
  {
    id: 'order_no_tracking',
    unit: 'rules_unit_hours',
    defaultThreshold: 12,
    defaultEnabled: false,
    target: 'orders',
  },
]

function defaultRules() {
  return RULE_TEMPLATES.map(tp => ({
    id: tp.id,
    enabled: tp.defaultEnabled,
    threshold: tp.defaultThreshold,
  }))
}

function loadRules() {
  const saved = safeGetJSON(LITE_RULES_LS_KEY)
  if (!Array.isArray(saved)) return defaultRules()
  // Мердж по id: новые шаблоны появляются с дефолтами, удалённые отпадают
  return RULE_TEMPLATES.map(tp => {
    const s = saved.find(r => r?.id === tp.id)
    return {
      id: tp.id,
      enabled: s?.enabled ?? tp.defaultEnabled,
      threshold:
        Number.isFinite(s?.threshold) && s.threshold > 0 ? s.threshold : tp.defaultThreshold,
    }
  })
}

export const useLiteRulesStore = create((set, get) => ({
  rules: loadRules(),
  // Подсветка строк: { orders: { [id]: ruleId }, cards: { [id]: ruleId } }
  highlights: { orders: {}, cards: {} },

  setRule: (id, patch) => {
    const rules = get().rules.map(r => (r.id === id ? { ...r, ...patch } : r))
    safeSetJSON(LITE_RULES_LS_KEY, rules)
    set({ rules })
  },

  setHighlights: highlights => set({ highlights }),
}))
