import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
})
