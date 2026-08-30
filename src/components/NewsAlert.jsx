import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Info, AlertTriangle, XCircle, X } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { createLogger } from '../utils/logger'
import { useNotificationsStore } from '../store/notifications.js'

const logger = createLogger('NewsAlert')

const SEVERITY = {
  info: { Icon: Info, cls: 'news-alert-info' },
  warning: { Icon: AlertTriangle, cls: 'news-alert-warning' },
  error: { Icon: XCircle, cls: 'news-alert-error' },
}

const MAX_VISIBLE = 3
const POLL_MS = 60000

// MGR-006: баннер новостей от менеджера. Читает локальный кеш (его наполняет
// heartbeat-тик на бэкенде), раскрашивается по severity, крестик помечает
// прочитанным локально и на сервере (best-effort).
export default function NewsAlert() {
  const { t } = useLang()
  const [news, setNews] = useState([])

  const load = useCallback(async () => {
    try {
      const r = await invoke('get_manager_news', { unreadOnly: true })
      const list = (r?.news || []).slice(0, MAX_VISIBLE)
      setNews(list)
      // REDESIGN-05-4: копия в центр уведомлений; key дедупит между поллами
      list.forEach(n =>
        useNotificationsStore.getState().add({
          key: `news:${n.id}`,
          kind: 'news',
          severity: n.severity,
          title: n.title,
          body: n.body,
        })
      )
    } catch (e) {
      logger.debug('news poll skipped:', e?.message ?? e)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка новостей
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const dismiss = async id => {
    setNews(prev => prev.filter(n => n.id !== id))
    try {
      await invoke('mark_manager_news_read', { id })
    } catch (e) {
      logger.debug('mark read failed:', e?.message ?? e)
    }
  }

  if (news.length === 0) return null

  return (
    <div className="news-alerts">
      {news.map(n => {
        const sev = SEVERITY[n.severity] || SEVERITY.info
        return (
          <div key={n.id} className={`news-alert ${sev.cls}`} role="alert">
            <sev.Icon size={14} style={{ flexShrink: 0 }} />
            <div className="news-alert-text">
              <span className="news-alert-title">{n.title}</span>
              {n.body && <span className="news-alert-body">{n.body}</span>}
            </div>
            <button
              className="news-alert-close"
              onClick={() => dismiss(n.id)}
              title={t('news_dismiss')}
              aria-label={t('news_dismiss')}
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
