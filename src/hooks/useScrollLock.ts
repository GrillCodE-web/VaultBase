import { useEffect } from 'react'

/**
 * BUG-012: Safely lock/unlock body scroll for modals.
 * Uses a counter so nested modals don't break each other.
 * Always restores overflow on unmount (even if unexpected).
 */
let lockCount = 0

export function useScrollLock(): void {
  useEffect(() => {
    lockCount++
    document.body.style.overflow = 'hidden'
    return () => {
      lockCount--
      if (lockCount <= 0) {
        lockCount = 0
        document.body.style.overflow = ''
      }
    }
  }, [])
}
