import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCcw, X } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'

export function RepeatOrderModal({ order, onCreated, onClose }) {
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(
    order.profile_id ? String(order.profile_id) : ''
  )
  const [loading, setLoading] = useState(false)
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const submittingRef = useRef(false)
  const modalRef = useRef(null)
  useFocusTrap(modalRef, true)

  // FIX P1-16: Add scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    invoke('get_profiles', { filter: {}, page: 1, perPage: 200 })
      .then(r => {
        if (!cancelled) setProfiles(r.items || [])
      })
      .catch(() => {
        if (!cancelled) setProfiles([])
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleRepeat = async () => {
    if (!selectedProfileId) {
      toast('Select a profile', 'warn')
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    try {
      await invoke('create_order', {
        input: {
          profile_id: parseInt(selectedProfileId),
          shop_id: order.shop_id,
          drop_id: order.drop_id ?? null,
          email_pool_id: order.email_pool_id ?? null,
          proxy_id: order.proxy_id ?? null,
          order_number: null,
          notes: order.notes ?? null,
          items: order.items ?? [],
        },
      })
      toast('Order repeated successfully', 'success')
      onCreated()
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  const shopLabel = order.shop_name || `Shop #${order.shop_id}`
  const itemLabel =
    order.items?.length > 0
      ? order.items
          .map(i => i.name)
          .filter(Boolean)
          .join(', ')
      : (order.item_name ?? 'вЂ”')

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal w-modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repeat-order-title"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <RotateCcw size={15} className="text-blue-t" />
            <span id="repeat-order-title" className="modal-title m-0">
              Repeat Order
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="text-[13px] text-text-2 mb-4 leading-normal">
          Repeat order for <strong className="text-text">{shopLabel}</strong>
          {itemLabel !== 'вЂ”' && (
            <>
              {' '}
              вЂ” <span className="text-muted">{itemLabel}</span>
            </>
          )}
          ?
        </div>

        <div className="form-group">
          <label className="form-label">Select Profile</label>
          {loadingProfiles ? (
            <div className="text-[12px] text-muted py-2">Loading profilesвЂ¦</div>
          ) : (
            <select
              value={selectedProfileId}
              onChange={e => setSelectedProfileId(e.target.value)}
              className="inline-select w-full"
            >
              <option value="">вЂ” Select profile вЂ”</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.holder_masked || 'вЂ”'} В·В·В·{p.last4 || '????'}
                  {p.bank_name ? ` (${p.bank_name})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={handleRepeat}
            disabled={loading || !selectedProfileId}
            className={`btn btn-b btn-sm flex-1 ${loading || !selectedProfileId ? 'opacity-40' : ''}`}
          >
            {loading ? 'CreatingвЂ¦' : 'Repeat Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
