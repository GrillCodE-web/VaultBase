import { useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { activateLicense, setServerUrl } from '../api/server.js'

const ERRORS = {
  not_found: 'err_not_found',
  invalid_key: 'err_invalid_key',
  revoked: 'err_revoked',
  rate_limit_exceeded: 'err_rate_limit',
  missing_fields: 'err_missing_fields',
  wrong_license_role: 'err_wrong_role',
  network: 'err_network',
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
    return true
  }
  return false
}

export default function Activate({ appState, onDone }) {
  const { t, lang, setLang } = useLang()
  const [url, setUrl] = useState(appState.server_url || '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const errorMsg = (e) => t(ERRORS[e] || 'err_generic') + (ERRORS[e] ? '' : ` (${e})`)

  const doCopy = (what, text) => {
    if (copyText(text)) {
      setCopied(what)
      setTimeout(() => setCopied(''), 1500)
    }
  }

  const saveUrl = async () => {
    setError('')
    try {
      await setServerUrl(url)
    } catch (e) {
      setError(errorMsg(String(e)))
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      if (url !== (appState.server_url || '')) {
        await setServerUrl(url)
      }
      await activateLicense(key.trim())
      onDone()
    } catch (e) {
      setError(errorMsg(String(e)))
    } finally {
      setBusy(false)
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
        <div className="auth-title">{t('activate_title')}</div>
        <div className="auth-sub">{t('activate_intro')}</div>

        <div className="field">
          <label>{t('installation_id')}</label>
          <div className="code-chip">
            <span className="mono">{appState.installation_id}</span>
            <button className="btn small" onClick={() => doCopy('iid', appState.installation_id)}>
              {copied === 'iid' ? t('copied') : t('copy')}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t('challenge_code')}</label>
          <div className="code-chip">
            <span className="mono">{appState.challenge}</span>
            <button className="btn small" onClick={() => doCopy('challenge', appState.challenge)}>
              {copied === 'challenge' ? t('copied') : t('copy')}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t('server_url')}</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            spellCheck={false}
          />
        </div>
        <div className="btn-row">
          <button className="btn" onClick={saveUrl}>{t('save_url')}</button>
        </div>

        <div style={{ height: 18 }} />

        <div className="field">
          <label>{t('activation_key')}</label>
          <input
            className="mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            spellCheck={false}
          />
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="btn-row">
          <button className="btn primary" disabled={busy || key.trim().length < 6} onClick={submit}>
            {t('activate_action')}
          </button>
        </div>
      </div>
    </div>
  )
}
