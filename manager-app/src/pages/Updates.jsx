import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, getWorkerSnapshots } from '../api/server.js'

export default function Updates() {
  const { t } = useLang()
  const [releases, setReleases] = useState(null)
  const [versions, setVersions] = useState([])

  const load = () => {
    Promise.all([
      api('GET', '/manager/api/releases'),
      api('GET', '/manager/api/workers'),
      getWorkerSnapshots(),
    ])
      .then(([rel, wres, snres]) => {
        setReleases(rel.status === 200 ? rel.body.releases || [] : [])
        const pol = {}
        if (wres.status === 200) {
          for (const w of wres.body.workers || []) {
            pol[w.installation_id] = w
          }
        }
        const byVer = {}
        for (const s of snres.snapshots || []) {
          const ver = s.snapshot?.app_version
          if (!ver) continue
          if (!byVer[ver]) {
            byVer[ver] = { version: ver, workers: [], min: pol[s.installation_id]?.min_version }
          }
          byVer[ver].workers.push(s.label || s.installation_id.slice(0, 12))
        }
        setVersions(Object.values(byVer).sort((a, b) => b.version.localeCompare(a.version)))
      })
      .catch(() => setReleases([]))
  }

  useEffect(load, [])

  const compareVer = (a, b) => a.localeCompare(b, undefined, { numeric: true })

  if (releases === null) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <div className="panel">
        <h3>{t('workers_versions')}</h3>
        {versions.length === 0 ? (
          <div className="empty">{t('no_data')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('version_col')}</th>
                <th>{t('workers_on')}</th>
                <th>{t('below_min')}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const outdated = v.min && compareVer(v.version, v.min) < 0
                return (
                  <tr key={v.version}>
                    <td className="mono">{v.version}</td>
                    <td style={{ color: 'var(--text-2)' }}>{v.workers.join(', ')}</td>
                    <td>
                      {outdated
                        ? <span className="tag red">{t('yes')} ({v.min})</span>
                        : <span className="tag gray">{t('no')}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>{t('updates_title')}</h3>
        <div className="auth-sub" style={{ marginBottom: 14 }}>{t('updates_intro')}</div>
        {releases.length === 0 ? (
          <div className="empty">{t('no_releases')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_version')}</th>
                <th>{t('col_type')}</th>
                <th>{t('col_platform')}</th>
                <th>{t('col_published')}</th>
                <th>{t('published_status')}</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.version}</td>
                  <td><span className="tag gray">{r.file_type === 'manager-updater' ? 'manager' : r.file_type}</span></td>
                  <td className="mono">{r.platform || '—'}</td>
                  <td>{r.published_at || '—'}</td>
                  <td>
                    {r.is_published
                      ? <span className="tag green">{t('yes')}</span>
                      : <span className="tag gray">{t('no')}</span>}
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
