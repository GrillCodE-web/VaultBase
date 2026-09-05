import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { handleError } from './utils/errorHandler.js'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LangProvider, useLang } from './hooks/useLang'
import { SmartToastProvider, useToast } from './hooks/useSmartToast'
import { ConfirmProvider } from './hooks/useConfirm'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { useIdleTimer } from './hooks/useIdleTimer'
import { useSyncFreshness } from './hooks/useSyncFreshness.js'
import { useLiteRules } from './hooks/useLiteRules.js'
import { maybeSendDailyDigest } from './utils/dailyDigest.js'
import { applySeasonAttr } from './utils/season.js'
import ErrorBoundary from './components/ErrorBoundary'
import ShortcutsHelp from './components/ShortcutsHelp'
import { AppTour } from './components/AppTour'
import NewsAlert from './components/NewsAlert'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useTheme } from './hooks/useTheme'
import { useDensity } from './hooks/useDensity'
import { Menu } from './components/Menu'
import CommandPalette from './components/CommandPalette'
import { HEX_COLORS } from './constants/colors.js'
import { isUnauthorizedError } from './utils/errorHandler.js'
// FIX CRITICAL: Use safe localStorage operations
import { safeGetItem, safeSetItem } from './utils/localStorage'
import { useOrdersStore } from './store/orders.js'
import { useCardsStore } from './store/cards.js'
import { useNotificationsStore } from './store/notifications.js'
import { NotificationCenter } from './components/NotificationCenter.jsx'
import { TasksIndicator } from './components/TasksIndicator.jsx'
// REDESIGN-05-6: panic-модалка (хоткей/трей), tray:sync, глобальный D&D импорт
import { DesktopBridge } from './components/DesktopBridge.jsx'
// SPRINT3-DAY2: Structured logging
import { createLogger } from './utils/logger'
// UX-012: нативные OS-уведомления (новая почта, статус посылки, ошибки sync)
import { osNotify } from './utils/osNotify.js'

const logger = createLogger('App')

// Auth screens — loaded immediately (shown before app)
import Login from './pages/Login'
import UserLogin from './pages/UserLogin'
import Activate from './pages/Activate'

// App pages — lazy loaded to improve startup time
const Dashboard = lazy(() => import('./pages/DashboardRedesigned'))
const Cards = lazy(() => import('./pages/Cards'))
const Profiles = lazy(() => import('./pages/Profiles'))
const Drops = lazy(() => import('./pages/Drops'))
const Orders = lazy(() => import('./pages/Orders'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Shops = lazy(() => import('./pages/Shops'))
const ProxyList = lazy(() => import('./pages/Proxies'))
const Imap = lazy(() => import('./pages/Imap'))
const Chat = lazy(() => import('./pages/Chat'))
const Couriers = lazy(() => import('./pages/Couriers'))
const ActivityLog = lazy(() => import('./pages/ActivityLog'))
const Settings = lazy(() => import('./pages/Settings'))
const Updates = lazy(() => import('./pages/Updates'))
const Onboarding = lazy(() => import('./pages/Onboarding'))

import {
  LayoutDashboard,
  CreditCard,
  Users,
  ShoppingCart,
  Store,
  Shield,
  Truck,
  Inbox,
  MessagesSquare,
  ClipboardList,
  Settings as SettingsIcon,
  Globe,
  AlertTriangle,
  BookOpen,
  Search,
  Bell,
  Plus,
  Sun,
  Moon,
  Monitor,
  LogOut,
  RefreshCw,
  Lock,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// View states:
// "checking" → spinner
// "activate" → no license → Activate.jsx
// "revoked"  → license revoked
// "auth"     → password required → Login.jsx
// "app"      → fully unlocked
// ─────────────────────────────────────────────────────────────

const PAGE_MAP = {
  dashboard: Dashboard,
  cards: Cards,
  profiles: Profiles,
  drops: Drops,
  orders: Orders,
  catalog: Catalog,
  shops: Shops,
  proxies: ProxyList,
  couriers: Couriers,
  imap: Imap,
  chat: Chat,
  activity_log: ActivityLog,
  updates: Updates,
  settings: Settings,
  onboarding: Onboarding,
}

// ─── Spinner ─────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="spinner-container">
        <div className="spinner" />
        <span className="text-13 text-muted">Loading…</span>
      </div>
    </div>
  )
}

// ─── Revoked Screen ───────────────────────────────────────────

function RevokedScreen() {
  const { t } = useLang()
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="revoked-card">
        <div className="revoked-icon-box">
          <AlertTriangle size={28} style={{ color: HEX_COLORS.red }} />
        </div>
        <h1 className="revoked-title">{t('license_revoked_title') || 'License Revoked'}</h1>
        <p className="revoked-text">
          {t('license_revoked_body') ||
            'Your license has been revoked. Please contact your administrator.'}
        </p>
      </div>
    </div>
  )
}

// ─── MGR-005: блокирующий экран «обнови приложение» ─────────────
// Сервер ставит update_required, когда X-App-Version ниже policy.min_version
// (воркеры с version_exempt сюда не попадают — сервер их не помечает).

function UpdateRequiredScreen({ minVersion }) {
  const { t } = useLang()
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="revoked-card">
        <div className="revoked-icon-box">
          <AlertTriangle size={28} style={{ color: HEX_COLORS.yellow }} />
        </div>
        <h1 className="revoked-title">{t('policy_update_title') || 'Update Required'}</h1>
        <p className="revoked-text">{t('policy_update_body', { version: minVersion || '' })}</p>
      </div>
    </div>
  )
}

// ─── Keyboard Shortcuts Popup (removed - now using ShortcutsHelp component) ─────

// ─── Main Shell ───────────────────────────────────────────────

