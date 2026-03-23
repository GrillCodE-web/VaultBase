export function CardField({ label, value, mono, onCopy }) {
  if (!value) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span className="text-[10px] text-muted min-w-[70px]">{label}</span>
      <span
        style={{
          fontFamily: mono ? "'JetBrains Mono',monospace" : undefined,
          fontSize: 11,
          color: 'var(--text)',
          flex: 1,
          textAlign: 'right',
        }}
      >
        {value}
      </span>
      <button onClick={() => onCopy(value)} className="float-copy ml-2 shrink-0" title="Copy">
        ⧉
      </button>
    </div>
  )
}
