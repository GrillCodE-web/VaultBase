import { useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useConfirm } from '../../hooks/useConfirm'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'
import { ORDER_STATUSES, ORDER_STATUS_DOT_COLORS } from '../../constants/status.js'
import { ShippedModal } from './ShippedModal.jsx'

export function StatusMenu({ order, onUpdate, onClose }) {
  const { t } = useLang()
  const [showShippedModal, setShowShippedModal] = useState(false)
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()
  const submittingRef = useRef(false)

  const handleStatus = async status => {
    if (status === 'shipped') {
      setShowShippedModal(true)
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    if (status === 'declined' || status === 'cancelled') {
      const markDead = await confirm(
        status === 'declined'
          ? t('confirm_mark_card_dead')
          : 'Order cancelled. Mark the card as dead?',
        {
          confirmLabel: t('confirm_mark_dead_confirm') || 'Mark as Dead',
          cancelLabel: t('confirm_mark_dead_cancel') || 'Keep',
        }
      )
      try {
        await invoke('update_order_status', { id: order.id, status, meta: null })
        if (markDead && order.card_id != null)
          await invoke('update_card_status', { id: order.card_id, status: 'dead' })
        toast(t('status_updated'), 'success')
        onUpdate()
        onClose()
      } catch (e) {
        const error = handleError(e, 'OrderModal.handleUpdate')
        toast(getErrorMessage(error), 'error')
      } finally {
        submittingRef.current = false
      }
      return
    }
    try {
      await invoke('update_order_status', { id: order.id, status, meta: null })
      toast(t('status_updated'), 'success')
      onUpdate()
      onClose()
    } catch (e) {
      const error = handleError(e, 'Orders.handleStatusChange')
      toast(getErrorMessage(error), 'error')
    } finally {
      submittingRef.current = false
    }
  }

  const handleShipped = async meta => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      await invoke('update_order_status', { id: order.id, status: 'shipped', meta })
      toast(t('order_marked_shipped'), 'success')
      onUpdate()
      onClose()
    } catch (e) {
      const error = handleError(e, 'Orders.handleShipped')
      toast(getErrorMessage(error), 'error')
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <>
      <div className="absolute bg-card border rounded-lg overflow-hidden right-0 top-8 z-30 shadow-dropdown w-40">
        {ORDER_STATUSES.filter(s => s !== order.status).map(s => (
          <button
            key={s}
            onClick={() => handleStatus(s)}
            className="w-full text-left px-3 py-2 text-12 text-text-2 bg-transparent border-none cursor-pointer flex items-center gap-2"
          >
            <span
              className="status-menu-dot rounded-full shrink-0"
              style={{
                backgroundColor: ORDER_STATUS_DOT_COLORS[s] ?? 'var(--text-2)',
              }}
            />
            {s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>
      {showShippedModal && (
        <ShippedModal onConfirm={handleShipped} onClose={() => setShowShippedModal(false)} />
      )}
    </>
  )
}
