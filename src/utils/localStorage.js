/**
 * Safe localStorage operations with error handling
 * FIX CRITICAL: Handle QuotaExceededError and other localStorage errors
 */

/**
 * Safely get item from localStorage
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function safeGetItem(key, defaultValue = null) {
  try {
    const value = localStorage.getItem(key)
    return value !== null ? value : defaultValue
  } catch (e) {
    if (e.name === 'SecurityError' || e.name === 'QuotaExceededError') {
      console.warn(`[Storage] Failed to read '${key}' from localStorage:`, e.message)
    } else {
      console.error(`[Storage] Unexpected error reading '${key}':`, e)
    }
    return defaultValue
  }
}

/**
 * Safely set item in localStorage with quota handling
 * @param {string} key
 * @param {string} value
 * @returns {boolean} true if successful
 */
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
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
    } else if (e.name === 'SecurityError') {
      console.warn('[Storage] SecurityError - localStorage might be disabled (private mode?)')
      return false
    } else {
      console.error(`[Storage] Unexpected error setting '${key}':`, e)
      return false
    }
  }
}

/**
 * Safely remove item from localStorage
 * @param {string} key
 * @returns {boolean} true if successful
 */
export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key)
    return true
  } catch (e) {
    console.warn(`[Storage] Failed to remove '${key}' from localStorage:`, e.message)
    return false
  }
}

/**
 * Safely parse JSON from localStorage with error handling
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
export function safeGetJSON(key, defaultValue = null) {
  const value = safeGetItem(key, null)
  if (value === null) return defaultValue

  try {
    return JSON.parse(value)
  } catch (e) {
    console.warn(`[Storage] Failed to parse JSON from '${key}':`, e.message)
    return defaultValue
  }
}

/**
 * Safely set JSON to localStorage
 * @param {string} key
 * @param {*} value
 * @returns {boolean} true if successful
 */
export function safeSetJSON(key, value) {
  try {
    const jsonString = JSON.stringify(value)
    return safeSetItem(key, jsonString)
  } catch (e) {
    console.error(`[Storage] Failed to stringify or set '${key}':`, e)
    return false
  }
}
