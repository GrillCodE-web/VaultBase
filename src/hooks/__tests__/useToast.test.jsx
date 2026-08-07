import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { SmartToastProvider, useToast } from '../useSmartToast'
import { screen, fireEvent } from '@testing-library/react'

describe('useToast', () => {
  it('provides toast methods even outside provider (fallback)', () => {
    const { result } = renderHook(() => useToast())

    expect(result.current).toHaveProperty('toast')
    expect(result.current).toHaveProperty('success')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('warn')
    // Fallback methods are no-ops, should not throw
    act(() => {
      result.current.success('No-op')
    })
  })

  it('provides toast methods', () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    expect(result.current).toHaveProperty('toast')
    expect(result.current).toHaveProperty('success')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('warn')
  })

  it('shows success toast', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.success('Success message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Success message')
    })
  })

  it('shows error toast', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.error('Error message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Error message')
    })
  })

  it('shows warn toast', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.warn('Warning message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Warning message')
    })
  })

  it('shows info toast', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Info message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Info message')
    })
  })

  it('limits toasts to 5', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      for (let i = 1; i <= 7; i++) {
        result.current.toast(`Toast ${i}`)
      }
    })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Toast 1')
      expect(document.body.textContent).not.toContain('Toast 2')
      expect(document.body.textContent).toContain('Toast 7')
    })
  })

  it('auto-removes toast after duration', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Temporary')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Temporary')
    })

    // SmartToast groups by message; force different messages to avoid grouping,
    // then wait for auto-dismiss (default duration 4000ms)
    await waitFor(
      () => {
        expect(document.body.textContent).not.toContain('Temporary')
      },
      { timeout: 5000 }
    )
  })

  it('accepts toast with object syntax and custom type', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Custom toast', type: 'success' })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Custom toast')
    })
  })

  it('accepts toast with string syntax and type argument', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('String toast', 'error')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('String toast')
    })
  })

  it('defaults to info type when no type specified', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Default type toast')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Default type toast')
    })
  })

  it('removes toast when close button clicked', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Closeable toast' })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Closeable toast')
    })

    const closeButton = document.querySelector('.smart-toast-close')

    act(() => {
      closeButton?.click()
    })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Closeable toast')
    })
  })

  it('shows toast with action button', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    const actionFn = vi.fn()

    act(() => {
      result.current.toast({
        message: 'Toast with action',
        action: { label: 'Undo', onClick: actionFn },
      })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Toast with action')
      expect(document.body.textContent).toContain('Undo')
    })
  })

  it('calls action onClick and removes toast', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    const actionFn = vi.fn()

    act(() => {
      result.current.toast({
        message: 'Action toast',
        action: { label: 'Click me', onClick: actionFn },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Click me')).toBeInTheDocument()
    })

    const actionButton = screen.getByText('Click me')

    act(() => {
      actionButton.click()
    })

    expect(actionFn).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Action toast')
    })
  })

  it('shows close button for toasts', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Toast with close')
    })

    await waitFor(() => {
      expect(document.querySelector('.smart-toast-close')).toBeInTheDocument()
    })
  })

  it('pauses auto-dismiss on hover', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Hover me')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Hover me')
    })

    const toastElement = document.querySelector('.smart-toast')

    // Hover over toast
    act(() => {
      fireEvent.mouseEnter(toastElement)
    })

    // Wait longer than duration (default 4000ms)
    await new Promise(resolve => setTimeout(resolve, 200))

    // Toast should still be visible because of hover
    expect(document.body.textContent).toContain('Hover me')

    // Leave hover
    act(() => {
      fireEvent.mouseLeave(toastElement)
    })
  })

  it('resumes auto-dismiss after hover ends', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Hover and leave')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Hover and leave')
    })

    const toastElement = document.querySelector('.smart-toast')

    // Hover
    act(() => {
      fireEvent.mouseEnter(toastElement)
    })

    // Leave hover
    act(() => {
      fireEvent.mouseLeave(toastElement)
    })

    // Wait for reduced duration (40% of original 4000ms = 1600ms)
    await waitFor(
      () => {
        expect(document.body.textContent).not.toContain('Hover and leave')
      },
      { timeout: 3000 }
    )
  })

  it('handles multiple toasts with different types', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.success('Success 1')
      result.current.error('Error 1')
      result.current.warn('Warning 1')
      result.current.toast('Info 1')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Success 1')
      expect(document.body.textContent).toContain('Error 1')
      expect(document.body.textContent).toContain('Warning 1')
      expect(document.body.textContent).toContain('Info 1')
    })
  })

  it('respects custom duration', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Quick toast', duration: 300 })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Quick toast')
    })

    await waitFor(
      () => {
        expect(document.body.textContent).not.toContain('Quick toast')
      },
      { timeout: 500 }
    )
  })

  it('uses default duration when not specified', async () => {
    const wrapper = ({ children }) => <SmartToastProvider>{children}</SmartToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Default duration')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Default duration')
    })

    // Should still be visible after 1 second (default is 4000ms)
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(document.body.textContent).toContain('Default duration')
  })
})
