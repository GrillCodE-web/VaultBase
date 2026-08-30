import { useRef, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CreditCard } from 'lucide-react'
import { EmptyState } from '../../components/EmptyState.jsx'
import { SkeletonRows } from '../../components/SkeletonRow.jsx'
import { CardRow } from './CardRow.jsx'
import { CardRowContext } from './cardRowContext.js'
import { CARDS_VIRTUAL_THRESHOLD } from '../../constants/cards.js'
import { CARDS_OVERSCAN } from '../../constants/virtualization.js'

/**
 * CardTable — выделённый компонент таблицы карт
 *
 * ★ Insight: Таблица, grouping, virtualization, drag-drop колонок здесь,
 * чтобы уменьшить Cards.jsx.
 * CLEAN-009: окружение строк (коллбэки, t, toast, состояния) уходит в
 * CardRowContext — CardRow получает только card и index, проп-дриллинг
 * 20+ одинаковых пропсов устранён.
 */
export function CardTable({
  cards,
  loading,
  onRowMove,
  visibleCols,
  ALL_COLUMNS,
  columnOrder,
  setColumnOrder,
  groupByBank,
  t,
  toast,
  // Cards store + UI store
  toggleSelect,
  toggleSelectAll,
  selected,
  deletingIds,
  revealed,
  revealCard,
  flashedIds,
  statusMenuId,
  setStatusMenuId,
  setShopUsageCardId,
  setTimelineCardId,
  // Handlers from Cards.jsx
  handleStatusChange,
  handleDelete,
  handleCopyToast,
  handleEditNote,
  setFilters,
  setPage,
  onNavigate,
  // For side panel
  setSideCard,
}) {
  const dragColRef = useRef(null)
  const dragRowRef = useRef(null)
  const parentRef = useRef(null)

  // ── UX-011: drag & drop строк (группировка по банку отключает ручной порядок) ──
  const rowReorder = !groupByBank && typeof onRowMove === 'function'
  // Хэндлеры стабильны (useCallback + ref) — не ломают React.memo строк
  const rowDragStart = useCallback((e, id) => {
    dragRowRef.current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }, [])
  const rowDragOver = useCallback(e => {
    if (dragRowRef.current == null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const tr = e.currentTarget
    if (!tr.classList.contains('row-drop-target')) tr.classList.add('row-drop-target')
  }, [])
  const rowDragLeave = useCallback(e => {
    e.currentTarget.classList.remove('row-drop-target')
  }, [])
  const rowDrop = useCallback(
    (e, targetId) => {
      e.preventDefault()
      e.currentTarget.classList.remove('row-drop-target')
      const srcId = dragRowRef.current
      dragRowRef.current = null
      if (srcId == null) return
      onRowMove?.(srcId, targetId)
    },
    [onRowMove]
  )
  const rowDragEnd = useCallback(() => {
    dragRowRef.current = null
    parentRef.current
      ?.querySelectorAll('.row-drop-target')
      .forEach(el => el.classList.remove('row-drop-target'))
  }, [])

  // ── CLEAN-009: окружение строки — один мемоизированный объект контекста ──
  // index вычисляется внутри CardRow по его prop index (двойной клик → сайд-панель)
  const rowCtx = useMemo(
    () => ({
      revealed,
      selected,
      deletingIds,
      flashedIds,
      statusMenuId,
      visibleCols,
      toggleSelect,
      setSideCard,
      setStatusMenuId,
      handleStatusChange,
      handleCopyToast,
      handleEditNote,
      setShopUsageCardId,
      setTimelineCardId,
      handleDelete,
      setFilters,
      setPage,
      onNavigate,
      revealCard,
      t,
      toast,
      rowReorder,
      rowDragStart,
      rowDragOver,
      rowDragLeave,
      rowDragEnd,
      rowDrop,
    }),
    [
      revealed,
      selected,
      deletingIds,
      flashedIds,
      statusMenuId,
      visibleCols,
      toggleSelect,
      setSideCard,
      setStatusMenuId,
      handleStatusChange,
      handleCopyToast,
      handleEditNote,
      setShopUsageCardId,
      setTimelineCardId,
      handleDelete,
      setFilters,
      setPage,
      onNavigate,
      revealCard,
      t,
      toast,
      rowReorder,
      rowDragStart,
      rowDragOver,
      rowDragLeave,
      rowDragEnd,
      rowDrop,
    ]
  )

  // ── Grouped render ─────────────────────────────────────────────────────

  const groupedCards = useMemo(
    () =>
      Object.entries(
        cards.reduce((acc, c) => {
          const k = c.bank_name || 'No data' // ★ Insight: Хардкод вместо t() предотвращает пересчет при смене языка
          ;(acc[k] = acc[k] || []).push(c)
          return acc
        }, {})
      ).sort((a, b) => a[0].localeCompare(b[0])),
    [cards] // Убран t из зависимостей — группировка не зависит от перевода
  )

  // Virtual scrolling setup - only for non-grouped view
  // ★ Insight: Порог CARDS_VIRTUAL_THRESHOLD (50) карт вместо 200 — виртуализация включается раньше
  // overscan — CARDS_OVERSCAN (constants/virtualization.js), CLEAN-010
  const useVirtualCards = !groupByBank && cards.length > CARDS_VIRTUAL_THRESHOLD

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer из @tanstack/react-virtual совместим с React 19
  const rowVirtualizer = useVirtualizer({
    count: useVirtualCards ? cards.length : 0,
    getScrollElement: () => parentRef.current,
    // REDESIGN-05-2: --row-pad 11px/6px вместо фикс-высоты --h-row.
    // Замерено Playwright'ом: comfortable ≈ 49px, compact ≈ 39px
    // (e2e измерение при переводе таблиц на --row-pad).
    estimateSize: () => 49,
    overscan: CARDS_OVERSCAN,
    enabled: useVirtualCards,
  })

  const renderRows = () => {
    if (!groupByBank) {
      if (useVirtualCards) {
        const virtualItems = rowVirtualizer.getVirtualItems()
        return (
          <>
            {virtualItems.length > 0 && <tr style={{ height: virtualItems[0].start }} />}
            {virtualItems.map(virtualRow => {
              const card = cards[virtualRow.index]
              return <CardRow key={card.id} card={card} index={virtualRow.index} />
            })}
            {virtualItems.length > 0 && (
              <tr
                style={{
                  height: rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end,
                }}
              />
            )}
          </>
        )
      }
      return cards.map((card, index) => <CardRow key={card.id} card={card} index={index} />)
    }
    return groupedCards.map(([bank, groupCards]) => (
      <tbody key={bank}>
        <tr>
          <td
            colSpan={99}
            className="bg-surface text-muted text-10 font-bold border-b uppercase tracking-wide py-[5px] px-2.5"
          >
            {bank} · {groupCards.length} {t('cards')} ·{' '}
            {groupCards.filter(c => c.status === 'free').length} {t('status_free')}
          </td>
        </tr>
        {groupCards.map(card => (
          <CardRow key={card.id} card={card} index={cards.indexOf(card)} />
        ))}
      </tbody>
    ))
  }

  // #46 — sorted by columnOrder if set, else default ALL_COLUMNS order
  const orderedColumns = useMemo(
    () =>
      columnOrder
        ? [...ALL_COLUMNS].sort((a, b) => {
            const ia = columnOrder.indexOf(a.id)
            const ib = columnOrder.indexOf(b.id)
            if (ia === -1 && ib === -1) return 0
            if (ia === -1) return 1
            if (ib === -1) return -1
            return ia - ib
          })
        : ALL_COLUMNS,
    [columnOrder, ALL_COLUMNS]
  )

  const visibleHeaders = useMemo(
    () => orderedColumns.filter(c => visibleCols.includes(c.id) || c.id === 'actions'),
    [orderedColumns, visibleCols]
  )

  const handleColDragStart = colId => {
    dragColRef.current = colId
  }
  const handleColDragOver = e => {
    e.preventDefault()
  }
  const handleColDrop = targetId => {
    const srcId = dragColRef.current
    dragColRef.current = null
    if (!srcId || srcId === targetId) return
    const base = columnOrder || ALL_COLUMNS.map(c => c.id)
    const order = base.includes(srcId) ? [...base] : ALL_COLUMNS.map(c => c.id)
    const si = order.indexOf(srcId)
    const ti = order.indexOf(targetId)
    if (si === -1 || ti === -1) return
    order.splice(si, 1)
    order.splice(ti, 0, srcId)
    setColumnOrder(order)
  }

  const allSelected = cards.length > 0 && selected.length === cards.length
  const someSelected = selected.length > 0 && selected.length < cards.length

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading && cards.length === 0) {
    return (
      <div className="panel p-0 overflow-x-auto">
        <table className="tbl">
          <thead className="sticky top-0 z-[3] bg-card">
            <tr>
              <th scope="col" className="w-9 bg-card" aria-label={t('select_all')}></th>
              {visibleHeaders.map(c => (
                <th key={c.id} scope="col" className="bg-card">
                  {t(c.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SkeletonRows count={8} cols={visibleHeaders.length + 1} />
          </tbody>
        </table>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="panel p-0">
        <EmptyState
          icon={<CreditCard size={38} />}
          title={t('cc_no_cards')}
          subtitle={t('cc_import_first')}
        />
      </div>
    )
  }

  return (
    <CardRowContext.Provider value={rowCtx}>
      <div className="panel p-0 overflow-x-auto relative">
        {/* #41 — inner scroll wrapper for sticky thead; virtual scroll при >CARDS_VIRTUAL_THRESHOLD карт */}
        <div
          ref={parentRef}
          className={`flex-1 overflow-y-auto min-h-0 ${useVirtualCards ? 'h-[760px] overflow-y-scroll' : ''}`}
        >
          <table className="tbl relative">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                {/* #48 — frozen checkbox column */}
                <th
                  scope="col"
                  className="bg-card w-9 sticky left-0 z-[4]"
                  aria-label={t('select_all')}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleSelectAll}
                    className="accent-accent cursor-pointer"
                  />
                </th>
                {/* #46 — draggable column headers, #48 — first data col frozen */}
                {visibleHeaders.map((c, i) => (
                  <th
                    key={c.id}
                    scope="col"
                    draggable={c.id !== 'actions'}
                    onDragStart={() => handleColDragStart(c.id)}
                    onDragOver={handleColDragOver}
                    onDrop={() => handleColDrop(c.id)}
                    className={`bg-card select-none ${
                      c.id !== 'actions' ? 'cursor-grab' : 'cursor-default'
                    } ${
                      i === 0 && c.id !== 'actions' ? 'sticky left-9 z-[4] shadow-frozen-col' : ''
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {c.id !== 'actions' && (
                        <span className="text-muted text-9 leading-1 col-grip">⠿</span>
                      )}
                      {t(c.label)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groupByBank ? renderRows() : <tbody>{renderRows()}</tbody>}
          </table>
        </div>
      </div>
    </CardRowContext.Provider>
  )
}
