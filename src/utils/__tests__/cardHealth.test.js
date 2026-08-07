import { describe, it, expect } from 'vitest'
import { getCardHealth } from '../cardHealth'

describe('getCardHealth', () => {
  it('returns "Burned" for dead cards', () => {
    const card = { status: 'dead', expiry_date: '12/25', orders_count: 0 }
    const health = getCardHealth(card)
    expect(health.label).toBe('Burned')
    expect(health.cls).toBe('st-dead')
    expect(health.dot).toBe('#ff3b30')
  })

  it('returns "Expired" for expired cards', () => {
    const card = { status: 'free', expiry_date: '01/20', orders_count: 0 }
    const health = getCardHealth(card)
    expect(health.label).toBe('Expired')
    expect(health.cls).toBe('st-dead')
  })

  it('returns "Used" for in_use cards with 3+ orders', () => {
    const card = { status: 'in_use', expiry_date: '12/30', orders_count: 3 }
    const health = getCardHealth(card)
    expect(health.label).toBe('Used')
    expect(health.cls).toBe('st-inuse')
    expect(health.dot).toBe('#ffcc00')
  })

  it('returns "Fresh" for free cards', () => {
    const card = { status: 'free', expiry_date: '12/30', orders_count: 0 }
    const health = getCardHealth(card)
    expect(health.label).toBe('Fresh')
    expect(health.cls).toBe('st-free')
    expect(health.dot).toBe('#28cd41')
  })

  it('returns null for in_use cards with < 3 orders', () => {
    const card = { status: 'in_use', expiry_date: '12/30', orders_count: 2 }
    const health = getCardHealth(card)
    expect(health).toBe(null)
  })

  it('handles missing orders_count', () => {
    const card = { status: 'free', expiry_date: '12/30' }
    const health = getCardHealth(card)
    expect(health.label).toBe('Fresh')
  })

  it('prioritizes dead status over expired', () => {
    const card = { status: 'dead', expiry_date: '01/20', orders_count: 0 }
    const health = getCardHealth(card)
    expect(health.label).toBe('Burned')
  })
})
