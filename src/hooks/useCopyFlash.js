import { useState, useCallback, useRef, useEffect } from 'react'

export function useCopyFlash() {
  const [flashKey, setFlashKey] = useState(null)
  const timerRef = useRef(null)

  const flash = useCallback((key, text) => {
    if (text) {
      navigator.clipboard.writeText(text).catch(e => {
        if (import.meta.env.DEV) console.error('[useCopyFlash] Failed to copy:', e)
      })
    }
    setFlashKey(key)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFlashKey(null), 300)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { flash, isFlashing: key => flashKey === key }
}
