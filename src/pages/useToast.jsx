import { useState, useCallback, useRef, createContext, useContext } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'

const ToastContext = createContext(null)

let _id = 0

const TOAST_STYLES = {
  success: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: 'var(--color-success)',
    color: 'var(--text)',
    iconColor: 'var(--color-success)',
    Icon: CheckCircle,
  },
  error: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: 'var(--color-error)',
    color: 'var(--text)',
    iconColor: 'var(--color-error)',
    Icon: XCircle,
  },
  warn: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: 'var(--color-warning)',
    color: 'var(--text)',
    iconColor: 'var(--color-warning)',
    Icon: AlertTriangle,
  },
  info: {
    bg: 'var(--card)',
    border: 'var(--border)',
    leftBorder: 'var(--blue)',
    color: 'var(--text)',
    iconColor: 'var(--color-info)',
    Icon: Info,
  },
}

const KEYFRAME_CSS = `
@keyframes toast-in {
  from { transform: translateX(110%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes toast-out {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(110%); opacity: 0; }
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

  return (
    <ToastContext.Provider value={{ toast, success, error, warn, info }}>
      {children}
      <style>{KEYFRAME_CSS}</style>
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '8px',
          pointerEvents: 'none',
        }}
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderLeft: `3px solid ${s.leftBorder}`,
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '13px',
                lineHeight: '1.4',
                fontWeight: 500,
                color: s.color,
                minWidth: '220px',
                maxWidth: '400px',
                cursor: t.action ? 'default' : 'pointer',
                pointerEvents: 'auto',
                animation: 'toast-in 220ms ease-out',
                boxSizing: 'border-box',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: isHovered
                  ? `0 6px 24px rgba(0,0,0,0.7), 0 0 0 1px ${s.leftBorder}50`
                  : `0 4px 16px rgba(0,0,0,0.55), 0 0 0 1px ${s.border}`,
                userSelect: 'none',
                transition: 'box-shadow 150ms',
              }}
            >
              <span style={{ flexShrink: 0, color: s.iconColor, lineHeight: 1, display: 'flex' }}>
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
                  style={{
                    color: 'var(--color-info)',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: 12,
                    flexShrink: 0,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-info-bg)',
                    marginLeft: 4,
                    transition: 'background 150ms',
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
                  style={{
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: 13,
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                >
                  ✕
                </span>
              )}

              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  height: 2,
                  background: s.leftBorder,
                  borderRadius: '0 0 10px 10px',
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

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
