import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useNotificationsStore } from '../store/notifications.js'

const SmartToastContext = createContext(null)

let _id = 0

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle,
    color: 'success',
    defaultDuration: 4000,
  },
  error: {
    icon: XCircle,
    color: 'error',
    defaultDuration: 6000,
  },
  warning: {
    icon: AlertTriangle,
    color: 'warning',
    defaultDuration: 5000,
  },
  info: {
    icon: Info,
    color: 'info',
    defaultDuration: 4000,
  },
}

// Smart grouping logic
const GROUP_WINDOW_MS = 2000
const MAX_TOASTS = 5

export function SmartToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [hoveredId, setHoveredId] = useState(null)
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const timers = useRef({})
  const lastToastTime = useRef({})

  const remove = useCallback(id => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message, type = 'info', options = {}) => {
      const config = TOAST_CONFIG[type] || TOAST_CONFIG.info
      const duration = options.duration || config.defaultDuration
      const id = ++_id
      const now = Date.now()
      const groupKey = options.groupKey || message

      // Check if we should group with existing toast
      const lastTime = lastToastTime.current[groupKey]
      const shouldGroup = lastTime && now - lastTime < GROUP_WINDOW_MS

      if (shouldGroup) {
        // Update existing grouped toast
        setToasts(prev =>
          prev.map(t => {
            if (t.groupKey === groupKey && !t.grouped) {
              return {
                ...t,
                count: (t.count || 1) + 1,
                lastUpdate: now,
                duration: Math.max(duration, t.duration),
              }
            }
            return t
          })
        )
        lastToastTime.current[groupKey] = now
        return id
      }

      // Limit max toasts
      setToasts(prev => {
        let next = [
          ...prev,
          {
            id,
            message,
            type,
            duration,
            action: options.action || null,
            groupKey: options.groupKey,
            count: 1,
            lastUpdate: now,
            grouped: false,
          },
        ]
        if (next.length > MAX_TOASTS) {
          next = next.slice(next.length - MAX_TOASTS)
        }
        return next
      })

      lastToastTime.current[groupKey] = now

      // Auto-dismiss
      timers.current[id] = setTimeout(() => remove(id), duration)

      // REDESIGN-05-4: копия в центр уведомлений (группируемые дубли не плодим —
      // сюда попадает только первый тост группы)
      useNotificationsStore.getState().add({ kind: 'toast', severity: type, title: message })

      return id
    },
    [remove]
  )

  const success = useCallback((msg, options) => showToast(msg, 'success', options), [showToast])
  const error = useCallback((msg, options) => showToast(msg, 'error', options), [showToast])
  const warning = useCallback((msg, options) => showToast(msg, 'warning', options), [showToast])
  const info = useCallback((msg, options) => showToast(msg, 'info', options), [showToast])

  const handleMouseEnter = useCallback(t => {
    setHoveredId(t.id)
    if (timers.current[t.id]) {
      clearTimeout(timers.current[t.id])
    }
  }, [])

  const handleMouseLeave = useCallback(
    t => {
      setHoveredId(null)
      const remainingTime = t.duration * 0.4
      timers.current[t.id] = setTimeout(() => remove(t.id), remainingTime)
    },
    [remove]
  )

  const dismissAll = useCallback(() => {
    Object.values(timers.current).forEach(timerId => clearTimeout(timerId))
    timers.current = {}
    setToasts([])
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(timerId => clearTimeout(timerId))
      timers.current = {}
    }
  }, [])

  const value = {
    toasts,
    success,
    error,
    warning,
    info,
    remove,
    dismissAll,
    hoveredId,
    handleMouseEnter,
    handleMouseLeave,
    collapsedGroups,
    setCollapsedGroups,
  }

  return (
    <SmartToastContext.Provider value={value}>
      {children}
      <SmartToastContainer />
    </SmartToastContext.Provider>
  )
}

