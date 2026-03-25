/**
 * ActionBadge - Small badge showing order action status
 */
export function ActionBadge({ action }) {
  if (!action) return null
  const cls =
    {
      shipped: 'st-transit',
      delivered: 'st-delivered',
      cancelled: 'st-cancelled',
      processing: 'st-processing',
    }[action] ?? 'st-pending'
  return <span className={`st ${cls}`}>{action}</span>
}
