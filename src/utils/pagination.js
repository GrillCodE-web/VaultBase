/**
 * Pagination utilities
 */

/**
 * Default page size for paginated lists
 */
export const DEFAULT_PAGE_SIZE = 50

/**
 * Calculate total number of pages
 * @param {number} total - Total number of items
 * @param {number} pageSize - Items per page (default: DEFAULT_PAGE_SIZE)
 * @returns {number} Total number of pages (minimum 1)
 */
export function getTotalPages(total, pageSize = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * Calculate from/to range for current page
 * @param {number} page - Current page (1-indexed)
 * @param {number} total - Total number of items
 * @param {number} pageSize - Items per page (default: DEFAULT_PAGE_SIZE)
 * @returns {{from: number, to: number}} Range object with from and to values
 */
export function getPageRange(page, total, pageSize = DEFAULT_PAGE_SIZE) {
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return { from, to }
}

/**
 * Build page numbers array for pagination
 * @param {number} current - Current page (1-indexed)
 * @param {number} total - Total pages
 * @returns {Array} Array of page numbers with ellipsis ("…")
 */
export function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}
