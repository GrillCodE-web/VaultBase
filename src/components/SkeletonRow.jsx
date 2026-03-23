export function SkeletonRow({ cols = 6 }) {
  const widths = ['40%', '70%', '55%', '80%', '45%', '60%']
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }} className="fade-in">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '10px 12px' }}>
          <div
            style={{
              height: 11,
              borderRadius: 5,
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
