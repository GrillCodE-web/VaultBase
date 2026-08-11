import { useCallback, useSyncExternalStore } from 'react'
// FIX CRITICAL: Use safe localStorage operations
import { safeGetItem, safeSetItem } from '../utils/localStorage'

const STORAGE_KEY = 'theme'
const MODES = ['system', 'light', 'dark']

/**
 * Единый источник истины для темы.
 *
 * Раньше состояние жило в двух местах: App.jsx держал свой useState
 * с ключом 'cc_theme', а этот хук — свой с ключом 'theme'. Кнопка в
 * сайдбаре и переключатель в Настройках не знали друг о друге, поэтому
 * переключение в одном месте перезаписывалось другим при следующем
 * рендере. Модульный стор + useSyncExternalStore дают общее состояние
 * без провайдера в дереве.
 */
const listeners = new Set()

const read = () => {
  // FIX CRITICAL: Use safe localStorage
  const saved = safeGetItem(STORAGE_KEY)
  return MODES.includes(saved) ? saved : 'dark'
}

let current = read()

/* Атрибут ставится сразу при загрузке модуля, до первого рендера:
   иначе между монтированием и эффектом успевает мигнуть светлая
   тема (:root в tokens-redesign.css — светлый). */
const apply = mode => {
  document.documentElement.setAttribute('data-theme', mode)
}

apply(current)

const store = {
  get: () => current,
  set: next => {
    const mode = MODES.includes(next) ? next : 'system'
    if (mode === current) return
    current = mode
    // FIX CRITICAL: Use safe localStorage with error handling
    const success = safeSetItem(STORAGE_KEY, mode)
    if (!success) {
      // Приватный режим или переполненное хранилище: тема применится,
      // но не переживёт перезапуск. Это не повод падать.
      console.warn(
        '[useTheme] Не удалось сохранить тему - приватный режим или переполненное хранилище'
      )
    }
    apply(mode)
    listeners.forEach(fn => fn())
  },
  subscribe: fn => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

/* Режим 'system' раскрашивается целиком на стороне CSS — см.
   @media (prefers-color-scheme: dark) в tokens-redesign.css. JS
   слушает matchMedia только чтобы обновить иконку переключателя. */
const query = window.matchMedia?.('(prefers-color-scheme: dark)')
query?.addEventListener('change', () => {
  if (current === 'system') listeners.forEach(fn => fn())
})

export function useTheme() {
  const theme = useSyncExternalStore(store.subscribe, store.get, store.get)

  const setTheme = useCallback(next => {
    store.set(typeof next === 'function' ? next(store.get()) : next)
  }, [])

  /* Оставлено ради существующей семантики: переключает свет/тьму,
     минуя 'system'. Для полного круга — cycleTheme. */
  const toggleTheme = useCallback(() => {
    store.set(store.get() === 'dark' ? 'light' : 'dark')
  }, [])

  const cycleTheme = useCallback(() => {
    const i = MODES.indexOf(store.get())
    store.set(MODES[(i + 1) % MODES.length])
  }, [])

  const resolvedTheme = theme === 'system' ? (query?.matches ? 'dark' : 'light') : theme

  return { theme, resolvedTheme, setTheme, toggleTheme, cycleTheme, modes: MODES }
}
