import { useEffect, useRef, useMemo } from 'react'

/**
 * PremiumEmptyState — премиум-компонент пустого состояния
 * с анимированной иконкой и cyber-terminal эстетикой
 *
 * @param {string} title - Заголовок
 * @param {string} description - Описание
 * @param {ReactNode} icon - Иконка (Lucide React component)
 * @param {Array} actions - Массив кнопок действий
 * @param {string} variant - 'default' | 'info' | 'success' | 'warning'
 */
export function PremiumEmptyState({
  title,
  description,
  icon: Icon,
  actions = [],
  variant = 'default',
}) {
  const particlesRef = useRef(null)

  // Generate stable particle positions on mount
  const particles = useMemo(
    () =>
      [...Array(12)].map((_, i) => ({
        id: i,
        left: (i * 8.33) % 100,
        top: (i * 17.5) % 100,
        delay: i * 0.15,
      })),
    []
  )

  useEffect(() => {
    // Анимация частиц при монтировании
    if (particlesRef.current) {
      const particles = particlesRef.current.children
      for (let i = 0; i < particles.length; i++) {
        particles[i].style.animationDelay = `${i * 0.1}s`
      }
    }
  }, [])

  const variantStyles = {
    default: {
      accent: 'var(--accent)',
      bg: 'var(--accent-dim)',
      border: 'var(--accent-border)',
      glow: 'rgba(0, 217, 255, 0.15)',
    },
    info: {
      accent: 'var(--blue)',
      bg: 'rgba(59, 130, 246, 0.1)',
      border: 'rgba(59, 130, 246, 0.3)',
      glow: 'rgba(59, 130, 246, 0.15)',
    },
    success: {
      accent: 'var(--green)',
      bg: 'var(--color-success-bg)',
      border: 'var(--color-success-border)',
      glow: 'rgba(20, 241, 149, 0.15)',
    },
    warning: {
      accent: 'var(--yellow)',
      bg: 'var(--color-warning-bg)',
      border: 'var(--color-warning-border)',
      glow: 'rgba(245, 158, 11, 0.15)',
    },
  }

  const style = variantStyles[variant]

  return (
    <div className="premium-empty-state">
      {/* Animated background particles */}
      <div className="premium-empty-state__particles" ref={particlesRef}>
        {particles.map(particle => (
          <div
            key={particle.id}
            className="particle"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="premium-empty-state__content">
        {Icon && (
          <div
            className="premium-empty-state__icon-container"
            style={{
              background: style.bg,
              borderColor: style.border,
              boxShadow: `0 0 40px ${style.glow}`,
            }}
          >
            <div className="premium-empty-state__icon-glow" style={{ background: style.glow }} />
            <Icon size={48} className="premium-empty-state__icon" style={{ color: style.accent }} />
          </div>
        )}

        <h2 className="premium-empty-state__title">{title}</h2>
        <p className="premium-empty-state__description">{description}</p>

        {actions.length > 0 && (
          <div className="premium-empty-state__actions">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={action.onClick}
                className={`premium-empty-state__button ${action.variant || 'default'}`}
              >
                {action.icon && <action.icon size={16} />}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Decorative grid */}
      <div className="premium-empty-state__grid" />
    </div>
  )
}

/**
 * PremiumEmptyState с инструкциями (step-by-step)
 */
export function PremiumEmptyStateWithSteps({ title, description, icon: Icon, steps = [], action }) {
  return (
    <div className="premium-empty-state premium-empty-state--with-steps">
      <div className="premium-empty-state__particles" />

      <div className="premium-empty-state__content">
        {Icon && (
          <div className="premium-empty-state__icon-container">
            <Icon size={48} />
          </div>
        )}

        <h2 className="premium-empty-state__title">{title}</h2>
        <p className="premium-empty-state__description">{description}</p>

        {steps.length > 0 && (
          <div className="premium-empty-state__steps">
            {steps.map((step, i) => (
              <div key={i} className="premium-empty-state__step">
                <div className="premium-empty-state__step-number">{i + 1}</div>
                <div className="premium-empty-state__step-content">
                  <div className="premium-empty-state__step-title">{step.title}</div>
                  <div className="premium-empty-state__step-description">{step.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {action && (
          <button onClick={action.onClick} className="premium-empty-state__button primary">
            {action.icon && <action.icon size={16} />}
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
