export function CardField({ label, value, mono, onCopy }) {
  if (!value) return null
  return (
    <div className="card-field-row">
      <span className="card-field-label">{label}</span>
      <span className={`card-field-value ${mono ? 'mono' : ''}`}>{value}</span>
      <button onClick={() => onCopy(value)} className="float-copy ml-2 shrink-0" title="Copy">
        ⧉
      </button>
    </div>
  )
}
