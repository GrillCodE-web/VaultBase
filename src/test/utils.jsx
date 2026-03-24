import { render } from '@testing-library/react'
import { vi } from 'vitest'

/**
 * Custom render function with common providers
 * Add providers here as needed (Router, Context, etc.)
 */
export function renderWithProviders(ui, options = {}) {
  return render(ui, { ...options })
}

/**
 * Create mock card data for testing
 */
export function createMockCard(overrides = {}) {
  return {
    id: 'test-card-id',
    bin: '123456',
    last4: '7890',
    expiry_date: '12/25',
    holder_name: 'John Doe',
    country: 'US',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    status: 'free',
    orders_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Create mock order data for testing
 */
export function createMockOrder(overrides = {}) {
  return {
    id: 'test-order-id',
    card_id: 'test-card-id',
    domain: 'example.com',
    amount: 99.99,
    status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Mock Tauri invoke with custom responses
 */
export function mockTauriInvoke(responses = {}) {
  return vi.fn((cmd, args) => {
    if (responses[cmd]) {
      return Promise.resolve(responses[cmd](args))
    }
    return Promise.resolve(null)
  })
}

// eslint-disable-next-line react-refresh/only-export-components -- Test utilities re-export
export * from '@testing-library/react'
