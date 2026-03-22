/**
 * Card health and status utilities
 */

import { isCardExpired } from './formatting.js'

/**
 * Get card health status with label, CSS class, and color
 * @param {object} card - Card object with status, expiry_date, orders_count
 * @returns {object|null} Health status with label, cls, dot properties
 */
export function getCardHealth(card) {
  const orderCount = card.orders_count ?? 0
  if (card.status === 'dead') {
    return { label: 'Burned', cls: 'st-dead', dot: '#ef4444' }
  }
  if (isCardExpired(card.expiry_date)) {
    return { label: 'Expired', cls: 'st-dead', dot: '#ef4444' }
  }
  if (card.status === 'in_use' && orderCount >= 3) {
    return { label: 'Used', cls: 'st-inuse', dot: '#eab308' }
  }
  if (card.status === 'free') {
    return { label: 'Fresh', cls: 'st-free', dot: '#22c55e' }
  }
  return null
}
