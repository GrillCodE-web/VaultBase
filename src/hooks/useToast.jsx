import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'
import { HEX_COLORS } from '../constants/colors.js'

const ToastContext = createContext(null)

let _id = 0

const TOAST_STYLES = {
  success: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: HEX_COLORS.green,
    color: HEX_COLORS.white,
    iconColor: HEX_COLORS.greenLight,
    Icon: CheckCircle,
  },
  error: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: HEX_COLORS.red,
    color: HEX_COLORS.white,
    iconColor: HEX_COLORS.redLight,
    Icon: XCircle,
  },
  warn: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: HEX_COLORS.yellow,
    color: HEX_COLORS.white,
    iconColor: HEX_COLORS.yellowLight,
    Icon: AlertTriangle,
  },
  info: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: HEX_COLORS.blue,
    color: HEX_COLORS.white,
    iconColor: HEX_COLORS.blueLight,
    Icon: Info,
  },
}

const KEYFRAME_CSS = `
@keyframes toast-in {
  from { transform: translateX(110%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes toast-progress { from{width:100%} to{width:0%} }
`

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [hoveredId, setHoveredId] = useState(null)
  const timers = useRef({})

  const remove = useCallback(id => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback(
    (msgOrObj, typeArg) => {
      const message = typeof msgOrObj === 'string' ? msgOrObj : msgOrObj.message
      const type = typeof msgOrObj === 'string' ? (typeArg ?? 'info') : (msgOrObj.type ?? 'info')
      const duration = typeof msgOrObj === 'object' ? (msgOrObj.duration ?? 3500) : 3500
      const action = typeof msgOrObj === 'object' ? (msgOrObj.action ?? null) : null
      const id = ++_id
      setToasts(prev => {
        const next = [...prev, { id, message, type, duration, action }]
        return next.length > 5 ? next.slice(next.length - 5) : next
      })
      timers.current[id] = setTimeout(() => remove(id), duration)
    },
    [remove]
  )

  const success = useCallback(msg => toast({ message: msg, type: 'success' }), [toast])
  const error = useCallback(msg => toast({ message: msg, type: 'error' }), [toast])
  const warn = useCallback(msg => toast({ message: msg, type: 'warn' }), [toast])
  const info = useCallback(msg => toast({ message: msg, type: 'info' }), [toast])

  const handleMouseEnter = useCallback(t => {
    setHoveredId(t.id)
    clearTimeout(timers.current[t.id])
  }, [])

  const handleMouseLeave = useCallback(
    t => {
      setHoveredId(null)
      timers.current[t.id] = setTimeout(() => remove(t.id), t.duration * 0.4)
    },
    [remove]
  )

  // FIX FE-H02: Cleanup all timers on provider unmount
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(timerId => {
        clearTimeout(timerId)
      })
      timers.current = {}
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toast, success, error, warn, info }}>
      {children}
      <style>{KEYFRAME_CSS}</style>
      <div
        role="region"
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-5 right-5 flex flex-col-reverse gap-2 pointer-events-none"
        style={{ zIndex: 9999 }}
      >
        {toasts.map(t => {
          const s = TOAST_STYLES[t.type] ?? TOAST_STYLES.info
          const isHovered = hoveredId === t.id
          return (
            <div
              key={t.id}
              onClick={() => {
                if (!t.action) remove(t.id)
              }}
              onMouseEnter={() => handleMouseEnter(t)}
              onMouseLeave={() => handleMouseLeave(t)}
              className="flex items-center gap-2.5 rounded-xl text-sm font-medium pointer-events-auto relative overflow-hidden select-none transition-shadow"
              style={{
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderLeft: `3px solid ${s.leftBorder}`,
                padding: '10px 14px',
                lineHeight: '1.4',
                color: s.color,
                minWidth: '220px',
                maxWidth: '400px',
                cursor: t.action ? 'default' : 'pointer',
                animation: 'toast-in 220ms ease-out',
                boxShadow: isHovered
                  ? `0 6px 24px rgba(0,0,0,0.7), 0 0 0 1px ${s.leftBorder}50`
                  : `0 4px 16px rgba(0,0,0,0.55), 0 0 0 1px ${s.border}`,
              }}
            >
              <span className="shrink-0 flex" style={{ color: s.iconColor, lineHeight: 1 }}>
                {s.Icon && <s.Icon size={16} />}
              </span>
              <span className="flex-1">{t.message}</span>

              {t.action && (
                <span
                  onClick={e => {
                    e.stopPropagation()
                    t.action.onClick()
                    remove(t.id)
                  }}
                  className="text-xs font-bold shrink-0 px-2 py-0.5 rounded cursor-pointer transition-colors"
                  style={{
                    color: HEX_COLORS.blueLight,
                    border: '1px solid rgba(96,165,250,0.4)',
                    marginLeft: 4,
                  }}
                >
                  {t.action.label}
                </span>
              )}

              {t.action && (
                <span
                  onClick={e => {
                    e.stopPropagation()
                    remove(t.id)
                  }}
                  className="text-sm cursor-pointer shrink-0 text-muted"
                  style={{ marginLeft: 2 }}
                >
                  ✕
                </span>
              )}

              <div
                className="absolute bottom-0 left-0 h-0.5 rounded-b-xl"
                style={{
                  background: s.leftBorder,
                  animation: `toast-progress ${t.duration}ms linear forwards`,
                  animationPlayState: isHovered ? 'paused' : 'running',
                }}
              />
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook export pattern
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
