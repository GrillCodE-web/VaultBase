import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Archive, Upload, RefreshCw, CreditCard, Zap, FileText } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLang } from '../hooks/useLang.jsx'
import { usePremiumToast } from '../hooks/usePremiumToast.js'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useDebounce } from '../hooks/useDebounce.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { copyToClipboard } from '../utils/clipboard.js'
import { buildPageNumbers, getTotalPages, getPageRange } from '../utils/pagination.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { ImportModal } from './Cards/ImportModal.jsx'
import { CardFilters } from './Cards/CardFilters.jsx'
import { CardRow } from './Cards/CardRow.jsx'
import { ColumnPicker } from './Cards/ColumnPicker.jsx'
import { CardSidePanel } from './Cards/CardSidePanel.jsx'
import { CardShopUsagePanel } from './Cards/CardShopUsagePanel.jsx'
import { CardTimelinePanel } from './Cards/CardTimelinePanel.jsx'
import { useCardsStore } from '../store/cards.js'
import { exportCardsToPDF } from '../utils/pdfExport.js'
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
    { id: 'domain', label: 'Domain' }, // P2-DOMAIN: Domain column
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
  // ★ Insight: useMemo предотвращает создание нового массива при каждом рендере
  // Это ломало бы мемоизацию зависимых компонентов без этой обертки
  const ALL_COLUMNS = useMemo(() => getAllColumns(t), [t])
  const { toast } = usePremiumToast() // Backwards compatible — uses SmartToast internally
  const { confirm } = useConfirm()
  const { successDelete, successExport, errorLoad, errorSave } = usePremiumToast()

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
    revealCard,
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
  // FIX FE-H01: Track delete timers for cleanup on unmount
  const deleteTimers = useRef({})
  // ★ Insight: Sync error state для fallback UI при ошибке WebSocket
  const [syncError, setSyncError] = useState(null)

  const [visibleCols, setVisibleCols] = usePersistedState('cards_visible_cols', DEFAULT_COLS)
  const [columnOrder, setColumnOrder] = usePersistedState('cards_column_order', null)
  const dragColRef = useRef(null)

  // Search input (local state, debounced to store)
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput, 300)

  const totalPages = getTotalPages(total)

  // Virtual scroll container ref
  const parentRef = useRef(null)

  // ── Effects ────────────────────────────────────────────────────────────

  // Initialize: open import modal if requested
  useEffect(() => {
    if (openImport) setShowImport(true)
  }, [openImport, setShowImport])

  // Load cards when filters or page change
  // ★ Insight: AbortController предотвращает race conditions при быстром переключении фильтров
  // Предыдущий запрос отменяется, ответ игнорируется если сигнал прерван
  // ★ Insight: fetchCardsRef и errorLoadRef предотвращают пересоздание useEffect при каждом изменении store
  const fetchCardsRef = useRef(fetchCards)
  const errorLoadRef = useRef(errorLoad)
  fetchCardsRef.current = fetchCards
  errorLoadRef.current = errorLoad

  useEffect(() => {
    // AbortController доступен глобально в современных браузерах и Node.js
    const controller = new globalThis.AbortController()
    let cancelled = false

    const loadCards = async () => {
      try {
        await fetchCardsRef.current(false, controller?.signal ?? null)
        if (!cancelled) {
          // Данные уже обновлены в store, дополнительного state update не нужно
        }
      } catch (e) {
        if (!cancelled && e.name !== 'AbortError') {
          console.error('[Cards] Load error:', e)
          errorLoadRef.current('Cards')
        }
      }
    }
    loadCards()

    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [filters, page]) // Re-fetch when filters or page change

  // Load filter metadata on mount
  useEffect(() => {
    fetchFilterMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced search: update filter when user stops typing
  useEffect(() => {
    setFilters({ search: debouncedSearch || null })
  }, [debouncedSearch, setFilters])

  // Handle activeTab changes (expiring soon filter)
  useEffect(() => {
    setFilters({ expiring_soon: activeTab === 'expiring' ? true : null })
  }, [activeTab, setFilters])

  // Real-time sync: listen for card updates from WS sync
  // ★ Insight: cardsRef вместо cards в зависимостях предотвращает пересоздание listeners
  // при каждом обновлении карт (что происходило бы сотни раз в минуту)
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  // FIX: Обернуть handleSyncUpdate и handleFullSync в ref для стабильности
  const handleSyncUpdateRef = useRef(handleSyncUpdate)
  handleSyncUpdateRef.current = handleSyncUpdate
  const handleFullSyncRef = useRef(handleFullSync)
  handleFullSyncRef.current = handleFullSync

  useEffect(() => {
    let unlistenUpdate = null
    let unlistenFull = null
    let isMounted = true

    const setupListeners = async () => {
      try {
        // Register card_update listener
        const updateListener = await listen('sync:card_update', event => {
          if (!isMounted) return // FIX CRITICAL: Check if still mounted

          const updates = event.payload ?? []
          // Use ref to get latest handler
          handleSyncUpdateRef.current(updates)

          // Flash updated cards — используем ref вместо direct dependency
          updates.forEach(upd => {
            if (!isMounted) return // FIX CRITICAL: Check before each timer

            const card = cardsRef.current.find(c => c.id === upd.id)
            if (card) {
              addFlashedId(card.id)

              // FIX CRITICAL: Clear old timer before setting new one
              const oldTimer = flashTimers.current[card.id]
              if (oldTimer) clearTimeout(oldTimer)

              // FIX CRITICAL: Check mounted state before scheduling
              const timerId = setTimeout(() => {
                if (isMounted) {
                  removeFlashedId(card.id)
                }
              }, 2000)

              flashTimers.current[card.id] = timerId
            }
          })
        })
        if (isMounted) {
          unlistenUpdate = updateListener
          setSyncError(null)
        }

        // Register full_data listener
        const fullListener = await listen('sync:full_data', () => {
          if (isMounted) {
            handleFullSyncRef.current()
          }
        })
        if (isMounted) {
          unlistenFull = fullListener
        }
      } catch (e) {
        if (isMounted) {
          console.error('[Cards] Failed to register sync listeners:', e)
          setSyncError('Real-time sync unavailable')
        }
      }
    }

    setupListeners()

    return () => {
      isMounted = false

      // FIX CRITICAL: Cleanup listeners safely
      if (unlistenUpdate) unlistenUpdate()
      if (unlistenFull) unlistenFull()

      // FIX CRITICAL: Clear all timers using current ref (not stale closure)
      Object.values(flashTimers.current).forEach(clearTimeout)
      flashTimers.current = {}

      Object.values(deleteTimers.current).forEach(clearTimeout)
      deleteTimers.current = {}
    }
  }, [addFlashedId, removeFlashedId])

  // ── Close status menu on outside click ────────────────────────────────

  useEffect(() => {
    if (!statusMenuId) return
    const handler = e => {
      if (!e.target.closest('.status-menu-anchor')) setStatusMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusMenuId, setStatusMenuId])

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
    {
      keys: ['c'],
      handler: () => setShowImport(true),
      requireNoInput: true,
      page: 'cards',
    },
    {
      keys: ['i'],
      handler: () => setShowImport(true),
      requireNoInput: true,
      page: 'cards',
    },
    {
      keys: ['e'],
      handler: () => {
        if (selected.length > 0) {
          handleExport('txt')
        }
      },
      requireNoInput: true,
      page: 'cards',
    },
  ]

  useKeyboardShortcuts(pageShortcuts, { currentPage: 'cards' })

  // ── Actions ────────────────────────────────────────────────────────────

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  const handleStatusChange = useCallback(
    async (id, status) => {
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
    },
    [t, confirm, updateCard, toast]
  )

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  const handleDelete = useCallback(
    async id => {
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

      // FIX FE-H01: Track delete timer for cleanup on unmount
      const timerId = setTimeout(async () => {
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

      deleteTimers.current[id] = timerId
    },
    [t, toast, undoDelete, deleteCard]
  )

  const handleBulkStatus = async status => {
    if (status === 'dead') {
      const ok = await confirm(
        t('cards_bulk_mark_dead').replace('{n}', selected.length),
        t('cc_mark_dead')
      )
      if (!ok) return
    }
    try {
      await bulkUpdateStatus([...selected], status)
      toast(selected.length + ' ' + t('cards_bulk_moved') + ' ' + status, 'success')
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
    const ok = await confirm(
      t('cards_bulk_delete').replace('{n}', selected.length),
      t('btn_delete')
    )
    if (!ok) return
    try {
      await bulkDelete([...selected])
      successDelete('Card', selected.length)
    } catch (e) {
      const error = handleError(e, 'Cards.handleBulkDelete')
      errorSave('Card', getErrorMessage(error))
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
      successExport('Cards')
    } catch (e) {
      const error = handleError(e, 'Cards.handleExport')
      errorSave('Export', getErrorMessage(error))
    }
  }

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  const handleEditNote = useCallback(
    async (id, notes) => {
      try {
        await updateCardNotes(id, notes)
      } catch (e) {
        const error = handleError(e, 'Cards.handleEditNote')
        toast(getErrorMessage(error), 'error')
      }
    },
    [updateCardNotes, toast]
  )

  const handleSearch = useCallback(() => {
    setFilters({ search: searchInput || null })
  }, [searchInput, setFilters])

  const handleResetFilters = useCallback(() => {
    resetFilters()
    setSearchInput('')
  }, [resetFilters])

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  const handleCopyToast = useCallback(
    text => {
      copyToClipboard(
        text,
        () => toast(t('copied'), 'success'),
        () => toast(t('copy_failed'), 'error')
      )
    },
    [t, toast]
  )

  // ── Render helpers ─────────────────────────────────────────────────────

  const allSelected = cards.length > 0 && selected.length === cards.length
  const someSelected = selected.length > 0 && selected.length < cards.length

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  // ★ Insight: Не передаем cards в зависимости — используем card.id из props
  // index вычисляется внутри CardRow при double-click, здесь достаточно просто setSideCard
  const handleSetSideCard = useCallback(
    c => {
      setSideCard(c)
    },
    [setSideCard]
  )

  // ★ Insight: renderCard обернут в useCallback для стабильной ссылки
  // CardRow.memo защищает от лишних рендеров, но стабильная функция улучшает кэширование
  // FIX: cards добавлен в зависимости — он используется в JSX и должен триггерить пересоздание
  const renderCard = useCallback(
    card => (
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
        setSideCard={handleSetSideCard}
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
        revealCard={revealCard}
        t={t}
        toast={toast}
      />
    ),
    [
      cards,
      revealed,
      selected,
      deletingIds,
      flashedIds,
      statusMenuId,
      visibleCols,
      toggleSelect,
      handleSetSideCard,
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
  // ★ Insight: Порог 50 карт вместо 200 — виртуализация включается раньше
  // overscan 10 — баланс между производительностью и UX (меньше белых полос)
  const useVirtualCards = !groupByBank && cards.length > 50

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer из @tanstack/react-virtual совместим с React 19
  const rowVirtualizer = useVirtualizer({
    count: useVirtualCards ? cards.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 10, // Оптимизировано: 10 строк вместо 20 для лучшей производительности
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
                  setSideCard={handleSetSideCard}
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
                  revealCard={revealCard}
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
            className="bg-surface text-muted text-[10px] font-bold border-b uppercase tracking-wide py-[5px] px-2.5"
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
  }
  const { from, to } = getPageRange(page, total)

  return (
    <div className="content">
      {/* Sync error banner */}
      {syncError && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          <span>{syncError}</span>
          <button
            onClick={() => setSyncError(null)}
            className="alert-close"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            CC{' '}
            <span className="text-muted text-[14px] font-normal" aria-live="polite">
              {total.toLocaleString()} {t('nav_cards')}
            </span>
            {freeTotal > 0 && (
              <span className="text-[12px] text-green-t font-normal ml-2" aria-live="polite">
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
          <button
            onClick={() => {
              const carderCols = [
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
              setVisibleCols(carderCols)
            }}
            className="btn btn-ghost btn-sm"
            title={t('cards_carder_view') || 'Carder View'}
          >
            {t('cards_carder_view') || 'Carder View'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowColPicker(v => !v)}
              className="btn btn-ghost btn-sm"
              aria-label={t('cc_columns') || 'Select visible columns'}
              aria-expanded={showColPicker}
            >
              {t('cc_columns')}
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
                <ColumnPicker
                  visible={visibleCols}
                  allColumns={ALL_COLUMNS}
                  t={t}
                  onChange={cols => setVisibleCols(cols)}
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
              aria-label={`${t('cc_archive_dead') || 'Archive dead cards'} - ${t('cc_archive_dead') || 'Archive dead cards'}`}
            >
              <Archive size={12} aria-hidden="true" /> {t('cc_archive_dead')}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="btn btn-b"
              data-shortcut="new"
              title="Import cards (i or c)"
            >
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
        <div className="text-[12px] text-yellow-t rounded-md mb-2 py-2 px-3 bg-warning border-warning">
          {t('cards_expiring_banner')}
        </div>
      )}

      {/* Bulk action bar — fixed bottom */}
      {selected.length > 0 && (
        <div
          className="fixed flex items-center bg-card border-accent rounded-lg shadow-lg z-100 bottom-6 left-1/2 -translate-x-1/2 py-2.5 px-4 gap-2.5"
          role="status"
          aria-live="polite"
        >
          <span className="text-accent font-semibold text-[12px]">
            {selected.length} {t('selected')}
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
                <RefreshCw size={12} className="animate-spin" />
                {enrichProgress.done} / {enrichProgress.total}
              </span>
            ) : (
              <button
                onClick={handleBulkEnrich}
                className="btn btn-b btn-sm btn-icon"
                title="Enrich BIN data for selected cards"
                aria-label="Enrich BIN data for selected cards"
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
            <button
              onClick={() => {
                const selectedCards = cards.filter(c => selected.includes(c.id))
                if (selectedCards.length) exportCardsToPDF(selectedCards)
              }}
              className="btn btn-b btn-sm"
            >
              <FileText size={12} /> PDF
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
                <th className="w-9 bg-card"></th>
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
            className={`flex-1 overflow-y-auto min-h-0 ${useVirtualCards ? 'h-[760px] overflow-y-scroll' : ''}`}
          >
            <table className="tbl relative">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  {/* #48 — frozen checkbox column */}
                  <th className="bg-card w-9 sticky left-0 z-[4]">
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
                      className={`bg-card select-none ${
                        c.id !== 'actions' ? 'cursor-grab' : 'cursor-default'
                      } ${
                        i === 0 && c.id !== 'actions' ? 'sticky left-9 z-[4] shadow-frozen-col' : ''
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        {c.id !== 'actions' && (
                          <span className="text-muted text-[9px] opacity-50 leading-1">⠿</span>
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
                <span key={i} className="text-muted px-1 leading-[28px]">
                  …
                </span>
              ) : (
                <button
                  key={i}
                  onClick={() => setPage(p)}
                  className={`btn btn-ghost btn-sm ${p === page ? 'btn-active' : ''}`}
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
