import { useState, useRef, useEffect } from 'react'
import { Truck, X } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { useEscapeKey } from '../../hooks/useEscapeKey.js'

export function ShippedModal({ onConfirm, onClose }) {
  useEscapeKey(onClose)
  const { t } = useLang()
  const [track, setTrack] = useState('')
  const [carrier, setCarrier] = useState('')
  const modalRef = useRef(null)
  useFocusTrap(modalRef, true)

  // FIX P1-16: Add scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipped-modal-title"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-blue-t" />
            <span id="shipped-modal-title" className="modal-title m-0">
              {t('order_mark_shipped')}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">{t('tracking_number')}</label>
          <input
            value={track}
            onChange={e => setTrack(e.target.value)}
            placeholder="1Z999AA10123456784"
            className="form-input font-mono"
          />
        </div>
        <div className="form-group">
          <label className="form-label">{t('carrier')}</label>
          <input
            value={carrier}
            onChange={e => setCarrier(e.target.value)}
            placeholder="UPS, FedEx, USPS…"
            className="form-input"
          />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={() => onConfirm({ tracking_number: track || null, carrier: carrier || null })}
            className="btn btn-b btn-sm flex-1"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
