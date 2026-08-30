import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RotateCcw } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { Modal } from '../../components/Modal.jsx'

// REDESIGN-05-2: ручной оверлей/шапка/focus-trap/Escape/scroll-lock
// (FIX P1-16) заменены общим <Modal>.
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
      : (order.item_name ?? '—')

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <RotateCcw size={15} className="text-blue-t" />
          Repeat Order
        </span>
      }
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={handleRepeat}
            disabled={loading || !selectedProfileId}
            className={`btn btn-b btn-sm flex-1 ${loading || !selectedProfileId ? 'opacity-40' : ''}`}
          >
            {loading ? 'Creating...' : 'Repeat Order'}
          </button>
        </>
      }
    >
      <div className="text-13 text-text-2 mb-4 leading-normal">
        Repeat order for <strong className="text-text">{shopLabel}</strong>
        {itemLabel !== '—' && (
          <>
            {' '}
            — <span className="text-muted">{itemLabel}</span>
          </>
        )}
        ?
      </div>

      <div className="form-group">
        <label className="form-label">Select Profile</label>
        {loadingProfiles ? (
          <div className="text-12 text-muted py-2">Loading profiles…</div>
        ) : (
          <select
            value={selectedProfileId}
            onChange={e => setSelectedProfileId(e.target.value)}
            className="inline-select w-full"
          >
            <option value="">— Select profile —</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.holder_masked || '—'} ···{p.last4 || '????'}
                {p.bank_name ? ` (${p.bank_name})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </Modal>
  )
}
