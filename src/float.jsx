/* global AbortController */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { useLang, LangProvider } from './hooks/useLang'
import { usePremiumToast } from './hooks/usePremiumToast'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Lock } from 'lucide-react'
import { ORDER_STATUS_CSS } from './constants/status.js'
import { handleError, getErrorMessage } from './utils/errorHandler.js'
import { copySensitive } from './utils/clipboard.js'
import { purgeCacheOnVersionChange } from './utils/cacheBuster.js'
import './index.css'

// ─── Copy button ──────────────────────────────────────────────

// SEC-013: Use copySensitive for auto-clear after 30s
const CopyBtn = React.memo(function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!value) return
    copySensitive(String(value)).then(ok => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }
    })
  }
  return (
    <button className={`float-copy${copied ? ' copied' : ''}`} onClick={handleCopy} title="Copy">
      {copied ? '✓' : '⎘'}
    </button>
  )
})

// ─── Field row — PERF-001: memoized ─────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
const Field = React.memo(function Field({ label, value }) {
  return (
    <div className="float-field">
      <span className="float-lbl">{label}</span>
      <span className="float-val flex-1 text-right mr-6">{value ?? '—'}</span>
      <CopyBtn value={value} />
    </div>
  )
})

// ─── Risk badge — PERF-001: memoized ─────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
const RiskBadge = React.memo(function RiskBadge({ level }) {
  if (!level) return null
  const map = {
    safe: { className: 'risk-safe', label: 'Safe', icon: '🟢' },
    warning: { className: 'risk-warning', label: 'Warning', icon: '🟡' },
    high: { className: 'risk-high', label: 'High Risk', icon: '🔴' },
  }
  const cfg = map[level] ?? map.warning
  return (
    <span className={`st rounded-full risk-badge ${cfg.className}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
})

// ─── Card Health Indicator ────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
function CardHealth({ card, orderCount }) {
  if (!card) return null

  // Health logic: dead/blocked = burned, in_use with many orders = used, free/new = fresh
  let label, className, icon
  if (card.status === 'dead' || card.status === 'blocked') {
    label = 'Burned'
    className = 'health-burned'
    icon = '🔴'
  } else if (orderCount >= 3 || card.status === 'in_use') {
    label = 'Used'
    className = 'health-used'
    icon = '🟡'
  } else {
    label = 'Fresh'
    className = 'health-fresh'
    icon = '🟢'
  }

  return (
    <div className="flex items-center text-muted gap-5 text-[11px]">
      <span className={className}>{icon}</span>
      <span className={className}>{label}</span>
      {orderCount > 0 && (
        <span className="text-muted">
          · {orderCount} order{orderCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

// ─── Main float component ─────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Float window entry point
function ProfileFloat() {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()

  const [profileId, setProfileId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [card, setCard] = useState(null)
  const [drop, setDrop] = useState(null)
  const [latestOrderId, setLatestOrderId] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [tab, setTab] = useState('card')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [appLocked, setAppLocked] = useState(false)
  const [showQuickOrder, setShowQuickOrder] = useState(false)
  const [quickUrl, setQuickUrl] = useState('')
  const autoCopiedRef = useRef(false)

  // ── Load profile data ──────────────────────────────────────
  // FIX FE-01: Added AbortController to prevent race conditions and state updates after unmount
  const load = useCallback(async (id, abortSignal) => {
    if (!id) return
    setLoading(true)
    setError(null)
    setProfile(null)
    setCard(null)
    setDrop(null)
    setLatestOrderId(null)
    setRecentOrders([])
    autoCopiedRef.current = false
    try {
      const detail = await invoke('get_profile', { id: String(id) })
      if (abortSignal?.aborted) return
      setProfile(detail.profile)
      setCard(detail.card)
      if (detail.drops?.length > 0) {
        const primary = detail.drops.find(d => d.is_primary) ?? detail.drops[0]
        setDrop(primary)
      }
      // Load latest order id (for quick status change)
      try {
        const order = await invoke('get_latest_order_by_profile', { profileId: String(id) })
        if (!abortSignal?.aborted && order) setLatestOrderId(order.id)
      } catch {
        // Ignore if no orders found
      }
      // Load recent orders (for Orders tab)
      try {
        const orders = await invoke('get_recent_orders_by_profile', {
          profileId: String(id),
          limit: 5,
        })
        if (!abortSignal?.aborted) setRecentOrders(orders ?? [])
      } catch {
        // Ignore if no orders found
      }
    } catch (e) {
      if (!abortSignal?.aborted) {
        const error = handleError(e, 'Float.load')
        setError(getErrorMessage(error))
      }
    } finally {
      if (!abortSignal?.aborted) setLoading(false)
    }
  }, [])

  // ── Listen for float:load event ────────────────────────────
  useEffect(() => {
    let unlisten
    listen('float:load', event => {
      const id = String(event.payload ?? '').trim()
      if (!id) return
      setTab('card')
      setProfileId(id)
    }).then(u => {
      unlisten = u
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // ── Reload whenever profileId changes ──────────────────────
  // FIX FE-01: Added AbortController to cancel pending requests on unmount or id change
  useEffect(() => {
    const abortController = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка профиля
    if (profileId) load(profileId, abortController.signal)
    return () => {
      abortController.abort() // Cancel pending requests on cleanup
    }
  }, [profileId, load])

  // ── App lock listener — SEC-011: clear all data on lock ──
  useEffect(() => {
    let unlisten
    listen('app_locked', () => {
      setAppLocked(true)
      setProfile(null)
      setCard(null)
      setDrop(null)
      setLatestOrderId(null)
      setRecentOrders([])
      setProfileId(null)
      setError(null)
    }).then(u => {
      unlisten = u
    })
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // ── F4: Auto-copy billing address on tab switch ────────────
  useEffect(() => {
    if (tab === 'billing' && card && !autoCopiedRef.current) {
      const addr = [card.billing_address, card.city, card.state, card.zip, card.country]
        .filter(Boolean)
        .join(', ')
      if (addr) {
        // FIX FE-H05: Log clipboard errors instead of silently ignoring
        navigator.clipboard.writeText(addr).catch(e => {
          console.error('[float] Failed to copy billing address:', e)
        })
        toastOk('Billing address copied')
        autoCopiedRef.current = true
      }
    }
    if (tab !== 'billing') {
      autoCopiedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toastOk is stable
  }, [tab, card])

  // ── States ─────────────────────────────────────────────────
  if (appLocked) {
    return (
      <div className="float-state float-locked">
        <Lock size={28} className="text-muted" />
        <span className="text-[12px]">{t('auth_err_locked')}</span>
      </div>
    )
  }

  if (!profileId) {
    return (
      <div className="float-state float-waiting">
        <span className="text-[12px]">{t('float_waiting')}</span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="float-state float-loading">
        <div className="float-spinner" />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="float-state float-error">
        <span className="float-error-text">{error ?? t('float_not_found')}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => load(profileId)}>
          {t('float_retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="float-window">
      {/* Шапка тянет окно; интерактивные элементы внутри
          помечены data-tauri-drag-region="false", иначе
          перетаскивание съедает по ним клики. */}
      <div className="float-header" data-tauri-drag-region>
        <div className="flex items-center justify-between" data-tauri-drag-region>
          <div data-tauri-drag-region>
            <span className="font-semibold text-[13px]" data-tauri-drag-region>
              {profile.holder_name || t('section_card')}
            </span>
            {card && <span className="text-muted ml-2 text-[11px]">••{card.last4}</span>}
          </div>
          <div className="flex items-center gap-6" data-tauri-drag-region="false">
            <RiskBadge level={profile.risk_level} />
            {card && (
              <span className={`st ${card.status === 'free' ? 'st-free' : 'st-archive'}`}>
                {card.status}
              </span>
            )}
            <button
              onClick={() => getCurrentWindow().hide()}
              className="float-close-btn"
              title={t('btn_close')}
            >
              ×
            </button>
          </div>
        </div>
        {/* F3: Card health indicator */}
        <CardHealth card={card} orderCount={recentOrders.length} />
      </div>

      {/* ── Tabs ── */}
      <div className="float-tabs-bar">
        <div className="float-tabs">
          {[
            { key: 'card', label: t('section_card') },
            { key: 'billing', label: t('copy_billing') },
            { key: 'shipping', label: t('copy_shipping') },
            { key: 'orders', label: 'Orders' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`ftab${tab === key ? ' active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-auto min-h-0 p-[10px_12px]">
        {tab === 'card' && card && (
          <>
            <Field label={t('card_label_number')} value={card.card_number} />
            <Field label={t('card_label_expiry')} value={card.expiry_date} />
            <Field label={t('card_label_cvv')} value={card.cvv} />
            <Field label={t('card_label_holder')} value={card.holder_name} />
            {card.email && <Field label={t('col_email')} value={card.email} />}
            {card.phone && <Field label={t('drop_field_phone')} value={card.phone} />}
            {card.bank_name && <Field label={t('card_label_bank')} value={card.bank_name} />}
            {card.card_type && (
              <Field
                label={t('card_label_type')}
                value={[card.card_type, card.card_level].filter(Boolean).join(' / ')}
              />
            )}
          </>
        )}

        {tab === 'billing' && (
          <>
            {[
              { label: t('drop_field_address').replace(' *', ''), value: card?.billing_address },
              { label: t('drop_field_city').replace(' *', ''), value: card?.city },
              { label: t('drop_field_state'), value: card?.state },
              { label: t('drop_field_zip').replace(' *', ''), value: card?.zip },
              { label: t('drop_field_country').replace(' *', ''), value: card?.country },
            ].map(({ label, value }) => (
              <Field key={label} label={label} value={value} />
            ))}
            <button
              className="btn btn-b w-full justify-center mt-8"
              onClick={() => {
                const addr = [
                  card?.billing_address,
                  card?.city,
                  card?.state,
                  card?.zip,
                  card?.country,
                ]
                  .filter(Boolean)
                  .join(', ')
                navigator.clipboard.writeText(addr)
                toastOk('Billing address copied')
              }}
            >
              Copy Billing Address
            </button>
          </>
        )}

        {tab === 'shipping' &&
          (drop ? (
            <>
              {[
                { label: t('drop_field_recipient'), value: drop.recipient_name },
                { label: t('drop_field_address').replace(' *', ''), value: drop.address },
                { label: t('drop_field_city').replace(' *', ''), value: drop.city },
                { label: t('drop_field_state'), value: drop.state },
                { label: t('drop_field_zip').replace(' *', ''), value: drop.zip },
                { label: t('drop_field_country').replace(' *', ''), value: drop.country },
                { label: t('drop_field_phone'), value: drop.phone },
              ].map(({ label, value }) => (
                <Field key={label} label={label} value={value} />
              ))}
              <button
                className="btn btn-b w-full justify-center mt-8"
                onClick={() => {
                  const addr = [
                    drop.recipient_name,
                    drop.address,
                    drop.city,
                    drop.state,
                    drop.zip,
                    drop.country,
                  ]
                    .filter(Boolean)
                    .join(', ')
                  navigator.clipboard.writeText(addr)
                  toastOk('Shipping address copied')
                }}
              >
                Copy Shipping Address
              </button>
            </>
          ) : (
            <div className="text-center text-muted mt-8 text-[12px]">
              No drop address configured
            </div>
          ))}

        {/* F1: Recent Orders tab */}
        {tab === 'orders' && (
          <>
            {/* Quick Order inline form */}
            <div className="flex justify-end mb-6">
              <button
                className="btn btn-g btn-s text-[10px] p-[2px_8px]"
                onClick={() => {
                  setShowQuickOrder(v => !v)
                  setQuickUrl('')
                }}
              >
                + Order
              </button>
            </div>
            {showQuickOrder && (
              <div className="float-quick-order rounded mb-8 p-[8px]">
                <input
                  className="inp text-[11px] mb-[4px]"
                  placeholder="Shop URL..."
                  value={quickUrl}
                  onChange={e => setQuickUrl(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key !== 'Enter' || !quickUrl.trim()) return
                    try {
                      const shop = await invoke('find_or_create_shop', { url: quickUrl.trim() })
                      await invoke('create_order', {
                        input: {
                          profile_id: String(profileId),
                          shop_id: shop.id,
                          drop_id: null,
                          email_pool_id: null,
                          proxy_id: null,
                          order_number: null,
                          notes: null,
                          items: [{ name: shop.domain, sku: '', qty: 1, price: 0 }],
                        },
                      })
                      setQuickUrl('')
                      setShowQuickOrder(false)
                      load(profileId)
                      toastOk('Order created!')
                    } catch (err) {
                      toastErr(String(err))
                    }
                  }}
                  autoFocus
                />
                <div className="text-muted text-[10px]">Press Enter to create</div>
                <button
                  className="float-cancel-btn text-muted cursor-pointer text-[10px]"
                  onClick={() => setShowQuickOrder(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            {recentOrders.length === 0 ? (
              <div className="text-center text-muted mt-8 text-[12px]">No orders yet</div>
            ) : (
              <div className="flex flex-col gap-6">
                {recentOrders.map(order => (
                  <div
                    key={order.id}
                    onClick={() =>
                      invoke('open_main_window_page', { page: 'orders' }).catch(() => {})
                    }
                    className="float-order-row flex flex-col cursor-pointer"
                  >
                    <div className="flex justify-between items-center">
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[12px]">
                        {order.shop_name ?? `Shop #${order.shop_id}`}
                      </span>
                      <div className="flex items-center flex-shrink-0 gap-4">
                        <span className={`st ${ORDER_STATUS_CSS[order.status] ?? ''} text-[10px]`}>
                          {order.status}
                        </span>
                        {/* F2: Quick status change dropdown */}
                        <select
                          value={order.status}
                          onChange={async e => {
                            try {
                              await invoke('update_order_status', {
                                id: order.id,
                                status: e.target.value,
                                meta: null,
                              })
                              toastOk('Status updated')
                              load(profileId)
                            } catch (err) {
                              toastErr(String(err))
                            }
                          }}
                          className="float-status-select text-[10px] rounded cursor-pointer p-[1px_4px]"
                          onClick={e => e.stopPropagation()}
                        >
                          {[
                            'Pending',
                            'Processing',
                            'Shipped',
                            'Delivered',
                            'Cancelled',
                            'Declined',
                          ].map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-between text-muted text-[11px]">
                      <span>{fmtDate(order.created_at)}</span>
                      {order.tracking_number && (
                        <span className="mono">{order.tracking_number.slice(0, 16)}</span>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-ghost btn-sm justify-center mt-4"
                  onClick={() =>
                    invoke('open_main_window_page', { page: 'orders' }).catch(e => {
                      console.error('[float] Failed to open main window:', e)
                    })
                  }
                >
                  View all orders →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Footer actions ── */}
      <div className="float-footer">
        <button
          className="btn btn-ghost btn-sm text-[10px] p-[4px_8px]"
          onClick={() =>
            invoke('open_main_window_page', { page: 'orders' }).catch(e => {
              console.error('[float] Failed to open main window:', e)
            })
          }
        >
          + Order
        </button>
        <button
          className={`btn btn-g flex-1 justify-center${!latestOrderId ? ' btn-disabled' : ''}`}
          disabled={!latestOrderId}
          onClick={async () => {
            if (!latestOrderId) return
            try {
              await invoke('update_order_status', {
                id: latestOrderId,
                status: 'delivered',
                meta: null,
              })
              toastOk('Order marked as delivered')
              await load(profileId)
            } catch (e) {
              const error = handleError(e, 'Float.markDelivered')
              toastErr(getErrorMessage(error))
            }
          }}
        >
          ✓ Delivered
        </button>
        <button
          className={`btn btn-r flex-1 justify-center${!latestOrderId ? ' btn-disabled' : ''}`}
          disabled={!latestOrderId}
          onClick={async () => {
            if (!latestOrderId) return
            try {
              await invoke('update_order_status', {
                id: latestOrderId,
                status: 'declined',
                meta: null,
              })
              toastOk('Order marked as declined')
              await load(profileId)
            } catch (e) {
              const error = handleError(e, 'Float.markDeclined')
              toastErr(getErrorMessage(error))
            }
          }}
        >
          ✗ Declined
        </button>
      </div>
    </div>
  )
}

// ERR-001: ErrorBoundary for float window
class FloatErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="float-state float-error">
          <span className="float-error-text">
            {this.state.error?.message || 'Unexpected error'}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

purgeCacheOnVersionChange().then(reloading => {
  if (reloading) return
  ReactDOM.createRoot(document.getElementById('root')).render(
    <FloatErrorBoundary>
      <LangProvider>
        <ProfileFloat />
      </LangProvider>
    </FloatErrorBoundary>
  )
})
