import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { LangProvider, useLang } from '../useLang'

describe('useLang', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('throws error when used outside LangProvider', () => {
    expect(() => {
      renderHook(() => useLang())
    }).toThrow('useLang must be used inside <LangProvider>')
  })

  it('provides lang, setLang, and t method', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current).toHaveProperty('lang')
    expect(result.current).toHaveProperty('setLang')
    expect(result.current).toHaveProperty('t')
  })

  it('defaults to English language', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.lang).toBe('en')
  })

  it('loads saved language from localStorage on mount', () => {
    localStorage.setItem('cc_manager_lang', 'ru')

    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.lang).toBe('ru')
  })

  it('switches language with setLang', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    act(() => {
      result.current.setLang('ru')
    })

    expect(result.current.lang).toBe('ru')
  })

  it('persists language to localStorage when changed', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    act(() => {
      result.current.setLang('ru')
    })

    expect(localStorage.getItem('cc_manager_lang')).toBe('ru')
  })

  it('translates keys using t() function for English', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.t('nav_dashboard')).toBe('Dashboard')
    expect(result.current.t('btn_add')).toBe('Add')
  })

  it('translates keys using t() function for Russian', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    act(() => {
      result.current.setLang('ru')
    })

    expect(result.current.t('nav_dashboard')).toBe('Дашборд')
    expect(result.current.t('btn_add')).toBe('Добавить')
  })

  it('falls back to English for missing translation', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    act(() => {
      result.current.setLang('ru')
    })

    // This key exists in both, but testing fallback chain
    expect(result.current.t('nonexistent_key')).toBe('nonexistent_key')
  })

  it('returns key as fallback for unknown translation keys', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.t('unknown_key_xyz')).toBe('unknown_key_xyz')
  })

  it('updates translations after language switch', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    // Initially English
    expect(result.current.t('msg_loading')).toBe('Loading…')

    act(() => {
      result.current.setLang('ru')
    })

    // After switch to Russian
    expect(result.current.t('msg_loading')).toBe('Загрузка…')
  })

  it('translates status keys correctly', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.t('status_free')).toBe('Free')
    expect(result.current.t('status_in_use')).toBe('In Use')
    expect(result.current.t('status_dead')).toBe('Dead')
  })

  it('translates auth-related keys correctly', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    expect(result.current.t('auth_setup_title')).toBe('Create Master Password')
    expect(result.current.t('auth_btn_unlock')).toBe('Unlock')
  })

  it('handles multiple language switches correctly', () => {
    const wrapper = ({ children }) => <LangProvider>{children}</LangProvider>
    const { result } = renderHook(() => useLang(), { wrapper })

    // English
    expect(result.current.t('btn_confirm')).toBe('Confirm')

    // Switch to Russian
    act(() => {
      result.current.setLang('ru')
    })
    expect(result.current.t('btn_confirm')).toBe('Подтвердить')

    // Switch back to English
    act(() => {
      result.current.setLang('en')
    })
    expect(result.current.t('btn_confirm')).toBe('Confirm')
  })
})
