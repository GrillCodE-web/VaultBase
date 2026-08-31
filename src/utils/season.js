/**
 * REDESIGN-05-4 (порция 5): сезонные акценты. Возвращает ключ сезона по
 * текущей дате или null — вне сезонных окон атрибут не выставляется и
 * визуал не меняется (важно для скриншотных диффов).
 */
export function getSeason(date = new Date()) {
  const m = date.getMonth() // 0-based
  const d = date.getDate()
  if (m === 11 && d >= 15) return 'winter' // 15–31 декабря
  if (m === 0 && d <= 10) return 'winter' // 1–10 января
  if (m === 9 && d >= 25) return 'halloween' // 25–31 октября
  return null
}

/** Выставить data-season на <html> (или снять вне сезона). */
export function applySeasonAttr(date) {
  const season = getSeason(date)
  if (season) document.documentElement.dataset.season = season
  else delete document.documentElement.dataset.season
  return season
}
