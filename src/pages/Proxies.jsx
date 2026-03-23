import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Globe,
  Shield,
  Plus,
  RefreshCw,
  X,
  Upload,
  Eye,
  EyeOff,
  Store,
  Wifi,
  WifiOff,
  Loader2,
  BarChart2,
  AlertTriangle,
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLang } from '../hooks/useLang'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { timeAgo } from '../utils/formatting'
import { buildPageNumbers } from '../utils/pagination'
import { STATUS_COLORS, getDeliveryRateColor } from '../constants/colors'

// ─── Helpers ──────────────────────────────────────────────────
function TypeBadge({ type }) {
  const colorMap = {
    http: { color: STATUS_COLORS.info, bg: 'var(--color-info-bg)' },
    socks5: { color: 'var(--blue-t)', bg: 'rgba(167,139,250,0.12)' },
    socks4: { color: 'var(--blue-t)', bg: 'rgba(129,140,248,0.12)' },
    pptp: { color: STATUS_COLORS.warning, bg: STATUS_COLORS.warningBg },
  }
  const cfg = colorMap[type] || { color: 'var(--muted)', bg: 'var(--surface)' }
  return (
    <span
      className="mono text-[10px] px-2 py-[2px] rounded-[6px]"
      style={{
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}33`,
      }}
    >
      {type?.toUpperCase()}
    </span>
  )
}

function StatusBadge({ proxy, healthStatus }) {
  const shopCount = proxy.shops_used?.length ?? 0
  if (proxy.is_blocked) return <span className="st st-blocked">blocked</span>
  // Health status overrides if present
  if (healthStatus === 'online') return <span className="st st-active">Online</span>
  if (healthStatus === 'offline') return <span className="st st-decline">Offline</span>
  if (healthStatus === 'slow') return <span className="st st-pending">Slow</span>
  if (shopCount > 0) return <span className="st st-used">used</span>
  return <span className="st st-clean">clean</span>
}

function UsageStatsModal({ onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    invoke('get_proxy_usage_stats')
      .then(setStats)
      .catch(e => toast(String(e), 'error'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentional: only run on mount, toast is stable

  const rateColor = rate => getDeliveryRateColor(rate)

  return (
    <div className="modal-overlay">
      <div
        className="modal w-modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proxy-stats-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="proxy-stats-title" className="modal-title flex items-center gap-2">
            <BarChart2 size={15} /> Proxy Usage Stats
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="text-center p-8 text-muted text-[13px]">
            <Loader2 size={18} className="animate-spin inline-block mb-2" />
            <div>Loading stats...</div>
          </div>
        )}

        {!loading && (!stats || stats.length === 0) && (
          <div className="text-center p-8 text-muted text-[13px]">
            No proxy usage data found. Assign proxies to orders to see stats here.
          </div>
        )}

        {!loading && stats && stats.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Proxy ID</th>
                <th>Total Orders</th>
                <th>Success</th>
                <th>Declined</th>
                <th>Success Rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => {
                const rate =
                  s.total_orders > 0 ? Math.round((s.success_count / s.total_orders) * 100) : 0
                const color = rateColor(rate)
                return (
                  <tr key={s.proxy_id}>
                    <td className="mono text-[11px]">#{s.proxy_id}</td>
                    <td>{s.total_orders}</td>
                    <td style={{ color: STATUS_COLORS.success }}>{s.success_count}</td>
                    <td style={{ color: STATUS_COLORS.error }}>{s.decline_count}</td>
                    <td>
                      <span className="font-semibold" style={{ color }}>
                        {rate}%
                      </span>
                      {rate < 40 && (
                        <span
                          className="ml-2 text-[10px] inline-flex items-center gap-[3px]"
                          style={{ color: STATUS_COLORS.error }}
                        >
                          <AlertTriangle size={10} /> High decline rate — consider replacing
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="mt-4 text-right">
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Password field ───────────────────────────────────────────
function PasswordField({ value, onChange, placeholder = 'Password' }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="form-input mono"
        style={{ paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--muted)',
        }}
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

// ─── ProxyForm modal ──────────────────────────────────────────
const EMPTY_PROXY = {
  host: '',
  port: '',
  proxy_type: 'http',
  username: '',
  password: '',
  label: '',
  notes: '',
}

function ProxyModal({ initial, onSave, onClose }) {
  const { t } = useLang()
  const [form, setForm] = useState(
    initial
      ? {
          ...initial,
          port: String(initial.port),
          password: initial.password || '',
          username: initial.username || '',
          label: initial.label || '',
          notes: initial.notes || '',
        }
      : { ...EMPTY_PROXY }
  )
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const isEdit = !!initial

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const valid = form.host.trim() && form.port

  const handleSave = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onSave({ ...form, port: parseInt(form.port, 10) || 80 })
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{ width: 'var(--modal-sm)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proxy-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="proxy-modal-title" className="modal-title">
            {isEdit ? 'Edit Proxy' : 'Add Proxy'}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {/* Host + Port */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Host *</label>
              <input
                value={form.host}
                onChange={set('host')}
                placeholder="proxy.example.com"
                className="form-input mono"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Port *</label>
              <input
                type="number"
                value={form.port}
                onChange={set('port')}
                placeholder="8080"
                className="form-input mono"
              />
            </div>
          </div>

          {/* Type */}
          <div className="form-group">
            <label className="form-label">Type</label>
            <div className="flex gap-1">
              {['http', 'socks5', 'socks4', 'pptp'].map(t => (
                <button
                  key={t}
                  onClick={() => setForm(f => ({ ...f, proxy_type: t }))}
                  className={`btn btn-sm ${form.proxy_type === t ? 'btn-b' : 'btn-ghost'}`}
                  style={{ flex: 1, fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Auth */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                value={form.username}
                onChange={set('username')}
                placeholder="user"
                className="form-input mono"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordField value={form.password} onChange={set('password')} />
            </div>
          </div>

          {/* Label + Notes */}
          <div className="form-group">
            <label className="form-label">Label</label>
            <input
              value={form.label}
              onChange={set('label')}
              placeholder="Residential US"
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              className="form-input resize-none"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!valid || loading}
            className="btn btn-b"
            style={{
              width: '100%',
              opacity: !valid || loading ? 0.4 : 1,
              cursor: !valid || loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? t('email_saving') : isEdit ? t('btn_save') : t('add_proxy')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Import modal ─────────────────────────────────────────────
function ImportModal({ onDone, onClose }) {
  const { t } = useLang()
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handleImport = async () => {
    if (!raw.trim()) return
    setLoading(true)
    try {
      const r = await invoke('import_proxies', { raw })
      setResult(r)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{ width: 'var(--modal-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-proxies-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="import-proxies-title" className="modal-title">
            Import Proxies
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {!result ? (
            <>
              <div
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                  Supported formats:
                </div>
                <div>host:port:user:pass</div>
                <div>socks5://user:pass@host:port</div>
                <div>http://host:port</div>
              </div>
              <textarea
                value={raw}
                onChange={e => setRaw(e.target.value)}
                rows={10}
                placeholder={
                  '192.168.1.1:8080:user:pass\nsocks5://user:pass@proxy.com:1080\nhttp://10.0.0.1:3128'
                }
                className="form-input mono"
                style={{ resize: 'none', fontSize: 12 }}
              />
              <button
                onClick={handleImport}
                disabled={!raw.trim() || loading}
                className="btn btn-b"
                style={{ width: '100%', opacity: !raw.trim() || loading ? 0.4 : 1 }}
              >
                {loading ? t('proxy_importing') : t('import_proxies') + ' →'}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div
                  style={{
                    background: 'var(--color-success-bg)',
                    border: '1px solid var(--color-success-bg)',
                    borderRadius: 10,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, fontWeight: 700, color: STATUS_COLORS.success }}>
                    {result.parsed}
                  </div>
                  <div className="text-[11px] text-muted mt-1">{t('cc_import_done')}</div>
                </div>
                <div
                  style={{
                    background: 'var(--color-warning-bg)',
                    border: '1px solid var(--color-warning-bg)',
                    borderRadius: 10,
                    padding: 16,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, fontWeight: 700, color: STATUS_COLORS.warning }}>
                    {result.skipped}
                  </div>
                  <div className="text-[11px] text-muted mt-1">{t('profiles_skipped')}</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 10,
                    maxHeight: 120,
                    overflowY: 'auto',
                  }}
                >
                  {result.errors.map((e, i) => (
                    <div
                      key={i}
                      className="mono"
                      style={{ fontSize: 11, color: STATUS_COLORS.error, padding: '2px 0' }}
                    >
                      {e}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  onDone()
                  onClose()
                }}
                className="btn btn-g w-full"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── G2: BindToShopDropdown ───────────────────────────────────
function BindToShopDropdown({ proxy, currentBinding, onBound, onUnbound }) {
  const [open, setOpen] = useState(false)
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    invoke('get_shops', { page: 1, perPage: 200, search: '' })
      .then(r => setShops(r.items || []))
      .catch(() => setShops([]))
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  const handleBind = async shop => {
    setLoading(true)
    try {
      await invoke('set_proxy_shop_binding', { proxyId: proxy.id, shopId: shop.id })
      toast(`Proxy bound to ${shop.name || shop.domain}`, 'success')
      onBound(shop)
      setOpen(false)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleUnbind = async () => {
    if (!currentBinding) return
    setLoading(true)
    try {
      await invoke('remove_proxy_shop_binding', { shopId: currentBinding.id })
      toast('Binding removed', 'success')
      onUnbound()
      setOpen(false)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(o => !o)}
        title="Bind to Shop"
      >
        <Store size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            zIndex: 30,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            minWidth: 180,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {currentBinding && (
            <button
              onClick={handleUnbind}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                fontSize: 11,
                color: STATUS_COLORS.error,
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Unbind from {currentBinding.name || currentBinding.domain}
            </button>
          )}
          {shops.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)' }}>
              Loading shops…
            </div>
          )}
          {shops.map(s => (
            <button
              key={s.id}
              onClick={() => handleBind(s)}
              disabled={loading}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                fontSize: 11,
                color: 'var(--text-2)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              {s.name || s.domain}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ProxyList ───────────────────────────────────────────
export default function ProxyList() {
  const [proxies, setProxies] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filterBlocked, setFilterBlocked] = useState(null)
  const [filterUsed, setFilterUsed] = useState(null)
  const [filterType, setFilterType] = useState(null)
  const [modal, setModal] = useState(null) // null | "add" | "import" | "stats" | Proxy
  const [testingId, setTestingId] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [testingAll, setTestingAll] = useState(false)
  const [testAllProgress, setTestAllProgress] = useState({
    current: 0,
    total: 0,
    online: 0,
    failed: 0,
  })
  const [checkingHealth, setCheckingHealth] = useState(false)
  // G2: proxy-shop bindings map: { [proxy_id]: shopObj }
  const [proxyBindings, setProxyBindings] = useState({}) // proxy_id -> shop obj
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { t } = useLang()
  const PER_PAGE = 50

  // Virtualization setup
  const parentRef = useRef(null)
  const useVirtual = proxies.length > 100
  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? proxies.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 5,
  })

  const load = useCallback(
    async (p = page, fb = filterBlocked, ft = filterType, fu = filterUsed) => {
      setLoading(true)
      try {
        const r = await invoke('get_proxies', {
          filter: { is_blocked: fb, is_used: fu, proxy_type: ft },
          page: p,
          perPage: PER_PAGE,
        })
        setProxies(r.items)
        setTotal(r.total)
        if (r.items.length === 0 && r.total > 0 && p > 1) {
          setPage(prev => Math.max(1, prev - 1))
        }
      } catch (e) {
        toast(String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, filterBlocked, filterType, filterUsed] // toast is stable from useToast hook
  )

  useEffect(() => {
    load()
    // G2: load all proxy-shop bindings and shop data to show badges
    Promise.all([
      invoke('get_all_proxy_shop_bindings').catch(() => []),
      invoke('get_shops', { page: 1, perPage: 500, search: '' })
        .then(r => r.items || [])
        .catch(() => []),
    ]).then(([bindings, shops]) => {
      const cache = {}
      shops.forEach(s => {
        cache[s.id] = s
      })
      const bindMap = {}
      bindings.forEach(b => {
        if (cache[b.shop_id]) bindMap[b.proxy_id] = cache[b.shop_id]
      })
      setProxyBindings(bindMap)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentional: only run on mount, load is stable

  const handleAdd = async form => {
    await invoke('add_proxy', { input: form })
    toast('Proxy added', 'success')
    load()
  }

  const handleEdit = async form => {
    await invoke('update_proxy', { id: modal.id, input: form })
    toast('Proxy updated', 'success')
    load()
  }

  const handleDelete = async proxy => {
    const ok = await confirm(t('proxy_confirm_delete') + ` ${proxy.host}:${proxy.port}?`, {
      danger: true,
    })
    if (!ok) return
    try {
      await invoke('delete_proxy', { id: proxy.id })
      toast('Proxy deleted', 'success')
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleTestAll = async () => {
    if (testingAll) return
    setTestingAll(true)
    const list = proxies
    setTestAllProgress({ current: 0, total: list.length, online: 0, failed: 0 })
    setTestResults({})
    let online = 0,
      failed = 0
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      setTestResults(prev => ({ ...prev, [p.id]: 'testing' }))
      setTestAllProgress(prev => ({ ...prev, current: i + 1 }))
      try {
        const ok = await invoke('test_proxy_connection', { host: p.host, port: p.port })
        if (ok) {
          online++
          setTestResults(prev => ({ ...prev, [p.id]: 'online' }))
        } else {
          failed++
          setTestResults(prev => ({ ...prev, [p.id]: 'failed' }))
        }
      } catch {
        failed++
        setTestResults(prev => ({ ...prev, [p.id]: 'failed' }))
      }
      setTestAllProgress(prev => ({ ...prev, online, failed }))
    }
    setTestingAll(false)
    toast(`Done: ${online} online, ${failed} failed`, online > 0 ? 'success' : 'warn')
  }

  const handleTestProxy = async proxy => {
    setTestingId(proxy.id)
    try {
      const ok = await invoke('test_proxy_connection', { host: proxy.host, port: proxy.port })
      setTestResults(r => ({ ...r, [proxy.id]: ok }))
      toast(
        ok
          ? `${proxy.host}:${proxy.port} — reachable`
          : `${proxy.host}:${proxy.port} — unreachable`,
        ok ? 'success' : 'error'
      )
    } catch (e) {
      setTestResults(r => ({ ...r, [proxy.id]: false }))
      toast(String(e), 'error')
    } finally {
      setTestingId(null)
    }
  }

  const handleCheckNow = async () => {
    if (checkingHealth) return
    setCheckingHealth(true)
    try {
      const result = await invoke('check_proxy_health_now')
      toast(
        `Checked ${result.checked} proxies: ${result.online} online, ${result.offline} offline`,
        'success'
      )
      load()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setCheckingHealth(false)
    }
  }

  const cleanCount = proxies.filter(p => !p.is_blocked && !p.shops_used?.length).length
  const blockedCount = proxies.filter(p => p.is_blocked).length
  const usedCount = proxies.filter(p => !p.is_blocked && p.shops_used?.length > 0).length
  const totalPages = Math.ceil(total / PER_PAGE)

  const applyTypeFilter = v => {
    const f = v === filterType ? null : v
    setFilterType(f)
    setPage(1)
    load(1, filterBlocked, f, filterUsed)
  }

  const applyStatusFilter = (blockVal, usedVal) => {
    setFilterBlocked(blockVal)
    setFilterUsed(usedVal)
    setPage(1)
    load(1, blockVal, filterType, usedVal)
  }

  const usedInLabel = proxy => {
    if (!proxy.shops_used?.length) return '—'
    return proxy.shops_used.map(s => s.name).join(', ')
  }

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            <Globe size={14} /> {t('proxy_manager')}
          </div>
          <div className="ph-sub">{t('proxy_pool_count', { n: total })}</div>
        </div>
        <div className="ph-actions">
          <button className="btn btn-b" onClick={() => setModal('import')}>
            <Upload size={13} /> {t('btn_import')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleTestAll}
            disabled={testingAll || proxies.length === 0}
          >
            <RefreshCw
              size={13}
              style={{ animation: testingAll ? 'spin 1s linear infinite' : 'none' }}
            />
            {testingAll
              ? `${t('btn_test')} ${testAllProgress.current}/${testAllProgress.total}…`
              : t('proxy_test_all')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleCheckNow}
            disabled={checkingHealth || proxies.length === 0}
          >
            <Wifi
              size={13}
              style={{ animation: checkingHealth ? 'spin 1s linear infinite' : 'none' }}
            />
            {checkingHealth ? 'Checking…' : 'Check Now'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setModal('stats')}>
            <BarChart2 size={13} /> Usage Stats
          </button>
          <button className="btn btn-g" onClick={() => setModal('add')}>
            + {t('add_proxy')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters mb-3">
        {[
          [null, null, t('filter_all')],
          [false, null, `${t('filter_clean')} (${cleanCount})`],
          [null, true, `${t('filter_used')} (${usedCount})`],
          [true, null, `${t('filter_blocked')} (${blockedCount})`],
        ].map(([blockVal, usedVal, label]) => {
          const isActive = filterBlocked === blockVal && filterUsed === usedVal
          return (
            <button
              key={label}
              onClick={() => applyStatusFilter(blockVal, usedVal)}
              className={`flt${isActive ? ' active' : ''}`}
            >
              {label}
            </button>
          )
        })}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
        {[
          ['http', 'HTTP'],
          ['socks5', 'SOCKS5'],
          ['socks4', 'SOCKS4'],
          ['pptp', 'PPTP'],
        ].map(([val, label]) => (
          <button
            key={val}
            onClick={() => applyTypeFilter(val)}
            className={`flt${filterType === val ? ' active' : ''}`}
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="panel p-0">
        {proxies.length === 0 && loading ? (
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th className="bg-card">{t('col_label')}</th>
                <th className="bg-card">{t('col_host_port')}</th>
                <th className="bg-card">{t('col_type')}</th>
                <th className="bg-card">{t('col_status')}</th>
                <th className="bg-card">{t('proxy_used_in')}</th>
                <th className="bg-card">Last Checked</th>
                <th className="bg-card"></th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows count={6} cols={7} />
            </tbody>
          </table>
        ) : proxies.length === 0 ? (
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th className="bg-card">{t('col_label')}</th>
                <th className="bg-card">{t('col_host_port')}</th>
                <th className="bg-card">{t('col_type')}</th>
                <th className="bg-card">{t('col_status')}</th>
                <th className="bg-card">{t('proxy_used_in')}</th>
                <th className="bg-card">Last Checked</th>
                <th className="bg-card"></th>
              </tr>
            </thead>
            <tbody>
              <EmptyState
                colSpan={7}
                icon={<Shield size={14} />}
                title={t('no_proxies')}
                subtitle={t('proxy_empty_hint')}
                action={
                  <button className="btn btn-g btn-sm" onClick={() => setModal('add')}>
                    <Plus size={12} /> Add Proxy
                  </button>
                }
              />
            </tbody>
          </table>
        ) : useVirtual ? (
          <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
            <table className="tbl">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  <th className="bg-card">{t('col_label')}</th>
                  <th className="bg-card">{t('col_host_port')}</th>
                  <th className="bg-card">{t('col_type')}</th>
                  <th className="bg-card">{t('col_status')}</th>
                  <th className="bg-card">{t('proxy_used_in')}</th>
                  <th className="bg-card">Last Checked</th>
                  <th className="bg-card"></th>
                </tr>
              </thead>
            </table>
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const proxy = proxies[virtualRow.index]
                const rawResult = testResults[proxy.id]
                let healthStatus = null
                if (rawResult === true || rawResult === 'online') healthStatus = 'online'
                if (rawResult === false || rawResult === 'failed') healthStatus = 'offline'
                const boundShop = proxyBindings[proxy.id] || null
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <table className="tbl" style={{ marginBottom: 0 }}>
                      <tbody>
                        <tr style={{ opacity: proxy.is_blocked ? 0.6 : 1 }}>
                          <td style={{ color: 'var(--text-secondary)' }}>
                            {proxy.label || '—'}
                            {boundShop && (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: 'var(--color-info-bg)',
                                  color: STATUS_COLORS.info,
                                  border: '1px solid var(--color-info-bg)',
                                  fontFamily: 'JetBrains Mono, monospace',
                                }}
                              >
                                → {boundShop.name || boundShop.domain}
                              </span>
                            )}
                          </td>
                          <td className="mono text-[11px] text-muted">
                            {proxy.host}
                            <span style={{ color: 'var(--border)' }}>:</span>
                            {proxy.port}
                          </td>
                          <td>
                            <TypeBadge type={proxy.proxy_type} />
                          </td>
                          <td>
                            <StatusBadge proxy={proxy} healthStatus={healthStatus} />
                          </td>
                          <td className="text-[11px] text-muted">{usedInLabel(proxy)}</td>
                          <td className="text-[11px] text-muted">{timeAgo(proxy.last_checked)}</td>
                          <td>
                            <div className="tbl-actions">
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleTestProxy(proxy)}
                                disabled={
                                  testingId === proxy.id || testResults[proxy.id] === 'testing'
                                }
                                title={t('btn_test')}
                              >
                                {testingId === proxy.id || testResults[proxy.id] === 'testing' ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : testResults[proxy.id] === true ||
                                  testResults[proxy.id] === 'online' ? (
                                  <Wifi size={12} style={{ color: STATUS_COLORS.success }} />
                                ) : testResults[proxy.id] === false ||
                                  testResults[proxy.id] === 'failed' ? (
                                  <WifiOff size={12} className="text-red-t" />
                                ) : (
                                  <Wifi size={12} />
                                )}
                              </button>
                              <BindToShopDropdown
                                proxy={proxy}
                                currentBinding={boundShop}
                                onBound={shop =>
                                  setProxyBindings(prev => ({ ...prev, [proxy.id]: shop }))
                                }
                                onUnbound={() =>
                                  setProxyBindings(prev => {
                                    const n = { ...prev }
                                    delete n[proxy.id]
                                    return n
                                  })
                                }
                              />
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setModal(proxy)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-r btn-sm"
                                onClick={() => handleDelete(proxy)}
                              >
                                {t('btn_delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <table className="tbl">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  <th className="bg-card">{t('col_label')}</th>
                  <th className="bg-card">{t('col_host_port')}</th>
                  <th className="bg-card">{t('col_type')}</th>
                  <th className="bg-card">{t('col_status')}</th>
                  <th className="bg-card">{t('proxy_used_in')}</th>
                  <th className="bg-card">Last Checked</th>
                  <th className="bg-card"></th>
                </tr>
              </thead>
              <tbody>
                {proxies.map(proxy => {
                  const rawResult = testResults[proxy.id]
                  let healthStatus = null
                  if (rawResult === true || rawResult === 'online') healthStatus = 'online'
                  if (rawResult === false || rawResult === 'failed') healthStatus = 'offline'
                  const boundShop = proxyBindings[proxy.id] || null
                  return (
                    <tr key={proxy.id} style={{ opacity: proxy.is_blocked ? 0.6 : 1 }}>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {proxy.label || '—'}
                        {boundShop && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: 'var(--color-info-bg)',
                              color: STATUS_COLORS.info,
                              border: '1px solid var(--color-info-bg)',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}
                          >
                            → {boundShop.name || boundShop.domain}
                          </span>
                        )}
                      </td>
                      <td className="mono text-[11px] text-muted">
                        {proxy.host}
                        <span style={{ color: 'var(--border)' }}>:</span>
                        {proxy.port}
                      </td>
                      <td>
                        <TypeBadge type={proxy.proxy_type} />
                      </td>
                      <td>
                        <StatusBadge proxy={proxy} healthStatus={healthStatus} />
                      </td>
                      <td className="text-[11px] text-muted">{usedInLabel(proxy)}</td>
                      <td className="text-[11px] text-muted">{timeAgo(proxy.last_checked)}</td>
                      <td>
                        <div className="tbl-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleTestProxy(proxy)}
                            disabled={testingId === proxy.id || testResults[proxy.id] === 'testing'}
                            title={t('btn_test')}
                          >
                            {testingId === proxy.id || testResults[proxy.id] === 'testing' ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : testResults[proxy.id] === true ||
                              testResults[proxy.id] === 'online' ? (
                              <Wifi size={12} style={{ color: STATUS_COLORS.success }} />
                            ) : testResults[proxy.id] === false ||
                              testResults[proxy.id] === 'failed' ? (
                              <WifiOff size={12} className="text-red-t" />
                            ) : (
                              <Wifi size={12} />
                            )}
                          </button>
                          <BindToShopDropdown
                            proxy={proxy}
                            currentBinding={boundShop}
                            onBound={shop =>
                              setProxyBindings(prev => ({ ...prev, [proxy.id]: shop }))
                            }
                            onUnbound={() =>
                              setProxyBindings(prev => {
                                const n = { ...prev }
                                delete n[proxy.id]
                                return n
                              })
                            }
                          />
                          <button className="btn btn-ghost btn-sm" onClick={() => setModal(proxy)}>
                            Edit
                          </button>
                          <button className="btn btn-r btn-sm" onClick={() => handleDelete(proxy)}>
                            {t('btn_delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-muted">{total} proxies</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map((p, idx) =>
              p === '…' ? (
                <span
                  key={`ellipsis-${idx}`}
                  className="btn btn-sm btn-ghost"
                  style={{ cursor: 'default' }}
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p)
                    load(p, filterBlocked, filterType, filterUsed)
                  }}
                  className={`btn btn-sm ${page === p ? 'btn-b' : 'btn-ghost'}`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === 'add' && <ProxyModal onSave={handleAdd} onClose={() => setModal(null)} />}
      {modal === 'import' && <ImportModal onDone={() => load()} onClose={() => setModal(null)} />}
      {modal === 'stats' && <UsageStatsModal onClose={() => setModal(null)} />}
      {modal && modal !== 'add' && modal !== 'import' && modal !== 'stats' && (
        <ProxyModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
