import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useLang } from '../hooks/useLang'

/**
 * Inspector — единый паттерн правого инспектора 05 «Adaptive»
 * (REDESIGN-05-1). Заменяет разнородные сайд-панели страниц
 * (CardSidePanel, ProfileDetailPanel и т.п.); их перевод — этап 3.
 *
 * Панель 320px справа от контента: заголовок, подзаголовок,
 * скроллящийся контент, опциональный футер с действиями.
 * Закрытие: Esc, клик по крестику. Фокус возвращается вызывавшему.
 *
 * Props:
 *   open: bool
 *   onClose()
 *   title, subtitle?: string
 *   width?: px (default 320)
 *   headerActions?: node (кнопки в шапке, слева от крестика)
 *   footer?: node
 *   children: контент
 */
export default function Inspector({
  open,
  onClose,
  title,
  subtitle,
  width = 320,
  headerActions,
  footer,
  children,
}) {
  const panelRef = useRef(null)
  const prevFocusRef = useRef(null)
  const { t } = useLang()

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement
    panelRef.current?.focus()
    const onKey = e => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <aside
      ref={panelRef}
      className="inspector"
      style={{ width }}
      role="complementary"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="inspector-head">
        <div className="inspector-titles">
          <div className="inspector-title">{title}</div>
          {subtitle && <div className="inspector-sub">{subtitle}</div>}
        </div>
        {headerActions && <div className="inspector-actions">{headerActions}</div>}
        <button className="inspector-close" onClick={onClose} aria-label={t('shortcut_close')}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="inspector-body">{children}</div>
      {footer && <div className="inspector-foot">{footer}</div>}
    </aside>
  )
}
