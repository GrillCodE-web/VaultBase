import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X } from 'lucide-react'

export function CardTimelinePanel({ cardId, onClose }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    let cancelled = false
    invoke('get_card_timeline', { cardId })
      .then(data => {
        if (!cancelled) setEvents(data || [])
      })
      .catch(() => {
        if (!cancelled) setEvents([])
      })
    return () => {
      cancelled = true
    }
  }, [cardId])

  const getDotClass = eventType => {
    if (eventType === 'order') return 'order'
    if (eventType.includes('card')) return 'card'
    return 'default'
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Card timeline"
      className="timeline-panel-container"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="font-semibold text-[13px]">Card Timeline</div>
        <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
          <X size={13} />
        </button>
      </div>
      {events === null ? (
        <div className="text-muted text-[12px]">Loading...</div>
      ) : events.length === 0 ? (
        <div className="text-muted text-[12px]">No history for this card yet.</div>
      ) : (
        <div className="timeline-panel">
          {events.map((ev, i) => (
            <div key={i} className="timeline-item">
              <div className={`timeline-dot ${getDotClass(ev.event_type)}`} />
              <div className="timeline-time">{ev.created_at.slice(0, 16).replace('T', ' ')}</div>
              <div className="timeline-content">{ev.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
