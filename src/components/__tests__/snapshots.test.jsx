import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EmptyState } from '../EmptyState'
import { LoadingSpinner, LoadingDots, ProgressBar } from '../LoadingSpinner'
import { SkeletonRow, SkeletonRows } from '../SkeletonRow'

// TEST-011: snapshot-тесты для базовых UI-компонентов.
// Любое изменение разметки/классов этих компонентов сломает снапшот —
// обновление только осознанное: npx vitest run -u

describe('EmptyState snapshots', () => {
  it('standalone', () => {
    const { container } = render(<EmptyState icon="📦" title="No items" />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('with subtitle and action', () => {
    const { container } = render(
      <EmptyState
        icon="🔍"
        title="No results"
        subtitle="Try adjusting filters"
        action={<button>Add</button>}
      />
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  it('as table row', () => {
    const { container } = render(
      <table><tbody><EmptyState icon="📭" title="Empty" colSpan={5} /></tbody></table>
    )
    expect(container.firstChild).toMatchSnapshot()
  })
})

describe('LoadingSpinner snapshots', () => {
  it('default', () => {
    const { container } = render(<LoadingSpinner />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('custom size and color', () => {
    const { container } = render(<LoadingSpinner size={40} color="red" label="Loading cards" />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('dots', () => {
    const { container } = render(<LoadingDots />)
    expect(container.firstChild).toMatchSnapshot()
  })
})

describe('ProgressBar snapshots', () => {
  it('half with label', () => {
    const { container } = render(<ProgressBar progress={50} showLabel />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('clamped over 100', () => {
    const { container } = render(<ProgressBar progress={150} />)
    expect(container.firstChild).toMatchSnapshot()
  })
})

describe('SkeletonRow snapshots', () => {
  it('single row, 3 cols', () => {
    const { container } = render(
      <table><tbody><SkeletonRow cols={3} /></tbody></table>
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  it('multiple rows', () => {
    const { container } = render(
      <table><tbody><SkeletonRows count={3} cols={4} /></tbody></table>
    )
    expect(container.firstChild).toMatchSnapshot()
  })
})
