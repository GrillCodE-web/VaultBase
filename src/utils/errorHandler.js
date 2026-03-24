import {
  NetworkError,
  ValidationError,
  AuthenticationError,
  DatabaseError,
  EncryptionError,
  NotFoundError,
} from '../types/errors.js'

// Check if running in production mode
/* eslint-disable-next-line no-undef */
const isDevelopment = process.env.NODE_ENV === 'development'

/**
 * Sanitize error message for production logging (remove sensitive data)
 * @param {Error|string} error - Error to sanitize
 * @returns {string} Sanitized error message
 */
function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  // Remove potential sensitive patterns (card numbers, emails, tokens)
  return message
    .replace(/\b\d{13,19}\b/g, 'XXXX-XXXX-XXXX-XXXX') // Card numbers
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]') // Emails
    .replace(/(token|key|secret|password|cvv)=\S+/gi, '$1=[REDACTED]') // Sensitive params
}

/**
 * Centralized error handler that identifies error types and formats messages
 * @param {Error|string} error - The error to handle
 * @param {string} context - Context where the error occurred (e.g., 'Cards.fetchCards')
 * @returns {Object} Formatted error object with type, message, and details
 */
export function handleError(error, context = '') {
  // Production-safe logging - sanitize sensitive data
  if (isDevelopment) {
    if (context) {
      console.error(`[${context}]`, error)
    } else {
      console.error(error)
    }
  } else {
    // Production: log only sanitized message
    const sanitized = sanitizeErrorMessage(error)
    if (context) {
      console.error(`[${context}]`, sanitized)
    } else {
      console.error(sanitized)
    }
  }

  // If it's already one of our custom errors, return formatted version
  if (
    error instanceof NetworkError ||
    error instanceof ValidationError ||
    error instanceof AuthenticationError ||
    error instanceof DatabaseError ||
    error instanceof EncryptionError ||
    error instanceof NotFoundError
  ) {
    return {
      type: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
      context,
    }
  }

  // Convert string errors to Error objects
  const err = typeof error === 'string' ? new Error(error) : error
  const message = err.message || String(error)

  // Classify error based on message content
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return {
      type: 'NetworkError',
      code: 'NETWORK_ERROR',
      message: 'Network connection failed. Please check your internet connection.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('not_found') || message.includes('not found')) {
    return {
      type: 'NotFoundError',
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('validation') || message.includes('invalid')) {
    return {
      type: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Validation failed. Please check your input.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('auth') || message.includes('unauthorized') || message.includes('unlock')) {
    return {
      type: 'AuthenticationError',
      code: 'AUTH_ERROR',
      message: 'Authentication failed. Please try again.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('database') || message.includes('sqlite') || message.includes('sql')) {
    return {
      type: 'DatabaseError',
      code: 'DATABASE_ERROR',
      message: 'Database operation failed. Please try again.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('encrypt') || message.includes('decrypt') || message.includes('crypto')) {
    return {
      type: 'EncryptionError',
      code: 'ENCRYPTION_ERROR',
      message: 'Encryption operation failed. Please check your password.',
      details: { originalMessage: message },
      context,
    }
  }

  // Generic error
  return {
    type: 'Error',
    code: 'UNKNOWN_ERROR',
    message: message || 'An unexpected error occurred.',
    details: { originalMessage: message },
    context,
  }
}

/**
 * Get user-friendly error message for toast notifications
 * @param {Error|string|Object} error - The error to format
 * @returns {string} User-friendly error message
 */
export function getErrorMessage(error) {
  // If it's already a formatted error object from handleError
  if (error && typeof error === 'object' && error.message) {
    return error.message
  }

  // If it's a custom error class
  if (error instanceof Error) {
    return error.message
  }

  // If it's a string
  if (typeof error === 'string') {
    return error
  }

  // Fallback
  return 'An unexpected error occurred.'
}
