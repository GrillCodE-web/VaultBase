import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, lockApp, syncTelemetry } from '../api/server.js'
import Dashboard from './Dashboard.jsx'
import Workers from './Workers.jsx'
import Analytics from './Analytics.jsx'
import News from './News.jsx'
import Alerts from './Alerts.jsx'
import Priorities from './Priorities.jsx'
import Updates from './Updates.jsx'
import Settings from './Settings.jsx'

const PAGES = {
  dashboard: Dashboard,
  workers: Workers,
  analytics: Analytics,
  news: News,
  alerts: Alerts,
  priorities: Priorities,
  updates: Updates,
  settings: Settings,
}

export default function Shell({ appState, onLock }) {
  const { t, lang, setLang } = useLang()
  const [page, setPage] = useState('dashboard')
  const [alertsNew, setAlertsNew] = useState(0)
  const [syncInfo, setSyncInfo] = useState('')
  const [syncing, setSyncing] = useState(false)

  const refreshAlerts = () => {
    api('GET', '/manager/api/alerts?status=new&limit=1')
      .then((r) => {
        if (r.status === 200 && Array.isArray(r.body?.alerts)) setAlertsNew(r.body.alerts.length)
      })
      .catch(() => {})
  }

  useEffect(() => {
    refreshAlerts()
    const timer = setInterval(refreshAlerts, 30000)
    return () => clearInterval(timer)
  }, [])

  const doSync = async () => {
    setSyncing(true)
    setSyncInfo('')
    try {
      const res = await syncTelemetry()
      setSyncInfo(t('sync_result', {
        workers: res.workers,
        reports: res.reports,
        fails: res.unseal_failures + res.sealed_to_other_key,
      }))
    } catch (e) {
      setSyncInfo(`${t('err_generic')}: ${e}`)
    } finally {
      setSyncing(false)
    }
  }

  const Page = PAGES[page] ?? Dashboard

  const nav = useMemo(
    () => [
      ['dashboard', 'nav_dashboard'],
      ['workers', 'nav_workers'],
      ['analytics', 'nav_analytics'],
      ['news', 'nav_news'],
      ['alerts', 'nav_alerts'],
      ['priorities', 'nav_priorities'],
      ['updates', 'nav_updates'],
      ['settings', 'nav_settings'],
    ],
    []
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          VaultBase Manager
        </div>
        {nav.map(([id, label]) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => setPage(id)}
          >
            {t(label)}
            {id === 'alerts' && alertsNew > 0 && <span className="badge">{alertsNew}</span>}
          </button>
        ))}
        <div className="spacer" />
        <button className="nav-item" onClick={doSync} disabled={syncing}>
          {syncing ? t('syncing') : t('sync_action')}
        </button>
        <button
          className="nav-item"
          onClick={async () => {
            await lockApp()
            onLock()
          }}
        >
          {t('lock_action')}
        </button>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="title">{t('nav_' + page)}</div>
          {syncInfo && <div className="meta">{syncInfo}</div>}
          <button className="btn small" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
          <div className="meta mono">{appState.role || 'manager'}</div>
        </div>
        <div className="content">
          <Page appState={appState} onSync={doSync} onAlertsChanged={refreshAlerts} />
        </div>
      </div>
    </div>
  )
}
