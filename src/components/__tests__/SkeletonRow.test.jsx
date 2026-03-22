import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SkeletonRow, SkeletonRows } from '../SkeletonRow'

describe('SkeletonRow', () => {
  it('renders with default columns', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>
    )

    const row = container.querySelector('tr')
    expect(row).toBeInTheDocument()

    const cells = container.querySelectorAll('td')
    expect(cells).toHaveLength(6) // default cols
  })

  it('renders with custom column count', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow cols={3} />
        </tbody>
      </table>
    )

    const cells = container.querySelectorAll('td')
    expect(cells).toHaveLength(3)
  })

  it('renders skeleton shimmer divs', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow cols={2} />
        </tbody>
      </table>
    )

    const shimmerDivs = container.querySelectorAll('td > div')
    expect(shimmerDivs).toHaveLength(2)

    // Check that shimmer divs have animation
    shimmerDivs.forEach(div => {
      expect(div.style.animation).toContain('skeleton-shimmer')
    })
  })

  it('applies varying widths to skeleton cells', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow cols={6} />
        </tbody>
      </table>
    )

    const shimmerDivs = container.querySelectorAll('td > div')
    const widths = Array.from(shimmerDivs).map(div => div.style.width)

    // Should have different widths
    expect(new Set(widths).size).toBeGreaterThan(1)
  })
})

describe('SkeletonRows', () => {
  it('renders default number of rows', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRows />
        </tbody>
      </table>
    )

    const rows = container.querySelectorAll('tr')
    expect(rows).toHaveLength(5) // default count
  })

  it('renders custom number of rows', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRows count={3} />
        </tbody>
      </table>
    )

    const rows = container.querySelectorAll('tr')
    expect(rows).toHaveLength(3)
  })

  it('passes cols prop to each row', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRows count={2} cols={4} />
        </tbody>
      </table>
    )

    const rows = container.querySelectorAll('tr')
    expect(rows).toHaveLength(2)

    rows.forEach(row => {
      const cells = row.querySelectorAll('td')
      expect(cells).toHaveLength(4)
    })
  })
})
