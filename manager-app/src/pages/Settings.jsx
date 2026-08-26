import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, lockApp, setServerUrl, wipeLocalData } from '../api/server.js'

export default function Settings({ appState, onLock }) {
  const { t } = useLang()
  const [url, setUrl] = useState(appState.server_url || '')
  const [savedUrl, setSavedUrl] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [keys, setKeys] = useState(null)

  const loadKeys = () => {
    api('GET', '/manager/api/keys')
      .then((r) => setKeys(r.status === 200 ? r.body.keys || [] : []))
      .catch(() => setKeys([]))
  }

  useEffect(() => { loadKeys() }, [])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const saveUrl = async () => {
    setError('')
    setSavedUrl(false)
    try {
      await setServerUrl(url)
      setSavedUrl(true)
      flash(t('saved'))
    } catch (e) {
      setError(String(e) === 'locked_cannot_change_url'
        ? t('err_locked_cannot_change_url')
        : `${t('err_generic')} (${e})`)
    }
  }

  const wipe = async () => {
    if (!window.confirm(t('wipe_confirm'))) return
    if (!window.confirm(t('wipe_confirm_final'))) return
    await lockApp()
    try {
      await wipeLocalData()
      onLock()
    } catch (e) {
      setError(`${t('err_generic')} (${e})`)
    }
  }

  return (
    <div>
      <div className="panel">
        <h3>{t('server_section')}</h3>
        <div className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>{t('current_server')}</label>
            <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn primary" onClick={saveUrl}>{t('save')}</button>
          </div>
        </div>
        {savedUrl && <div className="ok-box">{t('saved')}</div>}
        {error && <div className="error-box">{error}</div>}
      </div>

      <div className="panel">
        <h3>{t('key_section')}</h3>
        <div className="auth-sub">{t('key_note')}</div>
        {keys === null ? (
          <div className="empty">{t('loading')}</div>
        ) : keys.length === 0 ? (
          <div className="warn-box">{t('key_upload_warning')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('pubkey_col')}</th>
                <th>{t('status_col')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="mono">{k.id}</td>
                  <td className="mono" style={{ color: 'var(--text-3)' }}>{k.pubkey.slice(0, 24)}…</td>
                  <td>
                    {k.is_active
                      ? <span className="tag green">{t('active_key')}</span>
                      : <span className="tag gray">{t('revoked_key')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>{t('security_section')}</h3>
        <div className="btn-row">
          <button className="btn" onClick={async () => { await lockApp(); onLock() }}>
            {t('lock_now')}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ color: 'var(--red)' }}>{t('wipe_section')}</h3>
        <div className="auth-sub">{t('wipe_desc')}</div>
        <div className="btn-row">
          <button className="btn danger" onClick={wipe}>{t('wipe_action')}</button>
        </div>
      </div>

      <div className="meta" style={{ color: 'var(--text-3)', fontSize: 12 }}>
        VaultBase Manager 0.1.0 · {t('app_version_hint')}
        {toast && <span className="tag green" style={{ marginLeft: 12 }}>{toast}</span>}
      </div>
    </div>
  )
}
