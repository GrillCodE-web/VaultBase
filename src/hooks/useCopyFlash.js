import { useState, useCallback } from 'react'

export function useCopyFlash() {
  const [flashKey, setFlashKey] = useState(null)

  const flash = useCallback((key, text) => {
    // FIX FE-H05: Log clipboard errors instead of silently ignoring
    if (text) {
      navigator.clipboard.writeText(text).catch(e => {
        console.error('[useCopyFlash] Failed to copy:', e)
      })
    }
    setFlashKey(key)
    setTimeout(() => setFlashKey(null), 300)
  }, [])

  return { flash, isFlashing: key => flashKey === key }
}
