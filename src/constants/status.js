/**
 * Card and order status definitions with colors
 */

import { HEX_COLORS } from './colors.js'

export const CARD_STATUS = {
  FREE: 'free',
  IN_USE: 'in_use',
  DEAD: 'dead',
  ARCHIVE: 'archive',
}

export const CARD_STATUS_COLORS = {
  [CARD_STATUS.FREE]: {
    bg: 'rgba(34, 197, 94, 0.1)',
    text: HEX_COLORS.greenLight,
    label: 'Free',
  },
  [CARD_STATUS.IN_USE]: {
    bg: 'rgba(59, 130, 246, 0.1)',
    text: HEX_COLORS.blueLight,
    label: 'In Use',
  },
  [CARD_STATUS.DEAD]: {
    bg: 'rgba(239, 68, 68, 0.1)',
    text: HEX_COLORS.redLight,
    label: 'Dead',
  },
  [CARD_STATUS.ARCHIVE]: {
    bg: 'rgba(156, 163, 175, 0.1)',
    text: HEX_COLORS.gray,
    label: 'Archive',
  },
}

export const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  FAILED: 'failed',
}

export const ORDER_STATUS_COLORS = {
  [ORDER_STATUS.PENDING]: {
    bg: 'rgba(234, 179, 8, 0.1)',
    text: HEX_COLORS.yellowLight,
    label: 'Pending',
  },
  [ORDER_STATUS.PROCESSING]: {
    bg: 'rgba(59, 130, 246, 0.1)',
    text: HEX_COLORS.blueLight,
    label: 'Processing',
  },
  [ORDER_STATUS.SHIPPED]: {
    bg: 'rgba(168, 85, 247, 0.1)',
    text: HEX_COLORS.purple,
    label: 'Shipped',
  },
  [ORDER_STATUS.DELIVERED]: {
    bg: 'rgba(34, 197, 94, 0.1)',
    text: HEX_COLORS.greenLight,
    label: 'Delivered',
  },
  [ORDER_STATUS.CANCELLED]: {
    bg: 'rgba(156, 163, 175, 0.1)',
    text: HEX_COLORS.gray,
    label: 'Cancelled',
  },
  [ORDER_STATUS.REFUNDED]: {
    bg: 'rgba(251, 146, 60, 0.1)',
    text: HEX_COLORS.orangeLight,
    label: 'Refunded',
  },
  [ORDER_STATUS.FAILED]: {
    bg: 'rgba(239, 68, 68, 0.1)',
    text: HEX_COLORS.redLight,
    label: 'Failed',
  },
}

/**
 * Get status color configuration
 * @param {string} status - Status value
 * @param {string} type - 'card' or 'order'
 * @returns {object} Color configuration with bg, text, label
 */
export function getStatusColor(status, type = 'card') {
  const colors = type === 'card' ? CARD_STATUS_COLORS : ORDER_STATUS_COLORS
  return colors[status] || { bg: 'rgba(156, 163, 175, 0.1)', text: HEX_COLORS.gray, label: status }
}

// Order status workflow steps
export const ORDER_STATUS_STEPS = ['pending', 'processing', 'shipped', 'delivered']

// All possible order statuses
export const ORDER_STATUSES = [
  'pending',
  'processing',
  'shipped',
  'in_transit',
  'delivered',
  'declined',
  'cancelled',
]

// Status dot colors for order timeline
export const ORDER_STATUS_DOT_COLORS = {
  pending: 'var(--yellow-t)',
  processing: 'var(--blue-t)',
  shipped: 'var(--blue-t)',
  in_transit: 'var(--cyan-t)',
  delivered: 'var(--green-t)',
  declined: 'var(--red-t)',
  cancelled: 'var(--text-2)',
}

// Card status CSS class mappings
export const CARD_STATUS_CSS = {
  free: 'st-free',
  in_use: 'st-inuse',
  dead: 'st-dead',
  archive: 'st-archive',
}

// Order status CSS class mappings
export const ORDER_STATUS_CSS = {
  pending: 'st-pending',
  processing: 'st-inuse',
  shipped: 'st-transit',
  delivered: 'st-delivered',
  declined: 'st-decline',
  cancelled: 'st-archive',
}
