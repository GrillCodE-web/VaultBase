import { useEffect, useMemo, useRef, useState } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useLang } from '../hooks/useLang.jsx'
import { api, getConfigValues, getLocalAlerts, lockApp, syncTelemetry } from '../api/server.js'
import Dashboard from './Dashboard.jsx'
import Workers from './Workers.jsx'
import Cards from './Cards.jsx'
import Analytics from './Analytics.jsx'
import News from './News.jsx'
import Alerts from './Alerts.jsx'
import Chat from './Chat.jsx'
import Priorities from './Priorities.jsx'
import Updates from './Updates.jsx'
import Licenses from './Licenses.jsx'
import Settings from './Settings.jsx'

const PAGES = {
  dashboard: Dashboard,
  cards: Cards,
  workers: Workers,
  analytics: Analytics,
  news: News,
  alerts: Alerts,
  chat: Chat,
  priorities: Priorities,
  updates: Updates,
  licenses: Licenses,
  settings: Settings,
}

export default function Shell({ appState, onLock }) {
  const { t, lang, setLang } = useLang()
  const [page, setPage] = useState('dashboard')
  const [navParams, setNavParams] = useState({})
  const navigate = (p, params) => {
    setNavParams(params || {})
    setPage(p)
  }
  const [alertsNew, setAlertsNew] = useState(0)
  const [syncInfo, setSyncInfo] = useState('')
  const [syncing, setSyncing] = useState(false)

  const idleMin = useRef(10)

  const refreshAlerts = () => {
    const serverNew = api('GET', '/manager/api/alerts?status=new&limit=100')
      .then((r) => (r.status === 200 && Array.isArray(r.body?.alerts) ? r.body.alerts.length : 0))
      .catch(() => 0)
    const localNew = getLocalAlerts('new')
      .then((r) => (Array.isArray(r.alerts) ? r.alerts.length : 0))
      .catch(() => 0)
    Promise.all([serverNew, localNew]).then(([s, l]) => setAlertsNew(s + l))
  }

  useEffect(() => {
    refreshAlerts()
    const timer = setInterval(refreshAlerts, 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    getConfigValues(['idle_lock_min'])
      .then((cfg) => {
        const n = parseInt(cfg.idle_lock_min, 10)
        if (!Number.isNaN(n)) idleMin.current = n
      })
      .catch(() => {})
    let timer
    const arm = () => {
      clearTimeout(timer)
      if (idleMin.current <= 0) return
      timer = setTimeout(async () => {
        await lockApp().catch(() => {})
        onLock()
      }, idleMin.current * 60000)
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    arm()
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, arm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const notifyNewAlerts = async (newAlerts) => {
    if (!Array.isArray(newAlerts) || newAlerts.length === 0) return
    const cfg = await getConfigValues(['alert_notify_os']).catch(() => ({}))
    if (cfg.alert_notify_os === '0') return
    let granted = await isPermissionGranted().catch(() => false)
    if (!granted) {
      granted = (await requestPermission().catch(() => 'denied')) === 'granted'
    }
    if (!granted) return
    const top = newAlerts[0]
    sendNotification({
      title: t('notify_alerts_title'),
      body: newAlerts.length === 1
        ? top.title
        : t('notify_alerts_body', { n: newAlerts.length, title: top.title }),
    })
  }

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
      notifyNewAlerts(res.new_alerts)
      refreshAlerts()
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
      ['cards', 'nav_cards'],
      ['workers', 'nav_workers'],
      ['analytics', 'nav_analytics'],
      ['news', 'nav_news'],
      ['alerts', 'nav_alerts'],
      ['chat', 'nav_chat'],
      ['priorities', 'nav_priorities'],
      ['updates', 'nav_updates'],
      ['licenses', 'nav_licenses'],
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
          <Page appState={appState} onSync={doSync} onAlertsChanged={refreshAlerts} onNavigate={navigate} navParams={navParams} />
        </div>
      </div>
    </div>
  )
}
