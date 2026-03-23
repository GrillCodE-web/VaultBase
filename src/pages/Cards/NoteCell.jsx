import { useState } from 'react'

export function NoteCell({ card, onEditNote }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(card.notes || '')
  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => {
          onEditNote(card.id, val)
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            onEditNote(card.id, val)
            setEditing(false)
          }
          if (e.key === 'Escape') {
            setVal(card.notes || '')
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
      title={val || '—'}
    >
      {val || '—'}
    </span>
  )
}
