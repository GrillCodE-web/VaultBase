/**
 * Clipboard utilities with auto-clear for sensitive data (SEC-013)
 */

const SENSITIVE_CLEAR_TIMEOUT = 30_000 // 30 seconds
let _clearTimer = null

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export function copyToClipboard(text, onSuccess, onError) {
  navigator.clipboard.writeText(text).then(onSuccess, onError)
}

/**
 * Copy text to clipboard (simple version, ignores errors)
 * @param {string} text - Text to copy
 */
export function copyText(text) {
  navigator.clipboard.writeText(text).catch(e => {
    const isDev = import.meta?.env?.DEV
    if (isDev) {
      console.error('[clipboard] Failed to copy:', e)
    }
  })
}

/**
 * SEC-013: Copy sensitive data (PAN/CVV) with auto-clear after 30s
 * @param {string} text - Sensitive text to copy
 * @returns {Promise<boolean>}
 */
export async function copySensitive(text) {
  try {
    await navigator.clipboard.writeText(String(text))
    if (_clearTimer) clearTimeout(_clearTimer)
    _clearTimer = setTimeout(() => {
      navigator.clipboard
        .readText()
        .then(current => {
          if (current === String(text)) {
            navigator.clipboard.writeText('')
          }
        })
        .catch(() => {})
      _clearTimer = null
    }, SENSITIVE_CLEAR_TIMEOUT)
    return true
  } catch (e) {
    console.error('[clipboard] Failed to copy sensitive data:', e)
    return false
  }
}
