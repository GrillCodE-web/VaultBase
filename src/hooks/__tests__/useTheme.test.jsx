import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from '../useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to dark theme when no saved preference', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('loads saved theme from localStorage on mount', () => {
    localStorage.setItem('theme', 'light')

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })

  it('provides theme, setTheme, and toggleTheme', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current).toHaveProperty('theme')
    expect(result.current).toHaveProperty('setTheme')
    expect(result.current).toHaveProperty('toggleTheme')
  })

  it('applies theme to document root data-theme attribute', () => {
    renderHook(() => useTheme())

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('updates data-theme attribute when theme changes', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('persists theme to localStorage when changed', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('toggles from dark to light with toggleTheme', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('light')
  })

  it('toggles from light to dark with toggleTheme', () => {
    localStorage.setItem('theme', 'light')

    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.toggleTheme()
    })

    expect(result.current.theme).toBe('dark')
  })

  it('allows setting theme to any value', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('system')
    })

    expect(result.current.theme).toBe('system')
    expect(localStorage.getItem('theme')).toBe('system')
  })

  it('persists theme to localStorage on initial mount', () => {
    localStorage.clear()

    renderHook(() => useTheme())

    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('switches theme multiple times correctly', () => {
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })
    expect(result.current.theme).toBe('light')

    act(() => {
      result.current.setTheme('dark')
    })
    expect(result.current.theme).toBe('dark')

    act(() => {
      result.current.toggleTheme()
    })
    expect(result.current.theme).toBe('light')
  })
})
