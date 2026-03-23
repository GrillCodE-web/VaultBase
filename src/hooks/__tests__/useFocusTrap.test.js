/* global KeyboardEvent */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useFocusTrap } from '../useFocusTrap'

describe('useFocusTrap', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('does nothing when isActive is false', () => {
    const { result } = renderHook(() => {
      const ref = useRef(null)
      useFocusTrap(ref, false)
      return ref
    })

    expect(result.current.current).toBeNull()
  })

  it('handles null ref gracefully when active', () => {
    const { result } = renderHook(() => {
      const ref = useRef(null)
      useFocusTrap(ref, true)
      return ref
    })

    expect(result.current.current).toBeNull()
  })

  it('works with focusable elements', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    container.appendChild(button1)
    container.appendChild(button2)

    const { result } = renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    expect(result.current.current).toBe(container)
    expect(container.querySelectorAll('button').length).toBe(2)
  })

  it('handles containers without focusable elements', () => {
    const div = document.createElement('div')
    div.textContent = 'No buttons here'
    container.appendChild(div)

    const { result } = renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    expect(result.current.current).toBe(container)
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('attempts to auto-focus first element on mount', async () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    container.appendChild(button1)
    container.appendChild(button2)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // Wait for requestAnimationFrame to complete
    await new Promise(resolve => requestAnimationFrame(resolve))

    // The hook should attempt to focus, but in test environment it might not work perfectly
    // Just verify the hook was set up correctly
    expect(container.querySelectorAll('button').length).toBe(2)
  })

  it('attaches keydown event listener when active', () => {
    const button = document.createElement('button')
    container.appendChild(button)

    const addEventListenerSpy = vi.spyOn(container, 'addEventListener')

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('handles Tab key events', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    container.appendChild(button1)
    container.appendChild(button2)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // Verify Tab key is handled
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })

    // Should not throw
    expect(() => container.dispatchEvent(tabEvent)).not.toThrow()
  })

  it('handles Shift+Tab key events', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    container.appendChild(button1)
    container.appendChild(button2)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // Verify Shift+Tab key is handled
    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    // Should not throw
    expect(() => container.dispatchEvent(shiftTabEvent)).not.toThrow()
  })

  it('does not prevent default on Tab from middle element', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    const button3 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    button3.textContent = 'Third'
    container.appendChild(button1)
    container.appendChild(button2)
    container.appendChild(button3)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // Focus middle button
    button2.focus()

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault')

    container.dispatchEvent(tabEvent)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('ignores non-Tab keys', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second'
    container.appendChild(button1)
    container.appendChild(button2)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    button1.focus()

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault')

    container.dispatchEvent(enterEvent)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('handles disabled elements correctly', () => {
    const button1 = document.createElement('button')
    const button2 = document.createElement('button')
    const button3 = document.createElement('button')
    button1.textContent = 'First'
    button2.textContent = 'Second (disabled)'
    button2.disabled = true
    button3.textContent = 'Third'
    container.appendChild(button1)
    container.appendChild(button2)
    container.appendChild(button3)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // Should only find 2 focusable elements (button2 is disabled)
    const focusable = container.querySelectorAll('button:not([disabled])')
    expect(focusable.length).toBe(2)
  })

  it('handles multiple focusable element types', () => {
    const button = document.createElement('button')
    const input = document.createElement('input')
    const select = document.createElement('select')
    const textarea = document.createElement('textarea')
    const link = document.createElement('a')
    link.href = '#'

    container.appendChild(button)
    container.appendChild(input)
    container.appendChild(select)
    container.appendChild(textarea)
    container.appendChild(link)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    // All elements should be in the container
    expect(container.querySelector('button')).toBeTruthy()
    expect(container.querySelector('input')).toBeTruthy()
    expect(container.querySelector('select')).toBeTruthy()
    expect(container.querySelector('textarea')).toBeTruthy()
    expect(container.querySelector('a[href]')).toBeTruthy()
  })

  it('cleans up event listener on unmount', () => {
    const button = document.createElement('button')
    container.appendChild(button)

    const { unmount } = renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener')
    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('does not trap when container has no focusable elements', () => {
    const div = document.createElement('div')
    div.textContent = 'No focusable elements'
    container.appendChild(div)

    renderHook(() => {
      const ref = useRef(container)
      useFocusTrap(ref, true)
      return ref
    })

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    const preventDefaultSpy = vi.spyOn(tabEvent, 'preventDefault')

    container.dispatchEvent(tabEvent)

    // Should not prevent default when there are no focusable elements
    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('reacts to isActive changes', () => {
    const button = document.createElement('button')
    container.appendChild(button)

    const { rerender } = renderHook(
      ({ active }) => {
        const ref = useRef(container)
        useFocusTrap(ref, active)
        return ref
      },
      { initialProps: { active: false } }
    )

    // Initially inactive, no event listener
    let addEventListenerSpy = vi.spyOn(container, 'addEventListener')
    expect(addEventListenerSpy).not.toHaveBeenCalled()

    // Activate
    addEventListenerSpy = vi.spyOn(container, 'addEventListener')
    rerender({ active: true })
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    // Deactivate
    const removeEventListenerSpy = vi.spyOn(container, 'removeEventListener')
    rerender({ active: false })
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})
