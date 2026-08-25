import { useState, useMemo, useCallback } from 'react'
import {
  DEFAULT_PAGE_SIZE,
  getTotalPages,
  getPageRange,
  buildPageNumbers,
} from '../utils/pagination'

export type PageNumber = number | '...'

export interface UsePaginationResult {
  page: number
  setPage: (p: number) => void
  totalPages: number
  pageNumbers: PageNumber[]
  from: number
  to: number
  goNext: () => void
  goPrev: () => void
  goFirst: () => void
  goLast: () => void
  pageSize: number
}

/**
 * ARCH-012: Reusable pagination hook
 */
export function usePagination(total: number, pageSize: number = DEFAULT_PAGE_SIZE): UsePaginationResult {
  const [page, setPage] = useState<number>(1)

  const totalPages = useMemo(() => getTotalPages(total, pageSize), [total, pageSize])

  const safePage = Math.min(page, totalPages)
  if (safePage !== page) setPage(safePage)

  const pageNumbers = useMemo(
    () => buildPageNumbers(safePage, totalPages) as PageNumber[],
    [safePage, totalPages]
  )
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
