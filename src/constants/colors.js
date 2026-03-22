/**
 * Centralized color constants
 * Extracted from 268+ hardcoded color instances across the codebase
 */

// Status colors
export const STATUS_COLORS = {
  success: '#4ade80',
  successBg: 'rgba(34, 197, 94, 0.1)',
  warning: '#facc15',
  warningBg: 'rgba(234, 179, 8, 0.1)',
  error: '#f87171',
  errorBg: 'rgba(239, 68, 68, 0.1)',
  info: '#60a5fa',
  infoBg: 'rgba(59, 130, 246, 0.1)',
  neutral: '#999',
  neutralBg: 'rgba(156, 163, 175, 0.1)',
}

// Card network colors
export const CARD_NETWORK_COLORS = {
  visa: {
    color: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.15)',
  },
  mastercard: {
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.15)',
  },
  amex: {
    color: '#4ade80',
    bg: 'rgba(34, 197, 94, 0.15)',
  },
  discover: {
    color: '#fb923c',
    bg: 'rgba(249, 115, 22, 0.15)',
  },
}

// Risk level colors
export const RISK_COLORS = {
  high: {
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.12)',
    dot: 'dot-red',
  },
  medium: {
    color: '#facc15',
    bg: 'rgba(234, 179, 8, 0.12)',
    dot: 'dot-yellow',
  },
  low: {
    color: '#4ade80',
    bg: 'rgba(34, 197, 94, 0.12)',
    dot: 'dot-green',
  },
}

// Health indicator colors
export const HEALTH_COLORS = {
  good: '#4ade80',
  warn: '#facc15',
  info: '#60a5fa',
  bad: '#f87171',
}

// Delivery rate colors (percentage-based)
export const DELIVERY_RATE_COLORS = {
  high: '#22c55e', // >= 70%
  medium: '#eab308', // >= 40%
  low: '#ef4444', // < 40%
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
  revenue: '#3b82f6',
  profit: '#22c55e',
}

// Heatmap colors (bank × shop success rate)
export const HEATMAP_COLORS = {
  high: 'rgba(34,197,94,0.65)', // ≥50%
  medium: 'rgba(234,179,8,0.55)', // 20-50%
  low: 'rgba(239,68,68,0.65)', // <20%
  noData: 'var(--border)', // <3 orders
}

/**
 * Get heatmap color based on success rate
 * @param {number} rate - Success rate percentage (-1 for no data)
 * @returns {string} Color value
 */
export function getHeatmapColor(rate) {
  if (rate < 0) return HEATMAP_COLORS.noData
  if (rate < 20) return HEATMAP_COLORS.low
  if (rate < 50) return HEATMAP_COLORS.medium
  return HEATMAP_COLORS.high
}

// Expiring card warning colors
export const EXPIRY_COLORS = {
  urgent: '#f87171', // ≤14 days
  warning: '#facc15', // ≤30 days
  normal: '#4ade80', // >30 days
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
