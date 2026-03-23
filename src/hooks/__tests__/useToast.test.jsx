import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ToastProvider, useToast } from '../useToast'
import { screen, fireEvent } from '@testing-library/react'

describe('useToast', () => {
  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useToast())
    }).toThrow('useToast must be used inside <ToastProvider>')
  })

  it('provides toast methods', () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    expect(result.current).toHaveProperty('toast')
    expect(result.current).toHaveProperty('success')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('warn')
    expect(result.current).toHaveProperty('info')
  })

  it('shows success toast', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.success('Success message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Success message')
    })
  })

  it('shows error toast', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.error('Error message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Error message')
    })
  })

  it('shows warn toast', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.warn('Warning message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Warning message')
    })
  })

  it('shows info toast', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.info('Info message')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Info message')
    })
  })

  it('limits toasts to 5', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      for (let i = 1; i <= 7; i++) {
        result.current.info(`Toast ${i}`)
      }
    })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Toast 1')
      expect(document.body.textContent).not.toContain('Toast 2')
      expect(document.body.textContent).toContain('Toast 7')
    })
  })

  it('auto-removes toast after duration', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Temporary', duration: 500 })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Temporary')
    })

    // Wait for toast to be removed
    await waitFor(
      () => {
        expect(document.body.textContent).not.toContain('Temporary')
      },
      { timeout: 1000 }
    )
  })

  it('accepts toast with object syntax and custom type', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Custom toast', type: 'success' })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Custom toast')
    })
  })

  it('accepts toast with string syntax and type argument', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('String toast', 'error')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('String toast')
    })
  })

  it('defaults to info type when no type specified', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast('Default type toast')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Default type toast')
    })
  })

  it('removes toast when clicked (without action)', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.info('Click to dismiss')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Click to dismiss')
    })

    // Find and click the toast
    const toastRegion = screen.getByRole('region', { name: 'Notifications' })
    const toastElement = toastRegion.querySelector('div[style*="cursor: pointer"]')

    act(() => {
      toastElement?.click()
    })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Click to dismiss')
    })
  })

  it('shows toast with action button', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
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
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
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

  it('shows close button for toasts with actions', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({
        message: 'Toast with close',
        action: { label: 'Action', onClick: () => {} },
      })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('✕')
    })
  })

  it('removes toast when close button clicked', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({
        message: 'Closeable toast',
        action: { label: 'Action', onClick: () => {} },
      })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Closeable toast')
    })

    const closeButton = screen.getByText('✕')

    act(() => {
      closeButton.click()
    })

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Closeable toast')
    })
  })

  it('pauses auto-dismiss on hover', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Hover me', duration: 500 })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Hover me')
    })

    const toastRegion = screen.getByRole('region', { name: 'Notifications' })
    const toastElement = toastRegion.querySelector('div[style*="cursor"]')

    // Hover over toast
    act(() => {
      fireEvent.mouseEnter(toastElement)
    })

    // Wait longer than duration
    await new Promise(resolve => setTimeout(resolve, 600))

    // Toast should still be visible because of hover
    expect(document.body.textContent).toContain('Hover me')

    // Leave hover
    act(() => {
      fireEvent.mouseLeave(toastElement)
    })
  })

  it('resumes auto-dismiss after hover ends', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.toast({ message: 'Hover and leave', duration: 500 })
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Hover and leave')
    })

    const toastRegion = screen.getByRole('region', { name: 'Notifications' })
    const toastElement = toastRegion.querySelector('div[style*="cursor"]')

    // Hover
    act(() => {
      fireEvent.mouseEnter(toastElement)
    })

    // Leave hover
    act(() => {
      fireEvent.mouseLeave(toastElement)
    })

    // Wait for reduced duration (40% of original)
    await waitFor(
      () => {
        expect(document.body.textContent).not.toContain('Hover and leave')
      },
      { timeout: 500 }
    )
  })

  it('handles multiple toasts with different types', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.success('Success 1')
      result.current.error('Error 1')
      result.current.warn('Warning 1')
      result.current.info('Info 1')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Success 1')
      expect(document.body.textContent).toContain('Error 1')
      expect(document.body.textContent).toContain('Warning 1')
      expect(document.body.textContent).toContain('Info 1')
    })
  })

  it('respects custom duration', async () => {
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
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
    const wrapper = ({ children }) => <ToastProvider>{children}</ToastProvider>
    const { result } = renderHook(() => useToast(), { wrapper })

    act(() => {
      result.current.info('Default duration')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Default duration')
    })

    // Should still be visible after 1 second (default is 3500ms)
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(document.body.textContent).toContain('Default duration')
  })
})
