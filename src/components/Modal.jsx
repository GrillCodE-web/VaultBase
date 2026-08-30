import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
// Стили модалки — в общем styles/components.css (подключается из index.css).

// REDESIGN-05-2: ref-counted body scroll-lock (как useScrollLock/BUG-012,
// но с учётом isOpen — Modal при isOpen=false остаётся смонтирован).
let modalLockCount = 0

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
  // REDESIGN-05-2: доп. класс окна (кастомные ширины/варианты у доменов)
  className = '',
  // REDESIGN-05-2: scroll-режим для длинных форм — шапка/футер фиксированы,
  // скроллит только тело (.modal-scroll в components.css)
  scroll = false,
  // REDESIGN-05-2: доп. класс тела (например убрать отступы у табличного тела)
  bodyClassName = '',
}) {
  const modalRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const onCloseRef = useRef(onClose)

  // FIX P1-15: Update ref in effect, not during render
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useFocusTrap(modalRef, isOpen)

  // REDESIGN-05-2: блокировка скролла страницы под модалкой
  // (раньше — ручной document.body.style.overflow в каждой модалке)
  useEffect(() => {
    if (!isOpen) return undefined
    modalLockCount++
    document.body.style.overflow = 'hidden'
    return () => {
      modalLockCount--
      if (modalLockCount <= 0) {
        modalLockCount = 0
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  // Store focused element before modal opens and restore on close
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement
    } else {
      previouslyFocusedRef.current?.focus()
    }
  }, [isOpen])

  // FIX P1-15: Use ref for stable onClose reference to prevent listener recreation
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = e => {
      if (e.key === 'Escape') {
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  if (!isOpen) return null

  const sizes = {
    sm: 'var(--modal-sm)',
    md: 'var(--modal-md)',
    lg: 'var(--modal-lg)',
    xl: 'var(--modal-xl)',
  }
  // REDESIGN-05-2: size может быть произвольной CSS-длиной ('620px') —
  // для доменных модалок, чья ширина не совпадает со шкалой.
  const modalSize = sizes[size] ?? size

  // Портал в body: модалка не должна зависеть от предков страницы —
  // transform/filter/overflow у любого из них ломают position:fixed
  // (оверлей клипится и «уезжает» за пределы видимого окна).
  return createPortal(
    <div
      className="modal-overlay overlay-enter"
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
        className={`modal modal-enter${scroll ? ' modal-scroll' : ''}${
          className ? ` ${className}` : ''
        }`}
        style={{ '--modal-size': modalSize }}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="modal-header">
            {title && (
              <h2 id="modal-title" className="modal-header__title">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button onClick={onClose} aria-label="Close" className="modal-close">
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className={`modal-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>

        {/* Footer */}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
