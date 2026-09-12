// REDESIGN-05 (c5j, 8B): календарь доставок — checkpoints трекинга
// на сетке дней месяца. Данные: get_calendar_events (tracking_checkpoints).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ordersApi } from '../api/orders'
import { useLang } from '../hooks/useLang'
import { handleError } from '../utils/errorHandler'

// Статус → CSS-переменная цвета точки (tokens.css)
const STATUS_VAR = {
  pre_transit: 'var(--text-3)',
  in_transit: 'var(--blue-t)',
  out_for_delivery: 'var(--purple-t)',
  delivered: 'var(--green-t)',
  received: 'var(--green-t)',
  exception: 'var(--red-t)',
  unknown: 'var(--text-3)',
}

const statusColor = s => STATUS_VAR[s] ?? 'var(--text-3)'

const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default function Calendar() {
  const { t, lang } = useLang()
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null) // 'YYYY-MM-DD'

  const load = useCallback(async d => {
    setLoading(true)
    try {
      setEvents(await ordersApi.getCalendarEvents(monthKey(d)))
    } catch (e) {
      handleError(e, 'Calendar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(cursor)
  }, [cursor, load])

  const byDay = useMemo(() => {
    const m = {}
    for (const ev of events) (m[ev.date] ??= []).push(ev)
    return m
  }, [events])

  const grid = useMemo(() => {
    const y = cursor.getFullYear()
    const mo = cursor.getMonth()
    // Понедельник — первый день недели (как в остальном UI)
    const firstDow = (new Date(y, mo, 1).getDay() + 6) % 7
    const daysInMonth = new Date(y, mo + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [cursor])

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { weekday: 'short' })
    // 2024-01-01 — понедельник
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
  }, [lang])

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(cursor),
    [cursor, lang]
  )

  const shift = delta => setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1))

  const todayKey = monthKey(new Date())
  const todayDay =
    cursor.getFullYear() === new Date().getFullYear() && monthKey(cursor) === todayKey
      ? new Date().getDate()
      : null

  const selectedEvents = selected ? (byDay[selected] ?? []) : []

  return (
    <div className="content">
      <div className="ph">
        <div className="ph-title">{t('nav_calendar')}</div>
        <div className="ph-actions">
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => shift(-1)}
            aria-label={t('cal_prev_month')}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-13 font-semibold cal-title" aria-live="polite">
            {monthTitle}
          </span>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => shift(1)}
            aria-label={t('cal_next_month')}
          >
            <ChevronRight size={14} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const n = new Date()
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1))
              setSelected(null)
            }}
          >
            {t('cal_today')}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="cal-grid" role="grid" aria-busy={loading}>
          {weekdays.map(w => (
            <div key={w} className="cal-dow" role="columnheader">
              {w}
            </div>
          ))}
          {grid.map((day, i) => {
            if (day === null) return <div key={`x${i}`} className="cal-cell cal-empty" />
            const key = `${monthKey(cursor)}-${String(day).padStart(2, '0')}`
            const dayEvents = byDay[key] ?? []
            const isSel = selected === key
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                className={`cal-cell cal-day${isSel ? ' cal-sel' : ''}${day === todayDay ? ' cal-today' : ''}`}
                onClick={() => setSelected(isSel ? null : key)}
              >
                <span className="cal-num">{day}</span>
                {dayEvents.length > 0 && (
                  <span className="cal-dots">
                    {dayEvents.slice(0, 3).map((ev, j) => (
                      <span
                        key={j}
                        className="cal-dot"
                        style={{ background: statusColor(ev.status) }}
                      />
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="cal-more">+{dayEvents.length - 3}</span>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selected && (
        <div className="panel mt-3">
          <div className="text-13 font-semibold mb-2">
            {t('cal_events_on')} {selected}
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-11 text-muted py-2">{t('cal_no_events')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {selectedEvents.map((ev, j) => (
                <div key={j} className="cal-event">
                  <span
                    className="cal-dot"
                    style={{ background: statusColor(ev.status) }}
                    aria-hidden="true"
                  />
                  <span className="mono text-12">{ev.order_number || `#${ev.order_id}`}</span>
                  <span className="text-12 text-muted mono">{ev.tracking_number}</span>
                  {ev.carrier && <span className="text-11 text-muted">{ev.carrier}</span>}
                  <span className="text-11" style={{ color: statusColor(ev.status) }}>
                    {t(`track_${ev.status}`) !== `track_${ev.status}`
                      ? t(`track_${ev.status}`)
                      : ev.status}
                  </span>
                  {ev.description && <span className="text-11 text-muted">{ev.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
