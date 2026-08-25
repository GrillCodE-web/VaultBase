import React, { useState, useEffect, useCallback, useRef } from 'react'
// FIX P2-3: AbortController for fetch cancellation
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import { User, X, SearchCode, Download } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useTableFilters } from '../hooks/useTableFilters.js'
import { useBulkActions } from '../hooks/useBulkActions.js'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js'
import { EmptyState } from '../components/EmptyState.jsx'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { shortId } from '../utils/formatting.js'
import { buildPageNumbers, DEFAULT_PAGE_SIZE, getTotalPages } from '../utils/pagination.js'
import { exportToCSV } from '../utils/csv.js'
import { copyText } from '../utils/clipboard.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { ProfileModal } from './Profiles/ProfileModal.jsx'
import { ProfileFilters } from './Profiles/ProfileFilters.jsx'
import { ProfileRow } from './Profiles/ProfileRow.jsx'
import { ProfileDetailPanel } from './Profiles/ProfileDetailPanel.jsx'
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
  const [expanded, setExpanded] = useState(null)
  const [hoveredProfile, setHoveredProfile] = useState(null)
  const hoverTimer = useRef(null)
  const [showCreate, setShowCreate] = useState(initOpenCreate)
  const [showDupProfiles, setShowDupProfiles] = useState(false)
  const [dupProfileGroups, setDupProfileGroups] = useState([])
  const [quickOrderProfile, setQuickOrderProfile] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [enrichProgress, setEnrichProgress] = useState(null)
  const tableBodyRef = useRef(null)
  const tableContainerRef = useRef(null)
  const deleteTimersRef = useRef(new Map()) // FIX P2-1: Track delete timers for cleanup
  const fetchAbortRef = useRef(null) // FIX P2-3: AbortController for fetch cancellation
  const { toast } = usePremiumToast()
  const { t } = useLang()

  // Virtual scrolling setup
  // ★ Insight: overscan увеличен до 20, estimateSize вынесен из useCallback
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer из @tanstack/react-virtual совместим с React 19
  const rowVirtualizer = useVirtualizer({
    count: profiles.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: index => {
      // Base row height + expanded detail panel if open
      const profile = profiles[index]
      return expanded === profile?.id ? 450 : 50
    },
    overscan: 20, // Увеличено с 5 до 20
  })

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

  useEffect(() => {
    load()
  }, [load])

  // ARCH-013: debounced search через общий хук (refs — чтобы не плодить effect-ы)
  const loadRef = useRef(load)
  loadRef.current = load
  const filterRef = useRef(filter)
  filterRef.current = filter
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

  // FIX FE-H02: Cleanup hover timer on unmount to prevent memory leak
  // FIX P2-1: Cleanup all delete timers on unmount
  useEffect(() => {
    // Copy ref to a local variable inside the effect to avoid stale-ref warning
    const timers = deleteTimersRef.current
    return () => {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current)
        hoverTimer.current = null
      }
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

  useEffect(() => {
    if (activeTab === 'nodrop') {
      const f = { ...filter, has_drop: false }
      setFilter(f)
      setPage(1)
      load(1, f)
    } else if (activeTab === 'list') {
      const f = { ...filter, has_drop: null }
      setFilter(f)
      setPage(1)
      load(1, f)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]) // filter and load intentionally omitted to avoid infinite loop

  // H4: Keyboard navigation with virtual scrolling
  useEffect(() => {
    const onKey = e => {
      // Don't intercept when typing in an input/textarea
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      )
        return
      if (profiles.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(i => {
          const next = i === null ? 0 : Math.min(i + 1, profiles.length - 1)
          // Scroll to row using virtualizer
          rowVirtualizer.scrollToIndex(next, { align: 'auto' })
          return next
        })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(i => {
          const prev = i === null ? 0 : Math.max(i - 1, 0)
          // Scroll to row using virtualizer
          rowVirtualizer.scrollToIndex(prev, { align: 'auto' })
          return prev
        })
      } else if (e.key === 'Enter' && selectedIdx !== null) {
        e.preventDefault()
        const p = profiles[selectedIdx]
        if (p) {
          invoke('open_float_window', { profileId: p.id }).catch(e =>
            console.error('[Profiles] Failed to open float window:', e)
          )
        }
      } else if (e.key === 'Escape') {
        setSelectedIdx(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profiles, selectedIdx, rowVirtualizer])

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
        // Add drop to first selected/expanded profile
        if (expanded) {
          const profile = profiles.find(p => p.id === expanded)
          if (profile) {
            // Trigger add drop action - this would need to be implemented
            // For now, just expand the profile if not already expanded
          }
        }
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

      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <div
          ref={tableContainerRef}
          className="flex-1 min-h-0 overflow-y-auto max-h-[calc(100vh-280px)]"
        >
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th className="bg-card w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="accent-accent"
                  />
                </th>
                <th className="bg-card"></th>
                <th className="bg-card">{t('prof_col_profile')}</th>
                <th className="bg-card">{t('prof_col_card')}</th>
                <th className="bg-card">{t('prof_col_type')}</th>
                <th className="bg-card">{t('prof_col_bank')}</th>
                <th className="bg-card">{t('prof_col_country')}</th>
                <th className="bg-card">{t('prof_col_status')}</th>
                <th className="bg-card">{t('prof_col_drops')}</th>
                <th className="bg-card">{t('prof_col_orders')}</th>
                <th className="bg-card">{t('cc_col_notes')}</th>
                <th className="bg-card">{t('prof_col_created')}</th>
                <th className="bg-card">{t('cc_col_actions')}</th>
              </tr>
            </thead>
            <tbody ref={tableBodyRef}>
              {loading && profiles.length === 0 && <SkeletonRows count={6} cols={12} />}
              {profiles.length === 0 && !loading && (
                <EmptyState
                  colSpan={13}
                  icon={<User size={38} />}
                  title={t('no_profiles')}
                  subtitle={t('new_profile')}
                  action={
                    <button className="btn btn-g btn-sm" onClick={() => setShowCreate(true)}>
                      + Create Profile
                    </button>
                  }
                />
              )}
              {!loading && profiles.length > 0 && (
                <>
                  {/* Spacer for virtual scroll offset */}
                  {rowVirtualizer.getVirtualItems().length > 0 && (
                    <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                      <td colSpan={13} className="p-0 border-none"></td>
                    </tr>
                  )}

                  {/* Render visible rows */}
                  {rowVirtualizer.getVirtualItems().map(virtualRow => {
                    const idx = virtualRow.index
                    const p = profiles[idx]
                    if (!p) return null

                    const isExpanded = expanded === p.id
                    const isDeleting = deletingIds.has(p.id)
                    const isSelected = selectedIdx === idx

                    return (
                      <React.Fragment key={p.id}>
                        <ProfileRow
                          profile={p}
                          idx={idx}
                          isExpanded={isExpanded}
                          isDeleting={isDeleting}
                          isSelected={isSelected}
                          isChecked={selectedSet.has(p.id)}
                          onToggleSelect={toggleSelect}
                          onRowClick={() => {
                            setSelectedIdx(idx)
                            setExpanded(isExpanded ? null : p.id)
                            // Remeasure after state change
                            setTimeout(() => rowVirtualizer.measure(), 0)
                          }}
                          onMouseEnter={e => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            hoverTimer.current = setTimeout(
                              () => setHoveredProfile({ p, rect }),
                              400
                            )
                          }}
                          onMouseLeave={() => {
                            clearTimeout(hoverTimer.current)
                            setHoveredProfile(null)
                          }}
                          onDelete={() => handleDelete(p)}
                          onDuplicate={() => handleDuplicate(p)}
                          onCopyProfile={() => copyProfile(p)}
                          onCopyBilling={() => copyBilling(p)}
                          onCopyShipping={() => copyShipping(p)}
                          onQuickOrder={() => setQuickOrderProfile(p)}
                        />
                        {isExpanded && (
                          <tr key={`${p.id}-detail`}>
                            <td colSpan={13} className="p-0">
                              <ProfileDetailPanel
                                profileId={p.id}
                                onRefresh={load}
                                onNavigate={onNavigate}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}

                  {/* Spacer for remaining virtual scroll space */}
                  {rowVirtualizer.getVirtualItems().length > 0 && (
                    <tr
                      style={{
                        height: `${
                          rowVirtualizer.getTotalSize() -
                          (rowVirtualizer.getVirtualItems()[
                            rowVirtualizer.getVirtualItems().length - 1
                          ]?.end || 0)
                        }px`,
                      }}
                    >
                      <td colSpan={13} className="p-0 border-none"></td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] text-muted">{total} profiles</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map((p, idx) =>
              p === '…' ? (
                <span key={`ellipsis-${idx}`} className="px-2 py-1 text-[12px] text-muted">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p)
                    load(p, filter)
                  }}
                  className={
                    page === p
                      ? 'btn btn-ghost btn-sm active pagination-btn-active'
                      : 'btn btn-ghost btn-sm'
                  }
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

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
      {hoveredProfile &&
        (() => {
          const { p, rect } = hoveredProfile
          const top = Math.min(rect.top + rect.height / 2 - 55, window.innerHeight - 130)
          const left = Math.min(rect.right + 10, window.innerWidth - 240)
          return (
            <div
              className="fixed z-200 pointer-events-none bg-card border rounded-[10px] p-\[12px_14px\] min-w-\[200px\] max-w-\[240px\] shadow-lg"
              style={{
                top,
                left,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-text text-[13px] font-medium">
                  ••••-{p.last4 || '????'}
                </span>
                <span
                  className="text-[10px] py-\[1px\] px-1.5 rounded-sm"
                  style={{
                    background:
                      p.drop_count > 0 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                    border: `1px solid ${p.drop_count > 0 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)'}`,
                    color: p.drop_count > 0 ? 'var(--color-success)' : 'var(--color-warning)',
                  }}
                >
                  {p.drop_count > 0 ? t('profile_ready') : t('profile_no_drop')}
                </span>
              </div>
              {p.holder_masked && (
                <div className="text-muted text-[12px] mb-1">{p.holder_masked}</div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {p.bin && <span className="text-muted text-[11px] font-mono">BIN {p.bin}</span>}
                {p.bank_name && <span className="text-[11px] text-muted">· {p.bank_name}</span>}
              </div>
              {p.drop_count !== undefined && (
                <div className="mt-\[5px\] text-muted text-[11px]">
                  {p.drop_count} drop{p.drop_count !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )
        })()}
    </div>
  )
}
