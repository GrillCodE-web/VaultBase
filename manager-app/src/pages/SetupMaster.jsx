import { useMemo, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { setupMasterPassword } from '../api/server.js'

export default function SetupMaster({ onDone }) {
  const { t } = useLang()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const checks = useMemo(
    () => ({
      min_length: password.length >= 12,
      pwd_upper: /[A-ZА-Я]/.test(password),
      pwd_lower: /[a-zа-я]/.test(password),
      pwd_digit: /[0-9]/.test(password),
      pwd_special: /[^A-Za-zА-Яа-я0-9]/.test(password),
    }),
    [password]
  )

  const valid = Object.values(checks).every(Boolean)
  const mismatch = repeat.length > 0 && repeat !== password

  const submit = async () => {
    setError('')
    if (mismatch) {
      setError(t('pwd_mismatch'))
      return
    }
    setBusy(true)
    try {
      await setupMasterPassword(password)
      onDone()
    } catch (e) {
      setError(t(String(e).includes('pwd_') ? String(e) : 'err_generic') + (String(e).includes('pwd_') ? '' : ` (${e})`))
    } finally {
      setBusy(false)
    }
  }

  const rows = [
    ['min_length', 'pwd_min_length'],
    ['pwd_upper', 'pwd_upper'],
    ['pwd_lower', 'pwd_lower'],
    ['pwd_digit', 'pwd_digit'],
    ['pwd_special', 'pwd_special'],
  ]

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="dot" />
          VaultBase Manager
        </div>
        <div className="auth-title">{t('setup_master_title')}</div>
        <div className="auth-sub">{t('setup_master_intro')}</div>

        <div className="field">
          <label>{t('password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label>{t('password_repeat')}</label>
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>

        <ul className="checklist">
          {rows.map(([key, label]) => (
            <li key={key} className={checks[key] ? 'pass' : ''}>
              <span>{checks[key] ? '✓' : '○'}</span> {t(label)}
            </li>
          ))}
        </ul>

        {mismatch && <div className="error-box">{t('pwd_mismatch')}</div>}
        {error && <div className="error-box">{error}</div>}

        <div className="btn-row">
          <button className="btn primary" disabled={busy || !valid || mismatch || repeat.length === 0} onClick={submit}>
            {t('set_password')}
          </button>
        </div>
      </div>
    </div>
  )
}
