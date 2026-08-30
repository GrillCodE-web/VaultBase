import { create } from 'zustand'

let _nid = 0
const MAX_ITEMS = 100

/**
 * REDESIGN-05-4 (порция 2): центр уведомлений — тосты, новости менеджера
 * и sync-алерты в одном месте (иконка в топбаре). Источники пишут через
 * useNotificationsStore.getState().add(...); UI читает через хук.
 *
 * item: { id, key?, kind: 'toast'|'news'|'sync'|'system', severity,
 *         title, body?, ts, read }
 * key — для дедупликации (новости поллятся раз в минуту).
 */
export const useNotificationsStore = create(set => ({
  items: [],

  add: item => {
    if (!item?.title) return null
    let added = null
    set(s => {
      if (item.key && s.items.some(i => i.key === item.key)) return s
      added = { id: ++_nid, ts: Date.now(), read: false, severity: 'info', ...item }
      return { items: [added, ...s.items].slice(0, MAX_ITEMS) }
    })
    return added?.id ?? null
  },

  markRead: id => set(s => ({ items: s.items.map(i => (i.id === id ? { ...i, read: true } : i)) })),

  markAllRead: () => set(s => ({ items: s.items.map(i => ({ ...i, read: true })) })),

  clear: () => set({ items: [] }),
}))
