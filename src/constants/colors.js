/**
 * Centralized color constants
 * Now using CSS variables for theme support
 * All colors reference CSS custom properties from tokens-redesign.css
 */

// Raw hex colors (for contexts where CSS variables can't be used, e.g. chart series).
// Values aligned with the native macOS palette in tokens-redesign.css.
export const HEX_COLORS = {
  green: '#28cd41',
  greenLight: '#5be07a',
  yellow: '#ffcc00',
  yellowLight: '#ffd60a',
  red: '#ff3b30',
  redLight: '#ff6961',
  blue: '#0a84ff',
  blueLight: '#409cff',
  orange: '#ff9500',
  orangeLight: '#ff9f0a',
  purple: '#af52de',
  gray: '#999',
  white: '#ffffff',
  border: '#d2d2d7',
}

// Status colors
export const STATUS_COLORS = {
  success: 'var(--color-success)',
  successBg: 'var(--color-success-bg)',
  warning: 'var(--color-warning)',
  warningBg: 'var(--color-warning-bg)',
  error: 'var(--color-error)',
  errorBg: 'var(--color-error-bg)',
  info: 'var(--color-info)',
  infoBg: 'var(--color-info-bg)',
  neutral: 'var(--color-neutral)',
  neutralBg: 'var(--color-neutral-bg)',
}

// Card network colors
export const CARD_NETWORK_COLORS = {
  visa: {
    color: 'var(--color-visa)',
    bg: 'var(--color-visa-bg)',
  },
  mastercard: {
    color: 'var(--color-mastercard)',
    bg: 'var(--color-mastercard-bg)',
  },
  amex: {
    color: 'var(--color-amex)',
    bg: 'var(--color-amex-bg)',
  },
  discover: {
    color: 'var(--color-discover)',
    bg: 'var(--color-discover-bg)',
  },
}

// Risk level colors
export const RISK_COLORS = {
  high: {
    color: 'var(--color-risk-high)',
    bg: 'var(--color-risk-high-bg)',
    dot: 'dot-red',
  },
  medium: {
    color: 'var(--color-risk-medium)',
    bg: 'var(--color-risk-medium-bg)',
    dot: 'dot-yellow',
  },
  low: {
    color: 'var(--color-risk-low)',
    bg: 'var(--color-risk-low-bg)',
    dot: 'dot-green',
  },
}

// Health indicator colors
export const HEALTH_COLORS = {
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  info: 'var(--color-info)',
  bad: 'var(--color-error)',
}

// Delivery rate colors (percentage-based)
export const DELIVERY_RATE_COLORS = {
  high: 'var(--color-delivery-high)', // >= 70%
  medium: 'var(--color-delivery-medium)', // >= 40%
  low: 'var(--color-delivery-low)', // < 40%
}

/**
 * Get delivery rate color based on percentage
 * @param {number} percentage - Delivery rate percentage
 * @returns {string} Color hex code
 */
export function getDeliveryRateColor(percentage) {
  if (percentage >= 70) return DELIVERY_RATE_COLORS.high
  if (percentage >= 40) return DELIVERY_RATE_COLORS.medium
  return DELIVERY_RATE_COLORS.low
}

/**
 * Get risk level color configuration
 * @param {string} level - Risk level: 'high', 'medium', 'low'
 * @returns {object} Color configuration
 */
export function getRiskColor(level) {
  return RISK_COLORS[level] || RISK_COLORS.low
}

// Chart colors (for revenue/profit charts)
export const CHART_COLORS = {
  revenue: 'var(--color-chart-revenue)',
  profit: 'var(--color-chart-profit)',
}

// Heatmap colors (bank × shop success rate)
export const HEATMAP_COLORS = {
  high: 'var(--color-heatmap-high)', // ≥50%
  medium: 'var(--color-heatmap-medium)', // 20-50%
  low: 'var(--color-heatmap-low)', // <20%
  noData: 'var(--color-heatmap-no-data)', // <3 orders
}

// Expiring card warning colors
export const EXPIRY_COLORS = {
  urgent: 'var(--color-expiry-urgent)', // ≤14 days
  warning: 'var(--color-expiry-warning)', // ≤30 days
  normal: 'var(--color-expiry-normal)', // >30 days
}

/**
 * Get expiry warning color based on days left
 * @param {number} daysLeft - Days until expiry
 * @returns {string} Color hex code
 */
export function getExpiryColor(daysLeft) {
  if (daysLeft <= 14) return EXPIRY_COLORS.urgent
  if (daysLeft <= 30) return EXPIRY_COLORS.warning
  return EXPIRY_COLORS.normal
}
