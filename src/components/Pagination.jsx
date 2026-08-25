import { buildPageNumbers } from '../utils/pagination.js'

/**
 * Pagination — общая постраничная навигация таблиц (Orders, Profiles).
 *
 * ★ Insight: один и тот же блок пагинации копировался между страницами —
 * теперь рендер и классы живут в одном месте.
 */
export function Pagination({ page, totalPages, total, onPageChange, label = '' }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-3">
      <span className="text-[12px] text-muted">
        {total} {label}
      </span>
      <div className="flex gap-1">
        {buildPageNumbers(page, totalPages).map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-2 py-1 text-[12px] text-muted">
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`btn btn-ghost btn-sm${page === p ? ' active pagination-btn-active' : ''}`}
            >
              {p}
            </button>
          )
        )}
      </div>
    </div>
  )
}
