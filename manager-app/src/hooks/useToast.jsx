import { useState, useCallback, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

const ToastContext = createContext(null)

// Единый центр уведомлений (порт идеи воркерского usePremiumToast на стили
// manager.css). Стек — правый нижний угол.
// SPEC-B (bd4): API-паритет с useSmartToast воркера — success/error/warning/
// info + dismissAll; per-type TTL как у воркера. toast(text, type, ttl)
// сохранён для обратной совместимости.
const TYPE_TTL = { success: 4000, error: 6000, warning: 5000, info: 4000 }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (text, type = 'info', ttl) => {
      const id = nextId.current++
      const ms = ttl ?? TYPE_TTL[type] ?? TYPE_TTL.info
      setToasts((list) => [...list.slice(-4), { id, text, type }])
      if (ms > 0) timers.current[id] = setTimeout(() => dismiss(id), ms)
      return id
    },
    [dismiss]
  )

  const success = useCallback((text, ttl) => toast(text, 'success', ttl), [toast])
  const error = useCallback((text, ttl) => toast(text, 'error', ttl), [toast])
  const warning = useCallback((text, ttl) => toast(text, 'warning', ttl), [toast])
  const info = useCallback((text, ttl) => toast(text, 'info', ttl), [toast])

  const dismissAll = useCallback(() => {
    Object.values(timers.current).forEach(clearTimeout)
    timers.current = {}
    setToasts([])
  }, [])

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info, dismiss, dismissAll }}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`toast ${t.type}`}
              onClick={() => dismiss(t.id)}
            >
              {t.text}
            </button>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
