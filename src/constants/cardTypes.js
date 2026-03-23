/**
 * Card type/network badge configurations
 */

import { HEX_COLORS } from './colors.js'

/**
 * Get badge configuration for card type
 * @param {string} cardType - Card type/network name
 * @returns {object|null} Badge config with label, color, bg
 */
export function getBinBadge(cardType) {
  if (!cardType) return null
  const t = cardType.toLowerCase()
  if (t.includes('visa'))
    return { label: 'VISA', color: HEX_COLORS.blueLight, bg: 'rgba(59,130,246,.15)' }
  if (t.includes('mastercard'))
    return { label: 'MC', color: HEX_COLORS.redLight, bg: 'rgba(239,68,68,.15)' }
  if (t.includes('amex'))
    return { label: 'AMEX', color: HEX_COLORS.greenLight, bg: 'rgba(34,197,94,.15)' }
  if (t.includes('discover'))
    return { label: 'DISC', color: HEX_COLORS.orangeLight, bg: 'rgba(249,115,22,.15)' }
  return null
}
