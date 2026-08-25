// Маппинг стабильных кодов ошибок uPanel (бэкенд возвращает строки вида
// «upanel_invalid_token», «upanel_http_500», «upanel_api_error_400: detail»)
// на i18n-ключи. Перевода нет — t() отдаёт ключ как есть (допустимый fallback).

/**
 * Разобрать ошибку uPanel на { code, detail }.
 * @param {unknown} err — строка/ошибка из invoke()
 * @returns {{ code: string, detail: string } | null}
 */
export function splitUpanelError(err) {
  const raw = typeof err === 'string' ? err : err?.message || String(err ?? '')
  const m = raw.match(/^(upanel_[a-z0-9_]+)(?::\s*(.*))?$/i)
  if (!m) return null
  return { code: m[1], detail: m[2] || '' }
}

/**
 * Человекочитаемое сообщение об ошибке uPanel (готово для toast).
 * @param {unknown} err — reject из invoke()
 * @param {(key: string, params?: object) => string} t — переводчик useLang
 * @returns {string}
 */
export function presentUpanelError(err, t) {
  const parts = splitUpanelError(err)
  if (!parts) return String(err?.message ?? err ?? '')
  const { code, detail } = parts
  let msg
  if (code.startsWith('upanel_api_error_')) {
    msg = t('upanel_api_error')
  } else if (/^upanel_http_\d+$/.test(code)) {
    msg = t('upanel_http_error', { code: code.split('_').pop() })
  } else {
    msg = t(code)
  }
  return detail ? `${msg}: ${detail}` : msg
}
