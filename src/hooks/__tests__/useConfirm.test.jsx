import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ConfirmProvider, useConfirm } from '../useConfirm'
import { screen } from '@testing-library/react'

describe('useConfirm', () => {
  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useConfirm())
    }).toThrow('useConfirm must be used inside <ConfirmProvider>')
  })

  it('provides confirm method', () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    expect(result.current).toHaveProperty('confirm')
    expect(typeof result.current.confirm).toBe('function')
  })

  it('shows confirmation dialog', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Are you sure?')
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    })
  })

  it('resolves true when confirmed', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    let confirmResult
    let confirmPromise

    act(() => {
      confirmPromise = result.current.confirm('Delete item?')
      confirmPromise.then(res => {
        confirmResult = res
      })
    })

    // Wait for dialog to appear
    await screen.findByRole('dialog')

    // Click confirm button (use role to avoid ambiguity)
    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    act(() => {
      confirmButton.click()
    })

    // Wait for promise to resolve
    await confirmPromise
    expect(confirmResult).toBe(true)
  })

  it('resolves false when cancelled', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    let confirmResult
    act(() => {
      result.current.confirm('Delete item?').then(res => {
        confirmResult = res
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    const cancelButton = screen.getByText('Cancel')
    act(() => {
      cancelButton.click()
    })

    await waitFor(() => {
      expect(confirmResult).toBe(false)
    })
  })

  it('accepts custom title', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Delete this?', { title: 'Warning' })
    })

    await waitFor(() => {
      expect(screen.getByText('Warning')).toBeInTheDocument()
    })
  })

  it('accepts custom button labels', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Proceed?', {
        confirmLabel: 'Yes',
        cancelLabel: 'No',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
    })
  })

  it('supports danger mode', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Delete permanently?', { danger: true })
    })

    // Wait for dialog to appear
    await screen.findByRole('dialog')

    // Verify button has red background (danger mode) - use role to avoid ambiguity with h3
    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmButton).toBeInTheDocument()

    const bgColor = confirmButton.style.background
    expect(bgColor).toBeTruthy()
    // Should contain red color (rgb(239, 68, 68) or #ef4444)
    expect(bgColor).toMatch(/rgb\(239,\s*68,\s*68\)|#ef4444/i)
  })
})
