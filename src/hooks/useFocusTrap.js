import { useEffect } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * #34 — Focus trap hook.
 * Traps Tab/Shift+Tab inside ref.current while isActive is true.
 * Auto-focuses the first focusable element on activation.
 *
 * @param {React.RefObject} ref  - ref to the container element
 * @param {boolean}         isActive - whether the trap is active
 */
export function useFocusTrap(ref, isActive) {
  useEffect(() => {
    if (!isActive || !ref.current) return

    const el = ref.current
    const getNodes = () =>
      [...el.querySelectorAll(FOCUSABLE)].filter(n => !n.disabled && n.offsetParent !== null)

    // Auto-focus first element
    const nodes = getNodes()
    if (nodes.length) {
      requestAnimationFrame(() => nodes[0].focus())
    }

    const handleKeyDown = e => {
      if (e.key !== 'Tab') return
      // FIX P2-12: Get fresh nodes on each keydown (not stale closure)
      const focusable = getNodes()
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
    }
  }, [ref, isActive])
}
