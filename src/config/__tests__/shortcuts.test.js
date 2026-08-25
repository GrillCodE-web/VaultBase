import { describe, it, expect } from 'vitest'
import { findShortcutConflicts, getAllShortcuts } from '../shortcuts.js'

describe('UX-022 shortcut conflict detection', () => {
  it('config has no duplicate keys within one scope', () => {
    const conflicts = findShortcutConflicts()
    expect(conflicts).toEqual([])
  })

  it('getAllShortcuts returns categorized flat list', () => {
    const all = getAllShortcuts()
    expect(all.length).toBeGreaterThan(10)
    expect(all.every(s => s.category && s.id && Array.isArray(s.keys))).toBe(true)
  })
})
