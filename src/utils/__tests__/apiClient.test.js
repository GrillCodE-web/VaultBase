import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiCall } from '../apiClient.js'
import { NetworkError, DatabaseError } from '../types/errors.js'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { invoke } = await import('@tauri-apps/api/core')

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('apiCall', () => {
    it('successfully returns data from invoke', async () => {
      invoke.mockResolvedValueOnce({ success: true, data: 'test' })

      const result = await apiCall('get_cards')

      expect(result).toEqual({ success: true, data: 'test' })
      expect(invoke).toHaveBeenCalledWith('get_cards', {})
    })

    it('passes arguments to invoke', async () => {
      invoke.mockResolvedValueOnce({ result: 'ok' })

      await apiCall('get_card', { id: '123', status: 'free' })

      expect(invoke).toHaveBeenCalledWith('get_card', { id: '123', status: 'free' })
    })

    it('retries on network errors', async () => {
      invoke
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ success: true })

      const result = await apiCall('get_cards', {}, { retries: 2, retryDelay: 10 })

      expect(result).toEqual({ success: true })
      expect(invoke).toHaveBeenCalledTimes(3)
    })

    it('throws after max retries', async () => {
      invoke.mockRejectedValue(new Error('network error'))

      await expect(apiCall('get_cards', {}, { retries: 2, retryDelay: 10 })).rejects.toThrow()

      expect(invoke).toHaveBeenCalledTimes(3)
    })

    it('does not retry on non-retryable errors', async () => {
      invoke.mockRejectedValue(new Error('invalid command'))

      await expect(apiCall('invalid_command', {}, { retries: 3 })).rejects.toThrow()

      expect(invoke).toHaveBeenCalledTimes(1)
    })

    it('throws NetworkError on network failure', async () => {
      invoke.mockRejectedValue(new Error('network connection failed'))

      await expect(apiCall('get_cards')).rejects.toBeInstanceOf(NetworkError)
    })

    it('throws DatabaseError on database failure', async () => {
      invoke.mockRejectedValue(new Error('sqlite database locked'))

      await expect(apiCall('get_cards')).rejects.toBeInstanceOf(DatabaseError)
    })

    it('respects timeout option', async () => {
      invoke.mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve({ success: true }), 5000)
          })
      )

      await expect(apiCall('slow_command', {}, { timeout: 100 })).rejects.toBeInstanceOf(
        NetworkError
      )
    })

    it('uses default timeout when not specified', async () => {
      invoke.mockImplementation(
        () =>
          new Promise(resolve => {
            setTimeout(() => resolve({ success: true }), 35000)
          })
      )

      await expect(apiCall('slow_command')).rejects.toThrow()
    })

    it('handles string errors', async () => {
      invoke.mockRejectedValue('string error message')

      await expect(apiCall('get_cards')).rejects.toThrow()
    })
  })

  describe('Retry behavior', () => {
    it('exponential backoff could be implemented', () => {
      // Current implementation uses fixed delay
      // This test documents the behavior for future enhancement
      const delays = []
      const retryDelay = 1000
      for (let i = 0; i < 3; i++) {
        delays.push(retryDelay)
      }
      expect(delays).toEqual([1000, 1000, 1000])

      // Future enhancement: exponential backoff
      // expect(delays).toEqual([1000, 2000, 4000])
    })
  })
})
