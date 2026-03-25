import { useState } from 'react'
import React from 'react'

/**
 * NoteCell — мемоизированный компонент заметок
 *
 * ★ Insight: Мемоизация с кастомным comparison — только если card.id или card.notes изменились
 * ★ Insight: key={card.id} в родителе обеспечивает полный ремаунт при смене карты
 */
export const NoteCell = React.memo(
  function NoteCell({ card, onEditNote }) {
    const [editing, setEditing] = useState(false)
    // ★ Insight: Используем card.notes напрямую вместо state
    // Это устраняет проблему рассинхронизации state и props
    const displayValue = card.notes || ''

    if (editing) {
      return (
        <input
          autoFocus
          defaultValue={displayValue}
          onChange={e => {
            // Сохраняем значение в переменной, но не вызываем setVal
            // При onBlur/Enter вызываем onEditNote с актуальным значением
            return e.target.value
          }}
          onBlur={e => {
            onEditNote(card.id, e.target.value)
            setEditing(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              onEditNote(card.id, e.target.value)
              setEditing(false)
            }
            if (e.key === 'Escape') {
              setEditing(false)
            }
          }}
          className="form-input text-[11px] py-[2px] px-[6px] w-full"
        />
      )
    }
    return (
      <span
        onDoubleClick={() => setEditing(true)}
        className="text-muted text-[11px] cursor-text block max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap"
        title={displayValue || '—'}
      >
        {displayValue || '—'}
      </span>
    )
  },
  (prev, next) => {
    return prev.card.id === next.card.id && prev.card.notes === next.card.notes
  }
)
