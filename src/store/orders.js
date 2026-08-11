import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_ENTRIES = 50 // FINAL-004: Prevent unbounded cache growth

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
  selected: [], // Use array instead of Set for localStorage compatibility
  deletingIds: [], // Use array instead of Set for localStorage compatibility
  cache: {},
  lastFetch: null,

  // Actions
  setPage: page => set({ page }),

  setFilters: next =>
    set(state => ({
      filters: typeof next === 'function' ? next(state.filters) : { ...state.filters, ...next },
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
      const isSelected = state.selected.includes(id)
      return {
        selected: isSelected ? state.selected.filter(sid => sid !== id) : [...state.selected, id],
      }
    }),

  toggleSelectAll: () =>
    set(state => {
      if (state.selected.length === state.orders.length) {
        return { selected: [] }
      }
      return { selected: state.orders.map(o => o.id) }
    }),

  clearSelection: () => set({ selected: [] }),

  fetchOrders: async (forceRefresh = false) => {
    const state = get()
    const { filters, page, perPage, cache } = state

    // FINAL-007: Deterministic cache key — sort keys and normalize nulls
    const normalizedFilters = Object.keys(filters)
      .sort()
      .reduce((acc, k) => {
        acc[k] = filters[k] ?? null
        return acc
      }, {})
    const cacheKey = JSON.stringify({ f: normalizedFilters, p: page, pp: perPage })
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

      // FINAL-004: Evict oldest entries if cache is full
      const newCache = { ...cache }
      const cacheKeys = Object.keys(newCache)
      if (cacheKeys.length >= CACHE_MAX_ENTRIES) {
        const sorted = cacheKeys.sort(
          (a, b) => (newCache[a].timestamp || 0) - (newCache[b].timestamp || 0)
        )
        for (let i = 0; i < sorted.length - CACHE_MAX_ENTRIES + 1; i++) {
          delete newCache[sorted[i]]
        }
      }
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

  patchOrderLocal: (id, updates) => {
    set(state => ({
      orders: state.orders.map(o => (o.id === id ? { ...o, ...updates } : o)),
    }))
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
      deletingIds: [...state.deletingIds, id],
    }))

    try {
      await invoke('delete_order', { id })

      // Remove from state
      set(state => ({
        orders: state.orders.filter(o => o.id !== id),
        deletingIds: state.deletingIds.filter(did => did !== id),
        selected: state.selected.filter(sid => sid !== id),
        cache: {}, // Invalidate cache
      }))

      // Reload to get accurate totals
      get().fetchOrders(true)
    } catch (error) {
      // Remove deleting flag on error
      set(state => ({
        deletingIds: state.deletingIds.filter(did => did !== id),
      }))
      throw error
    }
  },

  undoDelete: id => {
    set(state => ({
      deletingIds: state.deletingIds.filter(did => did !== id),
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
      set({ selected: [], cache: {} })
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
      selected: [],
      cache: {}, // Invalidate cache
    }))

    // Reload to get accurate totals
    get().fetchOrders(true)
  },

  // Invalidate cache
  invalidateCache: () => set({ cache: {} }),

  // SEC-010: Clear all sensitive data on lock/logout + FINAL-004: cache size limit
  clearSensitiveData: () =>
    set({
      orders: [],
      total: 0,
      selected: [],
      deletingIds: [],
      cache: {},
      lastFetch: null,
    }),
}))
