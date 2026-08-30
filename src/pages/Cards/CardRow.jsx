import {
  Store,
  Clock,
  Copy,
  CheckCircle,
  XCircle,
  User,
  Trash2,
  HandMetal,
  Eye,
} from 'lucide-react'
import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAuth } from '../../hooks/useAuth'
import { ActionsMenu } from '../../components/ActionsMenu.jsx'
import {
  formatCardNumber,
  formatBinMasked,
  buildPipeString,
  countryFlag,
} from '../../utils/formatting.js'
import { getBinBadge } from '../../constants/cardTypes.js'
import {
  QUARANTINE_DAYS,
  MS_PER_DAY,
  BURN_COUNT_MEDIUM,
  BURN_COUNT_HIGH,
} from '../../constants/cards.js'
import { getCardHealth } from '../../utils/cardHealth.js'
import { CARD_STATUS_CSS } from '../../constants/status.js'
import { ExpiryCell } from './ExpiryCell.jsx'
import { NoteCell } from './NoteCell.jsx'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'
import { useCardRowCtx } from './cardRowContext.js'

/**
 * CardRow — мемоизированный компонент строки карты
 *
 * ★ Insight: React.memo предотвращает ре-рендер при изменении других карт.
 * CLEAN-009: всё окружение (коллбэки, t, toast, состояния) приходит из
 * CardRowContext — сюда пропсами идут только card и index, поэтому
 * дефолтного shallow compare memo достаточно (per-row пропсы стабильны,
 * пока карта не изменилась).
 */
