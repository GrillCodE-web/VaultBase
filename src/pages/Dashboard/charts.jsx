import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { formatCurrency } from '../../utils/formatting'
import { CHART_COLORS } from '../../constants/colors'

// ─── Period config ───────────────────────────────────────────

export const PERIODS = [
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

export function RevenueChart({ data }) {
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

export function getHeatmapClass(rate) {
  if (rate < 0) return 'heatmap-cell-no-data'
  if (rate < 20) return 'heatmap-cell-low'
  if (rate < 50) return 'heatmap-cell-medium'
  return 'heatmap-cell-high'
}

export function Heatmap({ data, onCellClick }) {
  const { t } = useLang()
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted text-[12px] h-[80px]">
        {t('dash_not_enough_data')}
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
            {/* Угловая ячейка пустая: подпись «Bank ↓ / Shop →» при узкой
                колонке банков (max-width:0) переползала на соседний заголовок
                и слипалась с ним. Оси и так понятны из заголовка панели. */}
            <th className="text-left text-muted font-medium text-[10px] pb-1 pr-2" />
            {shops.map(s => (
              <th
                key={s}
                className="text-text-2 text-[10px] font-medium overflow-hidden text-ellipsis whitespace-nowrap pb-1 px-1"
                title={s}
              >
                {s.length > 14 ? s.slice(0, 14) + '...' : s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {banks.map(bank => (
            <tr key={bank}>
              <td className="bank-label" title={bank}>
                {bank.length > 18 ? bank.slice(0, 18) + '...' : bank}
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
