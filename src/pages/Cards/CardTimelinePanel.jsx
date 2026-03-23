import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X } from 'lucide-react'

export function CardTimelinePanel({ cardId, onClose }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    invoke('get_card_timeline', { cardId })
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [cardId])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Card timeline"
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 340,
        zIndex: 100,
        background: 'var(--card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.3)',
        overflow: 'auto',
        padding: 20,
      }}
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
        <div className="relative" style={{ paddingLeft: 20 }}>
          <div
            style={{
              position: 'absolute',
              left: 7,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--border)',
            }}
          />
          {events.map((ev, i) => (
            <div key={i} className="relative mb-3" style={{ paddingLeft: 12 }}>
              <div
                style={{
                  position: 'absolute',
                  left: -7,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    ev.event_type === 'order'
                      ? 'var(--blue)'
                      : ev.event_type.includes('card')
                        ? 'var(--accent)'
                        : 'var(--border)',
                  border: '1.5px solid var(--surface)',
                }}
              />
              <div className="text-[11px] text-muted">
                {ev.created_at.slice(0, 16).replace('T', ' ')}
              </div>
              <div className="text-[12px] mt-0.5">{ev.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
