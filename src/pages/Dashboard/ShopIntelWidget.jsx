import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLang } from '../../hooks/useLang'
import { handleError } from '../../utils/errorHandler.js'
import { getHeatmapClass } from './charts'

/**
 * REDESIGN-05-4 (финальный блок): статистика и рекомендации.
 * 1) Таблица магазин × ордеров × %ship × %cancel × %decline × средний чек
 *    (агрегат пула, без разреза по воркерам — чужие ордера сюда не попадают).
 * 2) «Когда бить»: магазин × день недели × часы → % успеха. Backend такой
 *    разбивки не отдаёт (get_heatmap_data — банк × шоп), считаем на клиенте.
 * 3) Рекомендатель карты: для выбранного шопа карты сортируются по ship-rate
 *    в этом шопе, подсказка «проходит здесь ok/n». Без автоподстановки.
 */

const PER_PAGE = 500
const MAX_ORDERS = 2500
const BUCKET_HOURS = 3 // 8 корзин в сутках
const MIN_CELL_ORDERS = 3
const MAX_SHOP_ROWS = 12
const SUCCESS = new Set(['shipped', 'delivered'])
const FAIL = new Set(['declined', 'cancelled'])
// Порядок строк сетки: Пн..Вс (getUTCDay: 0=Вс)
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

async function loadAllOrders() {
  const all = []
  let page = 1
  while (all.length < MAX_ORDERS) {
    const res = await invoke('get_orders', {
      filter: { status: null, shop_id: null, profile_id: null, card_id: null, search: null },
      page,
      perPage: PER_PAGE,
    })
    const items = res?.items || []
    all.push(...items)
    if (items.length < PER_PAGE) break
    page++
  }
  return all
}

function parseUtc(ts) {
  if (!ts) return null
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d
}

function isResolved(status) {
  return SUCCESS.has(status) || FAIL.has(status)
}

