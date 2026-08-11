// SPRINT3-DAY2: Structured logging for React frontend
// Simple logger wrapper with log levels and structured output

/**
 * Log levels
 */
export const LogLevel = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  SILENT: 5,
}

/**
 * Current log level (configurable via localStorage)
 */
let currentLevel = LogLevel.INFO

/**
 * Check if running in development mode
 */
const isDevelopment = import.meta.env.DEV

/**
 * Initialize logger with level from localStorage
 */
export function initLogger() {
  try {
    const savedLevel = localStorage.getItem('vaultbase_log_level')
    if (savedLevel !== null) {
      const level = parseInt(savedLevel, 10)
      if (!isNaN(level) && level >= LogLevel.TRACE && level <= LogLevel.SILENT) {
        currentLevel = level
      }
    } else {
      // Default: DEBUG in dev, INFO in prod
      currentLevel = isDevelopment ? LogLevel.DEBUG : LogLevel.INFO
    }
  } catch (e) {
    console.error('Failed to load log level from localStorage:', e)
  }
}

/**
 * Set current log level
 * @param {number} level - Log level from LogLevel enum
 */
export function setLogLevel(level) {
  if (level >= LogLevel.TRACE && level <= LogLevel.SILENT) {
    currentLevel = level
    try {
      localStorage.setItem('vaultbase_log_level', level.toString())
    } catch (e) {
      console.error('Failed to save log level to localStorage:', e)
    }
  }
}

/**
 * Get current log level
 * @returns {number} Current log level
 */
export function getLogLevel() {
  return currentLevel
}

/**
 * Format log message with timestamp and context
 */
function formatMessage(level, message, context = {}) {
  const timestamp = new Date().toISOString()
  const levelStr = Object.keys(LogLevel).find(key => LogLevel[key] === level) || 'UNKNOWN'

  return {
    timestamp,
    level: levelStr,
    message,
    ...context,
  }
}

/**
 * Check if log level is enabled
 */
function isLevelEnabled(level) {
  return level >= currentLevel
}

/**
 * Logger class
 */
class Logger {
  constructor(module) {
    this.module = module
  }

  /**
   * Log trace message (very verbose debugging)
   */
  trace(message, context = {}) {
    if (!isLevelEnabled(LogLevel.TRACE)) return
    const formatted = formatMessage(LogLevel.TRACE, message, { module: this.module, ...context })
    console.debug('[TRACE]', formatted)
  }

  /**
   * Log debug message (detailed debugging)
   */
  debug(message, context = {}) {
    if (!isLevelEnabled(LogLevel.DEBUG)) return
    const formatted = formatMessage(LogLevel.DEBUG, message, { module: this.module, ...context })
    console.debug('[DEBUG]', formatted)
  }

  /**
   * Log info message (general information)
   */
  info(message, context = {}) {
    if (!isLevelEnabled(LogLevel.INFO)) return
    const formatted = formatMessage(LogLevel.INFO, message, { module: this.module, ...context })
    console.info('[INFO]', formatted)
  }

  /**
   * Log warning message
   */
  warn(message, context = {}) {
    if (!isLevelEnabled(LogLevel.WARN)) return
    const formatted = formatMessage(LogLevel.WARN, message, { module: this.module, ...context })
    console.warn('[WARN]', formatted)
  }

  /**
   * Log error message
   */
  error(message, error = null, context = {}) {
    if (!isLevelEnabled(LogLevel.ERROR)) return
    const errorContext = error
      ? {
          error_message: error.message,
          error_stack: error.stack,
          error_name: error.name,
        }
      : {}
    const formatted = formatMessage(LogLevel.ERROR, message, {
      module: this.module,
      ...errorContext,
      ...context,
    })
    console.error('[ERROR]', formatted)
  }

  /**
   * Log security event
   */
  security(message, context = {}) {
    if (!isLevelEnabled(LogLevel.WARN)) return
    const formatted = formatMessage(LogLevel.WARN, message, {
      module: this.module,
      event_type: 'security',
      ...context,
    })
    console.warn('[SECURITY]', formatted)
  }

  /**
   * Log performance metric
   */
  metric(message, context = {}) {
    if (!isLevelEnabled(LogLevel.INFO)) return
    const formatted = formatMessage(LogLevel.INFO, message, {
      module: this.module,
      event_type: 'metric',
      ...context,
    })
    console.info('[METRIC]', formatted)
  }

  /**
   * Log API call
   */
  apiCall(method, endpoint, status, durationMs, context = {}) {
    if (!isLevelEnabled(LogLevel.DEBUG)) return
    const formatted = formatMessage(LogLevel.DEBUG, 'API call completed', {
      module: this.module,
      event_type: 'api_call',
      method,
      endpoint,
      status,
      duration_ms: durationMs,
      ...context,
    })
    console.debug('[API]', formatted)
  }

  /**
   * Measure function execution time
   */
  async measure(name, fn, context = {}) {
    const start = performance.now()
    try {
      const result = await fn()
      const duration = performance.now() - start
      this.metric(`${name} completed`, { duration_ms: duration.toFixed(2), ...context })
      return result
    } catch (error) {
      const duration = performance.now() - start
      this.error(`${name} failed`, error, { duration_ms: duration.toFixed(2), ...context })
      throw error
    }
  }
}

/**
 * Create logger for a module
 * @param {string} module - Module name (e.g., 'Cards', 'Orders', 'Auth')
 * @returns {Logger} Logger instance
 */
export function createLogger(module) {
  return new Logger(module)
}

/**
 * Global logger (for when module context is not available)
 */
export const logger = new Logger('Global')

// Initialize logger on module load
initLogger()
