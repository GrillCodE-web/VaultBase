import { useMemo, useCallback, useRef, useEffect } from 'react'
import { usePersistedState } from './usePersistedState.js'

/**
 * useRowOrder — ручной порядок строк (UX-011) поверх серверной сортировки.
 *
 * Порядок хранится как массив id в localStorage (vb_ui_<key>). Элементы,
 * которых нет в списке (новые записи), получают ранг -1 и остаются вверху
 * в естественном (серверном) порядке. moveRow(dragId, targetId) ставит
 * dragId перед targetId и запоминает порядок видимого набора; id вне
 * текущего набора сохраняют относительный порядок в хвосте списка.
 */
export function useRowOrder(storageKey, items) {
  const [order, setOrder] = usePersistedState(storageKey, null)

  const orderedItems = useMemo(() => {
    if (!order || order.length === 0) return items
    const rank = new Map(order.map((id, i) => [id, i]))
    return [...items].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : -1
      const rb = rank.has(b.id) ? rank.get(b.id) : -1
      return ra - rb
    })
  }, [items, order])

  // CLEAN-002: ref обновляем в эффекте, а не во время рендера
  const orderedRef = useRef(orderedItems)
  useEffect(() => {
    orderedRef.current = orderedItems
  })

  const moveRow = useCallback(
    (dragId, targetId) => {
      if (dragId == null || targetId == null || dragId === targetId) return
      const ids = orderedRef.current.map(i => i.id)
      const from = ids.indexOf(dragId)
      if (from === -1) return
      ids.splice(from, 1)
      const to = ids.indexOf(targetId)
      if (to === -1) return
      ids.splice(to, 0, dragId)
      setOrder(prev => {
        const rest = Array.isArray(prev) ? prev.filter(id => !ids.includes(id)) : []
        return [...ids, ...rest]
      })
    },
    [setOrder]
  )

  return { orderedItems, moveRow }
}
