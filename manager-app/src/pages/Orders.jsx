import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useLang } from '../hooks/useLang.jsx'
import { getSyncedOrders, getWorkerSnapshots, fmtDateTime, fmtRelative } from '../api/server.js'
import { SkeletonRows } from '../components/Skeleton.jsx'

// REDESIGN Этап B: E2E-контент заказов воркеров. Контент запечатан воркером
// под X25519-пубключ менеджера; сервер хранит только слепые конверты.
// Расшифровка и хранение — в menedzher (telemetry::fetch_worker_orders →
// synced_orders), сюда приходит уже открытый payload.

function statusTag(status) {
  const s = (status || '').toLowerCase()
  if (['delivered', 'completed', 'success', 'paid'].includes(s)) return 'green'
  if (['declined', 'cancelled', 'canceled', 'failed', 'error'].includes(s)) return 'red'
  if (['pending', 'processing', 'shipped', 'in_transit'].includes(s)) return 'amber'
  return 'gray'
}

function OrderDetail({ order, workerLabel, onClose }) {
  const { t } = useLang()
  const p = order.payload && typeof order.payload === 'object' ? order.payload : {}
  let items = null
  try {
    const raw = p.items_json ?? p.items
    items = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    items = p.items_json ?? null
  }
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <h3>{t('orders_detail_title')} — {order.order_number || order.order_ref}</h3>
        <div className="kv">
          <span className="k">{t('orders_col_worker')}</span>
          <span>{workerLabel || order.source_iid.slice(0, 16)}</span>
          <span className="k">{t('orders_ref')}</span>
          <span className="mono">{order.order_ref}</span>
          <span className="k">{t('orders_col_number')}</span>
          <span>{order.order_number || '—'}</span>
          <span className="k">{t('orders_col_status')}</span>
          <span><span className={`tag ${statusTag(order.status)}`}>{order.status || '—'}</span></span>
          <span className="k">{t('orders_col_total')}</span>
          <span className="mono">{order.total_amount != null ? order.total_amount : '—'}</span>
          <span className="k">{t('orders_col_tracking')}</span>
          <span className="mono">{order.tracking_number || '—'}</span>
          <span className="k">{t('orders_col_carrier')}</span>
          <span>{order.carrier || '—'}</span>
          <span className="k">{t('orders_col_updated')}</span>
          <span>{fmtDateTime(order.updated_at)}</span>
          <span className="k">{t('orders_col_received')}</span>
          <span>{fmtDateTime(order.received_at)}</span>
        </div>

        {order.notes && (
          <div className="panel" style={{ marginTop: 14, padding: 12 }}>
            <h3 style={{ fontSize: 13 }}>{t('orders_notes')}</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{order.notes}</div>
          </div>
        )}

        {items != null && (
          <div className="panel" style={{ marginTop: 14, padding: 12 }}>
            <h3 style={{ fontSize: 13 }}>{t('orders_items')}</h3>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
              {typeof items === 'string' ? items : JSON.stringify(items, null, 2)}
            </pre>
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

export default function Orders() {
  const { t, lang } = useLang()
  const [orders, setOrders] = useState(null)
  const [labels, setLabels] = useState({})
  const [filterIid, setFilterIid] = useState('')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    getSyncedOrders(filterIid || null)
      .then((r) => setOrders(Array.isArray(r.orders) ? r.orders : []))
      .catch((e) => {
        setError(String(e))
        setOrders([])
      })
  }

  useEffect(load, [filterIid])

  useEffect(() => {
    getWorkerSnapshots()
      .then((r) => {
        const m = {}
        for (const w of r.snapshots || []) m[w.installation_id] = w.label || ''
        setLabels(m)
      })
      .catch(() => {})
  }, [])

  // Realtime: сервер шлёт manager:orders_pending при заливке от воркера;
  // фоновый синк менеджера подтянет и расшифрует — просто перезагружаем список.
  useEffect(() => {
    let unl = []
    let disposed = false
    Promise.all([
      listen('manager:orders_pending', () => load()),
      listen('telemetry:updated', () => load()),
    ]).then((fns) => {
      if (disposed) fns.forEach((fn) => fn())
      else unl = fns
    })
    return () => {
      disposed = true
      unl.forEach((fn) => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterIid])

  const workerOptions = useMemo(() => {
    const seen = new Map()
    for (const o of orders || []) {
      if (!seen.has(o.source_iid)) seen.set(o.source_iid, labels[o.source_iid] || o.source_iid.slice(0, 12))
    }
    for (const [iid, label] of Object.entries(labels)) {
      if (!seen.has(iid)) seen.set(iid, label || iid.slice(0, 12))
    }
    return [...seen.entries()]
  }, [orders, labels])

  const label = (iid) => labels[iid] || iid.slice(0, 16)

  if (orders === null) return <SkeletonRows rows={8} />

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={load}>{t('refresh')}</button>
        <select
          className="sort-select"
          value={filterIid}
          onChange={(e) => setFilterIid(e.target.value)}
        >
          <option value="">{t('orders_all_workers')}</option>
          {workerOptions.map(([iid, lbl]) => (
            <option key={iid} value={iid}>{lbl}</option>
          ))}
        </select>
        <div className="grow" />
        <span className="meta">{t('orders_count', { n: orders.length })}</span>
      </div>

      <div className="hint" style={{ margin: '4px 2px 12px', color: 'var(--text-2)', fontSize: 12 }}>
        🔒 {t('orders_e2e_hint')}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="panel">
        {orders.length === 0 ? (
          <div className="empty">{t('orders_empty')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>{t('orders_col_worker')}</th>
                <th>{t('orders_col_number')}</th>
                <th>{t('orders_col_status')}</th>
                <th>{t('orders_col_total')}</th>
                <th>{t('orders_col_tracking')}</th>
                <th>{t('orders_col_carrier')}</th>
                <th>{t('orders_col_updated')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => setSelected(o)}>
                  <td>
                    {label(o.source_iid)}
                    <div className="mono" style={{ color: 'var(--text-3)' }}>{o.source_iid.slice(0, 16)}</div>
                  </td>
                  <td>{o.order_number || o.order_ref}</td>
                  <td><span className={`tag ${statusTag(o.status)}`}>{o.status || '—'}</span></td>
                  <td className="mono">{o.total_amount != null ? o.total_amount : '—'}</td>
                  <td className="mono">{o.tracking_number || '—'}</td>
                  <td>{o.carrier || '—'}</td>
                  <td title={fmtDateTime(o.updated_at)}>{fmtRelative(o.updated_at || o.received_at, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <OrderDetail
          order={selected}
          workerLabel={label(selected.source_iid)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
