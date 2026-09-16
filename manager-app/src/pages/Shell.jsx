import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useLang } from '../hooks/useLang.jsx'
import { useToast } from '../hooks/useToast.jsx'
import { api, checkAppUpdate, getConfigValues, getLocalAlerts, lockApp, syncTelemetry } from '../api/server.js'
import CommandPalette from '../components/CommandPalette.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import OnboardingTour, { shouldShowTour } from '../components/OnboardingTour.jsx'

// Code splitting: каждая страница грузится отдельным чанком по первому обращению.
const Dashboard = lazy(() => import('./Dashboard.jsx'))
const Workers = lazy(() => import('./Workers.jsx'))
const Cards = lazy(() => import('./Cards.jsx'))
const Orders = lazy(() => import('./Orders.jsx'))
const Analytics = lazy(() => import('./Analytics.jsx'))
const News = lazy(() => import('./News.jsx'))
const Alerts = lazy(() => import('./Alerts.jsx'))
const Chat = lazy(() => import('./Chat.jsx'))
const Priorities = lazy(() => import('./Priorities.jsx'))
const Updates = lazy(() => import('./Updates.jsx'))
const Licenses = lazy(() => import('./Licenses.jsx'))
const Settings = lazy(() => import('./Settings.jsx'))

const PAGES = {
  dashboard: Dashboard,
  cards: Cards,
  orders: Orders,
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
  const { toast } = useToast()
  // Hash routing (P1): страница живёт в #hash — перезагрузка и «назад» не
  // сбрасывают экран; валидируем по PAGES, чтобы мусор не ломал рендер.
  const pageFromHash = () => {
    const h = window.location.hash.replace(/^#\/?/, '')
    return PAGES[h] ? h : 'dashboard'
  }
  const [page, setPageState] = useState(pageFromHash)
  const [navParams, setNavParams] = useState({})
  // 7rn: онбординг-тур — автопоказ один раз, повтор из палитры команд.
  const [tourOpen, setTourOpen] = useState(() => shouldShowTour())
  const setPage = (p) => {
    const next = PAGES[p] ? p : 'dashboard'
    window.location.hash = `/${next}`
    setPageState(next)
  }
  const navigate = (p, params) => {
    setNavParams(params || {})
    setPage(p)
  }

  // Светлая тема (data-theme на <html>); стартовая — сохранённая, иначе из
  // системных настроек (prefers-color-scheme).
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('vb-mgr-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      /* localStorage недоступен */
    }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [alertsNew, setAlertsNew] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState(null)

  useEffect(() => {
    if (theme === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem('vb-mgr-theme', theme)
    } catch {
      /* localStorage недоступен */
    }
  }, [theme])

  const idleMin = useRef(10)
  // SPEC-B (0s9): предупреждение об автоблоке за 60с + продление кликом —
  // паритет с воркером (autolock-pill). deadline=null → таймер снят/выключен.
  const [idleDeadline, setIdleDeadline] = useState(null)
  const [idleNow, setIdleNow] = useState(() => Date.now())
  const idleArmRef = useRef(null)

  useEffect(() => {
    if (!idleDeadline) return undefined
    const iv = setInterval(() => setIdleNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [idleDeadline])

  // hashchange: системная кнопка «назад» / ручная правка URL меняют страницу.
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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
      if (idleMin.current <= 0) {
        setIdleDeadline(null)
        return
      }
      setIdleDeadline(Date.now() + idleMin.current * 60000)
      timer = setTimeout(async () => {
        setIdleDeadline(null)
        await lockApp().catch(() => {})
        onLock()
      }, idleMin.current * 60000)
    }
    idleArmRef.current = arm
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }))
    arm()
    return () => {
      clearTimeout(timer)
      idleArmRef.current = null
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

  // Ручной синк (палитра / empty-state страниц): результат — тостом.
  const doSync = async () => {
    try {
      const res = await syncTelemetry()
      notifyNewAlerts(res.new_alerts)
      refreshAlerts()
      toast(
        t('toast_sync_ok', {
          workers: res.workers,
          reports: res.reports,
          fails: res.unseal_failures + res.sealed_to_other_key,
        }),
        'success'
      )
    } catch (e) {
      toast(`${t('toast_sync_fail')}: ${e}`, 'error')
    }
  }

  const Page = PAGES[page] ?? Dashboard

  const doLock = async () => {
    await lockApp().catch(() => {})
    onLock()
  }

  // Авто-синк телеметрии: realtime по WS-событию сервера (debounce 5с) +
  // fallback каждые 5 мин. Тихий — без тостов, чтобы не спамить.
  const alertsRef = useRef({ refreshAlerts, notifyNewAlerts })
  alertsRef.current = { refreshAlerts, notifyNewAlerts }

  useEffect(() => {
    const silentSync = () => {
      syncTelemetry()
        .then((res) => {
          alertsRef.current.notifyNewAlerts(res.new_alerts)
          alertsRef.current.refreshAlerts()
        })
        .catch(() => {})
    }
    silentSync()
    let debounceTimer = null
    let unlistenFn = null
    let disposed = false
    listen('telemetry:updated', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(silentSync, 5000)
    }).then((fn) => {
      if (disposed) fn()
      else unlistenFn = fn
    })
    const interval = setInterval(silentSync, 5 * 60 * 1000)
    return () => {
      disposed = true
      unlistenFn?.()
      clearTimeout(debounceTimer)
      clearInterval(interval)
    }
  }, [])

  // Фоновая проверка обновлений приложения: на старте и раз в час.
  useEffect(() => {
    let disposed = false
    const check = () => {
      checkAppUpdate()
        .then((r) => {
          if (!disposed) setUpdateInfo(r?.available ? r : null)
        })
        .catch(() => {})
    }
    check()
    const timer = setInterval(check, 60 * 60 * 1000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  // Ctrl+K / Cmd+K — палитра команд
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteActions = [
    { id: 'sync', label: t('sync_action'), run: () => doSync() },
    { id: 'lock', label: t('lock_action'), run: doLock },
    {
      id: 'theme',
      label: t('theme_toggle'),
      run: () => setTheme((v) => (v === 'dark' ? 'light' : 'dark')),
    },
    {
      id: 'lang',
      label: t('lang_toggle'),
      run: () => setLang(lang === 'ru' ? 'en' : 'ru'),
    },
    { id: 'tour', label: t('tour_replay'), run: () => setTourOpen(true) },
  ]

  const nav = useMemo(
    () => [
      ['dashboard', 'nav_dashboard'],
      ['cards', 'nav_cards'],
      ['orders', 'nav_orders'],
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

  const paletteNav = nav.map(([id, label]) => ({
    page: id,
    label: t(label),
    run: () => navigate(id),
  }))

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
            aria-current={page === id ? 'page' : undefined}
          >
            {t(label)}
            {id === 'alerts' && alertsNew > 0 && <span className="badge">{alertsNew}</span>}
          </button>
        ))}
        <div className="spacer" />
        <button className="nav-item" onClick={doLock}>
          {t('lock_action')}
        </button>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="title">{t('nav_' + page)}</div>
          {updateInfo && (
            <button
              type="button"
              className="update-banner"
              onClick={() => navigate('updates')}
              title={t('update_banner_action')}
            >
              {t('update_available', { version: updateInfo.version })}
            </button>
          )}
          {idleDeadline && idleDeadline - idleNow <= 60000 && (
            <button
              type="button"
              className="autolock-pill mono"
              onClick={() => idleArmRef.current?.()}
              title={t('autolock_extend_hint')}
            >
              {t('autolock_in', { s: Math.max(0, Math.ceil((idleDeadline - idleNow) / 1000)) })}
            </button>
          )}
          <button
            className="btn small"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('palette_open_hint')}
            title={t('palette_open_hint')}
          >
            ⌘K
          </button>
          <button
            className="btn small"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label={t('theme_toggle')}
            title={t('theme_toggle')}
          >
            {theme === 'light' ? '☀' : '☾'}
          </button>
          <button
            className="btn small"
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
            aria-label={t('lang_toggle')}
            title={t('lang_toggle')}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
          <div className="meta mono">{appState.role || 'manager'}</div>
        </div>
        <div className="content">
          <ErrorBoundary resetKey={page}>
            <Suspense
              fallback={
                <div className="center-screen" role="status">
                  <span className="spinner" aria-hidden="true" />
                </div>
              }
            >
              <div className="page-enter" key={page}>
                <Page appState={appState} onSync={doSync} onAlertsChanged={refreshAlerts} onNavigate={navigate} navParams={navParams} onLock={onLock} />
              </div>
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          actions={paletteActions}
          navItems={paletteNav}
        />
      )}
      <OnboardingTour t={t} open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  )
}
