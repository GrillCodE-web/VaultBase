import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

/**
 * Modal - Reusable modal component with animations
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
  footer,
}) {
  const modalRef = useRef(null)
  useFocusTrap(modalRef, isOpen)

  useEffect(() => {
    if (!isOpen) return

    const handleEscape = e => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const sizes = {
    sm: '420px',
    md: '560px',
    lg: '720px',
    xl: '900px',
  }

  return (
    <div
      className="overlay-enter"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        padding: '20px',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={modalRef}
        className="modal-enter"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          width: '100%',
          maxWidth: sizes[size],
          maxHeight: 'calc(100vh - 40px)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--sp-5) var(--sp-6)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {title && (
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--text)',
                  margin: 0,
                }}
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--r-sm)',
                  transition: 'all var(--t-fast)',
                  marginLeft: 'auto',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--hover)'
                  e.currentTarget.style.color = 'var(--text)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-3)'
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--sp-6)',
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: 'var(--sp-5) var(--sp-6)',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              gap: 'var(--sp-3)',
              justifyContent: 'flex-end',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
