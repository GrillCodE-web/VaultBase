import { describe, it, expect } from 'vitest'
import { buildPageNumbers } from '../pagination'

describe('buildPageNumbers', () => {
  it('returns all pages when total <= 7', () => {
    expect(buildPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(buildPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('shows ellipsis for large page counts', () => {
    expect(buildPageNumbers(1, 10)).toEqual([1, 2, '...', 10])
    expect(buildPageNumbers(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10])
    expect(buildPageNumbers(10, 10)).toEqual([1, '...', 9, 10])
  })

  it('handles current page near start', () => {
    expect(buildPageNumbers(2, 10)).toEqual([1, 2, 3, '...', 10])
    expect(buildPageNumbers(3, 10)).toEqual([1, 2, 3, 4, '...', 10])
  })

  it('handles current page near end', () => {
    expect(buildPageNumbers(8, 10)).toEqual([1, '...', 7, 8, 9, 10])
    expect(buildPageNumbers(9, 10)).toEqual([1, '...', 8, 9, 10])
  })

  it('handles current page in middle', () => {
    expect(buildPageNumbers(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10])
    expect(buildPageNumbers(6, 15)).toEqual([1, '...', 5, 6, 7, '...', 15])
  })

  it('handles edge cases', () => {
    expect(buildPageNumbers(1, 1)).toEqual([1])
    expect(buildPageNumbers(1, 2)).toEqual([1, 2])
  })
})
