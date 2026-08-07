import { useEffect, useRef, useCallback } from 'react'

/**
 * Вызывает onIdle через timeoutMs миллисекунд бездействия пользователя.
 * Бездействие = нет mousemove / keydown / click / scroll / touchstart.
 * Если enabled=false — ничего не делает.
 */
export function useIdleTimer({ onIdle, timeoutMs = 15 * 60 * 1000, enabled = true }) {
  const timerRef = useRef(null)
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onIdleRef.current?.()
    }, timeoutMs)
  }, [timeoutMs])

  useEffect(() => {
    if (!enabled) return

    const EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }))
    reset()

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, reset))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, reset])
}
