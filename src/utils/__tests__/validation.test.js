import { describe, it, expect } from 'vitest'
import {
  isValidEmail,
  isValidCardNumber,
  isValidExpiry,
  isValidCVV,
  isValidZip,
  isValidUrl,
  isValidPort,
} from '../validation'

describe('isValidEmail', () => {
  it('validates correct email formats', () => {
    expect(isValidEmail('test@example.com')).toBe(true)
    expect(isValidEmail('user.name@domain.co.uk')).toBe(true)
    expect(isValidEmail('user+tag@example.com')).toBe(true)
  })

  it('rejects invalid email formats', () => {
    expect(isValidEmail('invalid')).toBe(false)
    expect(isValidEmail('test@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('test @example.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('isValidCardNumber', () => {
  it('validates correct card numbers using Luhn algorithm', () => {
    expect(isValidCardNumber('4532015112830366')).toBe(true) // Visa
    expect(isValidCardNumber('5425233430109903')).toBe(true) // Mastercard
    expect(isValidCardNumber('374245455400126')).toBe(true) // Amex
  })

  it('accepts card numbers with formatting', () => {
    expect(isValidCardNumber('4532-0151-1283-0366')).toBe(true)
    expect(isValidCardNumber('4532 0151 1283 0366')).toBe(true)
  })

  it('rejects invalid card numbers', () => {
    expect(isValidCardNumber('1234567890123456')).toBe(false)
    expect(isValidCardNumber('4532015112830367')).toBe(false) // Wrong checksum
  })

  it('rejects cards with invalid length', () => {
    expect(isValidCardNumber('123')).toBe(false)
    expect(isValidCardNumber('12345678901234567890')).toBe(false)
  })
})

describe('isValidExpiry', () => {
  it('validates correct expiry dates', () => {
    // These tests will pass if the dates are in the future
    expect(isValidExpiry('12/30')).toBe(true)
    expect(isValidExpiry('01/35')).toBe(true)
  })

  it('rejects invalid month values', () => {
    expect(isValidExpiry('00/25')).toBe(false)
    expect(isValidExpiry('13/25')).toBe(false)
  })

  it('rejects invalid formats', () => {
    expect(isValidExpiry('1/25')).toBe(false)
    expect(isValidExpiry('12/2025')).toBe(false)
    expect(isValidExpiry('12-25')).toBe(false)
    expect(isValidExpiry('invalid')).toBe(false)
    expect(isValidExpiry('')).toBe(false)
  })

  it('rejects expired dates', () => {
    expect(isValidExpiry('01/20')).toBe(false)
    expect(isValidExpiry('12/23')).toBe(false)
  })
})

describe('isValidCVV', () => {
  it('validates 3-digit CVV', () => {
    expect(isValidCVV('123')).toBe(true)
    expect(isValidCVV('000')).toBe(true)
    expect(isValidCVV('999')).toBe(true)
  })

  it('validates 4-digit CVV (Amex)', () => {
    expect(isValidCVV('1234')).toBe(true)
    expect(isValidCVV('0000')).toBe(true)
  })

  it('rejects invalid CVV', () => {
    expect(isValidCVV('12')).toBe(false)
    expect(isValidCVV('12345')).toBe(false)
    expect(isValidCVV('abc')).toBe(false)
    expect(isValidCVV('')).toBe(false)
  })
})

describe('isValidZip', () => {
  it('validates US ZIP codes', () => {
    expect(isValidZip('12345')).toBe(true)
    expect(isValidZip('12345-6789')).toBe(true)
  })

  it('validates international postal codes', () => {
    expect(isValidZip('SW1A 1AA')).toBe(true) // UK
    expect(isValidZip('K1A 0B1')).toBe(true) // Canada
    expect(isValidZip('75001')).toBe(true) // France
  })

  it('rejects invalid ZIP codes', () => {
    expect(isValidZip('12')).toBe(false)
    expect(isValidZip('12345678901')).toBe(false)
    expect(isValidZip('')).toBe(false)
  })
})

describe('isValidUrl', () => {
  it('validates correct URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl('http://example.com')).toBe(true)
    expect(isValidUrl('https://example.com/path?query=value')).toBe(true)
  })

  it('rejects invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false)
    expect(isValidUrl('example.com')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})

describe('isValidPort', () => {
  it('validates correct port numbers', () => {
    expect(isValidPort(80)).toBe(true)
    expect(isValidPort(443)).toBe(true)
    expect(isValidPort(8080)).toBe(true)
    expect(isValidPort('3000')).toBe(true)
  })

  it('validates edge cases', () => {
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
  })

  it('rejects invalid port numbers', () => {
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect(isValidPort(-1)).toBe(false)
    expect(isValidPort('invalid')).toBe(false)
  })
})
