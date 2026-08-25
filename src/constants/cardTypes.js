/**
 * Card type/network badge configurations.
 * UX-001: colors reference theme tokens (tokens.css) — payment network
 * chips (--color-visa/mastercard/amex/discover, AA in both themes).
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
    return { label: 'VISA', color: 'var(--color-visa)', bg: 'var(--color-visa-bg)' }
  if (t.includes('mastercard'))
    return { label: 'MC', color: 'var(--color-mastercard)', bg: 'var(--color-mastercard-bg)' }
  if (t.includes('amex'))
    return { label: 'AMEX', color: 'var(--color-amex)', bg: 'var(--color-amex-bg)' }
  if (t.includes('discover'))
    return { label: 'DISC', color: 'var(--color-discover)', bg: 'var(--color-discover-bg)' }
  return null
}
