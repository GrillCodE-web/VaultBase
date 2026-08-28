import { createContext, useContext } from 'react'

/**
 * CLEAN-009: контекст «окружения строки карты».
 *
 * Раньше CardTable → CardRow пробрасывались ~20 одинаковых пропсов
 * (коллбэки, t, toast, состояния выбора/reveal), а custom-compare
 * React.memo должен был их все учитывать. Теперь окружение живёт в
 * контексте (провайдер в CardTable), строке остаются только per-row данные.
 */
export const CardRowContext = createContext(null)

export function useCardRowCtx() {
  const ctx = useContext(CardRowContext)
  if (!ctx) throw new Error('useCardRowCtx must be used inside <CardRowContext.Provider>')
  return ctx
}
