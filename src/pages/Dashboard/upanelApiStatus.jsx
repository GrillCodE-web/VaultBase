// FEAT-018: виджет «uPanel APIs: Online/Offline» на дашборде.
//
// Виден любому залогиненному (бэкенд: upanel_connections_list /
// upanel_check_all_apis требуют только require_user). Список грузится один
// раз при монтировании (это чтение БД), проверка всех API — по кнопке:
// upanel_check_all_apis пингует внешний сервис и не должна попадать в
// 30-секундный авто-рефреш дашборда.

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Activity, RefreshCw } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { timeAgo } from '../../utils/formatting'

const STATUS_CLASS = {
  online: 'st-active',
  offline: 'st-decline',
  error: 'st-blocked',
  disabled: 'st-pending',
}

export function UpanelApiStatusWidget() {
  const { t } = useLang()
  const [connections, setConnections] = useState(null) // null = ещё не загружено
  const [statuses, setStatuses] = useState({}) // id → последний UpanelApiStatus
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    invoke('upanel_connections_list')
      .then(r => setConnections(r ?? []))
      .catch(() => setConnections([]))
  }, [])

  // Нет подключений — виджет вообще не рендерится.
  if (connections === null || connections.length === 0) return null

  const rows = connections.map(c => {
    const live = statuses[c.id]
    return {
      ...c,
      status: live?.status ?? c.last_check_status ?? null,
      latency: live?.latency_ms ?? c.last_latency_ms ?? null,
      when: live?.checked_at ?? c.last_check_at ?? null,
    }
  })
  const onlineCount = rows.filter(r => r.status === 'online').length

  const checkAll = async () => {
    if (checking) return
    setChecking(true)
    try {
      const r = (await invoke('upanel_check_all_apis')) ?? []
      const map = {}
      r.forEach(s => {
        if (s?.connection_id != null) map[s.connection_id] = s
      })
      setStatuses(map)
    } catch (e) {
      // тихо: виджет не должен ронять дашборд ошибкой
      console.warn('[UpanelApiStatus] check all failed:', e)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="panel">
      <div className="ptitle">
        {t('upanel_widget_title')}
        <span className="text-[11px] text-muted">
          {t('upanel_widget_online', { online: onlineCount, total: rows.length })}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={checkAll} disabled={checking}>
          {checking ? <RefreshCw size={13} className="animate-spin" /> : <Activity size={13} />}
          {checking ? t('upanel_widget_checking') : t('upanel_widget_check_all')}
        </button>
      </div>
      <div>
        {rows.map(r => (
          <div key={r.id} className="flex items-center border-b py-1.5 gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] truncate">{r.name}</div>
              <div className="text-[10px] text-muted mono truncate">{r.base_url}</div>
            </div>
            <div className="text-[10px] text-muted w-[64px] text-right mono">
              {r.latency != null ? t('upanel_latency_ms', { n: r.latency }) : '—'}
            </div>
            <div className="text-[10px] text-muted w-[64px] text-right">
              {r.when ? timeAgo(r.when) : '—'}
            </div>
            <span className={`st ${STATUS_CLASS[r.status] || 'st-pending'}`}>
              {t(`upanel_status_${r.status || 'unknown'}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