export const CardRow = React.memo(function CardRow({ card, index }) {
  const {
    revealed,
    selected,
    deletingIds,
    flashedIds,
    statusMenuId,
    visibleCols,
    toggleSelect,
    setSideCard,
    setStatusMenuId,
    handleStatusChange,
    handleCopyToast,
    handleEditNote,
    setShopUsageCardId,
    setTimelineCardId,
    handleDelete,
    setFilters: setFilter,
    setPage,
    onNavigate,
    revealCard,
    t,
    toast,
    rowReorder,
    rowDragStart,
    rowDragOver,
    rowDragLeave,
    rowDragEnd,
    rowDrop,
  } = useCardRowCtx()
  const { hasPerm } = useAuth()
  const canTake = hasPerm('take_cards')
  const canReveal = hasPerm('view_own_cards_full')
  const rev = revealed[card.id]
  const displayNum = rev?.card_number
    ? formatCardNumber(rev.card_number)
    : formatBinMasked(card.bin, card.last4)
  const statusCls = CARD_STATUS_CSS[card.status] ?? 'st-archive'
  const statusLabel = card.status === 'in_use' ? 'in use' : card.status
  const badge = getBinBadge(card.card_type)
  const burnCount = card.orders_count ?? 0
  const isFlashing = flashedIds.includes(card.id)

  // P2-QUARANTINE: Check if card is in quarantine (моложе QUARANTINE_DAYS)
  // Note: We use created_at as fallback since acquired_at may be null for older imports
  const { isQuarantined, daysOld } = React.useMemo(() => {
    const acquiredDate = card.acquired_at || card.created_at
    if (!acquiredDate) return { isQuarantined: false, daysOld: null }
    const acquired = new Date(acquiredDate).getTime()
    const now = new Date().getTime()
    const days = (now - acquired) / MS_PER_DAY
    return { isQuarantined: days < QUARANTINE_DAYS, daysOld: Math.floor(days) }
  }, [card.acquired_at, card.created_at])

  const quarantineTooltip = isQuarantined
    ? `${t('card_in_quarantine') || 'Card in quarantine'} — ${daysOld} ${t('cc_days_old') || 'days old'}`
    : null

  const rowClasses = [
    'card-row',
    isFlashing && 'row-flash',
    selected.includes(card.id) && 'card-row-selected',
    card.status === 'free' && 'card-row-free',
    card.status === 'dead' && 'card-row-dead',
    card.status === 'in_use' && 'card-row-in-use',
    isQuarantined && 'card-row-quarantined', // Visual indicator for quarantine
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
        setSideCard(card, index)
      }}
      onDragOver={rowReorder ? rowDragOver : undefined}
      onDragLeave={rowReorder ? rowDragLeave : undefined}
      onDrop={rowReorder ? e => rowDrop(e, card.id) : undefined}
    >
      {/* Checkbox + UX-011 grip для ручного порядка строк */}
      <td onClick={e => e.stopPropagation()}>
        {rowReorder && (
          <span
            className="row-grip"
            draggable
            onDragStart={e => rowDragStart(e, card.id)}
            onDragEnd={rowDragEnd}
            title={t('row_drag_title')}
            aria-label={t('row_drag_title')}
          >
            ⠿
          </span>
        )}
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
            <span className="mono text-12">{displayNum}</span>
            {!rev && canReveal && (
              <button
                onClick={e => {
                  e.stopPropagation()
                  // revealCard пробрасывает ошибку дальше (store/cards.js),
                  // а обработчик не async — без .catch это был настоящий
                  // unhandled rejection: по клику не происходило ничего.
                  // Чаще всего это отказ по владельцу карты: право
                  // view_own_cards_full есть, но карта закреплена за другим.
                  Promise.resolve(revealCard?.(card.id)).catch(err => {
                    toast(getErrorMessage(err, 'CardRow.reveal'), 'error')
                  })
                }}
                className="btn btn-ghost btn-sm btn-compact"
                title={t('cc_reveal') || 'Reveal'}
                aria-label={`Reveal full details for card ending in ${card.last4}`}
              >
                <Eye size={13} className="icon-sm" aria-hidden="true" />
              </button>
            )}
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
              handleCopyToast(rev.cvv, true)
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
          <span className="bin-badge">{card.bin || '——'}</span>
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
            <span className="ml-1 text-11 text-muted manrope">{card.card_level}</span>
          )}
        </td>
      )}

      {/* Source */}
      {visibleCols.includes('source') && (
        <td className="cell-text-sm cell-truncate-sm">{card.source || '—'}</td>
      )}

      {/* Domain — click to filter */}
      {visibleCols.includes('domain') && (
        <td>
          {card.domain ? (
            <span
              onClick={e => {
                e.stopPropagation()
                setFilter(f => ({ ...f, domain: card.domain }))
                setPage(1)
              }}
              className="filter-link-badge domain-badge"
              title={`${t('filter_by') || 'Filter by'} ${card.domain}`}
            >
              {card.domain}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
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
                className={`burn-count burn-${
                  burnCount >= BURN_COUNT_HIGH
                    ? 'high'
                    : burnCount >= BURN_COUNT_MEDIUM
                      ? 'medium'
                      : 'low'
                }`}
                title={t('used_in_orders').replace('{n}', burnCount)}
              >
                ×{burnCount}
              </span>
            )}
            {isQuarantined && (
              <span
                className="quarantine-badge"
                title={
                  quarantineTooltip || 'Card in quarantine - wait 14 days from acquisition date'
                }
              >
                ⏳ {daysOld}d
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
            if (!h) return <span className="text-muted text-11 manrope">—</span>
            return <span className={`st ${h.cls} text-10 manrope`}>{h.label}</span>
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
        <td className="text-muted text-11 whitespace-nowrap mono">{card.created_at}</td>
      )}

      {/* Email / IP / email_cc */}
      {visibleCols.includes('email_cc') && (
        <td className="text-11 text-text-2 manrope">{rev?.email || '—'}</td>
      )}
      {visibleCols.includes('ip') && (
        <td className="text-11 text-text-2 mono">
          {rev?.ip_address || card.ip_address ? (
            <span className="ip-badge" title="IP address from log">
              🌐 {rev?.ip_address || card.ip_address}
            </span>
          ) : (
            '—'
          )}
        </td>
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
                  handleCopyToast(num, !!rev?.card_number)
                },
              },
              {
                label: t('cards_copy_full'),
                icon: Copy,
                onClick: () => handleCopyToast(buildPipeString(card, rev), !!rev),
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
              ...(canTake && card.status === 'free'
                ? [
                    {
                      label: 'Взять карту',
                      icon: HandMetal,
                      onClick: async () => {
                        try {
                          await invoke('take_card', { cardId: card.id })
                          toast('Карта закреплена за вами', 'success')
                        } catch (e) {
                          const msg = String(e).includes('card_already_assigned')
                            ? 'Карта уже назначена другому оператору'
                            : String(e)
                          toast(msg, 'error')
                        }
                      },
                    },
                  ]
                : []),
              {
                label: t('new_profile'),
                icon: User,
                onClick: async () => {
                  try {
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
})
