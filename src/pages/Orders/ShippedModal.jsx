import { useState } from 'react'
import { Truck } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { Modal } from '../../components/Modal.jsx'

// REDESIGN-05-2: ручной оверлей/шапка/focus-trap/Escape/scroll-lock
// (FIX P1-16) заменены общим <Modal>.
export function ShippedModal({ onConfirm, onClose }) {
  const { t } = useLang()
  const [track, setTrack] = useState('')
  const [carrier, setCarrier] = useState('')

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Truck size={16} className="text-blue-t" />
          {t('order_mark_shipped')}
        </span>
      }
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
            {t('btn_cancel')}
          </button>
          <button
            onClick={() => onConfirm({ tracking_number: track || null, carrier: carrier || null })}
            className="btn btn-b btn-sm flex-1"
          >
            Confirm
          </button>
        </>
      }
    >
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
          placeholder="UPS, FedEx, USPS..."
          className="form-input"
        />
      </div>
    </Modal>
  )
}
