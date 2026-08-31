import { useState, useRef } from 'react'
import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCcw, AlertTriangle, Pencil, Check, X } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { STATUS_COLORS } from '../../constants/colors'
import { ORDER_STATUS_CSS } from '../../constants/status'

// ─── CopyNumberBtn ───────────────────────────────────────────
function CopyNumberBtn({ value }) {
  const { t } = useLang()
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={e => {
        e.stopPropagation()
        handleCopy()
      }}
      title={t('cc_copy_num')}
      aria-label={t('cc_copy_num')}
      className={`ml-1 px-1 py-px rounded-md border-none cursor-pointer text-10 leading-none transition-colors ${
        copied ? 'bg-success-bg text-success' : 'bg-transparent text-muted'
      }`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

// ─── NeedsAttentionBadge ─────────────────────────────────────
function NeedsAttentionBadge({ order }) {
  const [now] = useState(() => Date.now())
  const daysSinceCreated = (now - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24)
  const daysSinceUpdated =
    (now - new Date(order.updated_at ?? order.created_at).getTime()) / (1000 * 60 * 60 * 24)

  if (order.status === 'pending' && daysSinceCreated > 3) {
    return (
      <AlertTriangle
        size={13}
        className="text-orange-t flex-shrink-0 ml-1"
        title="Pending for 3+ days"
      />
    )
  }
  if (order.status === 'shipped' && daysSinceUpdated > 14) {
    return (
      <AlertTriangle
        size={13}
        className="text-red flex-shrink-0 ml-1"
        title="Shipped 14+ days ago - check delivery"
      />
    )
  }
  return null
}

// ─── InlineTrackingCell ──────────────────────────────────────
function InlineTrackingCell({ orderId, value, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  const startEdit = e => {
    e.stopPropagation()
    setDraft(value ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const cancel = e => {
    e?.stopPropagation?.()
    setEditing(false)
  }

  const save = async e => {
    e?.stopPropagation?.()
    if (saving) return
    setSaving(true)
    try {
      await invoke('update_order_tracking', {
        id: orderId,
        trackingNumber: draft.trim() || null,
        carrier: null,
      })
      onSaved?.(draft.trim() || null)
      setEditing(false)
    } catch (err) {
      console.error('[InlineTrackingCell] save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = e => {
    if (e.key === 'Enter') save(e)
    else if (e.key === 'Escape') cancel(e)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          className="input input-sm font-mono text-10 w-28"
          placeholder="tracking #"
          disabled={saving}
        />
        <button
          className="btn btn-ghost btn-sm text-green-t"
          aria-label="Save"
          onClick={save}
          disabled={saving}
        >
          <Check size={11} />
        </button>
        <button className="btn btn-ghost btn-sm text-muted" aria-label="Cancel" onClick={cancel}>
          <X size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 group" onClick={e => e.stopPropagation()}>
      <span className="font-mono text-10 text-muted">{value ?? '—'}</span>
      <button
        className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={startEdit}
        title="Edit tracking number"
        aria-label="Edit tracking number"
      >
        <Pencil size={10} />
      </button>
    </div>
  )
}

/**
 * OrderRow — мемоизированный компонент строки заказа
 *
 * ★ Insight: React.memo предотвращает ре-рендер при изменении других заказов
 * Custom comparison проверяет только релевантные props
 */
export const OrderRow = React.memo(
  function OrderRow({
    order,
    isSelected,
    isDeleting,
    isExpanded,
    onToggleExpand,
    onToggleSelect,
    onStatusMenuToggle,
    showStatusMenu,
    onRepeat,
    onDelete,
    onTrackingUpdate,
    StatusMenuComponent,
    TimelineComponent,
    visibleCols,
    ruleHl,
    isFocused,
  }) {
    const { t } = useLang()
    // REDESIGN-05-4: скрытие колонок; без пропа — все (e2e/совместимость)
    const show = id => !visibleCols || visibleCols.includes(id)
    const colCount = visibleCols ? visibleCols.length : 13

    const getBorderColor = () => {
      if (isSelected) return '2px solid var(--blue)'
      if (order.status === 'delivered') return `2px solid ${STATUS_COLORS.success}73`
      if (order.status === 'declined' || order.status === 'cancelled')
        return `2px solid ${STATUS_COLORS.error}61`
      if (order.status === 'pending') return `2px solid ${STATUS_COLORS.warning}61`
      if (order.status === 'shipped' || order.status === 'in_transit')
        return `2px solid ${STATUS_COLORS.info}61`
      return '2px solid transparent'
    }

    return (
      <>
        <tr
          onClick={onToggleExpand}
          className={`cursor-pointer ${isDeleting ? 'opacity-30 line-through pointer-events-none' : ''} ${ruleHl ? 'row-rule-hl' : ''} ${isFocused ? 'row-kb-focus' : ''}`}
          style={{
            transition: 'opacity 0.4s ease, background 0.15s ease',
            borderLeft: getBorderColor(),
          }}
        >
          {show('select') && (
            <td onClick={e => e.stopPropagation()}>
              <label className="sr-only">
                Select order {order.order_number || `#${order.id}`}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={onToggleSelect}
                  aria-label={`Select order ${order.order_number || `#${order.id}`}`}
                />
              </label>
            </td>
          )}
          {show('order_number') && (
            <td>
              <span className="font-mono text-11">
                {order.order_number || `#${order.id}`}
                {order.order_number && <CopyNumberBtn value={order.order_number} />}
              </span>
            </td>
          )}
          {show('card') && (
            <td>
              <div className="text-12">{order.holder_masked || '—'}</div>
              <div className="font-mono text-10 text-muted">•••{order.last4 || '????'}</div>
            </td>
          )}
          {show('shop') && <td>{order.shop_name || '—'}</td>}
          {show('status') && (
            <td>
              <div className="flex items-center gap-[2px]">
                <span className={`st ${ORDER_STATUS_CSS[order.status] ?? 'st-archive'}`}>
                  {order.status}
                </span>
                <NeedsAttentionBadge order={order} />
              </div>
            </td>
          )}
          {show('amount') && (
            <td className="text-blue-t mono text-right whitespace-nowrap">
              {order.total_amount != null ? `$${order.total_amount.toFixed(2)}` : '—'}
            </td>
          )}
          {show('tracking') && (
            <td>
              <InlineTrackingCell
                orderId={order.id}
                value={order.tracking_number}
                onSaved={val => onTrackingUpdate?.(order.id, val)}
              />
            </td>
          )}
          {show('carrier') && <td className="text-11 text-muted">{order.carrier ?? '—'}</td>}
          {show('proxy') && <td className="text-11 text-muted">{order.proxy_label ?? '—'}</td>}
          {show('email') && <td className="text-11 text-muted">{order.email_addr ?? '—'}</td>}
          {show('notes') && (
            <td
              className="text-11 text-muted max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={order.notes ?? ''}
            >
              {order.notes ?? '—'}
            </td>
          )}
          {show('date') && <td className="text-11 text-muted">{order.created_at?.slice(0, 10)}</td>}
          {show('actions') && (
            <td onClick={e => e.stopPropagation()}>
              <div className="tbl-actions">
                <div className="relative">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={e => {
                      e.stopPropagation()
                      onStatusMenuToggle()
                    }}
                    title={t('change_status')}
                    aria-label={t('change_status')}
                  >
                    Status
                  </button>
                  {showStatusMenu && StatusMenuComponent}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Repeat this order"
                  onClick={e => {
                    e.stopPropagation()
                    onRepeat()
                  }}
                  aria-label="Repeat this order"
                >
                  <RotateCcw size={12} />
                </button>
                {order.profile_id && (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Open Float window"
                    onClick={e => {
                      e.stopPropagation()
                      // FIX FE-H05: Log float window errors instead of silently ignoring
                      invoke('open_float_window', { profileId: order.profile_id }).catch(err => {
                        console.error('[OrderRow] Failed to open float window:', err)
                      })
                    }}
                    aria-label="Open Float window"
                  >
                    ⬡
                  </button>
                )}
                <button
                  className="btn btn-r btn-sm"
                  onClick={e => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  aria-label={t('btn_delete')}
                >
                  Del
                </button>
              </div>
            </td>
          )}
        </tr>
        {isExpanded && (
          <tr key={`${order.id}-timeline`}>
            <td colSpan={colCount} className="p-[12px_16px_16px] bg-surface border-b border-border">
              {TimelineComponent}
            </td>
          </tr>
        )}
      </>
    )
  },
  (prev, next) => {
    // Custom comparison — только релевантные props
    return (
      prev.order.id === next.order.id &&
      prev.order.status === next.order.status &&
      prev.order.profile_id === next.order.profile_id &&
      prev.order.shop_id === next.order.shop_id &&
      prev.order.total_amount === next.order.total_amount &&
      prev.order.tracking_number === next.order.tracking_number &&
      prev.order.created_at === next.order.created_at &&
      prev.order.updated_at === next.order.updated_at &&
      prev.isSelected === next.isSelected &&
      prev.isDeleting === next.isDeleting &&
      prev.isExpanded === next.isExpanded &&
      prev.showStatusMenu === next.showStatusMenu &&
      prev.ruleHl === next.ruleHl &&
      prev.isFocused === next.isFocused &&
      // REDESIGN-05-4: массив видимых колонок — стабильная ссылка из стейта страницы
      prev.visibleCols === next.visibleCols
    )
  }
)
