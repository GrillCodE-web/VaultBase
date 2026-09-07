import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { api, fmtDateTime, fmtRelative } from '../api/server.js'

function CreateModal({ onClose, onCreated }) {
  const { t } = useLang()
  const [iid, setIid] = useState('')
  const [challenge, setChallenge] = useState('')
  const [label, setLabel] = useState('')
  const [role, setRole] = useState('operator')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issuedKey, setIssuedKey] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api('POST', '/manager/api/licenses', {
        installation_id: iid.trim(),
        challenge: challenge.trim(),
        label: label.trim(),
        role,
      })
      if (r.status !== 201) {
        setError(`${t('err_generic')} (${r.body?.error || r.status})`)
        return
      }
      setIssuedKey(r.body.activation_key)
      onCreated()
    } catch (e) {
      setError(`${t('err_generic')} (${e})`)
    } finally {
      setBusy(false)
    }
  }

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(issuedKey)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{t('lic_create')}</h3>
        {issuedKey ? (
          <>
            <div className="meta" style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 10 }}>
              {t('lic_key_hint')}
            </div>
            <div className="kv">
              <span className="k">{t('lic_activation_key')}</span>
              <span className="mono">{issuedKey}</span>
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={copyKey}>{t('copy')}</button>
              <button className="btn" onClick={onClose}>{t('close')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="meta" style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 10 }}>
              {t('lic_create_desc')}
            </div>
            <div className="field">
              <label>{t('installation_id')}</label>
              <input className="mono" value={iid} onChange={(e) => setIid(e.target.value)} placeholder="MGR-… / uuid" />
            </div>
            <div className="field">
              <label>{t('lic_challenge')}</label>
              <input className="mono" value={challenge} onChange={(e) => setChallenge(e.target.value)} placeholder="32 hex" />
            </div>
            <div className="field-row">
              <div className="field">
                <label>{t('col_label')} ({t('optional')})</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
              </div>
              <div className="field">
                <label>{t('col_role')}</label>
                <select className="sort-select" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="operator">{t('lic_role_operator')}</option>
                  <option value="manager">{t('lic_role_manager')}</option>
                </select>
              </div>
            </div>
            {error && <div className="error-box">{error}</div>}
            <div className="btn-row">
              <button className="btn primary" disabled={busy || !iid.trim() || !challenge.trim()} onClick={submit}>
                {t('apply')}
              </button>
              <button className="btn" onClick={onClose}>{t('cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Licenses() {
  const { t, lang } = useLang()
  const { confirm } = useConfirm()
  const [licenses, setLicenses] = useState(null)
  const [modal, setModal] = useState(false)
  const [toast, setToast] = useState('')
  const [editLabel, setEditLabel] = useState(null)
  const [labelDraft, setLabelDraft] = useState('')

  const load = () => {
    api('GET', '/manager/api/licenses')
      .then((r) => setLicenses(r.status === 200 ? r.body.licenses || [] : []))
      .catch(() => setLicenses([]))
  }

  useEffect(load, [])

  // Лицензии меняются снаружи (активация воркером, last_seen по WS/heartbeat) —
  // обновляем список сами, кнопка «Обновить» остаётся лишь как ручной форс.
  useEffect(() => {
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const revoke = async (lic) => {
    if (!(await confirm(t('lic_revoke_confirm', { label: lic.label || lic.installation_id.slice(0, 16) }), {
      danger: true,
      confirmLabel: t('lic_revoke'),
      cancelLabel: t('cancel'),
    }))) return
    const r = await api('POST', `/manager/api/licenses/${lic.installation_id}/revoke`)
    if (r.status === 200) {
      flash(t('lic_revoked'))
      load()
    } else {
      flash(`${t('err_generic')} (${r.body?.error || r.status})`)
    }
  }

  const restore = async (lic) => {
    const r = await api('POST', `/manager/api/licenses/${lic.installation_id}/restore`)
    if (r.status === 200) {
      flash(t('lic_restored'))
      load()
    } else {
      flash(`${t('err_generic')} (${r.body?.error || r.status})`)
    }
  }

  const saveLabel = async () => {
    const r = await api('PATCH', `/manager/api/licenses/${editLabel.installation_id}`, { label: labelDraft })
    if (r.status === 200) {
      setEditLabel(null)
      flash(t('lic_saved'))
      load()
    } else {
      flash(`${t('err_generic')} (${r.body?.error || r.status})`)
    }
  }

  const rows = useMemo(() => licenses || [], [licenses])

  if (licenses === null) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={load}>{t('refresh')}</button>
        <button className="btn primary" onClick={() => setModal(true)}>{t('lic_create')}</button>
        <div className="grow" />
        {toast && <span className="tag green">{toast}</span>}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty">{t('lic_empty')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_label')}</th>
                <th>{t('col_role')}</th>
                <th>{t('col_status')}</th>
                <th>{t('lic_token_col')}</th>
                <th>{t('created_at_col')}</th>
                <th>{t('col_last_seen')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lic) => (
                <tr key={lic.installation_id}>
                  <td>
                    {lic.label || '—'}
                    <div className="mono" style={{ color: 'var(--text-3)' }}>{lic.installation_id.slice(0, 20)}</div>
                  </td>
                  <td><span className="tag gray">{lic.role || '—'}</span></td>
                  <td>
                    {lic.is_active === 0
                      ? <span className="tag gray">{t('status_inactive')}</span>
                      : lic.banned === 1
                        ? <span className="tag red">{t('status_banned')}</span>
                        : <span className="tag green">{t('lic_active')}</span>}
                  </td>
                  <td>
                    {lic.token_issued
                      ? <span className="mono" style={{ color: 'var(--text-3)' }}>{lic.token_prefix}…</span>
                      : <span className="tag amber">{t('lic_no_token')}</span>}
                  </td>
                  <td>{fmtDateTime(lic.created_at)}</td>
                  <td>{fmtRelative(lic.last_seen, lang)}</td>
                  <td>
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditLabel(lic)
                        setLabelDraft(lic.label || '')
                      }}
                    >
                      {t('lic_edit_label')}
                    </button>{' '}
                    {lic.is_active === 1
                      ? <button className="btn small danger" onClick={() => revoke(lic)}>{t('lic_revoke')}</button>
                      : <button className="btn small" onClick={() => restore(lic)}>{t('lic_restore')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <CreateModal
          onClose={() => setModal(false)}
          onCreated={load}
        />
      )}

      {editLabel && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setEditLabel(null)}>
          <div className="modal">
            <h3>{t('lic_edit_label')} — {editLabel.installation_id.slice(0, 16)}</h3>
            <div className="field">
              <label>{t('col_label')}</label>
              <input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} maxLength={200} />
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={saveLabel}>{t('apply')}</button>
              <button className="btn" onClick={() => setEditLabel(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
