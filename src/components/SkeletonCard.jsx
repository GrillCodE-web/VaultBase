/**
 * SkeletonCard - Loading skeleton for card-based layouts
 */
export function SkeletonCard() {
  return (
    <div
      className="fade-in"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 'var(--sp-4)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 'var(--r-md)',
            background:
              'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              height: 14,
              width: '60%',
              borderRadius: 4,
              background:
                'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
              marginBottom: 'var(--sp-2)',
            }}
          />
          <div
            style={{
              height: 11,
              width: '40%',
              borderRadius: 4,
              background:
                'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      {/* Content lines */}
      {[80, 60, 70].map((width, i) => (
        <div
          key={i}
          style={{
            height: 11,
            width: `${width}%`,
            borderRadius: 4,
            background:
              'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
            backgroundSize: '200% 100%',
            animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
            marginBottom: 'var(--sp-2)',
          }}
        />
      ))}
    </div>
  )
}

/**
 * SkeletonStats - Loading skeleton for dashboard stats
 */
export function SkeletonStats({ count = 4 }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--sp-4)',
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="fade-in"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 'var(--sp-4)',
            animationDelay: `${i * 50}ms`,
          }}
        >
          <div
            style={{
              height: 11,
              width: '50%',
              borderRadius: 4,
              background:
                'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
              marginBottom: 'var(--sp-3)',
            }}
          />
          <div
            style={{
              height: 24,
              width: '70%',
              borderRadius: 4,
              background:
                'linear-gradient(90deg, var(--card) 25%, var(--card-hi) 50%, var(--card) 75%)',
              backgroundSize: '200% 100%',
              animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
            }}
          />
        </div>
      ))}
    </div>
  )
}
