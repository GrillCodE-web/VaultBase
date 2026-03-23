/**
 * LoadingSpinner - Animated loading indicator
 */
export function LoadingSpinner({ size = 20, color = 'var(--accent)' }) {
  return (
    <div
      className="spinner"
      style={{
        width: size,
        height: size,
        border: `2px solid transparent`,
        borderTopColor: color,
        borderRadius: '50%',
        display: 'inline-block',
      }}
    />
  )
}

/**
 * LoadingOverlay - Full-screen loading overlay
 */
export function LoadingOverlay({ message = 'Loading...' }) {
  return (
    <div
      className="fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13, 17, 23, 0.8)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-4)',
        zIndex: 9999,
      }}
    >
      <LoadingSpinner size={32} />
      {message && <div style={{ color: 'var(--text-2)', fontSize: 14 }}>{message}</div>}
    </div>
  )
}

/**
 * LoadingDots - Three dots loading animation
 */
export function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'pulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * ProgressBar - Animated progress indicator
 */
export function ProgressBar({ progress = 0, showLabel = false }) {
  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          height: 4,
          background: 'var(--border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, Math.max(0, progress))}%`,
            background: 'var(--gradient-accent)',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>
      {showLabel && (
        <div
          style={{
            marginTop: 'var(--sp-1)',
            fontSize: 11,
            color: 'var(--text-3)',
            textAlign: 'right',
          }}
        >
          {Math.round(progress)}%
        </div>
      )}
    </div>
  )
}
