import { useCallback, useEffect, useRef, useState } from 'react'
import ReactGridLayout, { WidthProvider } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import { usePersistedState } from '../../hooks/usePersistedState.js'

const GridLayout = WidthProvider(ReactGridLayout)
const ROW_HEIGHT = 30
const MARGIN = 12

/**
 * WidgetGrid — кастомизируемая сетка дашборда (UX-014, react-grid-layout).
 *
 * items: [{ id, defaultH, node }]. Порядок/ширины (x/y/w) персистятся в
 * localStorage (vb_ui_dashboard_layout_v1); высота (h) вычисляется из
 * реального контента через ResizeObserver — таблицы/чарты не клипаются.
 * Перетаскивание — только за грип .widget-grip, чтобы не ломать выделение
 * текста и кнопки внутри панелей.
 */
export function WidgetGrid({ items }) {
  const [saved, setSaved] = usePersistedState('dashboard_layout_v1', null)
  const [heights, setHeights] = useState({})
  // Кнопка «Сбросить раскладку» в шапке дашборда шлёт это событие
  useEffect(() => {
    const reset = () => setSaved(null)
    window.addEventListener('vb:reset-dash-layout', reset)
    return () => window.removeEventListener('vb:reset-dash-layout', reset)
  }, [setSaved])
  // CLEAN-002: ref для onLayoutChange, чтобы не тащить saved в замыкание
  const savedRef = useRef(saved)
  useEffect(() => {
    savedRef.current = saved
  })

  const handleHeight = useCallback((id, px) => {
    const rows = Math.max(2, Math.ceil((px + MARGIN) / (ROW_HEIGHT + MARGIN)))
    setHeights(prev => (prev[id] === rows ? prev : { ...prev, [id]: rows }))
  }, [])

  const layout = items.map((it, idx) => {
    const s = Array.isArray(saved) ? saved.find(l => l.i === it.id) : null
    return {
      i: it.id,
      x: s?.x ?? 0,
      y: s?.y ?? idx,
      w: s?.w ?? 12,
      h: heights[it.id] ?? it.defaultH,
      minH: 2,
      minW: 3,
    }
  })

  const handleLayoutChange = useCallback(
    next => {
      // Персистим только геометрию (x/y/w); h — авто по контенту.
      // Запись — лишь когда геометрия реально изменилась (авто-высота
      // тоже триггерит onLayoutChange, а петля нам не нужна).
      const geom = next.map(({ i, x, y, w }) => ({ i, x, y, w }))
      const cur = Array.isArray(savedRef.current) ? savedRef.current : []
      const same =
        cur.length === geom.length &&
        cur.every(c => {
          const n = geom.find(g => g.i === c.i)
          return n && n.x === c.x && n.y === c.y && n.w === c.w
        })
      if (!same) setSaved(geom)
    },
    [setSaved]
  )

  return (
    <GridLayout
      className="dashboard-grid"
      layout={layout}
      cols={12}
      rowHeight={ROW_HEIGHT}
      margin={[MARGIN, MARGIN]}
      compactType="vertical"
      draggableHandle=".widget-grip"
      resizeHandles={['e', 'w']}
      onLayoutChange={handleLayoutChange}
    >
      {items.map(it => (
        <div key={it.id}>
          <WidgetFrame id={it.id} onHeight={handleHeight}>
            {it.node}
          </WidgetFrame>
        </div>
      ))}
    </GridLayout>
  )
}

function WidgetFrame({ id, onHeight, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof window.ResizeObserver === 'undefined') return
    const ro = new window.ResizeObserver(() => onHeight(id, el.scrollHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [id, onHeight])
  return (
    <div ref={ref} className="widget-frame">
      <span className="widget-grip" aria-hidden="true">
        ⠿
      </span>
      {children}
    </div>
  )
}
