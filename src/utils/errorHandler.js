import {
  NetworkError,
  ValidationError,
  AuthenticationError,
  DatabaseError,
  EncryptionError,
  NotFoundError,
} from '../types/errors.js'

// Check if running in development mode
function isDevelopment() {
  const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : undefined
  return (
    nodeEnv === 'development' || (import.meta.env.DEV && !import.meta.env.MODE?.startsWith('test'))
  )
}

/**
 * Подписи прав для сообщений об отказе.
 *
 * Ключи должны совпадать с `perms` в src-tauri/src/models.rs — бэкенд
 * возвращает именно их в строке `permission_denied:<key>`. Полный список и
 * карта «право → команды» в docs/PERMISSIONS.md.
 */
const PERMISSION_LABELS = {
  view_stats_global: 'просмотр общей статистики',
  view_cards_pool: 'просмотр пула карт',
  take_cards: 'взятие карт',
  add_cards_manual: 'добавление карт',
  transfer_cards: 'передача карт',
  view_own_cards_full: 'просмотр своих карт полностью',
  create_orders: 'создание заказов',
  view_all_orders: 'просмотр всех заказов',
  manage_users: 'управление пользователями',
  manage_permissions: 'управление правами',
  export_data: 'экспорт данных',
  view_reports: 'аналитика и отчёты',
  manage_shops: 'управление магазинами',
  manage_emails: 'управление email-пулом',
  manage_proxies: 'управление прокси',
  view_couriers: 'просмотр курьеров',
  manage_couriers: 'управление курьерами',
  view_packages: 'просмотр посылок',
  create_packages: 'создание посылок',
  admin_only: 'права администратора',
}

/**
 * Sanitize error message for production logging (remove sensitive data)
 * @param {Error|string} error - Error to sanitize
 * @returns {string} Sanitized error message
 */
function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  // Remove potential sensitive patterns (card numbers, emails, tokens)
  return message
    .replace(/\b\d{13,19}\b/g, 'XXXX-XXXX-XXXX-XXXX') // Card numbers
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]') // Emails
    .replace(/(token|key|secret|password|cvv)=\S+/gi, '$1=[REDACTED]') // Sensitive params
}

/**
 * Centralized error handler that identifies error types and formats messages
 * @param {Error|string} error - The error to handle
 * @param {string} context - Context where the error occurred (e.g., 'Cards.fetchCards')
 * @returns {Object} Formatted error object with type, message, and details
 */
