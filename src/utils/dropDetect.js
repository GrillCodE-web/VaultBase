// REDESIGN-05-6: определение типа перетащенного файла для D&D-импорта.
// Чистые функции без tauri/DOM — покрыты vitest (utils/__tests__/dropDetect.test.js).

// ip:port | ip:port:user:pass | scheme://[user:pass@]ip:port
const PROXY_RE =
  /^(?:(?:https?|socks[45]):\/\/)?(?:[^\s:]+:[^\s:]+@)?(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}(?::[^\s:]+:[^\s:]+)?$/i

export function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
}

export function looksLikeProxyList(text) {
  const lines = splitLines(text)
  if (lines.length === 0) return false
  const hits = lines.filter(l => PROXY_RE.test(l)).length
  return hits / lines.length >= 0.8
}

const DELIMITERS = ['\t', '|', ';', ',']

export function detectDelimiter(text) {
  const first = splitLines(text)[0]
  if (!first) return null
  let best = null
  let bestCols = 1
  for (const d of DELIMITERS) {
    const cols = first.split(d).length
    if (cols > bestCols) {
      best = d
      bestCols = cols
    }
  }
  return bestCols >= 3 ? best : null
}

/**
 * Тип содержимого: 'proxies' — список прокси, 'rows' — CSV-подобные строки
 * (дропы), null — ничего импортируемого не распознано.
 */
export function detectImportKind(text) {
  if (!text || !text.trim()) return null
  if (looksLikeProxyList(text)) return 'proxies'
  if (detectDelimiter(text)) return 'rows'
  return null
}
