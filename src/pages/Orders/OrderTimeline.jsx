import { ORDER_STATUS_STEPS } from '../../constants/status.js'
import { STATUS_COLORS } from '../../constants/colors.js'

export function OrderTimeline({ status, updatedAt }) {
  const isTerminal = status === 'cancelled' || status === 'declined'
  const steps = isTerminal ? [...ORDER_STATUS_STEPS.slice(0, 2), status] : ORDER_STATUS_STEPS
  const currentIdx = steps.indexOf(status)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const isPast = i < currentIdx
          const isCurrent = i === currentIdx
          const isFuture = i > currentIdx
          const color = isCurrent
            ? status === 'delivered'
              ? 'var(--green)'
              : status === 'declined' || status === 'cancelled'
                ? 'var(--red)'
                : 'var(--blue)'
            : isPast
              ? 'var(--green)'
              : 'var(--border)'
          const glowColor = isCurrent
            ? status === 'delivered'
              ? `${STATUS_COLORS.success}80`
              : status === 'declined' || status === 'cancelled'
                ? `${STATUS_COLORS.error}80`
                : `${STATUS_COLORS.info}80`
            : 'none'
          return (
            <div
              key={step}
              className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : 'flex-0'}`}
            >
              <div className="flex flex-col items-center gap-0\.5">
                <div
                  className={`rounded-full shrink-0 transition-all duration-200 timeline-status-dot ${
                    isCurrent ? 'timeline-status-dot-current' : ''
                  } ${
                    isCurrent && status === 'delivered' ? 'timeline-status-dot-glow-green' : ''
                  } ${
                    isCurrent && (status === 'declined' || status === 'cancelled')
                      ? 'timeline-status-dot-glow-red'
                      : ''
                  } ${isCurrent && status !== 'delivered' && status !== 'declined' && status !== 'cancelled' && status !== 'pending' ? 'timeline-status-dot-glow-blue' : ''}`}
                  style={{
                    background: color,
                    boxShadow: isCurrent ? `0 0 0 3px ${glowColor}, 0 0 12px ${glowColor}` : 'none',
                  }}
                />
                <span
                  className={`text-10 whitespace-nowrap ${isFuture ? 'text-muted' : 'text-text-2'} ${isCurrent ? 'font-semibold' : 'font-normal'}`}
                >
                  {step}
                </span>
                {isCurrent && updatedAt && (
                  <span className="text-9 text-muted whitespace-nowrap">
                    {updatedAt.slice(0, 10)}
                  </span>
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`flex-1 rounded-sm mx-1.5 mb-4 min-w-[40px] timeline-connector ${
                    isPast ? 'timeline-connector-past' : 'timeline-connector-pending'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
