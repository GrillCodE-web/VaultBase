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
  LogOut,
  CheckCircle,
  Bell,
  CalendarClock,
  Sun,
  Moon,
  Truck,
  Activity,
  X,
  Compass,
} from 'lucide-react'
import { Modal } from '../components/Modal.jsx'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { useTheme } from '../hooks/useTheme'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAuth } from '../hooks/useAuth'
import { LicenseSection } from '../components/LicenseSection'
import { STATUS_COLORS } from '../constants/colors'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

// Единая политика паролей с мастер-паролем (12+ символов, верхний/нижний
// регистр, цифра, спецсимвол) — совпадает с PasswordValidation в бэкенде.
// FEAT-012: id шагов live-теста (бэкенд stuffer::test_write) → i18n-ключи.
const STUFFER_TEST_STEPS = {
  list_couriers: 'stuffer_test_step_list',
  add_courier: 'stuffer_test_step_add',
  new_package: 'stuffer_test_step_pkg',
}

function isStrongPassword(pw) {
  return (
    pw.length >= 12 &&
    /[A-ZА-ЯЁ]/.test(pw) &&
    /[a-zа-яё]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-zА-Яа-яЁё0-9]/.test(pw)
  )
}

export default function Settings() {
  const { t, lang, setLang } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { confirm } = useConfirm()
  const { theme, setTheme } = useTheme()
  const { currentUser, isAdmin, hasPerm } = useAuth()

  const [binApiKey, setBinApiKey] = useState('')
  const [binApiKeySet, setBinApiKeySet] = useState(false)
  const [binApiSaved, setBinApiSaved] = useState(false)
  const [stufferUrl, setStufferUrl] = useState('')
  const [stufferKey, setStufferKey] = useState('')
  const [stufferKeySet, setStufferKeySet] = useState(false)
  // MGR-018 (этап D): share-ключ от менеджера активен → секция read-only
  const [stufferShared, setStufferShared] = useState(false)
  const [stufferSaved, setStufferSaved] = useState(false)
  // FEAT-011: реестр stuffer-аккаунтов с индивидуальными API-ключами
  const [stufferAccounts, setStufferAccounts] = useState([])
  const [accLabel, setAccLabel] = useState('')
  const [accKey, setAccKey] = useState('')
  const [accUrl, setAccUrl] = useState('')
  const [accSaving, setAccSaving] = useState(false)
  const [exportingBackup, setExportingBackup] = useState(false)
  const [wsStatus, setWsStatus] = useState(null) // { connected, connecting }
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  // Смена пароля оператора (своего аккаунта)
  const [ownPwForm, setOwnPwForm] = useState({ current: '', next: '', confirm: '' })
  const [savingOwnPw, setSavingOwnPw] = useState(false)
  // Аудит лог (admin)
  const [auditLog, setAuditLog] = useState(null)
  const [auditFilter, setAuditFilter] = useState({ action: '', userId: '' })
  const [auditLoading, setAuditLoading] = useState(false)
  const [onlineSessions, setOnlineSessions] = useState([])
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [autoLock, setAutoLock] = useState('300')
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [lastBackup, setLastBackup] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [badgeNotifyImap, setBadgeNotifyImap] = useState(true)
  const [badgeNotifyTracking, setBadgeNotifyTracking] = useState(true)
  // UX-012: нативные OS-уведомления (config os_notify_*, '0' = выкл)
  const [osNotifyMail, setOsNotifyMail] = useState(true)
  const [osNotifyPackage, setOsNotifyPackage] = useState(true)
  const [osNotifyErrors, setOsNotifyErrors] = useState(true)
  // FEAT-006/007: пороги ежедневных напоминаний (cron в background.rs)
  const [reminderCardDays, setReminderCardDays] = useState('14')
  const [reminderTrackingDays, setReminderTrackingDays] = useState('5')
  // MGR-013: panic-пароль (duress) — sidecar v3, проверка на unlock до открытия БД
  const [panicSet, setPanicSet] = useState(false)
  const [panicInput, setPanicInput] = useState('')
  const [panicSaving, setPanicSaving] = useState(false)
  const [catalogStats, setCatalogStats] = useState(null)

  useEffect(() => {
    // ★ Insight: Флаг cancelled предотвращает setState после unmount
    let cancelled = false

    // All DB calls in parallel — fast
    Promise.allSettled([
      invoke('get_config', { key: 'bin_api_key_set' }).then(v => {
        if (!cancelled) setBinApiKeySet(v === '1')
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
      invoke('get_config', { key: 'os_notify_mail' }).then(v => {
        if (!cancelled) setOsNotifyMail(v !== '0')
      }),
      invoke('get_config', { key: 'os_notify_package' }).then(v => {
        if (!cancelled) setOsNotifyPackage(v !== '0')
      }),
      invoke('get_config', { key: 'os_notify_errors' }).then(v => {
        if (!cancelled) setOsNotifyErrors(v !== '0')
      }),
      invoke('get_config', { key: 'reminder_card_expiry_days' }).then(v => {
        if (!cancelled && v) setReminderCardDays(v)
      }),
      invoke('get_config', { key: 'reminder_tracking_stale_days' }).then(v => {
        if (!cancelled && v) setReminderTrackingDays(v)
      }),
      invoke('stuffer_get_config').then(cfg => {
        if (!cancelled && cfg) {
          setStufferUrl(cfg.base_url || '')
          setStufferKeySet(!!cfg.api_key_set)
          setStufferShared(!!cfg.shared)
        }
      }),
      invoke('stuffer_list_accounts')
        .then(list => {
          if (!cancelled && Array.isArray(list)) setStufferAccounts(list)
        })
        .catch(() => {}),
      invoke('get_catalog_stats')
        .then(s => {
          if (!cancelled) setCatalogStats(s)
        })
        .catch(e => console.error('[Settings] Failed to get catalog stats:', e)),
      invoke('has_panic_password').then(v => {
        if (!cancelled) setPanicSet(!!v)
      }),
    ])
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
      u1.then(fn => fn()).catch(e => handleError(e))
      u2.then(fn => fn()).catch(e => handleError(e))
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

  // UX-012: OS-уведомления вкл/выкл
  const handleOsNotifyMail = async val => {
    setOsNotifyMail(val)
    try {
      await invoke('set_config', { key: 'os_notify_mail', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleOsNotifyMail')
      toastErr(getErrorMessage(error))
    }
  }

  const handleOsNotifyPackage = async val => {
    setOsNotifyPackage(val)
    try {
      await invoke('set_config', { key: 'os_notify_package', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleOsNotifyPackage')
      toastErr(getErrorMessage(error))
    }
  }

  const handleOsNotifyErrors = async val => {
    setOsNotifyErrors(val)
    try {
      await invoke('set_config', { key: 'os_notify_errors', value: val ? '1' : '0' })
    } catch (e) {
      const error = handleError(e, 'Settings.toggleOsNotifyErrors')
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

  const handleReminderCardDays = async val => {
    setReminderCardDays(val)
    try {
      await invoke('set_config', { key: 'reminder_card_expiry_days', value: val })
    } catch (e) {
      const error = handleError(e, 'Settings.setReminderCardDays')
      toastErr(getErrorMessage(error))
    }
  }

  const handleReminderTrackingDays = async val => {
    setReminderTrackingDays(val)
    try {
      await invoke('set_config', { key: 'reminder_tracking_stale_days', value: val })
    } catch (e) {
      const error = handleError(e, 'Settings.setReminderTrackingDays')
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
      setBinApiKeySet(!!binApiKey.trim())
      setBinApiKey('')
      setBinApiSaved(true)
      toastOk(t('settings_bin_api_saved'))
      setTimeout(() => setBinApiSaved(false), 2000)
    } catch (e) {
      const error = handleError(e, 'Settings.saveBinApiKey')
      toastErr(getErrorMessage(error))
    }
  }

  const clearBinApiKey = async () => {
    try {
      await invoke('set_config', { key: 'bin_api_key', value: '' })
      setBinApiKeySet(false)
      setBinApiKey('')
      toastOk(t('settings_bin_api_saved'))
    } catch (e) {
      const error = handleError(e, 'Settings.clearBinApiKey')
      toastErr(getErrorMessage(error))
    }
  }

  // FEAT-012: live-тест пишущих методов панели (add_courier + new_package).
  // Бэкенд возвращает отчёт по шагам; модалка показывает, где панель отвалилась.
  const [stufferTesting, setStufferTesting] = useState(false)
  const [stufferTest, setStufferTest] = useState(null)
  const runStufferTest = async () => {
    setStufferTesting(true)
    try {
      const report = await invoke('stuffer_test_write')
      setStufferTest(report)
      if (report?.ok) toastOk(t('stuffer_test_ok'))
      else toastErr(t('stuffer_test_failed'))
    } catch (e) {
      const error = handleError(e, 'Settings.runStufferTest')
      toastErr(getErrorMessage(error))
    } finally {
      setStufferTesting(false)
    }
  }

  const saveStufferConfig = async () => {
    try {
      // apiKey шлём строкой, а не null. Tauri v2 при десериализации аргумента
      // отвергает явный null для Option<String> ("invalid type: null, expected
      // a string"); пустая строка проходит, а бэкенд трактует её как «ключ не
      // трогать» (main.rs: if !key.trim().is_empty()).
      await invoke('stuffer_set_config', {
        apiKey: stufferKey.trim(),
        baseUrl: stufferUrl.trim(),
      })
      if (stufferKey.trim()) setStufferKeySet(true)
      setStufferKey('')
      setStufferSaved(true)
      toastOk(t('settings_stuffer_saved'))
      setTimeout(() => setStufferSaved(false), 2000)
    } catch (e) {
      const error = handleError(e, 'Settings.saveStufferConfig')
      toastErr(getErrorMessage(error))
    }
  }

  // FEAT-011: аккаунты панели с индивидуальными API-ключами. Ключ после
  // сохранения не показывается (бэкенд его не отдаёт — serde skip), поэтому
  // список отображает только label/url; смена ключа = удалить + добавить.
  const addStufferAccount = async () => {
    if (!accLabel.trim() || !accKey.trim()) {
      toastErr(t('settings_stuffer_acc_required'))
      return
    }
    setAccSaving(true)
    try {
      const args = { label: accLabel.trim(), apiKey: accKey.trim() }
      if (accUrl.trim()) args.baseUrl = accUrl.trim()
      await invoke('stuffer_add_account', args)
      setStufferAccounts(await invoke('stuffer_list_accounts'))
      setAccLabel('')
      setAccKey('')
      setAccUrl('')
      toastOk(t('settings_stuffer_acc_added'))
    } catch (e) {
      const error = handleError(e, 'Settings.addStufferAccount')
      toastErr(getErrorMessage(error))
    } finally {
      setAccSaving(false)
    }
  }

  const deleteStufferAccount = async acc => {
    const ok = await confirm(t('settings_stuffer_acc_delete_confirm', { label: acc.label }), {
      title: t('settings_stuffer_accounts'),
      confirmLabel: t('btn_delete') || 'Delete',
    })
    if (!ok) return
    try {
      await invoke('stuffer_delete_account', { id: acc.id })
      setStufferAccounts(prev => prev.filter(a => a.id !== acc.id))
      toastOk(t('settings_stuffer_acc_deleted'))
    } catch (e) {
      const error = handleError(e, 'Settings.deleteStufferAccount')
      toastErr(getErrorMessage(error))
    }
  }

  const [seeding, setSeeding] = useState(false)
  const handleSeedTestData = async () => {
    const ok = await confirm(
      'В базу добавятся демо-записи: карты, магазины, профили, заказы, email, прокси — по несколько штук. Удобно посмотреть интерфейс. Реальные данные не затрагиваются, если они уже есть.',
      { title: 'Загрузить тестовые данные?', confirmLabel: 'Загрузить' }
    )
    if (!ok) return
    setSeeding(true)
    try {
      const summary = await invoke('seed_test_data', { force: false })
      toastOk(summary || 'Тестовые данные загружены')
    } catch (e) {
      if (String(e).includes('data_exists')) {
        const force = await confirm('В базе уже есть записи. Добавить тестовые поверх них?', {
          title: 'Данные уже есть',
          confirmLabel: 'Добавить',
        })
        if (force) {
          try {
            const summary = await invoke('seed_test_data', { force: true })
            toastOk(summary || 'Тестовые данные добавлены')
          } catch (err) {
            toastErr(getErrorMessage(handleError(err, 'Settings.seed')))
          }
        }
      } else {
        toastErr(getErrorMessage(handleError(e, 'Settings.seed')))
      }
    } finally {
      setSeeding(false)
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
        filters: [{ name: 'VaultBase Backup', extensions: ['db', 'ccbak'] }],
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

  const handleChangeOwnPassword = async () => {
    if (ownPwForm.next !== ownPwForm.confirm) {
      toastErr('Пароли не совпадают')
      return
    }
    if (!isStrongPassword(ownPwForm.next)) {
      toastErr('Пароль: минимум 12 символов, заглавная и строчная буквы, цифра и спецсимвол')
      return
    }
    setSavingOwnPw(true)
    try {
      await invoke('change_own_password', {
        currentPassword: ownPwForm.current,
        newPassword: ownPwForm.next,
      })
      toastOk('Пароль успешно изменён')
      setOwnPwForm({ current: '', next: '', confirm: '' })
    } catch (e) {
      const msg = String(e)
      if (msg.includes('wrong_current_password')) toastErr('Неверный текущий пароль')
      else toastErr(msg)
    } finally {
      setSavingOwnPw(false)
    }
  }

  // MGR-013: установка/снятие panic-пароля
  const handleSetPanic = async () => {
    if (!panicInput || panicSaving) return
    setPanicSaving(true)
    try {
      await invoke('set_panic_password', { password: panicInput })
      setPanicSet(true)
      setPanicInput('')
      toastOk(t('panic_set_ok'))
    } catch (e) {
      const msg = String(e)
      if (msg.includes('panic_equals_master')) toastErr(t('panic_err_same'))
      else if (msg.includes('password_too_weak')) toastErr(t('auth_err_too_weak'))
      else toastErr(getErrorMessage(handleError(e, 'Settings.setPanicPassword')))
    } finally {
      setPanicSaving(false)
    }
  }

  const handleRemovePanic = async () => {
    const ok = await confirm(t('panic_remove_confirm'), { title: t('panic_title') })
    if (!ok) return
    try {
      await invoke('remove_panic_password')
      setPanicSet(false)
      toastOk(t('panic_removed'))
    } catch (e) {
      toastErr(getErrorMessage(handleError(e, 'Settings.removePanicPassword')))
    }
  }

  const loadAuditLog = async () => {
    setAuditLoading(true)
    try {
      const [log, sessions] = await Promise.all([
        invoke('get_full_audit_log', {
          userId: auditFilter.userId ? Number(auditFilter.userId) : null,
          actionType: auditFilter.action || null,
          limit: 100,
          offset: 0,
        }),
        invoke('get_online_sessions'),
      ])
      setAuditLog(log)
      setOnlineSessions(sessions)
    } catch (e) {
      toastErr(String(e))
    } finally {
      setAuditLoading(false)
    }
  }

  const revokeSession = async sessionId => {
    try {
      await invoke('revoke_session', { sessionId })
      setOnlineSessions(s => s.filter(x => x.session_id !== sessionId))
      toastOk('Сессия завершена')
    } catch (e) {
      toastErr(String(e))
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

        {/* UX-012: нативные OS-уведомления */}
        <div className="panel">
          <div className="ptitle">
            <Bell size={13} className="inline mr-1.5" />
            {t('notify_os_section')}
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('notify_os_mail')}</div>
              <div className="setting-desc">{t('notify_os_mail_desc')}</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={osNotifyMail}
                onChange={e => handleOsNotifyMail(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('notify_os_package')}</div>
              <div className="setting-desc">{t('notify_os_package_desc')}</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={osNotifyPackage}
                onChange={e => handleOsNotifyPackage(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('notify_os_errors')}</div>
              <div className="setting-desc">{t('notify_os_errors_desc')}</div>
            </div>
            <label className="toggle-wrap">
              <input
                type="checkbox"
                checked={osNotifyErrors}
                onChange={e => handleOsNotifyErrors(e.target.checked)}
              />
              <span className="track" />
            </label>
          </div>
        </div>

        {/* FEAT-006/007: ежедневные напоминания (cron в background.rs) */}
        <div className="panel">
          <div className="ptitle">
            <CalendarClock size={13} className="inline mr-1.5" />
            {t('reminders_section')}
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('reminder_card_expiry_title')}</div>
              <div className="setting-desc">{t('reminder_card_expiry_desc')}</div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {['3', '7', '14', '30'].map(v => (
                <button
                  key={v}
                  onClick={() => handleReminderCardDays(v)}
                  className={`btn btn-sm ${reminderCardDays === v ? 'btn-b' : 'btn-ghost'}`}
                >
                  {v} {t('reminder_days_short')}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('reminder_tracking_title')}</div>
              <div className="setting-desc">{t('reminder_tracking_desc')}</div>
            </div>
            <div className="flex gap-1 flex-wrap">
              {['3', '5', '10', '14'].map(v => (
                <button
                  key={v}
                  onClick={() => handleReminderTrackingDays(v)}
                  className={`btn btn-sm ${reminderTrackingDays === v ? 'btn-b' : 'btn-ghost'}`}
                >
                  {v} {t('reminder_days_short')}
                </button>
              ))}
            </div>
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
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('panic_title')}</div>
              <div className="setting-desc">{t('panic_desc')}</div>
            </div>
            {panicSet ? (
              <div className="flex gap-1 items-center">
                <span className="st st-active">{t('panic_status_set')}</span>
                <button onClick={handleRemovePanic} className="btn btn-r btn-sm">
                  {t('panic_remove')}
                </button>
              </div>
            ) : (
              <div className="flex gap-1 items-center">
                <input
                  type="password"
                  className="field-input"
                  value={panicInput}
                  onChange={e => setPanicInput(e.target.value)}
                  placeholder={t('panic_placeholder')}
                  autoComplete="new-password"
                />
                <button
                  onClick={handleSetPanic}
                  disabled={!panicInput || panicSaving}
                  className="btn btn-sm"
                >
                  {panicSaving ? t('loading') : t('panic_set_btn')}
                </button>
              </div>
            )}
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
              <div className="setting-title">Appearance</div>
              <div className="setting-desc">Follow the system or pick a fixed theme</div>
            </div>
            {/* Сегментированный контрол вместо кнопки-переключателя:
                режимов три, а toggle умеет только два. */}
            <div className="tabs" role="group" aria-label="Appearance">
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`tab ${theme === value ? 'active' : ''}`}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                >
                  <Icon size={13} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* BIN API */}
        <div className="panel">
          <div className="ptitle">
            <Zap size={13} className="inline mr-1.5" />
            {t('settings_bin_enrichment')}
          </div>
          <div className="setting-desc mb-2">
            API key from iinapi.com for automatic card BIN enrichment.
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={binApiKey}
              onChange={e => setBinApiKey(e.target.value)}
              placeholder={binApiKeySet ? '••••••••••••' : t('settings_bin_api_placeholder')}
              className="form-input flex-1"
              autoComplete="off"
            />
            <button
              onClick={saveBinApiKey}
              disabled={!binApiKey.trim()}
              className={`btn btn-sm ${binApiSaved ? 'btn-g' : 'btn-b'}`}
            >
              {binApiSaved ? t('msg_saved') : t('btn_save')}
            </button>
            {binApiKeySet && (
              <button onClick={clearBinApiKey} className="btn btn-ghost btn-sm">
                {t('btn_clear') || 'Clear'}
              </button>
            )}
          </div>
          <div className="setting-desc mt-1.5">
            {binApiKeySet
              ? t('settings_bin_api_configured') || 'Configured'
              : t('settings_bin_api_not_configured') || 'Not configured'}
          </div>
        </div>

        {/* Stuffer API. Гейт по manage_couriers (право нужно для
            stuffer_set_config на бэкенде), но админ проходит всегда — иначе
            при рассинхроне прав раздел исчезал и ключ было негде ввести. */}
        {(isAdmin || hasPerm('manage_couriers')) && (
          <div className="panel">
            <div className="ptitle">
              <Truck size={13} className="inline mr-1.5" />
              {t('settings_stuffer_title')}
            </div>
            <div className="setting-desc mb-2">{t('settings_stuffer_desc')}</div>
            {stufferShared && (
              <div className="setting-desc mb-2">{t('settings_stuffer_shared')}</div>
            )}
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={stufferUrl}
                onChange={e => setStufferUrl(e.target.value)}
                placeholder={t('settings_stuffer_url')}
                className="form-input"
                disabled={stufferShared}
              />
              <input
                type="password"
                value={stufferKey}
                onChange={e => setStufferKey(e.target.value)}
                placeholder={
                  stufferKeySet ? t('settings_stuffer_key_set') : t('settings_stuffer_key_ph')
                }
                className="form-input"
                disabled={stufferShared}
              />
              <div className="flex gap-2 self-end">
                {!stufferShared && (
                  <button
                    onClick={saveStufferConfig}
                    className={`btn btn-sm ${stufferSaved ? 'btn-g' : 'btn-b'}`}
                  >
                    {stufferSaved ? t('settings_stuffer_saved') : t('settings_stuffer_save')}
                  </button>
                )}
                <button
                  onClick={runStufferTest}
                  disabled={!stufferKeySet || stufferTesting}
                  title={stufferKeySet ? t('stuffer_test_hint') : t('stuffer_test_need_key')}
                  className="btn btn-sm btn-ghost"
                >
                  {stufferTesting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Activity size={14} />
                  )}
                  {stufferTesting ? t('stuffer_test_running') : t('stuffer_test_btn')}
                </button>
              </div>
            </div>

            {/* FEAT-011: дополнительные аккаунты панели с индивидуальными
                API-ключами. Ключи не отображаются — бэкенд их не отдаёт. */}
            <div className="mt-3">
              <div className="setting-desc mb-2">{t('settings_stuffer_accounts')}</div>
              {stufferAccounts.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                  {stufferAccounts.map(acc => (
                    <div key={acc.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">
                        {acc.label}
                        {acc.base_url ? (
                          <span className="text-muted text-xs"> · {acc.base_url}</span>
                        ) : null}
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        title={t('btn_delete')}
                        onClick={() => deleteStufferAccount(acc)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={accLabel}
                  onChange={e => setAccLabel(e.target.value)}
                  placeholder={t('settings_stuffer_acc_label_ph')}
                  className="form-input"
                />
                <input
                  type="password"
                  value={accKey}
                  onChange={e => setAccKey(e.target.value)}
                  placeholder={t('settings_stuffer_acc_key_ph')}
                  className="form-input"
                />
                <input
                  type="text"
                  value={accUrl}
                  onChange={e => setAccUrl(e.target.value)}
                  placeholder={t('settings_stuffer_acc_url_ph')}
                  className="form-input"
                />
                <button
                  onClick={addStufferAccount}
                  disabled={accSaving}
                  className="btn btn-sm btn-b self-end"
                >
                  {accSaving ? t('settings_stuffer_acc_adding') : t('settings_stuffer_acc_add')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* FEAT-012: отчёт live-теста пишущих методов Stuffer */}
        <Modal
          isOpen={stufferTest != null}
          onClose={() => setStufferTest(null)}
          title={t('stuffer_test_title')}
          size="md"
        >
          <div className="stest-list">
            {stufferTest?.steps?.map(s => (
              <div key={s.step} className="stest-row">
                <span className={`st st-${s.status}`}>{t(`stuffer_test_st_${s.status}`)}</span>
                <div className="stest-text">
                  <span className="stest-name">{t(STUFFER_TEST_STEPS[s.step] || s.step)}</span>
                  <span className="stest-detail">{s.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </Modal>

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
            <button
              onClick={handleBackup}
              disabled={exportingBackup}
              className="btn btn-b btn-sm"
              style={{ opacity: exportingBackup ? 0.6 : 1 }}
            >
              {exportingBackup ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
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
          <div className="setting-row">
            <div className="setting-info">
              <div className="setting-title">{t('settings_seed_title')}</div>
              <div className="setting-desc">{t('settings_seed_desc')}</div>
            </div>
            <button
              onClick={handleSeedTestData}
              disabled={seeding}
              className="btn btn-ghost btn-sm"
            >
              {seeding ? <RefreshCw size={13} className="animate-spin" /> : <Database size={13} />}
              {seeding ? t('msg_loading') : t('settings_seed_btn')}
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
            </div>
            <div>
              {wsStatus === null ? (
                <span className="st st-pending">
                  <RefreshCw size={10} className="animate-spin" /> Connecting…
                </span>
              ) : wsStatus.connected ? (
                <span className="st st-active">
                  <Wifi size={11} /> Connected
                </span>
              ) : wsStatus.connecting ? (
                <span className="st st-pending">
                  <RefreshCw size={10} className="animate-spin" /> Connecting…
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
              className="text-12 mono"
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
                    maxLength={128}
                    autoComplete="new-password"
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
      </div>

      {/* Catalog */}
      <div className="panel">
        <div className="ptitle">
          <Database size={13} className="inline mr-1.5" />
          Catalog
        </div>
        <div className="flex flex-col gap-3">
          {catalogStats && (catalogStats.items > 0 || catalogStats.shops > 0) ? (
            <div className="flex items-center gap-2 text-12">
              <CheckCircle size={13} className="text-success shrink-0" />
              <span className="text-text">
                Catalog: <strong>{catalogStats.items.toLocaleString()}</strong> items,{' '}
                <strong>{catalogStats.shops.toLocaleString()}</strong> shops — Auto-sync enabled
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-12">
              <RefreshCw size={13} className="shrink-0 animate-spin text-blue-t" />
              <span className="text-muted">Syncing catalog from server…</span>
            </div>
          )}
          <div className="text-11 text-dim">
            Catalog is downloaded automatically on first run and kept in sync in real-time.
          </div>
        </div>
      </div>

      {/* Тур по интерфейсу (UX-013) */}
      <div className="panel">
        <div className="ptitle">
          <Compass size={13} className="inline mr-1.5" />
          {t('settings_tour_title')}
        </div>
        <div className="flex flex-col gap-3">
          <div className="text-11 text-dim">{t('settings_tour_hint')}</div>
          <div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => window.dispatchEvent(new window.CustomEvent('vb:start-tour'))}
            >
              {t('settings_tour_btn')}
            </button>
          </div>
        </div>
      </div>

      {/* Смена пароля аккаунта (для операторов) */}
      {currentUser && !isAdmin && (
        <div className="panel mt-4">
          <div className="ptitle">
            <Shield size={13} className="inline mr-1.5" />
            Смена пароля аккаунта
          </div>
          <div className="flex flex-col gap-3">
            {[
              { key: 'current', label: 'Текущий пароль', placeholder: 'Текущий пароль' },
              { key: 'next', label: 'Новый пароль', placeholder: 'Минимум 12 символов' },
              { key: 'confirm', label: 'Повторите пароль', placeholder: 'Повторите новый пароль' },
            ].map(({ key, label, placeholder }) => (
              <div className="form-group" key={key}>
                <label className="form-label">{label}</label>
                <input
                  type="password"
                  value={ownPwForm[key]}
                  onChange={e => setOwnPwForm(p => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="form-input"
                  maxLength={128}
                  autoComplete="new-password"
                />
              </div>
            ))}
            <div>
              <button
                onClick={handleChangeOwnPassword}
                disabled={savingOwnPw || !ownPwForm.current || !ownPwForm.next}
                className="btn btn-r btn-sm"
              >
                {savingOwnPw ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Shield size={13} />
                )}
                Сменить пароль
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Аудит и активные сессии (только для admin) */}
      {isAdmin && (
        <div className="panel mt-4">
          <div className="ptitle">
            <Shield size={13} className="inline mr-1.5" />
            Аудит и сессии
          </div>

          {/* Фильтры */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <input
              type="text"
              value={auditFilter.action}
              onChange={e => setAuditFilter(f => ({ ...f, action: e.target.value }))}
              placeholder="Тип действия (login, take_card…)"
              className="form-input flex-1 min-w-[160px]"
            />
            <input
              type="number"
              value={auditFilter.userId}
              onChange={e => setAuditFilter(f => ({ ...f, userId: e.target.value }))}
              placeholder="ID пользователя"
              className="form-input w-[140px]"
            />
            <button onClick={loadAuditLog} disabled={auditLoading} className="btn btn-b btn-sm">
              {auditLoading ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Загрузить
            </button>
          </div>

          {/* Активные сессии */}
          {onlineSessions.length > 0 && (
            <div className="mb-4">
              <div className="text-11 font-semibold text-muted uppercase tracking-wide mb-2">
                Активные сессии
              </div>
              <div className="flex flex-col gap-1">
                {onlineSessions.map(s => (
                  <div
                    key={s.session_id}
                    className="flex items-center justify-between p-2 rounded-lg bg-surface border text-12"
                  >
                    <div>
                      <span className="font-semibold">{s.username}</span>
                      <span className="text-muted ml-2">{s.ip || 'localhost'}</span>
                      <span className="text-dim ml-2">{s.created_at}</span>
                    </div>
                    <button
                      onClick={() => revokeSession(s.session_id)}
                      className="btn btn-r btn-sm"
                    >
                      <LogOut size={11} /> Завершить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Лог событий */}
          {auditLog === null ? (
            <div className="text-muted text-12">Нажмите «Загрузить» для просмотра аудит-лога</div>
          ) : auditLog.length === 0 ? (
            <div className="text-muted text-12">Событий не найдено</div>
          ) : (
            <div className="overflow-auto max-h-[400px]">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>Действие</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((row, i) => (
                    <tr key={i}>
                      <td className="mono text-11 whitespace-nowrap">{row.created_at}</td>
                      <td>{row.username || row.user_id}</td>
                      <td>
                        <span className="st st-pending text-10">{row.action_type}</span>
                      </td>
                      <td className="text-muted text-11 max-w-[300px] truncate">{row.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="text-center py-3 pb-1 text-muted text-11">VaultBase v0.1.0</div>
    </div>
  )
}
