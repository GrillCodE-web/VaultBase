import { useLang } from '../../hooks/useLang'
import { formatCurrency, formatNumber } from '../../utils/formatting'
import { getDeliveryRateColor, getExpiryColor } from '../../constants/colors'

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

export function CountryHeatBar({ data }) {
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

export function CountryTable({ data }) {
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

export function SourceTable({ data }) {
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
export function DomainTable({ data }) {
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
export function OperatorsTable({ data, onNavigate }) {
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

export function BinPerfTable({ data }) {
  const { t } = useLang()
  if (!data?.length)
    return <p className="text-[11px] text-muted py-2">{t('dash_not_enough_data_yet')}</p>
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

export function ExpiringTable({ data, onNavigate }) {
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
