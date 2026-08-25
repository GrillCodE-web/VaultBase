import { useState, useCallback, createContext, useContext } from 'react'
import { en } from '../i18n/en.js'
import { ru } from '../i18n/ru.js'
// FIX CRITICAL: Use safe localStorage operations
import { safeGetItem, safeSetItem } from '../utils/localStorage'

const LANGS = { en, ru }
const STORAGE_KEY = 'vaultbase_lang'

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => safeGetItem(STORAGE_KEY) || 'en')

  const setLang = useCallback(code => {
    // FIX CRITICAL: Use safe localStorage
    safeSetItem(STORAGE_KEY, code)
    setLangState(code)
  }, [])

  const t = useCallback(
    (key, params) => {
      let str = LANGS[lang]?.[key] ?? LANGS.en?.[key] ?? key
      if (params && typeof str === 'string') {
        for (const [k, v] of Object.entries(params)) {
          str = str.replaceAll(`{${k}}`, String(v))
        }
      }
      return str
    },
    [lang]
  )

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook export pattern
export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>')
  return ctx
}
