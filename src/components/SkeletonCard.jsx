/**
 * SkeletonCard - Loading skeleton for card-based layouts
 */
export function SkeletonCard() {
  const shimmerStyle = {
    background: 'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
  }

  return (
    <div className="fade-in card card-pad">
      {/* Header */}
      <div className="flex gap-3 mb-4">
        <div className="rounded-md" style={{ width: 40, height: 40, ...shimmerStyle }} />
        <div className="flex-1">
          <div className="rounded mb-2" style={{ height: 14, width: '60%', ...shimmerStyle }} />
          <div className="rounded" style={{ height: 11, width: '40%', ...shimmerStyle }} />
        </div>
      </div>

      {/* Content lines */}
      {[80, 60, 70].map((width, i) => (
        <div
          key={i}
          className="rounded mb-2"
          style={{ height: 11, width: `${width}%`, ...shimmerStyle }}
        />
      ))}
    </div>
  )
}

/**
 * SkeletonStats - Loading skeleton for dashboard stats
 */
export function SkeletonStats({ count = 4 }) {
  const shimmerStyle = {
    background: 'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="fade-in card card-pad" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="rounded mb-3" style={{ height: 11, width: '50%', ...shimmerStyle }} />
          <div className="rounded" style={{ height: 24, width: '70%', ...shimmerStyle }} />
        </div>
      ))}
    </div>
  )
}
