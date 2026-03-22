import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { RefreshCw, Package, CheckCircle, Receipt, XCircle, AlertTriangle, Pin } from 'lucide-react'
import { useToast } from '../hooks/useToast.jsx'
import { useLang } from '../hooks/useLang.jsx'

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
const INSTALLED_VER_KEY = 'cc_manager_installed_version'

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
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.description ?? item.event_type ?? '(no description)'}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            {label}
            {item.entity_type ? ` · ${item.entity_type}` : ''}
            {item.entity_id ? ` #${item.entity_id}` : ''}
          </div>
        </div>
        <div className="font-mono text-[11px] text-muted shrink-0">
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
            <button className="btn btn-g btn-sm" onClick={() => onApplyTrack?.(item)}>
              ✓ {t('upd_apply_track')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => onIgnore?.(item)}>
              {t('upd_ignore')}
            </button>
          </div>
        </div>
      )}

      {typeKey === 'cancelled' && (
        <div className="cancel-box">
          <div className="text-[12px] text-red-t mb-2">{t('upd_cancel_note')}</div>
          <div className="flex gap-1">
            <button className="btn btn-o btn-sm btn-icon">
              <RefreshCw size={12} /> {t('upd_rebid')}
            </button>
            <button className="btn btn-r btn-sm">💀 {t('upd_mark_dead')}</button>
            <button className="btn btn-ghost btn-sm">{t('upd_keep')}</button>
          </div>
        </div>
      )}

      {typeKey === 'delivered' && (
        <div className="status-row flex items-center gap-2">
          <span className="st st-delivered">{t('status_delivered')}</span>
          <span className="text-[11px] text-muted">→ {t('upd_auto_updated')}</span>
          <button className="btn btn-o btn-sm btn-icon ml-auto">
            <RefreshCw size={12} /> {t('upd_rebid')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function Updates() {
  const { toast } = useToast()
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

  const TABS = [
    { key: 'all', label: t('upd_tab_all') },
    { key: 'track', label: t('upd_tab_tracks') },
    { key: 'delivered', label: t('upd_tab_delivered') },
    { key: 'cancelled', label: t('upd_tab_cancelled') },
    { key: 'attention', label: t('upd_tab_attention') },
  ]

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
        if (logResult.status === 'fulfilled') setItems(logResult.value.items ?? [])
        if (appVerResult.status === 'fulfilled') setCurrentVersion(appVerResult.value)
      } catch (err) {
        const msg = err?.toString?.() ?? 'Unknown error'
        setError(msg)
        if (!silent) toast(t('upd_load_failed'), 'error')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [toast, t]
  )

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Check for app update ────────────────────────────────────
  useEffect(() => {
    checkUpdate()
      .then(update => {
        if (!update?.available) return

        // Don't show banner if we already installed this exact version this session
        // (prevents infinite loop after relaunch)
        const alreadyInstalled = sessionStorage.getItem(INSTALLED_VER_KEY)
        if (alreadyInstalled === update.version) {
          // Installed but manifest hasn't refreshed yet — show "up to date" quietly
          return
        }

        setUpdateAvailable(update)
      })
      .catch(() => {}) // silently ignore — no internet, etc.
  }, [])

  // ── Download ───────────────────────────────────────────────
  const handleDownloadAndInstall = async () => {
    if (!updateAvailable) return
    setDownloadState('downloading')
    setDownloadProgress(0)
    try {
      let downloaded = 0
      let total = 0
      await updateAvailable.download(event => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength ?? 0
          if (total > 0) setDownloadProgress(Math.round((downloaded / total) * 100))
        } else if (event.event === 'Finished') {
          setDownloadProgress(100)
        }
      })
      setDownloadState('ready')
    } catch (e) {
      setDownloadState('idle')
      toast(t('upd_download_failed') + ': ' + String(e), 'error')
    }
  }

  // ── Install + relaunch ─────────────────────────────────────
  const handleInstall = async () => {
    if (!updateAvailable) return
    try {
      // Remember this version so after relaunch we don't re-show the banner
      sessionStorage.setItem(INSTALLED_VER_KEY, updateAvailable.version)
      setDownloadState('installed')
      await updateAvailable.install()
      await relaunch()
    } catch (e) {
      sessionStorage.removeItem(INSTALLED_VER_KEY)
      setDownloadState('ready')
      toast(t('upd_install_failed') + ': ' + String(e), 'error')
    }
  }

  const handleDismiss = () => {
    // Snooze: don't show banner again this session
    if (updateAvailable) {
      sessionStorage.setItem(INSTALLED_VER_KEY, updateAvailable.version)
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
            <span className="text-muted text-[14px] font-normal"> {t('upd_while_you_slept')}</span>
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
          style={{
            padding: '10px 14px',
            marginBottom: 12,
            borderRadius: 8,
            background: bannerBg,
            border: `1px solid ${bannerBdr}`,
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: downloadState === 'downloading' ? 8 : 0 }}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span style={{ color: bannerColor, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
                {isBeta ? '🧪 Beta' : '🆕 Stable'} v{updateAvailable.version}
              </span>
              <span style={{ fontSize: 11, color: bannerColor, opacity: 0.8, flexShrink: 0 }}>
                {isBeta ? t('upd_optional_update') : t('upd_recommended_update')}
              </span>
              {updateAvailable.body && (
                <span className="text-[11px] text-muted overflow-hidden text-ellipsis whitespace-nowrap">
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
                <span className="text-[12px] text-muted">
                  {t('upd_downloading')} {downloadProgress}%
                </span>
              )}
              {downloadState === 'ready' && (
                <button className="btn btn-g btn-sm" onClick={handleInstall}>
                  <RefreshCw size={13} /> {t('upd_restart_install')}
                </button>
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
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--color-info-bg)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--blue-t)',
                  width: `${downloadProgress}%`,
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Already up to date ─────────────────────────────── */}
      {!updateAvailable && !loading && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            marginBottom: 12,
            padding: '6px 14px',
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-bg)',
            borderRadius: 6,
          }}
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
      {loading ? (
        <div className="text-center py-12 text-muted text-[13px]">{t('upd_loading')}</div>
      ) : error ? (
        <div className="text-center py-12 text-[13px] text-red-t">
          {error}
          <br />
          <button className="btn btn-ghost btn-sm btn-icon mt-3" onClick={handleRefresh}>
            <RefreshCw size={13} /> {t('upd_refresh')}
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12 text-muted text-[13px]">{t('upd_no_events')}</div>
      ) : (
        filteredItems.map(item => (
          <UpdateCard
            key={item.id}
            item={item}
            onApplyTrack={handleApplyTrack}
            onIgnore={handleIgnore}
          />
        ))
      )}
    </div>
  )
}
