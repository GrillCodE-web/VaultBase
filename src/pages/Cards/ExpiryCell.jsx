import { AlertTriangle } from 'lucide-react'
import React from 'react'
import { expiryDaysLeft } from '../../utils/formatting.js'
import { EXPIRY_SOON_DAYS, EXPIRY_CRITICAL_DAYS } from '../../constants/cards.js'

/**
 * ExpiryCell — мемоизированный компонент даты истечения
 *
 * ★ Insight: Предотвращает лишние ре-рендеры при изменении других ячеек
 */
export const ExpiryCell = React.memo(
  function ExpiryCell({ expiry, t }) {
    if (!expiry) return <span className="text-muted">—</span>
    const days = expiryDaysLeft(expiry)
    const isExpired = days !== null && days < 0
    const isCritical = days !== null && days >= 0 && days < EXPIRY_CRITICAL_DAYS
    const isSoon = days !== null && days >= EXPIRY_CRITICAL_DAYS && days < EXPIRY_SOON_DAYS

    const statusClass = isExpired ? 'expired' : isCritical ? 'critical' : isSoon ? 'soon' : 'normal'

    return (
      <span className={`expiry-cell ${statusClass}`}>
        {isCritical && <AlertTriangle size={11} title={t('flag_card_expiring')} />}
        {expiry}
      </span>
    )
  },
  (prev, next) => {
    return prev.expiry === next.expiry && prev.t === next.t
  }
)
