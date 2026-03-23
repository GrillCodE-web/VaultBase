import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X } from 'lucide-react'

export function CardShopUsagePanel({ cardId, onClose }) {
  const [shops, setShops] = useState(null)
  useEffect(() => {
    invoke('get_card_shop_usage', { cardId })
      .then(setShops)
      .catch(() => setShops([]))
  }, [cardId])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Card shop usage"
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        zIndex: 100,
        background: 'var(--card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        overflow: 'auto',
        padding: 20,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-[13px]">Shops Used</div>
        <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      {shops === null ? (
        <div className="text-muted text-[12px]">Loading...</div>
      ) : shops.length === 0 ? (
        <div className="text-muted text-[12px]">No orders for this card yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {shops.map(s => (
            <div
              key={s.shop_id}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="font-semibold text-[12px]">{s.shop_name}</div>
              <div className="text-muted text-[11px]">{s.shop_domain}</div>
              <div className="flex items-center gap-2 mt-1 text-[11px]">
                <span>
                  {s.order_count} order{s.order_count !== 1 ? 's' : ''}
                </span>
                {s.last_order_date && (
                  <span className="text-muted">· {s.last_order_date.slice(0, 10)}</span>
                )}
                {s.last_status && (
                  <span
                    className={`st st-${s.last_status === 'delivered' ? 'active' : s.last_status === 'declined' ? 'decline' : 'pending'}`}
                  >
                    {s.last_status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
