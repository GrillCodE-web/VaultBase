import { useState, useEffect, useCallback, useRef } from 'react'
// FIX P2-3: AbortController for fetch cancellation
import { invoke } from '@tauri-apps/api/core'
import { X, SearchCode, Download } from 'lucide-react'
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
import { ProfileFilters } from './Profiles/ProfileFilters.jsx'
import { ProfilesTable } from './Profiles/ProfilesTable.jsx'
import { QuickOrderModal } from './Profiles/QuickOrderModal.jsx'
import { DuplicateProfilesModal } from './Profiles/DuplicateProfilesModal.jsx'

export default function ProfileList({
  onNavigate,
  activeTab = 'list',
  openCreate: initOpenCreate = false,
}) {
  const [profiles, setProfiles] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState({ has_drop: null, search: '', card_status: null })
  const [deletingIds, setDeletingIds] = useState(new Set())
  const [showCreate, setShowCreate] = useState(initOpenCreate)
  const [showDupProfiles, setShowDupProfiles] = useState(false)
  const [dupProfileGroups, setDupProfileGroups] = useState([])
  const [quickOrderProfile, setQuickOrderProfile] = useState(null)
  const [enrichProgress, setEnrichProgress] = useState(null)
  const deleteTimersRef = useRef(new Map()) // FIX P2-1: Track delete timers for cleanup
  const fetchAbortRef = useRef(null) // FIX P2-3: AbortController for fetch cancellation
  const { toast } = usePremiumToast()
  const { t } = useLang()

  const load = useCallback(
    async (p = page, f = filter) => {
      // FIX P2-3: Abort previous fetch if still running
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort()
      }
      // eslint-disable-next-line no-undef
      fetchAbortRef.current = new AbortController()

      setLoading(true)
      try {
        const result = await invoke('get_profiles', {
          filter: { has_drop: f.has_drop, search: f.search || null, card_status: f.card_status },
          page: p,
          perPage: DEFAULT_PAGE_SIZE,
        })
        setProfiles(result.items)
        setTotal(result.total)
        if (result.items.length === 0 && result.total > 0 && p > 1) {
          setPage(prev => Math.max(1, prev - 1))
        }
      } catch (e) {
        if (fetchAbortRef.current?.signal.aborted) {
          // Fetch was aborted - don't update state
          return
        }
        toast(String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, filter] // toast is stable from useToast hook
  )

  // CLEAN-002: yield до load() — setState-ы внутри load срабатывают после
  // микротаска, не синхронно в теле эффекта (react-hooks/set-state-in-effect);
  // await именно в обёртке: прямой вызов async-useCallback из эффекта
  // трассируется правилом даже с await первой строкой
  useEffect(() => {
    const run = async () => {
      await Promise.resolve()
      load()
    }
    run()
  }, [load])

  // ARCH-013: debounced search через общий хук (refs — чтобы не плодить effect-ы)
  // CLEAN-002: ref-ы обновляем в эффекте, а не во время рендера (react-hooks/refs)
  const loadRef = useRef(load)
  const filterRef = useRef(filter)
  useEffect(() => {
    loadRef.current = load
    filterRef.current = filter
  })
  const onTableFiltersChange = useCallback(f => {
    const next = { ...filterRef.current, search: f.search ?? '' }
    setFilter(next)
    setPage(1)
    loadRef.current(1, next)
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
      // Abort any in-flight fetch
      if (fetchAbortRef.current) {
        fetchAbortRef.current.abort()
      }
    }
  }, [])

  // CLEAN-002: смена таба — паттерн «adjust state during render» вместо
  // синхронных setState внутри useEffect (react-hooks/set-state-in-effect).
  // Данными обновляет эффект [load] ниже по коду: один запрос вместо двух
  // (раньше эффект [activeTab] звал load() явно + load пересоздавался после
  // setFilter и звался ещё раз из эффекта [load]).
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
        load()
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
      load()
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
    load()
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
        </div>
      </div>

      {/* Filters */}
      <ProfileFilters
        filter={filter}
        searchInput={searchInput}
        onFilterChange={newFilter => {
          setFilter(newFilter)
          setPage(1)
          load(1, newFilter)
        }}
        onSearchChange={setSearchInput}
        onSearch={() => load(1, { ...filter, search: searchInput })}
      />

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-accent/10 rounded-md mb-2">
          <span className="text-xs text-muted">{selectedCount} selected</span>
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
        profiles={profiles}
        loading={loading}
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
        onRefresh={load}
        onNavigate={onNavigate}
        onCreate={() => setShowCreate(true)}
      />

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        label="profiles"
        onPageChange={p => {
          setPage(p)
          load(p, filter)
        }}
      />

      {/* Modals */}
      {showCreate && <ProfileModal onCreated={() => load()} onClose={() => setShowCreate(false)} />}
      {showDupProfiles && (
        <DuplicateProfilesModal
          groups={dupProfileGroups}
          onClose={() => setShowDupProfiles(false)}
        />
      )}
      {quickOrderProfile && (
        <QuickOrderModal
          profile={quickOrderProfile}
          onClose={() => setQuickOrderProfile(null)}
          onCreated={() => load()}
        />
      )}
    </div>
  )
}
