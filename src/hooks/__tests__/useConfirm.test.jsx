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

  it('accepts string as title shorthand', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Are you sure?', 'Custom Title')
    })

    await waitFor(() => {
      expect(screen.getByText('Custom Title')).toBeInTheDocument()
      expect(screen.getByText('Are you sure?')).toBeInTheDocument()
    })
  })

  it('handles multiple sequential confirms', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    // First confirm
    let result1
    act(() => {
      result.current.confirm('First confirm?').then(res => {
        result1 = res
      })
    })

    await screen.findByRole('dialog')
    expect(screen.getByText('First confirm?')).toBeInTheDocument()

    const confirmButton1 = screen.getByRole('button', { name: 'Confirm' })
    act(() => {
      confirmButton1.click()
    })

    await waitFor(() => {
      expect(result1).toBe(true)
    })

    // Second confirm
    let result2
    act(() => {
      result.current.confirm('Second confirm?').then(res => {
        result2 = res
      })
    })

    await screen.findByRole('dialog')
    expect(screen.getByText('Second confirm?')).toBeInTheDocument()

    const cancelButton2 = screen.getByRole('button', { name: 'Cancel' })
    act(() => {
      cancelButton2.click()
    })

    await waitFor(() => {
      expect(result2).toBe(false)
    })
  })

  it('returns a promise that resolves', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    let promiseResolved = false
    let resolvedValue

    act(() => {
      result.current.confirm('Test promise?').then(value => {
        promiseResolved = true
        resolvedValue = value
      })
    })

    await screen.findByRole('dialog')

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    act(() => {
      confirmButton.click()
    })

    await waitFor(() => {
      expect(promiseResolved).toBe(true)
      expect(resolvedValue).toBe(true)
    })
  })

  it('closes dialog after confirm', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Close after confirm?')
    })

    await screen.findByRole('dialog')

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    act(() => {
      confirmButton.click()
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('closes dialog after cancel', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Close after cancel?')
    })

    await screen.findByRole('dialog')

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    act(() => {
      cancelButton.click()
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('shows correct aria attributes', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Test aria?')
    })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-message')
  })

  it('uses default labels when not specified', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Default labels?')
    })

    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('uses default title when not specified', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Message only')
    })

    await screen.findByRole('dialog')

    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByText('Message only')).toBeInTheDocument()
  })

  it('handles danger false explicitly', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Not dangerous', { danger: false })
    })

    await screen.findByRole('dialog')

    const confirmButton = screen.getByRole('button', { name: 'Confirm' })
    const bgColor = confirmButton.style.background

    // Should be blue, not red
    expect(bgColor).toMatch(/#3b82f6|rgb\(59,\s*130,\s*246\)/i)
  })

  it('handles empty options object', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('Empty options', {})
    })

    await screen.findByRole('dialog')

    expect(screen.getByRole('heading', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByText('Empty options')).toBeInTheDocument()
  })

  it('handles all custom options together', async () => {
    const wrapper = ({ children }) => <ConfirmProvider>{children}</ConfirmProvider>
    const { result } = renderHook(() => useConfirm(), { wrapper })

    act(() => {
      result.current.confirm('All custom', {
        title: 'Custom Title',
        danger: true,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
      })
    })

    await screen.findByRole('dialog')

    expect(screen.getByText('Custom Title')).toBeInTheDocument()
    expect(screen.getByText('All custom')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Keep')).toBeInTheDocument()
  })
})
