import { useState, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import { Package, Upload } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { useDebounce } from '../hooks/useDebounce.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { buildPageNumbers, DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { BatchImportModal } from './Orders/BatchImportModal.jsx'
import { OrderFilters } from './Orders/OrderFilters.jsx'
import { OrderRow } from './Orders/OrderRow.jsx'
import { OrderTimeline } from './Orders/OrderTimeline.jsx'
import { StatusMenu } from './Orders/StatusMenu.jsx'
import { CreateOrderModal } from './Orders/CreateOrderModal.jsx'
import { RepeatOrderModal } from './Orders/RepeatOrderModal.jsx'
import { useOrdersStore } from '../store/orders.js'

// ─── OrderTimeline ────────────────────────────────────────────
export default function OrderList({
  onNavigate: _onNavigate,
  activeTab = 'list',
  openCreate = false,
}) {
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()

  // ── Zustand Store ──────────────────────────────────────────────
  const {
    orders,
    total,
    page,
    loading,
    filters,
    selected,
    deletingIds,
    setPage,
    setFilters,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    fetchOrders,
    deleteOrder,
    undoDelete,
    bulkUpdateStatus,
    bulkDelete,
    patchOrderLocal,
  } = useOrdersStore()

  // Local UI state (not in store)
  const [searchInput, setSearchInput] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [statusMenuId, setStatusMenuId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [shopOptions, setShopOptions] = useState([])
  const [repeatOrder, setRepeatOrder] = useState(null)
  const [showBatchImport, setShowBatchImport] = useState(false)

  const debouncedSearch = useDebounce(searchInput, 300)

  // Virtual scrolling setup
  // ★ Insight: overscan увеличен до 20 для плавной прокрутки без белых полос
  const parentRef = useRef(null)
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

  // ── Effects ────────────────────────────────────────────────────

  // Initialize: open create modal if requested
  useEffect(() => {
    if (openCreate) setShowCreate(true)
  }, [openCreate])

  // Load orders on mount and fetch shop options
  useEffect(() => {
    fetchOrders().catch(e => {
      const error = handleError(e, 'Orders.fetchOrders')
      toast(getErrorMessage(error), 'error')
    })
    // FIX FE-H05: Log shop fetch errors instead of silently ignoring
    invoke('get_shops', { page: 1, perPage: 200, search: '' })
      .then(r => setShopOptions(r.items ?? []))
      .catch(e => console.error('[Orders] Failed to fetch shops:', e))
  }, [fetchOrders, toast])

  // Handle activeTab changes (status filter)
  useEffect(() => {
    let newStatus = null
    if (activeTab === 'pending') newStatus = 'pending'
    else if (activeTab === 'delivered') newStatus = 'delivered'
    setFilters({ status: newStatus })
  }, [activeTab, setFilters])

  // Debounced search: update filter when user stops typing
  useEffect(() => {
    setFilters({ search: debouncedSearch || null })
  }, [debouncedSearch, setFilters])

  // Close status menu on outside click
  useEffect(() => {
    if (!statusMenuId) return
    const handler = () => setStatusMenuId(null)
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [statusMenuId])

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
    {
      keys: ['o'],
      handler: () => setShowCreate(true),
      requireNoInput: true,
      page: 'orders',
    },
    {
      keys: ['b'],
      handler: () => setShowBatchImport(true),
      requireNoInput: true,
      page: 'orders',
    },
  ]

  useKeyboardShortcuts(pageShortcuts, { currentPage: 'orders' })

  // ── Actions ────────────────────────────────────────────────────

  const handleDelete = async o => {
    // Soft delete with undo toast (no confirm dialog)
    let undone = false
    toast({
      message: t('order_deleted'),
      type: 'info',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          undoDelete(o.id)
        },
      },
    })

    setTimeout(async () => {
      if (undone) return
      try {
        await deleteOrder(o.id)
      } catch (e) {
        const error = handleError(e, 'Orders.handleDelete')
        toast(getErrorMessage(error), 'error')
      }
    }, 5000)
  }

  const handleBulkStatus = async status => {
    const ids = [...selected]
    try {
      await bulkUpdateStatus(ids, status)
      toast(`${ids.length} orders → ${status}`, 'success')
    } catch (e) {
      const error = handleError(e, 'Orders.handleBulkStatus')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ok = await confirm(t('orders_confirm_delete_many'), { danger: true })
    if (!ok) return
    const ids = [...selected]
    try {
      await bulkDelete(ids)
      toast(t('orders_deleted_many').replace('{n}', ids.length), 'success')
    } catch (e) {
      const error = handleError(e, 'Orders.handleBulkDelete')
      toast(getErrorMessage(error), 'error')
    }
  }

  const totalPages = getTotalPages(total, DEFAULT_PAGE_SIZE)

  const allSelected = orders.length > 0 && selected.length === orders.length

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">Orders</div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-g"
            onClick={() => setShowCreate(true)}
            data-shortcut="new"
            title="Create order (o)"
          >
            + {t('create_order')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowBatchImport(true)}
            title="Batch import (b)"
          >
            <Upload size={13} /> Batch Import
          </button>
          <button className="btn btn-ghost btn-sm" disabled title={t('export_coming_soon')}>
            {t('btn_export')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <OrderFilters
        filter={filters}
        setFilter={setFilters}
        load={() => fetchOrders(true)}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        shopOptions={shopOptions}
      />

      {/* Bulk Action Panel */}
      {selected.length > 0 && (
        <div className="bulk-action-panel">
          <span className="text-info-bold">{selected.length} selected</span>
          <span className="text-border mx-1">|</span>
          <button className="btn btn-b btn-sm" onClick={() => handleBulkStatus('processing')}>
            → Processing
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => handleBulkStatus('shipped')}>
            → Shipped
          </button>
          <button className="btn btn-r btn-sm" onClick={handleBulkDelete}>
            {t('btn_delete')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
            {t('orders_deselect_all')}
          </button>
        </div>
      )}

      {/* Table with virtual scrolling */}
      <div ref={parentRef} className="panel p-0 overflow-x-auto table-scroll-container">
        <table className="tbl">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-accent cursor-pointer"
                />
              </th>
              <th>{t('col_order_num')}</th>
              <th>
                {t('cc_col_holder')} / {t('section_card')}
              </th>
              <th>{t('col_shop')}</th>
              <th>{t('cc_col_status')}</th>
              <th>{t('col_amount')}</th>
              <th>{t('col_tracking')}</th>
              <th>{t('carrier')}</th>
              <th>{t('nav_proxies')}</th>
              <th>{t('col_email')}</th>
              <th>{t('cc_col_notes')}</th>
              <th>{t('col_date')}</th>
              <th></th>
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
                  <button className="btn btn-g btn-sm" onClick={() => setShowCreate(true)}>
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
                      onStatusMenuToggle={() =>
                        setStatusMenuId(statusMenuId === o.id ? null : o.id)
                      }
                      showStatusMenu={statusMenuId === o.id}
                      onRepeat={() => setRepeatOrder(o)}
                      onDelete={() => handleDelete(o)}
                      onTrackingUpdate={(id, val) => patchOrderLocal(id, { tracking_number: val })}
                      StatusMenuComponent={
                        <StatusMenu
                          order={o}
                          onUpdate={() => fetchOrders(true)}
                          onClose={() => setStatusMenuId(null)}
                        />
                      }
                      TimelineComponent={
                        <OrderTimeline status={o.status} updatedAt={o.updated_at} />
                      }
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] text-muted">{total} orders</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="px-2 py-1 text-[12px] text-muted">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`btn btn-ghost btn-sm${page === p ? ' active pagination-btn-active' : ''}`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal
          onCreated={() => fetchOrders(true)}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* E1: Repeat Order modal */}
      {repeatOrder && (
        <RepeatOrderModal
          order={repeatOrder}
          onCreated={() => fetchOrders(true)}
          onClose={() => setRepeatOrder(null)}
        />
      )}

      {/* E3: Batch Import modal */}
      {showBatchImport && (
        <BatchImportModal
          onCreated={() => fetchOrders(true)}
          onClose={() => setShowBatchImport(false)}
        />
      )}
    </div>
  )
}
