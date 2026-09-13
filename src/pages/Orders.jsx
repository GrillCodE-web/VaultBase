import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Upload, Download } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { useTableFilters } from '../hooks/useTableFilters.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { Pagination } from '../components/Pagination.jsx'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { exportToCSV } from '../utils/csv.js'
import { BatchImportModal } from './Orders/BatchImportModal.jsx'
import { OrderFilters } from './Orders/OrderFilters.jsx'
import { OrdersTable } from './Orders/OrdersTable.jsx'
import { QuickOrderModal } from './Profiles/QuickOrderModal.jsx'
import { ActionInbox } from './Dashboard/ActionInbox.jsx'
import { useOrdersStore } from '../store/orders.js'
import { usePersistedState } from '../hooks/usePersistedState.js'

// REDESIGN-05-4 (порция 2): выбор колонок таблицы ордеров (localStorage).
// select/actions всегда видимы и в пикер не попадают (lockedIds).
const ORDER_COLUMNS = [
  { id: 'select', label: '' },
  { id: 'order_number', label: 'col_order_num' },
  { id: 'card', label: 'section_card' },
  { id: 'shop', label: 'col_shop' },
  { id: 'status', label: 'cc_col_status' },
  { id: 'amount', label: 'col_amount' },
  { id: 'tracking', label: 'col_tracking' },
  { id: 'carrier', label: 'carrier' },
  { id: 'proxy', label: 'nav_proxies' },
  { id: 'email', label: 'col_email' },
  { id: 'notes', label: 'cc_col_notes' },
  { id: 'date', label: 'col_date' },
  { id: 'actions', label: 'cc_col_actions' },
]
const ORDER_DEFAULT_COLS = ORDER_COLUMNS.map(c => c.id)

export default function OrderList({ onNavigate, activeTab = 'list', status: statusProp = null }) {
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
  // SPEC-A (7cx): создание заказа переехало в контекст профиля (QuickOrderModal);
  // здесь остаётся только мониторинг + repeat в профиле исходного заказа.
  const [repeatOrder, setRepeatOrder] = useState(null)
  const [shopOptions, setShopOptions] = useState([])
  const [showBatchImport, setShowBatchImport] = useState(false)
  const [visibleCols, setVisibleCols] = usePersistedState('orders_visible_cols', ORDER_DEFAULT_COLS)

  // ARCH-013: debounced search через общий хук
  const applySearchToStore = useCallback(
    f => setFilters({ search: f.search || null }),
    [setFilters]
  )
  const { searchInput, setSearch: setSearchInput } = useTableFilters(applySearchToStore, {}, 300)

  // ── Effects ────────────────────────────────────────────────────

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

  // SPEC-A (tyw): навигация из инбокса главной — onNavigate('orders', { status })
  // Объявлен ПОСЛЕ activeTab-эффекта, чтобы на маунте выигрывал явный статус.
  useEffect(() => {
    if (statusProp) setFilters({ status: statusProp })
  }, [statusProp, setFilters])

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
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

  // REDESIGN-05 (c5j): CSV-экспорт текущей выборки (страница + фильтры)
  const handleExport = () => {
    const rows = orders.map(o => [
      o.order_number || `#${o.id}`,
      o.status ?? '',
      o.shop_name ?? '',
      o.total_amount != null ? o.total_amount.toFixed(2) : '',
      o.tracking_number ?? '',
      o.carrier ?? '',
      o.proxy_label ?? '',
      o.email_addr ?? '',
      o.created_at ?? '',
      o.notes ?? '',
    ])
    exportToCSV(
      `orders_${new Date().toISOString().slice(0, 10)}.csv`,
      'Order,Status,Shop,Amount,Tracking,Carrier,Proxy,Email,Date,Notes',
      rows
    )
  }

  // SPEC-A (7cx): repeat возможен только в контексте профиля исходного заказа
  const handleRepeat = o => {
    if (!o.profile_id) {
      toast(t('order_repeat_no_profile'), 'info')
      return
    }
    setRepeatOrder(o)
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
            className="btn btn-ghost btn-sm"
            onClick={() => onNavigate?.('profiles')}
            title={t('orders_create_hint')}
          >
            + {t('create_order')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowBatchImport(true)}
            title="Batch import (b)"
          >
            <Upload size={13} /> {t('btn_batch_import')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleExport}
            disabled={orders.length === 0}
            title={t('btn_export')}
          >
            <Download size={13} /> {t('btn_export')}
          </button>
        </div>
      </div>

      {/* SPEC-A (tyw): инбокс проблемных заказов над фильтрами — мониторинг */}
      <ActionInbox onNavigate={onNavigate} />

      {/* Filters */}
      <OrderFilters
        filter={filters}
        setFilter={setFilters}
        load={() => fetchOrders(true)}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        shopOptions={shopOptions}
        columns={ORDER_COLUMNS}
        visibleCols={visibleCols}
        onColumnsChange={setVisibleCols}
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

      {/* Table with virtual scrolling (ARCH-008: вынесена в Orders/OrdersTable.jsx) */}
      <OrdersTable
        orders={orders}
        loading={loading}
        selected={selected}
        deletingIds={deletingIds}
        allSelected={allSelected}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        onRepeat={handleRepeat}
        onDelete={handleDelete}
        onUpdate={() => fetchOrders(true)}
        onPatchLocal={patchOrderLocal}
        onCreate={() => onNavigate?.('profiles')}
        visibleCols={visibleCols}
      />

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        label="orders"
        onPageChange={p => setPage(p)}
      />

      {/* SPEC-A (7cx): repeat открывает QuickOrderModal в профиле исходного заказа */}
      {repeatOrder && (
        <QuickOrderModal
          profile={{ id: repeatOrder.profile_id }}
          repeatFrom={repeatOrder}
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
