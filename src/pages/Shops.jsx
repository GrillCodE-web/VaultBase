import React, { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Download, ExternalLink, Store } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { getDeliveryRateColor, getRiskColor, STATUS_COLORS } from '../constants/colors.js'
import { ORDER_STATUS_COLORS } from '../constants/status.js'
import { SHOP_FLAGS, getActiveShopFlags } from '../constants/shops.js'
import { exportToCSV } from '../utils/csv.js'
import { DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// ─── ShopRiskBadge ────────────────────────────────────────────────────────

function ShopRiskBadge({ shopId }) {
  const [risk, setRisk] = useState(null)
  useEffect(() => {
    // FIX FE-H05: Log shop risk score errors instead of silently ignoring
    invoke('get_shop_risk_score', { shopId })
      .then(setRisk)
      .catch(e => console.error('[Shops] Failed to get shop risk score:', e))
  }, [shopId])
  if (!risk) return <span className="text-muted">—</span>
  const riskConfig = getRiskColor(risk.risk_level)
  return (
    <span
      className="tiny-badge"
      style={{
        background: riskConfig.bg,
        color: riskConfig.color,
      }}
    >
      <span className={`status-dot ${riskConfig.dot}`} /> {risk.risk_level}
    </span>
  )
}

// ─── Flag Pills Component ─────────────────────────────────────────────────

function FlagPills({ shop }) {
  const active = getActiveShopFlags(shop)
  if (!active.length) return <span className="text-[12px] text-muted">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {active.map(f => (
        <span
          key={f.key}
          className="flag-pill"
          style={{
            background: f.bg,
            color: f.color,
          }}
        >
          {f.label}
        </span>
      ))}
    </div>
  )
}

// ─── Stat card for detail panel ───────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="stat-card-sub">{sub}</div>}
    </div>
  )
}

// ─── Suggestion badge (re-exported) ──────────────────────────────────────

function SuggestionBadge({ s }) {
  const bgMap = {
    good: STATUS_COLORS.successBg,
    warn: STATUS_COLORS.warningBg,
    info: STATUS_COLORS.infoBg,
  }
  const colorMap = {
    good: STATUS_COLORS.success,
    warn: STATUS_COLORS.warning,
    info: STATUS_COLORS.info,
  }
  const iconMap = { good: '✓', warn: '⚠', info: 'i' }
  const lvl = s.level || 'info'
  return (
    <div
      className="flex items-start gap-2 px-2\.5 py-1\.5 rounded-md text-[12px]"
      style={{
        background: bgMap[lvl] || bgMap.info,
        color: colorMap[lvl] || colorMap.info,
        border: `1px solid ${colorMap[lvl] || colorMap.info}30`,
      }}
    >
      <span className="font-bold shrink-0">{iconMap[lvl] || iconMap.info}</span>
      <span className="text-muted">{s.message}</span>
    </div>
  )
}

// ─── ProductModal ─────────────────────────────────────────────────────────

const EMPTY_PRODUCT = { asin: '', name: '', amazon_price: '', shop_price: '', url: '', notes: '' }

function ProductModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(
    initial
      ? {
          ...initial,
          amazon_price: initial.amazon_price ?? '',
          shop_price: initial.shop_price ?? '',
        }
      : { ...EMPTY_PRODUCT }
  )
  const [loading, setLoading] = useState(false)
  const { toast } = usePremiumToast()
  const { t } = useLang()
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const margin = (() => {
    const a = parseFloat(form.amazon_price)
    const s = parseFloat(form.shop_price)
    if (!isNaN(a) && !isNaN(s)) return (s - a).toFixed(2)
    return null
  })()

  const handleSave = async () => {
    if (!form.name.trim()) return
    setLoading(true)
    try {
      const payload = {
        asin: form.asin,
        name: form.name,
        amazon_price: form.amazon_price !== '' ? parseFloat(form.amazon_price) : null,
        shop_price: form.shop_price !== '' ? parseFloat(form.shop_price) : null,
        url: form.url,
        notes: form.notes,
      }
      await onSave(payload)
      onClose()
    } catch (e) {
      const error = handleError(e, 'ShopModal.handleSave')
      toast(getErrorMessage(error), 'error')
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
        className="modal max-w-[480px] w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
      >
        <div className="flex items-center justify-between mb-4">
          <span id="product-modal-title" className="modal-title">
            {initial ? t('btn_edit') : t('product_save_btn')}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-2.5">
          <div className="form-group">
            <label className="form-label">ASIN</label>
            <input
              value={form.asin}
              onChange={set('asin')}
              placeholder="B08N5WRWNW"
              className="form-input font-mono"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="Product name"
              className="form-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-2.5">
          <div className="form-group">
            <label className="form-label">Amazon $</label>
            <input
              type="number"
              step="0.01"
              value={form.amazon_price}
              onChange={set('amazon_price')}
              placeholder="0.00"
              className="form-input font-mono"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Shop $</label>
            <input
              type="number"
              step="0.01"
              value={form.shop_price}
              onChange={set('shop_price')}
              placeholder="0.00"
              className="form-input font-mono"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Margin</label>
            <div
              className="form-input flex items-center mono"
              style={{
                color:
                  margin === null
                    ? 'var(--muted)'
                    : parseFloat(margin) >= 0
                      ? STATUS_COLORS.success
                      : STATUS_COLORS.error,
              }}
            >
              {margin !== null ? `$${margin}` : '—'}
            </div>
          </div>
        </div>

        <div className="form-group mb-2">
          <label className="form-label">URL</label>
          <input
            value={form.url}
            onChange={set('url')}
            placeholder="https://shop.com/product"
            className="form-input"
          />
        </div>

        <div className="form-group mb-4">
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
          disabled={!form.name.trim() || loading}
          className="btn btn-b w-full"
        >
          {loading ? t('email_saving') : initial ? t('email_save_changes') : t('product_save_btn')}
        </button>
      </div>
    </div>
  )
}

// ─── ShopModal (create / edit) ────────────────────────────────────────────

const EMPTY_SHOP = {
  name: '',
  url: '',
  category: '',
  notes: '',
  requires_cvv_match: false,
  blocks_vpn: false,
  phone_must_match: false,
  accepts_amex: false,
  requires_avs: false,
  high_cancel_risk: false,
}

function ShopModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          url: initial.url || initial.domain,
          category: initial.category || '',
          notes: initial.notes || '',
          requires_cvv_match: initial.requires_cvv_match,
          blocks_vpn: initial.blocks_vpn,
          phone_must_match: initial.phone_must_match,
          accepts_amex: initial.accepts_amex,
          requires_avs: initial.requires_avs,
          high_cancel_risk: initial.high_cancel_risk,
        }
      : { ...EMPTY_SHOP }
  )
  const [loading, setLoading] = useState(false)
  const { toast } = usePremiumToast()
  const { t } = useLang()

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const toggle = k => () => setForm(f => ({ ...f, [k]: !f[k] }))
  const valid = form.name.trim() && form.url.trim()

  const handleSave = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      const error = handleError(e, 'Shops.handleCreate')
      if (error.details?.originalMessage?.includes('duplicate')) {
        toast(t('shop_domain_exists'), 'error')
      } else {
        toast(getErrorMessage(error), 'error')
      }
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
        className="modal max-w-[500px] w-full max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <span id="shop-modal-title" className="modal-title">
            {initial ? 'Edit Shop' : 'New Shop'}
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">Shop Name *</label>
          <input
            value={form.name}
            onChange={set('name')}
            placeholder="Nike, Amazon, etc."
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label className="form-label">URL *</label>
          <input
            value={form.url}
            onChange={set('url')}
            placeholder="https://nike.com"
            className="form-input font-mono"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          <input
            value={form.category}
            onChange={set('category')}
            placeholder="Retail, Electronics, Fashion…"
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

        {/* Flags */}
        <div className="form-group">
          <label className="form-label mb-2">Risk Flags</label>
          <div className="grid grid-cols-2 gap-2">
            {SHOP_FLAGS.map(f => (
              <label
                key={f.key}
                onClick={toggle(f.key)}
                className="flex items-center gap-2\.5 p-[9px_12px] rounded-md cursor-pointer transition-all"
                style={{
                  border: form[f.key] ? `1px solid ${f.color}40` : '1px solid var(--border)',
                  background: form[f.key] ? f.bg : 'transparent',
                }}
              >
                <div
                  className="w-4 h-4 rounded-sm shrink-0 flex items-center justify-center"
                  style={{
                    background: form[f.key] ? 'var(--accent-hover)' : 'transparent',
                    border: form[f.key]
                      ? '1px solid var(--accent-hover)'
                      : '1px solid var(--border)',
                  }}
                >
                  {form[f.key] && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                <span className="text-[12px] text-muted">{f.label}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!valid || loading}
          className="btn btn-b w-full mt-1.5"
        >
          {loading ? t('email_saving') : initial ? t('email_save_changes') : t('shop_save_btn')}
        </button>
      </div>
    </div>
  )
}

// ─── Shop detail panel ────────────────────────────────────────────────────

function ShopDetailPanel({ shopId, onNavigate }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [productModal, setProductModal] = useState(null)
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()
  const { t } = useLang()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await invoke('get_shop', { id: shopId })
      setDetail(d)
    } catch (e) {
      const error = handleError(e, 'Shops.loadDetail')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]) // toast is stable from useToast hook

  useEffect(() => {
    load()
  }, [load])

  const handleAddProduct = async payload => {
    await invoke('add_shop_product', { shopId, product: payload })
    toast(t('product_added'), 'success')
    load()
  }

  const handleEditProduct = async payload => {
    await invoke('update_shop_product', { id: productModal.id, product: payload })
    toast(t('product_updated'), 'success')
    load()
  }

  const handleDeleteProduct = async p => {
    const ok = await confirm(t('shop_confirm_delete_product') + ` "${p.name}"?`, { danger: true })
    if (!ok) return
    try {
      await invoke('delete_shop_product', { id: p.id })
      toast(t('product_deleted'), 'success')
      load()
    } catch (e) {
      const error = handleError(e, 'Shops.handleDeleteProduct')
      toast(getErrorMessage(error), 'error')
    }
  }

  if (loading) {
    return <div className="p-5 text-center text-muted text-[12px]">Loading…</div>
  }
  if (!detail) return null

  const { stats, recent_orders, products } = detail

  return (
    <div className="border-t border-border bg-surface px-[18px] py-4">
      {/* Header with New Order button */}
      <div className="flex items-center justify-between mb-2">
        <p className="ptitle m-0">{t('section_statistics')}</p>
        {onNavigate && (
          <button
            className="btn btn-g btn-sm"
            onClick={() => onNavigate('orders', { openCreate: true })}
          >
            + New Order
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 mb-2.5">
        <StatCard label={t('stat_total')} value={stats.total} />
        <StatCard
          label={t('stat_delivered')}
          value={stats.delivered}
          accent={STATUS_COLORS.success}
        />
        <StatCard label={t('stat_declined')} value={stats.declined} accent={STATUS_COLORS.error} />
        <StatCard
          label={t('stat_avg_order')}
          value={stats.avg_order_value > 0 ? `$${stats.avg_order_value.toFixed(2)}` : '—'}
          accent={STATUS_COLORS.info}
        />
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 mb-[18px]">
        <StatCard label={t('stat_pending')} value={stats.pending} accent={STATUS_COLORS.warning} />
        <StatCard label={t('stat_processing')} value={stats.processing} accent="var(--blue-t)" />
        <StatCard label={t('stat_shipped')} value={stats.shipped} accent={STATUS_COLORS.info} />
        <StatCard
          label={t('stat_success_rate')}
          value={`${stats.success_rate.toFixed(1)}%`}
          accent={getDeliveryRateColor(stats.success_rate)}
          sub={`${t('stat_decline_rate')}: ${stats.decline_rate.toFixed(1)}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Products */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <p className="ptitle m-0">Products ({products.length})</p>
            <div className="flex gap-1">
              {products.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  title="Export products as CSV"
                  onClick={() => {
                    const rows = products.map(p => [
                      p.name,
                      p.asin ?? '',
                      p.amazon_price ?? '',
                      p.shop_price ?? '',
                      p.margin ?? '',
                      p.url ?? '',
                    ])
                    exportToCSV(
                      `${detail.shop.name}_products.csv`,
                      'Name,ASIN,Amazon Price,Shop Price,Margin,URL',
                      rows
                    )
                  }}
                >
                  <Download size={13} /> CSV
                </button>
              )}
              <button onClick={() => setProductModal('add')} className="btn btn-b btn-sm">
                + Add
              </button>
            </div>
          </div>
          {products.length === 0 ? (
            <div className="text-center py-6 text-muted text-[12px]">No products catalogued</div>
          ) : (
            <div className="panel p-0 overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t('col_asin')}</th>
                    <th>{t('col_product_name')}</th>
                    <th>{t('col_amazon_price')}</th>
                    <th>{t('col_shop_price')}</th>
                    <th>{t('col_margin')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td className="font-mono text-muted">{p.asin || '—'}</td>
                      <td className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {p.name}
                      </td>
                      <td className="font-mono">
                        {p.amazon_price != null ? `$${p.amazon_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="font-mono">
                        {p.shop_price != null ? `$${p.shop_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="font-mono">
                        {p.margin != null ? (
                          <span
                            style={{
                              color: p.margin >= 0 ? STATUS_COLORS.success : STATUS_COLORS.error,
                            }}
                          >
                            {p.margin >= 0 ? '+' : ''}
                            {p.margin.toFixed(2)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <div className="tbl-actions">
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm btn-icon"
                              aria-label="Visit product page"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                          <button
                            onClick={() => setProductModal(p)}
                            className="btn btn-ghost btn-sm"
                            aria-label={t('btn_edit')}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(p)}
                            className="btn btn-r btn-sm"
                            aria-label={t('btn_delete')}
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div>
          <p className="ptitle mb-2">Recent Orders</p>
          {recent_orders.length === 0 ? (
            <div className="text-center py-6 text-muted text-[12px]">No orders yet</div>
          ) : (
            <div className="flex flex-col">
              {recent_orders.map(o => {
                const sc = ORDER_STATUS_COLORS[o.status] || {
                  bg: STATUS_COLORS.neutralBg,
                  text: STATUS_COLORS.neutral,
                }
                return (
                  <div key={o.id} className="flex items-center justify-between py-2 border-b">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] px-[7px] py-[2px] rounded-[20px]"
                        style={{
                          background: sc.bg,
                          color: sc.text,
                        }}
                      >
                        {o.status}
                      </span>
                      {o.tracking_number && (
                        <span className="text-[10px] font-mono text-muted max-w-[100px] overflow-hidden text-ellipsis">
                          {o.tracking_number}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      {o.total_amount != null && (
                        <p className="text-[12px] text-muted m-0">${o.total_amount.toFixed(2)}</p>
                      )}
                      <p className="text-[10px] text-muted m-0">{o.created_at?.slice(0, 10)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {productModal === 'add' && (
        <ProductModal
          shopId={shopId}
          onSave={handleAddProduct}
          onClose={() => setProductModal(null)}
        />
      )}
      {productModal && productModal !== 'add' && (
        <ProductModal
          initial={productModal}
          shopId={shopId}
          onSave={handleEditProduct}
          onClose={() => setProductModal(null)}
        />
      )}
    </div>
  )
}

// ─── Main ShopList ────────────────────────────────────────────────────────

export default function ShopList({ onNavigate }) {
  const [shops, setShops] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [winLossMap, setWinLossMap] = useState({})
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()
  const { t } = useLang()

  // Virtualization setup - disable when any row is expanded
  const parentRef = useRef(null)
  const useVirtual = shops.length > 80 && expanded === null
  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? shops.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  })

  const load = useCallback(
    async (p = page, s = search) => {
      setLoading(true)
      try {
        const r = await invoke('get_shops', {
          page: p,
          perPage: DEFAULT_PAGE_SIZE,
          search: s || '',
        })
        setShops(r.items)
        setTotal(r.total)
      } catch (e) {
        const error = handleError(e, 'Shops.load')
        toast(getErrorMessage(error), 'error')
      } finally {
        setLoading(false)
      }
    },
    [page, search, toast]
  )

  useEffect(() => {
    load()
    // FIX FE-H05: Log shop win/loss errors instead of silently ignoring
    invoke('get_shop_win_loss')
      .then(rows => {
        const m = {}
        rows.forEach(r => {
          m[r.shop_id] = r
        })
        setWinLossMap(m)
      })
      .catch(e => console.error('[Shops] Failed to get shop win/loss:', e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentional: only run on mount, load is stable

  const handleCreate = async form => {
    await invoke('create_shop', { input: form })
    toast(t('shop_created'), 'success')
    load()
  }

  const handleEdit = async form => {
    await invoke('update_shop', { id: modal.id, input: form })
    toast(t('shop_updated'), 'success')
    load()
  }

  const handleDelete = async shop => {
    const ok = await confirm(t('shop_confirm_delete') + ` "${shop.name}"?`, { danger: true })
    if (!ok) return
    try {
      await invoke('delete_shop', { id: shop.id })
      toast(t('shop_deleted'), 'success')
      if (expanded === shop.id) setExpanded(null)
      load()
    } catch (e) {
      const error = handleError(e, 'Shops.handleDelete')
      toast(getErrorMessage(error), 'error')
    }
  }

  const openSite = shop => {
    const url = shop.url || `https://${shop.domain}`
    window.open(url, '_blank')
  }

  const totalPages = getTotalPages(total)

  // Aggregate stats for stat bar
  const totOrders = shops.reduce((s, x) => s + (x.total_orders ?? 0), 0)
  const totDelivered = shops.reduce((s, x) => s + (x.delivered ?? 0), 0)
  const totDeclined = shops.reduce((s, x) => s + (x.declined ?? 0), 0)

  return (
    <div className="content">
      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            <Store size={14} /> {t('shops')}{' '}
            <span className="text-muted text-[14px] font-normal">
              {total} {t('shops_count')}
            </span>
          </div>
        </div>
        <div className="ph-actions">
          <button onClick={() => load()} className="btn btn-ghost btn-sm" title={t('btn_refresh')}>
            {loading ? '⟳' : '↺'} {t('btn_refresh')}
          </button>
          <button onClick={() => setModal('new')} className="btn btn-b">
            + {t('new_shop')}
          </button>
        </div>
      </div>

      {/* Search + stat bar */}
      <div className="filters">
        <input
          className="search-box w-[260px]"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(1, search)}
          placeholder={t('shops_search_placeholder')}
        />

        {shops.length > 0 && (
          <>
            {[
              { label: 'shops', val: shops.length, color: STATUS_COLORS.info, type: 'info' },
              { label: 'orders', val: totOrders, color: 'var(--blue-t)', type: 'info' },
              {
                label: 'delivered',
                val: totDelivered,
                color: STATUS_COLORS.success,
                type: 'success',
              },
              { label: 'declined', val: totDeclined, color: STATUS_COLORS.error, type: 'error' },
            ].map(({ label, val, color }) => (
              <div key={label} className="stat-bar-item">
                <span className="stat-bar-dot" style={{ background: color }} />
                <span className="stat-bar-value" style={{ color }}>
                  {val}
                </span>
                <span className="text-[11px] text-muted">{label}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 p-[8px_12px] bg-card-hi border-hi rounded-md mb-2">
          <span className="text-[12px] text-text-2 font-semibold">{selected.size} selected</span>
          <button
            className="btn btn-r btn-sm"
            onClick={async () => {
              const ok = await confirm(`Delete ${selected.size} shops?`, { title: 'Delete Shops' })
              if (!ok) return
              try {
                for (const id of selected) {
                  await invoke('delete_shop', { id })
                }
                toast(`Deleted ${selected.size} shops`, 'success')
                setSelected(new Set())
                await load()
              } catch (e) {
                const error = handleError(e, 'Shops.handleToggleFlag')
                toast(getErrorMessage(error), 'error')
              }
            }}
          >
            Delete Selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      {loading && shops.length === 0 ? (
        <div className="panel p-0">
          <table className="tbl">
            <tbody>
              <SkeletonRows count={5} cols={9} />
            </tbody>
          </table>
        </div>
      ) : shops.length === 0 ? (
        <div className="panel text-center p-12">
          <Store size={36} className="mb-3 mx-auto opacity-20" />
          <p className="text-muted text-[13px] mb-[14px]">{t('no_shops')}</p>
          <button onClick={() => setModal('new')} className="btn btn-b">
            + Add your first shop
          </button>
        </div>
      ) : useVirtual ? (
        <div className="panel p-0 overflow-x-auto">
          <div ref={parentRef} className="h-[600px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={shops.length > 0 && selected.size === shops.length}
                      onChange={e =>
                        setSelected(e.target.checked ? new Set(shops.map(s => s.id)) : new Set())
                      }
                      className="cb"
                    />
                  </th>
                  <th className="w-8"></th>
                  <th>{t('col_shop_name')}</th>
                  <th>{t('col_name_domain').split(' / ')[1] || 'Domain'}</th>
                  <th>{t('col_category')}</th>
                  <th>{t('col_flags')}</th>
                  <th>{t('col_orders_count')}</th>
                  <th>{t('col_success_rate')}</th>
                  <th>{t('col_declined')}</th>
                  <th>{t('revenue')}</th>
                  <th>Risk</th>
                  <th>Delivery %</th>
                  <th>Exp. Value</th>
                  <th>{t('cc_col_actions')}</th>
                </tr>
              </thead>
            </table>
            <div className="relative" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const shop = shops[virtualRow.index]
                const successPct = shop.total_orders > 0 ? shop.success_rate : null
                const declinePct = shop.total_orders > 0 ? shop.decline_rate : null
                const successColor =
                  successPct === null
                    ? 'var(--muted)'
                    : successPct >= 60
                      ? STATUS_COLORS.success
                      : successPct < 30
                        ? STATUS_COLORS.error
                        : STATUS_COLORS.warning
                const declineColor =
                  declinePct !== null && declinePct > 50 ? STATUS_COLORS.error : 'var(--dim)'

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
                    <table className="tbl mb-0">
                      <tbody>
                        <tr className="cursor-pointer" onClick={() => setExpanded(shop.id)}>
                          <td onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.includes(shop.id)}
                              onChange={e =>
                                setSelected(prev => {
                                  const next = new Set(prev)
                                  e.target.checked ? next.add(shop.id) : next.delete(shop.id)
                                  return next
                                })
                              }
                              className="cb"
                            />
                          </td>
                          <td className="text-center text-muted text-[12px]">
                            <span>›</span>
                          </td>
                          <td>
                            <b className="text-[13px]">{shop.name}</b>
                          </td>
                          <td>
                            <span className="font-mono text-[11px] text-muted">{shop.domain}</span>
                          </td>
                          <td className="text-dim-or-muted">{shop.category || '—'}</td>
                          <td>
                            <FlagPills shop={shop} />
                          </td>
                          <td className="font-mono">{shop.total_orders}</td>
                          <td>
                            <span className="font-semibold" style={{ color: successColor }}>
                              {successPct !== null ? `${successPct.toFixed(1)}%` : '—'}
                            </span>
                          </td>
                          <td>
                            <span style={{ color: declineColor }}>
                              {declinePct !== null ? `${declinePct.toFixed(1)}%` : '—'}
                            </span>
                          </td>
                          <td className="font-mono">
                            {shop.avg_order_value > 0 ? `$${shop.avg_order_value.toFixed(2)}` : '—'}
                          </td>
                          <td>
                            <ShopRiskBadge shopId={shop.id} />
                          </td>
                          <td>
                            {(() => {
                              const wl = winLossMap[shop.id]
                              if (!wl) return <span className="text-muted">—</span>
                              const pct = wl.delivery_pct
                              const color = getDeliveryRateColor(pct)
                              return (
                                <span
                                  className="font-semibold text-[12px]"
                                  style={{ color }}
                                  title={pct < 30 ? 'Low delivery rate' : undefined}
                                >
                                  {pct.toFixed(1)}%{pct < 30 ? ' ⚠' : ''}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="mono text-[11px]">
                            {(() => {
                              const wl = winLossMap[shop.id]
                              if (!wl) return <span className="text-muted">—</span>
                              return (
                                <span className="text-text-2">${wl.expected_value.toFixed(2)}</span>
                              )
                            })()}
                          </td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="tbl-actions">
                              <button
                                onClick={() => openSite(shop)}
                                className="btn btn-ghost btn-sm btn-icon"
                                title="Visit site"
                                aria-label="Visit shop website"
                              >
                                <ExternalLink size={12} />
                              </button>
                              <button
                                onClick={() => setModal(shop)}
                                className="btn btn-ghost btn-sm"
                                aria-label={t('btn_edit')}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(shop)}
                                className="btn btn-r btn-sm"
                                aria-label={t('btn_delete')}
                              >
                                Del
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
        </div>
      ) : (
        <div className="panel p-0 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={shops.length > 0 && selected.size === shops.length}
                    onChange={e =>
                      setSelected(e.target.checked ? new Set(shops.map(s => s.id)) : new Set())
                    }
                    className="cb"
                  />
                </th>
                <th className="w-8"></th>
                <th>{t('col_shop_name')}</th>
                <th>{t('col_name_domain').split(' / ')[1] || 'Domain'}</th>
                <th>{t('col_category')}</th>
                <th>{t('col_flags')}</th>
                <th>{t('col_orders_count')}</th>
                <th>{t('col_success_rate')}</th>
                <th>{t('col_declined')}</th>
                <th>{t('revenue')}</th>
                <th>Risk</th>
                <th>Delivery %</th>
                <th>Exp. Value</th>
                <th>{t('cc_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shops.map(shop => {
                const isExpanded = expanded === shop.id
                const successPct = shop.total_orders > 0 ? shop.success_rate : null
                const declinePct = shop.total_orders > 0 ? shop.decline_rate : null
                const successColor =
                  successPct === null
                    ? 'var(--muted)'
                    : successPct >= 60
                      ? STATUS_COLORS.success
                      : successPct < 30
                        ? STATUS_COLORS.error
                        : STATUS_COLORS.warning
                const declineColor =
                  declinePct !== null && declinePct > 50 ? STATUS_COLORS.error : 'var(--dim)'

                return (
                  <React.Fragment key={shop.id}>
                    <tr
                      className={`cursor-pointer ${isExpanded ? 'row-expanded' : ''}`}
                      onClick={() => setExpanded(isExpanded ? null : shop.id)}
                    >
                      <td onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.includes(shop.id)}
                          onChange={e =>
                            setSelected(prev => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(shop.id) : next.delete(shop.id)
                              return next
                            })
                          }
                          className="cb"
                        />
                      </td>
                      <td className="text-center text-muted text-[12px]">
                        <span
                          className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : 'rotate-0'}`}
                        >
                          ›
                        </span>
                      </td>
                      <td>
                        <b className="text-[13px]">{shop.name}</b>
                      </td>
                      <td>
                        <span className="font-mono text-[11px] text-muted">{shop.domain}</span>
                      </td>
                      <td className={shop.category ? 'text-dim' : 'text-muted'}>
                        {shop.category || '—'}
                      </td>
                      <td>
                        <FlagPills shop={shop} />
                      </td>
                      <td className="font-mono">{shop.total_orders}</td>
                      <td>
                        <span className="font-semibold" style={{ color: successColor }}>
                          {successPct !== null ? `${successPct.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: declineColor }}>
                          {declinePct !== null ? `${declinePct.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="font-mono">
                        {shop.avg_order_value > 0 ? `$${shop.avg_order_value.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <ShopRiskBadge shopId={shop.id} />
                      </td>
                      <td>
                        {(() => {
                          const wl = winLossMap[shop.id]
                          if (!wl) return <span className="text-muted">—</span>
                          const pct = wl.delivery_pct
                          const color = getDeliveryRateColor(pct)
                          return (
                            <span
                              className="font-semibold text-[12px]"
                              style={{ color }}
                              title={pct < 30 ? 'Low delivery rate' : undefined}
                            >
                              {pct.toFixed(1)}%{pct < 30 ? ' ⚠' : ''}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="mono text-[11px]">
                        {(() => {
                          const wl = winLossMap[shop.id]
                          if (!wl) return <span className="text-muted">—</span>
                          return (
                            <span className="text-text-2">${wl.expected_value.toFixed(2)}</span>
                          )
                        })()}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="tbl-actions">
                          <button
                            onClick={() => openSite(shop)}
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Visit site"
                            aria-label="Visit shop website"
                          >
                            <ExternalLink size={12} />
                          </button>
                          <button
                            onClick={() => setModal(shop)}
                            className="btn btn-ghost btn-sm"
                            aria-label={t('btn_edit')}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(shop)}
                            className="btn btn-r btn-sm"
                            aria-label={t('btn_delete')}
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${shop.id}-detail`}>
                        <td colSpan={14} className="p-0">
                          <ShopDetailPanel
                            shopId={shop.id}
                            onRefresh={load}
                            onNavigate={onNavigate}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>
            {t('pag_showing')} {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const np = Math.max(1, page - 1)
                setPage(np)
                load(np, search)
              }}
              disabled={page === 1}
            >
              {t('pag_prev')}
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => {
                  setPage(p)
                  load(p, search)
                }}
                className={p === page ? 'btn btn-page-active btn-sm' : 'btn btn-ghost btn-sm'}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const np = Math.min(totalPages, page + 1)
                setPage(np)
                load(np, search)
              }}
              disabled={page >= totalPages}
            >
              {t('pag_next')}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === 'new' && <ShopModal onSave={handleCreate} onClose={() => setModal(null)} />}
      {modal && modal !== 'new' && (
        <ShopModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// ─── Export SmartSuggestions hook for use in Orders ───────────────────────

/**
 * Hook for smart shop/card suggestions
 */
// eslint-disable-next-line react-refresh/only-export-components -- Shared hook for Orders page
export function useSmartSuggestions(shopId, cardId) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shopId || !cardId) {
      return
    }

    let cancelled = false

    // Set loading state asynchronously to avoid cascading renders warning
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true)
    })

    invoke('get_shop_smart_suggestions', { shopId, cardId })
      .then(data => {
        if (!cancelled) setSuggestions(data)
      })
      .catch(() => {
        if (!cancelled) setSuggestions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [shopId, cardId])

  return { suggestions, loading }
}

export { SuggestionBadge }
