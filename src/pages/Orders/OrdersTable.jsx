import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Package } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { EmptyState } from '../../components/EmptyState.jsx'
import { SkeletonRows } from '../../components/SkeletonRow.jsx'
import { OrderRow } from './OrderRow.jsx'
import { OrderTimeline } from './OrderTimeline.jsx'
import { StatusMenu } from './StatusMenu.jsx'
import { ORDERS_OVERSCAN } from '../../constants/virtualization.js'
import { recordRecentEntity } from '../../utils/recentEntities.js'

/**
 * OrdersTable вЂ” РІС‹РґРµР»РµРЅРЅС‹Р№ РєРѕРјРїРѕРЅРµРЅС‚ С‚Р°Р±Р»РёС†С‹ Р·Р°РєР°Р·РѕРІ
 *
 * в… Insight: РІРёСЂС‚СѓР°Р»РёР·Р°С†РёСЏ, expandedId/statusMenuId UI-СЃС‚РµР№С‚ Рё СЂРµРЅРґРµСЂ СЃС‚СЂРѕРє
 * Р·РґРµСЃСЊ, С‡С‚РѕР±С‹ Orders.jsx РѕСЃС‚Р°Р»СЃСЏ С‚РѕР»СЊРєРѕ РѕСЂРєРµСЃС‚СЂР°С†РёРµР№ (store, С„РёР»СЊС‚СЂС‹, РјРѕРґР°Р»РєРё).
 * Р”Р°РЅРЅС‹Рµ Рё РѕР±СЂР°Р±РѕС‚С‡РёРєРё РїСЂРёС…РѕРґСЏС‚ РїСЂРѕРїСЃР°РјРё.
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
  visibleCols,
}) {
  const { t } = useLang()
  const [statusMenuId, setStatusMenuId] = useState(null)
  // REDESIGN-05-4: СЃРєСЂС‹С‚РёРµ РєРѕР»РѕРЅРѕРє; Р±РµР· РїСЂРѕРїР° вЂ” РІСЃРµ 13 (e2e/СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚СЊ)
  const show = id => !visibleCols || visibleCols.includes(id)
  const colCount = visibleCols ? visibleCols.length : 13
  const [expandedId, setExpandedId] = useState(null)

  // Virtual scrolling setup
  const parentRef = useRef(null)
  // в… Insight: overscan вЂ” ORDERS_OVERSCAN (constants/virtualization.js), CLEAN-010
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns functions, safe to use
  const rowVirtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index => (expandedId === orders[index]?.id ? 180 : 60),
    overscan: ORDERS_OVERSCAN,
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
            {show('select') && (
              <th scope="col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-accent cursor-pointer"
                />
              </th>
            )}
            {show('order_number') && <th scope="col">{t('col_order_num')}</th>}
            {show('card') && (
              <th scope="col">
                {t('cc_col_holder')} / {t('section_card')}
              </th>
            )}
            {show('shop') && <th scope="col">{t('col_shop')}</th>}
            {show('status') && <th scope="col">{t('cc_col_status')}</th>}
            {show('amount') && <th scope="col">{t('col_amount')}</th>}
            {show('tracking') && <th scope="col">{t('col_tracking')}</th>}
            {show('carrier') && <th scope="col">{t('carrier')}</th>}
            {show('proxy') && <th scope="col">{t('nav_proxies')}</th>}
            {show('email') && <th scope="col">{t('col_email')}</th>}
            {show('notes') && <th scope="col">{t('cc_col_notes')}</th>}
            {show('date') && <th scope="col">{t('col_date')}</th>}
            {show('actions') && <th scope="col"></th>}
          </tr>
        </thead>
        <tbody>
          {loading && orders.length === 0 && <SkeletonRows count={6} cols={colCount} />}
          {orders.length === 0 && !loading && (
            <EmptyState
              colSpan={colCount}
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
                    <td colSpan={colCount} className="virtual-scroll-spacer" />
                  </tr>
                )}
              {/* Render visible rows */}
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const o = orders[virtualRow.index]
                return (
                  <OrderRow
                    key={o.id}
                    order={o}
                    visibleCols={visibleCols}
                    isSelected={selected.includes(o.id)}
                    isDeleting={deletingIds.includes(o.id)}
                    isExpanded={expandedId === o.id}
                    onToggleExpand={() => {
                      const next = expandedId === o.id ? null : o.id
                      setExpandedId(next)
                      // REDESIGN-05-4: СЂР°СЃРєСЂС‹С‚РёРµ РѕСЂРґРµСЂР° в†’ В«РїРѕСЃР»РµРґРЅРёРµ СЃСѓС‰РЅРѕСЃС‚РёВ» вЊK
                      if (next) {
                        recordRecentEntity({
                          type: 'order',
                          id: o.id,
                          label: o.order_number || `#${o.id}`,
                          sub: o.shop_name,
                        })
                      }
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
                  <td colSpan={colCount} className="virtual-scroll-spacer" />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  )
}
