import { useCallback, useSyncExternalStore } from 'react'
import { safeGetItem, safeSetItem } from '../utils/localStorage'

const STORAGE_KEY = 'vb_density'
const MODES = ['comfortable', 'compact']

/**
 * REDESIGN-05-1: переключатель плотности «Удобно/Компактно».
 *
 * Единый модульный стор по образцу useTheme: значение живёт на
 * <html data-density>, CSS читает его через переопределение токенов
 * (--row-pad, --h-row, --h-control) в tokens.css — никаких
 * per-component правок. Атрибут ставится при загрузке модуля,
 * до первого рендера, чтобы не было мигания раскладки.
 */
const listeners = new Set()

const read = () => {
  const saved = safeGetItem(STORAGE_KEY)
  return MODES.includes(saved) ? saved : 'comfortable'
}

let current = read()

const apply = mode => {
  document.documentElement.setAttribute('data-density', mode)
}

apply(current)

const store = {
  get: () => current,
  set: next => {
    const mode = MODES.includes(next) ? next : 'comfortable'
    if (mode === current) return
    current = mode
    if (!safeSetItem(STORAGE_KEY, mode)) {
      console.warn('[useDensity] Не удалось сохранить плотность — приватный режим или квота')
    }
    apply(mode)
    listeners.forEach(fn => fn())
  },
  subscribe: fn => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function useDensity() {
  const density = useSyncExternalStore(store.subscribe, store.get, store.get)
  const setDensity = useCallback(next => {
    store.set(typeof next === 'function' ? next(store.get()) : next)
  }, [])
  return { density, setDensity, modes: MODES }
}
