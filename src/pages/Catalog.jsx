import { useState, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { DEFAULT_PAGE_SIZE } from '../utils/pagination.js'
import { STATUS_COLORS, RISK_COLORS } from '../constants/colors'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// Стабильные пустые ссылки до первой загрузки (иначе новый объект на каждый рендер).
const NO_ITEMS = []
const EMPTY_MAP = {}

// ─── Score badge ──────────────────────────────────────────────

function ScoreBadge({ score }) {
  if (score == null) return <span className="text-muted">—</span>
  const risk = score >= 80 ? RISK_COLORS.low : score >= 50 ? RISK_COLORS.medium : RISK_COLORS.high
  return (
    <span
      className="text-11 font-bold px-[7px] py-0.5 rounded-md"
      style={{ background: risk.bg, color: risk.color }}
    >
      {score}
    </span>
  )
}

// ─── Category badge ───────────────────────────────────────────

function CategoryBadge({ category }) {
  if (!category) return <span className="text-muted">—</span>
  return (
    <span className="text-10 font-semibold px-[7px] py-[2px] rounded bg-info-bg text-info">
      {category}
    </span>
  )
}

// ─── Items Tab ────────────────────────────────────────────────

function ItemsTab() {
  const [page, setPage] = useState(1)
  // searchInput — мгновенное значение поля; search — debounced, идёт в queryKey.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()
  const queryClient = useQueryClient()
  const searchTimer = useRef(null)

  // PERF-010: каталог через TanStack Query — кэш по (page, search), дедуп загрузок.
  const itemsQuery = useQuery({
    queryKey: ['catalog-items', page, search],
    queryFn: async () =>
      invoke('get_catalog_items', { page, perPage: DEFAULT_PAGE_SIZE, search: search || '' }),
    placeholderData: keepPreviousData,
  })
  const items = itemsQuery.data?.items ?? NO_ITEMS
  const total = itemsQuery.data?.total ?? 0
  const pages = itemsQuery.data?.pages ?? 1
  const loading = itemsQuery.isPending
  const itemsRefetch = itemsQuery.refetch

  // Ошибка загрузки — один тост (раньше показывался из catch в load()).
  useEffect(() => {
    if (itemsQuery.isError) {
      const error = handleError(itemsQuery.error, 'Catalog.loadItems')
      toast(getErrorMessage(error), 'error')
    }
  }, [itemsQuery.isError, itemsQuery.error, toast])

  // Real-time: refresh when a new catalog item arrives via WebSocket
  useEffect(() => {
    let isMounted = true
    let unlistenFn = null
    listen('catalog_item_added', () => {
      if (isMounted) itemsRefetch()
    }).then(fn => {
      if (isMounted) unlistenFn = fn
    })

    return () => {
      isMounted = false
      unlistenFn?.()
      clearTimeout(searchTimer.current)
    }
  }, [itemsRefetch])

  const handleSearch = val => {
    setSearchInput(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      setSearch(val)
    }, 300)
  }

  const handleToggleStop = async item => {
    try {
      await invoke('toggle_catalog_item_stop', { id: item.id, stop: !item.stop })
      queryClient.setQueryData(['catalog-items', page, search], prev =>
        prev
          ? {
              ...prev,
              items: prev.items.map(i => (i.id === item.id ? { ...i, stop: !i.stop } : i)),
            }
          : prev
      )
    } catch (e) {
      const error = handleError(e, 'Catalog.handleToggleStop')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return
    const ok = await confirm(`Delete ${selected.size} item${selected.size > 1 ? 's' : ''}?`, {
      title: 'Delete Items',
      danger: true,
    })
    if (!ok) return
    try {
      const ids = [...selected]
      const count = await invoke('delete_catalog_items', { ids })
      toast(`Deleted ${count} item${count !== 1 ? 's' : ''}`, 'success')
      setSelected(new Set())
      itemsRefetch()
    } catch (e) {
      const error = handleError(e, 'Catalog.handleBulkDelete')
      toast(getErrorMessage(error), 'error')
    }
  }

  const toggleSelect = (id, checked) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  const allChecked = items.length > 0 && items.every(i => selected.has(i.id))

  return (
    <div>
      {/* Toolbar */}
      <div className="filters">
        <input
          className="search-box w-[260px]"
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name or ASIN…"
        />
        <span className="text-12 text-muted ml-1">{total} items</span>
        {selected.size > 0 && (
          <button className="btn btn-r btn-sm" onClick={handleDeleteSelected}>
            Delete {selected.size} selected
          </button>
        )}
        {selected.size > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  className="cb"
                  checked={allChecked}
                  onChange={e =>
                    setSelected(e.target.checked ? new Set(items.map(i => i.id)) : new Set())
                  }
                />
              </th>
              <th>Name</th>
              <th>ASIN</th>
              <th>Price</th>
              <th>Margin</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <SkeletonRows count={6} cols={7} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={7} icon={<BookOpen size={38} />} title="No items found" />
            ) : (
              items.map(item => (
                <tr key={item.id} className={item.stop ? 'opacity-50' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      className="cb"
                      checked={selected.has(item.id)}
                      onChange={e => toggleSelect(item.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="font-medium text-13">{item.name}</span>
                  </td>
                  <td>
                    <span className="font-mono text-muted text-11">{item.asin || '—'}</span>
                  </td>
                  <td className="font-mono">
                    {item.price != null ? `$${item.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="font-mono">{item.pct != null ? `${item.pct}%` : '—'}</td>
                  <td>
                    <CategoryBadge category={item.category} />
                  </td>
                  <td>
                    <button
                      className={`btn btn-sm ${item.stop ? 'btn-r' : 'btn-g'}`}
                      onClick={() => handleToggleStop(item)}
                      title={item.stop ? 'Stopped — click to activate' : 'Active — click to stop'}
                    >
                      {item.stop ? 'Stopped' : 'Active'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-11 text-muted">
          <span>
            Showing {items.length} of {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className={`btn btn-ghost btn-sm${p === page ? ' bg-accent text-text border-none' : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Shops Tab ────────────────────────────────────────────────

// MGR-006: сортировка по приоритету менеджера (weight desc), затем как отдал сервер
function sortByPriority(list, map) {
  return [...list].sort((a, b) => (map[b.domain] || 0) - (map[a.domain] || 0))
}

function ShopsTab() {
  const [page, setPage] = useState(1)
  // searchInput — мгновенное значение поля; search — debounced, идёт в queryKey.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const { toast } = usePremiumToast()
  const queryClient = useQueryClient()
  const searchTimer = useRef(null)

  // MGR-006: приоритеты шопов от менеджера (мапа domain → weight); каталог
  // работает и без них — ошибка глушится в queryFn.
  const prioritiesQuery = useQuery({
    queryKey: ['shop-priorities'],
    queryFn: async () => invoke('get_shop_priorities').catch(() => null),
  })
  const priorities = prioritiesQuery.data?.by_domain ?? EMPTY_MAP

  // PERF-010: каталог через TanStack Query — кэш по (page, search), дедуп загрузок.
  const shopsQuery = useQuery({
    queryKey: ['catalog-shops', page, search],
    queryFn: async () =>
      invoke('get_catalog_shops', { page, perPage: DEFAULT_PAGE_SIZE, search: search || '' }),
    placeholderData: keepPreviousData,
  })
  // MGR-006: сортировка по приоритету менеджера (weight desc), затем как отдал сервер.
  // Раньше — prioritiesRef + пересортировка уже показанного; теперь чистая функция данных.
  const shops = useMemo(
    () => sortByPriority(shopsQuery.data?.items ?? NO_ITEMS, priorities),
    [shopsQuery.data, priorities]
  )
  const total = shopsQuery.data?.total ?? 0
  const pages = shopsQuery.data?.pages ?? 1
  const loading = shopsQuery.isPending
  const shopsRefetch = shopsQuery.refetch

  // Ошибка загрузки — один тост (раньше показывался из catch в load()).
  useEffect(() => {
    if (shopsQuery.isError) {
      const error = handleError(shopsQuery.error, 'Catalog.loadShops')
      toast(getErrorMessage(error), 'error')
    }
  }, [shopsQuery.isError, shopsQuery.error, toast])

  // Real-time: refresh when a new catalog shop arrives via WebSocket
  useEffect(() => {
    let isMounted = true
    const unlisten = listen('catalog_shop_added', () => {
      if (isMounted) shopsRefetch()
    })
    return () => {
      unlisten.then(fn => fn())
      // ★ Insight: Cleanup timer при unmount предотвращает memory leak
      clearTimeout(searchTimer.current)
    }
  }, [shopsRefetch])

  const handleSearch = val => {
    setSearchInput(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      setSearch(val)
    }, 300)
  }

  const handleToggleExcluded = async shop => {
    try {
      await invoke('toggle_catalog_shop_excluded', { id: shop.id, excluded: !shop.excluded })
      queryClient.setQueryData(['catalog-shops', page, search], prev =>
        prev
          ? {
              ...prev,
              items: prev.items.map(s => (s.id === shop.id ? { ...s, excluded: !s.excluded } : s)),
            }
          : prev
      )
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="filters">
        <input
          className="search-box w-[260px]"
          value={searchInput}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by domain…"
        />
        <span className="text-12 text-muted ml-1">{total} shops</span>
      </div>

      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Category</th>
              <th>Score</th>
              <th>Priority</th>
              <th>Ship US</th>
              <th>Fraud Level</th>
              <th>Excluded</th>
            </tr>
          </thead>
          <tbody>
            {loading && shops.length === 0 ? (
              <SkeletonRows count={6} cols={7} />
            ) : shops.length === 0 ? (
              <EmptyState colSpan={7} icon={<BookOpen size={38} />} title="No shops found" />
            ) : (
              shops.map(shop => (
                <tr key={shop.id} className={shop.excluded ? 'opacity-50' : ''}>
                  <td>
                    <span className="font-mono text-12">{shop.domain}</span>
                  </td>
                  <td>
                    <CategoryBadge category={shop.category} />
                  </td>
                  <td>
                    <ScoreBadge score={shop.score} />
                  </td>
                  <td>
                    {priorities[shop.domain] > 0 ? (
                      <span
                        className="text-11 font-bold px-[7px] py-0.5 rounded-md bg-[var(--accent-dim)] text-[var(--accent-text)]"
                        title={`Manager priority weight: ${priorities[shop.domain]}`}
                      >
                        ★ {priorities[shop.domain]}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="text-13">{shop.ship_us ? '✓' : '✗'}</span>
                  </td>
                  <td>
                    {shop.fraud_level ? (
                      <span
                        className="text-10 font-semibold px-[7px] py-0.5 rounded-md"
                        style={{
                          background: RISK_COLORS[shop.fraud_level]?.bg || RISK_COLORS.low.bg,
                          color: RISK_COLORS[shop.fraud_level]?.color || RISK_COLORS.low.color,
                        }}
                      >
                        {shop.fraud_level}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className={`btn btn-sm ${shop.excluded ? 'btn-r' : 'btn-g'}`}
                      onClick={() => handleToggleExcluded(shop)}
                      title={
                        shop.excluded
                          ? 'Excluded — click to include'
                          : 'Included — click to exclude'
                      }
                    >
                      {shop.excluded ? 'Excluded' : 'Included'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-11 text-muted">
          <span>
            Showing {shops.length} of {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className={`btn btn-ghost btn-sm${p === page ? ' bg-accent text-text border-none' : ''}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Catalog Page ────────────────────────────────────────

export default function Catalog({ activeTab }) {
  // activeTab can be "items", "shops", or "list" (default from shell — treat as items)
  const tab = activeTab === 'shops' ? 'shops' : 'items'

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">
            <BookOpen size={14} /> Catalog
          </div>
          <div className="ph-sub">Browse catalog items and shops</div>
        </div>
      </div>

      {tab === 'items' ? <ItemsTab /> : <ShopsTab />}
    </div>
  )
}
