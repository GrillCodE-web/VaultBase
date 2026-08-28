import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { handleError } from '../utils/errorHandler.js'
import { invoke } from '@tauri-apps/api/core'
import {
  RefreshCw,
  RotateCcw,
  Download,
  FileDown,
  CreditCard,
  ShoppingBag,
  DollarSign,
  Users,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { useSmartToast } from '../hooks/useSmartToast'
import { formatCurrency, formatNumber } from '../utils/formatting'
import { HEATMAP_COLORS } from '../constants/colors'

// Import from Dashboard submodule
import { PERIODS } from './Dashboard/periods.js'

// PERF-014: recharts (~400 КБ) не нужен до первого показа дашборда —
// charts.jsx подгружается лениво; PERIODS живёт в periods.js без recharts.
const RevenueChart = lazy(() =>
  import('./Dashboard/charts').then(m => ({ default: m.RevenueChart }))
)
const Heatmap = lazy(() => import('./Dashboard/charts').then(m => ({ default: m.Heatmap })))
import {
  BanksTable,
  CountryTable,
  SourceTable,
  DomainTable,
  BinPerfTable,
  ExpiringTable,
} from './Dashboard/tables'
import { CollapsePanel, PremiumStatCard, SmartAlertCard } from './Dashboard/cards'
import { WidgetGrid } from './Dashboard/WidgetGrid.jsx'
import { UpanelApiStatusWidget } from './Dashboard/upanelApiStatus'

// Стили дашборд-карточек — в общем styles/pages.css (через index.css).

// ─── Main Dashboard ──────────────────────────────────────────

export default function DashboardRedesigned({ onNavigate }) {
  const { t } = useLang()
  const { success: toastSuccess, error: toastError, info: toastInfo } = useSmartToast()

  const [period, setPeriod] = useState('7d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [stats, setStats] = useState(null)
  const [chart, setChart] = useState([])
  const [heatmap, setHeatmap] = useState([])
  const [banks, setBanks] = useState([])
  const [countries, setCountries] = useState([])
  const [sources, setSources] = useState([])
  const [domains, setDomains] = useState([]) // P2-DOMAIN: Domain statistics
  const [expiring, setExpiring] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [binPerf, setBinPerf] = useState([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [collapsed, setCollapsed] = useState({
    banks: false,
    countries: true,
    sources: true,
    expiring: false,
    bin_perf: true,
  })

  const lastStatsRef = useRef(null)

  const toggleSection = useCallback(id => {
    setCollapsed(prev => {
      const next = { ...prev, [id]: !prev[id] }
      invoke('set_config', { key: `dash_collapsed_${id}`, value: String(next[id]) }).catch(e => {
        console.error('[Dashboard] Failed to save collapsed state:', e)
      })
      return next
    })
  }, [])

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      const p = { period, from: from || undefined, to: to || undefined }
      try {
        const [s, c, hm, b, co, so, dm, ex, ro, bp] = await Promise.allSettled([
          invoke('get_dashboard_stats', p),
          invoke('get_revenue_chart', p),
          invoke('get_heatmap_data', p),
          invoke('get_top_banks', p),
          invoke('get_by_country', p),
          invoke('get_by_source', p),
          invoke('get_by_domain', p), // P2-DOMAIN: Load domain statistics
          invoke('get_expiring_cards_dashboard', { days: 30 }),
          invoke('get_orders', { filter: {}, page: 1, perPage: 10 }),
          invoke('get_bin_performance'),
        ])

        if (s.status === 'fulfilled') {
          // Smart notification for significant changes
          if (lastStatsRef.current && s.value) {
            const prevRevenue = lastStatsRef.current.revenue || 0
            const currRevenue = s.value.revenue || 0
            const diff = Math.abs(currRevenue - prevRevenue)
            if (diff > 100) {
              toastInfo(`Revenue changed by $${diff.toFixed(2)}`, {
                groupKey: 'revenue_change',
              })
            }
          }
          setStats(s.value)
          lastStatsRef.current = s.value
        }
        if (c.status === 'fulfilled') setChart(c.value)
        if (hm.status === 'fulfilled') setHeatmap(hm.value)
        if (b.status === 'fulfilled') setBanks(b.value)
        if (co.status === 'fulfilled') setCountries(co.value)
        if (so.status === 'fulfilled') setSources(so.value)
        if (dm.status === 'fulfilled') setDomains(dm.value) // P2-DOMAIN: Set domain stats
        if (ex.status === 'fulfilled') setExpiring(ex.value)
        if (ro.status === 'fulfilled') setRecentOrders(ro.value?.items ?? [])
        if (bp.status === 'fulfilled') setBinPerf(bp.value)
        ;[s, c, hm, b, co, so, dm, ex, ro, bp].forEach((r, i) => {
          if (r.status === 'rejected') console.warn('Dashboard load error [' + i + ']:', r.reason)
        })
      } catch (e) {
        handleError(e)
        // Dashboard load failed
      }
      setLoading(false)
      setRefreshing(false)
    },
    [period, from, to, toastInfo]
  )

  // Initial load + period change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- установка loading-флага перед асинхронной загрузкой
    setLoading(true)
    loadAll()
  }, [loadAll])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) loadAll(true)
    }, 30_000)
    return () => clearInterval(id)
  }, [loadAll])

  const handleExport = async () => {
    setExporting(true)
    try {
      const csv = await invoke('export_dashboard_csv', {
        period,
        from: from || undefined,
        to: to || undefined,
      })
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dashboard_${period}_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toastSuccess('Dashboard exported successfully', {
        action: { label: 'Open', onClick: () => {} },
      })
    } catch (e) {
      toastError(`Export failed: ${e}`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportPDF = () => {
    window.print()
    toastSuccess('Opening print dialog...')
  }

  const handleHeatmapClick = (bank, shop) => {
    onNavigate && onNavigate('orders', { bank, shop })
  }

  const handleAlertAction = action => {
    if (onNavigate && action) {
      onNavigate(action)
    }
  }

  if (loading) {
    return (
      <div className="content">
        <div className="panel">
          <table className="tbl">
            <tbody>
              <SkeletonRows count={8} cols={6} />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const s = stats || {}
  const isEmpty = !stats
  // Бэкенд (DashboardStats) отдаёт total_cc/free_cc/dead_cc/net_profit/delivered —
  // нормализуем один раз, чтобы карточки не показывали нули на живых данных.
  const totalCards = s.total_cards ?? s.total_cc ?? 0
  const freeCards = s.free_cards ?? s.free_cc ?? 0
  const deliveredOrders = s.delivered_orders ?? s.delivered ?? 0
  const profit = s.profit ?? s.net_profit ?? 0
  const hasNoActivity =
    !stats || (totalCards === 0 && s.total_orders === 0 && (s.total_profiles ?? 0) === 0)

  // Calculate trends
  const revenueTrend = s.revenue && profit ? (profit / s.revenue) * 100 : 0
  const orderTrend =
    s.total_orders && deliveredOrders ? (deliveredOrders / s.total_orders) * 100 : 0

  return (
    <div className="content">
      <style>{`
        @media print {
          .sidebar, .ph-actions, .period-bar, .filters { display: none !important; }
          .dashboard-grid, .content { width: 100% !important; max-width: 100% !important; }
          .panel { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* ── Page Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">
            <span className="live-dot" aria-hidden="true" />
            Dashboard
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              Dashboard stats auto-refresh every 30 seconds
            </span>
          </div>
          <div className="ph-sub">{t('dashboard_auto_refresh')}</div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-b"
            onClick={() => onNavigate?.('cards', { openImport: true })}
            title="Quick import cards (Alt+2 then i)"
          >
            + {t('quick_import_cc')}
          </button>
          <button className="btn btn-g" onClick={() => onNavigate?.('profiles')}>
            + {t('quick_create_profile')}
          </button>
          <button className="btn btn-b" onClick={() => onNavigate?.('orders')}>
            + {t('quick_new_order')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => loadAll(true)}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />{' '}
            {refreshing ? '...' : t('btn_refresh')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}>
            <Download size={13} /> {exporting ? t('exporting') : t('export_csv')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
            <FileDown size={13} /> Export PDF
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.dispatchEvent(new window.CustomEvent('vb:reset-dash-layout'))}
            title={t('dashboard_reset_layout')}
          >
            <RotateCcw size={13} /> {t('dashboard_reset_layout')}
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="panel text-center border border-dashed py-12 px-6">
          <div className="empty-state-icon-box">
            <Download size={20} className="text-muted" />
          </div>
          <p className="text-[13px] font-semibold text-text mb-1.5">{t('msg_no_data')}</p>
          <p className="text-[11px] text-muted mb-4">{t('dashboard_empty_hint')}</p>
          <button
            className="btn btn-b"
            onClick={() => onNavigate?.('cards', { openImport: true })}
            title="Quick import cards (Alt+2 then i)"
          >
            + {t('quick_import_cc')}
          </button>
        </div>
      )}

      {/* ── Period selector ── */}
      <div className="period-bar">
        {PERIODS.map(p => (
          <button
            key={p.key}
            className={`pb${period === p.key ? ' active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {t(p.labelKey)}
          </button>
        ))}
        {period === 'custom' && (
          <>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="inline-select-sm"
            />
            <span className="text-[11px] text-muted">→</span>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="inline-select-sm"
            />
          </>
        )}
      </div>

      {/* ── uPanel APIs: Online/Offline (FEAT-018) ── */}
      <UpanelApiStatusWidget />

      {/* ── Smart Alerts ── */}
      {s.alerts && s.alerts.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {s.alerts.map((a, i) => (
            <SmartAlertCard key={i} alert={a} onAction={handleAlertAction} />
          ))}
        </div>
      )}

      {/* ── UX-014: кастомизируемая сетка виджетов (react-grid-layout) ── */}
      <WidgetGrid
        items={[
          !isEmpty && {
            id: 'stats_base',
            defaultH: 4,
            node: (
              <>
                <div className="slabel mt-2">{t('dashboard_base_total')}</div>
                <div className="smart-cards-grid">
                  <PremiumStatCard
                    icon={CreditCard}
                    label={t('total_cc')}
                    value={formatNumber(totalCards)}
                    subtext={`${formatNumber(freeCards)} available`}
                    trend="up"
                    variant="cards"
                    // Только кольцо прогресса: statusBadge «27%» занимал тот же
                    // верхне-правый угол и слипался с подписью в центре кольца.
                    progress={Math.round((freeCards / (totalCards || 1)) * 100)}
                    onClick={() => onNavigate?.('cards')}
                  />

                  <PremiumStatCard
                    icon={ShoppingBag}
                    label={t('nav_orders')}
                    value={formatNumber(s.total_orders ?? 0)}
                    subtext={`${formatNumber(deliveredOrders)} delivered`}
                    trend={orderTrend > 50 ? 'up' : 'down'}
                    trendValue={orderTrend}
                    variant="orders"
                    statusBadge={{
                      type: 'in-use',
                      label: `${orderTrend.toFixed(0)}% rate`,
                    }}
                    onClick={() => onNavigate?.('orders')}
                  />

                  <PremiumStatCard
                    icon={Users}
                    label={t('nav_profiles')}
                    value={formatNumber(s.total_profiles ?? 0)}
                    subtext={`${formatNumber(s.no_drop_profiles ?? 0)} without drops`}
                    trend="neutral"
                    variant="profit"
                    onClick={() => onNavigate?.('profiles')}
                  />

                  <PremiumStatCard
                    icon={DollarSign}
                    label={t('chart_revenue')}
                    value={formatCurrency(s.revenue ?? 0)}
                    subtext={`${formatCurrency(profit)} profit`}
                    trend={revenueTrend > 20 ? 'up' : revenueTrend < 10 ? 'down' : 'neutral'}
                    trendValue={revenueTrend}
                    variant="revenue"
                    statusBadge={{
                      type: 'free',
                      label: `${revenueTrend.toFixed(0)}% margin`,
                    }}
                    onClick={() => onNavigate?.('orders')}
                  />
                </div>
              </>
            ),
          },
          !isEmpty &&
            !hasNoActivity && {
              id: 'stats_period',
              defaultH: 3,
              node: (
                <>
                  <div className="slabel">{t('dashboard_activity_period')}</div>
                  <div className="cards-grid">
                    <div className="sc cgr cursor-pointer" onClick={() => onNavigate?.('orders')}>
                      <div className="sc-lbl">{t('status_pending')}</div>
                      <div className="sc-val">
                        {formatNumber(s.pending_orders ?? s.pending ?? 0)}
                      </div>
                      <div className="sc-sub">{t('dashboard_awaiting')}</div>
                    </div>
                    <div className="sc cb2">
                      <div className="sc-lbl">{t('status_shipped')}</div>
                      <div className="sc-val">
                        {formatNumber(s.shipped_orders ?? s.shipped ?? 0)}
                      </div>
                    </div>
                    <div className="sc cg">
                      <div className="sc-lbl">{t('status_delivered')}</div>
                      <div className="sc-val">
                        {formatNumber(s.delivered_orders ?? s.delivered ?? 0)}
                      </div>
                    </div>
                    <div className="sc cr">
                      <div className="sc-lbl">{t('status_declined')}</div>
                      <div className="sc-val">
                        {formatNumber(s.declined_orders ?? s.declined ?? 0)}
                      </div>
                    </div>
                    <div className="sc cb2 wide">
                      <div className="sc-lbl">{t('net_profit')}</div>
                      <div className="sc-val">{formatCurrency(s.profit ?? s.net_profit ?? 0)}</div>
                    </div>
                  </div>
                </>
              ),
            },
          {
            id: 'charts',
            defaultH: 9,
            node: (
              <div className="grid2">
                {/* Revenue chart */}
                <div className="panel">
                  <div className="ptitle">
                    {t('chart_title')}
                    <div className="flex text-[11px] gap-4">
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block rounded-sm w-3 h-0.5"
                          style={{ backgroundColor: 'var(--blue-t)' }}
                        />
                        <span className="text-muted">{t('chart_revenue')}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block rounded-sm w-3 h-0.5"
                          style={{ backgroundColor: 'var(--green-t)' }}
                        />
                        <span className="text-muted">{t('chart_profit')}</span>
                      </span>
                    </div>
                  </div>
                  <Suspense fallback={<div className="h-[260px]" />}>
                    <RevenueChart data={chart} />
                  </Suspense>
                </div>

                {/* Heatmap */}
                <div className="panel">
                  <div className="ptitle">
                    {t('heatmap_title')}
                    <div className="flex text-[10px] gap-2">
                      {[
                        { color: HEATMAP_COLORS.high, label: '≥50%', colorVar: '--green-t' },
                        { color: HEATMAP_COLORS.medium, label: '20–50%', colorVar: '--yellow-t' },
                        { color: HEATMAP_COLORS.low, label: '<20%', colorVar: '--red-t' },
                        { color: HEATMAP_COLORS.noData, label: '<3 orders', colorVar: '--border' },
                      ].map(({ label, colorVar }) => (
                        <span key={label} className="flex items-center gap-1">
                          <span
                            className="inline-block rounded-sm w-2.5 h-2.5"
                            style={{ backgroundColor: `var(${colorVar})` }}
                          />
                          <span className="text-muted">{label}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <Suspense fallback={<div className="h-[120px]" />}>
                    <Heatmap data={heatmap} onCellClick={handleHeatmapClick} />
                  </Suspense>
                </div>
              </div>
            ),
          },
          recentOrders.length > 0 && {
            id: 'recent_orders',
            defaultH: 6,
            node: (
              <div className="panel">
                <div className="ptitle">
                  {t('dashboard_recent_orders')}
                  <button onClick={() => onNavigate?.('orders')} className="btn btn-ghost btn-sm">
                    {t('dashboard_view_all')} →
                  </button>
                </div>
                <div>
                  {recentOrders.map(o => (
                    <div
                      key={o.id}
                      className="flex items-center cursor-pointer border-b py-1.5 gap-2"
                      onClick={() => onNavigate?.('orders')}
                    >
                      <div className="flex-1">
                        <div className="text-[12px] flex items-center gap-1.5">
                          {o.order_number} <span className={`st st-${o.status}`}>{o.status}</span>
                        </div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {o.shop_name} · {o.created_at?.slice(0, 10)}
                        </div>
                      </div>
                      <div className="mono text-[11px] text-blue-t">
                        ${o.amount ?? o.total_amount ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            id: 'banks',
            defaultH: 7,
            node: (
              <CollapsePanel
                title={t('section_top_banks')}
                id="banks"
                collapsed={collapsed.banks}
                onToggle={toggleSection}
              >
                <BanksTable data={banks} />
              </CollapsePanel>
            ),
          },
          {
            id: 'countries',
            defaultH: 7,
            node: (
              <CollapsePanel
                title={t('section_by_country')}
                id="countries"
                collapsed={collapsed.countries}
                onToggle={toggleSection}
              >
                <CountryTable data={countries} />
              </CollapsePanel>
            ),
          },
          {
            id: 'sources',
            defaultH: 7,
            node: (
              <CollapsePanel
                title={t('section_by_source')}
                id="sources"
                collapsed={collapsed.sources}
                onToggle={toggleSection}
              >
                <SourceTable data={sources} />
              </CollapsePanel>
            ),
          },
          // P2-DOMAIN: Domain Statistics Section
          {
            id: 'domains',
            defaultH: 7,
            node: (
              <CollapsePanel
                title="Domains"
                id="domains"
                collapsed={collapsed.domains ?? true}
                onToggle={toggleSection}
              >
                <DomainTable data={domains} />
              </CollapsePanel>
            ),
          },
          {
            id: 'expiring',
            defaultH: 7,
            node: (
              <CollapsePanel
                title={t('section_expiring')}
                id="expiring"
                collapsed={collapsed.expiring}
                onToggle={toggleSection}
              >
                <ExpiringTable data={expiring} onNavigate={onNavigate} />
              </CollapsePanel>
            ),
          },
          {
            id: 'bin_perf',
            defaultH: 7,
            node: (
              <CollapsePanel
                title="BIN Performance"
                id="bin_perf"
                collapsed={collapsed.bin_perf}
                onToggle={toggleSection}
              >
                <BinPerfTable data={binPerf} />
              </CollapsePanel>
            ),
          },
        ].filter(Boolean)}
      />
    </div>
  )
}
