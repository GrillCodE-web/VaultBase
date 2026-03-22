import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  countryFlag,
  normalizeExpiry,
  expiryDaysLeft,
  isCardExpired,
  formatCardNumber,
  formatBinMasked,
  buildPipeString,
  shortId,
  timeAgo,
  formatCurrency,
  formatNumber,
} from '../formatting'

describe('countryFlag', () => {
  it('converts valid country codes to flag emojis', () => {
    expect(countryFlag('US')).toBe('🇺🇸')
    expect(countryFlag('GB')).toBe('🇬🇧')
    expect(countryFlag('FR')).toBe('🇫🇷')
  })

  it('handles lowercase codes', () => {
    expect(countryFlag('us')).toBe('🇺🇸')
  })

  it('returns empty string for invalid codes', () => {
    expect(countryFlag('')).toBe('')
    expect(countryFlag('U')).toBe('')
    expect(countryFlag('USA')).toBe('')
    expect(countryFlag(null)).toBe('')
  })
})

describe('normalizeExpiry', () => {
  it('normalizes MMYY format', () => {
    expect(normalizeExpiry('1226')).toBe('12/26')
    expect(normalizeExpiry('0126')).toBe('01/26')
  })

  it('normalizes MM/YY format', () => {
    expect(normalizeExpiry('12/26')).toBe('12/26')
    expect(normalizeExpiry('1/26')).toBe('01/26')
  })

  it('normalizes MM/YYYY format', () => {
    expect(normalizeExpiry('12/2026')).toBe('12/26')
    expect(normalizeExpiry('1/2027')).toBe('01/27')
  })

  it('normalizes YYYY-MM ISO format', () => {
    expect(normalizeExpiry('2026-12')).toBe('12/26')
  })

  it('normalizes month name formats', () => {
    expect(normalizeExpiry('Jan 2026')).toBe('01/26')
    expect(normalizeExpiry('January 2026')).toBe('01/26')
    expect(normalizeExpiry('dec/26')).toBe('12/26')
  })

  it('returns null for invalid formats', () => {
    expect(normalizeExpiry('')).toBe(null)
    expect(normalizeExpiry('invalid')).toBe(null)
    // Note: normalizeExpiry doesn't validate month ranges, just normalizes format
    // Month validation happens in isValidExpiry
    expect(normalizeExpiry('abc/def')).toBe(null)
  })
})

describe('expiryDaysLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15'))
  })

  it('calculates days until expiry correctly', () => {
    const days = expiryDaysLeft('12/24')
    expect(days).toBeGreaterThan(150)
    expect(days).toBeLessThan(200)
  })

  it('returns negative for expired dates', () => {
    expect(expiryDaysLeft('01/24')).toBeLessThan(0)
  })

  it('returns null for invalid dates', () => {
    expect(expiryDaysLeft('')).toBe(null)
    expect(expiryDaysLeft('invalid')).toBe(null)
  })
})

describe('isCardExpired', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15'))
  })

  it('returns true for expired cards', () => {
    expect(isCardExpired('01/24')).toBe(true)
    expect(isCardExpired('12/23')).toBe(true)
  })

  it('returns false for valid cards', () => {
    expect(isCardExpired('12/24')).toBe(false)
    expect(isCardExpired('01/25')).toBe(false)
  })

  it('returns false for invalid dates', () => {
    expect(isCardExpired('')).toBe(false)
    expect(isCardExpired('invalid')).toBe(false)
  })
})

describe('formatCardNumber', () => {
  it('removes non-digit characters', () => {
    expect(formatCardNumber('1234-5678-9012-3456')).toBe('1234567890123456')
    expect(formatCardNumber('1234 5678 9012 3456')).toBe('1234567890123456')
    expect(formatCardNumber('1234abcd5678')).toBe('12345678')
  })

  it('handles already clean numbers', () => {
    expect(formatCardNumber('1234567890123456')).toBe('1234567890123456')
  })
})

describe('formatBinMasked', () => {
  it('formats with valid BIN and last4', () => {
    expect(formatBinMasked('123456', '7890')).toBe('123456****7890')
  })

  it('handles missing last4', () => {
    expect(formatBinMasked('123456', '')).toBe('123456****????')
    expect(formatBinMasked('123456', null)).toBe('123456****????')
  })

  it('handles invalid BIN', () => {
    expect(formatBinMasked('', '7890')).toBe('••••••••••••7890')
    expect(formatBinMasked('123', '7890')).toBe('••••••••••••7890')
  })
})

describe('buildPipeString', () => {
  it('builds pipe-delimited string with full data', () => {
    const card = {
      bin: '123456',
      last4: '7890',
      expiry_date: '12/25',
      holder_name: 'John Doe',
      zip: '10001',
      city: 'New York',
      state: 'NY',
      country: 'US',
    }
    const rev = {
      card_number: '1234567890123456',
      expiry_date: '12/25',
      cvv: '123',
      holder_name: 'John Doe',
      billing_address: '123 Main St',
      phone: '555-1234',
    }
    const result = buildPipeString(card, rev)
    expect(result).toBe(
      '1234567890123456|12/25|123|John Doe|123 Main St|10001|New York|NY|US|555-1234'
    )
  })

  it('handles missing revealed data', () => {
    const card = {
      bin: '123456',
      last4: '7890',
      expiry_date: '12/25',
    }
    const result = buildPipeString(card)
    expect(result).toContain('123456**7890')
    expect(result).toContain('12/25')
  })
})

describe('shortId', () => {
  it('returns last 8 characters uppercase', () => {
    expect(shortId('abcdef123456789')).toBe('23456789')
    expect(shortId('test-id-12345678')).toBe('12345678')
  })

  it('handles short IDs', () => {
    expect(shortId('abc')).toBe('ABC')
  })

  it('returns dash for empty ID', () => {
    expect(shortId('')).toBe('—')
    expect(shortId(null)).toBe('—')
  })
})

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
  })

  it('formats seconds ago', () => {
    const time = new Date('2024-06-15T11:59:30Z').toISOString()
    expect(timeAgo(time)).toBe('30s ago')
  })

  it('formats minutes ago', () => {
    const time = new Date('2024-06-15T11:55:00Z').toISOString()
    expect(timeAgo(time)).toBe('5m ago')
  })

  it('formats hours ago', () => {
    const time = new Date('2024-06-15T10:00:00Z').toISOString()
    expect(timeAgo(time)).toBe('2h ago')
  })

  it('formats days ago', () => {
    const time = new Date('2024-06-13T12:00:00Z').toISOString()
    expect(timeAgo(time)).toBe('2d ago')
  })

  it('returns "Never" for empty input', () => {
    expect(timeAgo('')).toBe('Never')
    expect(timeAgo(null)).toBe('Never')
  })
})

describe('formatCurrency', () => {
  it('formats numbers as currency', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56')
    expect(formatCurrency(0)).toBe('$0.00')
    expect(formatCurrency(999999.99)).toBe('$999,999.99')
  })

  it('handles invalid values', () => {
    expect(formatCurrency(null)).toBe('$0.00')
    expect(formatCurrency(undefined)).toBe('$0.00')
    expect(formatCurrency(NaN)).toBe('$0.00')
  })
})

describe('formatNumber', () => {
  it('formats numbers with thousand separators', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(0)).toBe('0')
  })

  it('handles invalid values', () => {
    expect(formatNumber(null)).toBe('0')
    expect(formatNumber(undefined)).toBe('0')
    expect(formatNumber(NaN)).toBe('0')
  })
})
