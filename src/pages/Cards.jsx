import { useState, useEffect, useRef, useMemo } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Archive, Upload, RefreshCw, CreditCard, Zap } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLang } from '../hooks/useLang.jsx'
import { useToast } from '../hooks/useToast.jsx'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useDebounce } from '../hooks/useDebounce.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { copyToClipboard } from '../utils/clipboard.js'
import { buildPageNumbers } from '../utils/pagination.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { ImportModal } from './Cards/ImportModal.jsx'
import { CardFilters } from './Cards/CardFilters.jsx'
import { CardRow } from './Cards/CardRow.jsx'
import { ColumnPicker } from './Cards/ColumnPicker.jsx'
import { CardSidePanel } from './Cards/CardSidePanel.jsx'
import { CardShopUsagePanel } from './Cards/CardShopUsagePanel.jsx'
import { CardTimelinePanel } from './Cards/CardTimelinePanel.jsx'
import { useCardsStore } from '../store/cards.js'
import { useUIStore } from '../store/ui.js'

// ─── Constants ────────────────────────────────────────────────────────────

function getAllColumns(t) {
  return [
    { id: 'card_number', label: 'cc_col_number' },
    { id: 'expiry', label: t('card_label_expiry') },
    { id: 'cvv', label: t('card_label_cvv') },
    { id: 'holder', label: 'cc_col_holder' },
    { id: 'billing', label: t('copy_billing') },
    { id: 'zip', label: t('drop_field_zip').replace(' *', '') },
    { id: 'city', label: t('drop_field_city').replace(' *', '') },
    { id: 'state', label: t('drop_field_state') },
    { id: 'country', label: 'cc_col_country' },
    { id: 'phone', label: t('drop_field_phone') },
    { id: 'bin_bank', label: 'cc_col_bin' },
    { id: 'type', label: 'cc_col_type' },
    { id: 'source', label: 'cc_col_source' },
    { id: 'status', label: 'cc_col_status' },
    { id: 'health', label: 'Health' },
    { id: 'notes', label: 'cc_col_notes' },
    { id: 'created', label: 'cc_col_created' },
    { id: 'email_cc', label: t('col_email') },
    { id: 'ip', label: 'IP' },
    { id: 'actions', label: 'cc_col_actions' },
  ]
}

// #default order — Number | Exp | CVV | Holder | Address | ZIP | City | State | Country | Phone | Status | Actions
const DEFAULT_COLS = [
  'card_number',
  'expiry',
  'cvv',
  'holder',
  'billing',
  'zip',
  'city',
  'state',
  'country',
  'phone',
  'status',
  'actions',
]

// ─── Main Cards page ──────────────────────────────────────────────────────

