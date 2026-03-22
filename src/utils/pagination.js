/**
 * Pagination utilities
 */

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
  for (
    let p = Math.max(2, current - 1);
    p <= Math.min(total - 1, current + 1);
    p++
  )
    pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}
