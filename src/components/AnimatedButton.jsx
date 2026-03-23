import { useState, useRef } from 'react'
import { LoadingSpinner } from './LoadingSpinner'

/**
 * AnimatedButton - Button with ripple effect and loading state
 */
export function AnimatedButton({
  children,
  onClick,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className = '',
  ...props
}) {
  const [ripples, setRipples] = useState([])
  const buttonRef = useRef(null)

  const handleClick = e => {
    if (loading || disabled) return

    // Create ripple effect
    const button = buttonRef.current
    const rect = button.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const ripple = {
      x,
      y,
      id: Date.now(),
    }

    setRipples(prev => [...prev, ripple])

    // Remove ripple after animation
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== ripple.id))
    }, 600)

    // Call onClick handler
    if (onClick) {
      onClick(e)
    }
  }

  const variants = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--bg)',
      border: 'none',
    },
    secondary: {
      background: 'var(--card)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
    },
    danger: {
      background: 'var(--red)',
      color: 'white',
      border: 'none',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-2)',
      border: '1px solid var(--border)',
    },
  }

  const sizes = {
    sm: { padding: '6px 12px', fontSize: 12 },
    md: { padding: '8px 16px', fontSize: 13 },
    lg: { padding: '10px 20px', fontSize: 14 },
  }

  const style = {
    ...variants[variant],
    ...sizes[size],
    borderRadius: 'var(--r-md)',
    fontWeight: 500,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    position: 'relative',
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--sp-2)',
    transition: 'all var(--t-fast)',
    ...props.style,
  }

  return (
    <button
      ref={buttonRef}
      className={`${className}`}
      onClick={handleClick}
      disabled={disabled || loading}
      style={style}
      {...props}
    >
      {/* Ripple effects */}
      {ripples.map(ripple => (
        <span
          key={ripple.id}
          style={{
            position: 'absolute',
            left: ripple.x,
            top: ripple.y,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.5)',
            transform: 'translate(-50%, -50%)',
            animation: 'ripple 0.6s ease-out',
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Loading spinner */}
      {loading && <LoadingSpinner size={14} color="currentColor" />}

      {/* Icon */}
      {!loading && Icon && <Icon size={16} />}

      {/* Content */}
      {children}
    </button>
  )
}
