import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import { api, getWorkerSnapshots, fmtDateTime, fmtRelative } from '../api/server.js'

function PolicyModal({ worker, onClose, onChanged }) {
  const { t } = useLang()
  const [banned, setBanned] = useState(worker.banned === 1)
  const [reason, setReason] = useState(worker.banned_reason || '')
  const [banUntil, setBanUntil] = useState('')
  const [quotaCards, setQuotaCards] = useState(worker.quota_cards_day ?? '')
  const [quotaOrders, setQuotaOrders] = useState(worker.quota_orders_day ?? '')
  const [minVersion, setMinVersion] = useState(worker.min_version || '')
  const [exempt, setExempt] = useState(worker.version_exempt === 1)
  const [perms, setPerms] = useState(() => {
    try {
      return worker.permissions_override
        ? JSON.stringify(JSON.parse(worker.permissions_override), null, 2)
        : ''
    } catch {
      return worker.permissions_override || ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    let permsOverride = null
    if (perms.trim()) {
      try {
        const parsed = JSON.parse(perms)
        if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
        permsOverride = parsed
      } catch {
        setError(t('policy_bad_json'))
        setBusy(false)
        return
      }
    }
    const body = {
      banned,
      banned_reason: banned ? (reason || null) : null,
      ban_until: banned && banUntil ? banUntil : null,
      permissions_override: permsOverride,
      quota_cards_day: quotaCards === '' ? null : Number(quotaCards),
      quota_orders_day: quotaOrders === '' ? null : Number(quotaOrders),
      min_version: minVersion.trim() || null,
      version_exempt: exempt,
    }
    try {
      const r = await api('POST', `/manager/api/workers/${worker.installation_id}/policy`, body)
      if (r.status !== 200) {
        setError(`${t('err_policy_validation')} (${r.body?.error || r.status})`)
        return
      }
      onChanged()
      onClose()
    } catch (e) {
      setError(`${t('err_generic')} (${e})`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{t('policy_title')} — {worker.label || worker.installation_id.slice(0, 12)}</h3>

        <div className="field">
          <label>{t('policy_ban')}</label>
          <button className="btn" onClick={() => setBanned(!banned)}>
            {banned ? t('ban_off_action') : t('ban_on_action')}
          </button>
        </div>

        {banned && (
          <>
            <div className="field">
              <label>{t('policy_ban_reason')}</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
            <div className="field">
              <label>{t('policy_ban_until')} (YYYY-MM-DDTHH:MM, {t('optional')})</label>
              <input className="mono" value={banUntil} onChange={(e) => setBanUntil(e.target.value)} placeholder="2026-12-31T18:00" />
            </div>
          </>
        )}

        <div className="field-row">
          <div className="field">
            <label>{t('quota_cards')}</label>
            <input type="number" min="0" value={quotaCards} onChange={(e) => setQuotaCards(e.target.value)} placeholder="—" />
          </div>
          <div className="field">
            <label>{t('quota_orders')}</label>
            <input type="number" min="0" value={quotaOrders} onChange={(e) => setQuotaOrders(e.target.value)} placeholder="—" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>{t('policy_min_version')}</label>
            <input className="mono" value={minVersion} onChange={(e) => setMinVersion(e.target.value)} placeholder="2.12.0" />
          </div>
          <div className="field">
            <label>{t('policy_exempt')}</label>
            <button className="btn" onClick={() => setExempt(!exempt)}>
              {exempt ? t('yes') : t('no')}
            </button>
          </div>
        </div>

        <div className="field">
          <label>{t('policy_perms')}</label>
          <textarea
            className="code"
            value={perms}
            onChange={(e) => setPerms(e.target.value)}
            placeholder={'{"orders.delete": false}'}
          />
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="btn-row">
          <button className="btn primary" disabled={busy} onClick={submit}>{t('apply')}</button>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  )
}

const ONLINE_WINDOW_MS = 15 * 60 * 1000

const isOnline = (hbLastSeen) => {
  if (!hbLastSeen) return false
  return new Date(hbLastSeen.replace(' ', 'T') + 'Z').getTime() >= Date.now() - ONLINE_WINDOW_MS
}

function HeartbeatDetail({ snap }) {
  const { t } = useLang()
  if (!snap) {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-3)', fontSize: 13, marginTop: 10 }}>
        <span className="tag purple">{t('encrypted')}</span>
        <span>{t('heartbeat_sealed_hint')}</span>
      </div>
    )
  }
  const okTag = (v) => {
    if (v === true) return <span className="tag green">ok</span>
    if (v === false) return <span className="tag red">fail</span>
    return '—'
  }
  const items = [
    [t('app_version'), <span className="mono">{snap.app_version || '—'}</span>],
    [t('sync_status'), okTag(snap.sync_ws === 'ok' ? true : snap.sync_ws ? false : undefined)],
    ['IMAP', okTag(snap.imap_ok)],
    ['SMTP', okTag(snap.smtp_ok)],
    [t('proxy'), okTag(snap.proxy_ok)],
    [t('errors24'), <span className="mono">{snap.errors_24h ?? '—'}</span>],
  ]
  return (
    <div className="kv" style={{ marginTop: 10 }}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <span className="k">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function Workers() {
  const { t, lang } = useLang()
  const [workers, setWorkers] = useState(null)
  const [snapshots, setSnapshots] = useState({})
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [onlyWorkers, setOnlyWorkers] = useState(true)

  const load = () => {
    Promise.all([
      api('GET', '/manager/api/workers'),
      getWorkerSnapshots(),
    ])
      .then(([wres, snres]) => {
        const rows = wres.status === 200 ? wres.body.workers || [] : []
        const map = {}
        for (const s of snres.snapshots || []) map[s.installation_id] = s
        setWorkers(rows)
        setSnapshots(map)
      })
      .catch(() => {
        setWorkers([])
      })
  }

  useEffect(load, [])

  const rows = useMemo(() => {
    if (!workers) return []
    return onlyWorkers ? workers.filter((w) => w.role && w.role !== 'manager') : workers
  }, [workers, onlyWorkers])

  const forceLogout = async (iid) => {
    if (!window.confirm(t('policy_force_logout_confirm'))) return
    const r = await api('POST', `/manager/api/workers/${iid}/force-logout`)
    if (r.status === 200) {
      setToast(t('bribed'))
      load()
    }
  }

  if (workers === null) return <div className="empty">{t('loading')}</div>

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={load}>{t('refresh')}</button>
        <label className="meta" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-2)', fontSize: 13 }}>
          <input type="checkbox" checked={onlyWorkers} onChange={(e) => setOnlyWorkers(e.target.checked)} />
          {t('only_workers')}
        </label>
        <div className="grow" />
        {toast && <span className="tag green">{toast}</span>}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <div className="empty">{t('no_workers')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_label')}</th>
                <th>{t('col_role')}</th>
                <th>{t('col_status')}</th>
                <th>{t('col_last_seen')}</th>
                <th>{t('quota_cards')} / {t('quota_orders')}</th>
                <th>{t('policy_min_version')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const banned = w.banned === 1
                const versionExempt = w.version_exempt === 1
                return (
                  <tr key={w.installation_id} className="clickable" onClick={() => setSelected(w)}>
                    <td>
                      {w.label || '—'}
                      <div className="mono" style={{ color: 'var(--text-3)' }}>{w.installation_id.slice(0, 16)}</div>
                    </td>
                    <td><span className="tag gray">{w.role || '—'}</span></td>
                    <td>
                      {w.is_active === 0
                        ? <span className="tag gray">{t('status_inactive')}</span>
                        : banned
                          ? <span className="tag red">{t('status_banned')}</span>
                          : isOnline(w.hb_last_seen)
                            ? <span className="tag green">{t('status_online')}</span>
                            : <span className="tag red">{t('status_offline')}</span>}
                    </td>
                    <td>{fmtRelative(w.hb_last_seen || w.last_seen, lang)}</td>
                    <td className="mono">{w.quota_cards_day ?? '—'} / {w.quota_orders_day ?? '—'}</td>
                    <td>
                      {w.min_version
                        ? <span className={`tag ${versionExempt ? 'gray' : 'amber'}`}>{w.min_version}{versionExempt ? ' ∅' : ''}</span>
                        : <span className="meta">—</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn small" onClick={() => setModal(w)}>{t('policy_title')}</button>{' '}
                      <button className="btn small danger" onClick={() => forceLogout(w.installation_id)}>
                        {t('policy_force_logout')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal">
            <h3>{selected.label || selected.installation_id.slice(0, 12)}</h3>
            <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
              <h3 style={{ fontSize: 13 }}>{t('heartbeat_details')}</h3>
              <HeartbeatDetail snap={snapshots[selected.installation_id]?.snapshot || null} />
            </div>
            <div className="kv">
              <span className="k">{t('installation_id')}</span>
              <span className="mono">{selected.installation_id}</span>
              <span className="k">{t('col_last_seen')}</span>
              <span>{fmtDateTime(selected.last_seen)}</span>
              <span className="k">{t('heartbeat_time')}</span>
              <span>{fmtDateTime(selected.hb_last_seen) || '—'}</span>
              <span className="k">{t('ban_until_label')}</span>
              <span>{selected.ban_until ? fmtDateTime(selected.ban_until) : '—'}</span>
              <span className="k">{t('policy_perms')}</span>
              <span className="mono">{selected.permissions_override || '—'}</span>
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => setSelected(null)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <PolicyModal
          worker={modal}
          onClose={() => setModal(null)}
          onChanged={() => {
            setToast(t('bribed'))
            setTimeout(() => setToast(''), 2500)
            load()
          }}
        />
      )}
    </div>
  )
}
