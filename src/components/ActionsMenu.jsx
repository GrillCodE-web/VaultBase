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
        className="btn btn-ghost btn-sm btn-icon-only w-[26px] h-[26px]"
        title="Actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          className="fixed w-40 bg-card-hi border border-border-hi rounded-md overflow-hidden"
          style={{
            top: pos.top,
            left: pos.left,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 9999,
          }}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={i} className="h-px bg-border my-[3px]" />
            }
            const Icon = item.icon
            return (
              <button
                key={i}
                onClick={e => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onClick?.()
                }}
                className={`w-full p-[7px_12px] border-none bg-transparent text-left cursor-pointer text-[12px] flex items-center gap-2 ${item.danger ? 'text-red-t' : 'text-text'}`}
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  transition: 'background var(--t-fast)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--hover)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {Icon && <Icon size={13} className="flex-shrink-0 opacity-80" />}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
