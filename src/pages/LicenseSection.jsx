import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ShieldCheck, ShieldAlert, WifiOff, RefreshCw, Copy, Check } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useToast } from '../hooks/useToast'

export function LicenseSection() {
  const { t } = useLang()
  const { success: toastOk } = useToast()

  const [status, setStatus] = useState(null)
  const [installId, setInstallId] = useState('')
  const [showId, setShowId] = useState(false)
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // ★ Insight: Ref для cleanup setTimeout при unmount
  const copyTimerRef = useRef(null)

  const loadStatus = () => {
    invoke('get_license_status')
      .then(s => setStatus(s))
      .catch(() => setStatus('offline'))
    invoke('get_installation_id')
      .then(setInstallId)
      .catch(e => console.error('[LicenseSection] Failed to get installation ID:', e))
  }

  useEffect(() => {
    loadStatus()
    // ★ Insight: Cleanup timer при unmount предотвращает setState на unmounted компоненте
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const s = await invoke('retry_license_connection')
      setStatus(s)
      if (s === 'active') {
        toastOk(t('license_verified') || 'License verified.')
      }
    } catch {
      setStatus('offline')
    } finally {
      setRetrying(false)
    }
  }

  const handleCopyId = () => {
    // ★ Insight: .catch() для обработки ошибок clipboard + cleanup timer
    navigator.clipboard
      .writeText(installId)
      .then(() => {
        setCopied(true)
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(e => {
        console.error('[LicenseSection] Failed to copy:', e)
      })
  }

  const statusMeta = {
    active: {
      label: t('license_active') || 'Active',
      color: 'var(--color-success)',
      Icon: ShieldCheck,
    },
    revoked: {
      label: t('license_revoked') || 'Revoked',
      color: 'var(--color-error)',
      Icon: ShieldAlert,
    },
    offline: {
      label: t('license_offline') || 'Offline',
      color: 'var(--color-warning)',
      Icon: WifiOff,
    },
    not_activated: {
      label: t('license_none') || 'Not Activated',
      color: 'var(--muted)',
      Icon: ShieldAlert,
    },
  }

  const meta = statusMeta[status] || statusMeta['offline']
  const { label, color, Icon } = meta

  return (
    <div className="rounded-xl p-5 bg-inset border border-border">
      <h3 className="text-sm font-semibold text-white mb-4">
        {t('settings_license') || 'License'}
      </h3>

      {/* Status row */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-t">{t('settings_license_status') || 'Status'}</span>
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color }} />
          <span className="text-sm font-medium" style={{ color }}>
            {label}
          </span>
        </div>
      </div>

      {/* Installation ID row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <span className="text-sm pt-0.5 text-gray-t">
          {t('settings_installation_id') || 'Installation ID'}
        </span>
        <div className="flex items-center gap-2">
          {showId ? (
            <span className="text-xs mono px-2 py-1 rounded-lg select-all bg-card text-text-2 max-w-[200px] break-all">
              {installId || '—'}
            </span>
          ) : (
            <span className="text-sm text-muted">••••••••</span>
          )}
          <button
            onClick={() => setShowId(v => !v)}
            className="text-xs px-2 py-1 rounded-lg transition-colors text-muted bg-card"
          >
            {showId ? t('btn_hide') : t('btn_show')}
          </button>
          {showId && installId && (
            <button
              onClick={handleCopyId}
              className="p-1 rounded-lg transition-colors bg-card"
              style={{ color: copied ? 'var(--color-success)' : 'var(--muted)' }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Retry button — only in offline mode */}
      {status === 'offline' && (
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors bg-warning-bg text-warning border border-warning-bg"
          style={{
            opacity: retrying ? 0.6 : 1,
            cursor: retrying ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} />
          {retrying
            ? t('license_retrying') || 'Retrying…'
            : t('license_retry') || 'Retry Connection'}
        </button>
      )}
    </div>
  )
}
