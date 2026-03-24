import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders with basic props', () => {
    render(<EmptyState icon="📦" title="No items" />)

    expect(screen.getByText('📦')).toBeInTheDocument()
    expect(screen.getByText('No items')).toBeInTheDocument()
  })

  it('renders with subtitle', () => {
    render(<EmptyState icon="🔍" title="No results" subtitle="Try adjusting your filters" />)

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument()
  })

  it('renders with action button', () => {
    const action = <button>Add Item</button>
    render(<EmptyState icon="➕" title="Empty" action={action} />)

    expect(screen.getByText('Add Item')).toBeInTheDocument()
  })

  it('renders as table row when colSpan provided', () => {
    const { container } = render(
      <table>
        <tbody>
          <EmptyState icon="📭" title="Empty" colSpan={5} />
        </tbody>
      </table>
    )

    const tr = container.querySelector('tr')
    const td = container.querySelector('td')

    expect(tr).toBeInTheDocument()
    expect(td).toBeInTheDocument()
    expect(td.getAttribute('colspan')).toBe('5')
  })

  it('renders as standalone div when no colSpan', () => {
    const { container } = render(<EmptyState icon="📋" title="No data" />)

    const tr = container.querySelector('tr')
    expect(tr).not.toBeInTheDocument()

    // Should render the inner div directly
    expect(screen.getByText('📋')).toBeInTheDocument()
  })

  it('renders all elements together', () => {
    const action = <button>Create New</button>
    render(
      <EmptyState
        icon="🎯"
        title="Get Started"
        subtitle="Create your first item to begin"
        action={action}
      />
    )

    expect(screen.getByText('🎯')).toBeInTheDocument()
    expect(screen.getByText('Get Started')).toBeInTheDocument()
    expect(screen.getByText('Create your first item to begin')).toBeInTheDocument()
    expect(screen.getByText('Create New')).toBeInTheDocument()
  })

  it('applies correct styling structure', () => {
    const { container } = render(<EmptyState icon="✨" title="Test" />)

    const outerDiv = container.querySelector('div')
    expect(outerDiv).toHaveClass('flex')
    expect(outerDiv).toHaveClass('flex-col')
    expect(outerDiv).toHaveClass('items-center')
    expect(outerDiv).toHaveClass('justify-center')
  })
})
