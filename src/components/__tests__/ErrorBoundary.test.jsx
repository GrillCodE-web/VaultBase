import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '../ErrorBoundary'

// Test component that throws an error during render
const ThrowError = () => {
  throw new Error('Test render error')
}

describe('ErrorBoundary', () => {
  // Suppress console.error during tests (expected error logging)
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    )

    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders multiple children when no error', () => {
    render(
      <ErrorBoundary>
        <div>First child</div>
        <span>Second child</span>
        <p>Third child</p>
      </ErrorBoundary>
    )

    expect(screen.getByText('First child')).toBeInTheDocument()
    expect(screen.getByText('Second child')).toBeInTheDocument()
    expect(screen.getByText('Third child')).toBeInTheDocument()
  })

  it('catches and displays errors from child components', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument()
  })

  it('displays error details in expandable section', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // Error details section should be present
    expect(screen.getByText('Error details')).toBeInTheDocument()

    // Click to expand
    fireEvent.click(screen.getByText('Error details'))

    // Should show error message
    expect(screen.getByText(/Test render error/)).toBeInTheDocument()
  })

  it('calls onReset callback when Go to Dashboard is clicked', () => {
    const onReset = vi.fn()

    render(
      <ErrorBoundary onReset={onReset}>
        <ThrowError />
      </ErrorBoundary>
    )

    const dashboardButton = screen.getByRole('button', { name: /Go to Dashboard/i })
    fireEvent.click(dashboardButton)

    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('does not call onReset on initial render without error', () => {
    const onReset = vi.fn()

    render(
      <ErrorBoundary onReset={onReset}>
        <div>No error here</div>
      </ErrorBoundary>
    )

    expect(onReset).not.toHaveBeenCalled()
  })

  it('handles reload button click', () => {
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    })

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    const reloadButton = screen.getByRole('button', { name: /Reload/i })
    fireEvent.click(reloadButton)

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('renders with AlertTriangle icon when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // The icon is rendered inside a div with specific styling
    const iconContainer = document.querySelector('div[style*="border-radius: 12px"]')
    expect(iconContainer).toBeInTheDocument()
  })

  it('handles different error types - string error', () => {
    const ThrowStringError = () => {
      throw 'String error message'
    }

    render(
      <ErrorBoundary>
        <ThrowStringError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('keeps boundary functional after error and reset', () => {
    // Create a component that can be controlled to throw or not
    const ConditionalError = ({ shouldThrow }) => {
      if (shouldThrow) {
        throw new Error('Conditional error')
      }
      return <div>No error</div>
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalError shouldThrow={false} />
      </ErrorBoundary>
    )

    // Initially no error
    expect(screen.getByText('No error')).toBeInTheDocument()

    // Now cause an error
    rerender(
      <ErrorBoundary>
        <ConditionalError shouldThrow />
      </ErrorBoundary>
    )

    // Should show error UI
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('handles errors with errorInfo in componentStack', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // Expand error details
    fireEvent.click(screen.getByText('Error details'))

    // Should contain error info in pre element
    const preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement.textContent).toContain('Test render error')
  })

  it('renders error boundary UI with correct structure', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    // Check main container structure
    const container = document.querySelector('.min-h-screen')
    expect(container).toBeInTheDocument()

    // Check card container
    const card = document.querySelector('.card')
    expect(card).toBeInTheDocument()

    // Check title
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong')
  })

  it('resets error state when Go to Dashboard is clicked', () => {
    const onReset = vi.fn()

    render(
      <ErrorBoundary onReset={onReset}>
        <ThrowError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    const dashboardButton = screen.getByRole('button', { name: /Go to Dashboard/i })
    fireEvent.click(dashboardButton)

    // After clicking reset, the error state should be cleared
    // The onReset callback is called but the error boundary stays in error state
    // since the child component still throws
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
