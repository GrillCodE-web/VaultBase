import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, evaluateAlerts, fmtDateTime, getLocalAlerts, localAlertAction } from '../api/server.js'

const STATUSES = ['all', 'new', 'ack', 'closed']

export default function Alerts({ onAlertsChanged, onNavigate }) {
  const { t } = useLang()
  const [alerts, setAlerts] = useState(null)
  const [status, setStatus] = useState('all')

  const load = () => {
    const query = status === 'all' ? '' : `?status=${status}`
    const serverAlerts = api('GET', `/manager/api/alerts${query}`)
      .then((r) => (r.status === 200 ? r.body.alerts || [] : []))
      .catch(() => [])
    const localAlerts = evaluateAlerts()
      .catch(() => null)
      .then(() => getLocalAlerts(status))
      .then((r) => r.alerts || [])
      .catch(() => [])
    Promise.all([serverAlerts, localAlerts]).then(([srv, loc]) => {
      const merged = [...srv, ...loc].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      setAlerts(merged)
    })
  }

  useEffect(load, [status])

  const act = async (alert, action) => {
    if (alert.source === 'local') {
      try {
        await localAlertAction(alert.id, action)
      } catch {
        return
      }
    } else {
      const r = await api('POST', `/manager/api/alerts/${alert.id}/${action}`)
      if (r.status !== 200) return
    }
    load()
    onAlertsChanged?.()
  }

  if (alerts === null) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          {STATUSES.map((s) => (
            <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {t(`alert_status_${s}`)}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn" onClick={load}>{t('refresh')}</button>
      </div>

      <div className="panel">
        {alerts.length === 0 ? (
          <div className="empty">{t('no_alerts')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_severity')}</th>
                <th>{t('col_category')}</th>
                <th>{t('alert_title_col')}</th>
                <th>{t('col_time')}</th>
                <th>{t('alert_status_col')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={`${a.source === 'local' ? 'L' : 'S'}${a.id}`}>
                  <td>
                    <span className={`tag ${a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'accent'}`}>
                      {t(`sev_${a.severity}`)}
                    </span>
                  </td>
                  <td className="mono">
                    {t(`cat_${a.category}`) === `cat_${a.category}` ? a.category : t(`cat_${a.category}`)}
                    {a.source === 'local' && <span className="tag gray" style={{ marginLeft: 6 }}>{t('alert_src_local')}</span>}
                  </td>
                  <td title={a.message}>{a.title}</td>
                  <td>{fmtDateTime(a.created_at)}</td>
                  <td>
                    <span className={`tag ${a.status === 'new' ? 'red' : a.status === 'ack' ? 'amber' : 'gray'}`}>
                      {t(`alert_status_${a.status}`)}
                    </span>
                  </td>
                  <td>
                    {a.installation_id && onNavigate && (
                      <button
                        className="btn small"
                        title={a.installation_id}
                        onClick={() => onNavigate('workers', { focus: a.installation_id })}
                      >
                        {t('alert_goto_worker')}
                      </button>
                    )}{' '}
                    {a.status === 'new' && (
                      <button className="btn small" onClick={() => act(a, 'ack')}>{t('alert_ack')}</button>
                    )}{' '}
                    {a.status !== 'closed' && (
                      <button className="btn small" onClick={() => act(a, 'close')}>{t('alert_close')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
