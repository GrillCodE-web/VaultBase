import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { api } from '../api/server.js'

const EMPTY = { shop_domain: '', target: '', weight: 5, notes: '' }

export default function Priorities() {
  const { t } = useLang()
  const { confirm } = useConfirm()
  const [items, setItems] = useState(null)
  const [workers, setWorkers] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState(null)

  const load = () => {
    api('GET', '/manager/api/priorities')
      .then((r) => setItems(r.status === 200 ? r.body.priorities || [] : []))
      .catch(() => setItems([]))
    api('GET', '/manager/api/workers')
      .then((r) => {
        if (r.status === 200) setWorkers((r.body.workers || []).filter((w) => w.role !== 'manager'))
      })
      .catch(() => {})
  }

  useEffect(load, [])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const save = async () => {
    setError('')
    const body = {
      shop_domain: form.shop_domain,
      target: form.target,
      weight: Number(form.weight),
      notes: form.notes,
    }
    const r = editing
      ? await api('PATCH', `/manager/api/priorities/${editing}`, body)
      : await api('POST', '/manager/api/priorities', body)
    if ((editing && r.status === 200) || (!editing && r.status === 201)) {
      setForm(EMPTY)
      setEditing(null)
      flash(t('prio_saved'))
      load()
      return
    }
    setError(r.body?.error === 'already_exists'
      ? t('prio_exists')
      : `${t('err_generic')} (${r.body?.error || r.status})`)
  }

  const edit = (p) => {
    setEditing(p.id)
    setForm({ shop_domain: p.shop_domain, target: p.target, weight: p.weight, notes: p.notes || '' })
  }

  const remove = async (id) => {
    if (!(await confirm(t('prio_delete_confirm'), {
      danger: true,
      confirmLabel: t('delete'),
      cancelLabel: t('cancel'),
    }))) return
    const r = await api('DELETE', `/manager/api/priorities/${id}`)
    if (r.status === 200) load()
  }

  if (items === null) return <div className="empty">{t('loading')}</div>

  const targetLabel = (p) => {
    if (!p.target) return <span className="tag gray">{t('target_global')}</span>
    if (p.target.startsWith('iid:')) return <span className="tag purple">{p.target_label || p.target.slice(4, 16)}</span>
    if (p.target === 'role:operator') return <span className="tag accent">{t('target_role_operator')}</span>
    if (p.target === 'role:admin') return <span className="tag accent">{t('target_role_admin')}</span>
    return <span className="mono">{p.target}</span>
  }

  return (
    <div>
      <div className="panel">
        <h3>{t('prio_add')}</h3>
        <div className="auth-sub" style={{ marginBottom: 14 }}>{t('prio_intro')}</div>
        {error && <div className="error-box">{error}</div>}
        <div className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>{t('prio_shop')}</label>
            <input
              className="mono"
              value={form.shop_domain}
              onChange={(e) => setForm({ ...form, shop_domain: e.target.value })}
              placeholder="shop.example.com"
              disabled={!!editing}
            />
          </div>
          <div className="field">
            <label>{t('prio_target')}</label>
            <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}>
              <option value="">{t('target_global')}</option>
              <option value="role:operator">{t('target_role_operator')}</option>
              <option value="role:admin">{t('target_role_admin')}</option>
              {workers.map((w) => (
                <option key={w.installation_id} value={`iid:${w.installation_id}`}>
                  {w.label || w.installation_id.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('prio_weight')} ({form.weight})</label>
            <input
              type="range"
              min="1"
              max="10"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              style={{ width: '100%', padding: 0 }}
            />
          </div>
        </div>
        <div className="field">
          <label>{t('prio_notes')}</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} />
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={!form.shop_domain.trim()} onClick={save}>
            {editing ? t('save') : t('prio_add')}
          </button>
          {editing && (
            <button className="btn" onClick={() => { setEditing(null); setForm(EMPTY) }}>{t('cancel')}</button>
          )}
          {toast && <span className="tag green">{toast}</span>}
        </div>
      </div>

      <div className="panel">
        <h3>{t('prio_title')}</h3>
        {items.length === 0 ? (
          <div className="empty">{t('no_priorities')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('prio_shop')}</th>
                <th>{t('prio_target')}</th>
                <th>{t('prio_weight')}</th>
                <th>{t('prio_notes')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.shop_domain}</td>
                  <td>{targetLabel(p)}</td>
                  <td><span className={`tag ${p.weight >= 8 ? 'green' : p.weight >= 5 ? 'accent' : 'gray'}`}>{p.weight}</span></td>
                  <td style={{ color: 'var(--text-2)' }}>{p.notes || '—'}</td>
                  <td>
                    <button className="btn small" onClick={() => edit(p)}>{t('edit')}</button>{' '}
                    <button className="btn small danger" onClick={() => remove(p.id)}>{t('delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
