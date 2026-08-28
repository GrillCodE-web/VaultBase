export function SkeletonRow({ cols = 6 }) {
  const widths = ['40%', '70%', '55%', '80%', '45%', '60%']
  return (
    <tr className="fade-in border-b">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="p-[10px_12px]">
          <div
            className="h-[11px] rounded-[5px]"
            style={{
              background:
                'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
              width: widths[i % widths.length],
            }}
          />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonRows({ count = 5, cols = 6 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} cols={cols} />
      ))}
    </>
  )
}

// UX-003: div-вариант скелетона для не-табличных списков (grid/карточки),
// чтобы не рендерить <tr> вне <table>
export function SkeletonBlock({ rows = 5 }) {
  const widths = ['70%', '55%', '80%', '45%', '60%']
  return (
    <div className="fade-in p-3 flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-[11px] rounded-[5px]"
          style={{
            background:
              'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
            width: widths[i % widths.length],
          }}
        />
      ))}
    </div>
  )
}
