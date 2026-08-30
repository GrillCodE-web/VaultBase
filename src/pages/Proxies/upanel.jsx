// FEAT-018: вкладка PPTP (uPanel) в разделе Proxies.
//
// Данные приходят из commands/upanel.rs: подключение хранит URL + Bearer
// токен (токен наружу не отдаётся — только маска token_preview), список
// живых серверов /live отдаётся как есть (Value) и рендерится защитительно:
// полей может не быть, e2e-мок возвращает null.

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Server,
  RefreshCw,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Loader2,
  KeyRound,
  Wifi,
  BarChart3,
} from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useConfirm } from '../../hooks/useConfirm'
import { EmptyState } from '../../components/EmptyState.jsx'
import { timeAgo } from '../../utils/formatting'
import { getTotalPages } from '../../utils/pagination'
import { presentUpanelError } from '../../utils/upanelErrors'
import { Modal } from '../../components/Modal.jsx'

const PER_PAGE = 50
const DEFAULT_BASE_URL = 'https://upanel.ushubpulse.com/api/v1'

const EMPTY_FILTERS = {
  country_code: '',
  state: '',
  city: '',
  ip: '',
  fraud_min: '',
  fraud_max: '',
  mtu_min: '',
  mtu_max: '',
  order_by: '',
  order_dir: '',
}

const SORT_FIELDS = [
  'id',
  'country',
  'state',
  'city',
  'ip',
  'mtu',
  'fraud_score',
  'takes_count',
  'last_take_at',
  'updated_at',
]

// '' → null, числа парсим: пустой фильтр не должен уходить в query
function cleanFilter(f) {
  const num = v => (v === '' || v == null ? null : parseInt(v, 10) || null)
  return {
    country_code: f.country_code.trim() || null,
    state: f.state.trim() || null,
    city: f.city.trim() || null,
    ip: f.ip.trim() || null,
    fraud_min: num(f.fraud_min),
    fraud_max: num(f.fraud_max),
    mtu_min: num(f.mtu_min),
    mtu_max: num(f.mtu_max),
    order_by: f.order_by || null,
    order_dir: f.order_dir || null,
  }
}

// ─── Connection modal ─────────────────────────────────────────
const EMPTY_CONN = { name: '', base_url: '', api_token: '', is_active: true }

