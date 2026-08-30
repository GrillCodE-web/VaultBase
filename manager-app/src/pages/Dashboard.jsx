import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, getWorkerSnapshots, fmtRelative } from '../api/server.js'

const semKey = (v) => String(v).split(/[-+]/)[0].split('.').map((x) => parseInt(x, 10) || 0)

function cmpVer(a, b) {
  const x = semKey(a)
  const y = semKey(b)
  for (let i = 0; i < 3; i += 1) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

export default function Dashboard({ onSync }) {
  const { t, lang } = useLang()
  const [overview, setOverview] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    Promise.all([
      api('GET', '/manager/api/overview'),
      getWorkerSnapshots(),
    ])
      .then(([ov, sn]) => {
        if (ov.status !== 200) throw new Error(`overview_${ov.status}`)
        setOverview(ov.body)
        setSnapshots(sn.snapshots || [])
      })
      .catch((e) => setError(String(e)))
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [])

  if (error) {
    return (
      <div>
        <div className="error-box">{t('err_generic')}: {error}</div>
        <button className="btn primary" onClick={load}>{t('retry')}</button>
      </div>
    )
  }

  if (!overview) return <div className="empty">{t('loading')}</div>

  const isOnline = (ow) => {
    const cut = Date.now() - 15 * 60 * 1000
    if (!ow.hb_last_seen) return false
    return new Date(ow.hb_last_seen.replace(' ', 'T') + 'Z').getTime() >= cut
  }

  const verCounts = {}
  for (const s of snapshots) {
    const v = (s.snapshot || {}).app_version
    if (v) verCounts[v] = (verCounts[v] || 0) + 1
  }
  const vers = Object.keys(verCounts).sort((a, b) => cmpVer(b, a))
  const latestVer = vers[0] || null
  const outdatedCount = latestVer
    ? vers.filter((v) => cmpVer(v, latestVer) < 0).reduce((n, v) => n + verCounts[v], 0)
    : 0

  const cards = [
    ['workers_online', overview.workers_online, `${overview.workers_active}/${overview.workers_total}`, 'green'],
    ['overview_banned', overview.workers_banned, t('workers_total_hint', { n: overview.workers_total }), 'red'],
    ['alerts_new', overview.alerts_new, t('alerts_open', { n: overview.alerts_open }), overview.alerts_new > 0 ? 'amber' : ''],
    ['overview_managers', overview.managers, '', 'accent'],
    ['overview_cards', overview.cards_in_groups, `${overview.sync_groups} ${t('groups')}`, ''],
    ['overview_footprints', overview.footprints_24h, '', ''],
    ['overview_reports24', overview.reports_24h, '', ''],
    ['overview_lastver', overview.latest_release || '—', '', 'purple'],
  ]

  return (
    <div>
      <div className="grid-cards">
        {cards.map(([key, value, hint, cls]) => (
          <div className="stat-card" key={key}>
            <div className="label">{t(key)}</div>
            <div className={`value ${cls}`}>{value}</div>
            {hint && <div className="hint">{hint}</div>}
          </div>
        ))}
      </div>

      {latestVer && (
        <div className="panel">
          <h3>{t('version_drift_title')}</h3>
          <div className="ver-strip">
            {vers.map((v) => (
              <span key={v} className={`tag mono ${cmpVer(v, latestVer) < 0 ? 'red' : 'green'}`}>
                {v} × {verCounts[v]}
              </span>
            ))}
            <span className="hint" style={{ marginLeft: 'auto' }}>
              {outdatedCount > 0
                ? t('version_drift_outdated', { n: outdatedCount, v: latestVer })
                : t('version_drift_ok')}
            </span>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>{t('workers_health')}</h3>
        {snapshots.length === 0 ? (
          <div className="empty">
            {t('no_data')}
            <br />
            <button className="btn small" style={{ marginTop: 12 }} onClick={onSync}>
              {t('sync_action')}
            </button>
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_label')}</th>
                <th>{t('col_role')}</th>
                <th>{t('col_status')}</th>
                <th>{t('col_last_seen')}</th>
                <th>{t('app_version')}</th>
                <th>{t('sync_status')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const hb = s.snapshot || {}
                const isOn = isOnline(s)
                const status = !s.is_active
                  ? <span className="tag gray">{t('status_inactive')}</span>
                  : isOn
                    ? <span className="tag green">{t('status_online')}</span>
                    : <span className="tag red">{t('status_offline')}</span>
                return (
                  <tr key={s.installation_id}>
                    <td>{s.label || s.installation_id.slice(0, 14)}</td>
                    <td><span className="tag gray">{s.role || '—'}</span></td>
                    <td>{status}</td>
                    <td>{fmtRelative(s.hb_last_seen || s.last_seen, lang)}</td>
                    <td className="mono">{hb.app_version || '—'}</td>
                    <td>
                      {hb.sync_ws === 'ok'
                        ? <span className="tag green">WS ok</span>
                        : hb.sync_ws
                          ? <span className="tag red">{hb.sync_ws}</span>
                          : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="meta" style={{ color: 'var(--text-3)', fontSize: 12 }}>
        {t('server_time')}: {overview.server_time}
      </div>
    </div>
  )
}
