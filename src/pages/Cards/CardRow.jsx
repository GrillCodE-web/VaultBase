import { Store, Clock, Copy, CheckCircle, XCircle, User, Trash2 } from 'lucide-react'
import React from 'react'
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
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

/**
 * CardRow — мемоизированный компонент строки карты
 *
 * ★ Insight: React.memo предотвращает ре-рендер при изменении других карт
 * Custom props comparison проверяет только релевантные изменения
 */
export const CardRow = React.memo(
  function CardRow({
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
    const isFlashing = flashedIds.includes(card.id)

    const rowClasses = [
      'card-row',
      isFlashing && 'row-flash',
      selected.includes(card.id) && 'card-row-selected',
      card.status === 'free' && 'card-row-free',
      card.status === 'dead' && 'card-row-dead',
      card.status === 'in_use' && 'card-row-in-use',
      deletingIds.includes(card.id) && 'card-row-deleting',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <tr
        key={card.id}
        className={rowClasses}
        onClick={() => toggleSelect(card.id)}
        onDoubleClick={e => {
          e.stopPropagation()
          const i = cards.indexOf(card)
          setSideCard(card)
          setSideCardIdx(i)
        }}
      >
        {/* Checkbox */}
        <td onClick={e => e.stopPropagation()}>
          <label className="sr-only">
            Select card {displayNum}
            <input
              type="checkbox"
              checked={selected.includes(card.id)}
              onChange={() => toggleSelect(card.id)}
              className="accent-accent cursor-pointer"
              aria-label={`Select card ending in ${card.last4}`}
            />
          </label>
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
            <div className="flex items-center gap-1 mb-0">
              {badge && (
                <span className={`card-network-badge card-network-${badge.label.toLowerCase()}`}>
                  {badge.label}
                </span>
              )}
              <span className="mono text-[12px]">{displayNum}</span>
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
              <span className="ml-1 text-[11px] text-muted manrope">{card.card_level}</span>
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
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      setStatusMenuId(statusMenuId === card.id ? null : card.id)
                    }
                  }}
                  title={t('change_status')}
                  role="button"
                  tabIndex={0}
                  aria-label={t('change_status') || 'Change card status'}
                  aria-expanded={statusMenuId === card.id}
                >
                  {statusLabel}
                </span>
                {statusMenuId === card.id && (
                  <div className="status-menu-dropdown" role="menu">
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
                          role="menuitem"
                        >
                          <span className={`st ${o.cls}`}>{o.label}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
              {burnCount > 0 && (
                <span
                  className={`burn-count burn-${burnCount >= 5 ? 'high' : burnCount >= 3 ? 'medium' : 'low'}`}
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
              if (!h) return <span className="text-muted text-[11px] manrope">—</span>
              return <span className={`st ${h.cls} text-[10px] manrope`}>{h.label}</span>
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
          <td className="text-muted text-[11px] whitespace-nowrap mono">{card.created_at}</td>
        )}

        {/* Email / IP / email_cc */}
        {visibleCols.includes('email_cc') && (
          <td className="text-[11px] text-text-2 manrope">{rev?.email || '—'}</td>
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
              aria-label={`View shops used by card ending in ${card.last4}`}
            >
              <Store size={14} className="icon-sm" aria-hidden="true" />
            </button>
            <button
              onClick={() => setTimelineCardId(card.id)}
              className="btn btn-ghost btn-sm btn-compact"
              title="Timeline"
              aria-label={`View timeline for card ending in ${card.last4}`}
            >
              <Clock size={14} className="icon-sm" aria-hidden="true" />
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
                      const error = handleError(e, 'CardRow.createProfile')
                      const msg =
                        error.details?.originalMessage === 'card_already_in_use'
                          ? t('card_already_in_use')
                          : getErrorMessage(error)
                      toast(msg, 'error')
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
  },
  (prev, next) => {
    // Custom comparison — только релевантные props
    // Если они не изменились, пропускаем ре-рендер
    return (
      prev.card.id === next.card.id &&
      prev.card.status === next.card.status &&
      prev.card.bin === next.card.bin &&
      prev.card.bank_name === next.card.bank_name &&
      prev.card.card_type === next.card.card_type &&
      prev.card.card_level === next.card.card_level &&
      prev.card.last4 === next.card.last4 &&
      prev.card.expiry_date === next.card.expiry_date &&
      prev.card.country === next.card.country &&
      prev.card.source === next.card.source &&
      prev.card.orders_count === next.card.orders_count &&
      prev.card.zip === next.card.zip &&
      prev.card.city === next.card.city &&
      prev.card.state === next.card.state &&
      prev.card.holder_name === next.card.holder_name &&
      prev.card.notes === next.card.notes &&
      prev.selected === next.selected &&
      prev.deletingIds === next.deletingIds &&
      prev.flashedIds === next.flashedIds &&
      prev.statusMenuId === next.statusMenuId &&
      prev.revealed === next.revealed &&
      prev.visibleCols === next.visibleCols &&
      prev.t === next.t
    )
  }
)
