/**
 * Card and order status definitions.
 * UX-007: colors reference theme tokens (tokens.css) so status badges
 * meet WCAG AA (>= 4.5:1) in both light and dark themes.
 */

export const CARD_STATUS = {
  FREE: 'free',
  IN_USE: 'in_use',
  DEAD: 'dead',
  ARCHIVE: 'archive',
}

export const CARD_STATUS_COLORS = {
  [CARD_STATUS.FREE]: {
    bg: 'var(--color-card-free-bg)',
    text: 'var(--color-card-free)',
    label: 'Free',
  },
  [CARD_STATUS.IN_USE]: {
    bg: 'var(--color-card-in-use-bg)',
    text: 'var(--color-card-in-use)',
    label: 'In Use',
  },
  [CARD_STATUS.DEAD]: {
    bg: 'var(--color-card-dead-bg)',
    text: 'var(--color-card-dead)',
    label: 'Dead',
  },
  [CARD_STATUS.ARCHIVE]: {
    bg: 'var(--color-card-archive-bg)',
    text: 'var(--color-card-archive)',
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

// REDESIGN-05-0: фоны — только токены --st-* (tokens.css — единственный источник).
export const ORDER_STATUS_COLORS = {
  [ORDER_STATUS.PENDING]: {
    bg: 'var(--st-yellow-bg)',
    text: 'var(--yellow-t)',
    label: 'Pending',
  },
  [ORDER_STATUS.PROCESSING]: {
    bg: 'var(--st-blue-bg)',
    text: 'var(--blue-t)',
    label: 'Processing',
  },
  [ORDER_STATUS.SHIPPED]: {
    bg: 'var(--st-purple-bg)',
    text: 'var(--purple-t)',
    label: 'Shipped',
  },
  [ORDER_STATUS.DELIVERED]: {
    bg: 'var(--st-green-bg)',
    text: 'var(--green-t)',
    label: 'Delivered',
  },
  [ORDER_STATUS.CANCELLED]: {
    bg: 'var(--st-gray-bg)',
    text: 'var(--text-2)',
    label: 'Cancelled',
  },
  [ORDER_STATUS.REFUNDED]: {
    bg: 'var(--st-orange-bg)',
    text: 'var(--orange-t)',
    label: 'Refunded',
  },
  [ORDER_STATUS.FAILED]: {
    bg: 'var(--st-red-bg)',
    text: 'var(--red-t)',
    label: 'Failed',
  },
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
