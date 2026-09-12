import { useState } from 'react'
import { useLang } from '../../hooks/useLang'
import { formatCurrency, formatNumber } from '../../utils/formatting'
import { getDeliveryRateColor, getExpiryColor } from '../../constants/colors'
import { dashboardApi } from '../../api/dashboard'
import { handleError } from '../../utils/errorHandler'

// ─── Analytics tables ─────────────────────────────────────────

export function RateBadge({ rate }) {
  return (
    <span className="font-semibold" style={{ color: getDeliveryRateColor(rate) }}>
      {rate.toFixed(1)}%
    </span>
  )
}

export function BanksTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-11 text-muted py-2">{t('msg_no_data')}</p>
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

export function CountryHeatBar({ data }) {
  if (!data?.length) return null
  const maxCards = Math.max(...data.map(c => c.total_cards), 1)
  const sorted = [...data].sort((a, b) => b.total_cards - a.total_cards).slice(0, 15)
  return (
    <div className="flex flex-col gap-1 mb-3">
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
          <div key={c.country} className="flex items-center gap-2">
            <span className="w-9 text-10 text-right shrink-0 text-text-2">{c.country || '—'}</span>
            <div className="flex-1 h-4 bg-separator rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm transition-[width] duration-300 min-w-[2px]"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
            <span className="w-8 text-10 text-right shrink-0 font-semibold">{c.total_cards}</span>
            <span className="w-9 text-9 text-right shrink-0 text-text-2">
              {rate >= 0 ? `${rate}%` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function CountryTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-11 text-muted py-2">{t('msg_no_data')}</p>
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

export function SourceTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-11 text-muted py-2">{t('msg_no_data')}</p>
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
export function DomainTable({ data }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-11 text-muted py-2">{t('msg_no_data')}</p>
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

export function BinPerfTable({ data }) {
  const { t } = useLang()
  // c5j: раскрытие строки — разрез «успех BIN × магазин» (get_bin_shop_performance)
  const [expanded, setExpanded] = useState(null)
  const [breakdowns, setBreakdowns] = useState({})

  const toggle = bin => {
    if (expanded === bin) {
      setExpanded(null)
      return
    }
    setExpanded(bin)
    if (!breakdowns[bin]) {
      dashboardApi
        .getBinShopPerformance(bin)
        .then(rows => setBreakdowns(prev => ({ ...prev, [bin]: rows })))
        .catch(e => handleError(e, 'BinPerfTable'))
    }
  }

  if (!data?.length)
    return <p className="text-11 text-muted py-2">{t('dash_not_enough_data_yet')}</p>
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
            <BinPerfRow
              key={b.bin}
              b={b}
              t={t}
              expanded={expanded === b.bin}
              breakdown={breakdowns[b.bin]}
              onToggle={toggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BinPerfRow({ b, t, expanded, breakdown, onToggle }) {
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="mono text-12 text-accent"
            onClick={() => onToggle(b.bin)}
            aria-expanded={expanded}
            aria-label={t('binperf_expand')}
            title={t('binperf_expand')}
          >
            {expanded ? '▾' : '▸'} {b.bin}
          </button>
        </td>
        <td className="text-text-2">{b.bank_name || '—'}</td>
        <td className="text-right">{b.total_orders}</td>
        <td className="text-right text-green-t">{b.delivered}</td>
        <td className="text-right text-red-t">{b.declined}</td>
        <td className="text-right mono">${b.total_revenue.toFixed(2)}</td>
        <td className="text-right">
          <span className="font-semibold" style={{ color: getDeliveryRateColor(b.delivery_rate) }}>
            {b.delivery_rate.toFixed(1)}%
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="px-2">
            {!breakdown ? (
              <p className="text-11 text-muted py-1">{t('msg_loading')}</p>
            ) : breakdown.length === 0 ? (
              <p className="text-11 text-muted py-1">{t('binperf_no_shops')}</p>
            ) : (
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th>{t('binperf_col_shop')}</th>
                    <th className="text-right">{t('binperf_col_orders')}</th>
                    <th className="text-right">{t('binperf_col_ok')}</th>
                    <th className="text-right">{t('binperf_col_fail')}</th>
                    <th className="text-right">{t('binperf_col_rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map(s => (
                    <tr key={s.shop_name}>
                      <td className="text-text-2">{s.shop_name}</td>
                      <td className="text-right">{s.total}</td>
                      <td className="text-right text-green-t">{s.ok}</td>
                      <td className="text-right text-red-t">{s.fail}</td>
                      <td className="text-right">
                        <span
                          className="font-semibold"
                          style={{ color: getDeliveryRateColor(s.success_rate) }}
                        >
                          {s.success_rate.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export function ExpiringTable({ data, onNavigate }) {
  const { t } = useLang()
  if (!data?.length) return <p className="text-11 text-muted py-2">{t('dashboard_no_expiring')}</p>
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
