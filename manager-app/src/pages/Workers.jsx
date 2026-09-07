import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useLang } from '../hooks/useLang.jsx'
import { api, getWorkerSnapshots, getWorkerStats, getInsights, fmtDateTime, fmtRelative } from '../api/server.js'

function PolicyModal({ worker, onClose, onChanged, scoreRow }) {
  const { t } = useLang()
  const [banned, setBanned] = useState(worker.banned === 1)
  const [reason, setReason] = useState(worker.banned_reason || '')
  const [banUntil, setBanUntil] = useState('')
  const [quotaCards, setQuotaCards] = useState(worker.quota_cards_day ?? '')
  const [quotaOrders, setQuotaOrders] = useState(worker.quota_orders_day ?? '')
  const [minVersion, setMinVersion] = useState(worker.min_version || '')
  const [exempt, setExempt] = useState(worker.version_exempt === 1)
  const [canAddCards, setCanAddCards] = useState(worker.can_add_cards === 1)
  const [paused, setPaused] = useState(worker.paused === 1)
  const [cooldown, setCooldown] = useState(worker.decline_cooldown_minutes ?? '')
  const [maxProfiles, setMaxProfiles] = useState(worker.max_profiles ?? '')
  const [maxDrops, setMaxDrops] = useState(worker.max_drops ?? '')
  const [blacklist, setBlacklist] = useState(() => {
    try {
      const arr = JSON.parse(worker.shop_blacklist || '[]')
      return Array.isArray(arr) ? arr.join(', ') : ''
    } catch {
      return ''
    }
  })
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
      can_add_cards: canAddCards,
      paused,
      decline_cooldown_minutes: cooldown === '' ? null : Number(cooldown),
      max_profiles: maxProfiles === '' ? null : Number(maxProfiles),
      max_drops: maxDrops === '' ? null : Number(maxDrops),
      shop_blacklist: blacklist.trim()
        ? blacklist.split(',').map((d) => d.trim()).filter(Boolean)
        : null,
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

  const applyPreset = async (name) => {
    setBusy(true)
    setError('')
    try {
      const r = await api('POST', `/manager/api/workers/${worker.installation_id}/policy`, { preset: name })
      if (r.status !== 200) {
        setError(`${t('err_policy_validation')} (${r.body?.error || r.status})`)
        return
      }
      const p = r.body?.policy || {}
      setBanned(p.banned === 1)
      setReason(p.banned_reason || '')
      setBanUntil('')
      setQuotaCards(p.quota_cards_day ?? '')
      setQuotaOrders(p.quota_orders_day ?? '')
      setMinVersion(p.min_version || '')
      setExempt(p.version_exempt === 1)
      setCanAddCards(p.can_add_cards === 1)
      setPaused(p.paused === 1)
      setCooldown(p.decline_cooldown_minutes ?? '')
      setMaxProfiles(p.max_profiles ?? '')
      setMaxDrops(p.max_drops ?? '')
      try {
        const arr = JSON.parse(p.shop_blacklist || '[]')
        setBlacklist(Array.isArray(arr) ? arr.join(', ') : '')
      } catch {
        setBlacklist('')
      }
      onChanged()
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
          <label>{t('policy_preset')}</label>
          <div className="btn-row">
            <button className="btn small" disabled={busy} onClick={() => applyPreset('novice')}>{t('policy_preset_novice')}</button>
            <button className="btn small" disabled={busy} onClick={() => applyPreset('trusted')}>{t('policy_preset_trusted')}</button>
            <button className="btn small" disabled={busy} onClick={() => applyPreset('probation')}>{t('policy_preset_probation')}</button>
          </div>
        </div>

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

        {scoreRow && (
          <div className="field">
            <span className="hint">
              {t('quota_suggest', {
                score: scoreRow.score,
                avg: scoreRow.avg_cards_taken,
                quota: scoreRow.suggested_quota_cards,
              })}
            </span>{' '}
            {scoreRow.suggested_quota_cards > 0 && (
              <button
                className="btn small"
                onClick={() => setQuotaCards(String(scoreRow.suggested_quota_cards))}
              >
                {t('quota_apply')}
              </button>
            )}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label>{t('policy_paused')}</label>
            <button className="btn" onClick={() => setPaused(!paused)}>
              {paused ? t('yes') : t('no')}
            </button>
          </div>
          <div className="field">
            <label>{t('policy_can_add_cards')}</label>
            <button className="btn" onClick={() => setCanAddCards(!canAddCards)}>
              {canAddCards ? t('yes') : t('no')}
            </button>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>{t('policy_cooldown')}</label>
            <input type="number" min="0" value={cooldown} onChange={(e) => setCooldown(e.target.value)} placeholder="—" />
          </div>
          <div className="field">
            <label>{t('policy_max_profiles')}</label>
            <input type="number" min="0" value={maxProfiles} onChange={(e) => setMaxProfiles(e.target.value)} placeholder="—" />
          </div>
          <div className="field">
            <label>{t('policy_max_drops')}</label>
            <input type="number" min="0" value={maxDrops} onChange={(e) => setMaxDrops(e.target.value)} placeholder="—" />
          </div>
        </div>

        <div className="field">
          <label>{t('policy_shop_blacklist')}</label>
          <input className="mono" value={blacklist} onChange={(e) => setBlacklist(e.target.value)} placeholder="shop1.com, shop2.net" />
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

const FEED_TAG = { success: 'green', fail: 'red', warn: 'amber', info: 'gray' }

function WorkerStats({ iid }) {
  const { t } = useLang()
  const [stats, setStats] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setStats(null)
    setFailed(false)
    getWorkerStats(iid, 30)
      .then((r) => live && setStats(r))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [iid])

  if (failed) return <div className="error-box">{t('err_generic')}</div>
  if (!stats) return <div className="meta" style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('stats_loading')}</div>
  if (stats.reports === 0) return <div className="meta" style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('worker_stats_empty')}</div>

  const tot = stats.totals || {}
  const cells = [
    [t('orders_total'), tot.orders ?? 0, ''],
    [t('delivered_col'), tot.delivered ?? 0, 'green'],
    [t('declined_col'), tot.declined ?? 0, tot.declined > 0 ? 'red' : ''],
    [t('cards_taken_col'), tot.cards_taken ?? 0, ''],
    [t('dead_ratio'), `${tot.dead_ratio ?? 0}%`, tot.dead_ratio >= 30 ? 'red' : ''],
    [t('drops_col'), tot.drops ?? 0, ''],
  ]

  return (
    <div>
      <div className="mini-stats">
        {cells.map(([label, value, cls], i) => (
          <div key={i} className="mini-stat">
            <div className={`v ${cls}`}>{value}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>
      <div className="mono" style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 12 }}>
        {t('health_imap')}: {tot.imap_ok ?? 0}/{tot.imap_fail ?? 0} · {t('health_smtp')}: {tot.smtp_ok ?? 0}/{tot.smtp_fail ?? 0} · {t('health_proxy')}: {tot.proxy_ok ?? 0}/{tot.proxy_fail ?? 0}
      </div>
      <h3 style={{ fontSize: 13 }}>{t('feed_title')}</h3>
      {stats.feed && stats.feed.length > 0 ? (
        <ul className="feed">
          {stats.feed.map((e, i) => (
            <li key={i}>
              <span className="date">{e.date}</span>
              <span className={`tag ${FEED_TAG[e.kind] || 'gray'}`}>{t(`feed_kind_${e.kind}`)}</span>
              <span className="msg">{t(`feed_${e.code}`, e.params || {})}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="meta" style={{ color: 'var(--text-3)', fontSize: 13 }}>{t('feed_empty')}</div>
      )}
    </div>
  )
}

export default function Workers({ navParams }) {
  const { t, lang } = useLang()
  const [workers, setWorkers] = useState(null)
  const [snapshots, setSnapshots] = useState({})
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)
  const [toast, setToast] = useState('')
  const [onlyWorkers, setOnlyWorkers] = useState(true)
  const [sortBy, setSortBy] = useState('activity')
  const [insights, setInsights] = useState(null)

  const load = () => {
    Promise.all([
      api('GET', '/manager/api/workers'),
      getWorkerSnapshots(),
      getInsights().catch(() => null),
    ])
      .then(([wres, snres, ins]) => {
        const rows = wres.status === 200 ? wres.body.workers || [] : []
        const map = {}
        for (const s of snres.snapshots || []) map[s.installation_id] = s
        setWorkers(rows)
        setSnapshots(map)
        setInsights(ins)
      })
      .catch(() => {
        setWorkers([])
      })
  }

  useEffect(load, [])

  // Авто-обновление списка: онлайн-статус (heartbeat) меняется без
  // действий пользователя — не заставляем жать «Обновить».
  useEffect(() => {
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // REDESIGN-05 §4: мгновенное обновление по WS-пушам сервера (presence —
  // воркер подключился/отключился; telemetry — пришёл heartbeat).
  useEffect(() => {
    let unl = []
    let disposed = false
    const onPush = () => load()
    Promise.all([listen('presence:changed', onPush), listen('telemetry:updated', onPush)]).then(fns => {
      if (disposed) fns.forEach(fn => fn())
      else unl = fns
    })
    return () => {
      disposed = true
      unl.forEach(fn => fn())
    }
  }, [])

  // MGR-020: диплинк из алертов/действий — сразу открыть карточку воркера
  useEffect(() => {
    if (!workers || !navParams?.focus) return
    const w = workers.find((x) => x.installation_id === navParams.focus)
    if (w) setSelected(w)
  }, [workers, navParams?.focus])

  const scoreMap = useMemo(() => {
    const m = {}
    for (const ws of insights?.worker_scores || []) m[ws.installation_id] = ws
    return m
  }, [insights])

  const rows = useMemo(() => {
    if (!workers) return []
    const list = onlyWorkers ? workers.filter((w) => w.role && w.role !== 'manager') : [...workers]
    const ts = (w) => {
      const v = w.hb_last_seen || w.last_seen
      if (!v) return 0
      const t = new Date(String(v).replace(' ', 'T') + 'Z').getTime()
      return Number.isNaN(t) ? 0 : t
    }
    const rank = (w) => {
      if (w.is_active === 0) return 3
      if (w.banned === 1) return 2
      return isOnline(w.hb_last_seen) ? 0 : 1
    }
    if (sortBy === 'label') {
      list.sort((a, b) => (a.label || a.installation_id).localeCompare(b.label || b.installation_id, lang))
    } else if (sortBy === 'status') {
      list.sort((a, b) => rank(a) - rank(b) || ts(b) - ts(a))
    } else {
      list.sort((a, b) => Number(isOnline(b.hb_last_seen)) - Number(isOnline(a.hb_last_seen)) || ts(b) - ts(a))
    }
    return list
  }, [workers, onlyWorkers, sortBy, lang])

  const forceLogout = async (iid) => {
    if (!window.confirm(t('policy_force_logout_confirm'))) return
    const r = await api('POST', `/manager/api/workers/${iid}/force-logout`)
    if (r.status === 200) {
      setToast(t('bribed'))
      load()
    }
  }

  const handleWipe = async (iid) => {
    if (!window.confirm(t('wipe_worker_confirm'))) return
    const r = await api('POST', `/manager/api/workers/${iid}/wipe`, { confirm: true })
    if (r.status === 200) {
      setToast(t('wipe_requested'))
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
        <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)} title={t('sort_by')}>
          <option value="activity">{t('sort_activity')}</option>
          <option value="label">{t('sort_label')}</option>
          <option value="status">{t('sort_status')}</option>
        </select>
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
                <th>{t('col_score')}</th>
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
                      {w.paused === 1 && w.is_active !== 0 && !banned && (
                        <span className="tag amber" style={{ marginLeft: 6 }}>{t('status_paused')}</span>
                      )}
                    </td>
                    <td>{fmtRelative(w.hb_last_seen || w.last_seen, lang)}</td>
                    <td>
                      {scoreMap[w.installation_id]
                        ? (
                          <span
                            className={`tag mono ${scoreMap[w.installation_id].score >= 80 ? 'green' : scoreMap[w.installation_id].score >= 60 ? 'amber' : 'red'}`}
                            title={t('score_hint', {
                              avg: scoreMap[w.installation_id].avg_cards_taken,
                              quota: scoreMap[w.installation_id].suggested_quota_cards,
                            })}
                          >
                            {scoreMap[w.installation_id].score}
                          </span>
                        )
                        : <span className="meta">—</span>}
                    </td>
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
                      </button>{' '}
                      {w.role !== 'manager' && (
                        w.wipe === 1
                          ? <span className="tag red">{t('wipe_pending')}</span>
                          : (
                            <button className="btn small danger" onClick={() => handleWipe(w.installation_id)}>
                              {t('wipe_worker')}
                            </button>
                          )
                      )}
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
          <div className="modal wide">
            <h3>{selected.label || selected.installation_id.slice(0, 12)}</h3>
            <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
              <h3 style={{ fontSize: 13 }}>{t('heartbeat_details')}</h3>
              <HeartbeatDetail snap={snapshots[selected.installation_id]?.snapshot || null} />
            </div>
            <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
              <h3 style={{ fontSize: 13 }}>{t('worker_stats_title', { n: 30 })}</h3>
              <WorkerStats iid={selected.installation_id} />
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
          scoreRow={scoreMap[modal.installation_id] || null}
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
