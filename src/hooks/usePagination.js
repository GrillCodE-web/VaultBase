import { useState, useMemo, useCallback } from 'react'
import {
  DEFAULT_PAGE_SIZE,
  getTotalPages,
  getPageRange,
  buildPageNumbers,
} from '../utils/pagination'

/**
 * ARCH-012: Reusable pagination hook
 * @param {number} total - Total item count
 * @param {number} [pageSize=DEFAULT_PAGE_SIZE]
 * @returns {{ page, setPage, totalPages, pageNumbers, from, to, goNext, goPrev, goFirst, goLast }}
 */
export function usePagination(total, pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1)

  const totalPages = useMemo(() => getTotalPages(total, pageSize), [total, pageSize])

  const safePage = Math.min(page, totalPages)
  if (safePage !== page) setPage(safePage)

  const pageNumbers = useMemo(() => buildPageNumbers(safePage, totalPages), [safePage, totalPages])
  const { from, to } = useMemo(
    () => getPageRange(safePage, total, pageSize),
    [safePage, total, pageSize]
  )

  const goNext = useCallback(() => setPage(p => Math.min(p + 1, totalPages)), [totalPages])
  const goPrev = useCallback(() => setPage(p => Math.max(p - 1, 1)), [])
  const goFirst = useCallback(() => setPage(1), [])
  const goLast = useCallback(() => setPage(totalPages), [totalPages])

  return {
    page: safePage,
    setPage,
    totalPages,
    pageNumbers,
    from,
    to,
    goNext,
    goPrev,
    goFirst,
    goLast,
    pageSize,
  }
}
