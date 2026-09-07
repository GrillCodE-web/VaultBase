// Скелетоны загрузки (порт идеи worker SkeletonRow под стили manager.css).
// Пульс задаётся классом .skeleton в manager.css.

export function SkeletonRows({ rows = 6, height = 14 }) {
  return (
    <div className="panel" aria-busy="true" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            height,
            margin: '14px 0',
            // Разная ширина строк — визуально ближе к таблице.
            width: `${92 - ((i * 37) % 30)}%`,
          }}
        />
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4 }) {
  return (
    <div aria-busy="true" aria-hidden="true">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 86, borderRadius: 'var(--radius)' }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 240, marginTop: 16, borderRadius: 'var(--radius)' }} />
    </div>
  )
}
