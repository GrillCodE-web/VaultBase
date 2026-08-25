import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Archive, Upload, RefreshCw, Zap, FileText } from 'lucide-react'
import { useLang } from '../hooks/useLang.jsx'
import { usePremiumToast } from '../hooks/usePremiumToast.js'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { useTableFilters } from '../hooks/useTableFilters.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { copyToClipboard, copySensitive } from '../utils/clipboard.js'
import { buildPageNumbers, getTotalPages, getPageRange } from '../utils/pagination.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { isInInputField } from '../config/shortcuts.js'
import { DELETE_UNDO_WINDOW_MS, FLASH_HIGHLIGHT_MS } from '../constants/cards.js'
import { ImportModal } from './Cards/ImportModal.jsx'
import { CardFilters } from './Cards/CardFilters.jsx'
import { CardTable } from './Cards/CardTable.jsx'
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

// #default order — Number | Exp | Holder | ZIP | City | State | Country | Phone | Status | Actions
// CVV и Copy Billing не входят в дефолт: у большинства карт они пустые,
// колонки висят мёртвым грузом. Включаются через Columns или Carder View.
const DEFAULT_COLS = [
  'card_number',
  'expiry',
  'holder',
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

  // ARCH-013: debounced search через общий хук (searchInput + 300ms debounce → store filters)
  const applySearchToStore = useCallback(
    f => setFilters({ search: f.search || null }),
    [setFilters]
  )
  const { searchInput, setSearch: setSearchInput } = useTableFilters(applySearchToStore, {}, 300)

  const totalPages = getTotalPages(total)

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
              }, FLASH_HIGHLIGHT_MS)

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

  // UX-005: стрелки ↑/↓ двигают выделение по таблице, Enter открывает side panel.
  // Здесь, а не в useKeyboardShortcuts: там только single-key/sequence, и
  // state (selected/cards) нужен свежий через замыкание — пересоздаём слушатель.
  useEffect(() => {
    const handler = e => {
      if (isInInputField()) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
      const list = useCardsStore.getState().cards
      if (!list.length) return
      const sel = useCardsStore.getState().selected
      const cur = list.findIndex(c => sel.includes(c.id))
      if (e.key === 'Enter') {
        if (cur >= 0) setSideCard(list[cur], cur)
        return
      }
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(cur + 1, list.length - 1) : Math.max(cur - 1, 0)
      const idx = cur < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : next
      clearSelection()
      toggleSelect(list[idx].id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSideCard, clearSelection, toggleSelect])

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
        // Окно Undo = окну отложенного удаления (числа обязаны совпадать)
        duration: DELETE_UNDO_WINDOW_MS,
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
      }, DELETE_UNDO_WINDOW_MS)

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
  }, [resetFilters, setSearchInput])

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  // SEC-013: copySensitive (auto-clear буфера через 30с) для раскрытых PAN/CVV;
  // второй аргумент — true только из CardRow при копировании reveal-полей.
  const handleCopyToast = useCallback(
    (text, sensitive = false) => {
      if (sensitive) {
        copySensitive(String(text)).then(ok => {
          toast(t(ok ? 'copied' : 'copy_failed'), ok ? 'success' : 'error')
        })
        return
      }
      copyToClipboard(
        text,
        () => toast(t('copied'), 'success'),
        () => toast(t('copy_failed'), 'error')
      )
    },
    [t, toast]
  )

  // ── Render helpers ─────────────────────────────────────────────────────

  // FIX F-MED-01: useCallback для стабилизации ссылок (React.memo optimization)
  // ★ Insight: Не передаем cards в зависимости — используем card.id из props
  // index вычисляется внутри CardRow при double-click, здесь достаточно просто setSideCard
  const handleSetSideCard = useCallback(
    c => {
      setSideCard(c)
    },
    [setSideCard]
  )

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
                <Zap size={12} /> {t('btn_bin_enrich')}
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
      {cards.length === 0 && !loading ? (
        <div className="panel p-0">
          <div className="flex items-center justify-center p-12">
            <div className="text-center">
              <div className="text-muted mb-4">
                <svg
                  className="mx-auto h-12 w-12"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h18M3 14h18m-9-4v8m-7 0a2 2 0 11-4 0 2 2 0 014 0zM3 21h18a2 2 0 002-2V5a2 2 0 00-2-2H3a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-text">{t('cc_no_cards')}</h3>
              <p className="text-sm text-muted mt-1">{t('cc_import_first')}</p>
              <button onClick={() => setShowImport(true)} className="btn btn-b mt-4">
                {t('btn_import')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <CardTable
          cards={cards}
          loading={loading}
          total={total}
          freeTotal={freeTotal}
          page={page}
          visibleCols={visibleCols}
          setVisibleCols={setVisibleCols}
          ALL_COLUMNS={ALL_COLUMNS}
          columnOrder={columnOrder}
          setColumnOrder={setColumnOrder}
          groupByBank={groupByBank}
          t={t}
          toast={toast}
          // Cards store
          toggleSelect={toggleSelect}
          toggleSelectAll={toggleSelectAll}
          clearSelection={clearSelection}
          selected={selected}
          deletingIds={deletingIds}
          revealed={revealed}
          revealCard={revealCard}
          flashedIds={flashedIds}
          // UI store
          statusMenuId={statusMenuId}
          setStatusMenuId={setStatusMenuId}
          setShopUsageCardId={setShopUsageCardId}
          setTimelineCardId={setTimelineCardId}
          // Handlers
          handleStatusChange={handleStatusChange}
          handleDelete={handleDelete}
          handleCopyToast={handleCopyToast}
          handleEditNote={handleEditNote}
          setFilters={setFilters}
          setPage={setPage}
          onNavigate={onNavigate}
          // For side panel
          setSideCard={handleSetSideCard}
        />
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
