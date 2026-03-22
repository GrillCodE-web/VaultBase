import { vi } from 'vitest'

/**
 * Mock Tauri invoke responses
 */
export const mockTauriResponses = {
  get_cards: () => ({
    cards: [],
    total: 0,
  }),
  get_orders: () => ({
    orders: [],
    total: 0,
  }),
  get_stats: () => ({
    total_cards: 0,
    free_cards: 0,
    in_use_cards: 0,
    dead_cards: 0,
    total_orders: 0,
    total_revenue: 0,
  }),
}

/**
 * Mock clipboard API
 */
export const mockClipboard = {
  writeText: vi.fn(() => Promise.resolve()),
  readText: vi.fn(() => Promise.resolve('')),
}

/**
 * Mock localStorage
 */
export const mockLocalStorage = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn(key => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()
