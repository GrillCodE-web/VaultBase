import { useState, useCallback, useRef, useEffect } from 'react'
import { safeGetJSON, safeSetJSON } from '../utils/localStorage'

const SCHEMA_VERSION = 1
const PREFIX = 'vb_ui_'

function readStored(key, defaultValue) {
  const raw = safeGetJSON(`${PREFIX}${key}`)
  if (!raw || raw._v !== SCHEMA_VERSION) return defaultValue
  return raw.data ?? defaultValue
}

function writeStored(key, value) {
  safeSetJSON(`${PREFIX}${key}`, { _v: SCHEMA_VERSION, data: value })
}

export function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => readStored(key, defaultValue))
  const keyRef = useRef(key)
  useEffect(() => {
    keyRef.current = key
  })

  const setPersistedState = useCallback(valueOrFn => {
    setState(prev => {
      const next = typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn
      writeStored(keyRef.current, next)
      return next
    })
  }, [])

  return [state, setPersistedState]
}
