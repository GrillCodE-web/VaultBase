import { useState, useRef, useEffect } from 'react'

/**
 * Menu — выпадающее меню общего назначения (топбар 05 «Adaptive»).
 *
 * В отличие от ActionsMenu (кнопка ⋮ в строке таблицы), триггер
 * рендерится снаружи через render prop — подходят и «+ Создать»,
 * и аватар пользователя. Паттерн повторяет ActionsMenu: outside
 * click, Escape, стрелки, роли menu/menuitem.
 *
 * Props:
 *   items: Array<{ label, icon?, onClick?, danger?, divider?, header?, hint? }>
 *   align: 'left' | 'right' (default 'right')
 *   width: px (default 200)
 *   children: ({ open, toggle, btnRef }) => trigger node
 */
export function Menu({ items = [], align = 'right', width = 200, children }) {
  const [open, setOpen] = useState(false)
  // focusedIndex — индекс в items (не в actionable-подмножестве): -1 = нет фокуса
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef(null)
  const btnRef = useRef(null)

  const isActionable = it => !it.divider && !it.header
  const nextActionable = (from, dir) => {
    if (!items.some(isActionable)) return -1
    let i = from
    for (let step = 0; step < items.length; step++) {
      i = (i + dir + items.length) % items.length
      if (isActionable(items[i])) return i
    }
    return -1
  }

  const close = () => {
    setOpen(false)
    setFocusedIndex(-1)
  }

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        btnRef.current?.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(prev => nextActionable(prev, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(prev => nextActionable(prev < 0 ? items.length : prev, -1))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length])

  useEffect(() => {
    if (focusedIndex < 0 || !ref.current) return
    ref.current.querySelector(`[data-menu-index="${focusedIndex}"]`)?.focus()
  }, [focusedIndex])

  const toggle = e => {
    e?.stopPropagation()
    if (open) close()
    else setOpen(true)
  }

  return (
    <div ref={ref} className="menu-root">
      {children({ open, toggle, btnRef })}
      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className={`menu-dropdown${align === 'right' ? ' right' : ''}`}
          style={{ width }}
        >
          {items.map((item, i) => {
            if (item.divider) return <div key={`d${i}`} role="separator" className="menu-divider" />
            if (item.header)
              return (
                <div key={`h${i}`} className="menu-header">
                  {item.header}
                </div>
              )
            const Icon = item.icon
            return (
              <button
                key={i}
                role="menuitem"
                data-menu-index={i}
                tabIndex={focusedIndex === i ? 0 : -1}
                onClick={() => {
                  close()
                  item.onClick?.()
                }}
                className={`menu-item${item.danger ? ' danger' : ''}`}
              >
                {Icon && <Icon size={14} className="menu-item-icon" aria-hidden="true" />}
                <span className="menu-item-label">{item.label}</span>
                {item.hint && <kbd className="menu-item-hint">{item.hint}</kbd>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Menu
