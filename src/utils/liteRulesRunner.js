import { invoke } from '@tauri-apps/api/core'
import { useLiteRulesStore } from '../store/liteRules.js'
import { useNotificationsStore } from '../store/notifications.js'
import { handleError } from './errorHandler.js'

const EMPTY_FILTER = { status: null, shop_id: null, profile_id: null, card_id: null, search: null }

/** БД хранит UTC 'YYYY-MM-DD HH:MM:SS' — парсим как UTC (как fmtDate). */
function parseDbUtc(s) {
  if (!s) return null
  const iso = String(s).includes('T') ? String(s) : String(s).replace(' ', 'T')
  const withTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z'
  const d = new Date(withTz)
  return isNaN(d.getTime()) ? null : d
}

/**
 * REDESIGN-05-4 (порция 3): оценка lite-правил. Дёргает существующие команды
 * (get_orders по статусам, get_expiring_cards_dashboard), обновляет подсветку
 * строк в liteRules-сторе и шлёт уведомления в центр (дедуп: раз в день на
 * цель через key).
 */
export async function runLiteRules(t) {
  const { rules, setHighlights } = useLiteRulesStore.getState()
  const active = Object.fromEntries(rules.filter(r => r.enabled).map(r => [r.id, r]))
  const highlights = { orders: {}, cards: {} }
  if (Object.keys(active).length === 0) {
    setHighlights(highlights)
    return
  }

  const now = Date.now()
  const dayKey = new Date().toISOString().slice(0, 10)
  const notify = (ruleId, targetId, title, body) =>
    useNotificationsStore.getState().add({
      kind: 'system',
      severity: 'warning',
      title,
      body,
      key: `lite:${ruleId}:${targetId}:${dayKey}`,
    })

  const jobs = []

  if (active.order_pending) {
    const rule = active.order_pending
    jobs.push(
      invoke('get_orders', {
        filter: { ...EMPTY_FILTER, status: 'pending' },
        page: 1,
        perPage: 500,
      })
        .then(res => {
          const limitMs = rule.threshold * 3_600_000
          let count = 0
          for (const o of res?.items || []) {
            const created = parseDbUtc(o.created_at)
            if (created && now - created.getTime() > limitMs) {
              highlights.orders[o.id] = 'order_pending'
              count++
            }
          }
          if (count > 0) {
            notify(
              'order_pending',
              'all',
              t('rule_notify_pending_title'),
              t('rule_notify_pending_body', { n: count, h: rule.threshold })
            )
          }
        })
        .catch(e => handleError(e, 'liteRules.order_pending'))
    )
  }

  if (active.order_no_tracking) {
    const rule = active.order_no_tracking
    jobs.push(
      invoke('get_orders', {
        filter: { ...EMPTY_FILTER, status: 'shipped' },
        page: 1,
        perPage: 300,
      })
        .then(res => {
          const limitMs = rule.threshold * 3_600_000
          for (const o of res?.items || []) {
            if (o.tracking_number) continue
            const changed = parseDbUtc(o.updated_at) || parseDbUtc(o.created_at)
            if (changed && now - changed.getTime() > limitMs) {
              highlights.orders[o.id] = 'order_no_tracking'
            }
          }
        })
        .catch(e => handleError(e, 'liteRules.order_no_tracking'))
    )
  }

  if (active.shop_decline_streak) {
    const rule = active.shop_decline_streak
    jobs.push(
      invoke('get_orders', { filter: EMPTY_FILTER, page: 1, perPage: 300 })
        .then(res => {
          const byShop = new Map()
          // get_orders отдаёт новые первыми — считаем серию деклайнов «с головы»
          for (const o of res?.items || []) {
            const key = o.shop_id ?? o.shop_name
            if (key == null) continue
            if (!byShop.has(key)) {
              byShop.set(key, { name: o.shop_name || `#${key}`, streak: 0, counting: true })
            }
            const agg = byShop.get(key)
            if (!agg.counting) continue
            if (o.status === 'declined') agg.streak++
            else agg.counting = false
          }
          for (const [key, agg] of byShop) {
            if (agg.streak >= rule.threshold) {
              notify(
                'shop_decline_streak',
                key,
                t('rule_notify_streak_title'),
                t('rule_notify_streak_body', { shop: agg.name, n: agg.streak })
              )
            }
          }
        })
        .catch(e => handleError(e, 'liteRules.shop_decline_streak'))
    )
  }

  if (active.card_expiring) {
    const rule = active.card_expiring
    jobs.push(
      invoke('get_expiring_cards_dashboard', { days: rule.threshold })
        .then(cards => {
          for (const c of cards || []) {
            highlights.cards[c.id] = 'card_expiring'
          }
          if ((cards || []).length > 0) {
            notify(
              'card_expiring',
              'all',
              t('rule_notify_expiring_title'),
              t('rule_notify_expiring_body', { n: cards.length, d: rule.threshold })
            )
          }
        })
        .catch(e => handleError(e, 'liteRules.card_expiring'))
    )
  }

  await Promise.all(jobs)
  setHighlights(highlights)
}
