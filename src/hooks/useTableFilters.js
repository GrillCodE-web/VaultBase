import { useState, useCallback, useRef } from 'react'
import { useDebounceCallback } from './useDebounceCallback'

/**
 * ARCH-013: Reusable table filters hook with debounced search.
 * Replaces duplicate filter logic in Cards, Orders, Profiles.
 *
 * @param {Function} onFiltersChange - Called with merged filters object
 * @param {Object} [defaults={}] - Default filter values
 * @param {number} [debounceMs=300]
 */
export function useTableFilters(onFiltersChange, defaults = {}, debounceMs = 300) {
  const [filters, setFiltersRaw] = useState(defaults)
  const [searchInput, setSearchInput] = useState(defaults.search || '')
  const filtersRef = useRef(defaults)
  // Update ref in effect, not during render
  const updateRef = useCallback(f => {
    filtersRef.current = f
  }, [])

  const debouncedNotify = useDebounceCallback(merged => {
    onFiltersChange(merged)
  }, debounceMs)

  const setFilter = useCallback(
    (key, value) => {
      setFiltersRaw(prev => {
        const next = { ...prev, [key]: value }
        updateRef(next)
        onFiltersChange(next)
        return next
      })
    },
    [onFiltersChange, updateRef]
  )

  const setSearch = useCallback(
    value => {
      setSearchInput(value)
      debouncedNotify({ ...filtersRef.current, search: value })
    },
    [debouncedNotify]
  )

  const resetFilters = useCallback(() => {
    setFiltersRaw(defaults)
    setSearchInput(defaults.search || '')
    onFiltersChange(defaults)
  }, [defaults, onFiltersChange])

  const setMultipleFilters = useCallback(
    updates => {
      setFiltersRaw(prev => {
        const next = { ...prev, ...updates }
        updateRef(next)
        onFiltersChange(next)
        return next
      })
    },
    [onFiltersChange, updateRef]
  )

  return {
    filters,
    searchInput,
    setFilter,
    setSearch,
    resetFilters,
    setMultipleFilters,
  }
}
