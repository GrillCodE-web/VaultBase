import { describe, it, expect } from 'vitest'
import { detectImportKind, looksLikeProxyList, detectDelimiter, splitLines } from '../dropDetect.js'

describe('dropDetect', () => {
  it('распознаёт список прокси (ip:port)', () => {
    const text = '1.2.3.4:8080\n5.6.7.8:1080\n9.9.9.9:3128'
    expect(looksLikeProxyList(text)).toBe(true)
    expect(detectImportKind(text)).toBe('proxies')
  })

  it('распознаёт прокси с auth и схемой', () => {
    expect(detectImportKind('1.2.3.4:8080:user:pass')).toBe('proxies')
    expect(detectImportKind('socks5://u:p@1.2.3.4:1080')).toBe('proxies')
    expect(detectImportKind('http://1.2.3.4:8080')).toBe('proxies')
  })

  it('прокси-список с мусором >20% — не прокси', () => {
    const text = '1.2.3.4:8080\nnot a proxy\nhello world foo\n1.2.3.5:8080'
    expect(looksLikeProxyList(text)).toBe(false)
  })

  it('распознаёт CSV-подобные строки как rows', () => {
    expect(detectImportKind('John Doe | 123 Main St | New York | NY | 10001')).toBe('rows')
    expect(detectImportKind('a,b,c,d,e')).toBe('rows')
    expect(detectImportKind('a\tb\tc')).toBe('rows')
    expect(detectImportKind('x;y;z')).toBe('rows')
  })

  it('пустое и неструктурированное — null', () => {
    expect(detectImportKind('')).toBe(null)
    expect(detectImportKind('   \n  ')).toBe(null)
    expect(detectImportKind('just some plain words')).toBe(null)
    expect(detectImportKind('a,b')).toBe(null)
  })

  it('splitLines тримит и выкидывает пустые', () => {
    expect(splitLines('  a \r\n\n b \n   ')).toEqual(['a', 'b'])
  })

  it('detectDelimiter выбирает самый частый разделитель', () => {
    expect(detectDelimiter('a|b|c|d')).toBe('|')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
  })
})
