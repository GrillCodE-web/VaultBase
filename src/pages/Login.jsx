import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CreditCard, Eye, EyeOff, Lock, Check, X, ShieldAlert } from 'lucide-react'
import { useLang } from '../hooks/useLang.jsx'
import { useAuth } from '../hooks/useAuth.jsx'

// ─── Password strength calculator ──────────────────────────────────────────

function calcStrength(password) {
  if (!password) return 0
  let score = 0
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return Math.min(4, score)
}

const STRENGTH_META = [
  { color: 'bg-accent-red', label: 'auth_strength_weak' },
  { color: 'bg-accent-red', label: 'auth_strength_weak' },
  { color: 'bg-accent-yellow', label: 'auth_strength_fair' },
  { color: 'bg-accent-green', label: 'auth_strength_good' },
  { color: 'bg-accent-green', label: 'auth_strength_strong' },
]

// ─── Password input with show/hide toggle ─────────────────────────────────

function PasswordInput({
  value,
  onChange,
  placeholder,
  onKeyDown,
  autoFocus,
  id,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedby,
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        className="auth-input pr-11"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(v => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted p-0"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

// ─── Requirement row ───────────────────────────────────────────────────────

function Req({ met, label }) {
  return (
    <div className={met ? 'auth-req-row auth-req-ok' : 'auth-req-row auth-req-no'}>
      {met ? <Check size={12} className="shrink-0" /> : <X size={12} className="shrink-0" />}
      <span>{label}</span>
    </div>
  )
}

// ─── Main Login component ─────────────────────────────────────────────────

export default function Login({ onUnlocked }) {
  const { t } = useLang()
  // MGR-005: причина бана — на экране лока (снапшот читается из памяти,
  // работает и на запертой БД)
  const { policy } = useAuth()

  const [mode, setMode] = useState('loading') // loading | setup | unlock
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Check initial state
  useEffect(() => {
    invoke('is_password_set')
      .then(val => setMode(val ? 'unlock' : 'setup'))
      .catch(() => setMode('setup'))
  }, [])

  // Derived requirement states
  const reqs = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  }
  const reqsMet = Object.values(reqs).every(Boolean)
  const strength = calcStrength(password)
  const sm = STRENGTH_META[strength] ?? STRENGTH_META[0]

  const handleKeyDown = e => {
    if (e.key === 'Enter') handleSubmit()
  }

  const handleSubmit = async () => {
    setError('')

    if (mode === 'setup') {
      if (!reqsMet) {
        setError(t('auth_err_too_weak'))
        return
      }
      if (password !== confirm) {
        setError(t('auth_err_mismatch'))
        return
      }

      setLoading(true)
      try {
        await invoke('setup_password', { password })
        onUnlocked()
      } catch (e) {
        setError(parseError(e, t))
      } finally {
        setLoading(false)
      }
    } else {
      if (!password) return
      setLoading(true)
      try {
        await invoke('unlock', { password })
        onUnlocked()
      } catch (e) {
        setError(parseError(e, t))
      } finally {
        setLoading(false)
      }
    }
  }

  if (mode === 'loading') {
    return (
      <div className="w-screen h-screen bg-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-t border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-bg-glow" />
      <div className="relative w-full max-w-[400px] mx-4">
        {/* Logo */}
        <div className="auth-logo-wrap">
          <div className="auth-logo-icon">
            {mode === 'unlock' ? (
              <Lock size={24} className="text-white" />
            ) : (
              <CreditCard size={24} className="text-white" />
            )}
          </div>
          <h1 className="auth-title">
            {t(mode === 'setup' ? 'auth_setup_title' : 'auth_unlock_title')}
          </h1>
          <p className="auth-sub">
            {t(mode === 'setup' ? 'auth_setup_subtitle' : 'auth_unlock_subtitle')}
          </p>
        </div>

        {/* MGR-005: бан от менеджера — причина на экране лока */}
        {policy?.banned && (
          <div className="auth-error" role="alert" aria-live="assertive">
            <ShieldAlert size={16} className="shrink-0" />
            <span>
              <strong>{t('policy_banned_title')}</strong>
              {policy.banned_reason ? ` — ${policy.banned_reason}` : ''}
              {policy.ban_until
                ? ` (${t('policy_banned_until', { until: policy.ban_until })})`
                : ''}
            </span>
          </div>
        )}

        {/* Card */}
        <div className="auth-card">
          {/* Password field */}
          <div className="form-group">
            <label className="auth-label" htmlFor="password">
              {t('auth_password_label')}
            </label>
            <PasswordInput
              id="password"
              value={password}
              onChange={v => {
                setPassword(v)
                setError('')
              }}
              placeholder="••••••••••••"
              onKeyDown={mode === 'unlock' ? handleKeyDown : undefined}
              autoFocus
              aria-label={t('auth_password_label')}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={mode === 'setup' && password ? 'password-strength' : undefined}
            />
          </div>

          {/* Strength bar (setup only) */}
          {mode === 'setup' && password.length > 0 && (
            <div className="form-group" id="password-strength" role="status" aria-live="polite">
              <div className="auth-strength-bar">
                {[0, 1, 2, 3].map(i => {
                  const colors = [
                    'var(--red)',
                    'var(--red)',
                    'var(--yellow)',
                    'var(--color-success)',
                    'var(--color-success)',
                  ]
                  return (
                    <div
                      key={i}
                      className="auth-strength-seg"
                      style={{ background: i < strength ? colors[strength] : 'var(--border)' }}
                    />
                  )
                })}
              </div>
              <p
                className="text-11"
                style={{
                  color: [
                    'var(--red)',
                    'var(--red)',
                    'var(--yellow)',
                    'var(--color-success)',
                    'var(--color-success)',
                  ][strength],
                }}
              >
                {t(sm.label)}
              </p>
            </div>
          )}

          {/* Requirements (setup only) */}
          {mode === 'setup' && (
            <div className="auth-reqs form-group">
              <p className="text-11 text-muted mb-2">{t('auth_req_title')}</p>
              <div className="grid grid-cols-2 gap-1">
                <Req met={reqs.length} label={t('auth_req_length')} />
                <Req met={reqs.upper} label={t('auth_req_upper')} />
                <Req met={reqs.lower} label={t('auth_req_lower')} />
                <Req met={reqs.digit} label={t('auth_req_digit')} />
                <Req met={reqs.special} label={t('auth_req_special')} />
              </div>
            </div>
          )}

          {/* Confirm password (setup only) */}
          {mode === 'setup' && (
            <div className="form-group">
              <label className="auth-label" htmlFor="confirm">
                {t('auth_confirm_label')}
              </label>
              <PasswordInput
                id="confirm"
                value={confirm}
                onChange={v => {
                  setConfirm(v)
                  setError('')
                }}
                placeholder="••••••••••••"
                onKeyDown={handleKeyDown}
                aria-label={t('auth_confirm_label')}
                aria-invalid={error && password !== confirm ? 'true' : undefined}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="auth-error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || (mode === 'setup' && (!reqsMet || password !== confirm))}
            className="auth-btn"
          >
            {loading && <div className="auth-spinner inline-block mr-2 align-middle" />}
            {loading
              ? t(mode === 'setup' ? 'auth_btn_creating' : 'auth_btn_unlocking')
              : t(mode === 'setup' ? 'auth_btn_create' : 'auth_btn_unlock')}
          </button>

          {/* No-recovery warning (setup only) */}
          {mode === 'setup' && <div className="auth-warning">{t('auth_warning_no_recovery')}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Error message resolver ────────────────────────────────────────────────

function parseError(err, t) {
  const msg = typeof err === 'string' ? err : String(err)
  if (msg.includes('wrong_password')) return t('auth_err_wrong')
  if (msg.includes('password_too_weak')) return t('auth_err_too_weak')
  if (msg.includes('password_already_set')) return t('auth_err_already_set')
  if (msg.includes('mismatch')) return t('auth_err_mismatch')
  if (msg.includes('database_locked')) return t('auth_err_locked')
  return t('auth_err_generic')
}
