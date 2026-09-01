// REDESIGN-05-6: мост десктоп-событий — panic:request (глобальный хоткей /
// пункт трея) и tray:sync. Монтируется в корне App: panic-модалка обязана
// работать даже на экране блокировки. Здесь же живёт глобальный D&D импорт.
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ShieldAlert } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth.jsx'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { handleError } from '../utils/errorHandler.js'
import { Modal } from './Modal.jsx'
import { GlobalDropImport } from './GlobalDropImport.jsx'

// PIN-модалка panic-wipe. Пин = panic-пароль (MGR-013); при верном пине
// процесс стирает данные и завершается — промис invoke никогда не резолвится.
function PanicPinModal({ onClose }) {
  const { t } = useLang()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [hasPanic, setHasPanic] = useState(null)

  useEffect(() => {
    let cancelled = false
    invoke('has_panic_password')
      .then(v => {
        if (!cancelled) setHasPanic(!!v)
      })
      .catch(() => {
        if (!cancelled) setHasPanic(true) // неизвестно — даём ввести пин
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async () => {
    if (!pin || busy) return
    setBusy(true)
    setError('')
    try {
      await invoke('panic_wipe', { pin })
      // unreachable при успехе — процесс уже мёртв
    } catch (e) {
      handleError(e, 'DesktopBridge.panicWipe')
      setBusy(false)
      const msg = String(e?.message ?? e)
      setError(
        msg.startsWith('rate_limit_exceeded') ? t('panic_modal_rate') : t('panic_modal_wrong')
      )
    }
  }

  return (
    <Modal
      isOpen
      onClose={busy ? () => {} : onClose}
      size="sm"
      showCloseButton={!busy}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-red-t" />
          {t('panic_modal_title')}
        </span>
      }
    >
      {hasPanic === false ? (
        <p className="text-13 text-muted m-0">{t('panic_modal_need_setup')}</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <p className="text-13 text-muted m-0">{t('panic_modal_desc')}</p>
          <input
            type="password"
            className="form-input"
            placeholder={t('panic_placeholder')}
            value={pin}
            disabled={busy}
            autoFocus
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submit()
            }}
          />
          {error && <div className="text-12 text-red-t">{error}</div>}
          {busy ? (
            <div className="text-13 text-red-t font-semibold">{t('panic_modal_wiping')}</div>
          ) : (
            <div className="flex gap-3">
              <button onClick={onClose} className="btn btn-ghost flex-1">
                {t('btn_cancel')}
              </button>
              <button onClick={() => void submit()} disabled={!pin} className="btn btn-r flex-1">
                {t('panic_modal_confirm')}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export function DesktopBridge() {
  const { currentUser } = useAuth()
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const [panicOpen, setPanicOpen] = useState(false)
  const currentUserRef = useRef(currentUser)
  const syncRunningRef = useRef(false)

  useEffect(() => {
    currentUserRef.current = currentUser
  }, [currentUser])

  useEffect(() => {
    const unlisteners = [
      listen('panic:request', () => setPanicOpen(true)),
      listen('tray:sync', async () => {
        // Синхронизация из трея — только с активной сессией, не параллельно.
        if (!currentUserRef.current || syncRunningRef.current) return
        syncRunningRef.current = true
        try {
          await invoke('sync_now')
          toast(t('tray_sync_done'), 'success')
        } catch (e) {
          handleError(e, 'DesktopBridge.traySync')
          toast(t('tray_sync_fail'), 'error')
        } finally {
          syncRunningRef.current = false
        }
      }),
    ]
    return () => {
      unlisteners.forEach(p => p.then(fn => fn()).catch(() => {}))
    }
    // toast/t стабильны по смыслу; подписка одна на жизнь приложения
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <GlobalDropImport />
      {panicOpen && <PanicPinModal onClose={() => setPanicOpen(false)} />}
    </>
  )
}
