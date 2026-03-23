import { Copy, Trash2, Layers, ShoppingCart } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { ActionsMenu } from '../../components/ActionsMenu.jsx'
import { shortId } from '../../utils/formatting.js'
import { invoke } from '@tauri-apps/api/core'
import { CARD_STATUS_CSS } from '../../constants/status.js'

export function ProfileRow({
  profile,
  idx,
  isExpanded,
  isDeleting,
  isSelected,
  onRowClick,
  onMouseEnter,
  onMouseLeave,
  onDelete,
  onDuplicate,
  onCopyProfile,
  onCopyBilling,
  onCopyShipping,
  onQuickOrder,
}) {
  const { t } = useLang()
  const p = profile
  const hasDrops = p.drop_count > 0
  const rawStatus = p.card_status || (hasDrops ? 'in_use' : 'free')
  const cardStatusCss = CARD_STATUS_CSS[rawStatus] ?? 'st-archive'

  return (
    <tr
      data-idx={idx}
      onClick={onRowClick}
      style={{
        cursor: 'pointer',
        background: isSelected
          ? 'var(--color-info-bg)'
          : !hasDrops
            ? 'var(--color-warning-bg)'
            : undefined,
        outline: isSelected ? '1px solid rgba(59, 130, 246, 0.3)' : undefined,
        opacity: isDeleting ? 0.3 : 1,
        textDecoration: isDeleting ? 'line-through' : 'none',
        transition: 'opacity 0.4s ease',
        pointerEvents: isDeleting ? 'none' : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <td className="text-[12px] text-muted">{isExpanded ? '▾' : '▸'}</td>
      <td>
        <span className="font-mono text-[11px] text-muted">{shortId(p.id)}</span>
        {p.holder_masked && <div className="text-[12px]">{p.holder_masked}</div>}
      </td>
      <td>
        <span className="font-mono text-[11px]">
          {p.bin ? p.bin.slice(0, 4) : '••••'}••••{p.last4 || '????'}
        </span>
      </td>
      <td className="text-[11px] text-text-2">{p.card_type || '—'}</td>
      <td className="text-[12px] text-muted">{p.bank_name || '—'}</td>
      <td className="text-[12px] text-muted">{p.country || '—'}</td>
      <td>
        <span className={`st ${cardStatusCss}`}>{rawStatus}</span>
      </td>
      <td
        style={{
          fontSize: 12,
          color: hasDrops ? 'var(--color-success)' : 'var(--color-warning)',
          fontWeight: 500,
        }}
      >
        {p.drop_count}
      </td>
      <td className="text-[12px] text-muted">{p.order_count}</td>
      <td
        className="text-[11px] text-muted max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap"
        title={p.notes ?? ''}
      >
        {p.notes || '—'}
      </td>
      <td className="text-[11px] text-muted whitespace-nowrap">{p.created_at?.slice(0, 10)}</td>
      <td onClick={e => e.stopPropagation()}>
        <div className="tbl-actions">
          <button
            className="btn btn-b btn-sm"
            title={t('float_window')}
            onClick={() => invoke('open_float_window', { profileId: p.id }).catch(() => {})}
          >
            {t('float_window')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title="New Order"
            onClick={onQuickOrder}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <ShoppingCart size={12} />
          </button>
          <ActionsMenu
            items={[
              { label: t('btn_copy'), icon: Copy, onClick: onCopyProfile },
              { label: t('copy_billing'), icon: Copy, onClick: onCopyBilling },
              { label: t('copy_shipping'), icon: Copy, onClick: onCopyShipping },
              { divider: true },
              {
                label: t('profile_duplicated').split(' ')[0] || 'Duplicate',
                icon: Layers,
                onClick: onDuplicate,
              },
              { divider: true },
              { label: t('btn_delete'), icon: Trash2, onClick: onDelete, danger: true },
            ]}
          />
        </div>
      </td>
    </tr>
  )
}
