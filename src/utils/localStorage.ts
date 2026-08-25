/**
 * Safe localStorage operations with error handling
 * FIX CRITICAL: Handle QuotaExceededError and other localStorage errors
 */

export function safeGetItem(key: string, defaultValue: string | null = null): string | null {
  try {
    const value = localStorage.getItem(key)
    return value !== null ? value : defaultValue
  } catch (e) {
    const err = e as DOMException
    if (err.name === 'SecurityError' || err.name === 'QuotaExceededError') {
      console.warn(`[Storage] Failed to read '${key}' from localStorage:`, err.message)
    } else {
      console.error(`[Storage] Unexpected error reading '${key}':`, e)
    }
    return defaultValue
  }
}

/**
 * Safely set item in localStorage with quota handling
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    const err = e as DOMException
    if (err.name === 'QuotaExceededError') {
      console.warn('[Storage] localStorage quota exceeded - clearing old data')
      // Try to clear some space by removing less important keys
      const keysToTry = [
        'cc_nav_order',
        'cc_sidebar_expanded',
        'search_history',
        'view_preferences',
      ]

      for (const clearKey of keysToTry) {
        if (clearKey !== key) {
          try {
            localStorage.removeItem(clearKey)
          } catch {
            // Ignore errors when clearing
          }
        }
      }

      // Try again after clearing space
      try {
        localStorage.setItem(key, value)
        return true
      } catch (retryError) {
        console.error('[Storage] Failed to set item even after clearing space:', retryError)
        return false
      }
    } else if (err.name === 'SecurityError') {
      console.warn('[Storage] SecurityError - localStorage might be disabled (private mode?)')
      return false
    } else {
      console.error(`[Storage] Unexpected error setting '${key}':`, e)
      return false
    }
  }
}

export function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch (e) {
    console.warn(`[Storage] Failed to remove '${key}' from localStorage:`, (e as Error).message)
    return false
  }
}

export function safeGetJSON<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  const value = safeGetItem(key, null)
  if (value === null) return defaultValue

  try {
    return JSON.parse(value) as T
  } catch (e) {
    console.warn(`[Storage] Failed to parse JSON from '${key}':`, (e as Error).message)
    return defaultValue
  }
}

export function safeSetJSON(key: string, value: unknown): boolean {
  try {
    const jsonString = JSON.stringify(value)
    return safeSetItem(key, jsonString)
  } catch (e) {
    console.error(`[Storage] Failed to stringify or set '${key}':`, e)
    return false
  }
}
