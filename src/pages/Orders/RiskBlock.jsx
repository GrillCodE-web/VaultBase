import { useState } from 'react'
import {
  CheckCircle2,
  ShieldAlert,
  AlertTriangle,
  Wifi,
  ChevronDown,
  AlertCircle,
} from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { STATUS_COLORS } from '../../constants/colors.js'

export function RiskBlock({ result, loading }) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border text-[12px] text-muted">
        <div className="rounded-full shrink-0 w-3 h-3 border-[1.5px] border-border-hi border-t-text-2 animate-spin" />
        {t('risk_checking')}
      </div>
    )
  }
  if (!result) return null

  const config = {
    safe: {
      borderColor: `${STATUS_COLORS.success}33`,
      bg: `${STATUS_COLORS.success}0D`,
      iconColor: STATUS_COLORS.success,
      label: t('risk_safe'),
      textColor: STATUS_COLORS.success,
    },
    warning: {
      borderColor: `${STATUS_COLORS.warning}33`,
      bg: `${STATUS_COLORS.warning}0D`,
      iconColor: STATUS_COLORS.warning,
      label:
        t('risk_warning') +
        ': ' +
        result.score +
        ' ' +
        (result.score !== 1 ? t('risk_issues') : t('risk_issue')),
      textColor: STATUS_COLORS.warning,
    },
    high: {
      borderColor: `${STATUS_COLORS.error}33`,
      bg: `${STATUS_COLORS.error}0D`,
      iconColor: STATUS_COLORS.error,
      label:
        t('risk_high') +
        ': ' +
        result.score +
        ' ' +
        (result.score !== 1 ? t('risk_issues') : t('risk_issue')),
      textColor: STATUS_COLORS.error,
    },
  }
  const c = config[result.level] || config.safe

  const IconComponent =
    result.level === 'safe' ? CheckCircle2 : result.level === 'high' ? ShieldAlert : AlertTriangle

  return (
    <div
      className={`rounded-lg overflow-hidden risk-block ${
        result.level === 'safe'
          ? 'risk-block-safe'
          : result.level === 'high'
            ? 'risk-block-high-risk'
            : 'risk-block-warning'
      }`}
    >
      <button
        onClick={() => result.warnings?.length && setOpen(o => !o)}
        className={`flex items-center justify-between w-full px-3 py-2 text-[12px] bg-transparent border-none text-text ${
          result.warnings?.length ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex items-center gap-2">
          <IconComponent
            size={14}
            className={`risk-icon ${
              result.level === 'safe'
                ? 'risk-icon-safe'
                : result.level === 'high'
                  ? 'risk-icon-high-risk'
                  : 'risk-icon-warning'
            }`}
          />
          <span
            className={`font-medium ${
              result.level === 'safe'
                ? 'risk-text-safe'
                : result.level === 'high'
                  ? 'risk-text-high-risk'
                  : 'risk-text-warning'
            }`}
          >
            {c.label}
          </span>
          {result.offline && (
            <span className="flex items-center gap-1 text-[11px] risk-offline-text">
              <Wifi size={11} /> {t('license_offline')}
            </span>
          )}
        </div>
        {result.warnings?.length > 0 && (
          <ChevronDown
            size={13}
            className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {open && result.warnings?.length > 0 && (
        <div className="border-t border-border">
          {result.warnings.map((w, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 px-3 py-2 text-[12px] ${
                i < result.warnings.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              {w.severity === 'high' ? (
                <AlertTriangle size={11} className="shrink-0 mt-0.5 risk-icon-high-risk" />
              ) : (
                <AlertCircle size={11} className="shrink-0 mt-0.5 risk-icon-warning" />
              )}
              <span className="text-text-2">{w.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
