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
      // FINAL-011: Fallback to raw key when label is missing
      .map(k => PERMISSION_LABELS[k.trim()] || k.trim())
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

  // База заблокирована (приложение заперто / мастер-пароль не введён).
  // Приходит из практически каждой команды Rust как "database_locked".
  if (message === 'database_locked' || message.includes('database is locked')) {
    return {
      type: 'DatabaseError',
      code: 'DATABASE_LOCKED',
      message: 'База данных заблокирована. Разблокируйте приложение мастер-паролем.',
      suggestion: 'Если приложение только что запущено — введите мастер-пароль.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message === 'invalid_master_password') {
    return {
      type: 'AuthenticationError',
      code: 'INVALID_MASTER_PASSWORD',
      message: 'Неверный мастер-пароль.',
      suggestion: 'Проверьте раскладку клавиатуры и попробуйте ещё раз.',
      details: { originalMessage: message },
      context,
    }
  }

  // Ошибки интеграции Stuffer. Ветка стоит ДО общих проверок на
  // `invalid`/`validation`: текст ошибки Stuffer-сервера подставляется
  // дословно и часто содержит слово "invalid", из-за чего пользователь видел
  // бессмысленное «Validation failed. Please check your input.» вместо
  // настоящей причины — например, что API-ключ вообще не задан.
  if (message.startsWith('stuffer_')) {
    let human
    if (message.includes('not_configured')) {
      human = 'Stuffer не настроен: укажите API-ключ в Настройках.'
    } else if (message.includes('network_error')) {
      human = 'Нет связи со Stuffer API. Проверьте интернет и base URL.'
    } else if (/stuffer_http_(401|403)/.test(message)) {
      human = 'Stuffer отклонил API-ключ. Проверьте его в Настройках.'
    } else if (message.includes('stuffer_http_404')) {
      human = 'Stuffer: адрес не найден. Проверьте base URL в Настройках.'
    } else {
      // stuffer_api_error:<код>: <текст сервера> — показываем как есть,
      // это единственный источник правды о том, что не понравилось Stuffer.
      const detail = message.split(':').slice(1).join(':').trim()
      human = detail ? `Stuffer: ${detail}` : 'Ошибка Stuffer API.'
    }
    return {
      type: 'StufferError',
      code: 'STUFFER_ERROR',
      message: human,
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
      message: 'Ошибка сети. Проверьте подключение к интернету.',
      suggestion: 'Убедитесь, что интернет работает, и попробуйте ещё раз.',
      details: { originalMessage: message },
      context,
    }
  }

  // ERR-005: Stuffer API — humanize HTTP-коды (stuffer_http_401 и т.п.)
  const stufferHttp = message.match(/^stuffer_http_(\d{3})/)
  if (stufferHttp) {
    const code = stufferHttp[1]
    const human =
      {
        400: 'Stuffer отклонил запрос — проверьте данные (адрес, трек-номер).',
        401: 'Stuffer: неверный API-ключ.',
        403: 'Stuffer: доступ запрещён — проверьте тариф или права ключа.',
        404: 'Stuffer: объект не найден (посылка/курьер удалён?).',
        429: 'Stuffer: слишком много запросов — подождите немного.',
      }[code] ||
      (code.startsWith('5')
        ? 'Stuffer: сбой на стороне сервера — попробуйте позже.'
        : `Stuffer вернул ошибку HTTP ${code}.`)
    return {
      type: 'ExternalServiceError',
      code: `STUFFER_HTTP_${code}`,
      message: human,
      suggestion: 'Проверьте API-ключ Stuffer в настройках или повторите позже.',
      details: { originalMessage: message, httpStatus: Number(code) },
      context,
    }
  }
  if (message.startsWith('stuffer_api_error')) {
    return {
      type: 'ExternalServiceError',
      code: 'STUFFER_API_ERROR',
      message: 'Ошибка API Stuffer.',
      suggestion: 'Проверьте API-ключ Stuffer в настройках или повторите позже.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('not_found') || message.includes('not found')) {
    return {
      type: 'NotFoundError',
      code: 'NOT_FOUND',
      message: 'Запрашиваемый ресурс не найден.',
      suggestion: 'Возможно, он был удалён. Обновите список.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('validation') || message.includes('invalid')) {
    return {
      type: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Ошибка валидации. Проверьте введённые данные.',
      suggestion: 'Убедитесь, что все обязательные поля заполнены корректно.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('auth') || message.includes('unauthorized') || message.includes('unlock')) {
    return {
      type: 'AuthenticationError',
      code: 'AUTH_ERROR',
      message: 'Ошибка аутентификации.',
      suggestion: 'Попробуйте ввести пароль заново или перезайти в систему.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('database') || message.includes('sqlite') || message.includes('sql')) {
    return {
      type: 'DatabaseError',
      code: 'DATABASE_ERROR',
      message: 'Ошибка базы данных.',
      suggestion: 'Попробуйте ещё раз. Если повторяется — перезапустите приложение.',
      details: { originalMessage: message },
      context,
    }
  }

  if (message.includes('encrypt') || message.includes('decrypt') || message.includes('crypto')) {
    return {
      type: 'EncryptionError',
      code: 'ENCRYPTION_ERROR',
      message: 'Ошибка шифрования.',
      suggestion: 'Проверьте правильность мастер-пароля.',
      details: { originalMessage: message },
      context,
    }
  }

  // Generic error
  return {
    type: 'Error',
    code: 'UNKNOWN_ERROR',
    message: message || 'Произошла непредвиденная ошибка.',
    suggestion: 'Попробуйте ещё раз или перезапустите приложение.',
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
  if (error && typeof error === 'object' && error.message) {
    return error.suggestion ? `${error.message} ${error.suggestion}` : error.message
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Произошла непредвиденная ошибка.'
}

export function getErrorTitle(error) {
  if (error && typeof error === 'object' && error.message) return error.message
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Произошла непредвиденная ошибка.'
}

export function getErrorSuggestion(error) {
  if (error && typeof error === 'object' && error.suggestion) return error.suggestion
  return null
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
