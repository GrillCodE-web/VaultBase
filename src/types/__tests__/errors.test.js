import { describe, it, expect } from 'vitest'
import {
  NetworkError,
  ValidationError,
  AuthenticationError,
  DatabaseError,
  EncryptionError,
  NotFoundError,
} from '../errors.js'

describe('Custom Error Types', () => {
  describe('NetworkError', () => {
    it('creates error with correct properties', () => {
      const error = new NetworkError('Connection failed', { url: '/api/test' })

      expect(error.name).toBe('NetworkError')
      expect(error.message).toBe('Connection failed')
      expect(error.code).toBe('NETWORK_ERROR')
      expect(error.details).toEqual({ url: '/api/test' })
      expect(error instanceof Error).toBe(true)
    })

    it('has empty details when not provided', () => {
      const error = new NetworkError('Connection failed')
      expect(error.details).toEqual({})
    })

    it('serializes to JSON correctly', () => {
      const error = new NetworkError('Connection failed', { url: '/api' })
      const serialized = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details,
      })
      const parsed = JSON.parse(serialized)
      expect(parsed.name).toBe('NetworkError')
      expect(parsed.message).toBe('Connection failed')
      expect(parsed.code).toBe('NETWORK_ERROR')
    })
  })

  describe('ValidationError', () => {
    it('creates error with correct properties', () => {
      const error = new ValidationError('Invalid email', { field: 'email' })

      expect(error.name).toBe('ValidationError')
      expect(error.message).toBe('Invalid email')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.details).toEqual({ field: 'email' })
    })
  })

  describe('AuthenticationError', () => {
    it('creates error with correct properties', () => {
      const error = new AuthenticationError('Token expired', { token: 'abc123' })

      expect(error.name).toBe('AuthenticationError')
      expect(error.message).toBe('Token expired')
      expect(error.code).toBe('AUTH_ERROR')
      expect(error.details).toEqual({ token: 'abc123' })
    })
  })

  describe('DatabaseError', () => {
    it('creates error with correct properties', () => {
      const error = new DatabaseError('Query failed', { query: 'SELECT *' })

      expect(error.name).toBe('DatabaseError')
      expect(error.message).toBe('Query failed')
      expect(error.code).toBe('DATABASE_ERROR')
      expect(error.details).toEqual({ query: 'SELECT *' })
    })
  })

  describe('EncryptionError', () => {
    it('creates error with correct properties', () => {
      const error = new EncryptionError('Decryption failed', { algorithm: 'AES-256-GCM' })

      expect(error.name).toBe('EncryptionError')
      expect(error.message).toBe('Decryption failed')
      expect(error.code).toBe('ENCRYPTION_ERROR')
      expect(error.details).toEqual({ algorithm: 'AES-256-GCM' })
    })
  })

  describe('NotFoundError', () => {
    it('creates error with correct properties', () => {
      const error = new NotFoundError('Resource not found', { id: '123' })

      expect(error.name).toBe('NotFoundError')
      expect(error.message).toBe('Resource not found')
      expect(error.code).toBe('NOT_FOUND')
      expect(error.details).toEqual({ id: '123' })
    })
  })

  describe('Error type guards (manual)', () => {
    it('identifies NetworkError by name', () => {
      const error = new NetworkError('test')
      expect(error.name).toBe('NetworkError')
      expect(error.code).toBe('NETWORK_ERROR')
    })

    it('identifies ValidationError by name', () => {
      const error = new ValidationError('test')
      expect(error.name).toBe('ValidationError')
      expect(error.code).toBe('VALIDATION_ERROR')
    })

    it('identifies AuthenticationError by name', () => {
      const error = new AuthenticationError('test')
      expect(error.name).toBe('AuthenticationError')
      expect(error.code).toBe('AUTH_ERROR')
    })
  })

  describe('Error inheritance', () => {
    it('all custom errors extend Error', () => {
      expect(new NetworkError('')).toBeInstanceOf(Error)
      expect(new ValidationError('')).toBeInstanceOf(Error)
      expect(new AuthenticationError('')).toBeInstanceOf(Error)
      expect(new DatabaseError('')).toBeInstanceOf(Error)
      expect(new EncryptionError('')).toBeInstanceOf(Error)
      expect(new NotFoundError('')).toBeInstanceOf(Error)
    })

    it('preserves stack trace', () => {
      const error = new NetworkError('Test error')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('errors.test.js')
    })
  })
})
