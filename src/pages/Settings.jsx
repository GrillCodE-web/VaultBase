import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import {
  Database,
  RefreshCw,
  Download,
  FolderOpen,
  Globe,
  Zap,
  Shield,
  Monitor,
  Lock,
  Wifi,
  WifiOff,
  Users,
  UserPlus,
  Copy,
  LogOut,
  CheckCircle,
  Bell,
  Sun,
  Moon,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { useTheme } from '../hooks/useTheme'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { LicenseSection } from '../components/LicenseSection'
import { STATUS_COLORS } from '../constants/colors'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

export default function Settings() {
  const { t, lang, setLang } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { confirm } = useConfirm()
  const { theme, toggleTheme } = useTheme()

  const [syncGroup, setSyncGroup] = useState(null) // null = loading, false = no group, object = group info
  const [syncGroupLoading, setSyncGroupLoading] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showJoinGroup, setShowJoinGroup] = useState(false)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [generatedCode, setGeneratedCode] = useState(null)

  const [binApiKey, setBinApiKey] = useState('')
  const [binApiSaved, setBinApiSaved] = useState(false)
  const [exportingBackup, setExportingBackup] = useState(false)
  const [wsStatus, setWsStatus] = useState(null) // { connected, connecting, group_id? }
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [autoLock, setAutoLock] = useState('300')
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [lastBackup, setLastBackup] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [badgeNotifyImap, setBadgeNotifyImap] = useState(true)
  const [badgeNotifyTracking, setBadgeNotifyTracking] = useState(true)
  const [catalogStats, setCatalogStats] = useState(null)

  useEffect(() => {
    // ★ Insight: Флаг cancelled предотвращает setState после unmount
    let cancelled = false

    // All DB calls in parallel — fast
    Promise.allSettled([
      invoke('get_config', { key: 'bin_api_key' }).then(v => {
        if (!cancelled && v) setBinApiKey(v)
      }),
      invoke('get_config', { key: 'always_on_top' }).then(v => {
        if (!cancelled) setAlwaysOnTop(v === '1')
      }),
      invoke('get_config', { key: 'autolock_timeout' }).then(v => {
        if (!cancelled && v) setAutoLock(v)
      }),
      invoke('get_sidebar_badges').then(b => {
        if (!cancelled) setUnsyncedCount(b.unsynced_footprints ?? 0)
      }),
      invoke('get_config', { key: 'last_backup_time' }).then(v => {
        if (!cancelled && v) setLastBackup(v)
      }),
      invoke('get_config', { key: 'badge_notify_imap' }).then(v => {
        if (!cancelled) setBadgeNotifyImap(v !== '0')
      }),
      invoke('get_config', { key: 'badge_notify_tracking' }).then(v => {
        if (!cancelled) setBadgeNotifyTracking(v !== '0')
      }),
      invoke('get_catalog_stats')
        .then(s => {
          if (!cancelled) setCatalogStats(s)
        })
        .catch(e => console.error('[Settings] Failed to get catalog stats:', e)),
    ])
    // Network call deferred — doesn't block initial render
    invoke('sync_get_group_status')
      .then(s => {
        if (!cancelled) setSyncGroup(s.in_group ? s : false)
      })
      .catch(e => {
        console.error('[Settings] Failed to get sync group status:', e)
        if (!cancelled) setSyncGroup(false)
      })

    // Listen for catalog sync and WS connection status
    const u1 = listen('catalog_synced', () => {
      invoke('get_catalog_stats')
        .then(s => {
          if (!cancelled) setCatalogStats(s)
        })
        .catch(e => console.error('[Settings] Failed to get catalog stats after sync:', e))
    })
    const u2 = listen('ws_sync:status', e => {
      if (!cancelled) setWsStatus(e.payload)
    })
    return () => {
      cancelled = true
      u1.then(fn => fn()).catch(() => {})
      u2.then(fn => fn()).catch(() => {})
    }
  }, [])

  const handleBadgeNotifyImap = async val => {
    setBadgeNotifyImap(val)
    try {
      await invoke('set_config', { key: 'badge_notify_imap', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleImapNotify')
      toastErr(getErrorMessage(error))
    }
  }

  const handleBadgeNotifyTracking = async val => {
    setBadgeNotifyTracking(val)
    try {
      await invoke('set_config', { key: 'badge_notify_tracking', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleTrackingNotify')
      toastErr(getErrorMessage(error))
    }
  }

  const handleAlwaysOnTop = async val => {
    setAlwaysOnTop(val)
    try {
      await getCurrentWindow().setAlwaysOnTop(val)
      await invoke('set_config', { key: 'always_on_top', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleAlwaysOnTop')
      toastErr(getErrorMessage(error))
    }
  }

  const handleAutoLock = async val => {
    try {
      await invoke('set_config', { key: 'autolock_timeout', value: val })
      setAutoLock(val)
    } catch (e) {
      const error = handleError(e, 'Settings.setAutoLockTimeout')
      toastErr(getErrorMessage(error))
    }
  }

  const handleLockNow = async () => {
    try {
      await invoke('lock')
    } catch (e) {
      const error = handleError(e, 'Settings.handleLock')
      toastErr(getErrorMessage(error))
    }
  }

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
    {
      keys: ['s', 'Meta+s', 'Control+s'],
      handler: async () => {
        // Save all settings that have changed
        if (binApiKey) {
          await saveBinApiKey()
        }
      },
      requireNoInput: true,
      page: 'settings',
    },
  ]

  useKeyboardShortcuts(pageShortcuts, { currentPage: 'settings' })

  const saveBinApiKey = async () => {
    try {
      await invoke('set_config', { key: 'bin_api_key', value: binApiKey })
      setBinApiSaved(true)
      toastOk(t('settings_bin_api_saved'))
      setTimeout(() => setBinApiSaved(false), 2000)
    } catch (e) {
      const error = handleError(e, 'Settings.saveBinApiKey')
      toastErr(getErrorMessage(error))
    }
  }

  const handleBackup = async () => {
    const prevLastBackup = lastBackup // FIX P2-4: Store previous value for rollback
    setExportingBackup(true)
    try {
      const path = await invoke('export_backup')
      const now = new Date().toLocaleString()
      await invoke('set_config', { key: 'last_backup_time', value: now })
      setLastBackup(now)
      toastOk(t('settings_backup_created') + ': ' + path)
    } catch (e) {
      // FIX P2-4: Rollback on error
      setLastBackup(prevLastBackup)
      const error = handleError(e, 'Settings.handleBackup')
      toastErr(getErrorMessage(error))
    } finally {
      setExportingBackup(false)
    }
  }

  const handleRestore = async () => {
    const ok = await confirm(t('settings_restore_confirm'), { title: t('settings_restore_backup') })
    if (!ok) return
    setRestoring(true)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const path = await open({
        filters: [{ name: 'CC Manager Backup', extensions: ['db', 'ccbak'] }],
        multiple: false,
      })
      if (!path) {
        setRestoring(false)
        return
      }
      await invoke('import_backup', { path })
      toastOk(t('settings_backup_restored'))
    } catch (e) {
      const error = handleError(e, 'Settings.handleRestore')
      toastErr(t('settings_restore_failed') + ': ' + getErrorMessage(error))
    } finally {
      setRestoring(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    setSyncGroupLoading(true)
    try {
      const info = await invoke('sync_create_group', { name: newGroupName.trim() })
      setSyncGroup({ in_group: true, group_id: info.group_id, group_name: info.name })
      setShowCreateGroup(false)
      setNewGroupName('')
      toastOk('Sync group created!')
    } catch (e) {
      const error = handleError(e, 'Settings.handleCreateGroup')
      toastErr(getErrorMessage(error))
    } finally {
      setSyncGroupLoading(false)
    }
  }

  const handleJoinGroup = async () => {
    if (!joinCode.trim()) return
    setSyncGroupLoading(true)
    try {
      const info = await invoke('sync_join_group', { pairCode: joinCode.trim().toUpperCase() })
      setSyncGroup({ in_group: true, group_id: info.group_id, group_name: info.name })
      setShowJoinGroup(false)
      setJoinCode('')
      toastOk('Joined sync group!')
    } catch (e) {
      const error = handleError(e, 'Settings.handleJoinGroup')
      toastErr(getErrorMessage(error))
    } finally {
      setSyncGroupLoading(false)
    }
  }

  const handleGeneratePairCode = async () => {
    setGeneratingCode(true)
    try {
      const code = await invoke('sync_create_pair_code')
      setGeneratedCode(code)
    } catch (e) {
      const error = handleError(e, 'Settings.handleGenerateCode')
      toastErr(getErrorMessage(error))
    } finally {
      setGeneratingCode(false)
    }
  }

  const handleLeaveGroup = async () => {
    const ok = await confirm(
      'Leave sync group? You will lose access to shared cards.',
      'Leave Group'
    )
    if (!ok) return
    try {
      await invoke('sync_disconnect')
      setSyncGroup(false)
      setGeneratedCode(null)
      toastOk('Left sync group')
    } catch (e) {
      const error = handleError(e, 'Settings.handleLeaveGroup')
      toastErr(getErrorMessage(error))
    }
  }

  const handleChangePassword = async () => {
    if (pwForm.next !== pwForm.confirm) {
      toastErr(t('settings_pw_mismatch'))
      return
    }
    if (pwForm.next.length < 12) {
      toastErr(t('auth_req_length'))
      return
    }
    try {
      await invoke('change_password', { old: pwForm.current, new: pwForm.next })
      toastOk(t('settings_pw_changed'))
      setPwForm({ current: '', next: '', confirm: '' })
      setChangingPw(false)
    } catch (e) {
      const error = handleError(e, 'Settings.handleChangePassword')
      toastErr(getErrorMessage(error))
    }
  }

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">{t('nav_settings')}</div>
          <div className="ph-sub">App configuration</div>
        </div>
      </div>

      {/* License */}
      <div className="mb-4">
        <LicenseSection />
      </div>

      <div className="grid2">
        {/* Window */}
        <div className="panel">
          <div className="ptitle">
            <Monitor size={13} className="inline mr-1.5" />
            Window
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Always on Top</div>
              <div className="setting-desc">Keep window above all other apps</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={e => handleAlwaysOnTop(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
        </div>

        {/* Dock Badge */}
        <div className="panel">
          <div className="ptitle">
            <Bell size={13} className="inline mr-1.5" />
            Dock Badge
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">New IMAP Emails</div>
              <div className="setting-desc">Show unread count on dock icon</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={badgeNotifyImap}
                onChange={e => handleBadgeNotifyImap(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Tracking Updates</div>
              <div className="setting-desc">Show tracking updates on dock icon</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={badgeNotifyTracking}
                onChange={e => handleBadgeNotifyTracking(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
        </div>

        {/* Security */}
        <div className="panel">
          <div className="ptitle">
            <Lock size={13} className="inline mr-1.5" />
            Security
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Auto-lock timeout</div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {[
                { label: '1m', value: '60' },
                { label: '5m', value: '300' },
                { label: '15m', value: '900' },
                { label: '30m', value: '1800' },
                { label: t('settings_never'), value: 'never' },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => handleAutoLock(value)}
                  className={`btn btn-sm ${autoLock === value ? 'btn-b' : 'btn-ghost'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Lock now</div>
              <div className="setting-desc">Immediately lock the app</div>
            </div>
            <button onClick={handleLockNow} className="btn btn-r btn-sm">
              <Lock size={13} /> Lock Now
            </button>
          </div>
        </div>

        {/* General */}
        <div className="panel">
          <div className="ptitle">
            <Globe size={13} className="inline mr-1.5" />
            General
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Language</div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setLang('en')}
                className={`btn btn-sm ${lang === 'en' ? 'btn-b' : 'btn-ghost'}`}
              >
                EN
              </button>
              <button
                onClick={() => setLang('ru')}
                className={`btn btn-sm ${lang === 'ru' ? 'btn-b' : 'btn-ghost'}`}
              >
                RU
              </button>
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Theme</div>
              <div className="setting-desc">Switch between light and dark mode</div>
            </div>
            <button onClick={toggleTheme} className="btn btn-ghost btn-sm">
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>

        {/* BIN API */}
        <div className="panel">
          <div className="ptitle">
            <Zap size={13} className="inline mr-1.5" />
            BIN Enrichment
          </div>
          <div className="setting-desc mb-2">
            API key from iinapi.com for automatic card BIN enrichment.
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={binApiKey}
              onChange={e => setBinApiKey(e.target.value)}
              placeholder={t('settings_bin_api_placeholder')}
              className="form-input flex-1"
            />
            <button
              onClick={saveBinApiKey}
              className={`btn btn-sm ${binApiSaved ? 'btn-g' : 'btn-b'}`}
            >
              {binApiSaved ? t('msg_saved') : t('btn_save')}
            </button>
          </div>
        </div>

        {/* Database */}
        <div className="panel">
          <div className="ptitle">
            <Database size={13} className="inline mr-1.5" />
            Database
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Backup database</div>
              {lastBackup && <div className="setting-desc">Last: {lastBackup}</div>}
            </div>
            <button onClick={handleBackup} disabled={exportingBackup} className="btn btn-b btn-sm">
              {exportingBackup ? <RefreshCw size={13} /> : <Download size={13} />}
              {exportingBackup ? t('settings_creating') : t('settings_create_backup')}
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Restore backup</div>
              <div className="setting-desc">Replace all data from backup file</div>
            </div>
            <button onClick={handleRestore} disabled={restoring} className="btn btn-y btn-sm">
              <FolderOpen size={13} />
              {restoring ? t('settings_restoring') : t('settings_restore')}
            </button>
          </div>
        </div>

        {/* Sync & Connection */}
        <div className="panel">
          <div className="ptitle">
            <Wifi size={13} className="inline mr-1.5" />
            Sync & Connection
          </div>
          {/* Real-time WS connection indicator */}
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Server connection</div>
              {wsStatus?.group_id && (
                <div className="setting-desc mono text-[10px]">
                  {wsStatus.group_id.slice(0, 20)}…
                </div>
              )}
            </div>
            <div>
              {wsStatus === null ? (
                <span className="st st-pending">
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />{' '}
                  Connecting…
                </span>
              ) : wsStatus.connected ? (
                <span className="st st-active">
                  <Wifi size={11} /> Connected
                </span>
              ) : wsStatus.connecting ? (
                <span className="st st-pending">
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} />{' '}
                  Connecting…
                </span>
              ) : (
                <span className="st st-dead">
                  <WifiOff size={11} /> Disconnected
                </span>
              )}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">Pending footprints</div>
              <div className="setting-desc">Queued for sync when connected</div>
            </div>
            <span
              className="text-[12px] mono"
              style={{ color: unsyncedCount > 0 ? STATUS_COLORS.warning : 'var(--muted)' }}
            >
              {unsyncedCount}
            </span>
          </div>
        </div>

        {/* Change Password — full width */}
        <div className="panel col-span-full">
          <div className="ptitle">
            <Shield size={13} className="inline mr-1.5" />
            Change Password
          </div>
          {!changingPw ? (
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Master password</div>
                <div className="setting-desc">Change your encryption password</div>
              </div>
              <button onClick={() => setChangingPw(true)} className="btn btn-r btn-sm">
                Change Password
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {[
                {
                  key: 'current',
                  label: t('settings_current_pw'),
                  placeholder: t('settings_current_pw'),
                },
                { key: 'next', label: t('settings_new_pw'), placeholder: t('settings_new_pw') },
                {
                  key: 'confirm',
                  label: t('auth_confirm_label'),
                  placeholder: t('auth_confirm_label'),
                },
              ].map(({ key, label, placeholder }) => (
                <div className="form-group" key={key}>
                  <label className="form-label">{label}</label>
                  <input
                    type="password"
                    value={pwForm[key]}
                    onChange={e => setPwForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="form-input"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setChangingPw(false)
                    setPwForm({ current: '', next: '', confirm: '' })
                  }}
                  className="btn btn-ghost btn-sm"
                >
                  {t('btn_cancel')}
                </button>
                <button onClick={handleChangePassword} className="btn btn-r btn-sm">
                  Change Password
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sync Groups */}
        <div className="panel col-span-full">
          <div className="ptitle">
            <Users size={13} className="inline mr-1.5" />
            Sync Groups
          </div>
          {syncGroup === null ? (
            <div className="text-muted text-[12px] flex items-center gap-1.5">
              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
            </div>
          ) : syncGroup === false ? (
            <div>
              <div className="setting-desc mb-3">
                Share cards with other users. Create a group and share the pair code, or join with
                someone else&apos;s code.
              </div>
              {!showCreateGroup && !showJoinGroup && (
                <div className="flex gap-2">
                  <button onClick={() => setShowCreateGroup(true)} className="btn btn-b btn-sm">
                    <UserPlus size={13} />
                    Create Group
                  </button>
                  <button onClick={() => setShowJoinGroup(true)} className="btn btn-ghost btn-sm">
                    Join with code
                  </button>
                </div>
              )}
              {showCreateGroup && (
                <div className="flex flex-col gap-2 mt-2">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={e => setNewGroupName(e.target.value)}
                    placeholder="Group name"
                    className="form-input"
                    onKeyDown={e => e.key === 'Enter' && handleCreateGroup()}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowCreateGroup(false)}
                      className="btn btn-ghost btn-sm"
                    >
                      {t('btn_cancel')}
                    </button>
                    <button
                      onClick={handleCreateGroup}
                      disabled={syncGroupLoading || !newGroupName.trim()}
                      className="btn btn-b btn-sm"
                    >
                      {syncGroupLoading ? (
                        <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : null}
                      Create
                    </button>
                  </div>
                </div>
              )}
              {showJoinGroup && (
                <div className="flex flex-col gap-2 mt-2">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Enter 6-char pair code (e.g. AB3C7X)"
                    className="form-input font-mono"
                    maxLength={6}
                    onKeyDown={e => e.key === 'Enter' && handleJoinGroup()}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowJoinGroup(false)}
                      className="btn btn-ghost btn-sm"
                    >
                      {t('btn_cancel')}
                    </button>
                    <button
                      onClick={handleJoinGroup}
                      disabled={syncGroupLoading || joinCode.length < 6}
                      className="btn btn-b btn-sm"
                    >
                      {syncGroupLoading ? (
                        <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : null}
                      Join
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-semibold text-[13px]">
                    {syncGroup.group_name || 'Sync Group'}
                  </div>
                  <div className="text-muted text-[11px] font-mono">
                    {syncGroup.group_id?.slice(0, 16)}...
                  </div>
                </div>
                <button onClick={handleLeaveGroup} className="btn btn-r btn-sm">
                  <LogOut size={12} />
                  Leave
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleGeneratePairCode}
                  disabled={generatingCode}
                  className="btn btn-ghost btn-sm"
                >
                  <Copy size={12} />
                  {generatingCode ? 'Generating...' : 'Get Pair Code'}
                </button>
              </div>
              {generatedCode && (
                <div className="mt-2 p-2 rounded-lg bg-surface border">
                  <div className="text-[11px] text-muted mb-1">
                    Share this code with your partner (valid 15 min):
                  </div>
                  <div className="font-mono text-[16px] font-bold tracking-widest text-center py-1 text-accent">
                    {generatedCode.split(' ')[0]}
                  </div>
                  {generatedCode.includes('expires') && (
                    <div className="text-[10px] text-muted text-center">
                      {generatedCode.split('(')[1]?.replace(')', '')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Catalog */}
      <div className="panel">
        <div className="ptitle">
          <Database size={13} className="inline mr-1.5" />
          Catalog
        </div>
        <div className="flex flex-col gap-3">
          {catalogStats && (catalogStats.items > 0 || catalogStats.shops > 0) ? (
            <div className="flex items-center gap-2 text-[12px]">
              <CheckCircle size={13} className="text-success shrink-0" />
              <span className="text-text">
                Catalog: <strong>{catalogStats.items.toLocaleString()}</strong> items,{' '}
                <strong>{catalogStats.shops.toLocaleString()}</strong> shops — Auto-sync enabled
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px]">
              <RefreshCw
                size={13}
                className="shrink-0"
                style={{
                  animation: 'spin 1s linear infinite',
                  color: 'var(--blue-t)',
                }}
              />
              <span className="text-muted">Syncing catalog from server…</span>
            </div>
          )}
          <div className="text-[11px] text-dim">
            Catalog is downloaded automatically on first run and kept in sync in real-time.
          </div>
        </div>
      </div>

      <div className="text-center py-3 pb-1 text-muted text-[11px]">CC Manager v0.1.0</div>
    </div>
  )
}
