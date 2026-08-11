/**
 * I18N-005: Russian pluralization utility
 * @param {number} count
 * @param {[string, string, string]} forms - [one, few, many] e.g. ['заказ', 'заказа', 'заказов']
 * @returns {string} e.g. "5 заказов"
 */
export function pluralize(count, forms) {
  const abs = Math.abs(count)
  const mod10 = abs % 10
  const mod100 = abs % 100

  let idx
  if (mod10 === 1 && mod100 !== 11) {
    idx = 0
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    idx = 1
  } else {
    idx = 2
  }

  return `${count} ${forms[idx]}`
}

/**
 * English pluralization (simpler)
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural] - defaults to singular + 's'
 * @returns {string}
 */
export function pluralizeEn(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural || singular + 's'}`
}
