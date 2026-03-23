/**
 * Custom error classes for structured error handling
 */

export class NetworkError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'NetworkError'
    this.code = 'NETWORK_ERROR'
    this.details = details
  }
}

export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ValidationError'
    this.code = 'VALIDATION_ERROR'
    this.details = details
  }
}

export class AuthenticationError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = 'AUTH_ERROR'
    this.details = details
  }
}

export class DatabaseError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'DatabaseError'
    this.code = 'DATABASE_ERROR'
    this.details = details
  }
}

export class EncryptionError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'EncryptionError'
    this.code = 'ENCRYPTION_ERROR'
    this.details = details
  }
}

export class NotFoundError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'NotFoundError'
    this.code = 'NOT_FOUND'
    this.details = details
  }
}
