import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme'

/**
 * Хук перешёл на модульный стор (см. useTheme.jsx): состояние живёт
 * вне React и переживает размонтирование. Поэтому каждый тест сначала
 * приводит стор к известному режиму через setTheme, а не полагается на
 * пересоздание хука.
 */
describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('system'))
  })

  it('defaults to system when no saved preference', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('system')
  })

  it('provides theme, setTheme, toggleTheme and cycleTheme', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current).toHaveProperty('theme')
    expect(result.current).toHaveProperty('resolvedTheme')
    expect(result.current).toHaveProperty('setTheme')
    expect(result.current).toHaveProperty('toggleTheme')
    expect(result.current).toHaveProperty('cycleTheme')
  })

  it('applies theme to document root data-theme attribute', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('updates data-theme attribute when theme changes', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('light'))

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists theme to localStorage when changed', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('light'))

    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('shares state between separate hook instances', () => {
    const a = renderHook(() => useTheme())
    const b = renderHook(() => useTheme())

    act(() => a.result.current.setTheme('dark'))

    // Ровно тот баг, из-за которого хук переписан: сайдбар и Настройки
    // держали независимые состояния и перезаписывали друг друга.
    expect(b.result.current.theme).toBe('dark')
  })

  it('toggleTheme switches between light and dark only', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('dark'))
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')

    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
  })

  it('toggleTheme leaves system mode by choosing dark', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggleTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('cycleTheme walks system → light → dark → system', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('light')

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('dark')

    act(() => result.current.cycleTheme())
    expect(result.current.theme).toBe('system')
  })

  it('rejects unknown modes and falls back to system', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('neon'))

    expect(result.current.theme).toBe('system')
  })

  it('accepts an updater function like useState', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('light'))
    act(() => result.current.setTheme(prev => (prev === 'light' ? 'dark' : 'light')))

    expect(result.current.theme).toBe('dark')
  })

  it('resolvedTheme collapses system to a concrete theme', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.setTheme('system'))
    expect(['light', 'dark']).toContain(result.current.resolvedTheme)

    act(() => result.current.setTheme('dark'))
    expect(result.current.resolvedTheme).toBe('dark')
  })
})
