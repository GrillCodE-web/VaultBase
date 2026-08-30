import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * Вызывает onIdle через timeoutMs миллисекунд бездействия пользователя.
 * Бездействие = нет mousemove / keydown / click / scroll / touchstart.
 * Если enabled=false — ничего не делает.
 *
 * Возвращает { warningActive, remainingSeconds, deadline, reset }.
 * Предупреждение появляется за warningBeforeMs до блокировки (по умолчанию 2 мин).
 * deadline — ts момента блокировки (REDESIGN-05-4: отсчёт в статус-баре),
 * reset — «продлить» (сброс таймеров, как при активности пользователя).
 */
export function useIdleTimer({
  onIdle,
  timeoutMs = 15 * 60 * 1000,
  enabled = true,
  warningBeforeMs = 2 * 60 * 1000,
}) {
  const timerRef = useRef(null)
  const warningTimerRef = useRef(null)
  const countdownRef = useRef(null)
  const onIdleRef = useRef(onIdle)
  const [warningActive, setWarningActive] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [deadline, setDeadline] = useState(null)

  useEffect(() => {
    onIdleRef.current = onIdle
  })

  const clearAllTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const reset = useCallback(() => {
    clearAllTimers()
    setWarningActive(false)
    // REDESIGN-05-4: дедлайн авто-лока для обратного отсчёта в статус-баре
    setDeadline(Date.now() + timeoutMs)

    if (warningBeforeMs > 0 && warningBeforeMs < timeoutMs) {
      warningTimerRef.current = setTimeout(() => {
        const secs = Math.ceil(warningBeforeMs / 1000)
        setRemainingSeconds(secs)
        setWarningActive(true)
        let left = secs
        countdownRef.current = setInterval(() => {
          left -= 1
          setRemainingSeconds(Math.max(0, left))
          if (left <= 0 && countdownRef.current) clearInterval(countdownRef.current)
        }, 1000)
      }, timeoutMs - warningBeforeMs)
    }

    timerRef.current = setTimeout(() => {
      setWarningActive(false)
      setDeadline(null)
      onIdleRef.current?.()
    }, timeoutMs)
  }, [timeoutMs, warningBeforeMs, clearAllTimers])

  useEffect(() => {
    if (!enabled) return

    const EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    EVENTS.forEach(e => window.addEventListener(e, reset, { passive: true }))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- инициализация таймера при монтировании
    reset()

    return () => {
      EVENTS.forEach(e => window.removeEventListener(e, reset))
      clearAllTimers()
    }
  }, [enabled, reset, clearAllTimers])

  return { warningActive, remainingSeconds, deadline: enabled ? deadline : null, reset }
}
