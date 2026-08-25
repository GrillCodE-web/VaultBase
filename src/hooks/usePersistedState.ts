import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { safeGetJSON, safeSetJSON } from '../utils/localStorage'

const SCHEMA_VERSION = 1
const PREFIX = 'vb_ui_'

interface StoredEnvelope<T> {
  _v: number
  data: T
}

function readStored<T>(key: string, defaultValue: T): T {
  const raw = safeGetJSON<StoredEnvelope<T>>(`${PREFIX}${key}`)
  if (!raw || raw._v !== SCHEMA_VERSION) return defaultValue
  return raw.data ?? defaultValue
}

function writeStored<T>(key: string, value: T): void {
  safeSetJSON(`${PREFIX}${key}`, { _v: SCHEMA_VERSION, data: value })
}

export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => readStored(key, defaultValue))
  const keyRef = useRef(key)
  useEffect(() => {
    keyRef.current = key
  })

  const setPersistedState = useCallback<Dispatch<SetStateAction<T>>>(valueOrFn => {
    setState(prev => {
      const next = typeof valueOrFn === 'function' ? (valueOrFn as (p: T) => T)(prev) : valueOrFn
      writeStored(keyRef.current, next)
      return next
    })
  }, [])

  return [state, setPersistedState]
}
