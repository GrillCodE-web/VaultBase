import { useState, useRef, useEffect } from 'react'
import { MoreHorizontal } from 'lucide-react'

/**
 * ActionsMenu — contextual ⋮ dropdown for table row actions.
 *
 * Props:
 *   items: Array<{ label, icon: LucideComponent, onClick, danger?, divider? }>
 *   align: "left" | "right" (default "right")
 */
export function ActionsMenu({ items = [], align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef(null)
  const btnRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Keyboard navigation within menu
  useEffect(() => {
    if (!open) return
    const handleKeyDown = e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex(prev => Math.min(prev + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex(prev => Math.max(prev - 1, 0))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setFocusedIndex(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setFocusedIndex(items.length - 1)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, items.length])

  // Focus the focused item
  useEffect(() => {
    if (focusedIndex >= 0 && ref.current) {
      const items = ref.current.querySelectorAll('[role="menuitem"]')
      items[focusedIndex]?.focus()
    }
  }, [focusedIndex])

  const toggle = e => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 4,
        left: align === 'right' ? rect.right - 160 : rect.left,
      })
    }
    setOpen(v => !v)
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        onClick={toggle}
        onKeyDown={e => {
          if (open && e.key === 'ArrowDown') {
            e.preventDefault()
            const firstItem = ref.current?.querySelector('[role="menuitem"]')
            firstItem?.focus()
          }
        }}
        className="btn btn-ghost btn-sm btn-icon-only w-[26px] h-[26px]"
        title="Actions"
        aria-label="Open actions menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <MoreHorizontal size={16} className="icon-md" />
      </button>

      {open && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="actions-dropdown fixed w-40 bg-card-hi border border-border-hi rounded-md overflow-hidden"
          style={{
            top: pos.top,
            left: pos.left,
            zIndex: 'var(--z-dropdown)',
          }}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return (
                <div
                  key={`sep-${i}`}
                  role="separator"
                  className="actions-divider h-px bg-border my-[3px]"
                />
              )
            }
            const Icon = item.icon
            return (
              <button
                key={i}
                role="menuitem"
                tabIndex={focusedIndex === i ? 0 : -1}
                onClick={e => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onClick?.()
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setOpen(false)
                    btnRef.current?.focus()
                  }
                }}
                className={`actions-menu-item w-full p-[7px_12px] border-none bg-transparent text-left cursor-pointer text-[12px] flex items-center gap-2 ${item.danger ? 'text-red-t' : 'text-text'} ${focusedIndex === i ? 'bg-hover' : ''}`}
              >
                {Icon && <Icon size={14} className="icon-sm flex-shrink-0 opacity-80" />}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
