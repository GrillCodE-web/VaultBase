import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCardsStore } from '../cards.js'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('useCardsStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useCardsStore.setState({
      cards: [],
      total: 0,
      freeTotal: 0,
      selected: [],
      deletingIds: [],
      revealed: {},
      cache: {},
      page: 1,
      perPage: 50,
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
    })
  })

  describe('Selection (array-based for localStorage compatibility)', () => {
    it('adds id to selection via toggleSelect', () => {
      useCardsStore.getState().toggleSelect('card-1')
      expect(useCardsStore.getState().selected).toContain('card-1')
    })

    it('removes id from selection via toggleSelect', () => {
      useCardsStore.getState().toggleSelect('card-1')
      useCardsStore.getState().toggleSelect('card-1')
      expect(useCardsStore.getState().selected).not.toContain('card-1')
    })

    it('selects all cards via toggleSelectAll', () => {
      useCardsStore.setState({ cards: [{ id: '1' }, { id: '2' }, { id: '3' }] })
      useCardsStore.getState().toggleSelectAll()
      expect(useCardsStore.getState().selected).toEqual(['1', '2', '3'])
    })

    it('clears selection via clearSelection', () => {
      useCardsStore.setState({ selected: ['1', '2', '3'] })
      useCardsStore.getState().clearSelection()
      expect(useCardsStore.getState().selected).toEqual([])
    })

    it('serializes to JSON correctly (localStorage compatibility)', () => {
      useCardsStore.getState().toggleSelect('card-1')
      useCardsStore.getState().toggleSelect('card-2')
      const state = useCardsStore.getState()
      const serialized = JSON.stringify({ selected: state.selected })
      const parsed = JSON.parse(serialized)
      expect(parsed.selected).toEqual(['card-1', 'card-2'])
    })
  })

  describe('Filters', () => {
    it('sets filters and resets page to 1', () => {
      useCardsStore.setState({ page: 5 })
      useCardsStore.getState().setFilters({ status: 'free' })
      expect(useCardsStore.getState().filters.status).toBe('free')
      expect(useCardsStore.getState().page).toBe(1)
    })

    it('resets all filters via resetFilters', () => {
      useCardsStore.getState().setFilters({ status: 'free', country: 'US' })
      useCardsStore.getState().resetFilters()
      expect(useCardsStore.getState().filters.status).toBeNull()
      expect(useCardsStore.getState().filters.country).toBeNull()
    })
  })

  describe('Deletion tracking (array-based)', () => {
    it('tracks deletingIds state', () => {
      useCardsStore.setState({ deletingIds: ['card-1', 'card-2'] })
      expect(useCardsStore.getState().deletingIds).toEqual(['card-1', 'card-2'])
    })

    it('serializes deletingIds to JSON correctly', () => {
      useCardsStore.setState({ deletingIds: ['1', '2', '3'] })
      const state = useCardsStore.getState()
      const serialized = JSON.stringify({ deletingIds: state.deletingIds })
      const parsed = JSON.parse(serialized)
      expect(parsed.deletingIds).toEqual(['1', '2', '3'])
    })
  })

  describe('Cache management', () => {
    it('invalidates cache', () => {
      useCardsStore.setState({ cache: { key: 'value' } })
      useCardsStore.getState().invalidateCache()
      expect(useCardsStore.getState().cache).toEqual({})
    })

    it('sets page number', () => {
      useCardsStore.getState().setPage(10)
      expect(useCardsStore.getState().page).toBe(10)
    })

    it('updates perPage via setState', () => {
      useCardsStore.setState({ perPage: 100 })
      expect(useCardsStore.getState().perPage).toBe(100)
    })
  })

  describe('Revealed cards', () => {
    it('stores revealed card data', () => {
      useCardsStore.setState({
        revealed: { 'card-1': { card_number: '****1234', cvv: '***' } },
      })
      expect(useCardsStore.getState().revealed['card-1']).toBeDefined()
    })
  })
})
