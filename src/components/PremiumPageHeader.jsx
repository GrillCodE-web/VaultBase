import { ChevronDown, Plus, RefreshCw, Download, Settings, Search } from 'lucide-react'

/**
 * PremiumPageHeader — универсальный премиум-заголовок для страниц
 *
 * @param {string} title - Заголовок страницы
 * @param {string} subtitle - Подзаголовок (опционально)
 * @param {number} totalCount - Общее количество элементов (опционально)
 * @param {Array} actions - Массив кнопок действий
 * @param {Function} onRefresh - Callback обновления
 * @param {boolean} loading - Состояние загрузки
 */
export function PremiumPageHeader({
  title,
  subtitle,
  totalCount,
  actions = [],
  onRefresh,
  loading = false,
}) {
  return (
    <div className="premium-page-header">
      <div className="premium-page-header__content">
        <div className="premium-page-header__title-group">
          <h1 className="premium-page-header__title">{title}</h1>
          {totalCount !== undefined && (
            <span className="premium-page-header__count" aria-live="polite">
              {totalCount.toLocaleString()}
            </span>
          )}
        </div>
        {subtitle && <p className="premium-page-header__subtitle">{subtitle}</p>}
      </div>

      <div className="premium-page-header__actions">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className={`premium-icon-button ${loading ? 'spinning' : ''}`}
            aria-label="Refresh"
          >
            <RefreshCw size={18} />
          </button>
        )}
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={action.onClick}
            className={`premium-action-button ${action.variant || 'default'}`}
            disabled={action.disabled}
          >
            {action.icon && <action.icon size={16} />}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * PremiumPageHeader с расширенными возможностями для страниц с фильтрами
 */
export function PremiumPageHeaderWithFilters({
  title,
  totalCount,
  children,
  onRefresh,
  loading = false,
  primaryAction,
}) {
  return (
    <div className="premium-page-header premium-page-header--with-filters">
      <div className="premium-page-header__top">
        <div className="premium-page-header__title-group">
          <h1 className="premium-page-header__title">{title}</h1>
          {totalCount !== undefined && (
            <span className="premium-page-header__count" aria-live="polite">
              {totalCount.toLocaleString()}
            </span>
          )}
        </div>

        <div className="premium-page-header__actions">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className={`premium-icon-button ${loading ? 'spinning' : ''}`}
              aria-label="Refresh"
            >
              <RefreshCw size={18} />
            </button>
          )}
          {primaryAction && (
            <button onClick={primaryAction.onClick} className="premium-action-button primary">
              {primaryAction.icon && <primaryAction.icon size={16} />}
              {primaryAction.label}
            </button>
          )}
        </div>
      </div>

      {children && <div className="premium-page-header__filters">{children}</div>}
    </div>
  )
}
