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
      className="overlay-enter fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className="modal-enter bg-card border border-border rounded-lg w-full flex flex-col"
        style={{
          maxWidth: sizes[size],
          maxHeight: 'calc(100vh - 40px)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between py-5 px-6 border-b">
            {title && (
              <h2 id="modal-title" className="text-[16px] font-semibold text-text m-0">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="bg-transparent border-none text-text-3 cursor-pointer p-1 flex items-center justify-center rounded-sm ml-auto"
                style={{
                  transition: 'all var(--t-fast)',
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
        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {/* Footer */}
        {footer && <div className="py-5 px-6 border-t flex gap-3 justify-end">{footer}</div>}
      </div>
    </div>
  )
}