export function handleError(error, context = '') {
  // Production-safe logging - sanitize sensitive data
  if (isDevelopment()) {
    if (context) {
      console.error(`[${context}]`, error)
    } else {
      console.error(error)
    }
  } else {
    // Production: log only sanitized message
    const sanitized = sanitizeErrorMessage(error)
    if (context) {
      console.error(`[${context}]`, sanitized)
    } else {
      console.error(sanitized)
    }
  }

  // If it's already one of our custom errors, return formatted version
  if (
    error instanceof NetworkError ||
    error instanceof ValidationError ||
    error instanceof AuthenticationError ||
    error instanceof DatabaseError ||
    error instanceof EncryptionError ||
    error instanceof NotFoundError
  ) {
    return {
      type: error.name,
      code: error.code,
      message: error.message,
      details: error.details,
      context,
    }
  }

  // Convert string errors to Error objects
  const err = typeof error === 'string' ? new Error(error) : error
  const message = err.message || String(error)

  // Бэкенд отвечает `permission_denied:<key>` (или `key_a|key_b` для
  // require_any_perm) и `not_logged_in`. Ветка стоит ПЕРВОЙ среди классификаций:
  // ниже есть проверка на `invalid`, а `permission_denied:manage_...` её не
  // содержит, зато содержит `_denied` — но полагаться на порядок вслепую нельзя,
  // поэтому явная ветка идёт до всех остальных.
  // Без неё сырая строка вида "permission_denied:manage_proxies" попадала
  // прямо в тост пользователю. См. docs/PERMISSIONS.md.
  if (message.startsWith('permission_denied')) {
    const rawKeys = message.split(':')[1] || ''
    const labels = rawKeys
      .split('|')
      .map(k => PERMISSION_LABELS[k.trim()])
      .filter(Boolean)
    return {
      type: 'PermissionError',
      code: 'PERMISSION_DENIED',
      message: labels.length
        ? `Недостаточно прав: ${labels.join(' или ')}. Обратитесь к администратору.`
        : 'Недостаточно прав для этого действия. Обратитесь к администратору.',
      details: { originalMessage: message, permissions: rawKeys },
      context,
    }
  }

  if (message === 'not_logged_in' || message.includes('not_authenticated')) {
    return {
      type: 'AuthenticationError',
      code: 'NOT_LOGGED_IN',
      message: 'Сессия не активна. Войдите в систему заново.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('card_owned_by_another_user')) {
    return {
      type: 'PermissionError',
      code: 'CARD_NOT_OWNED',
      message: 'Эта карта закреплена за другим пользователем.',
      details: { originalMessage: message },
      context,
    }
  }

  // Classify error based on message content
  if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
    return {
      type: 'NetworkError',
      code: 'NETWORK_ERROR',
      message: 'Network connection failed. Please check your internet connection.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('not_found') || message.includes('not found')) {
    return {
      type: 'NotFoundError',
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('validation') || message.includes('invalid')) {
    return {
      type: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Validation failed. Please check your input.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('auth') || message.includes('unauthorized') || message.includes('unlock')) {
    return {
      type: 'AuthenticationError',
      code: 'AUTH_ERROR',
      message: 'Authentication failed. Please try again.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('database') || message.includes('sqlite') || message.includes('sql')) {
    return {
      type: 'DatabaseError',
      code: 'DATABASE_ERROR',
      message: 'Database operation failed. Please try again.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('encrypt') || message.includes('decrypt') || message.includes('crypto')) {
    return {
      type: 'EncryptionError',
      code: 'ENCRYPTION_ERROR',
      message: 'Encryption operation failed. Please check your password.',
      details: { originalMessage: message },
      context,
    }
  }

  // Generic error
  return {
    type: 'Error',
    code: 'UNKNOWN_ERROR',
    message: message || 'An unexpected error occurred.',
    details: { originalMessage: message },
    context,
  }
}

/**
 * Get user-friendly error message for toast notifications
 * @param {Error|string|Object} error - The error to format
 * @returns {string} User-friendly error message
 */
export function getErrorMessage(error) {
  // If it's already a formatted error object from handleError
  if (error && typeof error === 'object' && error.message) {
    return error.message
  }

  // If it's a custom error class
  if (error instanceof Error) {
    return error.message
  }

  // If it's a string
  if (typeof error === 'string') {
    return error
  }

  // Fallback
  return 'An unexpected error occurred.'
}

/**
 * Проверяет, что ошибка — именно отсутствие сессии, а не нехватка прав.
 *
 * Вызывающий код (App.jsx:174, :443) по true разлогинивает пользователя,
 * поэтому `permission_denied:*` сюда попадать НЕ должен: оператор без права
 * на прокси не должен вылетать из системы, открыв страницу прокси.
 * Сейчас это выполняется — ни один из ключей прав не содержит подстрок
 * `unauthorized|session_expired|not_logged_in|auth`. Если будете добавлять
 * шаблоны, проверьте, что `permission_denied:...` под них не подходит.
 * @param {Error|string|Object} error - The error to check
 * @returns {boolean}
 */
export function isUnauthorizedError(error) {
  const msg = typeof error === 'string' ? error : error?.message || String(error)
  if (msg.startsWith('permission_denied')) return false
  return /unauthorized|session_expired|not_logged_in|auth/i.test(msg)
}
