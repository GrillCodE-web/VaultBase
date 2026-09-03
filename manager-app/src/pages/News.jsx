import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, fmtDateTime } from '../api/server.js'

const EMPTY_FORM = {
  severity: 'info',
  title: '',
  body: '',
  target_role: 'all',
  target_iid: '',
  expires_at: '',
}

export default function News() {
  const { t } = useLang()
  const [news, setNews] = useState(null)
  const [workers, setWorkers] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [readers, setReaders] = useState(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api('GET', '/manager/api/news')
      .then((r) => setNews(r.status === 200 ? r.body.news || [] : []))
      .catch(() => setNews([]))
    api('GET', '/manager/api/workers')
      .then((r) => {
        if (r.status === 200) {
          setWorkers((r.body.workers || []).filter((w) => w.role !== 'manager'))
        }
      })
      .catch(() => {})
  }

  useEffect(load, [])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const create = async () => {
    setBusy(true)
    setError('')
    const body = {
      severity: form.severity,
      title: form.title,
      body: form.body,
      target_role: form.target_role,
      target_iid: form.target_iid || null,
      expires_at: form.expires_at || null,
    }
    try {
      const r = await api('POST', '/manager/api/news', body)
      if (r.status !== 201) {
        setError(`${t('err_generic')} (${r.body?.error || r.status})`)
        return
      }
      setForm(EMPTY_FORM)
      flash(t('news_saved'))
      load()
    } finally {
      setBusy(false)
    }
  }

  const publish = async (id) => {
    const r = await api('POST', `/manager/api/news/${id}/publish`)
    if (r.status === 200) {
      flash(t('news_published'))
      load()
    }
  }

  const unpublish = async (id) => {
    const r = await api('POST', `/manager/api/news/${id}/unpublish`)
    if (r.status === 200) load()
  }

  const remove = async (id) => {
    if (!window.confirm(t('news_delete_confirm'))) return
    const r = await api('DELETE', `/manager/api/news/${id}`)
    if (r.status === 200) load()
  }

  const showReaders = async (id) => {
    const r = await api('GET', `/manager/api/news/${id}/readers`)
    if (r.status === 200) setReaders(r.body)
  }

  if (news === null) return <div className="empty">{t('loading')}</div>

  const sevTag = (s) => (
    <span className={`tag ${s === 'critical' ? 'red' : s === 'warning' ? 'amber' : 'accent'}`}>
      {t(`sev_${s}`)}
    </span>
  )

  return (
    <div>
      <div className="panel">
        <h3>{t('news_create')}</h3>
        {error && <div className="error-box">{error}</div>}
        <div className="field-row">
          <div className="field">
            <label>{t('news_severity')}</label>
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="info">{t('sev_info')}</option>
              <option value="warning">{t('sev_warning')}</option>
              <option value="critical">{t('sev_critical')}</option>
            </select>
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>{t('news_title_field')}</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>{t('news_target')}</label>
            <select value={form.target_role} onChange={(e) => setForm({ ...form, target_role: e.target.value, target_iid: '' })}>
              <option value="all">{t('target_all')}</option>
              <option value="operator">{t('target_role_operator')}</option>
              <option value="admin">{t('target_role_admin')}</option>
              <option value="manager">{t('target_role_manager')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('target_worker')}</label>
            <select value={form.target_iid} onChange={(e) => setForm({ ...form, target_iid: e.target.value })}>
              <option value="">{t('target_none')}</option>
              {workers.map((w) => (
                <option key={w.installation_id} value={w.installation_id}>
                  {w.label || w.installation_id.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('news_expires')}</label>
            <input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>{t('news_body_field')}</label>
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={4}
            maxLength={8000}
          />
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={busy || !form.title.trim()} onClick={create}>
            {t('create')}
          </button>
          {toast && <span className="tag green">{toast}</span>}
        </div>
      </div>

      <div className="panel">
        <h3>{t('news_title')}</h3>
        {news.length === 0 ? (
          <div className="empty">{t('no_news')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('news_severity')}</th>
                <th>{t('news_title_field')}</th>
                <th>{t('news_target')}</th>
                <th>{t('created_at_col')}</th>
                <th>{t('published_col')}</th>
                <th>{t('read_col')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {news.map((n) => (
                <tr key={n.id}>
                  <td>{sevTag(n.severity)}</td>
                  <td>{n.title}</td>
                  <td>
                    {n.target_iid
                      ? <span className="tag purple">{t('target_worker')}</span>
                      : <span className="tag gray">{t(`target_${n.target_role === 'all' ? 'all' : 'role_' + n.target_role}`)}</span>}
                  </td>
                  <td>{fmtDateTime(n.created_at)}</td>
                  <td>
                    {n.is_published
                      ? <span className="tag green">{fmtDateTime(n.published_at)}</span>
                      : <span className="tag gray">{t('news_draft')}</span>}
                  </td>
                  <td className="clickable" onClick={() => showReaders(n.id)}>
                    <span className="tag accent">{n.read_count ?? 0}</span>
                  </td>
                  <td>
                    {n.is_published ? (
                      <button className="btn small" onClick={() => unpublish(n.id)}>{t('news_unpublish')}</button>
                    ) : (
                      <button className="btn small primary" onClick={() => publish(n.id)}>{t('news_publish')}</button>
                    )}{' '}
                    <button className="btn small" onClick={() => showReaders(n.id)}>{t('news_readers')}</button>{' '}
                    <button className="btn small danger" onClick={() => remove(n.id)}>{t('delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {readers && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setReaders(null)}>
          <div className="modal">
            <h3>{t('news_readers')}</h3>
            <div className="meta" style={{ marginBottom: 12, color: 'var(--text-2)' }}>
              {t('news_reads', { n: readers.read_count, m: readers.audience_count })}
            </div>
            {readers.readers.length === 0 ? (
              <div className="empty">{t('no_reads')}</div>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('col_label')}</th>
                    <th>{t('read_at_col')}</th>
                  </tr>
                </thead>
                <tbody>
                  {readers.readers.map((r) => (
                    <tr key={r.installation_id}>
                      <td>{r.label || r.installation_id.slice(0, 14)}</td>
                      <td>{fmtDateTime(r.read_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => setReaders(null)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
