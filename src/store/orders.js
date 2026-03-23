import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export const useOrdersStore = create((set, get) => ({
  // State
  orders: [],
  total: 0,
  loading: false,
  filters: {
    status: null,
    shop_id: null,
    profile_id: null,
    card_id: null,
    search: null,
  },
  page: 1,
  perPage: 50,
  selected: new Set(),
  deletingIds: new Set(),
  cache: {},
  lastFetch: null,

  // Actions
  setPage: page => set({ page }),

  setFilters: filters =>
    set(state => ({
      filters: { ...state.filters, ...filters },
      page: 1, // Reset to page 1 when filters change
    })),

  resetFilters: () =>
    set({
      filters: {
        status: null,
        shop_id: null,
        profile_id: null,
        card_id: null,
        search: null,
      },
      page: 1,
    }),

  toggleSelect: id =>
    set(state => {
      const newSelected = new Set(state.selected)
      if (newSelected.has(id)) {
        newSelected.delete(id)
      } else {
        newSelected.add(id)
      }
      return { selected: newSelected }
    }),

  toggleSelectAll: () =>
    set(state => {
      if (state.selected.size === state.orders.length) {
        return { selected: new Set() }
      }
      return { selected: new Set(state.orders.map(o => o.id)) }
    }),

  clearSelection: () => set({ selected: new Set() }),

  fetchOrders: async (forceRefresh = false) => {
    const state = get()
    const { filters, page, perPage, cache } = state

    // Generate cache key
    const cacheKey = JSON.stringify({ filters, page, perPage })
    const cached = cache[cacheKey]

    // Return cached data if valid and not forcing refresh
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      set({
        orders: cached.data.items,
        total: cached.data.total,
      })
      return
    }

    set({ loading: true })

    try {
      const res = await invoke('get_orders', { filter: filters, page, perPage })

      // Update cache
      const newCache = { ...cache }
      newCache[cacheKey] = {
        data: res,
        timestamp: Date.now(),
      }

      set({
        orders: res.items,
        total: res.total,
        cache: newCache,
        lastFetch: Date.now(),
        loading: false,
      })

      // Handle empty page
      if (res.items.length === 0 && res.total > 0 && page > 1) {
        set({ page: Math.max(1, page - 1) })
        get().fetchOrders(true)
      }
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  updateOrder: async (id, updates) => {
    // Optimistic update
    const prevOrders = get().orders
    set(state => ({
      orders: state.orders.map(o => (o.id === id ? { ...o, ...updates } : o)),
    }))

    try {
      await invoke('update_order_status', {
        id,
        status: updates.status,
        meta: updates.meta || null,
      })
      // Invalidate cache
      set({ cache: {} })
    } catch (error) {
      // Rollback on error
      set({ orders: prevOrders })
      throw error
    }
  },

  deleteOrder: async id => {
    // Mark as deleting
    set(state => ({
      deletingIds: new Set([...state.deletingIds, id]),
    }))

    try {
      await invoke('delete_order', { id })

      // Remove from state
      set(state => ({
        orders: state.orders.filter(o => o.id !== id),
        deletingIds: new Set([...state.deletingIds].filter(did => did !== id)),
        selected: new Set([...state.selected].filter(sid => sid !== id)),
        cache: {}, // Invalidate cache
      }))

      // Reload to get accurate totals
      get().fetchOrders(true)
    } catch (error) {
      // Remove deleting flag on error
      set(state => ({
        deletingIds: new Set([...state.deletingIds].filter(did => did !== id)),
      }))
      throw error
    }
  },

  undoDelete: id => {
    set(state => ({
      deletingIds: new Set([...state.deletingIds].filter(did => did !== id)),
    }))
  },

  bulkUpdateStatus: async (ids, status) => {
    // Optimistic update
    const prevOrders = get().orders
    set(state => ({
      orders: state.orders.map(o => (ids.includes(o.id) ? { ...o, status } : o)),
    }))

    try {
      await invoke('bulk_update_orders', { ids, status })
      set({ selected: new Set(), cache: {} })
    } catch (error) {
      // Rollback on error
      set({ orders: prevOrders })
      throw error
    }
  },

  bulkDelete: async ids => {
    await invoke('bulk_delete_orders', { ids })

    // Remove from state
    set(state => ({
      orders: state.orders.filter(o => !ids.includes(o.id)),
      selected: new Set(),
      cache: {}, // Invalidate cache
    }))

    // Reload to get accurate totals
    get().fetchOrders(true)
  },

  // Invalidate cache
  invalidateCache: () => set({ cache: {} }),
}))
