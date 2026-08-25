import React from 'react'
import {
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  XCircle,
  Info,
} from 'lucide-react'

// ─── Collapsible panel ───────────────────────────────────────

export function CollapsePanel({ title, id, collapsed, onToggle, children }) {
  return (
    <div className="panel p-0 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between bg-transparent border-none cursor-pointer px-4 py-3"
      >
        <span className="text-[13px] font-semibold text-text-2">{title}</span>
        <ChevronRight
          size={14}
          className={`text-muted shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
        />
      </button>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

// ─── Premium Stat Card Component — PERF-002: memoized ───────

export const PremiumStatCard = React.memo(function PremiumStatCard({
  icon: Icon,
  label,
  value,
  subtext,
  trend,
  _trendValue,
  onClick,
  variant = 'default',
  statusBadge,
  progress,
}) {
  const trendIcon =
    trend === 'up' ? (
      <TrendingUp size={12} />
    ) : trend === 'down' ? (
      <TrendingDown size={12} />
    ) : (
      <Minus size={12} />
    )

  const TREND_CLASSES = { up: 'trend-positive', down: 'trend-negative', neutral: 'trend-neutral' }
  const trendClass = TREND_CLASSES[trend] || 'trend-neutral'

  return (
    <div className={`stat-card-premium stat-card-${variant}`} onClick={onClick}>
      {statusBadge && (
        <div className={`card-status-badge ${statusBadge.type}`}>
          {statusBadge.icon && <statusBadge.icon size={10} />}
          {statusBadge.label}
        </div>
      )}

      {progress !== undefined && (
        <div className="progress-ring-container">
          <svg className="progress-ring" width="40" height="40">
            <circle
              className="progress-ring-bg"
              strokeWidth="4"
              stroke="var(--separator)"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
            />
            <circle
              className="progress-ring-circle"
              strokeWidth="4"
              stroke="var(--accent)"
              fill="transparent"
              r="16"
              cx="20"
              cy="20"
              strokeDasharray={`${2 * Math.PI * 16} ${2 * Math.PI * 16}`}
              strokeDashoffset={2 * Math.PI * 16 * (1 - progress / 100)}
              strokeLinecap="round"
            />
          </svg>
          <div className="progress-ring-value">{progress}%</div>
        </div>
      )}

      <div className="stat-card-content">
        <div className="stat-card-icon">
          <Icon size={22} />
        </div>

        <div className="dashboard-stat-label">{label}</div>

        <div className="dashboard-stat-value">{value}</div>

        {subtext && (
          <div className={`dashboard-stat-sub ${trendClass}`}>
            {trend && <span className="trend-indicator">{trendIcon}</span>}
            {subtext}
          </div>
        )}
      </div>
    </div>
  )
})

PremiumStatCard.displayName = 'PremiumStatCard'

// ─── Smart Alert Card — PERF-002: memoized ──────────────────

export const SmartAlertCard = React.memo(function SmartAlertCard({ alert, onAction }) {
  const config = {
    error: { icon: XCircle, color: 'error' },
    warning: { icon: AlertTriangle, color: 'warning' },
    info: { icon: Info, color: 'info' },
  }[alert.level] || { icon: Info, color: 'info' }

  const Icon = config.icon

  return (
    <div className={`alert-card ${alert.level}`}>
      <div className="alert-card-icon">
        <Icon size={18} />
      </div>
      <div className="alert-card-content">
        <div className="alert-card-title">{alert.message}</div>
        {alert.description && <div className="alert-card-desc">{alert.description}</div>}
      </div>
      {alert.action && (
        <div className="alert-card-action">
          <button onClick={() => onAction(alert.action)}>{alert.actionLabel || 'View'}</button>
        </div>
      )}
    </div>
  )
})

SmartAlertCard.displayName = 'SmartAlertCard'
