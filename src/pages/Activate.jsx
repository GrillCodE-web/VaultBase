import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Copy, Check, KeyRound, ShieldCheck } from 'lucide-react'
import { useLang } from '../hooks/useLang'

// Auto-format XXXX-XXXX-XXXX-XXXX as user types
function formatKey(raw) {
  const clean = raw
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 16)
  const parts = []
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.slice(i, i + 4))
  }
  return parts.join('-')
}

export default function Activate({ onActivated }) {
  const { t } = useLang()
  const [challengeCode, setChallengeCode] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [activationKey, setActivationKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    invoke('get_challenge_code')
      .then(setChallengeCode)
      .catch(() => setChallengeCode('????-????-????-????'))
    // FINAL-016: Handle empty installationId — show fallback
    invoke('get_installation_id')
      .then(id => {
        if (id) setInstallationId(id)
        else setInstallationId('N/A — restart app')
      })
      .catch(e => {
        console.error('[Activate] Failed to get installation ID:', e)
        setInstallationId('Error — restart app')
      })
  }, [])

  const handleCopy = useCallback(() => {
    if (!challengeCode) return
    navigator.clipboard.writeText(challengeCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [challengeCode])

  const handleCopyId = useCallback(() => {
    if (!installationId) return
    navigator.clipboard.writeText(installationId).then(() => {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    })
  }, [installationId])

  const handleKeyChange = e => {
    const formatted = formatKey(e.target.value)
    setActivationKey(formatted)
    setError('')
  }

  const handleActivate = async () => {
    const clean = activationKey.replace(/-/g, '')
    if (clean.length !== 16) {
      setError(t('activate_key_invalid') || 'Enter a complete 16-character activation key.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await invoke('activate_license', { activationKey })
      setSuccess(true)
      setTimeout(() => {
        if (onActivated) onActivated()
      }, 1500)
    } catch (err) {
      const map = {
        invalid_key: t('activate_err_invalid_key') || 'Invalid activation key.',
        already_activated: t('activate_err_already') || 'Already activated.',
        network_error: t('activate_err_network') || 'Network error. Check your connection.',
      }
      setError(map[err] || `${t('activate_err_unknown') || 'Error'}: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = e => {
    if (e.key === 'Enter') handleActivate()
  }

  return (
    <div className="auth-screen">
      <div className="auth-bg-glow" />
      <div className="auth-card max-w-[440px]">
        {/* Header */}
        <div className="auth-logo-wrap">
          <div className="auth-logo-icon activate border">
            <ShieldCheck size={28} />
          </div>
          <h1 className="auth-title text-18">{t('activate_title') || 'Activation Required'}</h1>
          <p className="auth-sub">
            {t('activate_subtitle') || 'This copy of VaultBase must be activated.'}
          </p>
        </div>

        {/* Installation Code Block */}
        <div className="bg-inset border rounded-[10px] p-4 mb-5">
          <p className="text-11 text-muted mb-3">
            {t('activate_your_code') || 'Your installation code:'}
          </p>
          <div className="flex items-center gap-3 mb-3">
            <span className="flex-1 text-center text-18 mono font-bold tracking-widest select-all activation-code-display">
              {challengeCode || t('msg_loading')}
            </span>
            <button
              onClick={handleCopy}
              className="btn btn-b btn-sm"
              style={{
                background: copied ? 'var(--color-success-bg)' : undefined,
                color: copied ? 'var(--color-success)' : undefined,
                borderColor: copied ? 'var(--color-success-bg)' : undefined,
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('copied') || 'Copied' : t('copy') || 'Copy'}
            </button>
          </div>
          {installationId && (
            <div className="border-t pt-[10px]">
              <p className="text-11 text-muted mb-[6px]">Installation ID:</p>
              <div className="flex items-center gap-2">
                <span className="mono flex-1 text-11 text-muted overflow-hidden text-ellipsis whitespace-nowrap select-all">
                  {installationId}
                </span>
                <button onClick={handleCopyId} className="btn btn-ghost btn-sm shrink-0">
                  {copiedId ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Instruction */}
        <p className="text-13 text-center mb-5 leading-[1.6] text-text-2">
          {t('activate_instruction') ||
            'Send this code to your administrator to receive an activation key.'}
        </p>

        {/* Key Input */}
        <div className="form-group">
          <label className="auth-label">{t('activate_key_label') || 'Activation Key'}</label>
          <div className="relative">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={activationKey}
              onChange={handleKeyChange}
              onKeyDown={handleKeyDown}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              maxLength={19}
              spellCheck={false}
              autoComplete="off"
              className="auth-input mono"
              style={{
                paddingLeft: 36,
                textAlign: 'center',
                letterSpacing: '0.15em',
                border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`,
                caretColor: 'var(--blue)',
              }}
              onFocus={e => (e.target.style.borderColor = error ? 'var(--red)' : 'var(--blue)')}
              onBlur={e => (e.target.style.borderColor = error ? 'var(--red)' : 'var(--border)')}
            />
          </div>
          {error && <p className="mt-[6px] text-11 text-red">{error}</p>}
          {success && (
            <p className="mt-[6px] text-11 text-success font-medium">
              {t('activate_success') || 'Activated! Loading...'}
            </p>
          )}
        </div>

        {/* Activate Button */}
        <button
          onClick={handleActivate}
          disabled={loading || success || activationKey.replace(/-/g, '').length !== 16}
          className="auth-btn"
          style={{
            background: loading || success ? 'var(--color-info-bg)' : 'var(--blue)',
            opacity: activationKey.replace(/-/g, '').length !== 16 && !loading ? 0.5 : 1,
          }}
        >
          {loading
            ? t('activating') || 'Activating…'
            : success
              ? t('activate_success_btn') || '✓ Activated'
              : t('activate_btn') || 'Activate'}
        </button>
      </div>
    </div>
  )
}
