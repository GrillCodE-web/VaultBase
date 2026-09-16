import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { AnomaliesWidget } from './Dashboard/AnomaliesWidget.jsx'
import { DayStartPanel } from './Dashboard/DayStartPanel.jsx'
import { ActionInbox } from './Dashboard/ActionInbox.jsx'
import { ProfileCards } from './Dashboard/ProfileCards.jsx'
import { ShopIntelWidget } from './Dashboard/ShopIntelWidget.jsx'
import { UpanelApiStatusWidget } from './Dashboard/upanelApiStatus'

// Стили дашборд-карточек — в общем styles/pages.css (через index.css).

// ─── Main Dashboard ──────────────────────────────────────────

export default function DashboardRedesigned({ onNavigate }) {
  const { t } = useLang()
  const { success: toastSuccess, error: toastError, info: toastInfo } = useSmartToast()

  const [period, setPeriod] = useState('7d')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // PERF-010: данные дашборда через TanStack Query — кеш по (period,from,to),
  // дедуп одновременных загрузок, background refetch каждые 30с.
  // Бандл из 10 invoke идёт параллельно, как раньше; rejected-части не роняют
  // остальные виджеты (allSettled сохранён).
  const dashQuery = useQuery({
    queryKey: ['dashboard', period, from || null, to || null],
    queryFn: async () => {
      const p = { period, from: from || undefined, to: to || undefined }
      try {
        const [s, c, hm, b, co, so, dm, ex, ro, bp] = await Promise.allSettled([
          invoke('get_dashboard_stats', p),
          invoke('get_revenue_chart', p),
          invoke('get_heatmap_data', p),
          invoke('get_top_banks', p),
          invoke('get_by_country', p),
          invoke('get_by_source', p),
          invoke('get_by_domain', p), // P2-DOMAIN: Domain statistics
          invoke('get_expiring_cards_dashboard', { days: 30 }),
          invoke('get_orders', { filter: {}, page: 1, perPage: 10 }),
          invoke('get_bin_performance'),
        ])
        ;[s, c, hm, b, co, so, dm, ex, ro, bp].forEach((r, i) => {
          if (r.status === 'rejected') console.warn('Dashboard load error [' + i + ']:', r.reason)
        })
        return {
          stats: s.status === 'fulfilled' ? s.value : null,
          chart: c.status === 'fulfilled' ? c.value : [],
          heatmap: hm.status === 'fulfilled' ? hm.value : [],
          banks: b.status === 'fulfilled' ? b.value : [],
          countries: co.status === 'fulfilled' ? co.value : [],
          sources: so.status === 'fulfilled' ? so.value : [],
          domains: dm.status === 'fulfilled' ? dm.value : [],
          expiring: ex.status === 'fulfilled' ? ex.value : [],
          recentOrders: ro.status === 'fulfilled' ? (ro.value?.items ?? []) : [],
          binPerf: bp.status === 'fulfilled' ? bp.value : [],
        }
      } catch (e) {
        handleError(e)
        throw e
      }
    },
    refetchInterval: 30_000,
  })

  const d = dashQuery.data
  const stats = d?.stats ?? null
  const chart = d?.chart ?? []
  const heatmap = d?.heatmap ?? []
  const banks = d?.banks ?? []
  const countries = d?.countries ?? []
  const sources = d?.sources ?? []
  const domains = d?.domains ?? []
  const expiring = d?.expiring ?? []
  const recentOrders = d?.recentOrders ?? []
  const binPerf = d?.binPerf ?? []

  const loading = dashQuery.isPending
  const refreshing = dashQuery.isFetching && !dashQuery.isPending

  const [exporting, setExporting] = useState(false)

  const [collapsed, setCollapsed] = useState({
    banks: false,
    countries: true,
    sources: true,
    expiring: false,
    bin_perf: true,
    anomalies: false,
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

  const loadAll = useCallback(() => dashQuery.refetch(), [dashQuery])

  // Smart notification: значимое изменение revenue между опросами.
  useEffect(() => {
    const s = dashQuery.data?.stats
    if (!s) return
    if (lastStatsRef.current) {
      const diff = Math.abs((s.revenue || 0) - (lastStatsRef.current.revenue || 0))
      if (diff > 100) {
        toastInfo(`Revenue changed by $${diff.toFixed(2)}`, { groupKey: 'revenue_change' })
      }
    }
    lastStatsRef.current = s
  }, [dashQuery.data, toastInfo])

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
            onClick={() => onNavigate?.('cards', { openSlices: true })}
            title="Fetch card slices from manager"
          >
            + {t('quick_fetch_slices')}
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

      {/* ── q77: стартовый экран дня ── */}
      <DayStartPanel onNavigate={onNavigate} />

      {/* ── SPEC-A (tyw): инбокс действий + карточки профилей ── */}
      <ActionInbox onNavigate={onNavigate} />
      <ProfileCards onNavigate={onNavigate} />

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="panel text-center border border-dashed py-12 px-6">
          <div className="empty-state-icon-box">
            <Download size={20} className="text-muted" />
          </div>
          <p className="text-13 font-semibold text-text mb-1.5">{t('msg_no_data')}</p>
          <p className="text-11 text-muted mb-4">{t('dashboard_empty_hint')}</p>
          <button
            className="btn btn-b"
            onClick={() => onNavigate?.('cards', { openSlices: true })}
            title="Fetch card slices from manager"
          >
            + {t('quick_fetch_slices')}
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
            <span className="text-11 text-muted">→</span>
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
            // REDESIGN-05-4 (порция 4): аномалии — спайки деклайнов шопа/прокси
            id: 'anomalies',
            defaultH: 3,
            node: (
              <CollapsePanel
                title={t('anomalies_title')}
                id="anomalies"
                collapsed={collapsed.anomalies}
                onToggle={toggleSection}
              >
                <AnomaliesWidget onNavigate={onNavigate} />
              </CollapsePanel>
            ),
          },
          {
            // REDESIGN-05-4 (финальный блок): статистика магазинов, «когда бить»,
            // рекомендатель карт — клиентский агрегат из get_orders
            id: 'shopintel',
            defaultH: 9,
            node: (
              <CollapsePanel
                title={t('shopintel_title')}
                id="shopintel"
                collapsed={collapsed.shopintel}
                onToggle={toggleSection}
              >
                <ShopIntelWidget />
              </CollapsePanel>
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
                    <div className="flex text-11 gap-4">
                      <span className="flex items-center gap-1">
                        <span className="inline-block rounded-sm w-3 h-0.5 bg-blue-t" />
                        <span className="text-muted">{t('chart_revenue')}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="inline-block rounded-sm w-3 h-0.5 bg-green-t" />
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
                    <div className="flex text-10 gap-2">
                      {[
                        { label: '≥50%', cls: 'bg-green-t' },
                        { label: '20–50%', cls: 'bg-yellow-t' },
                        { label: '<20%', cls: 'bg-red-t' },
                        { label: '<3 orders', cls: 'bg-border' },
                      ].map(({ label, cls }) => (
                        <span key={label} className="flex items-center gap-1">
                          <span className={`inline-block rounded-sm w-2.5 h-2.5 ${cls}`} />
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
                        <div className="text-12 flex items-center gap-1.5">
                          {o.order_number} <span className={`st st-${o.status}`}>{o.status}</span>
                        </div>
                        <div className="text-10 text-muted mt-0.5">
                          {o.shop_name} · {o.created_at?.slice(0, 10)}
                        </div>
                      </div>
                      <div className="mono text-11 text-blue-t">
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
