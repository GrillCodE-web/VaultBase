import { useCallback, useEffect, useState } from 'react'
import { usePersistedState } from '../../hooks/usePersistedState.js'

const WIDTHS = [12, 8, 6, 4]

/**
 * WidgetGrid — кастомизируемая сетка дашборда (REDESIGN-05-4, своя лёгкая
 * сетка вместо react-grid-layout: −60kb бандла и чужой CSS).
 *
 * items: [{ id, defaultH, node }] (defaultH больше не используется — высота
 * теперь авто по контенту, как делал ResizeObserver). Порядок и ширины
 * персистятся в localStorage (vb_ui_dashboard_layout_v2): [{ i, w }] —
 * позиция в массиве = визуальный порядок, w ∈ 12/8/6/4 колонок из 12.
 * Перетаскивание — только за грип .widget-grip (HTML5 DnD), ширина —
 * кнопкой .widget-width-btn (цикл 12→8→6→4). Кнопка «Сбросить раскладку»
 * в шапке дашборда шлёт событие vb:reset-dash-layout.
 */
export function WidgetGrid({ items }) {
  const [saved, setSaved] = usePersistedState('dashboard_layout_v2', null)
  const [dragId, setDragId] = useState(null)

  useEffect(() => {
    const reset = () => setSaved(null)
    window.addEventListener('vb:reset-dash-layout', reset)
    return () => window.removeEventListener('vb:reset-dash-layout', reset)
  }, [setSaved])

  const savedArr = Array.isArray(saved) ? saved : []
  const widthOf = useCallback(
    id => savedArr.find(s => s.i === id)?.w ?? 12,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedArr — derived от saved
    [saved]
  )
  const posOf = id => {
    const i = savedArr.findIndex(s => s.i === id)
    return i === -1 ? 9999 : i
  }
  const ordered = [...items].sort((a, b) => posOf(a.id) - posOf(b.id))

  const persistAll = useCallback(
    (idsInOrder, widths) => setSaved(idsInOrder.map(id => ({ i: id, w: widths(id) }))),
    [setSaved]
  )

  const handleDrop = useCallback(
    targetId => {
      if (!dragId || dragId === targetId) return
      const ids = ordered.map(it => it.id)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(targetId)
      if (from === -1 || to === -1) return
      ids.splice(to, 0, ids.splice(from, 1)[0])
      persistAll(ids, widthOf)
      setDragId(null)
    },
    [dragId, ordered, persistAll, widthOf]
  )

  const cycleWidth = useCallback(
    id => {
      const next = WIDTHS[(WIDTHS.indexOf(widthOf(id)) + 1) % WIDTHS.length]
      persistAll(
        ordered.map(it => it.id),
        wid => (wid === id ? next : widthOf(wid))
      )
    },
    [ordered, persistAll, widthOf]
  )

  return (
    <div className="dashboard-grid">
      {ordered.filter(Boolean).map(it => (
        <div
          key={it.id}
          className={`widget-frame wspan-${widthOf(it.id)}${dragId === it.id ? ' dragging' : ''}`}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleDrop(it.id)}
        >
          <span
            className="widget-grip"
            draggable
            onDragStart={e => {
              setDragId(it.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDragId(null)}
            aria-hidden="true"
          >
            ⠿
          </span>
          <button
            type="button"
            className="widget-width-btn"
            onClick={() => cycleWidth(it.id)}
            aria-hidden="true"
            tabIndex={-1}
          >
            ↔
          </button>
          {it.node}
        </div>
      ))}
    </div>
  )
}
