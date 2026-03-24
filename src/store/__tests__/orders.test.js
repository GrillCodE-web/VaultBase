import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOrdersStore } from '../orders.js'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('useOrdersStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useOrdersStore.setState({
      orders: [],
      total: 0,
      selected: [],
      deletingIds: [],
      cache: {},
      page: 1,
      perPage: 50,
      filters: {
        status: null,
        shop_id: null,
        profile_id: null,
        card_id: null,
        search: null,
      },
    })
  })

  describe('Selection (array-based for localStorage compatibility)', () => {
    it('adds id to selection via toggleSelect', () => {
      useOrdersStore.getState().toggleSelect('order-1')
      expect(useOrdersStore.getState().selected).toContain('order-1')
    })

    it('removes id from selection via toggleSelect', () => {
      useOrdersStore.getState().toggleSelect('order-1')
      useOrdersStore.getState().toggleSelect('order-1')
      expect(useOrdersStore.getState().selected).not.toContain('order-1')
    })

    it('selects all orders via toggleSelectAll', () => {
      useOrdersStore.setState({ orders: [{ id: '1' }, { id: '2' }, { id: '3' }] })
      useOrdersStore.getState().toggleSelectAll()
      expect(useOrdersStore.getState().selected).toEqual(['1', '2', '3'])
    })

    it('clears selection via clearSelection', () => {
      useOrdersStore.setState({ selected: ['1', '2', '3'] })
      useOrdersStore.getState().clearSelection()
      expect(useOrdersStore.getState().selected).toEqual([])
    })

    it('serializes to JSON correctly (localStorage compatibility)', () => {
      useOrdersStore.getState().toggleSelect('order-1')
      useOrdersStore.getState().toggleSelect('order-2')
      const state = useOrdersStore.getState()
      const serialized = JSON.stringify({ selected: state.selected })
      const parsed = JSON.parse(serialized)
      expect(parsed.selected).toEqual(['order-1', 'order-2'])
    })
  })

  describe('Filters', () => {
    it('sets filters and resets page to 1', () => {
      useOrdersStore.setState({ page: 5 })
      useOrdersStore.getState().setFilters({ status: 'pending' })
      expect(useOrdersStore.getState().filters.status).toBe('pending')
      expect(useOrdersStore.getState().page).toBe(1)
    })

    it('resets all filters via resetFilters', () => {
      useOrdersStore.getState().setFilters({ status: 'pending', shop_id: 'shop-1' })
      useOrdersStore.getState().resetFilters()
      expect(useOrdersStore.getState().filters.status).toBeNull()
      expect(useOrdersStore.getState().filters.shop_id).toBeNull()
    })
  })

  describe('Deletion tracking (array-based)', () => {
    it('tracks deletingIds state', () => {
      useOrdersStore.setState({ deletingIds: ['order-1', 'order-2'] })
      expect(useOrdersStore.getState().deletingIds).toEqual(['order-1', 'order-2'])
    })

    it('serializes deletingIds to JSON correctly', () => {
      useOrdersStore.setState({ deletingIds: ['1', '2', '3'] })
      const state = useOrdersStore.getState()
      const serialized = JSON.stringify({ deletingIds: state.deletingIds })
      const parsed = JSON.parse(serialized)
      expect(parsed.deletingIds).toEqual(['1', '2', '3'])
    })
  })

  describe('Cache management', () => {
    it('invalidates cache', () => {
      useOrdersStore.setState({ cache: { key: 'value' } })
      useOrdersStore.getState().invalidateCache()
      expect(useOrdersStore.getState().cache).toEqual({})
    })

    it('sets page number', () => {
      useOrdersStore.getState().setPage(10)
      expect(useOrdersStore.getState().page).toBe(10)
    })

    it('updates perPage via setState', () => {
      useOrdersStore.setState({ perPage: 100 })
      expect(useOrdersStore.getState().perPage).toBe(100)
    })
  })
})
