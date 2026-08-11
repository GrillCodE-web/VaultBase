import { useState, useCallback, useMemo } from 'react'

/**
 * ARCH-014: Reusable bulk actions hook.
 * Replaces duplicate selected/selectAll/deselectAll logic across pages.
 *
 * @param {Array} items - Current page items (each must have `id`)
 */
export function useBulkActions(items) {
  const [selected, setSelected] = useState([])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const isSelected = useCallback(id => selectedSet.has(id), [selectedSet])

  const toggle = useCallback(id => {
    setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }, [])

  const selectAll = useCallback(() => {
    setSelected(items.map(i => i.id))
  }, [items])

  const deselectAll = useCallback(() => {
    setSelected([])
  }, [])

  const toggleAll = useCallback(() => {
    if (selected.length === items.length) {
      deselectAll()
    } else {
      selectAll()
    }
  }, [selected.length, items.length, selectAll, deselectAll])

  const allSelected = items.length > 0 && selected.length === items.length
  const someSelected = selected.length > 0 && selected.length < items.length

  return {
    selected,
    setSelected,
    selectedSet,
    isSelected,
    toggle,
    selectAll,
    deselectAll,
    toggleAll,
    allSelected,
    someSelected,
    count: selected.length,
  }
}
