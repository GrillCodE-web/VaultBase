import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import {
  api,
  getWorkerSnapshots,
  getAppState,
  getConfigValues,
  setConfigValue,
  checkAppUpdate,
  installAppUpdate,
} from '../api/server.js'
import { SkeletonRows } from '../components/Skeleton.jsx'

const ROLLOUT_STEPS = [0, 10, 25, 50, 100]

export default function Updates() {
  const { t } = useLang()
  const [releases, setReleases] = useState(null)
  const [versions, setVersions] = useState([])
  const [appVersion, setAppVersion] = useState('')
  const [channel, setChannel] = useState('stable')
  const [check, setCheck] = useState(null) // null | { busy } | { available, ... } | { error }
  const [installing, setInstalling] = useState(false)
  const [rolloutMsg, setRolloutMsg] = useState('')

  const load = () => {
    Promise.all([
      api('GET', '/manager/api/releases'),
      api('GET', '/manager/api/workers'),
      getWorkerSnapshots(),
      getAppState().catch(() => null),
      getConfigValues(['update_channel']).catch(() => ({})),
    ])
      .then(([rel, wres, snres, appState, cfg]) => {
        setReleases(rel.status === 200 ? rel.body.releases || [] : [])
        if (appState?.version) setAppVersion(appState.version)
        if (cfg?.update_channel === 'beta') setChannel('beta')
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

  const changeChannel = (v) => {
    setChannel(v)
    setCheck(null)
    setConfigValue('update_channel', v).catch(() => {})
  }

  const runCheck = () => {
    setCheck({ busy: true })
    checkAppUpdate()
      .then((r) => setCheck(r))
      .catch((e) => setCheck({ error: String(e) }))
  }

  const runInstall = () => {
    setInstalling(true)
    // При успехе приложение перезапускается — ответа не будет.
    installAppUpdate().catch((e) => {
      setInstalling(false)
      setCheck({ error: String(e) })
    })
  }

  const patchRollout = (version, patch) => {
    setRolloutMsg('')
    api('PATCH', `/manager/api/releases/${encodeURIComponent(version)}?file_type=manager-updater`, patch)
      .then((r) => {
        if (r.status === 200) {
          setRolloutMsg(t('rollout_saved'))
          load()
        } else {
          setRolloutMsg(r.body?.error || t('err_generic'))
        }
      })
      .catch(() => setRolloutMsg(t('err_generic')))
  }

  if (releases === null) return <SkeletonRows rows={5} />

  return (
    <div>
      {/* MGR-009: self-update manager-app с выбором канала */}
      <div className="panel">
        <h3>{t('upd_this_app')}</h3>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <span className="meta">
            {t('col_version')}: <span className="mono">{appVersion || '—'}</span>
          </span>
          <span className="meta">{t('upd_channel')}:</span>
          <select
            className="sort-select"
            value={channel}
            onChange={(e) => changeChannel(e.target.value)}
          >
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
          <button className="btn" onClick={runCheck} disabled={check?.busy || installing}>
            {check?.busy ? t('upd_checking') : t('upd_check')}
          </button>
          {check?.available && (
            <button className="btn primary" onClick={runInstall} disabled={installing}>
              {installing ? t('upd_installing') : `${t('upd_install')} → ${check.version}`}
            </button>
          )}
        </div>
        {check && !check.busy && !check.error && !check.available && (
          <div className="auth-sub" style={{ marginTop: 10 }}>{t('upd_latest')}</div>
        )}
        {check?.available && (
          <div className="auth-sub" style={{ marginTop: 10 }}>
            {t('upd_available')}: <span className="mono">{check.version}</span>
            {check.notes ? ` — ${check.notes}` : ''}
          </div>
        )}
        {check?.error && (
          <div className="error-box" style={{ marginTop: 10 }}>
            {t('upd_failed')}: {check.error}
          </div>
        )}
      </div>

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
                <th>{t('col_channel')}</th>
                <th>{t('col_rollout')}</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r, i) => {
                const isManager = r.file_type === 'manager-updater'
                return (
                  <tr key={i}>
                    <td className="mono">{r.version}</td>
                    <td><span className="tag gray">{isManager ? 'manager' : r.file_type}</span></td>
                    <td className="mono">{r.platform || '—'}</td>
                    <td>{r.published_at || '—'}</td>
                    <td>
                      {r.is_published
                        ? <span className="tag green">{t('yes')}</span>
                        : <span className="tag gray">{t('no')}</span>}
                    </td>
                    <td>
                      {isManager ? (
                        <select
                          className="sort-select"
                          value={r.channel || 'stable'}
                          onChange={(e) => patchRollout(r.version, { channel: e.target.value })}
                        >
                          <option value="stable">stable</option>
                          <option value="beta">beta</option>
                        </select>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </td>
                    <td>
                      {isManager ? (
                        <select
                          className="sort-select"
                          value={String(r.rollout_percent ?? 100)}
                          onChange={(e) =>
                            patchRollout(r.version, { rollout_percent: Number(e.target.value) })
                          }
                        >
                          {ROLLOUT_STEPS.map((p) => (
                            <option key={p} value={p}>{p}%</option>
                          ))}
                        </select>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {rolloutMsg && <div className="auth-sub" style={{ marginTop: 10 }}>{rolloutMsg}</div>}
      </div>
    </div>
  )
}
