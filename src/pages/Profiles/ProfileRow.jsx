import { Copy, Trash2, Layers, ShoppingCart } from 'lucide-react'
import React from 'react'
import { useLang } from '../../hooks/useLang'
import { ActionsMenu } from '../../components/ActionsMenu.jsx'
import { shortId } from '../../utils/formatting.js'
import { invoke } from '@tauri-apps/api/core'
import { CARD_STATUS_CSS } from '../../constants/status.js'

/**
 * ProfileRow — мемоизированный компонент строки профиля
 *
 * ★ Insight: React.memo предотвращает ре-рендер при изменении других профилей
 */
export const ProfileRow = React.memo(
  function ProfileRow({
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
    isChecked,
    onToggleSelect,
    rowReorder,
    rowDragStart,
    rowDragOver,
    rowDragLeave,
    rowDragEnd,
    rowDrop,
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
        className={`cursor-pointer ${isDeleting ? 'opacity-30 line-through pointer-events-none' : ''}`}
        style={{
          background: isSelected
            ? 'var(--color-info-bg)'
            : rawStatus === 'dead'
              ? 'transparent' // dead-профиль не светим жёлтым «нет дропа» — он уже мёртв
              : !hasDrops
                ? 'var(--color-warning-bg)'
                : undefined,
          outline: isSelected ? '1px solid rgba(59, 130, 246, 0.3)' : undefined,
          transition: 'opacity 0.4s ease',
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onDragOver={rowReorder ? rowDragOver : undefined}
        onDragLeave={rowReorder ? rowDragLeave : undefined}
        onDrop={rowReorder ? e => rowDrop(e, p.id) : undefined}
      >
        <td className="w-8" onClick={e => e.stopPropagation()}>
          {rowReorder && (
            <span
              className="row-grip"
              draggable
              onDragStart={e => rowDragStart(e, p.id)}
              onDragEnd={rowDragEnd}
              title={t('row_drag_title')}
              aria-label={t('row_drag_title')}
            >
              ⠿
            </span>
          )}
          <input
            type="checkbox"
            checked={!!isChecked}
            onChange={() => onToggleSelect?.(p.id)}
            className="accent-accent"
          />
        </td>
        <td className="text-12 text-muted">{isExpanded ? '▾' : '▸'}</td>
        <td>
          <span className="font-mono text-11 text-muted">{shortId(p.id)}</span>
          {p.holder_masked && <div className="text-12">{p.holder_masked}</div>}
        </td>
        <td>
          <span className="font-mono text-11">
            {p.bin ? p.bin.slice(0, 4) : '••••'}••••{p.last4 || '????'}
          </span>
        </td>
        <td className="text-11 text-text-2">{p.card_type || '—'}</td>
        <td className="text-12 text-muted">{p.bank_name || '—'}</td>
        <td className="text-12 text-muted">{p.country || '—'}</td>
        <td>
          <span className={`st ${cardStatusCss}`}>{rawStatus}</span>
        </td>
        <td
          className="text-12 font-medium"
          style={{ color: hasDrops ? 'var(--color-success)' : 'var(--color-warning)' }}
        >
          {p.drop_count}
        </td>
        <td className="text-12 text-muted">{p.order_count}</td>
        <td
          className="text-11 text-muted max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap"
          title={p.notes ?? ''}
        >
          {p.notes || '—'}
        </td>
        <td className="text-11 text-muted whitespace-nowrap">{p.created_at?.slice(0, 10)}</td>
        <td onClick={e => e.stopPropagation()}>
          <div className="tbl-actions">
            <button
              className="btn btn-b btn-sm"
              title={t('float_window')}
              onClick={() => {
                // FIX FE-H05: Log float window errors instead of silently ignoring
                invoke('open_float_window', { profileId: p.id }).catch(e => {
                  console.error('[ProfileRow] Failed to open float window:', e)
                })
              }}
            >
              {t('float_window')}
            </button>
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1"
              title="New Order"
              aria-label="Create new order for this profile"
              onClick={onQuickOrder}
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
  },
  (prev, next) => {
    // Custom comparison — только релевантные props
    return (
      prev.profile.id === next.profile.id &&
      prev.profile.card_status === next.profile.card_status &&
      prev.profile.drop_count === next.profile.drop_count &&
      prev.profile.order_count === next.profile.order_count &&
      prev.profile.bin === next.profile.bin &&
      prev.profile.last4 === next.profile.last4 &&
      prev.isSelected === next.isSelected &&
      prev.isDeleting === next.isDeleting &&
      prev.isExpanded === next.isExpanded &&
      prev.rowReorder === next.rowReorder
    )
  }
)
