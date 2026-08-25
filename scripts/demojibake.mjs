// Исправляет mojibake (UTF-8, однажды прочитанный как Windows-1251).
// Сухой прогон:  node scripts/demojibake.mjs <files...>
// Запись:        node scripts/demojibake.mjs --apply <files...>
//
// Механика: ищем максимальные «прогоны» символов из cp1251-алфавита моджибейка
// (лид-байты Р С В Г в + continuation-байты 0x80–0xBF в cp1251-маппинге),
// конвертируем char→cp1251 byte→utf8. Замена принимается только если
// roundtrip сходится и результат — кириллица/цифры/типографика.

import fs from 'node:fs'

const cp1251 = new TextDecoder('windows-1251')

// char → byte для всех continuation-байтов 0x80..0xBF
const CONT = {}
for (let b = 0x80; b <= 0xbf; b++) CONT[cp1251.decode(Uint8Array.of(b))] = b
// лид-байты UTF-8 кириллицы/типографики/лат1: D0 D1 C2 C3 E2
const LEAD = {}
for (const b of [0xd0, 0xd1, 0xc2, 0xc3, 0xe2]) LEAD[cp1251.decode(Uint8Array.of(b))] = b

const CHARSET = new Set([...Object.keys(CONT), ...Object.keys(LEAD)])
const BYTE_OF = { ...CONT, ...LEAD }

const isCyrillic = ch => ch >= 'Ѐ' && ch <= 'ӿ'
const OK_PUNCT = new Set([
  ...'—–…•·─│┌┐└┘├┤┬┴┼«»№()[]{}.,:;!?*#%/\\+-=<> ',
  '“', '”', '‘', '’', "'",
])
const isOkPunct = ch => OK_PUNCT.has(ch)

function decodeRun(run) {
  const bytes = Uint8Array.from([...run].map(c => BYTE_OF[c]))
  let out
  try {
    out = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  // roundtrip: результат обязан кодироваться обратно в те же байты
  if (Buffer.from(out, 'utf8').compare(Buffer.from(bytes)) !== 0) return null
  if (![...out].every(c => isCyrillic(c) || isOkPunct(c) || /\d/.test(c))) return null
  return out
}

function fixLine(line) {
  let res = ''
  let run = ''
  const flush = () => {
    if (run.length >= 2) {
      const dec = decodeRun(run)
      res += dec ?? run
    } else {
      res += run
    }
    run = ''
  }
  for (const ch of line) {
    if (CHARSET.has(ch)) {
      run += ch
    } else {
      flush()
      res += ch
    }
  }
  flush()
  return res
}

const apply = process.argv[2] === '--apply'
const files = process.argv.slice(apply ? 3 : 2)
let totalChanged = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const out = lines.map((line, i) => {
    const fixed = fixLine(line)
    if (fixed !== line) {
      totalChanged++
      console.log(`${file}:${i + 1}`)
      console.log('  - ' + line.trim().slice(0, 120))
      console.log('  + ' + fixed.trim().slice(0, 120))
    }
    return fixed
  })
  if (apply) fs.writeFileSync(file, out.join('\n'))
}

console.log(`\n${totalChanged} строк изменено${apply ? '' : ' (dry-run, без записи)'}`)
