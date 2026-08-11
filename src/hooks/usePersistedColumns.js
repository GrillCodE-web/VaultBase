import { useState, useCallback } from 'react'
import { safeGetItem, safeSetItem } from '../utils/localStorage'

/**
 * UX-017: Persist column picker selection in localStorage.
 *
 * @param {string} storageKey - e.g. 'cards_columns'
 * @param {string[]} defaultCols - default visible columns
 */
export function usePersistedColumns(storageKey, defaultCols) {
  const [columns, setColumnsRaw] = useState(() => {
    const saved = safeGetItem(storageKey)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch (_e) {
        /* corrupted data — use defaults */
      }
    }
    return defaultCols
  })

  const setColumns = useCallback(
    cols => {
      setColumnsRaw(cols)
      safeSetItem(storageKey, JSON.stringify(cols))
    },
    [storageKey]
  )

  const resetColumns = useCallback(() => {
    setColumnsRaw(defaultCols)
    safeSetItem(storageKey, JSON.stringify(defaultCols))
  }, [storageKey, defaultCols])

  return { columns, setColumns, resetColumns }
}
