import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { X, SearchCode, Download, Scale } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useTableFilters } from '../hooks/useTableFilters.js'
import { useBulkActions } from '../hooks/useBulkActions.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { shortId } from '../utils/formatting.js'
import { DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { Pagination } from '../components/Pagination.jsx'
import { exportToCSV } from '../utils/csv.js'
import { copyText } from '../utils/clipboard.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { ProfileModal } from './Profiles/ProfileModal.jsx'
import { ColumnPicker } from '../components/ColumnPicker.jsx'
import { ProfileFilters } from './Profiles/ProfileFilters.jsx'
import { ProfilesTable } from './Profiles/ProfilesTable.jsx'
import { useRowOrder } from '../hooks/useRowOrder.js'
import { QuickOrderModal } from './Profiles/QuickOrderModal.jsx'
import { DuplicateProfilesModal } from './Profiles/DuplicateProfilesModal.jsx'
import { CompareProfilesModal } from './Profiles/CompareProfilesModal.jsx'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { APPLY_ORDER_PRESET_EVENT } from '../utils/orderPresets.js'

// REDESIGN-05-4 (порция 2): выбор колонок таблицы профилей (localStorage).
// select/expand/actions всегда видимы и в пикер не попадают (lockedIds).
const PROFILE_COLUMNS = [
  { id: 'select', label: '' },
  { id: 'expand', label: '' },
  { id: 'profile', label: 'prof_col_profile' },
  { id: 'card', label: 'prof_col_card' },
  { id: 'type', label: 'prof_col_type' },
  { id: 'bank', label: 'prof_col_bank' },
  { id: 'country', label: 'prof_col_country' },
  { id: 'status', label: 'prof_col_status' },
  { id: 'drops', label: 'prof_col_drops' },
  { id: 'orders', label: 'prof_col_orders' },
  { id: 'notes', label: 'cc_col_notes' },
  { id: 'created', label: 'prof_col_created' },
  { id: 'actions', label: 'cc_col_actions' },
]
const PROFILE_DEFAULT_COLS = PROFILE_COLUMNS.map(c => c.id)

// Стабильная пустая ссылка до первой загрузки — чтобы хуки поверх списка
// (useRowOrder, useBulkActions) не пересоздавались на каждый рендер.
const NO_ITEMS = []

export default function ProfileList({
  onNavigate,
  activeTab = 'list',
  openCreate: initOpenCreate = false,
}) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState({ has_drop: null, search: '', card_status: null })
  const [deletingIds, setDeletingIds] = useState(new Set())
  const [showCreate, setShowCreate] = useState(initOpenCreate)
  const [showDupProfiles, setShowDupProfiles] = useState(false)
  const [dupProfileGroups, setDupProfileGroups] = useState([])
  // REDESIGN-05-4 (порция 3): сравнение профилей — id пары для модалки
  const [compareIds, setCompareIds] = useState(null)
  const [quickOrderProfile, setQuickOrderProfile] = useState(null)
  const [quickOrderPreset, setQuickOrderPreset] = useState(null)
  const [enrichProgress, setEnrichProgress] = useState(null)
  const [visibleCols, setVisibleCols] = usePersistedState(
    'profiles_visible_cols',
    PROFILE_DEFAULT_COLS
  )
  const [showColPicker, setShowColPicker] = useState(false)
  const deleteTimersRef = useRef(new Map()) // FIX P2-1: Track delete timers for cleanup
  const { toast } = usePremiumToast()
  const { t } = useLang()

  // PERF-010: данные через TanStack Query — кэш по (page, filter), дедуп
  // одновременных загрузок, устаревшие ответы отбрасываются из коробки.
  const profilesQuery = useQuery({
    queryKey: ['profiles', page, filter.has_drop, filter.search || null, filter.card_status],
    queryFn: async () => {
      return invoke('get_profiles', {
        filter: {
          has_drop: filter.has_drop,
          search: filter.search || null,
          card_status: filter.card_status,
        },
        page,
        perPage: DEFAULT_PAGE_SIZE,
      })
    },
    placeholderData: keepPreviousData,
  })
  const profiles = profilesQuery.data?.items ?? NO_ITEMS
  const total = profilesQuery.data?.total ?? 0
  const loading = profilesQuery.isPending

  // Если страница опустела (удаление/фильтр), а записи есть — шаг назад.
  useEffect(() => {
    const d = profilesQuery.data
    if (d && d.items.length === 0 && d.total > 0 && page > 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- откат страницы по факту пустой выборки (как раньше в load())
      setPage(prev => Math.max(1, prev - 1))
    }
  }, [profilesQuery.data, page])

  // UX-011: ручной порядок строк профилей (localStorage)
  const { orderedItems: orderedProfiles, moveRow: moveProfileRow } = useRowOrder(
    'profiles_row_order',
    profiles
  )

  // Ошибка загрузки — один тост (раньше показывался из catch в load()).
  useEffect(() => {
    if (profilesQuery.isError) toast(String(profilesQuery.error), 'error')
  }, [profilesQuery.isError, profilesQuery.error, toast])

  // ARCH-013: debounced search через общий хук; смена filter/page сама
  // запускает refetch через queryKey — ручной вызов загрузки не нужен.
  const onTableFiltersChange = useCallback(f => {
    setPage(1)
    setFilter(prev => ({ ...prev, search: f.search ?? '' }))
  }, [])
  const { searchInput, setSearch: setSearchInput } = useTableFilters(onTableFiltersChange, {}, 300)

  // ARCH-014: массовый выбор через общий хук
  const {
    selected,
    selectedSet,
    toggle: toggleSelect,
    toggleAll: toggleSelectAll,
    deselectAll,
    allSelected,
    count: selectedCount,
  } = useBulkActions(profiles)

  // FIX P2-1: Cleanup all delete timers on unmount
  useEffect(() => {
    // Copy ref to a local variable inside the effect to avoid stale-ref warning
    const timers = deleteTimersRef.current
    return () => {
      // Clear all pending delete timers
      timers.forEach(timerId => {
        clearTimeout(timerId)
      })
      timers.clear()
    }
  }, [])

  // SPEC-A (7cx): пресет ордера из ⌘K — открываем QuickOrderModal в профиле
  // пресета (создание заказа живёт в контексте профиля, не на странице Orders).
  useEffect(() => {
    const handler = e => {
      const preset = e.detail
      if (!preset?.profile_id) return
      setQuickOrderProfile({ id: preset.profile_id })
      setQuickOrderPreset(preset)
    }
    window.addEventListener(APPLY_ORDER_PRESET_EVENT, handler)
    return () => window.removeEventListener(APPLY_ORDER_PRESET_EVENT, handler)
  }, [])

  // CLEAN-002: смена таба — паттерн «adjust state during render» вместо
  // синхронных setState внутри useEffect (react-hooks/set-state-in-effect).
  // Данные перезапрашивает useQuery: filter входит в queryKey.
  const [prevActiveTab, setPrevActiveTab] = useState(null)
  if (activeTab !== prevActiveTab) {
    setPrevActiveTab(activeTab)
    if (activeTab === 'nodrop') {
      setFilter(f => ({ ...f, has_drop: false }))
      setPage(1)
    } else if (activeTab === 'list') {
      setFilter(f => ({ ...f, has_drop: null }))
      setPage(1)
    }
  }

  // ── Page-specific keyboard shortcuts ──────────────────────────────────

  const pageShortcuts = [
    {
      keys: ['p'],
      handler: () => setShowCreate(true),
      requireNoInput: true,
      page: 'profiles',
    },
    {
      keys: ['d'],
      handler: () => {
        // Добавление drop к выбранному/expanded профилю: UI пока не реализован
        // (стейт expanded переехал в ProfilesTable в рамках ARCH-008)
      },
      requireNoInput: true,
      page: 'profiles',
    },
  ]

  useKeyboardShortcuts(pageShortcuts, { currentPage: 'profiles' })

  const handleDelete = async profile => {
    // #15 — undo delete, no confirm dialog
    setDeletingIds(prev => new Set([...prev, profile.id]))
    let undone = false

    // FIX P2-1: Track delete timer for cleanup on unmount
    const timerId = setTimeout(async () => {
      if (undone) return
      try {
        await invoke('delete_profile', { id: profile.id })
        setDeletingIds(prev => {
          const n = new Set(prev)
          n.delete(profile.id)
          return n
        })
        profilesQuery.refetch()
        deleteTimersRef.current.delete(profile.id)
      } catch (e) {
        setDeletingIds(prev => {
          const n = new Set(prev)
          n.delete(profile.id)
          return n
        })
        deleteTimersRef.current.delete(profile.id)
        const error = handleError(e, 'Profiles.handleDelete')
        if (e.includes?.('active_orders')) {
          const count = e.split(':')[1]
          toast(`Cannot delete: ${count} active order(s)`, 'error')
        } else {
          toast(getErrorMessage(error), 'error')
        }
      }
    }, 5000)

    deleteTimersRef.current.set(profile.id, timerId)

    toast({
      message: t('profile_deleted'),
      type: 'info',
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true
          clearTimeout(timerId)
          deleteTimersRef.current.delete(profile.id)
          setDeletingIds(prev => {
            const n = new Set(prev)
            n.delete(profile.id)
            return n
          })
        },
      },
    })
  }

  const handleDuplicate = async profile => {
    try {
      const p = await invoke('duplicate_profile', { id: profile.id })
      toast(`Profile duplicated → ${shortId(p.id)}`, 'success')
      profilesQuery.refetch()
    } catch (e) {
      if (e.includes?.('no_free_cards') || e.includes?.('no_unburned_free_card')) {
        toast(t('no_suitable_card'), 'warn')
      } else {
        toast(String(e), 'error')
      }
    }
  }

  const handleFindDupProfiles = async () => {
    try {
      const groups = await invoke('find_duplicate_profiles')
      setDupProfileGroups(groups)
      setShowDupProfiles(true)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  // Copy helpers — reveal encrypted card data first
  const copyProfile = async p => {
    try {
      const card = await invoke('reveal_card', { id: p.card_id })
      const lines = [
        `Card: ${card.card_number} | ${card.expiry_date} | ${card.cvv} | ${card.holder_name || '—'}`,
        `Bank: ${p.bank_name || '—'} · ${p.country || '—'}`,
        `Billing: ${card.billing_address || '—'}, ${card.city || ''} ${card.state || ''} ${card.zip || ''}, ${card.country || ''}`,
      ]
      copyText(lines.join('\n'))
      toast('Profile copied', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const copyBilling = async p => {
    try {
      const card = await invoke('reveal_card', { id: p.card_id })
      const addr = [card.billing_address, card.city, card.state, card.zip, card.country]
        .filter(Boolean)
        .join(', ')
      copyText(addr)
      toast('Billing address copied', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const copyShipping = async p => {
    try {
      const detail = await invoke('get_profile', { id: String(p.id) })
      const drop = detail.drops?.find(d => d.is_primary) ?? detail.drops?.[0]
      if (!drop) {
        toast('No drop address', 'warn')
        return
      }
      const addr = [
        drop.recipient_name,
        drop.address,
        drop.city,
        drop.state,
        drop.zip,
        drop.country,
      ]
        .filter(Boolean)
        .join(', ')
      copyText(addr)
      toast('Shipping address copied', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleBulkEnrich = async () => {
    const ids = [...selected].filter(id => {
      const p = profiles.find(pr => pr.id === id)
      return p?.card_id
    })
    if (!ids.length) return
    setEnrichProgress({ done: 0, total: ids.length })
    let enriched = 0
    for (const id of ids) {
      const p = profiles.find(pr => pr.id === id)
      if (!p?.card_id) continue
      try {
        await invoke('enrich_bin', { id: p.card_id })
        enriched++
      } catch (e) {
        handleError(e)
        /* skip */
      }
      setEnrichProgress({ done: enriched, total: ids.length })
    }
    setEnrichProgress(null)
    deselectAll()
    toast(`BIN enriched: ${enriched} / ${ids.length}`, 'success')
    profilesQuery.refetch()
  }

  const totalPages = getTotalPages(total)

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">Profiles</div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const rows = profiles.map(p => [
                p.id,
                p.holder_masked ?? '',
                p.last4 ?? '',
                p.bank_name ?? '',
                p.country ?? '',
                p.order_count,
                p.drop_count,
                p.card_status ?? '',
              ])
              exportToCSV(
                'profiles_export.csv',
                'ID,Holder,Last4,Bank,Country,Orders,Drops,CardStatus',
                rows
              )
            }}
          >
            <Download size={13} /> Export
          </button>
          <button
            className="btn btn-g"
            onClick={() => setShowCreate(true)}
            data-shortcut="new"
            title="Create profile (p)"
          >
            + {t('new_profile')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleFindDupProfiles}>
            {t('find_duplicates')}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowColPicker(v => !v)}
              className="btn btn-ghost btn-sm"
              aria-label={t('cc_columns')}
              aria-expanded={showColPicker}
            >
              {t('cc_columns')}
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
                <ColumnPicker
                  visible={visibleCols}
                  onChange={setVisibleCols}
                  allColumns={PROFILE_COLUMNS}
                  defaultCols={PROFILE_DEFAULT_COLS}
                  lockedIds={['select', 'expand', 'actions']}
                  t={t}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <ProfileFilters
        filter={filter}
        searchInput={searchInput}
        onFilterChange={newFilter => {
          setFilter(newFilter)
          setPage(1)
        }}
        onSearchChange={setSearchInput}
        onSearch={() => {
          setPage(1)
          setFilter(prev => ({ ...prev, search: searchInput }))
        }}
      />

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-accent/10 rounded-md mb-2">
          <span className="text-xs text-muted">{selectedCount} selected</span>
          {selectedCount === 2 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setCompareIds([...selected])}
              title={t('cmp_open_hint')}
            >
              <Scale size={13} /> {t('cmp_open')}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleBulkEnrich}
            disabled={!!enrichProgress}
          >
            <SearchCode size={13} />
            {enrichProgress
              ? `Enriching ${enrichProgress.done}/${enrichProgress.total}...`
              : t('btn_bin_enrich')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={deselectAll}>
            <X size={13} /> Clear
          </button>
        </div>
      )}

      {/* Table (ARCH-008: вынесена в Profiles/ProfilesTable.jsx) */}
      <ProfilesTable
        profiles={orderedProfiles}
        loading={loading}
        onRowMove={moveProfileRow}
        selectedSet={selectedSet}
        toggleSelect={toggleSelect}
        allSelected={allSelected}
        toggleSelectAll={toggleSelectAll}
        deletingIds={deletingIds}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onCopyProfile={copyProfile}
        onCopyBilling={copyBilling}
        onCopyShipping={copyShipping}
        onQuickOrder={setQuickOrderProfile}
        onRefresh={() => profilesQuery.refetch()}
        onNavigate={onNavigate}
        onCreate={() => setShowCreate(true)}
        visibleCols={visibleCols}
      />

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        label="profiles"
        onPageChange={p => setPage(p)}
      />

      {/* Modals */}
      {showCreate && (
        <ProfileModal
          onCreated={() => profilesQuery.refetch()}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showDupProfiles && (
        <DuplicateProfilesModal
          groups={dupProfileGroups}
          onClose={() => setShowDupProfiles(false)}
        />
      )}
      {/* REDESIGN-05-4 (порция 3): сравнение двух выбранных профилей */}
      {compareIds && <CompareProfilesModal ids={compareIds} onClose={() => setCompareIds(null)} />}
      {quickOrderProfile && (
        <QuickOrderModal
          profile={quickOrderProfile}
          preset={quickOrderPreset}
          onClose={() => {
            setQuickOrderProfile(null)
            setQuickOrderPreset(null)
          }}
          onCreated={() => profilesQuery.refetch()}
        />
      )}
    </div>
  )
}
