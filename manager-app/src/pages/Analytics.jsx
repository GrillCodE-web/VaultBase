import { useEffect, useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { useLang } from '../hooks/useLang.jsx'
import { getAnalytics } from '../api/server.js'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await getAnalytics(from, to)
      setData(res)
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

  return (
    <div>
      <div className="toolbar">
        <div className="seg">
          <button onClick={() => setPeriod(1)}>{t('days1')}</button>
          <button onClick={() => setPeriod(7)}>{t('days7')}</button>
          <button className={from === isoDay(30) ? 'active' : ''} onClick={() => setPeriod(30)}>{t('days30')}</button>
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

          <div className="split-2">
            <div className="panel">
              <h3>{t('workers_table')}</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('col_label')}</th>
                    <th>{t('cards_taken_col')}</th>
                    <th>{t('orders_col')}</th>
                    <th>{t('drops_col')}</th>
                    <th>{t('dead_ratio')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_worker.map((w) => (
                    <tr key={w.installation_id}>
                      <td>{w.label || w.installation_id.slice(0, 12)}</td>
                      <td>{w.cards_taken}</td>
                      <td>{w.orders}</td>
                      <td>{w.drops_taken}</td>
                      <td>
                        <span className={`tag ${w.dead_ratio > 25 ? 'red' : w.dead_ratio > 10 ? 'amber' : 'green'}`}>
                          {w.dead_ratio}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        </>
      )}
    </div>
  )
}
