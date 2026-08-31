import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { handleError } from '../../utils/errorHandler.js'

const MIN_SHOP_ORDERS = 5
const MIN_PROXY_ORDERS = 5
const SHOP_SPIKE_MULT = 3 // «деклайн-рейт шопа ×3» от среднего
const SHOP_MIN_ABS = 0.15 // и не ниже 15% абсолютно (защита от шума)
const PROXY_FAIL_RATE = 0.4 // «прокси даёт 40% фейлов»

/**
 * REDESIGN-05-4 (порция 4): аномалии дашборда. Backend-команды insights в
 * worker-репо нет — считаем на клиенте из существующих команд:
 * get_shop_win_loss (спайк деклайн-рейта магазина) + get_proxy_usage_stats
 * (прокси с высокой долей фейлов).
 */
export function AnomaliesWidget({ onNavigate }) {
  const { t } = useLang()
  const [items, setItems] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [winLoss, proxyStats, proxiesRes] = await Promise.all([
          invoke('get_shop_win_loss').catch(() => []),
          invoke('get_proxy_usage_stats').catch(() => []),
          invoke('get_proxies', {
            filter: { is_blocked: null, is_used: null, proxy_type: null },
            page: 1,
            perPage: 1000,
          }).catch(() => ({ items: [] })),
        ])
        if (!alive) return
        const out = []

        const wl = Array.isArray(winLoss) ? winLoss : []
        const totOrders = wl.reduce((a, s) => a + (s.total_orders || 0), 0)
        const totDecl = wl.reduce((a, s) => a + (s.declined || 0), 0)
        const baseRate = totOrders > 0 ? totDecl / totOrders : 0
        for (const s of wl) {
          const total = s.total_orders || 0
          if (total < MIN_SHOP_ORDERS) continue
          const rate = (s.declined || 0) / total
          if (rate >= Math.max(SHOP_MIN_ABS, baseRate * SHOP_SPIKE_MULT)) {
            out.push({
              key: `shop:${s.shop}`,
              severity: 'error',
              text: t('anomaly_shop_decline', {
                shop: s.shop,
                n: Math.round(rate * 100),
                base: Math.round(baseRate * 100),
              }),
              page: 'shops',
            })
          }
        }

        const labelById = new Map(
          (proxiesRes?.items || []).map(p => [p.id, p.label || p.host || `#${p.id}`])
        )
        for (const p of Array.isArray(proxyStats) ? proxyStats : []) {
          if ((p.total_orders || 0) < MIN_PROXY_ORDERS) continue
          const rate = (p.decline_count || 0) / p.total_orders
          if (rate >= PROXY_FAIL_RATE) {
            out.push({
              key: `proxy:${p.proxy_id}`,
              severity: 'warning',
              text: t('anomaly_proxy_fails', {
                proxy: labelById.get(p.proxy_id) || `#${p.proxy_id}`,
                n: Math.round(rate * 100),
              }),
              page: 'proxies',
            })
          }
        }

        setItems(out)
      } catch (e) {
        handleError(e, 'AnomaliesWidget')
        if (alive) setItems([])
      }
    })()
    return () => {
      alive = false
    }
  }, [t])

  if (items === null) return null

  return (
    <div>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-12 text-muted py-1">
          <CheckCircle2 size={13} className="text-success" aria-hidden="true" />
          {t('anomalies_empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map(a => (
            <button
              key={a.key}
              className="flex items-center gap-2 text-left text-12 bg-transparent border-none cursor-pointer py-1 px-1 rounded-sm text-text hover:bg-hover"
              onClick={() => onNavigate?.(a.page)}
            >
              <AlertTriangle
                size={13}
                className={a.severity === 'error' ? 'text-red-t' : 'text-warning'}
                aria-hidden="true"
              />
              <span className="flex-1">{a.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
