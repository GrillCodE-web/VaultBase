import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export const useCardsStore = create((set, get) => ({
  // State
  cards: [],
  total: 0,
  freeTotal: 0,
  loading: false,
  filters: {
    status: null,
    country: null,
    bank_name: null,
    source: null,
    card_type: null,
    search: null,
    state: null,
    zip_prefix: null,
    expiring_soon: null,
  },
  filterMeta: { countries: [], banks: [], sources: [] },
  page: 1,
  perPage: 50,
  selected: [], // Use array instead of Set for localStorage compatibility
  deletingIds: [], // Use array instead of Set for localStorage compatibility
  revealed: {},
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
        country: null,
        bank_name: null,
        source: null,
        card_type: null,
        search: null,
        state: null,
        zip_prefix: null,
        expiring_soon: null,
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
      if (state.selected.length === state.cards.length) {
        return { selected: [] }
      }
      return { selected: state.cards.map(c => c.id) }
    }),

  clearSelection: () => set({ selected: [] }),

  fetchCards: async (forceRefresh = false) => {
    const state = get()
    const { filters, page, perPage, cache } = state

    // Generate cache key
    const cacheKey = JSON.stringify({ filters, page, perPage })
    const cached = cache[cacheKey]

    // Return cached data if valid and not forcing refresh
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      set({
        cards: cached.data.items,
        total: cached.data.total,
        freeTotal: cached.data.free_total ?? 0,
      })
      return
    }

    set({ loading: true })

    try {
      const res = await invoke('get_cards', { filter: filters, page, perPage })

      // Update cache
      const newCache = { ...cache }
      newCache[cacheKey] = {
        data: res,
        timestamp: Date.now(),
      }

      set({
        cards: res.items,
        total: res.total,
        freeTotal: res.free_total ?? 0,
        cache: newCache,
        lastFetch: Date.now(),
        loading: false,
      })

      // Auto-reveal cards in background
      get().autoRevealBatch(res.items)

      // Handle empty page
      if (res.items.length === 0 && res.total > 0 && page > 1) {
        set({ page: Math.max(1, page - 1) })
        get().fetchCards(true)
      }
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  fetchFilterMeta: async () => {
    try {
      const meta = await invoke('get_card_filter_meta')
      set({ filterMeta: meta })
    } catch (error) {
      console.error('Failed to fetch filter meta:', error)
    }
  },

  autoRevealBatch: async cardList => {
    const state = get()
    const failedIds = []

    for (const card of cardList) {
      if (state.revealed[card.id]) continue
      try {
        const data = await invoke('reveal_card', { id: card.id })
        set(s => ({ revealed: { ...s.revealed, [card.id]: data } }))
      } catch (error) {
        failedIds.push(card.id)
        console.error(`Failed to reveal card ${card.id}:`, error)
      }
    }

    // Notify user about partial failure
    if (failedIds.length > 0) {
      console.warn(`Failed to reveal ${failedIds.length} cards`)
    }
  },

  updateCard: async (id, updates) => {
    // Optimistic update
    const prevCards = get().cards
    set(state => ({
      cards: state.cards.map(c => (c.id === id ? { ...c, ...updates } : c)),
    }))

    try {
      await invoke('update_card_status', { id, status: updates.status })
      // Invalidate cache
      set({ cache: {} })
    } catch (error) {
      // Rollback on error
      set({ cards: prevCards })
      throw error
    }
  },

  updateCardNotes: async (id, notes) => {
    // Optimistic update
    const prevCards = get().cards
    set(state => ({
      cards: state.cards.map(c => (c.id === id ? { ...c, notes } : c)),
    }))

    try {
      await invoke('update_card_notes', { id, notes })
    } catch (error) {
      // Rollback on error
      set({ cards: prevCards })
      throw error
    }
  },

  deleteCard: async id => {
    // Mark as deleting
    set(state => ({
      deletingIds: new Set([...state.deletingIds, id]),
    }))

    try {
      await invoke('delete_card', { id })

      // Remove from state
      set(state => ({
        cards: state.cards.filter(c => c.id !== id),
        deletingIds: new Set([...state.deletingIds].filter(did => did !== id)),
        selected: new Set([...state.selected].filter(sid => sid !== id)),
        cache: {}, // Invalidate cache
      }))

      // Reload to get accurate totals
      get().fetchCards(true)
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
    const prevCards = get().cards
    set(state => ({
      cards: state.cards.map(c => (ids.includes(c.id) ? { ...c, status } : c)),
    }))

    try {
      await invoke('bulk_update_cards', { ids, status })
      set({ selected: new Set(), cache: {} })
    } catch (error) {
      // Rollback on error
      set({ cards: prevCards })
      throw error
    }
  },

  bulkDelete: async ids => {
    await invoke('bulk_delete_cards', { ids })

    // Remove from state
    set(state => ({
      cards: state.cards.filter(c => !ids.includes(c.id)),
      selected: new Set(),
      cache: {}, // Invalidate cache
    }))

    // Reload to get accurate totals
    get().fetchCards(true)
  },

  bulkEnrich: async (ids, onProgress) => {
    let enriched = 0
    const total = ids.length

    for (const id of ids) {
      try {
        await invoke('enrich_bin', { id })
        enriched++
      } catch {
        // BIN enrichment failed for this card
      }
      if (onProgress) {
        onProgress({ done: enriched, total })
      }
    }

    // Reload cards to show enriched data
    get().fetchCards(true)

    return { enriched, total }
  },

  exportCards: async (ids, format) => {
    const content = await invoke('export_cards', { ids, format })
    return content
  },

  // Real-time sync handlers
  handleSyncUpdate: updates => {
    set(state => ({
      cards: state.cards.map(c => {
        const upd = updates.find(u => u.id === c.id)
        if (!upd) return c
        return {
          ...c,
          status: upd.status ?? c.status,
          notes: upd.notes ?? c.notes,
        }
      }),
    }))
  },

  handleFullSync: () => {
    get().fetchCards(true)
  },

  // Invalidate cache
  invalidateCache: () => set({ cache: {} }),
}))
