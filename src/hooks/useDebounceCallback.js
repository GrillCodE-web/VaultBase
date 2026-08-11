import { useRef, useCallback, useEffect } from 'react'

/**
 * PERF-008: Proper debounce — debounces the callback itself, not the value.
 * Avoids unnecessary re-renders on every keystroke.
 *
 * @param {Function} callback
 * @param {number} delay - ms
 * @returns {Function} debounced callback (stable reference)
 */
export function useDebounceCallback(callback, delay = 300) {
  const timerRef = useRef(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const debouncedFn = useCallback(
    (...args) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args)
        timerRef.current = null
      }, delay)
    },
    [delay]
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return debouncedFn
}
