import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

const ConfirmContext = createContext(null)

// Порт воркерского useConfirm: Promise-based диалог вместо window.confirm.
// Стили — на общих классах manager.css (.modal-overlay/.modal/.btn).
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const confirmBtnRef = useRef(null)

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

  // Фокус на кнопке подтверждения + Escape = отмена.
  useEffect(() => {
    if (!state) return
    confirmBtnRef.current?.focus()
    const onKey = e => {
      if (e.key === 'Escape') handleResult(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state])

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state &&
        createPortal(
          <div className="modal-overlay" onClick={() => handleResult(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              aria-describedby="confirm-message"
              className="modal"
              style={{ maxWidth: 380, maxHeight: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              <h3 id="confirm-title">{state.title}</h3>
              <p id="confirm-message" style={{ margin: '0 0 20px', lineHeight: 1.6, color: 'var(--text-2)', fontSize: 13 }}>
                {state.message}
              </p>
              <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => handleResult(false)}>
                  {state.cancelLabel}
                </button>
                <button
                  ref={confirmBtnRef}
                  className={`btn ${state.danger ? 'danger' : 'primary'}`}
                  onClick={() => handleResult(true)}
                >
                  {state.confirmLabel}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return { confirm: ctx.confirm }
}
