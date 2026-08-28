import { useLang } from '../hooks/useLang'

/**
 * ARCH-015 / UX-003: Unified loading/empty/error state wrapper.
 *
 * @param {{ loading: boolean, error: string|null, empty: boolean, children: React.ReactNode,
 *           emptyIcon?: React.ReactNode, emptyTitle?: string, emptySubtitle?: string,
 *           onRetry?: Function }} props
 */
export default function DataLoader({
  loading,
  error,
  empty,
  children,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
  onRetry,
}) {
  const { t } = useLang()

  if (loading) {
    return (
      <div className="data-loader-state data-loader-loading">
        <div className="loading-spinner" />
        <span className="text-muted text-sm">{t('msg_loading')}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="data-loader-state data-loader-error">
        <span className="text-red-400 text-sm">{error}</span>
        {onRetry && (
          <button className="btn btn-ghost btn-sm mt-2" onClick={onRetry}>
            {t('float_retry')}
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    return (
      <div className="data-loader-state data-loader-empty">
        {emptyIcon && <div className="mb-2">{emptyIcon}</div>}
        <span className="text-muted text-sm">{emptyTitle || t('msg_no_data')}</span>
        {emptySubtitle && <span className="text-muted text-xs mt-1">{emptySubtitle}</span>}
      </div>
    )
  }

  return children
}
