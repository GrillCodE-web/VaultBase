import { useState, useCallback, createContext, useContext } from 'react'
import { en } from '../i18n/en.js'
import { ru } from '../i18n/ru.js'

const LANGS = { en, ru }
const STORAGE_KEY = 'vaultbase_lang'

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'en')

  const setLang = useCallback(code => {
    localStorage.setItem(STORAGE_KEY, code)
    setLangState(code)
  }, [])

  const t = useCallback(
    (key, vars) => {
      const str = LANGS[lang]?.[key] ?? LANGS.en?.[key] ?? key
      if (!vars) return str
      return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
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
