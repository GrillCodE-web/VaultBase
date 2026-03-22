/**
 * Clipboard utilities
 */

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
  navigator.clipboard.writeText(text).catch(() => {})
}
