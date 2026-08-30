import { useEffect, useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useLang } from '../hooks/useLang.jsx'
import { getAnalytics, getFleetComparison, getFleetBinShop } from '../api/server.js'

const STATUS_COLORS = {
  delivered: '#3ddc97',
  shipped: '#4f8cff',
  pending: '#ffb454',
  declined: '#ff5d73',
  cancelled: '#b48cff',
  refunded: '#8aa0b5',
}

function isoDay(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000)
  return d.toISOString().slice(0, 10)
}

export default function Analytics({ onSync }) {
  const { t } = useLang()
  const [from, setFrom] = useState(isoDay(30))
  const [to, setTo] = useState(isoDay(0))
  const [data, setData] = useState(null)
  const [fleet, setFleet] = useState(null)
  const [heat, setHeat] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const [res, cmp, hm] = await Promise.all([
        getAnalytics(from, to),
        getFleetComparison(from, to),
        getFleetBinShop(from, to),
      ])
      setData(res)
      setFleet(cmp)
      setHeat(hm)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const daysData = useMemo(() => {
    if (!data?.days) return []
    return data.days.map((d) => ({
      date: d.date.slice(5),
      orders: d.orders,
      dead: d.dead,
    }))
  }, [data])

  const statusData = useMemo(() => {
    if (!data?.orders_by_status) return []
    return Object.entries(data.orders_by_status).map(([status, count]) => ({
      status,
      count,
      color: STATUS_COLORS[status] || '#66738f',
    }))
  }, [data])

  const setPeriod = (days) => {
    setFrom(isoDay(days))
    setTo(isoDay(0))
  }

  const heatMatrix = useMemo(() => {
    if (!heat?.cells) return { bins: [], shops: [], map: {} }
    const binTotals = {}
    const shopTotals = {}
    const map = {}
    for (const c of heat.cells) {
      binTotals[c.bin] = (binTotals[c.bin] || 0) + c.orders
      shopTotals[c.shop] = (shopTotals[c.shop] || 0) + c.orders
      map[`${c.bin}|${c.shop}`] = c
    }
    const bins = Object.entries(binTotals).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([b]) => b)
    const shops = Object.entries(shopTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s)
    return { bins, shops, map }
  }, [heat])

  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          {[[1, 'days1'], [7, 'days7'], [14, 'days14'], [30, 'days30'], [90, 'days90']].map(([n, key]) => (
            <button
              key={n}
              className={from === isoDay(n) && to === isoDay(0) ? 'active' : ''}
              onClick={() => setPeriod(n)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="btn" />
        <span className="meta">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="btn" />
        <button className="btn primary" disabled={busy} onClick={load}>{t('apply')}</button>
        <div className="grow" />
        <button className="btn" onClick={onSync}>{t('sync_action')}</button>
      </div>

      {error && <div className="error-box">{t('err_generic')}: {error}</div>}

      {!data ? (
        <div className="empty">{t('loading')}</div>
      ) : data.reports === 0 ? (
        <div className="panel">
          <div className="empty">
            {t('no_reports')}
            <br />
            <button className="btn small" style={{ marginTop: 12 }} onClick={onSync}>{t('sync_action')}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid-cards">
            <div className="stat-card">
              <div className="label">{t('orders_total')}</div>
              <div className="value accent">{data.orders_total}</div>
              <div className="hint">{t('reports_count', { n: data.reports })}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('cards_taken_col')}</div>
              <div className="value">{data.cards_taken}</div>
              <div className="hint">{t('used_col')}: {data.cards_used}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('dead_ratio')}</div>
              <div className={`value ${data.dead_ratio > 25 ? 'red' : data.dead_ratio > 10 ? 'amber' : 'green'}`}>
                {data.dead_ratio}%
              </div>
              <div className="hint">{t('dead_col')}: {data.cards_dead}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('drops_col')}</div>
              <div className="value">{data.drops_taken}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('health_imap')}</div>
              <div className={`value ${data.health.imap_fail > 0 ? 'amber' : 'green'}`}>
                {data.health.imap_ok}/{data.health.imap_ok + data.health.imap_fail}
              </div>
              <div className="hint">fail: {data.health.imap_fail}</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('health_smtp')}</div>
              <div className={`value ${data.health.smtp_fail > 0 ? 'amber' : 'green'}`}>
                {data.health.smtp_ok}/{data.health.smtp_ok + data.health.smtp_fail}
              </div>
              <div className="hint">fail: {data.health.smtp_fail}</div>
            </div>
          </div>

          {data.funnel && (
            <div className="panel">
              <h3>{t('funnel_title')}</h3>
              <div className="funnel-row">
                <div className="funnel-step">
                  <div className="num">{data.funnel.taken}</div>
                  <div className="lbl">{t('funnel_taken')}</div>
                </div>
                <div className="funnel-arrow">→ {data.funnel.used_rate}%</div>
                <div className="funnel-step">
                  <div className="num">{data.funnel.used}</div>
                  <div className="lbl">{t('funnel_used')}</div>
                </div>
                <div className="funnel-arrow">→ {data.funnel.delivered_rate}%</div>
                <div className="funnel-step">
                  <div className="num accent">{data.funnel.delivered}</div>
                  <div className="lbl">{t('funnel_delivered')}</div>
                </div>
                {data.rollup_months > 0 && (
                  <span className="meta" style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 12 }}>
                    {t('rollup_hint', { n: data.rollup_months })}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="split-2">
            <div className="panel">
              <h3>{t('charts_days')}</h3>
              <div className="chart-box">
                <ResponsiveContainer>
                  <AreaChart data={daysData}>
                    <defs>
                      <linearGradient id="gOrders" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#4f8cff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232c44" />
                    <XAxis dataKey="date" stroke="#66738f" fontSize={11} />
                    <YAxis stroke="#66738f" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#161d2e', border: '1px solid #2f3a58', borderRadius: 8 }}
                      labelStyle={{ color: '#e6ebf5' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="orders" stroke="#4f8cff" fill="url(#gOrders)" strokeWidth={2} />
                    <Area type="monotone" dataKey="dead" stroke="#ff5d73" fillOpacity={0.12} fill="#ff5d73" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="panel">
              <h3>{t('charts_orders')}</h3>
              <div className="chart-box">
                <ResponsiveContainer>
                  <BarChart data={statusData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#232c44" />
                    <XAxis dataKey="status" stroke="#66738f" fontSize={11} />
                    <YAxis stroke="#66738f" fontSize={11} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#161d2e', border: '1px solid #2f3a58', borderRadius: 8 }}
                      labelStyle={{ color: '#e6ebf5' }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {statusData.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="split-2">
            <div className="panel">
              <h3>{t('cards_title')}</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('bin_col')}</th>
                    <th>{t('used_col')}</th>
                    <th>{t('dead_col')}</th>
                    <th>{t('dead_ratio')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_bin.map((b) => (
                    <tr key={b.bin}>
                      <td className="mono">{b.bin}</td>
                      <td>{b.used}</td>
                      <td>{b.dead}</td>
                      <td>
                        <span className={`tag ${b.dead_ratio > 25 ? 'red' : b.dead_ratio > 10 ? 'amber' : 'green'}`}>
                          {b.dead_ratio}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <h3>{t('shops_title')}</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('shop_col')}</th>
                    <th>{t('orders_col')}</th>
                    <th>{t('delivered_col')}</th>
                    <th>{t('declined_col')}</th>
                    <th>{t('cancelled_col')}</th>
                    <th>{t('decline_ratio')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_shop.map((s) => (
                    <tr key={s.shop}>
                      <td className="mono">{s.shop}</td>
                      <td>{s.orders}</td>
                      <td>{s.delivered}</td>
                      <td>{s.declined}</td>
                      <td>{s.cancelled}</td>
                      <td>
                        <span className={`tag ${s.decline_ratio > 30 ? 'red' : s.decline_ratio > 15 ? 'amber' : 'green'}`}>
                          {s.decline_ratio}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {fleet && fleet.workers.length > 0 && (
            <div className="panel">
              <h3>{t('fleet_comparison')}</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('col_label')}</th>
                    <th>{t('col_days')}</th>
                    <th>{t('orders_col')}</th>
                    <th>{t('delivery_rate')}</th>
                    <th>{t('decline_ratio')}</th>
                    <th>{t('col_revenue')}</th>
                    <th>{t('cards_taken_col')}</th>
                    <th>{t('dead_ratio')}</th>
                    <th>{t('drops_col')}</th>
                    <th>{t('col_funnel')}</th>
                    <th>{t('col_sla')}</th>
                    <th>{t('app_version')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fleet.workers.map((w) => (
                    <tr key={w.installation_id}>
                      <td>{w.label || w.installation_id.slice(0, 12)}</td>
                      <td>{w.days}</td>
                      <td>{w.orders}</td>
                      <td>
                        <span className={`tag ${w.delivery_rate >= 70 ? 'green' : w.delivery_rate >= 40 ? 'amber' : 'red'}`}>
                          {w.delivery_rate}%
                        </span>
                      </td>
                      <td>
                        <span className={`tag ${w.decline_rate > 30 ? 'red' : w.decline_rate > 15 ? 'amber' : 'green'}`}>
                          {w.decline_rate}%
                        </span>
                      </td>
                      <td>{w.revenue}</td>
                      <td>{w.cards_taken}</td>
                      <td>
                        <span className={`tag ${w.dead_ratio > 25 ? 'red' : w.dead_ratio > 10 ? 'amber' : 'green'}`}>
                          {w.dead_ratio}%
                        </span>
                      </td>
                      <td>{w.drops}</td>
                      <td className="mono">{w.funnel_used_rate}% → {w.funnel_delivered_rate}%</td>
                      <td>{w.avg_hours_to_delivered ?? '—'}</td>
                      <td className="mono">
                        {w.app_version || '—'}
                        {w.version_outdated && (
                          <span className="tag red" style={{ marginLeft: 6 }}>{t('version_outdated')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="split-2">
            <div className="panel">
              <h3>{t('operators_title')}</h3>
              {!fleet || fleet.operators.length === 0 ? (
                <div className="empty">{t('no_data')}</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('operator_col')}</th>
                      <th>{t('orders_col')}</th>
                      <th>{t('delivered_col')}</th>
                      <th>{t('delivery_rate')}</th>
                      <th>{t('decline_ratio')}</th>
                      <th>{t('col_revenue')}</th>
                      <th>{t('cards_taken_col')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fleet.operators.map((o) => (
                      <tr key={o.name}>
                        <td>{o.name}</td>
                        <td>{o.orders}</td>
                        <td>{o.delivered}</td>
                        <td>
                          <span className={`tag ${o.delivery_rate >= 70 ? 'green' : o.delivery_rate >= 40 ? 'amber' : 'red'}`}>
                            {o.delivery_rate}%
                          </span>
                        </td>
                        <td>
                          <span className={`tag ${o.decline_rate > 30 ? 'red' : o.decline_rate > 15 ? 'amber' : 'green'}`}>
                            {o.decline_rate}%
                          </span>
                        </td>
                        <td>{o.revenue}</td>
                        <td>{o.cards_taken}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>{t('drops_title')}</h3>
              {data.drops_destinations.length === 0 ? (
                <div className="empty">{t('no_data')}</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('destination_col')}</th>
                      <th>{t('count_col')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drops_destinations.map((d) => (
                      <tr key={d.destination}>
                        <td className="mono">{d.destination}</td>
                        <td>{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {heat && heat.cells.length > 0 && (
            <div className="panel">
              <h3>{t('heatmap_title')}</h3>
              <table className="data heat-table">
                <thead>
                  <tr>
                    <th>{t('bin_col')}</th>
                    {heatMatrix.shops.map((s) => (
                      <th key={s} className="mono">{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatMatrix.bins.map((b) => (
                    <tr key={b}>
                      <td className="mono">{b}</td>
                      {heatMatrix.shops.map((s) => {
                        const c = heatMatrix.map[`${b}|${s}`]
                        if (!c) return <td key={s} className="heat-empty">·</td>
                        const cls = c.success_rate >= 70 ? 'heat-g' : c.success_rate >= 40 ? 'heat-a' : 'heat-r'
                        return (
                          <td key={s}>
                            <span
                              className={`heat-cell ${cls}`}
                              title={`${c.bin} × ${c.shop}: ${c.orders} / ok ${c.ok} / declined ${c.declined}`}
                            >
                              {c.success_rate}%
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