function MainShell({ offlineMode, setOfflineMode, onSessionTimeout }) {
  const { t, lang, setLang } = useLang()
  const { toast, info: toastInfo } = useToast()
  const { currentUser, logout, isAdmin, hasPerm } = useAuth()

  // Handle 401 unauthorized errors globally
  const handleUnauthorized = useCallback(async () => {
    toast('Сессия истекла. Пожалуйста, войдите снова.', 'error')
    await logout()
    onSessionTimeout?.()
  }, [logout, onSessionTimeout, toast])

  const {
    warningActive,
    remainingSeconds,
    deadline: idleDeadline,
    reset: extendIdle,
  } = useIdleTimer({
    onIdle: onSessionTimeout,
    timeoutMs: 30 * 60 * 1000,
    warningBeforeMs: 2 * 60 * 1000,
    enabled: !!currentUser && !!onSessionTimeout,
  })

  // REDESIGN-05-4: «данные устарели» — последний sync старше 5 минут
  const { stale: dataStale } = useSyncFreshness()

  // REDESIGN-05-4 (порция 3): lite-правила — периодическая оценка,
  // подсветка строк + уведомления
  useLiteRules()

  // REDESIGN-05-4 (порция 4): дневной дайджест — раз в день в центр
  // уведомлений (после прогрева приложения, чтобы не спорить со стартовой
  // синхронизацией)
  useEffect(() => {
    const timer = setTimeout(() => {
      maybeSendDailyDigest(t).catch(() => {})
    }, 6000)
    return () => clearTimeout(timer)
  }, [t])

  // FIX P2-STATUS-01: WS sync connection status
  const [wsStatus, setWsStatus] = React.useState(null) // { connected, connecting }

  React.useEffect(() => {
    let unlistenFn = null
    listen('ws_sync:status', e => {
      setWsStatus(e.payload)
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
  }, [])

  // ERR-003: потеря sync-соединения — toast на всех страницах (не только Cards).
  // Срабатывает только на переходе connected → disconnected, не при старте.
  const wsWasConnectedRef = React.useRef(false)
  React.useEffect(() => {
    if (!wsStatus) return
    if (wsStatus.connected) {
      wsWasConnectedRef.current = true
    } else if (!wsStatus.connecting && wsWasConnectedRef.current) {
      wsWasConnectedRef.current = false
      toast(t('sync_lost_warn'), 'warning', { duration: 6000 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsStatus])

  const TOPBAR_TABS = {
    cards: [
      { key: 'list', label: t('nav_cards') },
      { key: 'expiring', label: t('section_expiring') },
    ],
    orders: [
      { key: 'list', label: t('orders') },
      { key: 'pending', label: t('pending') },
      { key: 'delivered', label: t('delivered') },
    ],
    profiles: [
      { key: 'list', label: t('profiles') },
      { key: 'nodrop', label: t('filter_no_drop') },
    ],
    catalog: [
      { key: 'items', label: 'Items' },
      { key: 'shops', label: 'Shops' },
    ],
    shops: [{ key: 'list', label: t('shops') }],
    proxies: [{ key: 'list', label: t('proxy_manager') }],
    couriers: [
      { key: 'assigned', label: t('couriers_tab_assigned') },
      { key: 'available', label: t('couriers_tab_available') },
      { key: 'shared', label: t('couriers_tab_shared') },
      { key: 'packages', label: t('couriers_tab_packages') },
    ],
    // imap — без топбар-табов: страница сама 3-панельный почтовый клиент,
    // табы Accounts/Inbox дублировали её шапку и ничего не переключали.
    imap: [],
    // chat — тоже без топбар-табов: 2-панельный мессенджер со своей шапкой.
    chat: [],
    activity_log: [{ key: 'list', label: t('log_title') }],
    updates: [{ key: 'list', label: t('updates_title') }],
    dashboard: [],
    settings: [],
    drops: [],
  }
  const { theme, cycleTheme } = useTheme()
  const { density, setDensity } = useDensity()
  const [page, setPage] = useState('dashboard')
  const [pageProps, setPageProps] = useState({})
  const [activeTab, setActiveTab] = useState('list')
  const [badges, setBadges] = useState({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // REDESIGN-05-1: UTC-часы статус-бара (тик раз в секунду)
  const [nowUtc, setNowUtc] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNowUtc(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const [showOnboarding, setShowOnboarding] = useState(false)
  // UX-013: интерактивный тур (react-joyride) — после онбординга или по кнопке в Settings
  const [tourRun, setTourRun] = useState(false)
  const prevImapRef = useRef(0)

  // Navigate from Dashboard quick actions / heatmap click
  // setActiveTab в deps: сеттер передаётся пропом onTabChange в PageComponent,
  // и React Compiler перестаёт считать его доказуемо стабильным — без deps
  // падает react-hooks/preserve-manual-memoization. Рантайм-эффекта нет:
  // сеттеры useState стабильны.
  const handleNavigate = useCallback(
    (targetPage, props = {}) => {
      setPage(targetPage)
      setPageProps(props)
      setActiveTab('list')
    },
    [setActiveTab]
  )

  // Navigate from sidebar / keyboard shortcuts
  const handlePageChange = useCallback(
    p => {
      setPage(p)
      setPageProps({})
      setActiveTab(p === 'couriers' ? 'assigned' : 'list')
    },
    [setActiveTab]
  )

  const loadBadges = useCallback(async () => {
    try {
      const b = await invoke('get_sidebar_badges')
      setBadges(b)
    } catch (e) {
      if (isUnauthorizedError(e)) {
        handleUnauthorized()
      }
      // Silently fail - badges will retry on next interval
    }
  }, [handleUnauthorized])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка бейджей при монтировании
    loadBadges()
    const id = setInterval(loadBadges, 30_000)
    return () => clearInterval(id)
  }, [loadBadges])

  // ── Глобальная проверка обновлений ─────────────────────────
  // Раньше обновления проверялись ТОЛЬКО на странице Updates.jsx — если
  // пользователь там не был, он не видел ни баннера, ни уведомления, ни
  // точки в меню. Теперь проверка идёт из App при старте и раз в 6 часов:
  // ставит бейдж на пункт «Обновления» (Bell) и показывает тост один раз
  // на версию. Тихо игнорируем ошибки — скорее всего нет интернета.
  const [updateReady, setUpdateReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const checkForUpdate = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (cancelled || !update) return
        setUpdateReady(true)
        // Тост один раз на версию — чтобы не повторялся каждые 6 часов.
        const notifiedKey = 'vb_update_notified'
        let notified = null
        try {
          notified = sessionStorage.getItem(notifiedKey)
        } catch (e) {
          handleError(e)
          /* ignore */
        }
        if (notified !== update.version) {
          toastInfo((t('upd_available_toast') || 'Доступно обновление') + ` ${update.version}`, {
            groupKey: 'app_update',
          })
          // REDESIGN-05-4: доступное обновление — тоже в центр уведомлений
          useNotificationsStore.getState().add({
            key: `upd:${update.version}`,
            kind: 'system',
            severity: 'info',
            title: `${t('upd_available_toast')} ${update.version}`,
          })
          try {
            sessionStorage.setItem(notifiedKey, update.version)
          } catch (e) {
            handleError(e)
            /* ignore */
          }
        }
      } catch (e) {
        console.error('[App] update check failed:', e?.message || e)
      }
    }
    checkForUpdate()
    const id = setInterval(checkForUpdate, 6 * 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [t, toastInfo])

  useEffect(() => {
    let done
    try {
      done = !!safeGetItem('onboarding_done')
    } catch (e) {
      handleError(e)
      done = false
    }
    if (!done) {
      invoke('get_cards', { page: 1, perPage: 1 })
        .then(r => {
          if (r.total === 0) setShowOnboarding(true)
        })
        .catch(e => {
          // FIX FE-H05: Log error instead of silently ignoring
          if (import.meta.env.DEV) console.error('[App] Failed to check cards for onboarding:', e)
        })
    }
  }, [])

  // UX-013: ручной перезапуск тура из Settings
  useEffect(() => {
    const start = () => setTourRun(true)
    window.addEventListener('vb:start-tour', start)
    return () => window.removeEventListener('vb:start-tour', start)
  }, [])

  const handleTourFinish = () => {
    setTourRun(false)
    try {
      safeSetItem('vb_ui_tour_done', '1')
    } catch {
      // localStorage недоступен — тур просто запустится при следующем старте
    }
  }

  // UX-013: тур стартует один раз после завершения онбординга
  const maybeStartTour = () => {
    try {
      if (!safeGetItem('vb_ui_tour_done')) setTourRun(true)
    } catch {
      setTourRun(true)
    }
  }

  // Атрибут data-theme и localStorage — забота useTheme.

  // REDESIGN-05-4 (порция 5): сезонный акцент — data-season на <html>;
  // вне сезонных окон атрибут снимается, визуал не меняется
  useEffect(() => {
    applySeasonAttr()
    const timer = setInterval(applySeasonAttr, 3_600_000)
    return () => clearInterval(timer)
  }, [])

  // Live region announcement for IMAP updates
  const [imapAnnouncement, setImapAnnouncement] = useState('')

  // L: IMAP toast when new messages arrive
  useEffect(() => {
    let unlistenFn = null
    listen('badge_update', e => {
      const b = e.payload
      if (b) {
        const prev = prevImapRef.current
        const next = b.unread_imap ?? 0
        if (next > prev) {
          const count = next - prev
          const msg = `${count} new IMAP message${count > 1 ? 's' : ''}`
          toastInfo(msg)
          setImapAnnouncement(msg)
        }
        prevImapRef.current = next
        setBadges(b)
      }
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SEC-018: алерт при устойчивом отвале IMAP-аккаунта (3+ подряд ошибки поллинга)
  useEffect(() => {
    let unlistenFn = null
    listen('imap_connection_alert', e => {
      const p = e.payload
      if (!p) return
      const shortErr = String(p.error || '').slice(0, 120)
      toast(`${t('imap_conn_alert')} #${p.account_id}: ${shortErr}`, 'error')
      osNotify(
        'os_notify_errors',
        t('notify_imap_alert_title'),
        t('notify_imap_alert_body', { id: p.account_id, error: shortErr })
      )
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FEAT-006: напоминание о картах с истекающим сроком (cron на бэке, раз в сутки)
  useEffect(() => {
    let unlistenFn = null
    listen('card_expiry_reminder', e => {
      const p = e.payload
      if (!p || !p.count) return
      toast(t('reminder_card_expiry_toast', { count: p.count, days: p.days }), 'warning', {
        duration: 10000,
        groupKey: 'card_expiry_reminder',
        action: {
          label: t('reminder_open_cards'),
          onClick: () => {
            handlePageChange('cards')
            setActiveTab('expiring')
          },
        },
      })
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FEAT-007: напоминание проверить «застоявшиеся» трекинги (cron на бэке, раз в сутки)
  useEffect(() => {
    let unlistenFn = null
    listen('tracking_stale_reminder', e => {
      const p = e.payload
      if (!p || !p.count) return
      toast(t('reminder_tracking_stale_toast', { count: p.count, days: p.days }), 'warning', {
        duration: 10000,
        groupKey: 'tracking_stale_reminder',
        action: {
          label: t('reminder_open_orders'),
          onClick: () => handlePageChange('orders'),
        },
      })
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // UX-012: нативные OS-уведомления — новая почта, смена статуса посылки, сбой sync.
  // Тоглы: Settings → OS Notifications (config os_notify_*; '0' = выкл, дефолт вкл).
  useEffect(() => {
    let unlistenFns = []
    let isMounted = true
    Promise.all([
      listen('new_imap_message', e => {
        const p = e.payload
        if (!p) return
        osNotify(
          'os_notify_mail',
          t('notify_mail_title'),
          t('notify_mail_body', { from: p.from || '—', subject: p.subject || '' })
        )
      }),
      listen('order_status_update', e => {
        const p = e.payload
        if (!p) return
        const statusKey = `status_${p.status}`
        const statusLabel = t(statusKey)
        osNotify(
          'os_notify_package',
          t('notify_package_title'),
          t('notify_package_body', {
            tracking: p.tracking_number || '—',
            status: statusLabel === statusKey ? p.status : statusLabel,
          })
        )
      }),
      listen('sync_failed', e => {
        const p = e.payload
        osNotify(
          'os_notify_errors',
          t('notify_sync_failed_title'),
          t('notify_sync_failed_body', { message: String((p && p.message) || '').slice(0, 120) })
        )
        // REDESIGN-05-4: sync-алерт в центр уведомлений
        useNotificationsStore.getState().add({
          kind: 'sync',
          severity: 'error',
          title: t('notify_sync_failed_title'),
          body: String((p && p.message) || '').slice(0, 120),
        })
      }),
    ])
      .then(fns => {
        if (isMounted) {
          unlistenFns = fns
        } else {
          fns.forEach(fn => fn && fn())
        }
      })
      .catch(err => {
        if (import.meta.env.DEV) console.error('[App] OS notify listeners failed:', err)
      })
    return () => {
      isMounted = false
      unlistenFns.forEach(fn => {
        if (typeof fn === 'function') {
          try {
            fn()
          } catch (e) {
            if (import.meta.env.DEV) console.error('[App] Error cleaning up OS notify listener:', e)
          }
        }
      })
      unlistenFns = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FEAT-003: smart-подсказки (cron на бэке, раз в сутки)
  useEffect(() => {
    let unlistenFn = null
    listen('smart_hints', e => {
      const hints = e.payload?.hints
      if (!Array.isArray(hints)) return
      hints.forEach(hint => {
        if (hint.kind === 'card_burning') {
          toast(
            t('smart_tip_card_burning', {
              last4: hint.last4 || '????',
              declines: hint.declines,
              threshold: hint.threshold,
            }),
            'warning',
            {
              duration: 10000,
              groupKey: `smart_hint_card_${hint.card_id}`,
              action: { label: t('reminder_open_cards'), onClick: () => handlePageChange('cards') },
            }
          )
        } else if (hint.kind === 'order_fail_streak') {
          toast(t('smart_tip_order_fail_streak', { count: hint.count }), 'warning', {
            duration: 10000,
            groupKey: 'smart_hint_order_streak',
            action: { label: t('reminder_open_orders'), onClick: () => handlePageChange('orders') },
          })
        }
      })
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // SEC-024: предупреждение при работе на непроверенной лицензии (offline grace)
  const licenseOfflineWarnedRef = useRef(false)
  useEffect(() => {
    if (offlineMode && !licenseOfflineWarnedRef.current) {
      licenseOfflineWarnedRef.current = true
      toast(t('license_offline_warn'), 'warning', { duration: 8000 })
    }
    if (!offlineMode) licenseOfflineWarnedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineMode])

  // J: Server online/offline events
  // FIX FE-03: Properly handle Promise.all cleanup with error handling
  useEffect(() => {
    let unlistenFns = []
    let isMounted = true

    const setupListeners = async () => {
      try {
        const [unlisten1, unlisten2] = await Promise.all([
          listen('server_online', () => {
            if (isMounted) {
              setOfflineMode(false)
              toast('Connection restored', 'success')
            }
          }),
          listen('server_offline', () => {
            if (isMounted) {
              setOfflineMode(true)
              toast('Connection lost — Sync, Risk check, BIN lookup unavailable', 'error')
              osNotify(
                'os_notify_errors',
                t('notify_sync_offline_title'),
                t('notify_sync_offline_body')
              )
            }
          }),
        ])
        if (isMounted) {
          unlistenFns = [unlisten1, unlisten2]
        }
      } catch (error) {
        if (isMounted && import.meta.env.DEV) {
          console.error('[App] Failed to setup server event listeners:', error)
        }
      }
    }

    setupListeners()

    return () => {
      isMounted = false
      unlistenFns.forEach(fn => {
        if (typeof fn === 'function') {
          try {
            fn()
          } catch (e) {
            if (import.meta.env.DEV) console.error('[App] Error cleaning up event listener:', e)
          }
        }
      })
      unlistenFns = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Admin live notifications: card taken / order created by operator
  useEffect(() => {
    if (!isAdmin) return

    let fns = []
    let isMounted = true // FIX CRITICAL: Track mount state

    Promise.all([
      listen('admin:card_taken', e => {
        if (!isMounted) return // FIX CRITICAL: Check before action
        const p = e.payload
        toast(`Оператор ${p.username} взял карту #${p.card_id}`, 'info')
      }),
      listen('admin:order_created', e => {
        if (!isMounted) return // FIX CRITICAL: Check before action
        const p = e.payload
        toast(`${p.username} создал заказ #${p.order_id}`, 'info')
      }),
    ])
      .then(unlisten => {
        if (isMounted) {
          // FIX CRITICAL: Only set if still mounted
          fns = unlisten
        } else {
          // FIX CRITICAL: Clean up immediately if unmounted
          unlisten.forEach(fn => fn?.())
        }
      })
      .catch(e => {
        if (import.meta.env.DEV) {
          console.error('[App] Failed to setup admin listeners:', e)
        }
      })

    return () => {
      isMounted = false // FIX CRITICAL: Mark as unmounted
      fns.forEach(fn => fn?.())
    }
  }, [isAdmin, toast])

  // Global keyboard shortcuts using new system
  const keyboardShortcuts = [
    // Global search
    {
      keys: ['Meta+k', 'Control+k'],
      handler: () => setSearchOpen(v => !v),
    },
    // Close modals/search
    {
      keys: ['Escape'],
      handler: () => {
        setSearchOpen(false)
        setShowShortcuts(false)
      },
    },
    // Show shortcuts help
    {
      keys: ['?'],
      handler: () => setShowShortcuts(v => !v),
      requireNoInput: true,
    },
    // Navigation shortcuts (Alt+1-9, Alt+0)
    {
      keys: ['Alt+1'],
      handler: () => handlePageChange('dashboard'),
    },
    {
      keys: ['Alt+2'],
      handler: () => handlePageChange('cards'),
    },
    {
      keys: ['Alt+3'],
      handler: () => handlePageChange('profiles'),
    },
    {
      keys: ['Alt+4'],
      handler: () => handlePageChange('orders'),
    },
    {
      keys: ['Alt+5'],
      handler: () => handlePageChange('shops'),
    },
    {
      keys: ['Alt+6'],
      handler: () => handlePageChange('proxies'),
    },
    {
      keys: ['Alt+7'],
      handler: () => handlePageChange('imap'),
    },
    {
      keys: ['Alt+8'],
      handler: () => handlePageChange('activity_log'),
    },
    {
      keys: ['Alt+9'],
      handler: () => handlePageChange('updates'),
    },
    {
      keys: ['Alt+0'],
      handler: () => handlePageChange('settings'),
    },
    // Vim-style navigation (g then key)
    {
      keys: ['g d'],
      handler: () => handlePageChange('dashboard'),
      requireNoInput: true,
    },
    {
      keys: ['g c'],
      handler: () => handlePageChange('cards'),
      requireNoInput: true,
    },
    {
      keys: ['g p'],
      handler: () => handlePageChange('profiles'),
      requireNoInput: true,
    },
    {
      keys: ['g o'],
      handler: () => handlePageChange('orders'),
      requireNoInput: true,
    },
    {
      keys: ['g s'],
      handler: () => handlePageChange('shops'),
      requireNoInput: true,
    },
    {
      keys: ['g m'],
      handler: () => handlePageChange('imap'),
      requireNoInput: true,
    },
    {
      keys: ['g t'],
      handler: () => handlePageChange('chat'),
      requireNoInput: true,
    },
    {
      keys: ['g x'],
      handler: () => handlePageChange('proxies'),
      requireNoInput: true,
    },
    // Settings shortcut
    {
      keys: ['Meta+,', 'Control+,'],
      handler: () => handlePageChange('settings'),
    },
    // Focus search input
    {
      keys: ['f', '/'],
      handler: () => {
        document
          .querySelector(
            'input[type="search"], input[placeholder*="earch"], input[placeholder*="EARCH"]'
          )
          ?.focus()
      },
      requireNoInput: true,
    },
    // Refresh current page
    {
      keys: ['r'],
      handler: () => {
        document.querySelector('[data-shortcut="refresh"]')?.click()
      },
      requireNoInput: true,
    },
    // Create new item (context-aware)
    {
      keys: ['n'],
      handler: () => {
        document.querySelector('[data-shortcut="new"]')?.click()
      },
      requireNoInput: true,
    },
  ]

  useKeyboardShortcuts(keyboardShortcuts, { currentPage: page })

  const handleLock = async () => {
    try {
      await logout()
      await invoke('lock')
    } catch (e) {
      handleError(e)
      // Lock command failed - user can retry manually
    }
  }

  const PageComponent = PAGE_MAP[page] || Dashboard

  // REDESIGN-05-1: сайдбар 05 «Adaptive» — группы вместо плоского списка
  // и drag-to-reorder (порядок больше не настраивается: группы фиксируют
  // информационную архитектуру — Продажи / Пул / Инфраструктура / Система).
  // Заглушка «Drops» из меню отсутствует (фича живёт в Profiles) — по контракту.
  const NAV_GROUPS = [
    {
      group: null,
      items: [
        {
          key: 'dashboard',
          icon: LayoutDashboard,
          page: 'dashboard',
          label: t('nav_dashboard'),
          badgeKey: null,
          hint: 'G D',
        },
      ],
    },
    {
      group: t('nav_group_sales'),
      items: [
        {
          key: 'orders',
          icon: ShoppingCart,
          page: 'orders',
          label: t('nav_orders'),
          badgeKey: 'pending_orders',
          badgeColor: 'y',
          hint: 'G O',
        },
        // shops остаётся видимым всем: get_shops требует лишь входа — справочник
        // нужен при оформлении заказа. Правом закрыты только правки внутри.
        {
          key: 'shops',
          icon: Store,
          page: 'shops',
          label: t('nav_shops'),
          badgeKey: null,
          hint: 'G S',
        },
        {
          key: 'catalog',
          icon: BookOpen,
          page: 'catalog',
          label: t('nav_catalog'),
          badgeKey: null,
        },
      ],
    },
    {
      group: t('nav_group_pool'),
      items: [
        {
          key: 'cards',
          icon: CreditCard,
          page: 'cards',
          label: t('nav_cards'),
          badgeKey: 'expiring_cards',
          badgeColor: 'y',
          hint: 'G C',
        },
        {
          key: 'profiles',
          icon: Users,
          page: 'profiles',
          label: t('nav_profiles'),
          badgeKey: 'no_drop_profiles',
          badgeColor: 'y',
          hint: 'G P',
        },
      ],
    },
    {
      group: t('nav_group_infra'),
      items: [
        // proxies целиком под manage_proxies: без права даже список не грузится,
        // страница была бы пустой с ошибкой при каждом заходе.
        ...(hasPerm('manage_proxies')
          ? [
              {
                key: 'proxies',
                icon: Shield,
                page: 'proxies',
                label: t('nav_proxies'),
                badgeKey: null,
                hint: 'G X',
              },
            ]
          : []),
        ...(hasPerm('view_couriers') || hasPerm('view_packages')
          ? [
              {
                key: 'couriers',
                icon: Truck,
                page: 'couriers',
                label: t('nav_couriers'),
                badgeKey: null,
              },
            ]
          : []),
        {
          key: 'imap',
          icon: Inbox,
          page: 'imap',
          label: t('nav_imap'),
          badgeKey: 'unread_imap',
          hint: 'G M',
        },
        {
          key: 'chat',
          icon: MessagesSquare,
          page: 'chat',
          label: t('nav_chat'),
          badgeKey: 'unread_chat',
          hint: 'G T',
        },
      ],
    },
    {
      group: t('nav_group_system'),
      items: [
        {
          key: 'updates',
          icon: Bell,
          page: 'updates',
          label: t('nav_updates'),
          badgeKey: null,
          dot: updateReady,
        },
        {
          key: 'activity_log',
          icon: ClipboardList,
          page: 'activity_log',
          label: t('nav_activity_log'),
          badgeKey: null,
        },
        {
          key: 'settings',
          icon: SettingsIcon,
          page: 'settings',
          label: t('nav_settings'),
          badgeKey: null,
          hint: '⌘,',
        },
      ],
    },
  ]
  // Управление пользователями и командная статистика живут в менеджер-приложении —
  // в воркере страниц Users / Team Statistics нет ни у одной роли.
  const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items)

  // «+ Создать» в топбаре: навигация на страницу и автоклик по её кнопке
  // создания (data-shortcut="new" — та же механика, что у клавиши «n»).
  // Страницы ленивые — ждём появления кнопки до 2с.
  const goCreate = useCallback(
    targetPage => {
      handlePageChange(targetPage)
      const started = Date.now()
      const tryClick = () => {
        const btn = document.querySelector('[data-shortcut="new"]')
        if (btn) {
          btn.click()
        } else if (Date.now() - started < 2000) {
          setTimeout(tryClick, 100)
        }
      }
      setTimeout(tryClick, 150)
    },
    [handlePageChange]
  )

  const themeModeLabel = {
    system: t('theme_mode_system'),
    light: t('theme_mode_light'),
    dark: t('theme_mode_dark'),
  }

  const createMenuItems = [
    { label: t('new_order'), icon: ShoppingCart, onClick: () => goCreate('orders'), hint: 'N' },
    { label: t('create_card'), icon: CreditCard, onClick: () => goCreate('cards') },
    { label: t('create_profile'), icon: Users, onClick: () => goCreate('profiles') },
  ]

  // REDESIGN-05-4: ⌘K получает действия шире меню «+» — sync и блокировка
  const handleSyncNow = useCallback(async () => {
    try {
      await invoke('sync_now')
      toast(t('sync_started'), 'success')
    } catch (e) {
      handleError(e)
    }
  }, [t, toast])

  const paletteActions = [
    ...createMenuItems,
    { label: t('settings_sync_now'), icon: RefreshCw, onClick: handleSyncNow },
    { label: t('sidebar_lock'), icon: Lock, onClick: handleLock },
  ]

  // REDESIGN-05-4: «выбрано N» в статус-баре — из сторов страниц с bulk-выделением
  const selectedOrdersCount = useOrdersStore(s => s.selected.length)
  const selectedCardsCount = useCardsStore(s => s.selected.length)
  const clearOrdersSelection = useOrdersStore(s => s.clearSelection)
  const clearCardsSelection = useCardsStore(s => s.clearSelection)
  const selectedCount =
    page === 'orders'
      ? selectedOrdersCount
      : page === 'cards'
        ? selectedCardsCount
        : selectedOrdersCount + selectedCardsCount
  const clearSelected = useCallback(() => {
    if (page === 'orders') clearOrdersSelection()
    else if (page === 'cards') clearCardsSelection()
    else {
      clearOrdersSelection()
      clearCardsSelection()
    }
  }, [page, clearOrdersSelection, clearCardsSelection])

  const userMenuItems = [
    {
      header: `${currentUser?.display_name || currentUser?.username || ''} · ${currentUser?.role || ''}`,
    },
    {
      label: `${t('user_menu_language')}: ${lang.toUpperCase()}`,
      icon: Globe,
      onClick: () => setLang(lang === 'en' ? 'ru' : 'en'),
    },
    {
      label: `${t('user_menu_theme')}: ${themeModeLabel[theme]}`,
      icon: theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun,
      onClick: cycleTheme,
    },
    { divider: true },
    { label: t('sidebar_lock'), icon: LogOut, onClick: handleLock, danger: true },
  ]

  return (
    <div className="app-container">
      {/* Live regions for screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {imapAnnouncement}
      </div>

      {/* Skip links for keyboard users */}
      <div className="sr-only-focusable" style={{ zIndex: 10000 }}>
        <a
          href="#sidebar-nav"
          style={{
            position: 'absolute',
            left: '-9999px',
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 500,
          }}
          onFocus={e => {
            e.target.style.left = '16px'
            e.target.style.top = '16px'
          }}
          onBlur={e => {
            e.target.style.left = '-9999px'
          }}
        >
          Skip to navigation
        </a>
        <a
          href="#search-button"
          style={{
            position: 'absolute',
            left: '-9999px',
            marginLeft: '8px',
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 500,
          }}
          onFocus={e => {
            e.target.style.left = '16px'
            e.target.style.top = '50px'
          }}
          onBlur={e => {
            e.target.style.left = '-9999px'
          }}
        >
          Skip to search
        </a>
        <a
          href="#main-content"
          style={{
            position: 'absolute',
            left: '-9999px',
            marginLeft: '8px',
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 500,
          }}
          onFocus={e => {
            e.target.style.left = '16px'
            e.target.style.top = '90px'
          }}
          onBlur={e => {
            e.target.style.left = '-9999px'
          }}
        >
          Skip to main content
        </a>
      </div>
      {showOnboarding && (
        <div className="onboarding-overlay">
          <Suspense
            fallback={
              <div className="onboarding-spinner-container">
                <div className="spinner-xs" />
              </div>
            }
          >
            <Onboarding
              onComplete={() => {
                setShowOnboarding(false)
                safeSetItem('onboarding_done', '1')
                maybeStartTour()
              }}
              onNavigate={p => {
                setShowOnboarding(false)
                safeSetItem('onboarding_done', '1')
                handlePageChange(p)
                maybeStartTour()
              }}
            />
          </Suspense>
        </div>
      )}
      {searchOpen && (
        <CommandPalette
          onClose={() => setSearchOpen(false)}
          onNavigate={p => handlePageChange(p)}
          actions={paletteActions}
          navItems={NAV_ITEMS.map(n => ({
            page: n.page,
            label: n.label,
            hint: n.hint,
            icon: n.icon,
          }))}
        />
      )}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
      {tourRun && <AppTour onFinish={handleTourFinish} />}

      {/* ── Sidebar (05 «Adaptive»: 232px, группы) ── */}
      <nav id="sidebar-nav" className="sidebar" aria-label="Main navigation" data-tour="sidebar">
        {/* macOS: drag region + traffic lights offset */}
        <div className="sidebar-drag-region" data-tauri-drag-region />

        <div className="sidebar-logo">
          VB
          <span className="sidebar-logo-text">VaultBase</span>
        </div>

        {NAV_GROUPS.map((grp, gi) => (
          <div className="sidebar-group" key={grp.group ?? 'root'}>
            {grp.group && <div className="sidebar-grp-label">{grp.group}</div>}
            {grp.items.map(
              ({ key, icon: Icon, page: p, label, badgeKey, badgeColor, dot, hint }) => {
                const active = page === p
                const count = badgeKey ? (badges[badgeKey] ?? 0) : 0
                return (
                  <button
                    key={key}
                    className={`sbi${active ? ' active' : ''}`}
                    data-tour={`nav-${p}`}
                    onClick={() => handlePageChange(p)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span className="sbi-label">{label}</span>
                    {hint && <kbd className="sbi-hint">{hint}</kbd>}
                    {count > 0 && (
                      <span
                        className={`sbi-badge${badgeColor ? ` ${badgeColor}` : ''}`}
                        aria-live="polite"
                        aria-label={`${count} ${label} updates`}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                    {/* Точка «доступно обновление» — без числа, зелёная. */}
                    {dot && !count && (
                      <span
                        className="sbi-badge g"
                        aria-label={t('upd_available_toast') || 'Доступно обновление'}
                        style={{
                          minWidth: 8,
                          width: 8,
                          height: 8,
                          padding: 0,
                          borderRadius: '50%',
                        }}
                      />
                    )}
                  </button>
                )
              }
            )}
            {gi < NAV_GROUPS.length - 1 && <div className="sidebar-group-gap" />}
          </div>
        ))}

        <div className="sidebar-spacer" />

        {/* REDESIGN-05-1: переключатель плотности «Удобно/Компактно» (мокап .dens) */}
        <div
          className="dens"
          role="group"
          aria-label={t('density_label')}
          title={t('density_label')}
        >
          <button
            className={`dens-btn${density === 'comfortable' ? ' active' : ''}`}
            onClick={() => setDensity('comfortable')}
          >
            {t('density_comfortable')}
          </button>
          <button
            className={`dens-btn${density === 'compact' ? ' active' : ''}`}
            onClick={() => setDensity('compact')}
          >
            {t('density_compact')}
          </button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="main-content-wrapper">
        {/* REDESIGN-05-1: топбар 56px — заголовок · ⌘K · тема · уведомления · «+ Создать» · аватар */}
        <div className="app-topbar" data-tauri-drag-region>
          <div className="app-topbar-title">
            {NAV_ITEMS.find(n => n.page === page)?.label ?? ''}
          </div>
          <button
            id="search-button"
            className="topbar-search"
            onClick={() => setSearchOpen(true)}
            aria-label={t('app_search_placeholder') || 'Search'}
          >
            <Search size={14} aria-hidden="true" />
            <span className="topbar-search-text">{t('topbar_search_placeholder')}</span>
            <kbd className="topbar-kbd">⌘K</kbd>
          </button>
          <div className="topbar-right">
            <NotificationCenter />
            <button
              className="topbar-ibtn"
              onClick={cycleTheme}
              title={`${t('user_menu_theme')}: ${themeModeLabel[theme]}`}
              aria-label={`${t('user_menu_theme')}: ${themeModeLabel[theme]}`}
            >
              {theme === 'system' ? (
                <Monitor size={16} aria-hidden="true" />
              ) : theme === 'dark' ? (
                <Moon size={16} aria-hidden="true" />
              ) : (
                <Sun size={16} aria-hidden="true" />
              )}
            </button>
            <button
              className="topbar-ibtn"
              onClick={() => handlePageChange('updates')}
              title={t('nav_updates')}
              aria-label={t('nav_updates')}
            >
              <Bell size={16} aria-hidden="true" />
              {updateReady && (
                <span className="topbar-ibtn-dot" aria-label={t('upd_available_toast')} />
              )}
            </button>
            <Menu items={createMenuItems} align="right" width={220}>
              {({ open, toggle, btnRef }) => (
                <button
                  ref={btnRef}
                  className={`topbar-create${open ? ' open' : ''}`}
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                >
                  <Plus size={14} aria-hidden="true" />
                  {t('topbar_create')}
                </button>
              )}
            </Menu>
            {currentUser && (
              <Menu items={userMenuItems} align="right" width={220}>
                {({ open, toggle, btnRef }) => (
                  <button
                    ref={btnRef}
                    className="topbar-avatar"
                    onClick={toggle}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    title={`${currentUser.display_name || currentUser.username} (${currentUser.role})`}
                  >
                    <span
                      className={`topbar-avatar-chip${currentUser.role === 'admin' ? ' admin' : ''}`}
                    >
                      {(currentUser.display_name || currentUser.username)[0].toUpperCase()}
                    </span>
                  </button>
                )}
              </Menu>
            )}
          </div>
        </div>
        <NewsAlert />
        {warningActive && (
          <div className="session-warning-banner" role="alert">
            <AlertTriangle size={14} />
            <span>
              {t('session_expiring_soon') || 'Сессия истекает через'}{' '}
              <strong>
                {remainingSeconds}
                {t('session_seconds_short') || 'с'}
              </strong>
              . {t('session_move_mouse') || 'Двигайте мышь, чтобы остаться.'}
            </span>
          </div>
        )}
        {/* Topbar tabs */}
        {TOPBAR_TABS[page]?.length > 0 && (
          <div className="topbar">
            {TOPBAR_TABS[page].map(tab => {
              const active = activeTab === tab.key
              const badgeNum =
                page === 'orders' && tab.key === 'pending'
                  ? badges.pending_orders
                  : page === 'cards' && tab.key === 'expiring'
                    ? badges.expiring_cards
                    : page === 'profiles' && tab.key === 'nodrop'
                      ? badges.no_drop_profiles
                      : 0
              const isYellow = page === 'cards' || page === 'profiles'
              return (
                <button
                  key={tab.key}
                  className={`tab${active ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  {badgeNum > 0 && (
                    <span className={`tab-badge${isYellow ? ' y' : ''}`}>
                      {badgeNum > 99 ? '99+' : badgeNum}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <main
          id="main-content"
          className={`main-content-scroll${page === 'imap' || page === 'chat' ? ' main-content-fill' : ''}`}
        >
          <ErrorBoundary resetKey={page} onReset={() => handlePageChange('dashboard')}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <div className="spinner-xs" />
                </div>
              }
            >
              <div key={page} className="page-enter">
                <PageComponent
                  onNavigate={handleNavigate}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  {...pageProps}
                />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>

        {/* REDESIGN-05-1: статус-бар — sync/ws слева, часы UTC справа.
            REDESIGN-05-4: «выбрано N» (клик снимает выделение). */}
        <div className="statusbar" role="contentinfo">
          <div className="statusbar-left">
            {selectedCount > 0 && (
              <button
                className="selected-pill"
                onClick={clearSelected}
                title={t('statusbar_selected_clear')}
              >
                {t('statusbar_selected').replace('{n}', selectedCount)}
              </button>
            )}
            {offlineMode && (
              <span className="offline-pill" title={t('offline_pill_title')}>
                ⚠ {t('offline_pill_label')}
              </span>
            )}
            {wsStatus && (
              <span
                className={`sync-pill ${wsStatus.connected ? 'connected' : wsStatus.connecting ? 'connecting' : 'disconnected'}`}
                title={
                  wsStatus.connected
                    ? `Sync connected (${wsStatus.group_id?.slice?.(0, 8) || 'group'})`
                    : wsStatus.connecting
                      ? 'Connecting to sync...'
                      : 'Sync disconnected'
                }
              >
                <span className={`live-dot${wsStatus.connected ? ' on' : ''}`} aria-hidden="true" />
                <span className="sync-pill-label">
                  {wsStatus.connected ? 'Sync' : wsStatus.connecting ? 'Sync...' : 'Offline'}
                </span>
              </span>
            )}
            {dataStale && (
              <button
                className="stale-pill"
                onClick={handleSyncNow}
                title={t('statusbar_stale_hint')}
              >
                {t('statusbar_stale')}
              </button>
            )}
            <TasksIndicator />
          </div>
          <div className="statusbar-right">
            {idleDeadline && (
              <button
                className="autolock-pill"
                onClick={extendIdle}
                title={t('statusbar_autolock_extend')}
              >
                🔒{' '}
                {(() => {
                  const left = Math.max(0, Math.ceil((idleDeadline - nowUtc.getTime()) / 1000))
                  const mm = String(Math.floor(left / 60)).padStart(2, '0')
                  const ss = String(left % 60).padStart(2, '0')
                  return `${mm}:${ss}`
                })()}
              </button>
            )}
            <span className="statusbar-clock" title={t('statusbar_utc')}>
              {nowUtc.toISOString().slice(11, 19)} {t('statusbar_utc')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── App inner (auth state machine) ─────────────────────────

function AppInner() {
  const [view, setView] = useState('checking')
  const [offlineMode, setOfflineMode] = useState(false)
  const { resumeSession, autoLogin, logout, currentUser, policy } = useAuth()

  useEffect(() => {
    logger.info('AppInner mounted, initializing event listeners')
    let unlistenFns = []
    let isMounted = true

    Promise.all([
      listen('show_activate', () => setView('activate')),
      listen('show_auth', e => {
        if (e?.payload?.offline) setOfflineMode(true)
        setView('auth')
      }),
      listen('license_revoked', () => setView('revoked')),
      listen('app_locked', () => setView('auth')),
    ]).then(fns => {
      if (isMounted) {
        unlistenFns = fns
      } else {
        // Component unmounted before listeners registered — clean up immediately
        fns.forEach(fn => {
          if (typeof fn === 'function') fn()
        })
      }
    })

    // Fallback if no event arrives within 3s
    const timer = setTimeout(() => {
      setView(cur => {
        if (cur !== 'checking') return cur
        invoke('get_license_status')
          .then(status => {
            if (status === 'not_activated') {
              setView('activate')
              return
            }
            if (status === 'revoked') {
              setView('revoked')
              return
            }
            if (status === 'offline') {
              setOfflineMode(true)
            }
            setView('auth')
          })
          .catch(() => {
            // Failed to get license status - default to auth screen
            setView('auth')
          })
        return 'checking'
      })
    }, 3000)

    return () => {
      isMounted = false
      unlistenFns.forEach(fn => {
        if (typeof fn === 'function') fn()
      })
      clearTimeout(timer)
    }
  }, [])

  // MGR-005: бан от менеджера → лок приложения (как idle-таймаут),
  // причина показывается на экране лока. Срабатывает один раз на вход в бан.
  const banHandledRef = useRef(false)
  useEffect(() => {
    if (!policy?.banned) {
      banHandledRef.current = false
      return
    }
    if (banHandledRef.current) return
    banHandledRef.current = true
    ;(async () => {
      await logout()
      try {
        await invoke('lock')
      } catch (e) {
        handleError(e)
      }
      setView('auth')
    })()
  }, [policy?.banned, logout])

  // MGR-005: force_logout (или истёкшая сессия) обнулил пользователя,
  // пока приложение было в основном виде, — возвращаем на логин.
  useEffect(() => {
    if (view === 'app' && !currentUser) setView('user_login')
  }, [view, currentUser])

  const handleUnlocked = async () => {
    // C: apply always_on_top from saved config
    try {
      const aot = await invoke('get_config', { key: 'always_on_top' })
      if (aot === '1') await getCurrentWindow().setAlwaysOnTop(true)
    } catch (e) {
      handleError(e)
      // Config read failed - continue without always_on_top
    }
    // Try to resume existing session from localStorage
    const existing = await resumeSession()
    if (existing) {
      setView('app')
      seedCatalogIfEmpty()
      return
    }
    // Solo mode: single admin user → auto-login, no login screen (old flow: license → master key → app)
    const auto = await autoLogin()
    if (auto) {
      setView('app')
      seedCatalogIfEmpty()
    } else {
      setView('user_login')
    }
  }

  const handleUserLoggedIn = () => {
    setView('app')
    seedCatalogIfEmpty()
  }

  // Seeds built-in catalog data if tables are empty (runs once after unlock)
  const seedCatalogIfEmpty = async () => {
    try {
      const stats = await invoke('get_catalog_stats')
      if (stats.items > 0 || stats.shops > 0) return // already seeded
      // Import items
      const itemsRes = await fetch('/catalog_items.json')
      if (itemsRes.ok) {
        const items = await itemsRes.json()
        const BATCH = 300
        for (let i = 0; i < items.length; i += BATCH) {
          await invoke('import_catalog_items', { items: items.slice(i, i + BATCH) })
        }
      }
      // Import shops
      const shopsRes = await fetch('/catalog_shops.json')
      if (shopsRes.ok) {
        const shops = await shopsRes.json()
        const BATCH = 300
        for (let i = 0; i < shops.length; i += BATCH) {
          await invoke('import_catalog_shops', { shops: shops.slice(i, i + BATCH) })
        }
      }
    } catch (e) {
      handleError(e)
      // Silent — catalog is optional
    }
  }

  const handleSessionTimeout = async () => {
    await logout()
    try {
      await invoke('lock')
    } catch (e) {
      handleError(e)
      /* already locked */
    }
    setView('auth')
  }

  if (view === 'checking') return <Spinner />
  if (view === 'activate') return <Activate onActivated={() => setView('auth')} />
  if (view === 'revoked') return <RevokedScreen />
  if (view === 'auth') return <Login onUnlocked={handleUnlocked} />
  if (view === 'user_login') return <UserLogin onLoggedIn={handleUserLoggedIn} />

  // MGR-005: мин. версия от менеджера — блокирующий экран поверх приложения
  if (policy?.update_required) {
    return <UpdateRequiredScreen minVersion={policy.min_version} />
  }

  return (
    <MainShell
      offlineMode={offlineMode}
      setOfflineMode={setOfflineMode}
      onSessionTimeout={handleSessionTimeout}
    />
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <LangProvider>
        <SmartToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <AppInner />
              {/* REDESIGN-05-6: доступен и на экране блокировки (panic) */}
              <DesktopBridge />
            </AuthProvider>
          </ConfirmProvider>
        </SmartToastProvider>
      </LangProvider>
    </ErrorBoundary>
  )
}
