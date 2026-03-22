/**
 * Card type/network badge configurations
 */

/**
 * Get badge configuration for card type
 * @param {string} cardType - Card type/network name
 * @returns {object|null} Badge config with label, color, bg
 */
export function getBinBadge(cardType) {
  if (!cardType) return null
  const t = cardType.toLowerCase()
  if (t.includes('visa'))
    return { label: 'VISA', color: '#60a5fa', bg: 'rgba(59,130,246,.15)' }
  if (t.includes('mastercard'))
    return { label: 'MC', color: '#f87171', bg: 'rgba(239,68,68,.15)' }
  if (t.includes('amex'))
    return { label: 'AMEX', color: '#4ade80', bg: 'rgba(34,197,94,.15)' }
  if (t.includes('discover'))
    return { label: 'DISC', color: '#fb923c', bg: 'rgba(249,115,22,.15)' }
  return null
}
