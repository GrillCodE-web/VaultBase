import { useEffect, useRef, useState } from 'react'
import {
  BellRing,
  CheckCheck,
  Trash2,
  Info,
  AlertTriangle,
  XCircle,
  CheckCircle,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useNotificationsStore } from '../store/notifications.js'
import { timeAgo } from '../utils/formatting.js'

const SEV_ICON = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

/**
 * REDESIGN-05-4 (порция 2): центр уведомлений в топбаре.
 * Собирает тосты (через useSmartToast), новости менеджера (NewsAlert),
 * sync-алерты и системные события (App.jsx) в единый список.
 * Непрочитанные — бейдж на колокольчике; клик по пункту помечает прочитанным.
 */
export function NotificationCenter() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const items = useNotificationsStore(s => s.items)
  const unread = useNotificationsStore(s => s.items.reduce((n, i) => n + (i.read ? 0 : 1), 0))
  const markRead = useNotificationsStore(s => s.markRead)
  const markAllRead = useNotificationsStore(s => s.markAllRead)
  const clear = useNotificationsStore(s => s.clear)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = e => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="topbar-ibtn"
        onClick={() => setOpen(v => !v)}
        title={t('notif_center')}
        aria-label={t('notif_center')}
        aria-expanded={open}
      >
        <BellRing size={16} aria-hidden="true" />
        {unread > 0 && (
          <span className="notif-badge" aria-label={t('notif_unread', { n: unread })}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label={t('notif_center')}>
          <div className="notif-head">
            <span className="notif-title">{t('notif_center')}</span>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
                <CheckCheck size={12} aria-hidden="true" /> {t('notif_mark_all')}
              </button>
            )}
            {items.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={clear}>
                <Trash2 size={12} aria-hidden="true" /> {t('notif_clear')}
              </button>
            )}
          </div>
          <div className="notif-list">
            {items.length === 0 && <p className="notif-empty">{t('notif_empty')}</p>}
            {items.map(n => {
              const Icon = SEV_ICON[n.severity] ?? Info
              return (
                <button
                  key={n.id}
                  className={`notif-item${n.read ? '' : ' unread'}`}
                  onClick={() => markRead(n.id)}
                >
                  <span className={`notif-item-ico sev-${n.severity}`}>
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="notif-item-text">
                    <span className="notif-item-title">{n.title}</span>
                    {n.body && <span className="notif-item-body">{n.body}</span>}
                    <span className="notif-item-time">{timeAgo(new Date(n.ts).toISOString())}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
