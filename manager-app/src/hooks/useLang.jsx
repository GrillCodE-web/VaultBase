import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { dict as en } from '../i18n/en.js'
import { dict as ru } from '../i18n/ru.js'

const LangContext = createContext(null)
const DICTS = { en, ru }

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const stored = localStorage.getItem('vb-mgr-lang')
      if (stored === 'ru' || stored === 'en') return stored
    } catch { /* localStorage unavailable */ }
    return (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en'
  })

  useEffect(() => {
    try {
      localStorage.setItem('vb-mgr-lang', lang)
    } catch { /* ignore */ }
  }, [lang])

  const t = useCallback((key, params) => {
    let s = DICTS[lang][key] ?? DICTS.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.split(`{${k}}`).join(String(v))
      }
    }
    return s
  }, [lang])

  return (
    <LangContext.Provider value={{ t, lang, setLang }}>
      {children}
    </LangContext.Provider>
  )
}

export const useLang = () => useContext(LangContext)
