import { Store, Clock, Copy, CheckCircle, XCircle, User, Trash2 } from 'lucide-react'
import { ActionsMenu } from '../../components/ActionsMenu.jsx'
import {
  formatCardNumber,
  formatBinMasked,
  buildPipeString,
  countryFlag,
} from '../../utils/formatting.js'
import { getBinBadge } from '../../constants/cardTypes.js'
import { getCardHealth } from '../../utils/cardHealth.js'
import { CARD_STATUS_CSS } from '../../constants/status.js'
import { ExpiryCell } from './ExpiryCell.jsx'
import { NoteCell } from './NoteCell.jsx'

export function CardRow({
  card,
  cards,
  revealed,
  selected,
  deletingIds,
  flashedIds,
  statusMenuId,
  visibleCols,
  toggleSelect,
  setSideCard,
  setSideCardIdx,
  setStatusMenuId,
  handleStatusChange,
  handleCopyToast,
  handleEditNote,
  setShopUsageCardId,
  setTimelineCardId,
  handleDelete,
  setFilter,
  setPage,
  onNavigate,
  t,
  toast,
}) {
  const rev = revealed[card.id]
  const displayNum = rev?.card_number
    ? formatCardNumber(rev.card_number)
    : formatBinMasked(card.bin, card.last4)
  const statusCls = CARD_STATUS_CSS[card.status] ?? 'st-archive'
  const statusLabel = card.status === 'in_use' ? 'in use' : card.status
  const badge = getBinBadge(card.card_type)
  const burnCount = card.orders_count ?? 0
  const isFlashing = flashedIds.has(card.id)

  return (
    <tr
      key={card.id}
      className={isFlashing ? 'row-flash' : ''}
      onClick={() => toggleSelect(card.id)}
      onDoubleClick={e => {
        e.stopPropagation()
        const i = cards.indexOf(card)
        setSideCard(card)
        setSideCardIdx(i)
      }}
      style={{
        background: selected.has(card.id) ? 'var(--color-info-bg)' : undefined,
        cursor: 'pointer',
        borderLeft: selected.has(card.id)
          ? '2px solid var(--blue)'
          : card.status === 'free'
            ? '2px solid var(--color-card-free)'
            : card.status === 'dead'
              ? '2px solid var(--color-card-dead)'
              : card.status === 'in_use'
                ? '2px solid var(--color-card-in-use)'
                : '2px solid transparent',
        opacity: deletingIds.has(card.id) ? 0.3 : 1,
        textDecoration: deletingIds.has(card.id) ? 'line-through' : 'none',
        transition: 'background 0.4s ease, border-color 0.4s ease, opacity 0.4s ease',
        pointerEvents: deletingIds.has(card.id) ? 'none' : undefined,
      }}
    >
      {/* Checkbox */}
      <td onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected.has(card.id)}
          onChange={() => toggleSelect(card.id)}
          className="accent-accent cursor-pointer"
        />
      </td>

      {/* Number — card number with network badge */}
      {visibleCols.includes('card_number') && (
        <td
          onClick={e => {
            e.stopPropagation()
            handleCopyToast(displayNum)
          }}
          title={t('btn_copy')}
          className="cursor-copy"
        >
          <div className="flex items-center gap-[5px] mb-0.5">
            {badge && (
              <span
                className="card-network-badge"
                style={{
                  background: badge.bg,
                  color: badge.color,
                }}
              >
                {badge.label}
              </span>
            )}
            <span className="font-mono text-[12px]">{displayNum}</span>
          </div>
        </td>
      )}

      {/* Expiry */}
      {visibleCols.includes('expiry') && (
        <td>
          <ExpiryCell expiry={card.expiry_date} t={t} />
        </td>
      )}

      {/* CVV */}
      {visibleCols.includes('cvv') && (
        <td
          className={`cell-text-sm-mono ${rev?.cvv ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (rev?.cvv) {
              e.stopPropagation()
              handleCopyToast(rev.cvv)
            }
          }}
          title={rev?.cvv ? t('btn_copy') : undefined}
        >
          {rev?.cvv || (rev ? '—' : <span className="text-muted">···</span>)}
        </td>
      )}

      {/* Holder */}
      {visibleCols.includes('holder') && (
        <td
          className="cell-text-sm-copy cell-truncate"
          onClick={e => {
            e.stopPropagation()
            handleCopyToast(rev?.holder_name || card.holder_name || '')
          }}
          title={t('btn_copy')}
        >
          {rev?.holder_name || card.holder_name || '—'}
        </td>
      )}

      {/* Billing address */}
      {visibleCols.includes('billing') && (
        <td
          className={`cell-text-sm cell-truncate-lg ${rev?.billing_address ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (rev?.billing_address) {
              e.stopPropagation()
              handleCopyToast(rev.billing_address)
            }
          }}
          title={rev?.billing_address ? t('btn_copy') : undefined}
        >
          {rev?.billing_address || '—'}
        </td>
      )}

      {/* ZIP */}
      {visibleCols.includes('zip') && (
        <td
          className={`cell-text-sm-mono ${card.zip ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (card.zip) {
              e.stopPropagation()
              handleCopyToast(card.zip)
            }
          }}
          title={card.zip ? t('btn_copy') : undefined}
        >
          {card.zip || '—'}
        </td>
      )}

      {/* City */}
      {visibleCols.includes('city') && (
        <td
          className={`cell-text-sm ${card.city ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (card.city) {
              e.stopPropagation()
              handleCopyToast(card.city)
            }
          }}
          title={card.city ? t('btn_copy') : undefined}
        >
          {card.city || '—'}
        </td>
      )}

      {/* State */}
      {visibleCols.includes('state') && (
        <td
          className={`cell-text-sm ${card.state ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (card.state) {
              e.stopPropagation()
              handleCopyToast(card.state)
            }
          }}
          title={card.state ? t('btn_copy') : undefined}
        >
          {card.state || '—'}
        </td>
      )}

      {/* Country — click to filter */}
      {visibleCols.includes('country') && (
        <td>
          {card.country ? (
            <span
              onClick={e => {
                e.stopPropagation()
                setFilter(f => ({ ...f, country: card.country }))
                setPage(1)
              }}
              className="filter-link-badge"
              title={t('filter_by') + ' ' + card.country}
            >
              {countryFlag(card.country)} {card.country}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
      )}

      {/* Phone */}
      {visibleCols.includes('phone') && (
        <td
          className={`cell-text-sm-mono ${rev?.phone ? 'cursor-copy' : ''}`}
          onClick={e => {
            if (rev?.phone) {
              e.stopPropagation()
              handleCopyToast(rev.phone)
            }
          }}
          title={rev?.phone ? t('btn_copy') : undefined}
        >
          {rev?.phone || (rev ? '—' : <span className="text-muted">···</span>)}
        </td>
      )}

      {/* Bank — click to filter */}
      {visibleCols.includes('bin_bank') && (
        <td>
          <span className="mono cell-text-sm">{card.bin || '——'}</span>
          {card.bank_name && (
            <span
              onClick={e => {
                e.stopPropagation()
                setFilter(f => ({ ...f, bank_name: card.bank_name }))
                setPage(1)
              }}
              className="filter-link-text"
              title={t('filter_by') + ' ' + card.bank_name}
            >
              {card.bank_name}
            </span>
          )}
        </td>
      )}

      {/* Type */}
      {visibleCols.includes('type') && (
        <td className="text-text-2">
          {card.card_type || '—'}
          {card.card_level && (
            <span className="ml-1 text-[11px] text-muted">{card.card_level}</span>
          )}
        </td>
      )}

      {/* Source */}
      {visibleCols.includes('source') && (
        <td className="cell-text-sm cell-truncate-sm">{card.source || '—'}</td>
      )}

      {/* Status with inline quick-change menu and burn indicator */}
      {visibleCols.includes('status') && (
        <td>
          <div className="flex items-center gap-1">
            <div className="status-menu-anchor relative">
              <span
                className={`st ${statusCls} cursor-pointer`}
                onClick={e => {
                  e.stopPropagation()
                  setStatusMenuId(statusMenuId === card.id ? null : card.id)
                }}
                title={t('change_status')}
              >
                {statusLabel}
              </span>
              {statusMenuId === card.id && (
                <div className="status-menu-dropdown">
                  {[
                    { s: 'free', label: t('status_free'), cls: 'st-free' },
                    { s: 'dead', label: t('status_dead'), cls: 'st-dead' },
                    { s: 'archive', label: t('status_archive'), cls: 'st-archive' },
                  ]
                    .filter(o => o.s !== card.status)
                    .map(o => (
                      <button
                        key={o.s}
                        onClick={e => {
                          e.stopPropagation()
                          setStatusMenuId(null)
                          handleStatusChange(card.id, o.s)
                        }}
                        className="status-menu-btn"
                      >
                        <span className={`st ${o.cls}`}>{o.label}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {burnCount > 0 && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono',monospace",
                  color:
                    burnCount >= 5
                      ? 'var(--orange)'
                      : burnCount >= 3
                        ? 'var(--color-warning)'
                        : 'var(--muted)',
                }}
                title={t('used_in_orders').replace('{n}', burnCount)}
              >
                ×{burnCount}
              </span>
            )}
          </div>
        </td>
      )}

      {/* Health */}
      {visibleCols.includes('health') && (
        <td onClick={e => e.stopPropagation()}>
          {(() => {
            const h = getCardHealth(card)
            if (!h) return <span className="text-muted text-[11px]">—</span>
            return <span className={`st ${h.cls} text-[10px]`}>{h.label}</span>
          })()}
        </td>
      )}

      {/* Notes */}
      {visibleCols.includes('notes') && (
        <td onClick={e => e.stopPropagation()}>
          <NoteCell card={card} onEditNote={handleEditNote} />
        </td>
      )}

      {/* Created */}
      {visibleCols.includes('created') && (
        <td className="text-muted text-[11px] whitespace-nowrap mono">
          {card.created_at?.slice(0, 10)}
        </td>
      )}

      {/* Email / IP / email_cc */}
      {visibleCols.includes('email_cc') && (
        <td className="text-[11px] text-text-2">{rev?.email || '—'}</td>
      )}
      {visibleCols.includes('ip') && (
        <td className="text-[11px] text-text-2 mono">{rev?.ip_address || '—'}</td>
      )}

      {/* Actions */}
      <td onClick={e => e.stopPropagation()}>
        <div className="tbl-actions">
          <button
            onClick={() => setShopUsageCardId(card.id)}
            className="btn btn-ghost btn-sm btn-compact"
            title="Shops used"
          >
            <Store size={12} />
          </button>
          <button
            onClick={() => setTimelineCardId(card.id)}
            className="btn btn-ghost btn-sm btn-compact"
            title="Timeline"
          >
            <Clock size={12} />
          </button>
          <ActionsMenu
            items={[
              {
                label: t('cc_copy_num'),
                icon: Copy,
                onClick: () => {
                  const num = rev?.card_number
                    ? formatCardNumber(rev.card_number)
                    : formatBinMasked(card.bin, card.last4)
                  handleCopyToast(num)
                },
              },
              {
                label: t('cards_copy_full'),
                icon: Copy,
                onClick: () => handleCopyToast(buildPipeString(card, rev)),
              },
              { divider: true },
              {
                label: t('cc_mark_free'),
                icon: CheckCircle,
                onClick: () => handleStatusChange(card.id, 'free'),
              },
              {
                label: t('cc_mark_dead'),
                icon: XCircle,
                onClick: () => handleStatusChange(card.id, 'dead'),
                danger: true,
              },
              { divider: true },
              {
                label: t('new_profile'),
                icon: User,
                onClick: async () => {
                  try {
                    const { invoke } = await import('@tauri-apps/api/core')
                    await invoke('create_profile', { cardId: card.id, notes: null })
                    toast(t('profile_created'), 'success')
                    onNavigate?.('profiles')
                  } catch (e) {
                    toast(
                      String(e) === 'card_already_in_use' ? t('card_already_in_use') : String(e),
                      'error'
                    )
                  }
                },
              },
              { divider: true },
              {
                label: t('btn_delete'),
                icon: Trash2,
                onClick: () => handleDelete(card.id),
                danger: true,
              },
            ]}
          />
        </div>
      </td>
    </tr>
  )
}
