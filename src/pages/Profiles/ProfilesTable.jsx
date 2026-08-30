import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { invoke } from '@tauri-apps/api/core'
import { User } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { EmptyState } from '../../components/EmptyState.jsx'
import { SkeletonRows } from '../../components/SkeletonRow.jsx'
import { ProfileRow } from './ProfileRow.jsx'
import { ProfileDetailPanel } from './ProfileDetailPanel.jsx'
import { ProfileHoverCard } from './ProfileHoverCard.jsx'
import { PROFILES_OVERSCAN } from '../../constants/virtualization.js'
import { recordRecentEntity } from '../../utils/recentEntities.js'
import { shortId } from '../../utils/formatting.js'

/**
 * ProfilesTable — выделенный компонент таблицы профилей
 *
 * ★ Insight: виртуализация, expanded-строки, клавиатурная навигация (H4) и
 * hover-карточка живут здесь, чтобы Profiles.jsx остался только оркестрацией
 * (загрузка данных, фильтры, bulk-действия, модалки). Обработчики приходят
 * пропсами.
 */
export function ProfilesTable({
  profiles,
  loading,
  onRowMove,
  selectedSet,
  toggleSelect,
  allSelected,
  toggleSelectAll,
  deletingIds,
  onDelete,
  onDuplicate,
  onCopyProfile,
  onCopyBilling,
  onCopyShipping,
  onQuickOrder,
  onRefresh,
  onNavigate,
  onCreate,
  visibleCols,
}) {
  const { t } = useLang()
  // REDESIGN-05-4: скрытие колонок; без пропа — все 13 (e2e/совместимость)
  const show = id => !visibleCols || visibleCols.includes(id)
  const colCount = visibleCols ? visibleCols.length : 13
  // UX-011: drag & drop строк — хэндлеры стабильны (ref + useCallback),
  // чтобы не ломать React.memo у ProfileRow
  const dragRowRef = useRef(null)
  const rowReorder = typeof onRowMove === 'function'
  const rowDragStart = useCallback((e, id) => {
    dragRowRef.current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }, [])
  const rowDragOver = useCallback(e => {
    if (dragRowRef.current == null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const tr = e.currentTarget
    if (!tr.classList.contains('row-drop-target')) tr.classList.add('row-drop-target')
  }, [])
  const rowDragLeave = useCallback(e => {
    e.currentTarget.classList.remove('row-drop-target')
  }, [])
  const rowDragEnd = useCallback(() => {
    dragRowRef.current = null
    tableContainerRef.current
      ?.querySelectorAll('.row-drop-target')
      .forEach(el => el.classList.remove('row-drop-target'))
  }, [])
  const rowDrop = useCallback(
    (e, targetId) => {
      e.preventDefault()
      e.currentTarget.classList.remove('row-drop-target')
      const srcId = dragRowRef.current
      dragRowRef.current = null
      if (srcId == null) return
      onRowMove?.(srcId, targetId)
    },
    [onRowMove]
  )
  const [expanded, setExpanded] = useState(null)
  const [hoveredProfile, setHoveredProfile] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const hoverTimer = useRef(null)
  const tableBodyRef = useRef(null)
  const tableContainerRef = useRef(null)

  // Virtual scrolling setup
  // ★ Insight: overscan — PROFILES_OVERSCAN (constants/virtualization.js, CLEAN-010); estimateSize вынесен из useCallback
  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer из @tanstack/react-virtual совместим с React 19
  const rowVirtualizer = useVirtualizer({
    count: profiles.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: index => {
      // Base row height + expanded detail panel if open
      const profile = profiles[index]
      return expanded === profile?.id ? 450 : 50
    },
    overscan: PROFILES_OVERSCAN,
  })

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

  // FIX FE-H02: Cleanup hover timer on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current)
        hoverTimer.current = null
      }
    }
  }, [])

  return (
    <>
      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <div
          ref={tableContainerRef}
          className="flex-1 min-h-0 overflow-y-auto max-h-[calc(100vh-280px)]"
        >
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                {show('select') && (
                  <th scope="col" className="bg-card w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-accent"
                    />
                  </th>
                )}
                {show('expand') && <th scope="col" className="bg-card"></th>}
                {show('profile') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_profile')}
                  </th>
                )}
                {show('card') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_card')}
                  </th>
                )}
                {show('type') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_type')}
                  </th>
                )}
                {show('bank') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_bank')}
                  </th>
                )}
                {show('country') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_country')}
                  </th>
                )}
                {show('status') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_status')}
                  </th>
                )}
                {show('drops') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_drops')}
                  </th>
                )}
                {show('orders') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_orders')}
                  </th>
                )}
                {show('notes') && (
                  <th scope="col" className="bg-card">
                    {t('cc_col_notes')}
                  </th>
                )}
                {show('created') && (
                  <th scope="col" className="bg-card">
                    {t('prof_col_created')}
                  </th>
                )}
                {show('actions') && (
                  <th scope="col" className="bg-card">
                    {t('cc_col_actions')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody ref={tableBodyRef}>
              {loading && profiles.length === 0 && <SkeletonRows count={6} cols={colCount} />}
              {profiles.length === 0 && !loading && (
                <EmptyState
                  colSpan={colCount}
                  icon={<User size={38} />}
                  title={t('no_profiles')}
                  subtitle={t('new_profile')}
                  action={
                    <button className="btn btn-g btn-sm" onClick={onCreate}>
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
                      <td colSpan={colCount} className="p-0 border-none"></td>
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
                          visibleCols={visibleCols}
                          isExpanded={isExpanded}
                          isDeleting={isDeleting}
                          isSelected={isSelected}
                          isChecked={selectedSet.has(p.id)}
                          onToggleSelect={toggleSelect}
                          onRowClick={() => {
                            setSelectedIdx(idx)
                            setExpanded(isExpanded ? null : p.id)
                            // REDESIGN-05-4: раскрытие профиля → «последние сущности» ⌘K
                            if (!isExpanded) {
                              recordRecentEntity({
                                type: 'profile',
                                id: p.id,
                                label: shortId(p.id),
                                sub: [p.bank_name, p.country].filter(Boolean).join(' · '),
                              })
                            }
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
                          onDelete={() => onDelete(p)}
                          onDuplicate={() => onDuplicate(p)}
                          onCopyProfile={() => onCopyProfile(p)}
                          onCopyBilling={() => onCopyBilling(p)}
                          onCopyShipping={() => onCopyShipping(p)}
                          onQuickOrder={() => onQuickOrder(p)}
                          rowReorder={rowReorder}
                          rowDragStart={rowDragStart}
                          rowDragOver={rowDragOver}
                          rowDragLeave={rowDragLeave}
                          rowDragEnd={rowDragEnd}
                          rowDrop={rowDrop}
                        />
                        {isExpanded && (
                          <tr key={`${p.id}-detail`}>
                            <td colSpan={colCount} className="p-0">
                              <ProfileDetailPanel
                                profileId={p.id}
                                onRefresh={onRefresh}
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
                      <td colSpan={colCount} className="p-0 border-none"></td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hover profile card */}
      {hoveredProfile && <ProfileHoverCard profile={hoveredProfile.p} rect={hoveredProfile.rect} />}
    </>
  )
}
