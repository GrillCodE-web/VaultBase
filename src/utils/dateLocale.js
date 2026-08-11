/**
 * I18N-006: Dynamic date locale based on current language setting.
 * Replaces hardcoded 'ru-RU' across the app.
 */

const LOCALE_MAP = {
  ru: 'ru-RU',
  en: 'en-US',
}

export function getDateLocale(lang) {
  return LOCALE_MAP[lang] || 'en-US'
}

export function formatDate(date, lang, options) {
  const locale = getDateLocale(lang)
  return new Date(date).toLocaleDateString(locale, options)
}

export function formatDateTime(date, lang) {
  const locale = getDateLocale(lang)
  return new Date(date).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatShortDate(date, lang) {
  const locale = getDateLocale(lang)
  return new Date(date).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
}