// REDESIGN-05-2: ручной оверлей/шапка/Escape/scroll-lock заменены общим <Modal>
function ConnectionModal({ initial, onSave, onClose }) {
  const { t } = useLang()
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name || '',
          base_url: initial.base_url === DEFAULT_BASE_URL ? '' : initial.base_url || '',
          api_token: '',
          is_active: initial.is_active !== false,
        }
      : { ...EMPTY_CONN }
  )
  const [showToken, setShowToken] = useState(false)
  const [loading, setLoading] = useState(false)
  const isEdit = !!initial

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const valid = form.name.trim() && (isEdit || form.api_token.trim())

  const handleSave = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onSave({
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        api_token: form.api_token.trim(),
        is_active: form.is_active,
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={isEdit ? t('upanel_edit_connection') : t('upanel_add_connection')}
    >
      <div className="flex flex-col gap-3.5">
        <div className="form-group">
          <label className="form-label">{t('upanel_name')}</label>
          <input
            value={form.name}
            onChange={set('name')}
            placeholder="Main uPanel"
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('upanel_base_url')}</label>
          <input
            value={form.base_url}
            onChange={set('base_url')}
            placeholder={DEFAULT_BASE_URL}
            className="form-input mono"
          />
          <div className="text-10 text-muted mt-1">{t('upanel_base_url_hint')}</div>
        </div>
        <div className="form-group">
          <label className="form-label">{t('upanel_api_token')}</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={form.api_token}
              onChange={set('api_token')}
              placeholder="upl_..."
              className="form-input mono pr-9"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken(s => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-muted"
            >
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <div className="text-10 text-muted mt-1">
            {isEdit ? t('upanel_token_keep_hint') : t('upanel_api_token_hint')}
          </div>
        </div>
        <label className="flex items-center gap-2 text-12 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
          />
          {t('upanel_is_active')}
        </label>
        <button onClick={handleSave} disabled={!valid || loading} className="btn btn-b w-full">
          {loading ? t('email_saving') : isEdit ? t('btn_save') : t('upanel_add_connection')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Credentials modal (результат take / live_credentials) ────
const CREDS_PRIORITY = [
  'server_id',
  'id',
  'login',
  'user',
  'username',
  'password',
  'ip',
  'host',
  'port',
  'mtu',
  'country',
  'state',
  'city',
  'expires_at',
  'expires',
  'notes',
]

// REDESIGN-05-2: ручной оверлей/шапка/Escape/scroll-lock заменены общим <Modal>
function CredsModal({ title, data, onClose }) {
  const { t } = useLang()
  const [visible, setVisible] = useState(false)

  const entries = Object.entries(data ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== 'object'
  )
  const keys = entries.map(([k]) => k)
  const ordered = [
    ...CREDS_PRIORITY.filter(k => keys.includes(k)),
    ...keys.filter(k => !CREDS_PRIORITY.includes(k)),
  ]
  const rows = ordered.map(k => entries.find(([ek]) => ek === k)).filter(Boolean)

  return (
    <Modal isOpen onClose={onClose} size="sm" title={title}>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <div className="text-12 text-muted text-center py-4">—</div>}
        {rows.map(([k, v]) => {
          const isPass = /pass|secret|token/i.test(k)
          return (
            <div key={k} className="flex items-center gap-2 border-b border-border py-1.5">
              <div className="text-11 text-muted w-[100px] shrink-0 mono">{k}</div>
              <div className="flex-1 text-12 mono" style={{ wordBreak: 'break-all' }}>
                {isPass && !visible ? '••••••••' : String(v)}
              </div>
              {isPass && (
                <button
                  type="button"
                  onClick={() => setVisible(v => !v)}
                  className="btn btn-ghost btn-sm"
                  aria-label={visible ? 'Hide' : 'Show'}
                >
                  {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
            </div>
          )
        })}
        {rows.some(([k]) => /pass|secret|token/i.test(k)) && (
          <button className="btn btn-ghost btn-sm mt-2" onClick={() => setVisible(v => !v)}>
            <KeyRound size={13} />
            {visible ? t('upanel_hide_secrets') : t('upanel_show_secrets')}
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─── Main tab ─────────────────────────────────────────────────
export default function ProxiesUpanelTab() {
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()

  const [connections, setConnections] = useState([])
  const [connLoading, setConnLoading] = useState(true)
  const [connModal, setConnModal] = useState(null) // null | 'add' | connection
  const [selectedId, setSelectedId] = useState(null)
  const [testingConn, setTestingConn] = useState(false)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [listLoading, setListLoading] = useState(false)
  const [stats, setStats] = useState(null)

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS })
  const [applied, setApplied] = useState({ ...EMPTY_FILTERS })
  const [takingId, setTakingId] = useState(null)
  const [credsModal, setCredsModal] = useState(null) // { title, data }

  const setF = k => e => setFilters(f => ({ ...f, [k]: e.target.value }))

  const loadConnections = useCallback(async () => {
    setConnLoading(true)
    try {
      const list = (await invoke('upanel_connections_list')) ?? []
      setConnections(list)
      setSelectedId(prev => {
        if (prev && list.some(c => c.id === prev)) return prev
        const active = list.find(c => c.is_active)
        return active ? active.id : (list[0]?.id ?? null)
      })
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    } finally {
      setConnLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLive = useCallback(
    async (connId, p = 1, f = applied) => {
      if (!connId) {
        setItems([])
        setTotal(0)
        setStats(null)
        return
      }
      setListLoading(true)
      try {
        const r =
          (await invoke('upanel_live_list', {
            connectionId: connId,
            filter: cleanFilter(f),
            page: p,
            perPage: PER_PAGE,
          })) ?? {}
        const list = r.items ?? r.data ?? []
        setItems(Array.isArray(list) ? list : [])
        setTotal(r.total ?? r.meta?.total ?? (Array.isArray(list) ? list.length : 0))
        if (p > 1 && list.length === 0 && (r.total ?? 0) > 0) {
          setPage(1)
          return
        }
        try {
          const st = await invoke('upanel_live_stats', { connectionId: connId })
          setStats(st ?? null)
        } catch (e) {
          // статистика не критична для списка — просто не показываем полосу
          console.warn('[Upanel] live stats failed:', e)
          setStats(null)
        }
      } catch (e) {
        toast(presentUpanelError(e, t), 'error')
        setItems([])
        setTotal(0)
      } finally {
        setListLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applied]
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первичная загрузка: setState внутри асинхронного колбэка
    loadConnections()
  }, [loadConnections])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка списка при смене подключения/фильтров/страницы
    loadLive(selectedId, page, applied)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, page, applied])

  const handleSaveConnection = async input => {
    try {
      if (connModal === 'add') {
        await invoke('upanel_connection_add', { input })
      } else {
        await invoke('upanel_connection_update', { id: connModal.id, input })
      }
      toast(t('upanel_connection_saved'), 'success')
      await loadConnections()
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    }
  }

  const handleDeleteConnection = async conn => {
    const ok = await confirm(t('upanel_confirm_delete', { name: conn.name }), { danger: true })
    if (!ok) return
    try {
      await invoke('upanel_connection_delete', { id: conn.id })
      toast(t('upanel_connection_deleted'), 'success')
      await loadConnections()
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    }
  }

  const handleTestConnection = async () => {
    if (!selectedId || testingConn) return
    setTestingConn(true)
    try {
      const r = await invoke('upanel_connection_test', { id: selectedId })
      if (r?.status === 'online') {
        toast(`${r.name}: ${t('upanel_status_online')} (${r.latency_ms ?? '—'} ms)`, 'success')
      } else {
        toast(
          `${r?.name ?? ''}: ${presentUpanelError(r?.error ?? 'upanel_network_error', t)}`,
          'error'
        )
      }
      await loadConnections()
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    } finally {
      setTestingConn(false)
    }
  }

  const handleTake = async serverId => {
    if (!selectedId || takingId) return
    setTakingId(serverId)
    try {
      const r = await invoke('upanel_live_take', {
        connectionId: selectedId,
        serverId,
      })
      setCredsModal({ title: t('upanel_taken_ok'), data: r ?? {} })
      await loadLive(selectedId, page, applied)
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    } finally {
      setTakingId(null)
    }
  }

  const handleCreds = async serverId => {
    if (!selectedId) return
    try {
      const r = await invoke('upanel_live_credentials', {
        connectionId: selectedId,
        serverId,
      })
      setCredsModal({ title: t('upanel_creds_title'), data: r ?? {} })
    } catch (e) {
      toast(presentUpanelError(e, t), 'error')
    }
  }

  const applyFilters = () => {
    setPage(1)
    setApplied({ ...filters })
  }

  const resetFilters = () => {
    setPage(1)
    setFilters({ ...EMPTY_FILTERS })
    setApplied({ ...EMPTY_FILTERS })
  }

  const totalPages = getTotalPages(total)
  const statsEntries = stats && typeof stats === 'object' ? Object.entries(stats) : []

  return (
    <div>
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            <Server size={14} /> {t('upanel_pptp_title')}
          </div>
          <div className="ph-sub">{t('upanel_pptp_sub')}</div>
        </div>
        <div className="ph-actions">
          {connections.length > 0 && (
            <>
              <select
                value={selectedId ?? ''}
                onChange={e => {
                  setPage(1)
                  setSelectedId(Number(e.target.value) || null)
                }}
                className="form-input w-auto min-w-[180px]"
                aria-label={t('upanel_select_connection')}
              >
                {connections.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active ? '' : ` (${t('upanel_status_disabled')})`}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleTestConnection}
                disabled={!selectedId || testingConn}
              >
                {testingConn ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
                {testingConn ? t('upanel_widget_checking') : t('upanel_test_connection')}
              </button>
            </>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => loadLive(selectedId, page, applied)}
            disabled={!selectedId || listLoading}
          >
            <RefreshCw size={13} className={listLoading ? 'animate-spin' : ''} />
            {t('btn_refresh')}
          </button>
          <button className="btn btn-g" onClick={() => setConnModal('add')}>
            + {t('upanel_add_connection')}
          </button>
        </div>
      </div>

      {/* Connections table (masked tokens, statuses) */}
      {connLoading ? (
        <div className="panel p-4 text-12 text-muted">…</div>
      ) : connections.length === 0 ? (
        <div className="panel p-0">
          <EmptyState
            icon={<Server size={38} />}
            title={t('upanel_no_connections')}
            subtitle={t('upanel_no_connections_hint')}
            action={
              <button className="btn btn-b" onClick={() => setConnModal('add')}>
                + {t('upanel_add_connection')}
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="panel p-0 mb-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('upanel_name')}</th>
                  <th>Base URL</th>
                  <th>Token</th>
                  <th>{t('col_status')}</th>
                  <th>{t('upanel_widget_last_check')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {connections.map(c => (
                  <tr
                    key={c.id}
                    className={c.is_active ? '' : 'opacity-60'}
                    style={{ fontWeight: c.id === selectedId ? 600 : undefined }}
                  >
                    <td className="text-secondary">{c.name}</td>
                    <td className="mono text-11 text-muted">{c.base_url}</td>
                    <td className="mono text-11 text-muted">{c.token_preview || '—'}</td>
                    <td>
                      <span
                        className={`st ${
                          {
                            online: 'st-active',
                            offline: 'st-decline',
                            error: 'st-blocked',
                            disabled: 'st-pending',
                          }[c.last_check_status] || 'st-pending'
                        }`}
                      >
                        {t(`upanel_status_${c.last_check_status || 'unknown'}`)}
                      </span>
                    </td>
                    <td className="text-11 text-muted">
                      {c.last_check_at ? timeAgo(c.last_check_at) : '—'}
                    </td>
                    <td>
                      <div className="tbl-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setConnModal(c)}
                          aria-label={t('btn_edit')}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="btn btn-r btn-sm"
                          onClick={() => handleDeleteConnection(c)}
                          aria-label={t('btn_delete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Live stats strip */}
          {statsEntries.length > 0 && (
            <div className="panel p-2 mb-3 flex flex-wrap items-center gap-2">
              <BarChart3 size={13} className="text-muted" />
              {statsEntries.slice(0, 8).map(([k, v]) => (
                <span
                  key={k}
                  className="mono text-10 px-2 py-[2px] rounded-[6px] bg-surface border border-border"
                >
                  {k}: <span className="text-text">{String(v)}</span>
                </span>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="panel p-3 mb-3">
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_country')}</label>
                <input
                  value={filters.country_code}
                  onChange={setF('country_code')}
                  placeholder="US"
                  maxLength={2}
                  className="form-input mono"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_state')}</label>
                <input value={filters.state} onChange={setF('state')} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_city')}</label>
                <input value={filters.city} onChange={setF('city')} className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_ip')}</label>
                <input
                  value={filters.ip}
                  onChange={setF('ip')}
                  placeholder="1.2.3.4"
                  className="form-input mono"
                />
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_fraud')}</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={filters.fraud_min}
                    onChange={setF('fraud_min')}
                    placeholder={t('upanel_filter_from')}
                    className="form-input mono"
                  />
                  <input
                    type="number"
                    value={filters.fraud_max}
                    onChange={setF('fraud_max')}
                    placeholder={t('upanel_filter_to')}
                    className="form-input mono"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_filter_mtu')}</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    value={filters.mtu_min}
                    onChange={setF('mtu_min')}
                    placeholder={t('upanel_filter_from')}
                    className="form-input mono"
                  />
                  <input
                    type="number"
                    value={filters.mtu_max}
                    onChange={setF('mtu_max')}
                    placeholder={t('upanel_filter_to')}
                    className="form-input mono"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t('upanel_sort_by')}</label>
                <select
                  value={filters.order_by}
                  onChange={setF('order_by')}
                  className="form-input mono"
                >
                  <option value="">—</option>
                  {SORT_FIELDS.map(f => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">&nbsp;</label>
                <select
                  value={filters.order_dir}
                  onChange={setF('order_dir')}
                  className="form-input mono"
                >
                  <option value="">—</option>
                  <option value="asc">asc</option>
                  <option value="desc">desc</option>
                </select>
              </div>
              <div className="form-group flex items-end gap-1">
                <button className="btn btn-b btn-sm" onClick={applyFilters}>
                  {t('upanel_btn_apply')}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={resetFilters}>
                  {t('upanel_btn_reset')}
                </button>
              </div>
            </div>
          </div>

          {/* Live servers table */}
          <div className="panel p-0">
            <div className="flex-1-overflow">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('upanel_col_country')}</th>
                    <th>{t('upanel_col_state')}</th>
                    <th>{t('upanel_col_city')}</th>
                    <th>IP</th>
                    <th>MTU</th>
                    <th>{t('upanel_col_fraud')}</th>
                    <th>{t('upanel_col_takes')}</th>
                    <th>{t('upanel_col_updated')}</th>
                    <th>{t('upanel_col_notes')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading && items.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center text-muted py-4 text-12">
                        …
                      </td>
                    </tr>
                  )}
                  {!listLoading && items.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-0">
                        <EmptyState
                          title={t('upanel_empty_live')}
                          subtitle={selectedId ? '' : t('upanel_select_connection')}
                          icon={<Server size={30} />}
                        />
                      </td>
                    </tr>
                  )}
                  {items.map((s, i) => (
                    <tr key={s.id ?? i}>
                      <td className="mono text-11 text-muted">{s.id ?? '—'}</td>
                      <td className="mono text-11">{s.country ?? '—'}</td>
                      <td className="text-11 text-muted">{s.state ?? '—'}</td>
                      <td className="text-11 text-muted">{s.city ?? '—'}</td>
                      <td className="mono text-11">{s.ip ?? '—'}</td>
                      <td className="mono text-11 text-muted">{s.mtu ?? '—'}</td>
                      <td>
                        <span
                          className={`mono text-10 px-2 py-[2px] rounded-[6px] bg-surface border border-border ${
                            (s.fraud_score ?? 0) >= 70 ? 'text-red-t' : 'text-yellow-t'
                          }`}
                        >
                          {s.fraud_score ?? '—'}
                        </span>
                      </td>
                      <td className="mono text-11 text-muted">{s.takes_count ?? '—'}</td>
                      <td className="text-11 text-muted">
                        {s.updated_at ? timeAgo(s.updated_at) : '—'}
                      </td>
                      <td className="text-11 text-muted max-w-[160px]">{s.notes || '—'}</td>
                      <td>
                        <div className="tbl-actions">
                          <button
                            className="btn btn-b btn-sm"
                            onClick={() => handleTake(s.id)}
                            disabled={takingId != null || s.id == null}
                          >
                            {takingId === s.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              t('upanel_btn_take')
                            )}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleCreds(s.id)}
                            disabled={s.id == null}
                            title={t('upanel_btn_creds')}
                          >
                            <KeyRound size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-11 text-muted">{total}</span>
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  ←
                </button>
                <span className="text-11 text-muted px-2">
                  {t('upanel_page_of', { page, n: totalPages })}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {connModal && (
        <ConnectionModal
          initial={connModal === 'add' ? null : connModal}
          onSave={handleSaveConnection}
          onClose={() => setConnModal(null)}
        />
      )}
      {credsModal && (
        <CredsModal
          title={credsModal.title}
          data={credsModal.data}
          onClose={() => setCredsModal(null)}
        />
      )}
    </div>
  )
}
