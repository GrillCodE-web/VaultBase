import { describe, it, expect, vi } from 'vitest'
import { parseCSVRow, escapeCsvValue, toCsvRow, exportToCSV } from '../csv.js'

describe('CSV Utilities', () => {
  describe('parseCSVRow', () => {
    it('parses simple CSV row', () => {
      expect(parseCSVRow('a,b,c')).toEqual(['a', 'b', 'c'])
    })

    it('handles quoted fields with commas', () => {
      expect(parseCSVRow('"Smith, John",25,"New York, NY"')).toEqual([
        'Smith, John',
        '25',
        'New York, NY',
      ])
    })

    it('handles empty fields', () => {
      expect(parseCSVRow('a,,c')).toEqual(['a', '', 'c'])
    })

    it('handles quoted fields', () => {
      expect(parseCSVRow('"Hello World",test')).toEqual(['Hello World', 'test'])
    })
  })

  describe('escapeCsvValue', () => {
    it('wraps value in quotes', () => {
      expect(escapeCsvValue('hello')).toBe('"hello"')
    })

    it('escapes double quotes', () => {
      expect(escapeCsvValue('Say "Hello"')).toBe('"Say ""Hello"""')
    })

    it('handles null values', () => {
      expect(escapeCsvValue(null)).toBe('""')
    })

    it('handles undefined values', () => {
      expect(escapeCsvValue(undefined)).toBe('""')
    })

    it('handles numbers', () => {
      expect(escapeCsvValue(123)).toBe('"123"')
    })

    it('handles commas in values', () => {
      expect(escapeCsvValue('Last, First')).toBe('"Last, First"')
    })
  })

  describe('toCsvRow', () => {
    it('converts array to CSV row', () => {
      expect(toCsvRow(['a', 'b', 'c'])).toBe('"a","b","c"')
    })

    it('handles mixed types', () => {
      expect(toCsvRow(['text', 123, null])).toBe('"text","123",""')
    })
  })

  describe('exportToCSV', () => {
    it('creates CSV blob and triggers download', () => {
      // Mock DOM methods
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url')
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const clickMock = vi.fn()

      document.createElement = vi.fn(() => ({
        href: '',
        download: '',
        click: clickMock,
      }))

      exportToCSV('test.csv', '"Name","Status"', [['"John"', '"free"']])

      expect(createObjectURL).toHaveBeenCalled()
      expect(clickMock).toHaveBeenCalled()

      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
    })

    it('handles empty rows', () => {
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url')
      const clickMock = vi.fn()

      document.createElement = vi.fn(() => ({
        href: '',
        download: '',
        click: clickMock,
      }))

      exportToCSV('empty.csv', '"Header"', [])

      expect(clickMock).toHaveBeenCalled()

      createObjectURL.mockRestore()
    })
  })

  describe('Security: CSV injection prevention', () => {
    it('escapes formula characters to prevent CSV injection', () => {
      // Values starting with = + - @ could be dangerous in CSV
      expect(escapeCsvValue('=SUM(A1:A10)')).toBe('"=SUM(A1:A10)"')
      expect(escapeCsvValue('+123')).toBe('"+123"')
      expect(escapeCsvValue('@ERROR')).toBe('"@ERROR"')
    })

    it('escapes newlines to prevent row injection', () => {
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"')
    })
  })
})
