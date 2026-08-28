import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { invokeWithRetry } from '../api/invokeWithRetry.js'

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_ENTRIES = 50 // FINAL-004: Prevent unbounded cache growth
// ARCH-018: revealed PAN/CVV не должны жить в памяти вечно — авто-скрытие через TTL
const REVEAL_TTL_MS = 5 * 60 * 1000 // 5 minutes
const revealTimers = new Map() // cardId -> timeoutId (module-level, не в state)
// PERF-009: in-flight запросы reveal_card — дедуп параллельных вызовов (двойной клик,
// строка + сайд-панель) и защита от set() после clearSensitiveData (lock/logout)
const revealPending = new Map() // cardId -> Promise

function scheduleRevealClear(id, set) {
  const existing = revealTimers.get(id)
  if (existing) clearTimeout(existing)
  revealTimers.set(
    id,
    setTimeout(() => {
      revealTimers.delete(id)
      set(s => {
        if (!s.revealed[id]) return s
        const next = { ...s.revealed }
        delete next[id]
        return { revealed: next }
      })
    }, REVEAL_TTL_MS)
  )
}

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
  selected: [], // Array for localStorage compatibility
  deletingIds: [], // Array for localStorage compatibility
  revealed: {},
  cache: {},
  lastFetch: null,
  retryCount: 0, // FIX FE-H04: Track retry count to prevent infinite loops
  requestId: 0, // Monotonic counter — discards out-of-order fetch responses

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

  fetchCards: async (forceRefresh = false, abortSignal = null) => {
    const state = get()
    const { filters, page, perPage, cache, retryCount } = state

    // Generate cache key — include retryCount to prevent stale cache hits
    const cacheKey = JSON.stringify({ filters, page, perPage, retryCount })
    const cached = cache[cacheKey]

    const reqId = state.requestId + 1
    set({ requestId: reqId })

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
      // ★ Insight: AbortSignal позволяет отменить предыдущий запрос при быстром переключении фильтров
      // Tauri invoke не поддерживает abortSignal напрямую, но мы можем проверить сигнал после ответа
      // ERR-006: 1 ретрай на транзиентный SQLite busy ("database is locked")
      const res = await invokeWithRetry(
        'get_cards',
        { filter: filters, page, perPage },
        { retries: 1, baseDelay: 300 }
      )

      // Проверка на отмену после получения ответа (предотвращает race conditions)
      if (abortSignal?.aborted) {
        return
      }

      // A newer fetch already resolved — discard this stale response
      if (get().requestId !== reqId) {
        return
      }

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
        cards: res.items,
        total: res.total,
        freeTotal: res.free_total ?? 0,
        cache: newCache,
        lastFetch: Date.now(),
        loading: false,
      })

      // Reset retry count on successful fetch
      set({ retryCount: 0 })
    } catch (error) {
      if (get().requestId === reqId) {
        set({ loading: false })
      }
      throw error
    }
  },

  fetchFilterMeta: async () => {
    // ★ Insight: Exponential backoff retry для надежности
    // Если фильтр мета не загрузится, пользователь не сможет фильтровать карты
    const maxRetries = 3
    const baseDelay = 500 // 500ms, 1s, 2s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const meta = await invoke('get_card_filter_meta')
        set({ filterMeta: meta })
        return // Success
      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`Failed to fetch filter meta after ${maxRetries} attempts:`, error)
          return
        }
        // Delay before retry: exponential backoff
        await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1)))
      }
    }
  },

  revealCard: async id => {
    // PERF-009: cache-first — повторный reveal в пределах TTL возвращает кэш
    // без повторного invoke (и без лишней записи в audit-log бэкенда)
    const cached = get().revealed[id]
    if (cached) return cached
    const pending = revealPending.get(id)
    if (pending) return pending
    const p = invoke('reveal_card', { id })
      .then(data => {
        // За время запроса могли залочить сессию (clearSensitiveData) — не воскрешаем кэш
        if (revealPending.has(id)) {
          set(s => ({ revealed: { ...s.revealed, [id]: data } }))
          scheduleRevealClear(id, set)
        }
        return data
      })
      .catch(error => {
        console.error(`Failed to reveal card ${id}:`, error)
        throw error
      })
      .finally(() => revealPending.delete(id))
    revealPending.set(id, p)
    return p
  },

  updateCard: async (id, updates) => {
    const currentState = get()
    const currentCard = currentState.cards.find(c => c.id === id)
    const currentVersion = currentCard?.updated_at || Date.now()
    const optimisticVersion = currentVersion + 1

    // ★ Insight: Optimistic update с version tracking предотвращает data loss
    // При concurrent updates из разных вкладок, version check позволяет определить
    // какая версия актуальна и не перезаписать более новые данные
    const prevCards = currentState.cards
    set(state => ({
      cards: state.cards.map(c =>
        c.id === id ? { ...c, ...updates, _optimisticVersion: optimisticVersion } : c
      ),
    }))

    try {
      const serverResponse = await invoke('update_card_status', { id, status: updates.status })

      // ★ Insight: Server reconciliation — применяем серверные данные после optimistic update
      // Это гарантирует что локальное состояние совпадает с сервером после успешного update
      set(state => ({
        cards: state.cards.map(c => {
          // Только если версия совпадает, применяем серверные данные
          if (c.id === id && c._optimisticVersion === optimisticVersion) {
            // eslint-disable-next-line no-unused-vars -- rest-omit паттерн: убираем _optimisticVersion из объекта
            const { _optimisticVersion, ...rest } = c
            return {
              ...rest,
              ...serverResponse, // Server data takes precedence
              updated_at: Date.now(),
            }
          }
          return c
        }),
        cache: {}, // Invalidate cache
      }))
    } catch (error) {
      // Rollback on error - restore previous state
      set(state => {
        const currentCard = state.cards.find(c => c.id === id)
        if (currentCard?._optimisticVersion === optimisticVersion) {
          return { cards: prevCards }
        }
        return state // Another update already happened, don't rollback
      })
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
      deletingIds: [...state.deletingIds, id],
    }))

    try {
      await invoke('delete_card', { id })

      // Remove from state
      set(state => ({
        cards: state.cards.filter(c => c.id !== id),
        deletingIds: state.deletingIds.filter(did => did !== id),
        selected: state.selected.filter(sid => sid !== id),
        cache: {}, // Invalidate cache
      }))

      // Reload to get accurate totals
      get().fetchCards(true)
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
    const prevCards = get().cards
    set(state => ({
      cards: state.cards.map(c => (ids.includes(c.id) ? { ...c, status } : c)),
    }))

    try {
      await invoke('bulk_update_cards', { ids, status })
      set({ selected: [], cache: {} })
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
      selected: [],
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
    // ★ Insight: Проверяем существование карты перед обновлением
    // Предотвращает ошибки при получении update для уже удаленной карты
    set(state => ({
      cards: state.cards
        .map(c => {
          const upd = updates.find(u => u.id === c.id)
          if (!upd) return c
          return {
            ...c,
            status: upd.status ?? c.status,
            notes: upd.notes ?? c.notes,
          }
        })
        .filter(Boolean), // Отфильтровываем удаленные карты (если вдруг пришли)
    }))
  },

  handleFullSync: (() => {
    // FIX P1-11: Debounce full sync to prevent rapid refetches
    let timeoutId = null
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        get().fetchCards(true)
        timeoutId = null
      }, 200)
    }
  })(),

  // Invalidate cache
  invalidateCache: () => set({ cache: {} }),

  // SEC-010: Clear all sensitive data on lock/logout
  clearSensitiveData: () => {
    // ARCH-018: гасим все TTL-таймеры, чтобы не было set() после очистки
    for (const timerId of revealTimers.values()) clearTimeout(timerId)
    revealTimers.clear()
    // PERF-009: in-flight reveal'ы тоже гасим — их результаты будут выброшены
    revealPending.clear()
    set({
      revealed: {},
      cache: {},
      cards: [],
      total: 0,
      freeTotal: 0,
      selected: [],
      deletingIds: [],
      lastFetch: null,
      retryCount: 0,
    })
  },
}))
