import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, fmtDateTime } from '../api/server.js'

const STATUSES = ['all', 'new', 'ack', 'closed']

export default function Alerts({ onAlertsChanged }) {
  const { t } = useLang()
  const [alerts, setAlerts] = useState(null)
  const [status, setStatus] = useState('all')

  const load = () => {
    const query = status === 'all' ? '' : `?status=${status}`
    api('GET', `/manager/api/alerts${query}`)
      .then((r) => setAlerts(r.status === 200 ? r.body.alerts || [] : []))
      .catch(() => setAlerts([]))
  }

  useEffect(load, [status])

  const act = async (id, action) => {
    const r = await api('POST', `/manager/api/alerts/${id}/${action}`)
    if (r.status === 200) {
      load()
      onAlertsChanged?.()
    }
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
                <tr key={a.id}>
                  <td>
                    <span className={`tag ${a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'accent'}`}>
                      {t(`sev_${a.severity}`)}
                    </span>
                  </td>
                  <td className="mono">{t(`cat_${a.category}`) === `cat_${a.category}` ? a.category : t(`cat_${a.category}`)}</td>
                  <td title={a.message}>{a.title}</td>
                  <td>{fmtDateTime(a.created_at)}</td>
                  <td>
                    <span className={`tag ${a.status === 'new' ? 'red' : a.status === 'ack' ? 'amber' : 'gray'}`}>
                      {t(`alert_status_${a.status}`)}
                    </span>
                  </td>
                  <td>
                    {a.status === 'new' && (
                      <button className="btn small" onClick={() => act(a.id, 'ack')}>{t('alert_ack')}</button>
                    )}{' '}
                    {a.status !== 'closed' && (
                      <button className="btn small" onClick={() => act(a.id, 'close')}>{t('alert_close')}</button>
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
