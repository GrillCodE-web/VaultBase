/**
 * Pagination utilities
 */

/** Default page size for paginated lists */
export const DEFAULT_PAGE_SIZE = 50

export interface PageRange {
  from: number
  to: number
}

/** Calculate total number of pages (minimum 1) */
export function getTotalPages(total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/** Calculate from/to range for current page (1-indexed) */
export function getPageRange(
  page: number,
  total: number,
  pageSize: number = DEFAULT_PAGE_SIZE
): PageRange {
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return { from, to }
}

/** Build page numbers array for pagination (with "..." ellipsis) */
export function buildPageNumbers(current: number, total: number): Array<number | '...'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | '...'> = [1]
  if (current > 3) pages.push('...')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}
