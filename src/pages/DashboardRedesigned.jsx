import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Download,
  FileDown,
  TrendingUp,
  TrendingDown,
  CreditCard,
  ShoppingBag,
  DollarSign,
  Users,
  XCircle,
  Minus,
  Info,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { useSmartToast } from '../hooks/useSmartToast'
import { formatCurrency, formatNumber } from '../utils/formatting'
import {
  CHART_COLORS,
  HEATMAP_COLORS,
  getDeliveryRateColor,
  getExpiryColor,
} from '../constants/colors'
import '../styles/pages/dashboard-cards-redesign.css'

// ─── Period config ───────────────────────────────────────────

const PERIODS = [
  { key: 'today', labelKey: 'period_today' },
  { key: '7d', labelKey: 'period_7d' },
  { key: '30d', labelKey: 'period_30d' },
  { key: 'all', labelKey: 'period_all' },
  { key: 'custom', labelKey: 'period_custom' },
]

// ─── Revenue Chart tooltip ───────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border-hi rounded-md px-3 py-2 text-[11px]">
      <div className="font-semibold text-text mb-1">{label}</div>
      <div className="text-blue-t">Revenue: {formatCurrency(payload[0]?.value ?? 0)}</div>
      <div className="text-green-t">Profit: {formatCurrency(payload[1]?.value ?? 0)}</div>
    </div>
  )
}

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted gap-2 h-[240px]">
        <AlertTriangle size={20} className="text-border-hi opacity-50" />
        <span className="text-[12px]">No orders in this period</span>
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.revenue} stopOpacity={0.25} />
            <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.profit} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.profit} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted)', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `$${v}`}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={CHART_COLORS.revenue}
          strokeWidth={2}
          fill="url(#gradRevenue)"
          dot={false}
          activeDot={{ r: 4, fill: CHART_COLORS.revenue }}
        />
        <Area
          type="monotone"
          dataKey="profit"
          stroke={CHART_COLORS.profit}
          strokeWidth={2}
          fill="url(#gradProfit)"
          dot={false}
          activeDot={{ r: 4, fill: CHART_COLORS.profit }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Heatmap ─────────────────────────────────────────────────

function getHeatmapClass(rate) {
  if (rate < 0) return 'heatmap-cell-no-data'
  if (rate < 20) return 'heatmap-cell-low'
  if (rate < 50) return 'heatmap-cell-medium'
  return 'heatmap-cell-high'
}

function Heatmap({ data, onCellClick }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted text-[12px] h-[80px]">
        Not enough data (need ≥3 orders per combination)
      </div>
    )
  }

  const banks = [...new Set(data.map(d => d.bank))].slice(0, 8)
  const shops = [...new Set(data.map(d => d.shop))].slice(0, 8)
  const cellMap = {}
  data.forEach(d => {
    cellMap[`${d.bank}|${d.shop}`] = d
  })

  return (
    <div className="overflow-x-auto">
      <table className="heatmap-table">
        <thead>
          <tr>
            <th className="text-left text-muted font-medium text-[10px] pb-1 pr-2">
              Bank ↓ / Shop →
            </th>
            {shops.map(s => (
              <th
                key={s}
                className="text-text-2 text-[10px] font-medium overflow-hidden text-ellipsis whitespace-nowrap pb-1 px-1"
                title={s}
              >
                {s.length > 14 ? s.slice(0, 14) + '…' : s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {banks.map(bank => (
            <tr key={bank}>
              <td className="bank-label" title={bank}>
                {bank.length > 18 ? bank.slice(0, 18) + '…' : bank}
              </td>
              {shops.map(shop => {
                const cell = cellMap[`${bank}|${shop}`]
                const rate = cell ? cell.success_rate : -1
                const label = cell ? `${cell.success_rate.toFixed(0)}%` : '—'
                return (
                  <td
                    key={shop}
                    onClick={() => cell && onCellClick && onCellClick(bank, shop)}
                    className={`heatmap-cell ${getHeatmapClass(rate)}`}
                    title={
                      cell
                        ? `${bank} × ${shop}: ${cell.total} orders, ${cell.success_rate.toFixed(1)}% success`
                        : undefined
                    }
                  >
                    {label}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Analytics tables ─────────────────────────────────────────

function RateBadge({ rate }) {
  return (
    <span className="font-semibold" style={{ color: getDeliveryRateColor(rate) }}>
      {rate.toFixed(1)}%
    </span>
  )
}

function BanksTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t('msg_no_data')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[
              t('bank'),
              t('cards'),
              t('free'),
              t('dead'),
              t('col_orders_count'),
              t('shipped'),
              t('declined'),
              t('revenue'),
              t('success_rate'),
            ].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(b => (
            <tr key={b.bank_name}>
              <td>{b.bank_name || t('msg_no_data')}</td>
              <td className="text-right">{formatNumber(b.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(b.free_cards)}</td>
              <td className="text-right text-red-t">{formatNumber(b.dead_cards)}</td>
              <td className="text-right">{formatNumber(b.total_orders)}</td>
              <td className="text-right">{formatNumber(b.shipped)}</td>
              <td className="text-right">{formatNumber(b.declined)}</td>
              <td className="text-right">{formatCurrency(b.revenue)}</td>
              <td className="text-right">
                <RateBadge rate={b.success_rate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CountryHeatBar({ data }) {
  if (!data?.length) return null
  const maxCards = Math.max(...data.map(c => c.total_cards), 1)
  const sorted = [...data].sort((a, b) => b.total_cards - a.total_cards).slice(0, 15)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
      {sorted.map(c => {
        const pct = (c.total_cards / maxCards) * 100
        const rate = c.success_rate ?? 0
        const barColor =
          rate >= 50
            ? 'var(--color-heatmap-high)'
            : rate >= 20
              ? 'var(--color-heatmap-medium)'
              : rate > 0
                ? 'var(--color-heatmap-low)'
                : 'var(--color-heatmap-no-data)'
        return (
          <div key={c.country} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 36,
                fontSize: 10,
                textAlign: 'right',
                flexShrink: 0,
                color: 'var(--text-2)',
              }}
            >
              {c.country || '—'}
            </span>
            <div
              style={{
                flex: 1,
                height: 16,
                background: 'var(--separator)',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: barColor,
                  borderRadius: 3,
                  transition: 'width 0.3s',
                  minWidth: 2,
                }}
              />
            </div>
            <span
              style={{
                width: 32,
                fontSize: 10,
                textAlign: 'right',
                flexShrink: 0,
                fontWeight: 600,
              }}
            >
              {c.total_cards}
            </span>
            <span
              style={{
                width: 36,
                fontSize: 9,
                textAlign: 'right',
                flexShrink: 0,
                color: 'var(--text-2)',
              }}
            >
              {rate >= 0 ? `${rate}%` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function CountryTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t('msg_no_data')}</p>
  return (
    <div>
      <CountryHeatBar data={data} />
      <div className="overflow-x-auto">
        <table className="tbl w-full">
          <thead>
            <tr>
              {[
                t('cc_col_country'),
                t('nav_cards'),
                t('status_free'),
                t('nav_orders'),
                t('chart_revenue'),
                t('col_success_rate'),
              ].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(c => (
              <tr key={c.country}>
                <td>{c.country}</td>
                <td className="text-right">{formatNumber(c.total_cards)}</td>
                <td className="text-right text-green-t">{formatNumber(c.free_cards)}</td>
                <td className="text-right">{formatNumber(c.total_orders)}</td>
                <td className="text-right">{formatCurrency(c.revenue)}</td>
                <td className="text-right">
                  <RateBadge rate={c.success_rate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SourceTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t('msg_no_data')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[
              t('cc_col_source'),
              t('nav_cards'),
              t('status_free'),
              t('status_dead'),
              t('nav_orders'),
              t('chart_revenue'),
              t('col_success_rate'),
            ].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(s => (
            <tr key={s.source}>
              <td>{s.source || '—'}</td>
              <td className="text-right">{formatNumber(s.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(s.free_cards)}</td>
              <td className="text-right text-red-t">{formatNumber(s.dead_cards)}</td>
              <td className="text-right">{formatNumber(s.total_orders)}</td>
              <td className="text-right">{formatCurrency(s.revenue)}</td>
              <td className="text-right">
                <RateBadge rate={s.success_rate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// P2-DOMAIN: Domain Statistics Table
function DomainTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t('msg_no_data')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[
              'Domain',
              t('nav_cards'),
              t('status_free'),
              t('status_dead'),
              'Quarantine',
              t('nav_orders'),
              t('chart_revenue'),
              t('col_success_rate'),
            ].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.domain}>
              <td>
                <span className="filter-link-badge domain-badge">{d.domain}</span>
              </td>
              <td className="text-right">{formatNumber(d.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(d.free_cards)}</td>
              <td className="text-right text-red-t">{formatNumber(d.dead_cards)}</td>
              <td className="text-right">
                {d.quarantined_cards > 0 ? (
                  <span className="quarantine-badge">⏳ {d.quarantined_cards}</span>
                ) : (
                  '—'
                )}
              </td>
              <td className="text-right">{formatNumber(d.total_orders)}</td>
              <td className="text-right">{formatCurrency(d.revenue)}</td>
              <td className="text-right">
                <RateBadge rate={d.success_rate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Сводка по операторам на дашборде.
 *
 * Сырые поля UserStats показывают «сколько сделано», но не «насколько хорошо».
 * Здесь считаются производные метрики, которых в модели нет:
 *   • конверсия  = delivered / orders — главный показатель качества работы;
 *   • средний чек = total_spent / orders;
 *   • доля отказов — сигнал проблем с подбором карт или магазинов.
 * Сортировка по доставленным: сверху те, кто реально приносит результат,
 * а не те, кто просто создал больше всех заказов.
 */
function OperatorsTable({ data, onNavigate }) {
  if (!data?.length) return <p className="text-[11px] text-muted py-2">Нет данных по операторам</p>

  const rows = data
    .filter(u => u.is_active)
    .map(u => {
      const delivered = u.orders_delivered || 0
      const declined = u.orders_declined || 0
      // Знаменатель — завершённые заказы: те, что ещё в пути, качество не
      // характеризуют и занижали бы конверсию у активных операторов.
      const finished = delivered + declined
      return {
        ...u,
        conversion: finished > 0 ? (delivered / finished) * 100 : null,
        avgCheck: delivered > 0 ? (u.total_spent || 0) / delivered : 0,
        declineRate: finished > 0 ? (declined / finished) * 100 : null,
      }
    })
    .sort((a, b) => b.orders_delivered - a.orders_delivered)

  const total = rows.reduce(
    (acc, r) => ({
      cards: acc.cards + (r.cards_taken || 0),
      orders: acc.orders + (r.orders_created || 0),
      delivered: acc.delivered + (r.orders_delivered || 0),
      declined: acc.declined + (r.orders_declined || 0),
      spent: acc.spent + (r.total_spent || 0),
    }),
    { cards: 0, orders: 0, delivered: 0, declined: 0, spent: 0 }
  )

  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>Оператор</th>
            <th className="text-right">Карт взято</th>
            <th className="text-right">Заказов</th>
            <th className="text-right">Доставлено</th>
            <th className="text-right">Отказов</th>
            <th className="text-right">Конверсия</th>
            <th className="text-right">Средний чек</th>
            <th className="text-right">Оборот</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(u => (
            <tr
              key={u.user_id}
              onClick={() => onNavigate?.('my_stats')}
              style={{ cursor: onNavigate ? 'pointer' : 'default' }}
            >
              <td>
                <div className="text-text-1">{u.display_name || u.username}</div>
                <div className="text-[10px] text-muted">
                  {u.role === 'admin' ? 'админ' : 'оператор'}
                  {u.active_sessions > 0 && ' · в сети'}
                </div>
              </td>
              <td className="text-right">{u.cards_taken || 0}</td>
              <td className="text-right">{u.orders_created || 0}</td>
              <td className="text-right text-green-t">{u.orders_delivered || 0}</td>
              <td className="text-right text-red-t">{u.orders_declined || 0}</td>
              <td className="text-right">
                {u.conversion === null ? (
                  <span className="text-muted">—</span>
                ) : (
                  <span
                    className="font-semibold"
                    style={{ color: getDeliveryRateColor(u.conversion) }}
                  >
                    {u.conversion.toFixed(1)}%
                  </span>
                )}
              </td>
              <td className="text-right mono">${u.avgCheck.toFixed(2)}</td>
              <td className="text-right mono">${(u.total_spent || 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td className="text-text-2">Итого · {rows.length}</td>
            <td className="text-right">{total.cards}</td>
            <td className="text-right">{total.orders}</td>
            <td className="text-right text-green-t">{total.delivered}</td>
            <td className="text-right text-red-t">{total.declined}</td>
            <td className="text-right">
              {total.delivered + total.declined > 0 ? (
                <span
                  className="font-semibold"
                  style={{
                    color: getDeliveryRateColor(
                      (total.delivered / (total.delivered + total.declined)) * 100
                    ),
                  }}
                >
                  {((total.delivered / (total.delivered + total.declined)) * 100).toFixed(1)}%
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td className="text-right mono">
              ${total.delivered > 0 ? (total.spent / total.delivered).toFixed(2) : '0.00'}
            </td>
            <td className="text-right mono">${total.spent.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function BinPerfTable({ data }) {
  if (!data?.length) return <p className="text-[11px] text-muted py-2">Not enough data yet</p>
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>BIN</th>
            <th>Bank</th>
            <th className="text-right">Orders</th>
            <th className="text-right">Delivered</th>
            <th className="text-right">Declined</th>
            <th className="text-right">Revenue ($)</th>
            <th className="text-right">Delivery Rate %</th>
          </tr>
        </thead>
        <tbody>
          {data.map(b => (
            <tr key={b.bin}>
              <td className="mono text-[12px]">{b.bin}</td>
              <td className="text-text-2">{b.bank_name || '—'}</td>
              <td className="text-right">{b.total_orders}</td>
              <td className="text-right text-green-t">{b.delivered}</td>
              <td className="text-right text-red-t">{b.declined}</td>
              <td className="text-right mono">${b.total_revenue.toFixed(2)}</td>
              <td className="text-right">
                <span
                  className="font-semibold"
                  style={{ color: getDeliveryRateColor(b.delivery_rate) }}
                >
                  {b.delivery_rate.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExpiringTable({ data, onNavigate }) {
  const { t } = useLang()
  if (!data?.length)
    return <p className="text-[11px] text-muted py-2">{t('dashboard_no_expiring')}</p>
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl w-full">
          <thead>
            <tr>
              {[
                t('nav_cards'),
                t('cc_col_holder'),
                t('card_label_expiry'),
                t('col_days_left'),
                t('nav_profiles'),
              ].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(c => (
              <tr
                key={c.id}
                className="cursor-pointer"
                onClick={() => onNavigate && onNavigate('cards')}
              >
                <td className="mono">****-{c.last4}</td>
                <td>{c.holder_name}</td>
                <td>{c.expiry_date}</td>
                <td
                  className="text-right font-semibold"
                  style={{ color: getExpiryColor(c.days_left) }}
                >
                  {c.days_left}d
                </td>
                <td>
                  {c.has_profile ? (
                    <span
                      className="pill-badge accent cursor-pointer"
                      onClick={e => {
                        e.stopPropagation()
                        onNavigate && onNavigate('profiles')
                      }}
                    >
                      Yes
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-right mt-2">
        <button onClick={() => onNavigate && onNavigate('cards')} className="btn btn-ghost btn-sm">
          View all expiring →
        </button>
      </div>
    </div>
  )
}

// ─── Collapsible panel ───────────────────────────────────────

function CollapsePanel({ title, id, collapsed, onToggle, children }) {
  return (
    <div className="panel p-0 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer px-4 py-3"
      >
        <span className="text-[13px] font-semibold text-text-2">{title}</span>
        <ChevronRight
          size={14}
          className={`text-muted shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
        />
      </button>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ─── Premium Stat Card Component ─────────────────────────────

function PremiumStatCard({
  icon: Icon,
  label,
  value,
  subtext,
  trend,
  _trendValue,
  onClick,
  variant = 'default',
  statusBadge,
  progress,
}) {
  const trendIcon =
    trend === 'up' ? (
      <TrendingUp size={12} />
    ) : trend === 'down' ? (
      <TrendingDown size={12} />
    ) : (
      <Minus size={12} />
    )

  const trendClass =
    trend === 'up' ? 'trend-positive' : trend === 'down' ? 'trend-negative' : 'trend-neutral'

  return (
    <div className={`stat-card-premium stat-card-${variant}`} onClick={onClick}>
      {statusBadge && (
        <div className={`card-status-badge ${statusBadge.type}`}>
          {statusBadge.icon && <statusBadge.icon size={10} />}
          {statusBadge.label}
        </div>
      )}

      {progress !== undefined && (
        <div className="progress-ring-container">
          <svg className="progress-ring" width="40" height="40">
            <circle
              className="progress-ring-bg"
              strokeWidth="4"
              stroke="rgba(255,255,255,0.1)"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
            />
            <circle
              className="progress-ring-circle"
              strokeWidth="4"
              stroke="var(--accent)"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
              strokeDasharray={`${2 * Math.PI * 16} ${2 * Math.PI * 16}`}
              strokeDashoffset={2 * Math.PI * 16 * (1 - progress / 100)}
              strokeLinecap="round"
            />
          </svg>
          <div className="progress-ring-value">{progress}%</div>
        </div>
      )}

      <div className="stat-card-content">
        <div className="stat-card-icon">
          <Icon size={22} />
        </div>

        <div className="stat-card-label">{label}</div>

        <div className="stat-card-value">{value}</div>

        {subtext && (
          <div className={`stat-card-sub ${trendClass}`}>
            {trend && <span className="trend-indicator">{trendIcon}</span>}
            {subtext}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Smart Alert Card ────────────────────────────────────────

function SmartAlertCard({ alert, onAction }) {
  const config = {
    error: { icon: XCircle, color: 'error' },
    warning: { icon: AlertTriangle, color: 'warning' },
    info: { icon: Info, color: 'info' },
  }[alert.level] || { icon: Info, color: 'info' }

  const Icon = config.icon

  return (
    <div className={`alert-card ${alert.level}`}>
      <div className="alert-card-icon">
        <Icon size={18} />
      </div>
      <div className="alert-card-content">
        <div className="alert-card-title">{alert.message}</div>
        {alert.description && <div className="alert-card-desc">{alert.description}</div>}
      </div>
      {alert.action && (
        <div className="alert-card-action">
          <button onClick={() => onAction(alert.action)}>{alert.actionLabel || 'View'}</button>
        </div>
      )}
    </div>
  )
}

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
  const [operators, setOperators] = useState([])

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
        const [s, c, hm, b, co, so, dm, ex, ro, bp, ops] = await Promise.allSettled([
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
          // Только для админа: get_users_stats закрыт require_admin().
          // У оператора отказ просто оставит панель пустой (allSettled).
          invoke('get_users_stats'),
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
        if (ops.status === 'fulfilled') setOperators(ops.value)
        ;[s, c, hm, b, co, so, dm, ex, ro, bp].forEach((r, i) => {
          if (r.status === 'rejected') console.warn('Dashboard load error [' + i + ']:', r.reason)
        })
      } catch {
        // Dashboard load failed
      }
      setLoading(false)
      setRefreshing(false)
    },
    [period, from, to, toastInfo]
  )

  // Initial load + period change
  useEffect(() => {
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
  const hasNoActivity =
    !stats || (s.total_cards === 0 && s.total_orders === 0 && (s.total_profiles ?? 0) === 0)

  // Calculate trends
  const revenueTrend = s.revenue && s.profit ? (s.profit / s.revenue) * 100 : 0
  const orderTrend =
    s.total_orders && s.delivered_orders ? (s.delivered_orders / s.total_orders) * 100 : 0

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
            {refreshing ? '…' : t('btn_refresh')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}>
            <Download size={13} /> {exporting ? t('exporting') : t('export_csv')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
            <FileDown size={13} /> Export PDF
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

      {/* ── Smart Alerts ── */}
      {s.alerts && s.alerts.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-4">
          {s.alerts.map((a, i) => (
            <SmartAlertCard key={i} alert={a} onAction={handleAlertAction} />
          ))}
        </div>
      )}

      {/* ── Premium Stat Cards Grid ── */}
      {!isEmpty && (
        <>
          <div className="slabel mt-2">{t('dashboard_base_total')}</div>
          <div className="smart-cards-grid">
            <PremiumStatCard
              icon={CreditCard}
              label={t('total_cc')}
              value={formatNumber(s.total_cards ?? 0)}
              subtext={`${formatNumber(s.free_cards ?? 0)} available`}
              trend="up"
              variant="cards"
              statusBadge={{
                type: 'free',
                label: `${Math.round(((s.free_cards ?? 0) / (s.total_cards ?? 1)) * 100)}%`,
              }}
              progress={Math.round(((s.free_cards ?? 0) / (s.total_cards ?? 1)) * 100)}
              onClick={() => onNavigate?.('cards')}
            />

            <PremiumStatCard
              icon={ShoppingBag}
              label={t('nav_orders')}
              value={formatNumber(s.total_orders ?? 0)}
              subtext={`${formatNumber(s.delivered_orders ?? 0)} delivered`}
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
              subtext={`${formatCurrency(s.profit ?? 0)} profit`}
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

          {/* ── Period stat cards (compact strip) ── */}
          {!hasNoActivity && (
            <>
              <div className="slabel">{t('dashboard_activity_period')}</div>
              <div className="cards-grid">
                <div className="sc cgr cursor-pointer" onClick={() => onNavigate?.('orders')}>
                  <div className="sc-lbl">{t('status_pending')}</div>
                  <div className="sc-val">{formatNumber(s.pending_orders ?? s.pending ?? 0)}</div>
                  <div className="sc-sub">{t('dashboard_awaiting')}</div>
                </div>
                <div className="sc cb2">
                  <div className="sc-lbl">{t('status_shipped')}</div>
                  <div className="sc-val">{formatNumber(s.shipped_orders ?? s.shipped ?? 0)}</div>
                </div>
                <div className="sc cg">
                  <div className="sc-lbl">{t('status_delivered')}</div>
                  <div className="sc-val">
                    {formatNumber(s.delivered_orders ?? s.delivered ?? 0)}
                  </div>
                </div>
                <div className="sc cr">
                  <div className="sc-lbl">{t('status_declined')}</div>
                  <div className="sc-val">{formatNumber(s.declined_orders ?? s.declined ?? 0)}</div>
                </div>
                <div className="sc cb2 wide">
                  <div className="sc-lbl">{t('net_profit')}</div>
                  <div className="sc-val">{formatCurrency(s.profit ?? s.net_profit ?? 0)}</div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Charts row ── */}
      <div className="grid2">
        {/* Revenue chart */}
        <div className="panel">
          <div className="ptitle">
            {t('chart_title')}
            <div className="flex text-[11px] gap-4">
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
          <RevenueChart data={chart} />
        </div>

        {/* Heatmap */}
        <div className="panel">
          <div className="ptitle">
            {t('heatmap_title')}
            <div className="flex text-[10px] gap-2">
              {[
                { color: HEATMAP_COLORS.high, label: '≥50%', colorClass: 'bg-green-t' },
                { color: HEATMAP_COLORS.medium, label: '20–50%', colorClass: 'bg-yellow-t' },
                { color: HEATMAP_COLORS.low, label: '<20%', colorClass: 'bg-red-t' },
                { color: HEATMAP_COLORS.noData, label: '<3 orders', colorClass: 'bg-border' },
              ].map(({ label, colorClass }) => (
                <span key={label} className="flex items-center gap-1">
                  <span className={`inline-block rounded-sm w-2.5 h-2.5 ${colorClass}`} />
                  <span className="text-muted">{label}</span>
                </span>
              ))}
            </div>
          </div>
          <Heatmap data={heatmap} onCellClick={handleHeatmapClick} />
        </div>
      </div>

      {/* ── Recent Orders ── */}
      {recentOrders.length > 0 && (
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
      )}

      {/* ── Collapsible analytics sections ── */}
      <CollapsePanel
        title={t('section_top_banks')}
        id="banks"
        collapsed={collapsed.banks}
        onToggle={toggleSection}
      >
        <BanksTable data={banks} />
      </CollapsePanel>

      <CollapsePanel
        title={t('section_by_country')}
        id="countries"
        collapsed={collapsed.countries}
        onToggle={toggleSection}
      >
        <CountryTable data={countries} />
      </CollapsePanel>

      <CollapsePanel
        title={t('section_by_source')}
        id="sources"
        collapsed={collapsed.sources}
        onToggle={toggleSection}
      >
        <SourceTable data={sources} />
      </CollapsePanel>

      {/* P2-DOMAIN: Domain Statistics Section */}
      <CollapsePanel
        title="Domains"
        id="domains"
        collapsed={collapsed.domains ?? true}
        onToggle={toggleSection}
      >
        <DomainTable data={domains} />
      </CollapsePanel>

      <CollapsePanel
        title={t('section_expiring')}
        id="expiring"
        collapsed={collapsed.expiring}
        onToggle={toggleSection}
      >
        <ExpiringTable data={expiring} onNavigate={onNavigate} />
      </CollapsePanel>

      {/* Панель видна только когда есть данные: get_users_stats закрыт
          require_admin(), у оператора массив останется пустым и панель
          просто не отрисуется — без ошибки на весь дашборд. */}
      {operators.length > 0 && (
        <CollapsePanel
          title="Операторы · кто сколько сделал"
          id="operators"
          collapsed={collapsed.operators ?? false}
          onToggle={toggleSection}
        >
          <OperatorsTable data={operators} onNavigate={onNavigate} />
        </CollapsePanel>
      )}

      <CollapsePanel
        title="BIN Performance"
        id="bin_perf"
        collapsed={collapsed.bin_perf}
        onToggle={toggleSection}
      >
        <BinPerfTable data={binPerf} />
      </CollapsePanel>
    </div>
  )
}
