import { invoke } from '@tauri-apps/api/core'

/**
 * ERR-006: auto-retry для failed invoke() с экспоненциальным backoff.
 *
 * Ретраим только транзиентные ошибки (SQLite busy, таймауты сети).
 * Бизнес-ошибки (auth, validation, permission) ретраить бессмысленно.
 */

const NO_RETRY_MARKERS = [
  'database_locked', // приложение заперто мастер-паролем — ждать бесполезно
  'invalid_master_password',
  'not_logged_in',
  'not_authenticated',
  'permission_denied',
  'domain_already_routed',
  'invalid_',
  'required',
  'already_exists',
]

const DEFAULT_RETRIES = 2
const BASE_DELAY_MS = 400

/**
 * @param {string} cmd — имя Tauri-команды
 * @param {object} [args] — аргументы команды
 * @param {object} [opts]
 * @param {number} [opts.retries=2] — число повторных попыток (итого 1 + retries)
 * @param {number} [opts.baseDelay=400] — базовая задержка, удваивается каждую попытку
 * @param {(msg: string) => boolean} [opts.shouldRetry] — кастомный предикат retryable
 */
export async function invokeWithRetry(cmd, args, opts = {}) {
  const { retries = DEFAULT_RETRIES, baseDelay = BASE_DELAY_MS, shouldRetry } = opts

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await invoke(cmd, args)
    } catch (e) {
      lastError = e
      const msg = String(e?.message ?? e)
      const retryable = shouldRetry
        ? shouldRetry(msg)
        : !NO_RETRY_MARKERS.some(marker => msg.includes(marker))
      if (!retryable || attempt === retries) break
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)))
    }
  }
  throw lastError
}
