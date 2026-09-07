import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { api, getConfigValues, lockApp, setConfigValue, setServerUrl, wipeLocalData } from '../api/server.js'

const ALERT_CFG_KEYS = ['alert_decline_pct', 'alert_dead_pct', 'alert_webhook_url', 'alert_notify_os', 'idle_lock_min']

export default function Settings({ appState, onLock }) {
  const { t } = useLang()
  const { confirm } = useConfirm()
  const [url, setUrl] = useState(appState.server_url || '')
  const [savedUrl, setSavedUrl] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [keys, setKeys] = useState(null)
  const [alertCfg, setAlertCfg] = useState(null)

  const loadKeys = () => {
    api('GET', '/manager/api/keys')
      .then((r) => setKeys(r.status === 200 ? r.body.keys || [] : []))
      .catch(() => setKeys([]))
  }

  useEffect(() => { loadKeys() }, [])

  useEffect(() => {
    getConfigValues(ALERT_CFG_KEYS)
      .then((cfg) => setAlertCfg({
        alert_decline_pct: cfg.alert_decline_pct || '50',
        alert_dead_pct: cfg.alert_dead_pct || '30',
        alert_webhook_url: cfg.alert_webhook_url || '',
        alert_notify_os: cfg.alert_notify_os !== '0',
        idle_lock_min: cfg.idle_lock_min || '10',
      }))
      .catch(() => setAlertCfg(null))
  }, [])

  const saveAlertCfg = async () => {
    setError('')
    try {
      await setConfigValue('alert_decline_pct', alertCfg.alert_decline_pct)
      await setConfigValue('alert_dead_pct', alertCfg.alert_dead_pct)
      await setConfigValue('alert_webhook_url', alertCfg.alert_webhook_url)
      await setConfigValue('alert_notify_os', alertCfg.alert_notify_os ? '1' : '0')
      await setConfigValue('idle_lock_min', alertCfg.idle_lock_min)
      flash(t('saved'))
    } catch (e) {
      setError(`${t('err_generic')} (${e})`)
    }
  }

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
    const opts = { danger: true, confirmLabel: t('wipe_confirm_action'), cancelLabel: t('cancel') }
    if (!(await confirm(t('wipe_confirm'), opts))) return
    if (!(await confirm(t('wipe_confirm_final'), opts))) return
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
        <h3>{t('alerts_section')}</h3>
        <div className="auth-sub">{t('alerts_desc')}</div>
        {alertCfg && (
          <>
            <div className="field-row">
              <div className="field">
                <label>{t('alert_decline_pct_label')}</label>
                <input
                  className="mono"
                  value={alertCfg.alert_decline_pct}
                  onChange={(e) => setAlertCfg({ ...alertCfg, alert_decline_pct: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>{t('alert_dead_pct_label')}</label>
                <input
                  className="mono"
                  value={alertCfg.alert_dead_pct}
                  onChange={(e) => setAlertCfg({ ...alertCfg, alert_dead_pct: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>{t('idle_lock_min_label')}</label>
                <input
                  className="mono"
                  value={alertCfg.idle_lock_min}
                  onChange={(e) => setAlertCfg({ ...alertCfg, idle_lock_min: e.target.value })}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>{t('alert_webhook_label')}</label>
                <input
                  className="mono"
                  value={alertCfg.alert_webhook_url}
                  onChange={(e) => setAlertCfg({ ...alertCfg, alert_webhook_url: e.target.value })}
                  placeholder="https://…"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="field-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={alertCfg.alert_notify_os}
                  onChange={(e) => setAlertCfg({ ...alertCfg, alert_notify_os: e.target.checked })}
                />
                {t('alert_notify_os_label')}
              </label>
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={saveAlertCfg}>{t('save')}</button>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h3>{t('key_section')}</h3>
        <div className="auth-sub">{t('key_note')}</div>
        {keys === null ? (
          <div className="skeleton" style={{ height: 14, width: '50%' }} aria-hidden="true" />
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
