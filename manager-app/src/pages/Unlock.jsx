import { useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { unlockApp, wipeLocalData } from '../api/server.js'

export default function Unlock({ onDone }) {
  const { t, lang, setLang } = useLang()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wipeMode, setWipeMode] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await unlockApp(password)
      onDone()
    } catch (e) {
      setError(String(e) === 'wrong_master_password' ? t('err_wrong_master_password') : `${t('err_generic')} (${e})`)
    } finally {
      setBusy(false)
    }
  }

  const wipe = async () => {
    if (!window.confirm(t('wipe_confirm'))) return
    try {
      await wipeLocalData()
      onDone()
    } catch (e) {
      setError(`${t('err_generic')} (${e})`)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="dot" />
          VaultBase Manager
          <button
            className="btn small"
            style={{ marginLeft: 'auto' }}
            onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}
          >
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
        </div>
        <div className="auth-title">{t('unlock_title')}</div>
        <div className="auth-sub">{t('unlock_intro')}</div>

        <div className="field">
          <label>{t('password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password && submit()}
            autoFocus
          />
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="btn-row">
          <button className="btn primary" disabled={busy || password.length === 0} onClick={submit}>
            {t('unlock_action')}
          </button>
        </div>

        <div style={{ height: 24 }} />

        {wipeMode ? (
          <button className="btn danger" onClick={wipe}>{t('wipe_confirm_action')}</button>
        ) : (
          <button className="btn small" onClick={() => setWipeMode(true)}>{t('wipe_action')}</button>
        )}
      </div>
    </div>
  )
}
