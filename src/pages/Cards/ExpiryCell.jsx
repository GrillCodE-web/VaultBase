import { AlertTriangle } from 'lucide-react'
import { expiryDaysLeft } from '../../utils/formatting.js'

export function ExpiryCell({ expiry, t }) {
  if (!expiry) return <span className="text-muted">—</span>
  const days = expiryDaysLeft(expiry)
  const isExpired = days !== null && days < 0
  const isCritical = days !== null && days >= 0 && days < 7
  const isSoon = days !== null && days >= 7 && days < 30

  const statusClass = isExpired ? 'expired' : isCritical ? 'critical' : isSoon ? 'soon' : 'normal'

  return (
    <span className={`expiry-cell ${statusClass}`}>
      {isCritical && <AlertTriangle size={11} title={t('flag_card_expiring')} />}
      {expiry}
    </span>
  )
}
