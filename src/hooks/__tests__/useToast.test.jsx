import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ToastProvider, useToast } from '../useToast'

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
})
