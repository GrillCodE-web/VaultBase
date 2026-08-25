import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useEscapeKey } from '../../hooks/useEscapeKey.js'

export function QuickOrderModal({ profile, onClose, onCreated }) {
  useEscapeKey(onClose)
  const [url, setUrl] = useState('')
  const [shop, setShop] = useState(null) // { id, domain, is_new }
  const [lookingUp, setLookingUp] = useState(false)
  const [itemName, setItemName] = useState('')
  const [itemSku, setItemSku] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  const handleLookup = async () => {
    if (!url.trim()) return
    setLookingUp(true)
    try {
      const result = await invoke('find_or_create_shop', { url: url.trim() })
      setShop(result)
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLookingUp(false)
    }
  }

  const handleCreate = async () => {
    if (!shop) return
    setSaving(true)
    try {
      const amountF = parseFloat(amount) || 0
      await invoke('create_order', {
        input: {
          profile_id: String(profile.id),
          shop_id: shop.id,
          drop_id: null,
          email_pool_id: null,
          proxy_id: null,
          order_number: null,
          notes: null,
          items: [{ name: itemName || shop.domain, sku: itemSku || '', qty: 1, price: amountF }],
        },
      })
      toast('Order created!', 'success')
      onCreated?.()
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal max-w-\[420px\]" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Order — {profile.holder_masked || `••••${profile.last4 || '?????'}`}</span>
          <button className="icon-btn" onClick={onClose}>
            вњ•
          </button>
        </div>
        <div className="modal-body flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-muted">Shop URL or Domain</label>
            <div className="flex gap-1.5 mt-1">
              <input
                className="inp flex-1"
                placeholder="nike.com or https://nike.com/checkout"
                value={url}
                onChange={e => {
                  setUrl(e.target.value)
                  setShop(null)
                }}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                autoFocus
              />
              <button
                className="btn btn-b"
                onClick={handleLookup}
                disabled={lookingUp || !url.trim()}
              >
                {lookingUp ? '...' : 'Find'}
              </button>
            </div>
          </div>

          {shop && (
            <div className="p-\[8px_12px\] bg-[var(--surface2)] rounded text-[12px] flex items-center gap-2">
              <span style={{ color: shop.is_new ? 'var(--accent)' : 'var(--text)' }}>
                {shop.is_new ? 'вњ¦ New shop:' : 'вњ“ Found:'} <strong>{shop.domain}</strong>
              </span>
            </div>
          )}

          {shop && (
            <>
              <input
                className="inp"
                placeholder="Item name (optional)"
                value={itemName}
                onChange={e => setItemName(e.target.value)}
              />
              <input
                className="inp"
                placeholder="SKU (optional)"
                value={itemSku}
                onChange={e => setItemSku(e.target.value)}
              />
              <input
                className="inp"
                placeholder="Amount, e.g. 89.99"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-g" onClick={handleCreate} disabled={!shop || saving}>
            {saving ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
