import { invoke } from '@tauri-apps/api/core'
import { NetworkError, DatabaseError } from '../types/errors.js'

/**
 * Wrapper around Tauri invoke with error handling and retry logic
 * @param {string} command - Tauri command to invoke
 * @param {Object} args - Arguments to pass to the command
 * @param {Object} options - Options for retry behavior
 * @returns {Promise<any>} Result from the command
 */
export async function apiCall(command, args = {}, options = {}) {
  const { retries = 0, retryDelay = 1000, timeout = 30000 } = options

  let lastError

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new NetworkError('Request timeout')), timeout)
      })

      // Race between invoke and timeout
      const result = await Promise.race([invoke(command, args), timeoutPromise])

      return result
    } catch (error) {
      lastError = error

      // Check if error is retryable
      const errorMessage = String(error)
      const isRetryable =
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection')

      // If not retryable or last attempt, throw
      if (!isRetryable || attempt === retries) {
        break
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }

  // Classify and throw appropriate error
  const errorMessage = String(lastError)

  if (errorMessage.includes('network') || errorMessage.includes('connection')) {
    throw new NetworkError('Network request failed', { command, args, originalError: errorMessage })
  }

  if (errorMessage.includes('database') || errorMessage.includes('sqlite')) {
    throw new DatabaseError('Database operation failed', {
      command,
      args,
      originalError: errorMessage,
    })
  }

  // Re-throw original error if not classified
  throw lastError
}
