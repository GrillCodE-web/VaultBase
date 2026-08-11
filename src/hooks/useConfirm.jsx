import { useState, useCallback, useRef, createContext, useContext } from 'react'
import { useFocusTrap } from './useFocusTrap.js'
import { HEX_COLORS } from '../constants/colors.js'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const [cancelHover, setCancelHover] = useState(false)
  const [confirmHover, setConfirmHover] = useState(false)

  const confirm = useCallback((message, opts = {}) => {
    const options = typeof opts === 'string' ? { title: opts } : opts
    const {
      title = 'Confirm',
      danger = false,
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
    } = options
    return new Promise(resolve => {
      setState({ message, title, danger, confirmLabel, cancelLabel, resolve })
    })
  }, [])

  const handleResult = result => {
    state?.resolve(result)
    setState(null)
  }
  const modalRef = useRef(null)
  useFocusTrap(modalRef, !!state)

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--overlay-modal)' }}
        >
          <div
            ref={modalRef}
            className="bg-card rounded-xl p-6 w-full mx-4"
            style={{
              border: `1px solid var(--border)`,
              maxWidth: '360px',
              boxShadow: '0 25px 50px var(--overlay-darker)',
            }}
          >
            <h3 id="confirm-title" className="text-text text-base font-semibold mb-2">
              {state.title}
            </h3>
            <p
              id="confirm-message"
              className="text-text-2 text-sm mb-6"
              style={{ lineHeight: 1.6 }}
            >
              {state.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleResult(false)}
                onMouseEnter={() => setCancelHover(true)}
                onMouseLeave={() => setCancelHover(false)}
                className="rounded-lg px-4 py-2 text-sm cursor-pointer transition-colors text-text-2"
                style={{
                  border: `1px solid var(--border)`,
                  background: cancelHover ? 'var(--card-hi)' : 'transparent',
                }}
              >
                {state.cancelLabel}
              </button>
              <button
                onClick={() => handleResult(true)}
                onMouseEnter={() => setConfirmHover(true)}
                onMouseLeave={() => setConfirmHover(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium border-0 cursor-pointer transition-colors text-white"
                style={{
                  background: state.danger
                    ? confirmHover
                      ? 'var(--red)'
                      : HEX_COLORS.red
                    : confirmHover
                      ? 'var(--accent)'
                      : HEX_COLORS.blue,
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook export pattern
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return { confirm: ctx.confirm }
}
