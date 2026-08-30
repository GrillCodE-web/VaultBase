import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { RefreshCw, Package, CheckCircle, Receipt, XCircle, AlertTriangle, Pin } from 'lucide-react'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useLang } from '../hooks/useLang.jsx'
import DataLoader from '../components/DataLoader.jsx'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// ─── Helpers ───────────────────────────────────────────────────

function getUpdateType(item) {
  const ev = item.event_type ?? item.entity_type ?? ''
  if (ev.includes('track')) return 'track'
  if (ev.includes('deliver')) return 'delivered'
  if (ev.includes('confirm')) return 'confirmed'
  if (ev.includes('cancel')) return 'cancelled'
  if (ev.includes('warn') || ev.includes('attention') || ev.includes('alert')) return 'attention'
  return item.entity_type ?? 'attention'
}

function countByType(items) {
  const counts = { track: 0, delivered: 0, confirmed: 0, cancelled: 0, attention: 0 }
  for (const item of items) {
    const t = getUpdateType(item)
    if (t in counts) counts[t]++
  }
  return counts
}

function relativeTime(isoStr, t) {
  if (!isoStr) return '—'
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t ? t('upd_just_now') : 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Key used to remember which version was already downloaded+installed
const INSTALLED_VER_KEY = 'vaultbase_installed_version'

// ─── UpdateCard ────────────────────────────────────────────────

function UpdateCard({ item, onApplyTrack, onIgnore }) {
  const { t } = useLang()
  const typeKey = getUpdateType(item)

  const META = {
    track: { icon: <Package size={16} />, uiCls: 'ui-trk' },
    delivered: { icon: <CheckCircle size={16} />, uiCls: 'ui-del' },
    confirmed: { icon: <Receipt size={16} />, uiCls: 'ui-con' },
    cancelled: { icon: <XCircle size={16} />, uiCls: 'ui-can' },
    attention: { icon: <AlertTriangle size={16} />, uiCls: 'ui-wrn' },
  }
  const LABELS = {
    track: 'upd_type_track',
    delivered: 'upd_type_delivered',
    confirmed: 'upd_type_confirmed',
    cancelled: 'upd_type_cancelled',
    attention: 'upd_type_attention',
  }

  const meta = META[typeKey] ?? { icon: <Pin size={16} />, uiCls: 'ui-wrn' }
  const label = LABELS[typeKey] ? t(LABELS[typeKey]) : (item.event_type ?? typeKey)
  const isTrack = typeKey === 'track'

  return (
    <div className="upd-card">
      <div className="upd-head">
        <div className={`upd-icon ${meta.uiCls}`}>{meta.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap">
            {item.description ?? item.event_type ?? '(no description)'}
          </div>
          <div className="text-11 text-muted mt-0.5">
            {label}
            {item.entity_type ? ` · ${item.entity_type}` : ''}
            {item.entity_id ? ` #${item.entity_id}` : ''}
          </div>
        </div>
        <div className="font-mono text-11 text-muted shrink-0">
          {relativeTime(item.created_at, t)}
        </div>
      </div>

      {isTrack && item.tracking_number && (
        <div className="trk-box">
          <div>
            <div className="trk-num">{item.tracking_number}</div>
            <div className="trk-sub">{item.carrier ?? 'Carrier'}</div>
          </div>
          <div className="trk-acts">
            <button
              className="btn btn-g btn-sm"
              onClick={() => onApplyTrack?.(item)}
              aria-label={t('upd_apply_track')}
            >
              ✓ {t('upd_apply_track')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onIgnore?.(item)}
              aria-label={t('upd_ignore')}
            >
              {t('upd_ignore')}
            </button>
          </div>
        </div>
      )}

      {typeKey === 'cancelled' && (
        <div className="cancel-box">
          <div className="text-12 text-red-t mb-2">{t('upd_cancel_note')}</div>
          <div className="flex gap-1">
            <button className="btn btn-o btn-sm btn-icon" aria-label={t('upd_rebid')}>
              <RefreshCw size={12} /> {t('upd_rebid')}
            </button>
            <button className="btn btn-r btn-sm" aria-label={t('upd_mark_dead')}>
              💀 {t('upd_mark_dead')}
            </button>
            <button className="btn btn-ghost btn-sm" aria-label={t('upd_keep')}>
              {t('upd_keep')}
            </button>
          </div>
        </div>
      )}

      {typeKey === 'delivered' && (
        <div className="status-row flex items-center gap-2">
          <span className="st st-delivered">{t('status_delivered')}</span>
          <span className="text-11 text-muted">→ {t('upd_auto_updated')}</span>
          <button className="btn btn-o btn-sm btn-icon ml-auto" aria-label={t('upd_rebid')}>
            <RefreshCw size={12} /> {t('upd_rebid')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function Updates() {
  const { toast } = usePremiumToast()
  const { t } = useLang()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('0.1.0')
  const [updateAvailable, setUpdateAvailable] = useState(null)
  const [downloadState, setDownloadState] = useState('idle') // idle | downloading | ready | installed
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  // FIX P2-5: Track cancelled state to prevent setState after unmount
  const cancelledRef = useRef(false)

  const TABS = [
    { key: 'all', label: t('upd_tab_all') },
    { key: 'track', label: t('upd_tab_tracks') },
    { key: 'delivered', label: t('upd_tab_delivered') },
    { key: 'cancelled', label: t('upd_tab_cancelled') },
    { key: 'attention', label: t('upd_tab_attention') },
  ]

  // FIX P2-5: Cleanup cancelled flag on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // ── Load activity feed ──────────────────────────────────────
  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [logResult, appVerResult] = await Promise.allSettled([
          invoke('get_activity_log', {
            filter: { event_type: null, entity_type: 'order', from_date: null, to_date: null },
            page: 1,
          }),
          invoke('get_app_version'),
        ])
        // FIX P2-5: Check cancelled flag before updating state
        if (logResult.status === 'fulfilled' && !cancelledRef.current) {
          setItems(logResult.value.items ?? [])
        }
        if (appVerResult.status === 'fulfilled' && !cancelledRef.current) {
          setCurrentVersion(appVerResult.value)
        }
      } catch (err) {
        const msg = err?.toString?.() ?? 'Unknown error'
        if (!cancelledRef.current) {
          setError(msg)
          if (!silent) toast(t('upd_load_failed'), 'error')
        }
      } finally {
        if (!cancelledRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [toast, t]
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка обновлений
    loadData()
  }, [loadData])

  // ── Check for app update ────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    checkUpdate()
      .then(update => {
        if (!update?.available || cancelled) return

        // Don't show banner if we already installed this exact version this session
        // (prevents infinite loop after relaunch)
        const alreadyInstalled = localStorage.getItem(INSTALLED_VER_KEY)
        if (alreadyInstalled === update.version) {
          // Installed but manifest hasn't refreshed yet — show "up to date" quietly
          return
        }

        setUpdateAvailable(update)
      })
      .catch(e => {
        // FIX FE-H05: Log update check errors (but don't alert user - likely no internet)
        console.error('[Updates] Failed to check for updates:', e)
      }) // silently ignore — no internet, etc.
    return () => {
      cancelled = true
    }
  }, [])

  // ── Download AND install in one action ─────────────────────
  // Кнопка называется «Скачать» и пользователь ждёт, что обновление
  // установится само. Раньше эта функция ТОЛЬКО качала, а установку прятала
  // во вторую кнопку — из-за чего казалось, что «скачал, а ничего не
  // произошло». Теперь скачивание и установка идут одним потоком:
  // downloadAndInstall() — атомарный метод плагина, после него relaunch().
  const handleDownloadAndInstall = async () => {
    if (!updateAvailable) return
    setDownloadState('downloading')
    setDownloadProgress(0)
    try {
      let downloaded = 0
      let total = 0
      await updateAvailable.downloadAndInstall(event => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength ?? 0
          if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100))
        } else if (event.event === 'Finished') {
          setDownloadProgress(100)
        }
      })
      // Скачано и установлено — запоминаем версию, чтобы после перезапуска
      // не показать баннер снова, и перезапускаем приложение.
      localStorage.setItem(INSTALLED_VER_KEY, updateAvailable.version)
      setDownloadState('installed')
      toast(t('upd_installing') || 'Устанавливаю обновление, перезапуск…', 'success')
      await relaunch()
    } catch (e) {
      setDownloadState('idle')
      const error = handleError(e, 'Updates.handleDownloadAndInstall')
      toast(t('upd_download_failed') + ': ' + getErrorMessage(error), 'error')
    }
  }

  const handleDismiss = () => {
    // Snooze: don't show banner again this session
    if (updateAvailable) {
      localStorage.setItem(INSTALLED_VER_KEY, updateAvailable.version)
    }
    setDismissed(true)
  }

  const handleRefresh = () => {
    setRefreshing(true)
    loadData(true)
  }
  const handleApplyTrack = item => toast(`Track applied for item ${item.id}`, 'success')
  const handleIgnore = item => setItems(prev => prev.filter(i => i.id !== item.id))

  const filteredItems =
    activeTab === 'all' ? items : items.filter(item => getUpdateType(item) === activeTab)
  const counts = countByType(items)

  const showBanner = updateAvailable && !dismissed && downloadState !== 'installed'
  const isBeta = updateAvailable?.version?.includes('beta')
  const bannerColor = isBeta ? 'var(--yellow-t)' : 'var(--red-t)'
  const bannerBg = isBeta ? 'var(--color-warning-bg)' : 'var(--color-error-bg)'
  const bannerBdr = isBeta ? 'var(--color-warning-bg)' : 'var(--color-error-bg)'

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">
            {t('updates_title')}
            <span className="text-muted text-14 font-normal"> {t('upd_while_you_slept')}</span>
          </div>
          <div className="ph-sub">{t('upd_imap_monitors')}</div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleRefresh}
            disabled={loading || refreshing}
          >
            {refreshing ? (
              '…'
            ) : (
              <>
                <RefreshCw size={13} /> {t('upd_refresh')}
              </>
            )}
          </button>
          <button className="btn btn-g btn-sm">✓ {t('upd_apply_all')}</button>
        </div>
      </div>

      {/* ── App update banner ──────────────────────────────── */}
      {showBanner && (
        <div
          className="px-3.5 py-2.5 mb-3 rounded-lg"
          style={{ background: bannerBg, border: `1px solid ${bannerBdr}` }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: downloadState === 'downloading' ? 8 : 0 }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-semibold shrink-0" style={{ color: bannerColor }}>
                {isBeta ? '🧪 Beta' : '🆕 Stable'} v{updateAvailable.version}
              </span>
              <span className="text-xs shrink-0" style={{ color: bannerColor, opacity: 0.8 }}>
                {isBeta ? t('upd_optional_update') : t('upd_recommended_update')}
              </span>
              {updateAvailable.body && (
                <span className="text-11 text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                  {updateAvailable.body}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {downloadState === 'idle' && (
                <button className="btn btn-b btn-sm" onClick={handleDownloadAndInstall}>
                  ↓ {t('upd_download')}
                </button>
              )}
              {downloadState === 'downloading' && (
                <span className="text-12 text-muted">
                  {t('upd_downloading')} {downloadProgress}%
                </span>
              )}
              {downloadState === 'installed' && (
                <span className="text-12 text-muted">{t('upd_installing') || 'Устанавливаю…'}</span>
              )}
              {/* Dismiss — snoozes for this session */}
              {downloadState !== 'downloading' && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleDismiss}
                  title={t('upd_dismiss_hint') || 'Hide until next launch'}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {downloadState === 'downloading' && (
            <div className="h-1 rounded overflow-hidden bg-color-info-bg">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${downloadProgress}%`, backgroundColor: 'var(--blue-t)' }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Already up to date ─────────────────────────────── */}
      {!updateAvailable && !loading && (
        <div
          className="text-xs text-muted mb-3 px-3.5 py-1.5 bg-color-success-bg rounded-md"
          style={{ border: '1px solid var(--color-success-bg)' }}
        >
          ✓ {t('upd_current_version')} v{currentVersion}
        </div>
      )}

      {/* ── Summary bar ────────────────────────────────────── */}
      {!loading && !error && (
        <div className="sum-bar">
          <div className="sum-item">
            <div className="sum-num text-green-t">{counts.track}</div>
            <div className="sum-lbl">{t('upd_new_tracks_count')}</div>
          </div>
          <div className="sum-item">
            <div className="sum-num text-cyan-t">{counts.delivered}</div>
            <div className="sum-lbl">✅ {t('upd_type_delivered')}</div>
          </div>
          <div className="sum-item">
            <div className="sum-num text-orange-t">{counts.confirmed}</div>
            <div className="sum-lbl">🧾 {t('upd_type_confirmed')}</div>
          </div>
          <div className="sum-item">
            <div className="sum-num text-red-t">{counts.cancelled}</div>
            <div className="sum-lbl">❌ {t('upd_type_cancelled')}</div>
          </div>
          <div className="sum-item">
            <div className="sum-num text-yellow-t">{counts.attention}</div>
            <div className="sum-lbl">⚠️ {t('upd_type_attention')}</div>
          </div>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div className="filters">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`flt${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label} {tab.key !== 'all' ? `(${counts[tab.key] ?? 0})` : `(${items.length})`}
          </button>
        ))}
      </div>

      {/* ── Content ────────────────────────────────────────── */}
      <DataLoader
        loading={loading}
        error={error}
        empty={filteredItems.length === 0}
        emptyTitle={t('upd_no_events')}
        onRetry={handleRefresh}
      >
        {filteredItems.map(item => (
          <UpdateCard
            key={item.id}
            item={item}
            onApplyTrack={handleApplyTrack}
            onIgnore={handleIgnore}
          />
        ))}
      </DataLoader>
    </div>
  )
}
