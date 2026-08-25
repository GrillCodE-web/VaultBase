import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Package } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { EmptyState } from '../../components/EmptyState.jsx'
import { SkeletonRows } from '../../components/SkeletonRow.jsx'
import { OrderRow } from './OrderRow.jsx'
import { OrderTimeline } from './OrderTimeline.jsx'
import { StatusMenu } from './StatusMenu.jsx'

/**
 * OrdersTable — выделенный компонент таблицы заказов
 *
 * ★ Insight: виртуализация, expandedId/statusMenuId UI-стейт и рендер строк
 * здесь, чтобы Orders.jsx остался только оркестрацией (store, фильтры, модалки).
 * Данные и обработчики приходят пропсами.
 */
export function OrdersTable({
  orders,
  loading,
  selected,
  deletingIds,
  allSelected,
  toggleSelect,
  toggleSelectAll,
  onRepeat,
  onDelete,
  onUpdate,
  onPatchLocal,
  onCreate,
}) {
  const { t } = useLang()
  const [statusMenuId, setStatusMenuId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  // Virtual scrolling setup
  const parentRef = useRef(null)
  // ★ Insight: overscan увеличен до 20 для плавной прокрутки без белых полос
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns functions, safe to use
  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => (expandedId === orders[index]?.id ? 180 : 60),
    overscan: 20, // Увеличено с 10 до 20
  })

  // Recalculate sizes when expandedId changes
  useEffect(() => {
    if (orders.length > 0) {
      rowVirtualizer.measure()
    }
  }, [expandedId, rowVirtualizer, orders.length])

  // Close status menu on outside click
  useEffect(() => {
    if (!statusMenuId) return
    const handler = () => setStatusMenuId(null)
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [statusMenuId])

  return (
    <div ref={parentRef} className="panel p-0 overflow-x-auto table-scroll-container">
      <table className="tbl">
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="accent-accent cursor-pointer"
              />
            </th>
            <th scope="col">{t('col_order_num')}</th>
            <th scope="col">
              {t('cc_col_holder')} / {t('section_card')}
            </th>
            <th scope="col">{t('col_shop')}</th>
            <th scope="col">{t('cc_col_status')}</th>
            <th scope="col">{t('col_amount')}</th>
            <th scope="col">{t('col_tracking')}</th>
            <th scope="col">{t('carrier')}</th>
            <th scope="col">{t('nav_proxies')}</th>
            <th scope="col">{t('col_email')}</th>
            <th scope="col">{t('cc_col_notes')}</th>
            <th scope="col">{t('col_date')}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          {loading && orders.length === 0 && <SkeletonRows count={6} cols={13} />}
          {orders.length === 0 && !loading && (
            <EmptyState
              colSpan={13}
              icon={<Package size={38} />}
              {...{ title: t('orders'), subtitle: t('new_order') }}
              action={
                <button className="btn btn-g btn-sm" onClick={onCreate}>
                  + New Order
                </button>
              }
            />
          )}
          {orders.length > 0 && (
            <>
              {/* Top padding spacer */}
              {rowVirtualizer.getVirtualItems().length > 0 &&
                rowVirtualizer.getVirtualItems()[0].start > 0 && (
                  <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                    <td colSpan={13} className="virtual-scroll-spacer" />
                  </tr>
                )}
              {/* Render visible rows */}
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const o = orders[virtualRow.index]
                return (
                  <OrderRow
                    key={o.id}
                    order={o}
                    isSelected={selected.includes(o.id)}
                    isDeleting={deletingIds.includes(o.id)}
                    isExpanded={expandedId === o.id}
                    onToggleExpand={() => {
                      setExpandedId(expandedId === o.id ? null : o.id)
                    }}
                    onToggleSelect={() => toggleSelect(o.id)}
                    onStatusMenuToggle={() => setStatusMenuId(statusMenuId === o.id ? null : o.id)}
                    showStatusMenu={statusMenuId === o.id}
                    onRepeat={() => onRepeat(o)}
                    onDelete={() => onDelete(o)}
                    onTrackingUpdate={(id, val) => onPatchLocal(id, { tracking_number: val })}
                    StatusMenuComponent={
                      <StatusMenu
                        order={o}
                        onUpdate={onUpdate}
                        onClose={() => setStatusMenuId(null)}
                      />
                    }
                    TimelineComponent={<OrderTimeline status={o.status} updatedAt={o.updated_at} />}
                  />
                )
              })}
              {/* Bottom padding spacer */}
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr
                  style={{
                    height: `${rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end || 0)}px`,
                  }}
                >
                  <td colSpan={13} className="virtual-scroll-spacer" />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
