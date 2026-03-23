import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCcw, AlertTriangle } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { STATUS_COLORS } from '../../constants/colors'

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
      style={{
        marginLeft: 4,
        padding: '1px 4px',
        borderRadius: 4,
        background: copied ? STATUS_COLORS.successBg : 'transparent',
        color: copied ? STATUS_COLORS.success : 'var(--muted)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 10,
        lineHeight: 1,
        transition: 'color 0.15s',
      }}
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
        style={{ color: 'var(--orange)', flexShrink: 0, marginLeft: 4 }}
        title="Pending for 3+ days"
      />
    )
  }
  if (order.status === 'shipped' && daysSinceUpdated > 14) {
    return (
      <AlertTriangle
        size={13}
        style={{ color: 'var(--red)', flexShrink: 0, marginLeft: 4 }}
        title="Shipped 14+ days ago - check delivery"
      />
    )
  }
  return null
}

const STATUS_CSS = {
  pending: 'st-pending',
  processing: 'st-processing',
  shipped: 'st-shipped',
  in_transit: 'st-transit',
  delivered: 'st-delivered',
  declined: 'st-decline',
  cancelled: 'st-cancelled',
}

export function OrderRow({
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
  StatusMenuComponent,
  TimelineComponent,
}) {
  const { t } = useLang()

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
        style={{
          cursor: 'pointer',
          opacity: isDeleting ? 0.3 : 1,
          textDecoration: isDeleting ? 'line-through' : 'none',
          transition: 'opacity 0.4s ease, background 0.15s ease',
          pointerEvents: isDeleting ? 'none' : undefined,
          borderLeft: getBorderColor(),
        }}
      >
        <td onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={onToggleSelect} />
        </td>
        <td>
          <span className="font-mono text-[11px]">
            {order.order_number || `#${order.id}`}
            {order.order_number && <CopyNumberBtn value={order.order_number} />}
          </span>
        </td>
        <td>
          <div className="text-[12px]">{order.holder_masked || '—'}</div>
          <div className="font-mono text-[10px] text-muted">···{order.last4 || '????'}</div>
        </td>
        <td>{order.shop_name || '—'}</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span className={`st ${STATUS_CSS[order.status] ?? 'st-archive'}`}>{order.status}</span>
            <NeedsAttentionBadge order={order} />
          </div>
        </td>
        <td
          style={{
            color: STATUS_COLORS.info,
            fontFamily: "'JetBrains Mono',monospace",
            textAlign: 'right',
            whiteSpace: 'nowrap',
          }}
        >
          {order.total_amount != null ? `$${order.total_amount.toFixed(2)}` : '—'}
        </td>
        <td className="font-mono text-[10px] text-muted">{order.tracking_number ?? '—'}</td>
        <td className="text-[11px] text-muted">{order.carrier ?? '—'}</td>
        <td className="text-[11px] text-muted">{order.proxy_label ?? '—'}</td>
        <td className="text-[11px] text-muted">{order.email_addr ?? '—'}</td>
        <td
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={order.notes ?? ''}
        >
          {order.notes ?? '—'}
        </td>
        <td className="text-[11px] text-muted">{order.created_at?.slice(0, 10)}</td>
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
            >
              <RotateCcw size={12} />
            </button>
            {order.profile_id && (
              <button
                className="btn btn-ghost btn-sm"
                title="Open Float window"
                onClick={e => {
                  e.stopPropagation()
                  invoke('open_float_window', { profileId: order.profile_id }).catch(() => {})
                }}
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
            >
              Del
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr key={`${order.id}-timeline`}>
          <td
            colSpan={13}
            style={{
              padding: '12px 16px 16px',
              background: 'var(--surface)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {TimelineComponent}
          </td>
        </tr>
      )}
    </>
  )
}