export default function Cards({ onNavigate, activeTab = 'list', openImport = false }) {
  const { t } = useLang()
  const ALL_COLUMNS = getAllColumns(t)
  const { toast } = useToast()
  const { confirm } = useConfirm()

  // ── Zustand Stores ─────────────────────────────────────────────────────

  // Cards store
  const {
    cards,
    total,
    freeTotal,
    page,
    loading,
    filters,
    filterMeta,
    selected,
    deletingIds,
    revealed,
    setPage,
    setFilters,
    resetFilters,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    fetchCards,
    fetchFilterMeta,
    updateCard,
    updateCardNotes,
    deleteCard,
    undoDelete,
    bulkUpdateStatus,
    bulkDelete,
    bulkEnrich,
    exportCards,
    handleSyncUpdate,
    handleFullSync,
  } = useCardsStore()

  // UI store
  const {
    showImport,
    showColPicker,
    compact,
    groupByBank,
    sideCard,
    sideCardIdx,
    shopUsageCardId,
    timelineCardId,
    statusMenuId,
    flashedIds,
    enrichProgress,
    setShowImport,
    setShowColPicker,
    toggleCompact,
    toggleGroupByBank,
    setSideCard,
    closeSideCard,
    setShopUsageCardId,
    setTimelineCardId,
    setStatusMenuId,
    addFlashedId,
    removeFlashedId,
    setEnrichProgress,
  } = useUIStore()

  // Real-time sync flash animation timers
  const flashTimers = useRef({})

  // Local UI state (column visibility and order - localStorage preferences)
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('cc_columns_visible')
      if (saved) {
        const parsed = JSON.parse(saved)
        const allCols = getAllColumns(k => k)
        if (Array.isArray(parsed) && parsed.every(c => allCols.some(a => a.id === c))) return parsed
      }
    } catch {
      // Ignore localStorage errors
    }
    return DEFAULT_COLS
  })

  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('cc_columns_order')
      if (saved) return JSON.parse(saved)
    } catch {
      // Ignore localStorage errors
    }
    return null
  })
  const dragColRef = useRef(null)

  // Search input (local state, debounced to store)
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput, 300)

  const PER_PAGE = 50
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // Virtual scroll container ref
  const parentRef = useRef(null)

  // ── Effects ────────────────────────────────────────────────────────────

  // Initialize: open import modal if requested
  useEffect(() => {
    if (openImport) setShowImport(true)
  }, [openImport, setShowImport])

  // Load cards when filters or page change
  useEffect(() => {
    fetchCards().catch(e => {
      const error = handleError(e, 'Cards.fetchCards')
      toast(getErrorMessage(error), 'error')
    })
  }, [fetchCards, toast])

  // Load filter metadata on mount
  useEffect(() => {
    fetchFilterMeta()
  }, [fetchFilterMeta])

  // Debounced search: update filter when user stops typing
  useEffect(() => {
    setFilters({ search: debouncedSearch || null })
  }, [debouncedSearch, setFilters])

  // Handle activeTab changes (expiring soon filter)
  useEffect(() => {
    setFilters({ expiring_soon: activeTab === 'expiring' ? true : null })
  }, [activeTab, setFilters])

  // Real-time sync: listen for card updates from WS sync
  useEffect(() => {
    let unlistenUpdate, unlistenFull
    const timers = flashTimers.current

    listen('sync:card_update', event => {
      const updates = event.payload ?? []
      // Apply status changes via store
      handleSyncUpdate(updates)

      // Flash updated cards
      updates.forEach(upd => {
        const card = cards.find(c => c.id === upd.id)
        if (card) {
          addFlashedId(card.id)
          if (timers[card.id]) clearTimeout(timers[card.id])
          timers[card.id] = setTimeout(() => {
            removeFlashedId(card.id)
          }, 2000)
        }
      })
    })
      .then(u => {
        unlistenUpdate = u
      })
      .catch(() => {})

    listen('sync:full_data', () => {
      // Full sync received — reload current page
      handleFullSync()
    })
      .then(u => {
        unlistenFull = u
      })
      .catch(() => {})

    return () => {
      unlistenUpdate?.()
      unlistenFull?.()
      // Clear all timers on cleanup
      Object.values(timers).forEach(clearTimeout)
    }
  }, [cards, handleSyncUpdate, handleFullSync, addFlashedId, removeFlashedId])

  // ── Close status menu on outside click ────────────────────────────────

  useEffect(() => {
    if (!statusMenuId) return
    const handler = e => {
      if (!e.target.closest('.status-menu-anchor')) setStatusMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusMenuId, setStatusMenuId])

  // ── Actions ────────────────────────────────────────────────────────────

  const handleStatusChange = async (id, status) => {
    if (status === 'dead') {
      const ok = await confirm(t('cc_confirm_dead'), { danger: true })
      if (!ok) return
    }
    try {
      await updateCard(id, { status })
      toast(t('card_marked_as') + ' ' + status, 'success')
    } catch (e) {
      const error = handleError(e, 'Cards.handleStatusChange')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleDelete = async id => {
    // Soft delete immediately, show Undo toast (no confirm dialog)
    let undone = false
    toast({
      message: t('msg_deleted'),
      type: 'info',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          undoDelete(id)
        },
      },
    })

    setTimeout(async () => {
      if (undone) return
      try {
        await deleteCard(id)
      } catch (e) {
        const error = handleError(e, 'Cards.handleDelete')
        const msg = error.details?.originalMessage || error.message
        if (msg.includes('in_use') || msg.includes('card_in_use')) {
          toast(t('card_cannot_delete_linked'), 'error')
        } else {
          toast(getErrorMessage(error), 'error')
        }
      }
    }, 5000)
  }

  const handleBulkStatus = async status => {
    if (status === 'dead') {
      const ok = await confirm(
        t('cards_bulk_mark_dead').replace('{n}', selected.size),
        t('cc_mark_dead')
      )
      if (!ok) return
    }
    try {
      await bulkUpdateStatus([...selected], status)
      toast(selected.size + ' ' + t('cards_bulk_moved') + ' ' + status, 'success')
    } catch (e) {
      const error = handleError(e, 'Cards.handleBulkStatus')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleArchiveDead = async () => {
    const deadIds = cards.filter(c => c.status === 'dead').map(c => c.id)
    if (deadIds.length === 0) {
      toast('No dead cards on this page', 'warn')
      return
    }
    const ok = await confirm(
      `Archive ${deadIds.length} dead card${deadIds.length !== 1 ? 's' : ''}?`,
      t('status_archive')
    )
    if (!ok) return
    try {
      await bulkUpdateStatus(deadIds, 'archive')
      toast(`${deadIds.length} dead cards archived`, 'success')
    } catch (e) {
      const error = handleError(e, 'Cards.handleArchiveDead')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ok = await confirm(t('cards_bulk_delete').replace('{n}', selected.size), t('btn_delete'))
    if (!ok) return
    try {
      await bulkDelete([...selected])
      toast(t('cards_bulk_deleted').replace('{n}', selected.size), 'success')
    } catch (e) {
      const error = handleError(e, 'Cards.handleBulkDelete')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleBulkEnrich = async () => {
    const ids = [...selected].filter(id => {
      const card = cards.find(c => c.id === id)
      return card?.bin
    })
    if (!ids.length) return

    setEnrichProgress({ done: 0, total: ids.length })
    try {
      const result = await bulkEnrich(ids, progress => {
        setEnrichProgress(progress)
      })
      setEnrichProgress(null)
      toast(`BIN enriched: ${result.enriched} / ${result.total}`, 'success')
    } catch (e) {
      setEnrichProgress(null)
      const error = handleError(e, 'Cards.handleBulkEnrich')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleExport = async format => {
    try {
      const content = await exportCards([...selected], format)
      const blob = new Blob([content], { type: 'text/plain' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cards_export.${format === 'csv' ? 'csv' : 'txt'}`
      a.click()
    } catch (e) {
      const error = handleError(e, 'Cards.handleExport')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleEditNote = async (id, notes) => {
    try {
      await updateCardNotes(id, notes)
    } catch (e) {
      const error = handleError(e, 'Cards.handleEditNote')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleSearch = () => {
    setFilters({ search: searchInput || null })
  }

  const handleResetFilters = () => {
    resetFilters()
    setSearchInput('')
  }

  const handleCopyToast = text => {
    copyToClipboard(
      text,
      () => toast(t('copied'), 'success'),
      () => toast(t('copy_failed'), 'error')
    )
  }

  // ── Render helpers ─────────────────────────────────────────────────────

  const allSelected = cards.length > 0 && selected.size === cards.length
  const someSelected = selected.size > 0 && selected.size < cards.length

  const renderCard = card => (
    <CardRow
      key={card.id}
      card={card}
      cards={cards}
      revealed={revealed}
      selected={selected}
      deletingIds={deletingIds}
      flashedIds={flashedIds}
      statusMenuId={statusMenuId}
      visibleCols={visibleCols}
      toggleSelect={toggleSelect}
      setSideCard={c => {
        const idx = cards.indexOf(c)
        setSideCard(c, idx)
      }}
      setSideCardIdx={() => {}}
      setStatusMenuId={setStatusMenuId}
      handleStatusChange={handleStatusChange}
      handleCopyToast={handleCopyToast}
      handleEditNote={handleEditNote}
      setShopUsageCardId={setShopUsageCardId}
      setTimelineCardId={setTimelineCardId}
      handleDelete={handleDelete}
      setFilter={setFilters}
      setPage={setPage}
      onNavigate={onNavigate}
      t={t}
      toast={toast}
    />
  )

  // ── Grouped render ─────────────────────────────────────────────────────

  const groupedCards = useMemo(
    () =>
      Object.entries(
        cards.reduce((acc, c) => {
          const k = c.bank_name || t('msg_no_data')
          ;(acc[k] = acc[k] || []).push(c)
          return acc
        }, {})
      ).sort((a, b) => a[0].localeCompare(b[0])),
    [cards, t]
  )

  // Virtual scrolling setup - only for non-grouped view
  const useVirtualCards = !groupByBank && cards.length > 200

  const rowVirtualizer = useVirtualizer({
    count: useVirtualCards ? cards.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 5,
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
              return (
                <CardRow
                  key={card.id}
                  card={card}
                  cards={cards}
                  revealed={revealed}
                  selected={selected}
                  deletingIds={deletingIds}
                  flashedIds={flashedIds}
                  statusMenuId={statusMenuId}
                  visibleCols={visibleCols}
                  toggleSelect={toggleSelect}
                  setSideCard={c => {
                    const idx = cards.indexOf(c)
                    setSideCard(c, idx)
                  }}
                  setSideCardIdx={() => {}}
                  setStatusMenuId={setStatusMenuId}
                  handleStatusChange={handleStatusChange}
                  handleCopyToast={handleCopyToast}
                  handleEditNote={handleEditNote}
                  setShopUsageCardId={setShopUsageCardId}
                  setTimelineCardId={setTimelineCardId}
                  handleDelete={handleDelete}
                  setFilter={setFilters}
                  setPage={setPage}
                  onNavigate={onNavigate}
                  t={t}
                  toast={toast}
                />
              )
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
      return cards.map(renderCard)
    }
    return groupedCards.map(([bank, groupCards]) => (
      <tbody key={bank}>
        <tr>
          <td
            colSpan={99}
            className="bg-surface text-muted text-[10px] font-bold border-b uppercase tracking-wide"
            style={{ padding: '5px 10px' }}
          >
            {bank} · {groupCards.length} {t('cards')} ·{' '}
            {groupCards.filter(c => c.status === 'free').length} {t('status_free')}
          </td>
        </tr>
        {groupCards.map(renderCard)}
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
    try {
      localStorage.setItem('cc_columns_order', JSON.stringify(order))
    } catch {
      // Ignore localStorage errors
    }
  }
  const from = (page - 1) * PER_PAGE + 1
  const to = Math.min(page * PER_PAGE, total)

  return (
    <div className="content">
      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            CC{' '}
            <span className="text-muted text-[14px] font-normal">
              {total.toLocaleString()} {t('nav_cards')}
            </span>
            {freeTotal > 0 && (
              <span className="text-[12px] text-green-t font-normal" style={{ marginLeft: 8 }}>
                · {freeTotal.toLocaleString()} {t('status_free')}
              </span>
            )}
          </div>
        </div>
        <div className="ph-actions">
          <button
            onClick={toggleCompact}
            className={compact ? 'btn btn-b btn-sm' : 'btn btn-ghost btn-sm'}
          >
            {compact ? t('cards_view_normal') : t('cards_view_compact')}
          </button>
          <button
            onClick={toggleGroupByBank}
            className={groupByBank ? 'btn btn-b btn-sm' : 'btn btn-ghost btn-sm'}
          >
            {t('cc_group_by_bank')}
          </button>
          <div className="relative">
            <button onClick={() => setShowColPicker(v => !v)} className="btn btn-ghost btn-sm">
              {t('cc_columns')}
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
                <ColumnPicker
                  visible={visibleCols}
                  allColumns={ALL_COLUMNS}
                  t={t}
                  onChange={cols => {
                    setVisibleCols(cols)
                    try {
                      localStorage.setItem('cc_columns_visible', JSON.stringify(cols))
                    } catch {
                      // Ignore localStorage errors
                    }
                  }}
                  onClose={() => setShowColPicker(false)}
                />
              </>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleArchiveDead}
              className="btn btn-ghost btn-sm"
              title="Archive all dead cards on this page"
            >
              <Archive size={12} /> {t('cc_archive_dead')}
            </button>
            <button onClick={() => setShowImport(true)} className="btn btn-b" data-shortcut="new">
              <Upload size={12} /> {t('btn_import')}
            </button>
          </div>
        </div>
      </div>

      <CardFilters
        filter={filters}
        setFilter={setFilters}
        setPage={setPage}
        filterMeta={filterMeta}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        handleSearch={handleSearch}
        handleResetFilters={handleResetFilters}
        loading={loading}
        loadCards={() => fetchCards(true)}
        t={t}
      />

      {/* Expiring soon banner */}
      {activeTab === 'expiring' && (
        <div
          className="text-[12px] text-yellow-t rounded-md mb-2"
          style={{
            padding: '8px 14px',
            background: 'var(--color-warning-bg)',
            border: '1px solid var(--color-warning-bg)',
          }}
        >
          {t('cards_expiring_banner')}
        </div>
      )}

      {/* Bulk action bar — fixed bottom */}
      {selected.size > 0 && (
        <div
          className="fixed flex items-center bg-card border-accent rounded-lg shadow-lg z-100"
          style={{
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 18px',
            gap: 10,
          }}
        >
          <span className="text-accent font-semibold text-[12px]">
            {selected.size} {t('selected')}
          </span>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => handleBulkStatus('free')} className="btn btn-g btn-sm">
              {t('cc_mark_free')}
            </button>
            <button onClick={() => handleBulkStatus('archive')} className="btn btn-ghost btn-sm">
              Archive
            </button>
            <button onClick={() => handleBulkStatus('dead')} className="btn btn-r btn-sm">
              {t('cc_mark_dead')}
            </button>
            {enrichProgress ? (
              <span className="text-[12px] text-muted inline-flex items-center gap-1\.5">
                <RefreshCw size={12} className="spin" />
                {enrichProgress.done} / {enrichProgress.total}
              </span>
            ) : (
              <button
                onClick={handleBulkEnrich}
                className="btn btn-b btn-sm btn-icon"
                title="Enrich BIN data for selected cards"
              >
                <Zap size={12} /> BIN Enrich
              </button>
            )}
            <button onClick={() => handleExport('txt')} className="btn btn-b btn-sm">
              {t('export_txt')}
            </button>
            <button onClick={() => handleExport('csv')} className="btn btn-b btn-sm">
              {t('export_csv')}
            </button>
            <button onClick={handleBulkDelete} className="btn btn-r btn-sm">
              {t('btn_delete')}
            </button>
          </div>
          <button
            onClick={() => clearSelection()}
            className="ml-auto bg-transparent border-none text-muted cursor-pointer text-[14px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* #41 — Table with sticky header */}
      {loading && cards.length === 0 ? (
        <div className="panel p-0 overflow-x-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th style={{ width: 36, background: 'var(--card)' }}></th>
                {visibleHeaders.map(c => (
                  <th key={c.id} className="bg-card">
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
      ) : cards.length === 0 ? (
        <div className="panel p-0">
          <EmptyState
            icon={<CreditCard size={38} />}
            title={t('cc_no_cards')}
            subtitle={t('cc_import_first')}
            action={
              <button onClick={() => setShowImport(true)} className="btn btn-b">
                {t('cc_import_first')}
              </button>
            }
          />
        </div>
      ) : (
        <div className="panel p-0 overflow-x-auto relative">
          {/* #41 — inner scroll wrapper for sticky thead; virtual scroll when >200 cards */}
          <div
            ref={parentRef}
            className="flex-1 overflow-y-auto"
            style={
              useVirtualCards
                ? { minHeight: 0, height: 760, overflowY: 'scroll' }
                : { minHeight: 0 }
            }
          >
            <table className="tbl relative">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  {/* #48 — frozen checkbox column */}
                  <th
                    className="bg-card"
                    style={{ width: 36, position: 'sticky', left: 0, zIndex: 4 }}
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
                      draggable={c.id !== 'actions'}
                      onDragStart={() => handleColDragStart(c.id)}
                      onDragOver={handleColDragOver}
                      onDrop={() => handleColDrop(c.id)}
                      style={{
                        background: 'var(--card)',
                        cursor: c.id !== 'actions' ? 'grab' : 'default',
                        userSelect: 'none',
                        ...(i === 0 && c.id !== 'actions'
                          ? {
                              position: 'sticky',
                              left: 36,
                              zIndex: 4,
                              boxShadow: '4px 0 8px rgba(0,0,0,0.25)',
                            }
                          : {}),
                      }}
                    >
                      <span className="flex items-center gap-1">
                        {c.id !== 'actions' && (
                          <span
                            className="text-muted text-[9px]"
                            style={{ opacity: 0.5, lineHeight: 1 }}
                          >
                            ⠿
                          </span>
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>
            {t('pag_showing')} {from}–{to} {t('pag_of')} {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              {t('pag_prev')}
            </button>
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={i} className="text-muted px-1" style={{ lineHeight: '28px' }}>
                  …
                </span>
              ) : (
                <button
                  key={i}
                  onClick={() => setPage(p)}
                  className="btn btn-ghost btn-sm"
                  style={
                    p === page
                      ? { background: 'var(--accent)', color: 'var(--text)', border: 'none' }
                      : undefined
                  }
                >
                  {p}
                </button>
              )
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              {t('pag_next')}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            fetchCards(true)
          }}
        />
      )}

      {/* #61 — Side panel */}
      {sideCard && (
        <CardSidePanel
          card={sideCard}
          cards={cards}
          idx={sideCardIdx}
          revealed={revealed}
          onClose={closeSideCard}
          onNavigate={(c, i) => {
            setSideCard(c, i)
          }}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onCopy={handleCopyToast}
        />
      )}

      {shopUsageCardId !== null && (
        <CardShopUsagePanel cardId={shopUsageCardId} onClose={() => setShopUsageCardId(null)} />
      )}
      {timelineCardId !== null && (
        <CardTimelinePanel cardId={timelineCardId} onClose={() => setTimelineCardId(null)} />
      )}
    </div>
  )
}
