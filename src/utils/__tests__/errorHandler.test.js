import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleError, getErrorMessage } from '../errorHandler.js'

describe('Error Handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Set to production mode for testing
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env.NODE_ENV = 'test'
  })

  describe('handleError', () => {
    it('handles NetworkError', () => {
      const result = handleError('Network connection failed')
      expect(result.type).toBe('NetworkError')
      expect(result.code).toBe('NETWORK_ERROR')
    })

    it('handles NotFoundError', () => {
      const result = handleError('Resource not_found')
      expect(result.type).toBe('NotFoundError')
      expect(result.code).toBe('NOT_FOUND')
    })

    it('handles ValidationError', () => {
      const result = handleError('Validation failed: invalid email')
      expect(result.type).toBe('ValidationError')
      expect(result.code).toBe('VALIDATION_ERROR')
    })

    it('handles AuthenticationError', () => {
      const result = handleError('auth failed')
      expect(result.type).toBe('AuthenticationError')
      expect(result.code).toBe('AUTH_ERROR')
    })

    it('handles DatabaseError', () => {
      const result = handleError('sqlite error: table locked')
      expect(result.type).toBe('DatabaseError')
      expect(result.code).toBe('DATABASE_ERROR')
    })

    it('handles EncryptionError', () => {
      const result = handleError('decrypt failed: wrong password')
      expect(result.type).toBe('EncryptionError')
      expect(result.code).toBe('ENCRYPTION_ERROR')
    })

    it('handles unknown errors', () => {
      const result = handleError('Something weird happened')
      expect(result.type).toBe('Error')
      expect(result.code).toBe('UNKNOWN_ERROR')
    })

    it('includes context in error result', () => {
      const result = handleError('Error', 'Cards.fetchCards')
      expect(result.context).toBe('Cards.fetchCards')
    })

    it('logs sanitized message in production', () => {
      handleError('Failed for card 4111111111111111', 'TestContext')
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext]'),
        expect.stringContaining('XXXX-XXXX-XXXX-XXXX')
      )
    })

    it('logs full error in development', () => {
      process.env.NODE_ENV = 'development'
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const fullError = new Error('Test error')
      handleError(fullError, 'TestContext')
      expect(console.error).toHaveBeenCalled()
      process.env.NODE_ENV = 'production'
    })
  })

  describe('getErrorMessage', () => {
    it('extracts message from Error object', () => {
      const error = new Error('Test message')
      expect(getErrorMessage(error)).toBe('Test message')
    })

    it('returns string as-is', () => {
      expect(getErrorMessage('Direct string')).toBe('Direct string')
    })

    it('extracts message from formatted error object', () => {
      const formattedError = { message: 'Formatted error', type: 'Error' }
      expect(getErrorMessage(formattedError)).toBe('Formatted error')
    })

    it('returns fallback for unknown types', () => {
      expect(getErrorMessage(null)).toBe('Произошла непредвиденная ошибка.')
      expect(getErrorMessage(undefined)).toBe('Произошла непредвиденная ошибка.')
      expect(getErrorMessage(123)).toBe('Произошла непредвиденная ошибка.')
    })
  })

  describe('Error classification patterns', () => {
    it('classifies fetch errors as NetworkError', () => {
      const result = handleError('fetch failed: network error')
      expect(result.type).toBe('NetworkError')
    })

    it('classifies connection errors as NetworkError', () => {
      const result = handleError('connection timeout')
      expect(result.type).toBe('NetworkError')
    })

    it('classifies unauthorized as AuthenticationError', () => {
      const result = handleError('unauthorized access')
      expect(result.type).toBe('AuthenticationError')
    })

    it('classifies unlock errors as AuthenticationError', () => {
      const result = handleError('unlock failed')
      expect(result.type).toBe('AuthenticationError')
    })

    it('classifies SQL errors as DatabaseError', () => {
      const result = handleError('sql execution failed')
      expect(result.type).toBe('DatabaseError')
    })

    it('classifies crypto errors as EncryptionError', () => {
      const result = handleError('crypto operation failed')
      expect(result.type).toBe('EncryptionError')
    })
  })
})
