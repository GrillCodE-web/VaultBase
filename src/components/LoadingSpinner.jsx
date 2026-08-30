/**
 * LoadingSpinner - Animated loading indicator
 * @param {Object} props
 * @param {number} props.size - Spinner size in pixels
 * @param {string} props.color - Spinner color
 * @param {string} props.label - Accessible label for screen readers
 */
export function LoadingSpinner({ size = 20, color = 'var(--accent)', label = 'Loading content' }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="spinner inline-block border-2 border-transparent rounded-full"
      style={{
        width: size,
        height: size,
        borderTopColor: color,
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
      role="alert"
      aria-live="polite"
      className="fade-in fixed inset-0 flex flex-col items-center justify-center gap-4"
      style={{
        background: 'var(--overlay-loading)',
        backdropFilter: 'blur(4px)',
        zIndex: 'var(--z-modal)',
      }}
    >
      <LoadingSpinner size={32} label={message} />
      {message && <div className="text-text-2 text-14">{message}</div>}
    </div>
  )
}

/**
 * LoadingDots - Three dots loading animation
 */
export function LoadingDots() {
  return (
    <div className="flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-accent"
          style={{
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
    <div className="w-full">
      <div className="h-1 bg-border rounded-[2px] overflow-hidden">
        <div
          className="h-full bg-gradient-accent"
          style={{
            width: `${Math.min(100, Math.max(0, progress))}%`,
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-11 text-text-3 text-right">{Math.round(progress)}%</div>
      )}
    </div>
  )
}