function SmartToastContainer() {
  const {
    toasts,
    remove,
    handleMouseEnter,
    handleMouseLeave,
    collapsedGroups,
    setCollapsedGroups,
  } = useContext(SmartToastContext)

  // Group toasts by groupKey
  const groupedToasts = toasts.reduce((acc, toast) => {
    if (toast.groupKey) {
      if (!acc[toast.groupKey]) {
        acc[toast.groupKey] = []
      }
      acc[toast.groupKey].push(toast)
    } else {
      acc[`ungrouped_${toast.id}`] = [toast]
    }
    return acc
  }, {})

  return (
    <div className="smart-toast-container" aria-live="polite" aria-relevant="additions">
      {Object.entries(groupedToasts).map(([groupKey, group]) => {
        const latestToast = group[group.length - 1]
        const isCollapsed = collapsedGroups[groupKey] && group.length > 1
        const displayToasts = isCollapsed ? [latestToast] : group

        return (
          <div key={groupKey}>
            {displayToasts.map(t => {
              const config = TOAST_CONFIG[t.type] || TOAST_CONFIG.info
              const Icon = config.icon

              return (
                <div
                  key={t.id}
                  className={`smart-toast ${t.type}`}
                  role={t.type === 'error' ? 'alert' : 'status'}
                  onMouseEnter={() => handleMouseEnter(t)}
                  onMouseLeave={() => handleMouseLeave(t)}
                  style={{ '--toast-duration': `${t.duration}ms` }}
                >
                  <div className="smart-toast-icon">
                    <Icon size={16} />
                  </div>

                  <div className="smart-toast-content">
                    {t.count > 1 && (
                      <div className="smart-toast-title">
                        {t.message} ×{t.count}
                      </div>
                    )}
                    <div className="smart-toast-message">{t.message}</div>

                    {t.action && (
                      <button
                        className="card-action-btn primary"
                        style={{ marginTop: 6 }}
                        onClick={e => {
                          e.stopPropagation()
                          t.action.onClick()
                          remove(t.id)
                        }}
                      >
                        {t.action.label}
                      </button>
                    )}
                  </div>

                  <button
                    className="smart-toast-close"
                    onClick={e => {
                      e.stopPropagation()
                      remove(t.id)
                    }}
                    aria-label="Close notification"
                  >
                    <X size={14} />
                  </button>

                  <div
                    className="smart-toast-progress"
                    style={{ '--toast-duration': `${t.duration}ms` }}
                  />
                </div>
              )
            })}

            {group.length > 1 && (
              <button
                className="card-action-btn"
                style={{ marginTop: 4, marginLeft: 36 }}
                onClick={() =>
                  setCollapsedGroups(prev => ({
                    ...prev,
                    [groupKey]: !prev[groupKey],
                  }))
                }
              >
                {isCollapsed ? `Show ${group.length - 1} more` : 'Show less'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSmartToast() {
  const ctx = useContext(SmartToastContext)
  if (!ctx) {
    throw new Error('useSmartToast must be used within SmartToastProvider')
  }
  return {
    success: ctx.success,
    error: ctx.error,
    warning: ctx.warning,
    info: ctx.info,
    dismissAll: ctx.dismissAll,
    // Alias for backwards compatibility with old useToast API
    toast: ctx.info,
  }
}

// Normalize old toast() call syntax into the smart toast options.
// Old API: toast({ message, type, duration, action }) or toast(string, type)
function normalizeToastArgs(message, typeOrOptions) {
  if (typeof message === 'object' && message !== null) {
    const { message: msg, type = 'info', duration, action, groupKey } = message
    return { message: msg ?? '', type, options: { duration, action, groupKey } }
  }
  return {
    message,
    type: typeof typeOrOptions === 'string' ? typeOrOptions : 'info',
    options: typeof typeOrOptions === 'object' && typeOrOptions !== null ? typeOrOptions : {},
  }
}

function useSmartToastMethods(ctx) {
  return {
    toast: useCallback(
      (message, typeOrOptions) => {
        if (!ctx) return
        const { message: msg, type, options } = normalizeToastArgs(message, typeOrOptions)
        ctx.info(msg, { ...options, ...(type !== 'info' ? { groupKey: msg } : {}) })
      },
      [ctx]
    ),
    success: useCallback((msg, options) => ctx?.success?.(msg, options), [ctx]),
    error: useCallback((msg, options) => ctx?.error?.(msg, options), [ctx]),
    warning: useCallback((msg, options) => ctx?.warning?.(msg, options), [ctx]),
    info: useCallback((msg, options) => ctx?.info?.(msg, options), [ctx]),
  }
}

// Backwards compatibility wrapper - allows gradual migration
// Components using old useToast will still work but get smart notifications
// eslint-disable-next-line react-refresh/only-export-components -- хук и провайдер намеренно в одном файле
export function useToast() {
  const ctx = useContext(SmartToastContext)
  const { toast, success, error, warning } = useSmartToastMethods(ctx)
  if (!ctx) {
    // Fallback to basic toast if SmartToastProvider not available
    return {
      toast: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
    }
  }
  return {
    toast,
    success,
    error,
    warn: warning, // map 'warn' to 'warning'
  }
}
