/**
 * AnimatedIcon - Icon with entrance animations
 */
export function AnimatedCheckmark({ size = 24, color = 'var(--green)' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline
        points="20 6 9 17 4 12"
        style={{
          strokeDasharray: 50,
          strokeDashoffset: 50,
          animation: 'checkmark 0.4s ease-out forwards',
        }}
      />
    </svg>
  )
}

/**
 * AnimatedXMark - X icon with entrance animation
 */
export function AnimatedXMark({ size = 24, color = 'var(--red)' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line
        x1="18"
        y1="6"
        x2="6"
        y2="18"
        style={{
          strokeDasharray: 50,
          strokeDashoffset: 50,
          animation: 'xmark 0.4s ease-out forwards',
        }}
      />
      <line
        x1="6"
        y1="6"
        x2="18"
        y2="18"
        style={{
          strokeDasharray: 50,
          strokeDashoffset: 50,
          animation: 'xmark 0.4s ease-out forwards 0.1s',
        }}
      />
    </svg>
  )
}

/**
 * PulsingDot - Animated status indicator
 */
export function PulsingDot({ color = 'var(--accent)', size = 8 }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: color,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: color,
          animation: 'pulse 2s ease-in-out infinite',
        }}
      />
    </div>
  )
}
