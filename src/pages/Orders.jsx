import { useState, useEffect, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { invoke } from '@tauri-apps/api/core'
import {
  ShoppingCart,
  Plus,
  X,
  ChevronDown,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Truck,
  Package,
  Sparkles,
  Save,
  FolderOpen,
  AlertCircle,
  Wifi,
  RotateCcw,
  Upload,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import { useDebounce } from '../hooks/useDebounce.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { useSmartSuggestions, SuggestionBadge } from './Shops'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { buildPageNumbers, DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { STATUS_COLORS } from '../constants/colors.js'
import { ORDER_STATUS_STEPS, ORDER_STATUSES, ORDER_STATUS_DOT_COLORS } from '../constants/status.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { BatchImportModal } from './Orders/BatchImportModal.jsx'
import { OrderFilters } from './Orders/OrderFilters.jsx'
import { OrderRow } from './Orders/OrderRow.jsx'
import { useOrdersStore } from '../store/orders.js'

// ─── OrderTimeline ────────────────────────────────────────────

function OrderTimeline({ status, updatedAt }) {
  const isTerminal = status === 'cancelled' || status === 'declined'
  const steps = isTerminal ? [...ORDER_STATUS_STEPS.slice(0, 2), status] : ORDER_STATUS_STEPS
  const currentIdx = steps.indexOf(status)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const isPast = i < currentIdx
          const isCurrent = i === currentIdx
          const isFuture = i > currentIdx
          const color = isCurrent
            ? status === 'delivered'
              ? 'var(--green)'
              : status === 'declined' || status === 'cancelled'
                ? 'var(--red)'
                : 'var(--blue)'
            : isPast
              ? 'var(--green)'
              : 'var(--border)'
          const glowColor = isCurrent
            ? status === 'delivered'
              ? `${STATUS_COLORS.success}80`
              : status === 'declined' || status === 'cancelled'
                ? `${STATUS_COLORS.error}80`
                : `${STATUS_COLORS.info}80`
            : 'none'
          return (
            <div
              key={step}
              className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : 'flex-0'}`}
            >
              <div className="flex flex-col items-center gap-0\.5">
                <div
                  className={`rounded-full shrink-0 transition-all duration-200 timeline-status-dot ${
                    isCurrent ? 'timeline-status-dot-current' : ''
                  } ${
                    isCurrent && status === 'delivered' ? 'timeline-status-dot-glow-green' : ''
                  } ${
                    isCurrent && (status === 'declined' || status === 'cancelled')
                      ? 'timeline-status-dot-glow-red'
                      : ''
                  } ${isCurrent && status !== 'delivered' && status !== 'declined' && status !== 'cancelled' && status !== 'pending' ? 'timeline-status-dot-glow-blue' : ''}`}
                  style={{
                    background: color,
                    boxShadow: isCurrent ? `0 0 0 3px ${glowColor}, 0 0 12px ${glowColor}` : 'none',
                  }}
                />
                <span
                  className={`text-[10px] whitespace-nowrap ${isFuture ? 'text-muted' : 'text-text-2'} ${isCurrent ? 'font-semibold' : 'font-normal'}`}
                >
                  {step}
                </span>
                {isCurrent && updatedAt && (
                  <span className="text-[9px] text-muted whitespace-nowrap">
                    {updatedAt.slice(0, 10)}
                  </span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`flex-1 rounded-sm mx-1.5 mb-4 min-w-[40px] timeline-connector ${
                    isPast ? 'timeline-connector-past' : 'timeline-connector-pending'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Risk Check display ───────────────────────────────────────
function RiskBlock({ result, loading }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border text-[12px] text-muted">
        <div className="rounded-full shrink-0 w-3 h-3 border-[1.5px] border-border-hi border-t-text-2 animate-spin" />
        {t('risk_checking')}
      </div>
    )
  }
  if (!result) return null

  const config = {
    safe: {
      borderColor: `${STATUS_COLORS.success}33`,
      bg: `${STATUS_COLORS.success}0D`,
      iconColor: STATUS_COLORS.success,
      label: t('risk_safe'),
      textColor: STATUS_COLORS.success,
    },
    warning: {
      borderColor: `${STATUS_COLORS.warning}33`,
      bg: `${STATUS_COLORS.warning}0D`,
      iconColor: STATUS_COLORS.warning,
      label:
        t('risk_warning') +
        ': ' +
        result.score +
        ' ' +
        (result.score !== 1 ? t('risk_issues') : t('risk_issue')),
      textColor: STATUS_COLORS.warning,
    },
    high_risk: {
      borderColor: `${STATUS_COLORS.error}33`,
      bg: `${STATUS_COLORS.error}0D`,
      iconColor: STATUS_COLORS.error,
      label:
        t('risk_high') +
        ': ' +
        result.score +
        ' ' +
        (result.score !== 1 ? t('risk_issues') : t('risk_issue')),
      textColor: STATUS_COLORS.error,
    },
  }
  const c = config[result.level] || config.safe

  const IconComponent =
    result.level === 'safe'
      ? CheckCircle2
      : result.level === 'high_risk'
        ? ShieldAlert
        : AlertTriangle

  return (
    <div
      className={`rounded-lg overflow-hidden risk-block ${
        result.level === 'safe'
          ? 'risk-block-safe'
          : result.level === 'high_risk'
            ? 'risk-block-high-risk'
            : 'risk-block-warning'
      }`}
    >
      <button
        onClick={() => result.warnings?.length && setOpen(o => !o)}
        className={`flex items-center justify-between w-full px-3 py-2 text-[12px] bg-transparent border-none text-text ${
          result.warnings?.length ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-2">
          <IconComponent
            size={14}
            className={`risk-icon ${
              result.level === 'safe'
                ? 'risk-icon-safe'
                : result.level === 'high_risk'
                  ? 'risk-icon-high-risk'
                  : 'risk-icon-warning'
            }`}
          />
          <span
            className={`font-medium ${
              result.level === 'safe'
                ? 'risk-text-safe'
                : result.level === 'high_risk'
                  ? 'risk-text-high-risk'
                  : 'risk-text-warning'
            }`}
          >
            {c.label}
          </span>
          {result.offline && (
            <span className="flex items-center gap-1 text-[11px] risk-offline-text">
              <Wifi size={11} /> {t('license_offline')}
            </span>
          )}
        </div>
        {result.warnings?.length > 0 && (
          <ChevronDown
            size={13}
            className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {open && result.warnings?.length > 0 && (
        <div className="border-t border-border">
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 px-3 py-2 text-[12px] ${
                i < result.warnings.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              {w.severity === 'high' ? (
                <AlertTriangle size={11} className="shrink-0 mt-0.5 risk-icon-high-risk" />
              ) : (
                <AlertCircle size={11} className="shrink-0 mt-0.5 risk-icon-warning" />
              )}
              <span className="text-text-2">{w.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ShippedModal ─────────────────────────────────────────────
function ShippedModal({ onConfirm, onClose }) {
  const { t } = useLang()
  const [track, setTrack] = useState('')
  const [carrier, setCarrier] = useState('')
  const modalRef = useRef(null)
  useFocusTrap(modalRef, true)
  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipped-modal-title"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-blue-t" />
            <span id="shipped-modal-title" className="modal-title m-0">
              {t('order_mark_shipped')}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">{t('tracking_number')}</label>
          <input
            value={track}
            onChange={e => setTrack(e.target.value)}
            placeholder="1Z999AA10123456784"
            className="form-input font-mono"
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('carrier')}</label>
          <input
            value={carrier}
            onChange={e => setCarrier(e.target.value)}
            placeholder="UPS, FedEx, USPS…"
            className="form-input"
          />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={() => onConfirm({ tracking_number: track || null, carrier: carrier || null })}
            className="btn btn-b btn-sm flex-1"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── StatusMenu ───────────────────────────────────────────────
function StatusMenu({ order, onUpdate, onClose }) {
  const { t } = useLang()
  const [showShippedModal, setShowShippedModal] = useState(false)
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const handleStatus = async status => {
    if (status === 'shipped') {
      setShowShippedModal(true)
      return
    }
    if (status === 'declined' || status === 'cancelled') {
      const markDead = await confirm(
        status === 'declined'
          ? t('confirm_mark_card_dead')
          : 'Order cancelled. Mark the card as dead?',
        {
          confirmLabel: t('confirm_mark_dead_confirm') || 'Mark as Dead',
          cancelLabel: t('confirm_mark_dead_cancel') || 'Keep',
        }
      )
      try {
        await invoke('update_order_status', { id: order.id, status, meta: null })
        if (markDead && order.card_id != null)
          await invoke('update_card_status', { id: order.card_id, status: 'dead' })
        toast(t('status_updated'), 'success')
        onUpdate()
        onClose()
      } catch (e) {
        const error = handleError(e, 'OrderModal.handleUpdate')
        toast(getErrorMessage(error), 'error')
      }
      return
    }
    try {
      await invoke('update_order_status', { id: order.id, status, meta: null })
      toast(t('status_updated'), 'success')
      onUpdate()
      onClose()
    } catch (e) {
      const error = handleError(e, 'Orders.handleStatusChange')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleShipped = async meta => {
    try {
      await invoke('update_order_status', { id: order.id, status: 'shipped', meta })
      toast(t('order_marked_shipped'), 'success')
      onUpdate()
      onClose()
    } catch (e) {
      const error = handleError(e, 'Orders.handleShipped')
      toast(getErrorMessage(error), 'error')
    }
  }

  return (
    <>
      <div className="absolute bg-card border rounded-lg overflow-hidden right-0 top-8 z-30 shadow-dropdown w-40">
        {ORDER_STATUSES.filter(s => s !== order.status).map(s => (
          <button
            key={s}
            onClick={() => handleStatus(s)}
            className="w-full text-left px-3 py-2 text-[12px] text-text-2 bg-transparent border-none cursor-pointer flex items-center gap-2"
          >
            <span
              className="status-menu-dot rounded-full shrink-0"
              style={{
                backgroundColor: ORDER_STATUS_DOT_COLORS[s] ?? 'var(--text-2)',
              }}
            />
            {s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>
      {showShippedModal && (
        <ShippedModal onConfirm={handleShipped} onClose={() => setShowShippedModal(false)} />
      )}
    </>
  )
}

// ─── E1: RepeatOrderModal ─────────────────────────────────────
function RepeatOrderModal({ order, onCreated, onClose }) {
  const { t } = useLang()
  const { toast } = useToast()
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(
    order.profile_id ? String(order.profile_id) : ''
  )
  const [loading, setLoading] = useState(false)
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const modalRef = useRef(null)
  useFocusTrap(modalRef, true)

  useEffect(() => {
    invoke('get_profiles', { filter: {}, page: 1, perPage: 200 })
      .then(r => setProfiles(r.items || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoadingProfiles(false))
  }, [])

  const handleRepeat = async () => {
    if (!selectedProfileId) {
      toast('Select a profile', 'warn')
      return
    }
    setLoading(true)
    try {
      await invoke('create_order', {
        input: {
          profile_id: parseInt(selectedProfileId),
          shop_id: order.shop_id,
          drop_id: order.drop_id ?? null,
          email_pool_id: order.email_pool_id ?? null,
          proxy_id: order.proxy_id ?? null,
          order_number: null,
          notes: order.notes ?? null,
          items: order.items ?? [],
        },
      })
      toast('Order repeated successfully', 'success')
      onCreated()
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  const shopLabel = order.shop_name || `Shop #${order.shop_id}`
  const itemLabel =
    order.items?.length > 0
      ? order.items
          .map(i => i.name)
          .filter(Boolean)
          .join(', ')
      : (order.item_name ?? '—')

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal w-modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-order-title"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <RotateCcw size={15} className="text-blue-t" />
            <span id="repeat-order-title" className="modal-title m-0">
              Repeat Order
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="text-[13px] text-text-2 mb-4 leading-normal">
          Repeat order for <strong className="text-text">{shopLabel}</strong>
          {itemLabel !== '—' && (
            <>
              {' '}
              — <span className="text-muted">{itemLabel}</span>
            </>
          )}
          ?
        </div>

        <div className="form-group">
          <label className="form-label">Select Profile</label>
          {loadingProfiles ? (
            <div className="text-[12px] text-muted py-2">Loading profiles…</div>
          ) : (
            <select
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              className="inline-select w-full"
            >
              <option value="">— Select profile —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.holder_masked || '—'} ···{p.last4 || '????'}
                  {p.bank_name ? ` (${p.bank_name})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={handleRepeat}
            disabled={loading || !selectedProfileId}
            className={`btn btn-b btn-sm flex-1 ${loading || !selectedProfileId ? 'opacity-40' : ''}`}
          >
            {loading ? 'Creating…' : 'Repeat Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CreateOrder modal ────────────────────────────────────────
const EMPTY_ITEM = { name: '', sku: '', qty: 1, price: '' }

function CreateOrderModal({ onCreated, onClose }) {
  const { t } = useLang()
  // Step state
  const [profileId, setProfileId] = useState('')
  const [profileDetail, setProfileDetail] = useState(null)
  const [shopId, setShopId] = useState(null)
  const [shopObj, setShopObj] = useState(null)
  const [shopSearch, setShopSearch] = useState('')
  const [shopResults, setShopResults] = useState([])
  const [dropId, setDropId] = useState(null)
  const [emailId, setEmailId] = useState(null)
  const [emails, setEmails] = useState([])
  const [proxyId, setProxyId] = useState(null)
  const [proxies, setProxies] = useState([])
  const [orderNumber, setOrderNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [riskResult, setRiskResult] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [templates, setTemplates] = useState([])
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [loading, setLoading] = useState(false)
  const [itemSuggestions, setItemSuggestions] = useState({}) // {idx: [{id,name,asin,price}]}
  const [activeItemIdx, setActiveItemIdx] = useState(null)
  const [customEmail, setCustomEmail] = useState('')
  const [emailMode, setEmailMode] = useState('pool') // "pool" | "custom"
  const [profileSearch, setProfileSearch] = useState('')
  const [profileResults, setProfileResults] = useState([])

  const { toast } = useToast()
  const { suggestions: smartSuggs } = useSmartSuggestions(shopId, profileDetail?.card?.id)

  // ── Profile search ──
  const searchProfiles = useCallback(async q => {
    try {
      const r = await invoke('get_profiles', {
        filter: { search: q || null, has_drop: true },
        page: 1,
        perPage: 20,
      })
      setProfileResults(r.items || [])
    } catch {
      setProfileResults([])
    }
  }, [])

  useEffect(() => {
    searchProfiles(profileSearch)
  }, [profileSearch, searchProfiles])

  const selectProfile = async p => {
    setProfileId(p.id)
    setProfileSearch(`${p.holder_masked || '—'} ···${p.last4 || '????'}`)
    setProfileResults([])
    try {
      const d = await invoke('get_profile_detail', { id: p.id })
      setProfileDetail(d)
      // Default to primary drop
      const primary = d.drops?.find(dd => dd.is_primary) || d.drops?.[0]
      if (primary) setDropId(primary.id)
    } catch {
      setProfileDetail(null)
    }
  }

  // ── Shop search ──
  const searchShops = useCallback(async q => {
    if (!q.trim()) {
      setShopResults([])
      return
    }
    try {
      const [local, catalog] = await Promise.all([
        invoke('get_shops', { page: 1, perPage: 8, search: q })
          .then(r => r.items || [])
          .catch(() => []),
        invoke('search_catalog_shops', { q, limit: 6 })
          .then(r => r.map(s => ({ ...s, _fromCatalog: true })))
          .catch(() => []),
      ])
      // Merge: local first, then catalog items not already in local
      const localDomains = new Set(local.map(s => s.domain))
      const merged = [...local, ...catalog.filter(s => !localDomains.has(s.domain))]
      setShopResults(merged)
    } catch {
      setShopResults([])
    }
  }, [])

  const searchCatalogItems = useCallback(async (q, idx) => {
    if (!q || q.length < 2) {
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
      return
    }
    try {
      const results = await invoke('search_catalog_items', { q, limit: 8 })
      setItemSuggestions(p => ({ ...p, [idx]: results }))
    } catch {
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
    }
  }, [])

  useEffect(() => {
    searchShops(shopSearch)
  }, [shopSearch, searchShops])

  const selectShop = async s => {
    if (s._fromCatalog) {
      // Quick-create local shop from catalog data
      try {
        const created = await invoke('create_shop', {
          input: {
            name: s.domain,
            url: `https://${s.domain}`,
            category: s.category || '',
            notes: s.top_products ? `Top products: ${s.top_products}` : '',
            requires_cvv_match: false,
            blocks_vpn: false,
            phone_must_match: false,
            accepts_amex: false,
            requires_avs: false,
            high_cancel_risk: false,
          },
        })
        setShopId(created.id)
        setShopObj(created)
        setShopSearch(created.domain)
      } catch {
        // Fallback: create shop with minimal info
        try {
          const created = await invoke('create_shop', {
            input: {
              name: s.domain,
              url: `https://${s.domain}`,
              category: '',
              notes: '',
              requires_cvv_match: false,
              blocks_vpn: false,
              phone_must_match: false,
              accepts_amex: false,
              requires_avs: false,
              high_cancel_risk: false,
            },
          })
          setShopId(created.id)
          setShopObj(created)
          setShopSearch(created.domain)
        } catch {
          /* ignore */
        }
      }
      setShopResults([])
      return
    }
    setShopId(s.id)
    setShopObj(s)
    setShopSearch(s.name || s.domain)
    setShopResults([])
    try {
      const [em, px, tmpl] = await Promise.all([
        invoke('get_emails', { filter: {}, page: 1, perPage: 100 }),
        invoke('get_proxies', { filter: {}, page: 1, perPage: 100 }),
        invoke('get_order_templates', { shopTag: s.domain }),
      ])
      setEmails(em.items || [])
      setProxies(px.items || [])
      setTemplates(tmpl || [])
    } catch {
      /* non-fatal */
    }
  }

  // ── Risk check ──
  useEffect(() => {
    if (!profileId || !shopId || !dropId) {
      setRiskResult(null)
      return
    }
    const timer = setTimeout(async () => {
      setRiskLoading(true)
      try {
        const r = await invoke('run_risk_check', {
          profileId,
          shopId,
          dropId,
          emailPoolId: emailId || null,
          proxyId: proxyId || null,
        })
        setRiskResult(r)
      } catch {
        setRiskResult({ level: 'safe', score: 0, warnings: [], offline: true })
      } finally {
        setRiskLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [profileId, shopId, dropId, emailId, proxyId])

  // ── Items ──
  const total = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0), 0)
  const setItem = (idx, key, val) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)))
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }])
  const removeItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))

  // ── Template ──
  const loadTemplate = tmpl => {
    try {
      const parsed = JSON.parse(tmpl.items_json)
      setItems(parsed.map(it => ({ ...it, price: String(it.price) })))
    } catch {
      toast(t('template_invalid'), 'error')
    }
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return
    try {
      await invoke('save_order_template', {
        input: {
          name: templateName,
          shop_tag: shopObj?.domain || null,
          items_json: JSON.stringify(items),
        },
      })
      toast('Template saved', 'success')
      setShowSaveTemplate(false)
      setTemplateName('')
    } catch (e) {
      const error = handleError(e, 'Orders.handleSaveTemplate')
      toast(getErrorMessage(error), 'error')
    }
  }

  // ── Submit ──
  const handleCreate = async () => {
    if (!profileId || !shopId || !dropId) {
      toast('Profile, shop and drop are required', 'warn')
      return
    }
    setLoading(true)
    try {
      const itemsPayload = items
        .filter(i => i.name.trim())
        .map(i => ({
          name: i.name,
          sku: i.sku,
          qty: parseInt(i.qty) || 1,
          price: parseFloat(i.price) || 0,
        }))

      const notesWithEmail =
        emailMode === 'custom' && customEmail
          ? `Email: ${customEmail}${notes ? `\n${notes}` : ''}`
          : notes
      await invoke('create_order', {
        input: {
          profile_id: profileId,
          shop_id: shopId,
          drop_id: dropId,
          email_pool_id: emailMode === 'pool' ? emailId || null : null,
          proxy_id: proxyId || null,
          order_number: orderNumber || null,
          notes: notesWithEmail || null,
          items: itemsPayload,
        },
      })
      toast('Order created', 'success')
      onCreated()
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  const FLAGS = [
    {
      key: 'requires_cvv_match',
      label: t('flag_cvv_match'),
      color: { color: STATUS_COLORS.info, background: STATUS_COLORS.infoBg },
    },
    {
      key: 'blocks_vpn',
      label: t('flag_blocks_vpn'),
      color: { color: STATUS_COLORS.error, background: STATUS_COLORS.errorBg },
    },
    {
      key: 'phone_must_match',
      label: t('flag_phone_match'),
      color: { color: 'var(--yellow-t)', background: 'var(--color-warning-bg)' },
    },
    {
      key: 'requires_avs',
      label: 'AVS',
      color: { color: STATUS_COLORS.info, background: 'var(--color-info-bg)' },
    },
    {
      key: 'high_cancel_risk',
      label: t('flag_cancel_risk'),
      color: { color: 'var(--orange)', background: 'var(--color-warning-bg)' },
    },
  ]

  const drops = profileDetail?.drops || []
  const primaryDrop = drops.find(d => d.is_primary) || drops[0]

  const createModalRef = useRef(null)
  useFocusTrap(createModalRef, true)

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay items-start overflow-y-auto py-6">
      <div
        ref={createModalRef}
        className="modal w-modal-lg m-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-order-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-card z-10 rounded-t-xl">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-blue-t" />
            <span id="create-order-title" className="font-semibold text-text">
              {t('create_order')}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* ── 1. Profile ── */}
          <div>
            <label className="form-label">1. Profile *</label>
            <div className="relative">
              <input
                value={profileSearch}
                onChange={e => {
                  setProfileSearch(e.target.value)
                  setProfileId('')
                  setProfileDetail(null)
                }}
                placeholder={t('orders_holder_search_placeholder')}
                className="form-input"
              />
              {profileResults.length > 0 && (
                <div className="dropdown-results">
                  {profileResults.map(p => (
                    <button key={p.id} onClick={() => selectProfile(p)} className="dropdown-btn">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-text">{p.holder_masked || '—'}</span>
                        <div className="flex items-center gap-2 text-[12px] text-muted">
                          <span className="font-mono">···{p.last4}</span>
                          <span>{p.bank_name || ''}</span>
                          <span
                            className={p.drop_count > 0 ? 'drop-count-safe' : 'drop-count-warning'}
                          >
                            {p.drop_count} drop{p.drop_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Profile card */}
            {profileDetail && (
              <div className="info-card">
                <div>
                  <div className="text-muted mb-0.5">Card</div>
                  <div className="text-text mono">
                    ···{profileDetail.profile.last4 || profileDetail.card?.last4}
                  </div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">Bank</div>
                  <div className="text-text">{profileDetail.card?.bank_name || '—'}</div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">{t('primary_drop')}</div>
                  <div className="text-text text-truncate">
                    {primaryDrop
                      ? `${primaryDrop.city}, ${primaryDrop.country}`
                      : t('profile_no_drop')}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Shop ── */}
          <div>
            <label className="form-label">2. Shop *</label>
            <div className="relative">
              <input
                value={shopSearch}
                onChange={e => {
                  setShopSearch(e.target.value)
                  setShopId(null)
                  setShopObj(null)
                }}
                placeholder={t('orders_shop_search_placeholder')}
                className="form-input"
              />
              {shopResults.length > 0 && (
                <div className="dropdown-results">
                  {shopResults.map(s => (
                    <button
                      key={s._fromCatalog ? `cat-${s.id}` : s.id}
                      onClick={() => selectShop(s)}
                      className="dropdown-btn"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-text">{s.name || s.domain}</span>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          {s._fromCatalog && <span className="badge-catalog">catalog</span>}
                          {s.domain && !s._fromCatalog && <span className="mono">{s.domain}</span>}
                          {s.score > 0 && (
                            <span className={s.score >= 60 ? 'score-good' : 'score-warning'}>
                              ★{s.score}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Shop flags + smart suggestions */}
            {shopObj && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {FLAGS.filter(f => shopObj[f.key]).map(f => (
                    <span
                      key={f.key}
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 999,
                        ...f.color,
                      }}
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
                {smartSuggs?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted">
                      <Sparkles size={11} /> Smart Suggestions
                    </div>
                    {smartSuggs.map((s, i) => (
                      <SuggestionBadge key={i} s={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 3. Drop ── */}
          {drops.length > 0 && (
            <div>
              <label className="form-label">3. Shipping Address</label>
              <div className="flex flex-col gap-1.5">
                {drops.map(d => (
                  <label
                    key={d.id}
                    onClick={() => setDropId(d.id)}
                    className={`radio-label ${dropId === d.id ? 'selected' : ''}`}
                  >
                    <div className={`radio-circle ${dropId === d.id ? 'selected' : ''}`}>
                      {dropId === d.id && <div className="radio-dot" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="text-text font-medium">{d.recipient_name}</span>
                        {d.is_primary && <span className="badge-primary">primary</span>}
                      </div>
                      <div className="text-[11px] text-muted">
                        {d.address}, {d.city}
                        {d.state ? `, ${d.state}` : ''} {d.zip}, {d.country}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── 4+5. Email + Proxy ── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">4. Email (optional)</label>
              <div className="flex flex-col gap-1">
                <div className="flex gap-1">
                  <button
                    onClick={() => setEmailMode('pool')}
                    className={`mode-toggle-btn ${emailMode === 'pool' ? 'active' : ''}`}
                  >
                    Pool
                  </button>
                  <button
                    onClick={() => setEmailMode('custom')}
                    className={`mode-toggle-btn ${emailMode === 'custom' ? 'active' : ''}`}
                  >
                    Custom
                  </button>
                </div>
                {emailMode === 'pool' ? (
                  <select
                    value={emailId || ''}
                    onChange={e => setEmailId(e.target.value ? parseInt(e.target.value) : null)}
                    className="inline-select w-full"
                  >
                    <option value="">— None —</option>
                    {emails.map(em => {
                      const usedHere = em.shops_used?.some(s => s.id === shopId)
                      return (
                        <option key={em.id} value={em.id} disabled={em.is_blocked}>
                          {em.is_blocked ? '⛔' : usedHere ? '⚠' : '✓'} {em.email}{' '}
                          {em.label ? `(${em.label})` : ''}
                        </option>
                      )
                    })}
                  </select>
                ) : (
                  <input
                    type="email"
                    value={customEmail}
                    onChange={e => setCustomEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="form-input p-[8px_12px] text-[13px]"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="form-label">5. Proxy (optional)</label>
              <select
                value={proxyId || ''}
                onChange={e => setProxyId(e.target.value ? parseInt(e.target.value) : null)}
                className="inline-select w-full"
              >
                <option value="">— None —</option>
                {proxies.map(px => {
                  const usedHere = px.shops_used?.some(s => s.id === shopId)
                  return (
                    <option key={px.id} value={px.id} disabled={px.is_blocked}>
                      {px.is_blocked ? '🔴' : usedHere ? '⚠️' : '✓'}{' '}
                      {px.label || `${px.host}:${px.port}`} ({px.proxy_type.toUpperCase()})
                    </option>
                  )
                })}
              </select>
              {/* G3: Geo-match hint — show recommended proxies matching profile billing country */}
              {(() => {
                const billingCountry =
                  profileDetail?.profile?.country || profileDetail?.card?.country
                if (!billingCountry || proxies.length === 0) return null
                const geoMatches = proxies.filter(
                  px =>
                    !px.is_blocked &&
                    px.country &&
                    px.country.toUpperCase() === billingCountry.toUpperCase()
                )
                if (geoMatches.length === 0) return null
                return (
                  <div className="info-hint-box">
                    <div className="text-info-bold">
                      🎯 {billingCountry.toUpperCase()} proxy recommended for this profile
                    </div>
                    {geoMatches.slice(0, 3).map(px => (
                      <div key={px.id} className="text-muted mono">
                        {px.label || `${px.host}:${px.port}`}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* ── 6. Risk Check ── */}
          <div>
            <label className="form-label">6. Risk Check</label>
            <RiskBlock result={riskResult} loading={riskLoading} />
          </div>

          {/* ── 7. Order number ── */}
          <div>
            <label className="form-label">7. Order Number (optional)</label>
            <input
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              placeholder="ORD-12345"
              className="form-input mono"
            />
          </div>

          {/* ── 8. Items ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">8. Items</label>
              <div className="flex items-center gap-2">
                {/* Load template */}
                {templates.length > 0 && (
                  <div className="relative template-group">
                    <button className="flex items-center gap-1 text-[12px] text-muted bg-transparent border-none cursor-pointer">
                      <FolderOpen size={12} /> Templates
                    </button>
                    <div className="template-dropdown-menu">
                      {templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => loadTemplate(t)}
                          className="template-dropdown-item"
                        >
                          {t.name}
                          {t.shop_tag && <span className="text-muted ml-1">({t.shop_tag})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setShowSaveTemplate(true)}
                  className="flex items-center gap-1 text-[12px] text-muted bg-transparent border-none cursor-pointer"
                >
                  <Save size={12} /> Save Template
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid gap-2 items-center grid-items-layout">
                  <div className="relative">
                    <input
                      value={item.name}
                      onChange={e => {
                        setItem(idx, 'name', e.target.value)
                        setActiveItemIdx(idx)
                        searchCatalogItems(e.target.value, idx)
                      }}
                      onBlur={() =>
                        setTimeout(() => {
                          setItemSuggestions(p => ({ ...p, [idx]: [] }))
                          setActiveItemIdx(null)
                        }, 200)
                      }
                      placeholder={t('item_name')}
                      className="form-input-sm"
                    />
                    {activeItemIdx === idx && (itemSuggestions[idx] || []).length > 0 && (
                      <div className="dropdown-results-sm">
                        {(itemSuggestions[idx] || []).map(ci => (
                          <button
                            key={ci.id}
                            onMouseDown={() => {
                              setItem(idx, 'name', ci.name)
                              if (ci.asin) setItem(idx, 'sku', ci.asin)
                              if (ci.price) setItem(idx, 'price', String(ci.price))
                              setItemSuggestions(p => ({ ...p, [idx]: [] }))
                            }}
                            className="dropdown-btn-sm flex justify-between items-center"
                          >
                            <span className="text-[12px] text-text text-truncate flex-1 mr-2">
                              {ci.name}
                            </span>
                            <div className="flex gap-1.5 items-center shrink-0">
                              {ci.asin && (
                                <span className="text-[10px] mono text-muted">{ci.asin}</span>
                              )}
                              {ci.price && (
                                <span className="text-[11px] text-green-t">${ci.price}</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    value={item.sku}
                    onChange={e => setItem(idx, 'sku', e.target.value)}
                    placeholder="SKU"
                    className="form-input-sm mono"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={e => setItem(idx, 'qty', e.target.value)}
                    placeholder="Qty"
                    className="form-input-sm mono"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={item.price}
                    onChange={e => setItem(idx, 'price', e.target.value)}
                    placeholder="$0.00"
                    className="form-input-sm mono"
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    className={items.length === 1 ? 'btn-opacity-disabled' : 'btn-opacity-normal'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addItem} className="btn-text-info">
                <Plus size={12} /> Add Item
              </button>
              {total > 0 && (
                <div className="text-[12px] text-gray-t">
                  Total: <span className="text-text text-mono-medium">${total.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Save template inline dialog */}
            {showSaveTemplate && (
              <div className="template-dialog">
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder={t('template_name')}
                  className="form-input-sm flex-1-auto bg-transparent"
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className={`btn btn-b btn-sm ${!templateName.trim() ? 'btn-opacity-disabled' : 'btn-opacity-normal'}`}
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveTemplate(false)}
                  className="btn-icon-only"
                  aria-label="Cancel save template"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* ── 9. Notes ── */}
          <div>
            <label className="form-label">9. Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="form-input resize-none"
            />
          </div>

          {/* ── Submit ── */}
          <button
            onClick={handleCreate}
            disabled={loading || !profileId || !shopId || !dropId}
            className={`btn btn-b btn-submit-full ${
              loading || !profileId || !shopId || !dropId
                ? 'btn-opacity-disabled'
                : 'btn-opacity-normal'
            }`}
          >
            {loading ? t('msg_loading') : t('create_order') + ' →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main OrderList ───────────────────────────────────────────
export default function OrderList({
  onNavigate: _onNavigate,
  activeTab = 'list',
  openCreate = false,
}) {
  const { t } = useLang()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // ── Zustand Store ──────────────────────────────────────────────
  const {
    orders,
    total,
    page,
    loading,
    filters,
    selected,
    deletingIds,
    setPage,
    setFilters,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    fetchOrders,
    deleteOrder,
    undoDelete,
    bulkUpdateStatus,
    bulkDelete,
  } = useOrdersStore()

  // Local UI state (not in store)
  const [searchInput, setSearchInput] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [statusMenuId, setStatusMenuId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [shopOptions, setShopOptions] = useState([])
  const [repeatOrder, setRepeatOrder] = useState(null)
  const [showBatchImport, setShowBatchImport] = useState(false)

  const debouncedSearch = useDebounce(searchInput, 300)

  // Virtual scrolling setup
  // ★ Insight: overscan увеличен до 20 для плавной прокрутки без белых полос
  const parentRef = useRef(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns functions, safe to use
  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => (expandedId === orders[index]?.id ? 180 : 60),
    overscan: 20, // Увеличено с 10 до 20
  })

  // Recalculate sizes when expandedId changes
  useEffect(() => {
    if (orders.length > 0) {
      rowVirtualizer.measure()
    }
  }, [expandedId, rowVirtualizer, orders.length])

  // ── Effects ────────────────────────────────────────────────────

  // Initialize: open create modal if requested
  useEffect(() => {
    if (openCreate) setShowCreate(true)
  }, [openCreate])

  // Load orders on mount and fetch shop options
  useEffect(() => {
    fetchOrders().catch(e => {
      const error = handleError(e, 'Orders.fetchOrders')
      toast(getErrorMessage(error), 'error')
    })
    // FIX FE-H05: Log shop fetch errors instead of silently ignoring
    invoke('get_shops', { page: 1, perPage: 200, search: '' })
      .then(r => setShopOptions(r.items ?? []))
      .catch(e => console.error('[Orders] Failed to fetch shops:', e))
  }, [fetchOrders, toast])

  // Handle activeTab changes (status filter)
  useEffect(() => {
    let newStatus = null
    if (activeTab === 'pending') newStatus = 'pending'
    else if (activeTab === 'delivered') newStatus = 'delivered'
    setFilters({ status: newStatus })
  }, [activeTab, setFilters])

  // Debounced search: update filter when user stops typing
  useEffect(() => {
    setFilters({ search: debouncedSearch || null })
  }, [debouncedSearch, setFilters])

  // Close status menu on outside click
  useEffect(() => {
    if (!statusMenuId) return
    const handler = () => setStatusMenuId(null)
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [statusMenuId])

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
    {
      keys: ['o'],
      handler: () => setShowCreate(true),
      requireNoInput: true,
      page: 'orders',
    },
    {
      keys: ['b'],
      handler: () => setShowBatchImport(true),
      requireNoInput: true,
      page: 'orders',
    },
  ]

  useKeyboardShortcuts(pageShortcuts, { currentPage: 'orders' })

  // ── Actions ────────────────────────────────────────────────────

  const handleDelete = async o => {
    // Soft delete with undo toast (no confirm dialog)
    let undone = false
    toast({
      message: t('order_deleted'),
      type: 'info',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          undoDelete(o.id)
        },
      },
    })

    setTimeout(async () => {
      if (undone) return
      try {
        await deleteOrder(o.id)
      } catch (e) {
        const error = handleError(e, 'Orders.handleDelete')
        toast(getErrorMessage(error), 'error')
      }
    }, 5000)
  }

  const handleBulkStatus = async status => {
    try {
      await bulkUpdateStatus([...selected], status)
      toast(`${selected.size} orders → ${status}`, 'success')
    } catch (e) {
      const error = handleError(e, 'Orders.handleBulkStatus')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ok = await confirm(t('orders_confirm_delete_many'), { danger: true })
    if (!ok) return
    try {
      await bulkDelete([...selected])
      toast(t('orders_deleted_many').replace('{n}', selected.size), 'success')
    } catch (e) {
      const error = handleError(e, 'Orders.handleBulkDelete')
      toast(getErrorMessage(error), 'error')
    }
  }

  const totalPages = getTotalPages(total, DEFAULT_PAGE_SIZE)

  const allSelected = orders.length > 0 && selected.size === orders.length

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">Orders</div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-g"
            onClick={() => setShowCreate(true)}
            data-shortcut="new"
            title="Create order (o)"
          >
            + {t('create_order')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowBatchImport(true)}
            title="Batch import (b)"
          >
            <Upload size={13} /> Batch Import
          </button>
          <button className="btn btn-ghost btn-sm" disabled title={t('export_coming_soon')}>
            {t('btn_export')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <OrderFilters
        filter={filters}
        setFilter={setFilters}
        load={() => fetchOrders(true)}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        shopOptions={shopOptions}
      />

      {/* Bulk Action Panel */}
      {selected.size > 0 && (
        <div className="bulk-action-panel">
          <span className="text-info-bold">{selected.size} selected</span>
          <span className="text-border mx-1">|</span>
          <button className="btn btn-b btn-sm" onClick={() => handleBulkStatus('processing')}>
            → Processing
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleBulkStatus('shipped')}>
            → Shipped
          </button>
          <button className="btn btn-r btn-sm" onClick={handleBulkDelete}>
            {t('btn_delete')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
            {t('orders_deselect_all')}
          </button>
        </div>
      )}

      {/* Table with virtual scrolling */}
      <div ref={parentRef} className="panel p-0 overflow-x-auto table-scroll-container">
        <table className="tbl">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-accent cursor-pointer"
                />
              </th>
              <th>{t('col_order_num')}</th>
              <th>
                {t('cc_col_holder')} / {t('section_card')}
              </th>
              <th>{t('col_shop')}</th>
              <th>{t('cc_col_status')}</th>
              <th>{t('col_amount')}</th>
              <th>{t('col_tracking')}</th>
              <th>{t('carrier')}</th>
              <th>{t('nav_proxies')}</th>
              <th>{t('col_email')}</th>
              <th>{t('cc_col_notes')}</th>
              <th>{t('col_date')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 && <SkeletonRows count={6} cols={13} />}
            {orders.length === 0 && !loading && (
              <EmptyState
                colSpan={13}
                icon={<Package size={38} />}
                {...{ title: t('orders'), subtitle: t('new_order') }}
                action={
                  <button className="btn btn-g btn-sm" onClick={() => setShowCreate(true)}>
                    + New Order
                  </button>
                }
              />
            )}
            {orders.length > 0 && (
              <>
                {/* Top padding spacer */}
                {rowVirtualizer.getVirtualItems().length > 0 &&
                  rowVirtualizer.getVirtualItems()[0].start > 0 && (
                    <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                      <td colSpan={13} className="virtual-scroll-spacer" />
                    </tr>
                  )}
                {/* Render visible rows */}
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const o = orders[virtualRow.index]
                  return (
                    <OrderRow
                      key={o.id}
                      order={o}
                      isSelected={selected.includes(o.id)}
                      isDeleting={deletingIds.has(o.id)}
                      isExpanded={expandedId === o.id}
                      onToggleExpand={() => {
                        setExpandedId(expandedId === o.id ? null : o.id)
                      }}
                      onToggleSelect={() => toggleSelect(o.id)}
                      onStatusMenuToggle={() =>
                        setStatusMenuId(statusMenuId === o.id ? null : o.id)
                      }
                      showStatusMenu={statusMenuId === o.id}
                      onRepeat={() => setRepeatOrder(o)}
                      onDelete={() => handleDelete(o)}
                      StatusMenuComponent={
                        <StatusMenu
                          order={o}
                          onUpdate={() => fetchOrders(true)}
                          onClose={() => setStatusMenuId(null)}
                        />
                      }
                      TimelineComponent={
                        <OrderTimeline status={o.status} updatedAt={o.updated_at} />
                      }
                    />
                  )
                })}
                {/* Bottom padding spacer */}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr
                    style={{
                      height: `${rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end || 0)}px`,
                    }}
                  >
                    <td colSpan={13} className="virtual-scroll-spacer" />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] text-muted">{total} orders</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="px-2 py-1 text-[12px] text-muted">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`btn btn-ghost btn-sm${page === p ? ' active pagination-btn-active' : ''}`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal
          onCreated={() => fetchOrders(true)}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* E1: Repeat Order modal */}
      {repeatOrder && (
        <RepeatOrderModal
          order={repeatOrder}
          onCreated={() => fetchOrders(true)}
          onClose={() => setRepeatOrder(null)}
        />
      )}

      {/* E3: Batch Import modal */}
      {showBatchImport && (
        <BatchImportModal
          onCreated={() => fetchOrders(true)}
          onClose={() => setShowBatchImport(false)}
        />
      )}
    </div>
  )
}
