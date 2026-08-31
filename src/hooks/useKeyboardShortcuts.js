import { useEffect, useRef, useCallback } from 'react'
import { isInInputField } from '../config/shortcuts'

/**
 * Custom hook for managing keyboard shortcuts
 * Supports:
 * - Single keys (e.g., 'f', 'r', 'n')
 * - Modifier combinations (e.g., 'Cmd+K', 'Ctrl+S')
 * - Key sequences (e.g., 'g d', 'g c')
 */
export function useKeyboardShortcuts(shortcuts, options = {}) {
  const { enabled = true, currentPage = null } = options
  const sequenceRef = useRef({ keys: [], timer: null })
  // FIX (REDESIGN-05-4 финал): актуальные значения — в ref'ах. Иначе каждый
  // рендер (тиканье статус-бара, idle-таймер, уведомления) пересоздавал
  // handleKeyDown -> эффект делал removeEventListener/addEventListener, и
  // keydown, пришедший в окне между снятием и установкой слушателя
  // (React флашит passive-эффекты асинхронно, посреди диспатча trusted
  // keydown Control→k), терялся: Ctrl+K/Alt+N/… молча не срабатывали.
  const shortcutsRef = useRef(shortcuts)
  const currentPageRef = useRef(currentPage)

  useEffect(() => {
    shortcutsRef.current = shortcuts
    currentPageRef.current = currentPage
  })

  const handleKeyDown = useCallback(e => {
    const shortcutsNow = shortcutsRef.current
    const currentPageNow = currentPageRef.current

    // Build current key combination
    const modifiers = []
    if (e.metaKey) modifiers.push('Meta')
    if (e.ctrlKey) modifiers.push('Control')
    if (e.altKey) modifiers.push('Alt')
    if (e.shiftKey) modifiers.push('Shift')

    const key = e.key
    const combo = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key

    // Check for sequence shortcuts (e.g., 'g d')
    if (!e.metaKey && !e.ctrlKey && !e.altKey && key.length === 1) {
      // Clear sequence timer
      if (sequenceRef.current.timer) {
        clearTimeout(sequenceRef.current.timer)
      }

      // Add key to sequence
      sequenceRef.current.keys.push(key)

      // UX-021: сброс последовательности через 500ms (1000ms было слишком
      // щедро — соседние буквы слипались в ложные шорткаты)
      sequenceRef.current.timer = setTimeout(() => {
        sequenceRef.current.keys = []
      }, 500)

      // Check if sequence matches any shortcut
      const sequence = sequenceRef.current.keys.join(' ')
      for (const shortcut of shortcutsNow) {
        if (shortcut.keys.includes(sequence)) {
          // Check if shortcut requires no input field focus
          if (shortcut.requireNoInput && isInInputField()) {
            continue
          }

          // Check if shortcut is page-specific
          if (shortcut.page && shortcut.page !== currentPageNow) {
            continue
          }

          e.preventDefault()
          sequenceRef.current.keys = []
          clearTimeout(sequenceRef.current.timer)
          shortcut.handler(e)
          return
        }
      }

      // If sequence is longer than 2 keys, reset
      if (sequenceRef.current.keys.length > 2) {
        sequenceRef.current.keys = []
      }

      return
    }

    // Check for direct key matches
    for (const shortcut of shortcutsNow) {
      // Normalize shortcut keys for comparison
      const normalizedKeys = shortcut.keys.map(k =>
        k
          .replace(/Cmd/gi, 'Meta')
          .replace(/Ctrl/gi, 'Control')
          .replace(/Alt/gi, 'Alt')
          .replace(/Shift/gi, 'Shift')
      )

      if (normalizedKeys.includes(combo) || normalizedKeys.includes(key)) {
        // Check if shortcut requires no input field focus
        if (shortcut.requireNoInput && isInInputField()) {
          continue
        }

        // Check if shortcut is page-specific
        if (shortcut.page && shortcut.page !== currentPageNow) {
          continue
        }

        e.preventDefault()
        shortcut.handler(e)
        return
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Safe: using snapshot from closure
      const currentSequence = sequenceRef.current
      if (currentSequence?.timer) {
        clearTimeout(currentSequence.timer)
      }
    }
  }, [enabled, handleKeyDown])
}

/**
 * Hook for registering a single shortcut
 */
export function useShortcut(keys, handler, options = {}) {
  const shortcuts = [
    {
      keys: Array.isArray(keys) ? keys : [keys],
      handler,
      ...options,
    },
  ]

  useKeyboardShortcuts(shortcuts, options)
}
