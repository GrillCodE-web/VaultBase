import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BookOpen } from 'lucide-react'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import { DEFAULT_PAGE_SIZE } from '../utils/pagination.js'
import { STATUS_COLORS, RISK_COLORS } from '../constants/colors'

// ─── Score badge ──────────────────────────────────────────────

function ScoreBadge({ score }) {
  if (score == null) return <span className="text-muted">—</span>
  const risk = score >= 80 ? RISK_COLORS.low : score >= 50 ? RISK_COLORS.medium : RISK_COLORS.high
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 7px',
        borderRadius: 4,
        background: risk.bg,
        color: risk.color,
      }}
    >
      {score}
    </span>
  )
}

// ─── Category badge ───────────────────────────────────────────

function CategoryBadge({ category }) {
  if (!category) return <span className="text-muted">—</span>
  return (
    <span
      className="text-[10px] font-semibold px-[7px] py-[2px] rounded"
      style={{
        background: STATUS_COLORS.infoBg,
        color: STATUS_COLORS.info,
      }}
    >
      {category}
    </span>
  )
}

// ─── Items Tab ────────────────────────────────────────────────

function ItemsTab() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const searchTimer = useRef(null)

  const load = useCallback(
    async (p = page, s = search) => {
      setLoading(true)
      try {
        const r = await invoke('get_catalog_items', {
          page: p,
          perPage: DEFAULT_PAGE_SIZE,
          search: s || '',
        })
        setItems(r.items)
        setTotal(r.total)
        setPages(r.pages)
      } catch (e) {
        toast(String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    [page, search, toast]
  )

  useEffect(() => {
    load(1, '')
    // Real-time: refresh when a new catalog item arrives via WebSocket
    const unlisten = listen('catalog_item_added', () => {
      load(page, search)
    })
    return () => {
      unlisten.then(fn => fn())
    }
  }, [load, page, search])

  const handleSearch = val => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      load(1, val)
    }, 300)
  }

  const handleToggleStop = async item => {
    try {
      await invoke('toggle_catalog_item_stop', { id: item.id, stop: !item.stop })
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, stop: !i.stop } : i)))
    } catch (e) {
      toast(String(e), 'error')
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
      load(page, search)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const toggleSelect = (id, checked) => {
    setSelected(prev => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
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
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name or ASIN…"
        />
        <span className="text-[12px] text-muted ml-1">{total} items</span>
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
              <th>Stop</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted p-6">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted p-6">
                  No items found
                </td>
              </tr>
            ) : (
              items.map(item => (
                <tr key={item.id} style={{ opacity: item.stop ? 0.5 : 1 }}>
                  <td>
                    <input
                      type="checkbox"
                      className="cb"
                      checked={selected.has(item.id)}
                      onChange={e => toggleSelect(item.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <span className="font-medium text-[13px]">{item.name}</span>
                  </td>
                  <td>
                    <span className="font-mono text-muted text-[11px]">{item.asin || '—'}</span>
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
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>
            Showing {items.length} of {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => {
                const np = page - 1
                setPage(np)
                load(np, search)
              }}
            >
              Prev
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className="btn btn-ghost btn-sm"
                style={
                  p === page
                    ? { background: 'var(--accent)', color: 'var(--text)', border: 'none' }
                    : undefined
                }
                onClick={() => {
                  setPage(p)
                  load(p, search)
                }}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => {
                const np = page + 1
                setPage(np)
                load(np, search)
              }}
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

function ShopsTab() {
  const [shops, setShops] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const searchTimer = useRef(null)

  const load = useCallback(
    async (p = page, s = search) => {
      setLoading(true)
      try {
        const r = await invoke('get_catalog_shops', {
          page: p,
          perPage: DEFAULT_PAGE_SIZE,
          search: s || '',
        })
        setShops(r.items)
        setTotal(r.total)
        setPages(r.pages)
      } catch (e) {
        toast(String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    [page, search, toast]
  )

  useEffect(() => {
    load(1, '')
    // Real-time: refresh when a new catalog shop arrives via WebSocket
    const unlisten = listen('catalog_shop_added', () => {
      load(page, search)
    })
    return () => {
      unlisten.then(fn => fn())
    }
  }, [load, page, search])

  const handleSearch = val => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      load(1, val)
    }, 300)
  }

  const handleToggleExcluded = async shop => {
    try {
      await invoke('toggle_catalog_shop_excluded', { id: shop.id, excluded: !shop.excluded })
      setShops(prev => prev.map(s => (s.id === shop.id ? { ...s, excluded: !s.excluded } : s)))
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
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by domain…"
        />
        <span className="text-[12px] text-muted ml-1">{total} shops</span>
      </div>

      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Category</th>
              <th>Score</th>
              <th>Ship US</th>
              <th>Fraud Level</th>
              <th>Excluded</th>
            </tr>
          </thead>
          <tbody>
            {loading && shops.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted p-6">
                  Loading…
                </td>
              </tr>
            ) : shops.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted p-6">
                  No shops found
                </td>
              </tr>
            ) : (
              shops.map(shop => (
                <tr key={shop.id} style={{ opacity: shop.excluded ? 0.5 : 1 }}>
                  <td>
                    <span className="font-mono text-[12px]">{shop.domain}</span>
                  </td>
                  <td>
                    <CategoryBadge category={shop.category} />
                  </td>
                  <td>
                    <ScoreBadge score={shop.score} />
                  </td>
                  <td>
                    <span className="text-[13px]">{shop.ship_us ? '✓' : '✗'}</span>
                  </td>
                  <td>
                    {shop.fraud_level ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 4,
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
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>
            Showing {shops.length} of {total}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => {
                const np = page - 1
                setPage(np)
                load(np, search)
              }}
            >
              Prev
            </button>
            {Array.from({ length: Math.min(pages, 7) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className="btn btn-ghost btn-sm"
                style={
                  p === page
                    ? { background: 'var(--accent)', color: 'var(--text)', border: 'none' }
                    : undefined
                }
                onClick={() => {
                  setPage(p)
                  load(p, search)
                }}
              >
                {p}
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              disabled={page >= pages}
              onClick={() => {
                const np = page + 1
                setPage(np)
                load(np, search)
              }}
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