export function ShopIntelWidget() {
  const { t } = useLang()
  const [orders, setOrders] = useState(null)
  const [shopKey, setShopKey] = useState('')

  useEffect(() => {
    let alive = true
    loadAllOrders()
      .then(list => {
        if (alive) setOrders(list)
      })
      .catch(e => {
        handleError(e, 'ShopIntelWidget')
        if (alive) setOrders([])
      })
    return () => {
      alive = false
    }
  }, [])

  // Агрегат по магазинам
  const shopStats = useMemo(() => {
    if (!orders) return []
    const byShop = new Map()
    for (const o of orders) {
      const key = o.shop_id ?? o.shop_name
      if (key == null) continue
      if (!byShop.has(key)) {
        byShop.set(key, {
          key: String(key),
          name: o.shop_name || `#${key}`,
          total: 0,
          ship: 0,
          cancel: 0,
          decline: 0,
          amountSum: 0,
          amountN: 0,
        })
      }
      const s = byShop.get(key)
      s.total++
      if (SUCCESS.has(o.status)) s.ship++
      else if (o.status === 'cancelled') s.cancel++
      else if (o.status === 'declined') s.decline++
      if (o.status === 'delivered' && typeof o.total_amount === 'number') {
        s.amountSum += o.total_amount
        s.amountN++
      }
    }
    return [...byShop.values()].sort((a, b) => b.total - a.total)
  }, [orders])

  const selected = useMemo(
    () => shopStats.find(s => s.key === shopKey) || shopStats[0] || null,
    [shopStats, shopKey]
  )

  // «Когда бить»: день недели × 3ч-корзина → % успеха по завершённым
  const whenGrid = useMemo(() => {
    if (!orders || !selected) return null
    const cells = new Map()
    for (const o of orders) {
      const k = o.shop_id ?? o.shop_name
      if (k == null || String(k) !== selected.key) continue
      if (!isResolved(o.status)) continue
      const d = parseUtc(o.created_at)
      if (!d) continue
      const ck = `${d.getUTCDay()}|${Math.floor(d.getUTCHours() / BUCKET_HOURS)}`
      if (!cells.has(ck)) cells.set(ck, { ok: 0, n: 0 })
      const c = cells.get(ck)
      c.n++
      if (SUCCESS.has(o.status)) c.ok++
    }
    return cells
  }, [orders, selected])

  // Рекомендатель карт: ship-rate карты в выбранном шопе
  const cardRecs = useMemo(() => {
    if (!orders || !selected) return []
    const byCard = new Map()
    for (const o of orders) {
      if (String(o.shop_id ?? o.shop_name ?? '') !== selected.key) continue
      if (o.card_id == null || !isResolved(o.status)) continue
      if (!byCard.has(o.card_id)) {
        byCard.set(o.card_id, {
          id: o.card_id,
          bank: o.bank_name || '',
          last4: o.last4 || '',
          ok: 0,
          n: 0,
        })
      }
      const c = byCard.get(o.card_id)
      c.n++
      if (SUCCESS.has(o.status)) c.ok++
    }
    return [...byCard.values()].sort((a, b) => b.ok / b.n - a.ok / a.n || b.n - a.n)
  }, [orders, selected])

  if (orders === null) return null
  if (shopStats.length === 0) {
    return <div className="text-muted text-12 py-2">{t('dash_not_enough_data')}</div>
  }

  const buckets = [...Array(24 / BUCKET_HOURS).keys()]

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Статистика магазинов */}
      <div>
        <div className="slabel">{t('shopintel_stats')}</div>
        <div className="overflow-x-auto">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th className="text-left text-muted font-medium text-10 pb-1 pr-2">
                  {t('col_shop_name')}
                </th>
                {[
                  'shopintel_col_orders',
                  'shopintel_col_ship',
                  'shopintel_col_cancel',
                  'shopintel_col_decline',
                  'shopintel_col_avg',
                ].map(k => (
                  <th key={k} className="text-text-2 text-10 font-medium pb-1 px-1">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shopStats.slice(0, MAX_SHOP_ROWS).map(s => (
                <tr key={s.key}>
                  <td className="bank-label" title={s.name}>
                    {s.name.length > 22 ? s.name.slice(0, 22) + '...' : s.name}
                  </td>
                  <td className="heatmap-cell heatmap-cell-no-data font-mono">{s.total}</td>
                  {[
                    (s.ship / s.total) * 100,
                    (s.cancel / s.total) * 100,
                    (s.decline / s.total) * 100,
                  ].map((pct, i) => (
                    <td key={i} className={`heatmap-cell ${getHeatmapClass(pct)}`}>
                      {pct.toFixed(0)}%
                    </td>
                  ))}
                  <td className="heatmap-cell heatmap-cell-no-data font-mono">
                    {s.amountN > 0 ? `$${(s.amountSum / s.amountN).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Шоп для блоков 2-3 */}
      <div className="flex items-center gap-2">
        <select
          className="input input-sm"
          value={selected?.key || ''}
          onChange={e => setShopKey(e.target.value)}
          aria-label={t('shopintel_pick_shop')}
        >
          {shopStats.map(s => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* 2. «Когда бить» */}
      <div>
        <div className="slabel">{t('shopintel_when')}</div>
        <div className="overflow-x-auto">
          <table className="heatmap-table">
            <thead>
              <tr>
                <th className="text-left text-muted font-medium text-10 pb-1 pr-2" />
                {buckets.map(b => (
                  <th key={b} className="text-text-2 text-10 font-medium pb-1 px-1">
                    {b * BUCKET_HOURS}–{b * BUCKET_HOURS + BUCKET_HOURS}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_ORDER.map(day => (
                <tr key={day}>
                  <td className="bank-label">{t(`shopintel_wd_${day}`)}</td>
                  {buckets.map(b => {
                    const c = whenGrid?.get(`${day}|${b}`)
                    const rate = c && c.n >= MIN_CELL_ORDERS ? (c.ok / c.n) * 100 : -1
                    return (
                      <td
                        key={b}
                        className={`heatmap-cell ${getHeatmapClass(rate)}`}
                        title={c ? `${c.ok}/${c.n}` : undefined}
                      >
                        {rate >= 0 ? `${rate.toFixed(0)}%` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Рекомендатель карт */}
      <div>
        <div className="slabel">{t('shopintel_rec')}</div>
        {cardRecs.length === 0 ? (
          <div className="text-muted text-12 py-1">{t('shopintel_no_resolved')}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {cardRecs.map((c, i) => (
              <div key={c.id} className="flex items-center gap-2 text-12 py-0.5">
                <span className="text-muted font-mono">{i + 1}.</span>
                <span className="font-mono">
                  {c.bank || '—'} ••{c.last4 || '????'}
                </span>
                <span className="text-muted flex-1 text-right">
                  {t('shopintel_card_hint', { ok: c.ok, n: c.n })}
                </span>
              </div>
            ))}
            <div className="text-muted text-10 mt-1">{t('shopintel_rec_note')}</div>
          </div>
        )}
      </div>
    </div>
  )
}
