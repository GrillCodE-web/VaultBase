import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LangProvider, useLang } from './hooks/useLang'
import { ToastProvider, useToast } from './hooks/useToast'
import { ConfirmProvider } from './hooks/useConfirm'
import ErrorBoundary from './components/ErrorBoundary'
import ShortcutsHelp from './components/ShortcutsHelp'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { HEX_COLORS } from './constants/colors.js'
import { escapeHtml } from './utils/escape.js'

// Auth screens — loaded immediately (shown before app)
import Login from './pages/Login'
import Activate from './pages/Activate'

// App pages — lazy loaded to improve startup time
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Cards = lazy(() => import('./pages/Cards'))
const Profiles = lazy(() => import('./pages/Profiles'))
const Drops = lazy(() => import('./pages/Drops'))
const Orders = lazy(() => import('./pages/Orders'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Shops = lazy(() => import('./pages/Shops'))
const ProxyList = lazy(() => import('./pages/Proxies'))
const Imap = lazy(() => import('./pages/Imap'))
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
  Inbox,
  ClipboardList,
  Settings as SettingsIcon,
  Lock,
  Globe,
  AlertTriangle,
  BookOpen,
  Search,
  X,
  Bell,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react'

// ─── Safe JSON parse ──────────────────────────────────────────
const safeParseJSON = (str, fallback) => {
  try {
    return str ? JSON.parse(str) : fallback
  } catch {
    return fallback
  }
}

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
  imap: Imap,
  activity_log: ActivityLog,
  updates: Updates,
  settings: Settings,
  onboarding: Onboarding,
}

// ─── Global Search ────────────────────────────────────────────

const TYPE_PAGE = {
  card: 'cards',
  order: 'orders',
  profile: 'profiles',
  shop: 'shops',
  email: 'imap',
  proxy: 'proxies',
}

function GlobalSearch({ onClose, onNavigate }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const firstFocusRef = useRef(null)
  const lastFocusRef = useRef(null)
  const { t } = useLang()

  // Focus trap for modal
  useEffect(() => {
    inputRef.current?.focus()

    const handleTabKey = e => {
      if (e.key !== 'Tab') return

      // eslint-disable-next-line no-unused-vars -- Used for focus management reference
      const focusableElements = [inputRef.current, lastFocusRef.current].filter(Boolean)

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusRef.current) {
          e.preventDefault()
          lastFocusRef.current?.focus()
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusRef.current) {
          e.preventDefault()
          firstFocusRef.current?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await invoke('global_search', { query })
        setResults(r)
      } catch {
        // Ignore search errors - user can retry by typing
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [query])

  const handleKey = e => {
    if (e.key === 'Escape') onClose()
  }

  const sections = results
    ? [
        { key: 'cards', label: t('nav_cards'), items: results.cards ?? [] },
        { key: 'orders', label: t('nav_orders'), items: results.orders ?? [] },
        { key: 'profiles', label: t('nav_profiles'), items: results.profiles ?? [] },
        { key: 'shops', label: t('nav_shops'), items: results.shops ?? [] },
        { key: 'emails', label: t('nav_imap'), items: results.emails ?? [] },
        { key: 'proxies', label: t('nav_proxies'), items: results.proxies ?? [] },
      ].filter(s => s.items.length > 0)
    : []

  const total = sections.reduce((acc, s) => acc + s.items.length, 0)

  return (
    <div
      className="search-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div className="search-box-wrap" onClick={e => e.stopPropagation()}>
        {/* Input */}
        <div className="search-input-row">
          <Search size={16} className="text-muted icon-no-shrink" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('app_search_placeholder')}
            className="search-main-input"
            aria-label="Search"
          />
          {loading && <div className="spinner-sm" />}
          <button
            ref={firstFocusRef}
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer p-0"
            aria-label="Close search"
          >
            <X size={15} className="text-muted" aria-hidden="true" />
          </button>
        </div>

        {/* Results */}
        {sections.length > 0 ? (
          <div className="search-results">
            {sections.map(sec => (
              <div key={sec.key}>
                <div className="search-section-label">{sec.label}</div>
                {sec.items.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      onNavigate(TYPE_PAGE[item._type] ?? sec.key)
                      onClose()
                    }}
                    className="search-result-row"
                  >
                    <span className="search-result-type">{item._type}</span>
                    <span className="search-result-text">
                      {item.last4 ? `••••${item.last4}` : ''}
                      {item.order_number ?? ''}
                      {item.name ?? ''}
                      {item.city ? ` · ${item.city}` : ''}
                      {item.country ? `, ${item.country}` : ''}
                      {item.label ?? ''}
                      {item.host ?? ''}
                      {item.domain ?? ''}
                    </span>
                    {item.status && <span className="search-result-status">{item.status}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : query.trim() && !loading ? (
          <div className="search-empty">
            {t('search_no_results').replace('{q}', escapeHtml(query))}
          </div>
        ) : !query.trim() ? (
          <div className="search-empty text-[11px]">{t('app_type_to_search')}</div>
        ) : null}

        {/* Footer */}
        <div className="search-footer">
          <span className="search-footer-text">
            {total > 0 ? t('search_result_count').replace('{n}', total) : ''}
          </span>
          <span
            ref={lastFocusRef}
            tabIndex={0}
            role="button"
            onClick={onClose}
            onKeyDown={e => e.key === 'Enter' && onClose()}
            className="search-footer-text ml-auto cursor-pointer"
            aria-label="Close search"
          >
            {t('shortcut_close')}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="spinner-container">
        <div className="spinner" />
        <span className="text-[13px] text-muted">Loading…</span>
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

// ─── Keyboard Shortcuts Popup (removed - now using ShortcutsHelp component) ─────

// ─── Main Shell ───────────────────────────────────────────────

function MainShell({ offlineMode, setOfflineMode }) {
  const { t, lang, setLang } = useLang()
  const { toast, info: toastInfo } = useToast()

  // FIX P2-STATUS-01: WS sync connection status
  const [wsStatus, setWsStatus] = React.useState(null) // { connected, connecting, group_id? }

  React.useEffect(() => {
    const unlisten = listen('ws_sync:status', e => {
      setWsStatus(e.payload)
    })
    return () => {
      unlisten.then(u => u())
    }
  }, [])

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
    imap: [
      { key: 'accounts', label: t('nav_imap') },
      { key: 'messages', label: t('nav_imap') },
    ],
    activity_log: [{ key: 'list', label: t('log_title') }],
    updates: [{ key: 'list', label: t('updates_title') }],
    dashboard: [],
    settings: [],
    drops: [],
  }
  const [theme, setTheme] = useState(() => localStorage.getItem('cc_theme') || 'dark')
  const [page, setPage] = useState('dashboard')
  const [pageProps, setPageProps] = useState({})
  const [activeTab, setActiveTab] = useState('list')
  const [badges, setBadges] = useState({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try {
      return localStorage.getItem('cc_sidebar_expanded') === '1'
    } catch {
      return false
    }
  })
  const [showOnboarding, setShowOnboarding] = useState(false)
  // #27 — drag-to-reorder sidebar
  const [navOrder, setNavOrder] = useState(() =>
    safeParseJSON(localStorage.getItem('cc_nav_order'), null)
  )
  const dragNavRef = useRef(null)
  const prevImapRef = useRef(0)

  // Navigate from Dashboard quick actions / heatmap click
  const handleNavigate = useCallback((targetPage, props = {}) => {
    setPage(targetPage)
    setPageProps(props)
    setActiveTab('list')
  }, [])

  // Navigate from sidebar / keyboard shortcuts
  const handlePageChange = useCallback(p => {
    setPage(p)
    setPageProps({})
    setActiveTab('list')
  }, [])

  const loadBadges = useCallback(async () => {
    try {
      const b = await invoke('get_sidebar_badges')
      setBadges(b)
    } catch {
      // Silently fail - badges will retry on next interval
    }
  }, [])

  useEffect(() => {
    loadBadges()
    const id = setInterval(loadBadges, 30_000)
    return () => clearInterval(id)
  }, [loadBadges])

  useEffect(() => {
    const done = localStorage.getItem('onboarding_done')
    if (!done) {
      invoke('get_cards', { page: 1, perPage: 1 })
        .then(r => {
          if (r.total === 0) setShowOnboarding(true)
        })
        .catch(e => {
          // FIX FE-H05: Log error instead of silently ignoring
          console.error('[App] Failed to check cards for onboarding:', e)
        })
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('cc_theme', theme)
  }, [theme])

  // Live region announcement for IMAP updates
  const [imapAnnouncement, setImapAnnouncement] = useState('')

  // L: IMAP toast when new messages arrive
  useEffect(() => {
    const unlisten = listen('badge_update', e => {
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
    })
    return () => {
      unlisten.then(fn => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            }
          }),
        ])
        if (isMounted) {
          unlistenFns = [unlisten1, unlisten2]
        }
      } catch (error) {
        console.error('[App] Failed to setup server event listeners:', error)
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
            console.error('[App] Error cleaning up event listener:', e)
          }
        }
      })
      unlistenFns = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      await invoke('lock')
    } catch {
      // Lock command failed - user can retry manually
    }
  }

  const PageComponent = PAGE_MAP[page] || Dashboard

  const NAV_DEFS = [
    {
      key: 'dashboard',
      icon: LayoutDashboard,
      page: 'dashboard',
      label: t('nav_dashboard'),
      badgeKey: null,
    },
    { key: 'updates', icon: Bell, page: 'updates', label: t('nav_updates'), badgeKey: null },
    {
      key: 'cards',
      icon: CreditCard,
      page: 'cards',
      label: 'CC',
      badgeKey: 'expiring_cards',
      badgeColor: 'y',
    },
    {
      key: 'profiles',
      icon: Users,
      page: 'profiles',
      label: t('nav_profiles'),
      badgeKey: 'no_drop_profiles',
      badgeColor: 'y',
    },
    {
      key: 'orders',
      icon: ShoppingCart,
      page: 'orders',
      label: t('nav_orders'),
      badgeKey: 'pending_orders',
      badgeColor: 'y',
    },
    { key: 'catalog', icon: BookOpen, page: 'catalog', label: 'Catalog', badgeKey: null },
    { key: 'shops', icon: Store, page: 'shops', label: t('nav_shops'), badgeKey: null },
    { key: 'proxies', icon: Shield, page: 'proxies', label: t('nav_proxies'), badgeKey: null },
    { key: 'imap', icon: Inbox, page: 'imap', label: t('nav_imap'), badgeKey: 'unread_imap' },
    {
      key: 'activity_log',
      icon: ClipboardList,
      page: 'activity_log',
      label: t('nav_activity_log'),
      badgeKey: null,
    },
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
                localStorage.setItem('onboarding_done', '1')
              }}
              onNavigate={p => {
                setShowOnboarding(false)
                localStorage.setItem('onboarding_done', '1')
                handlePageChange(p)
              }}
            />
          </Suspense>
        </div>
      )}
      {searchOpen && (
        <GlobalSearch onClose={() => setSearchOpen(false)} onNavigate={p => handlePageChange(p)} />
      )}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}

      {/* ── Sidebar ── */}
      <nav
        id="sidebar-nav"
        className={`sidebar${sidebarExpanded ? ' expanded' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-logo">
          CC
          {sidebarExpanded && <span className="sidebar-logo-text">Manager</span>}
        </div>

        {/* #27 — sorted nav with drag-to-reorder */}
        {(navOrder
          ? [...NAV_DEFS].sort((a, b) => {
              const ia = navOrder.indexOf(a.key)
              const ib = navOrder.indexOf(b.key)
              if (ia === -1 && ib === -1) return 0
              if (ia === -1) return 1
              if (ib === -1) return -1
              return ia - ib
            })
          : NAV_DEFS
        ).map(({ key, icon: Icon, page: p, label, badgeKey, badgeColor }) => {
          const active = page === p
          const count = badgeKey ? (badges[badgeKey] ?? 0) : 0
          const DIVIDERS_AFTER = new Set(['updates', 'orders', 'imap'])
          return (
            <React.Fragment key={key}>
              <button
                className={`sbi${active ? ' active' : ''}`}
                onClick={() => handlePageChange(p)}
                draggable
                onDragStart={() => {
                  dragNavRef.current = key
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  const src = dragNavRef.current
                  dragNavRef.current = null
                  if (!src || src === key) return
                  const base = navOrder || NAV_DEFS.map(n => n.key)
                  const order = [...base]
                  const si = order.indexOf(src)
                  const ti = order.indexOf(key)
                  if (si === -1 || ti === -1) return
                  order.splice(si, 1)
                  order.splice(ti, 0, src)
                  setNavOrder(order)
                  try {
                    localStorage.setItem('cc_nav_order', JSON.stringify(order))
                  } catch {
                    // localStorage may be unavailable - order will reset on reload
                  }
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span className="sbi-tip">{label}</span>
                <span className="sbi-label">{label}</span>
                {badgeKey && (
                  <span
                    className={`sbi-badge${badgeColor ? ` ${badgeColor}` : ''}`}
                    aria-live="polite"
                    aria-label={`${count} ${label} updates`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                {!badgeKey && count > 0 && (
                  <span className={`sbi-badge${badgeColor ? ` ${badgeColor}` : ''}`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
              {DIVIDERS_AFTER.has(key) && <div className="sidebar-divider" />}
            </React.Fragment>
          )
        })}

        <div className="sidebar-spacer" />

        {/* Search */}
        <button
          id="search-button"
          className="sbi"
          onClick={() => setSearchOpen(true)}
          aria-label={t('app_search_placeholder') || 'Search'}
        >
          <Search size={16} aria-hidden="true" />
          <span className="sbi-tip">Search ⌘K</span>
          <span className="sbi-label">Search</span>
        </button>

        {/* Settings */}
        <button
          className={`sbi${page === 'settings' ? ' active' : ''}`}
          onClick={() => handlePageChange('settings')}
          aria-label={t('nav_settings') || 'Settings'}
        >
          <SettingsIcon size={16} aria-hidden="true" />
          <span className="sbi-tip">{t('nav_settings')}</span>
          <span className="sbi-label">{t('nav_settings')}</span>
        </button>

        {/* Lock */}
        <button className="sbi" onClick={handleLock} aria-label={t('sidebar_lock') || 'Lock'}>
          <Lock size={16} aria-hidden="true" />
          <span className="sbi-tip">{t('sidebar_lock') || 'Lock'}</span>
          <span className="sbi-label">{t('sidebar_lock') || 'Lock'}</span>
        </button>

        {/* Lang */}
        <button
          className="sbi"
          onClick={() => setLang(lang === 'en' ? 'ru' : 'en')}
          aria-label={`Language: ${lang.toUpperCase()}`}
        >
          <Globe size={16} aria-hidden="true" />
          <span className="sbi-tip">Language: {lang.toUpperCase()}</span>
          <span className="sbi-label">Lang: {lang.toUpperCase()}</span>
        </button>

        {/* Theme toggle */}
        <button
          className="sbi"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <Sun size={16} aria-hidden="true" />
          ) : (
            <Moon size={16} aria-hidden="true" />
          )}
          <span className="sbi-tip">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          <span className="sbi-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        {/* Expand/Collapse toggle */}
        <button
          className="sbi"
          onClick={() => {
            const next = !sidebarExpanded
            setSidebarExpanded(next)
            try {
              localStorage.setItem('cc_sidebar_expanded', next ? '1' : '0')
            } catch {
              // localStorage may be unavailable
            }
          }}
          title={sidebarExpanded ? t('sidebar_collapse') : t('sidebar_expand')}
          aria-label={sidebarExpanded ? t('sidebar_collapse') : t('sidebar_expand')}
        >
          {sidebarExpanded ? (
            <ChevronLeft size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
          <span className="sbi-tip">
            {sidebarExpanded ? t('sidebar_collapse') : t('sidebar_expand')}
          </span>
          <span className="sbi-label">{sidebarExpanded ? t('sidebar_collapse') : ''}</span>
        </button>

        {/* Offline */}
        {offlineMode && (
          <div className="offline-pill" title="Risk check, Sync, BIN lookup unavailable">
            ⚠ Off
          </div>
        )}

        {/* FIX P2-STATUS-02: WS Sync status badge */}
        {wsStatus && (
          <div
            className={`sync-pill ${wsStatus.connected ? 'connected' : wsStatus.connecting ? 'connecting' : 'disconnected'}`}
            title={
              wsStatus.connected
                ? `Sync connected (${wsStatus.group_id?.slice?.(0, 8) || 'group'})`
                : wsStatus.connecting
                  ? 'Connecting to sync...'
                  : 'Sync disconnected'
            }
          >
            {wsStatus.connected ? '🟢' : wsStatus.connecting ? '🟡' : '🔴'}
            {sidebarExpanded && (
              <span className="sync-pill-label">
                {wsStatus.connected ? 'Sync' : wsStatus.connecting ? 'Sync...' : 'Offline'}
              </span>
            )}
          </div>
        )}
      </nav>

      {/* ── Main ── */}
      <div className="main-content-wrapper">
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
                      : page === 'imap' && tab.key === 'messages'
                        ? badges.unread_imap
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

        <main id="main-content" className="main-content-scroll">
          <ErrorBoundary onReset={() => handlePageChange('dashboard')}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <div className="spinner-xs" />
                </div>
              }
            >
              <PageComponent
                key={page}
                onNavigate={handleNavigate}
                activeTab={activeTab}
                {...pageProps}
              />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

// ─── App inner (auth state machine) ─────────────────────────

function AppInner() {
  const [view, setView] = useState('checking')
  const [offlineMode, setOfflineMode] = useState(false)

  useEffect(() => {
    const unlisten = Promise.all([
      listen('show_activate', () => setView('activate')),
      listen('show_auth', e => {
        if (e?.payload?.offline) setOfflineMode(true)
        setView('auth')
      }),
      listen('license_revoked', () => setView('revoked')),
      listen('app_locked', () => setView('auth')),
    ])

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
      unlisten.then(fns => fns.forEach(fn => fn()))
      clearTimeout(timer)
    }
  }, [])

  const handleUnlocked = async () => {
    // C: apply always_on_top from saved config
    try {
      const aot = await invoke('get_config', { key: 'always_on_top' })
      if (aot === '1') await getCurrentWindow().setAlwaysOnTop(true)
    } catch {
      // Config read failed - continue without always_on_top
    }
    setView('app')
    // Auto-seed catalog on first run (background, silent)
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
    } catch {
      // Silent — catalog is optional
    }
  }

  if (view === 'checking') return <Spinner />
  if (view === 'activate') return <Activate onActivated={() => setView('auth')} />
  if (view === 'revoked') return <RevokedScreen />
  if (view === 'auth') return <Login onUnlocked={handleUnlocked} />

  return <MainShell offlineMode={offlineMode} setOfflineMode={setOfflineMode} />
}

export default function App() {
  return (
    <ErrorBoundary>
      <LangProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AppInner />
          </ConfirmProvider>
        </ToastProvider>
      </LangProvider>
    </ErrorBoundary>
  )
}
