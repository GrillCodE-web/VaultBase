/**
 * Formatting utilities for cards, dates, and display
 */

/**
 * Convert country code to flag emoji
 * @param {string} code - Two-letter country code (e.g., "US", "GB")
 * @returns {string} Flag emoji or empty string
 */
export function countryFlag(code) {
  if (!code || code.length !== 2) return ''
  const offset = 0x1f1a5
  return (
    String.fromCodePoint(code.toUpperCase().charCodeAt(0) + offset) +
    String.fromCodePoint(code.toUpperCase().charCodeAt(1) + offset)
  )
}

/**
 * Normalize expiry date to MM/YY format
 * Handles formats: MMYY, MM/YY, MM/YYYY, YYYY-MM, Month YYYY
 * @param {string} raw - Raw expiry date string
 * @returns {string|null} Normalized MM/YY or null if invalid
 */
export function normalizeExpiry(raw) {
  if (!raw) return null
  const s = String(raw).trim()

  // 1226 or 0126 → 12/26
  if (/^\d{4}$/.test(s)) {
    return `${s.slice(0, 2)}/${s.slice(2)}`
  }

  // 12/26 or 1/26 or 12/2026 or 1/2027
  const slash = s.match(/^(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    const mm = slash[1].padStart(2, '0')
    const yy = slash[2].length === 4 ? slash[2].slice(2) : slash[2]
    return `${mm}/${yy}`
  }

  // 2026-12 ISO reversed
  const iso = s.match(/^(\d{4})-(\d{2})$/)
  if (iso) return `${iso[2]}/${iso[1].slice(2)}`

  // Jan 2026, January 2026, Jan/26, jan 26
  const MONTHS = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  }
  const named = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s/-](\d{2,4})$/)
  if (named && MONTHS[named[1]]) {
    const yy = named[2].length === 4 ? named[2].slice(2) : named[2]
    return `${MONTHS[named[1]]}/${yy}`
  }

  return null // unrecognised
}

/**
 * Calculate days until expiry
 * @param {string} expiry - Expiry date in MM/YY format
 * @returns {number|null} Days remaining or null if invalid
 */
export function expiryDaysLeft(expiry) {
  if (!expiry) return null
  const [mm, yy] = expiry.split('/')
  if (!mm || !yy) return null
  const month = parseInt(mm, 10)
  const year = 2000 + parseInt(yy, 10)
  if (isNaN(month) || isNaN(year)) return null
  const expires = new Date(year, month, 0)
  return Math.floor((expires - new Date()) / 86400000)
}

/**
 * Check if card is expired
 * @param {string} expiryDate - Expiry date in any format
 * @returns {boolean} True if expired
 */
export function isCardExpired(expiryDate) {
  const norm = normalizeExpiry(expiryDate)
  if (!norm) return false
  const days = expiryDaysLeft(norm)
  return days !== null && days < 0
}

/**
 * Format card number by removing non-digits
 * @param {string} num - Card number
 * @returns {string} Card number with only digits
 */
export function formatCardNumber(num) {
  return num.replace(/\D/g, '')
}

/**
 * Format BIN and last 4 digits with masking
 * @param {string} bin - First 6 digits
 * @param {string} last4 - Last 4 digits
 * @returns {string} Formatted as "123456****1234" or "••••••••••••1234"
 */
export function formatBinMasked(bin, last4) {
  if (!bin || bin.length < 6) return `••••••••••••${last4 || '????'}`
  return `${bin.slice(0, 6)}****${last4 || '????'}`
}

/**
 * Build pipe-delimited string for card data export
 * Format: Number|Exp|CVV|Holder|Address|ZIP|City|State|Country|Phone
 * @param {object} card - Card object
 * @param {object} rev - Revealed card data (optional)
 * @returns {string} Pipe-delimited string
 */
export function buildPipeString(card, rev) {
  const num = rev?.card_number
    ? rev.card_number.replace(/\D/g, '')
    : `${card.bin ?? ''}**${card.last4 ?? ''}`
  return [
    num,
    rev?.expiry_date || card.expiry_date || '',
    rev?.cvv || '',
    rev?.holder_name || card.holder_name || '',
    rev?.billing_address || '',
    card.zip || '',
    card.city || '',
    card.state || '',
    card.country || '',
    rev?.phone || '',
  ].join('|')
}

/**
 * Format ID to short uppercase version (last 8 characters)
 * @param {string} id - Full ID string
 * @returns {string} Short ID or "—" if empty
 */
export function shortId(id) {
  return id ? id.slice(-8).toUpperCase() : '—'
}

/**
 * Convert ISO timestamp to relative time string
 * @param {string} isoStr - ISO 8601 timestamp
 * @returns {string} Relative time (e.g., "5m ago", "2h ago", "3d ago")
 */
export function timeAgo(isoStr) {
  if (!isoStr) return 'Never'
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

/**
 * Format number as currency with $ symbol and thousand separators
 * @param {number} value - Numeric value
 * @returns {string} Formatted currency (e.g., "$1,234.56")
 */
export function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0.00'
  return `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

/**
 * Format number with thousand separators
 * @param {number} value - Numeric value
 * @returns {string} Formatted number (e.g., "1,234")
 */
export function formatNumber(value) {
  if (value == null || isNaN(value)) return '0'
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Format ISO date to short date (YYYY-MM-DD)
 * @param {string} isoDate - ISO 8601 date string
 * @returns {string} Short date (e.g., "2024-03-23") or "—" if empty
 */
export function formatDateShort(isoDate) {
  if (!isoDate) return '—'
  return isoDate.slice(0, 10)
}

/**
 * Format ISO datetime to datetime without seconds (YYYY-MM-DD HH:MM)
 * @param {string} isoDate - ISO 8601 datetime string
 * @returns {string} Datetime (e.g., "2024-03-23 14:30") or "—" if empty
 */
export function formatDateTime(isoDate) {
  if (!isoDate) return '—'
  return isoDate.slice(0, 16).replace('T', ' ')
}
