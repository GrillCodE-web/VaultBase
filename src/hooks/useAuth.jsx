import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { handleError } from '../utils/errorHandler.js'
import { invoke } from '@tauri-apps/api/core'
import { safeSetItem, safeGetItem, safeRemoveItem } from '../utils/localStorage'
import { useCardsStore } from '../store/cards'
import { useOrdersStore } from '../store/orders'
import { useUIStore } from '../store/ui'
import { useToast } from './useSmartToast.jsx'
import { useLang } from './useLang.jsx'
import { logger } from '../utils/logger.js'

const AuthContext = createContext(null)

const EXPIRES_KEY = 'cc_session_expires'

/** FEAT-017: true, если сохранённая сессия уже истекла (по клиентским часам). */
// eslint-disable-next-line react-refresh/only-export-components -- утилита рядом с провайдером намеренно
export function isSessionExpired() {
  const raw = safeGetItem(EXPIRES_KEY)
  if (!raw) return false // срок неизвестен — не блокируем
  const expires = Date.parse(raw.replace(' ', 'T') + 'Z')
  return Number.isFinite(expires) && expires <= Date.now()
}

function persistExpiry(result) {
  if (result?.expires_at) safeSetItem(EXPIRES_KEY, result.expires_at)
}

// FEAT-016: sliding-refresh — если до истечения < 24ч, просим бэкенд продлить
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const REFRESH_THRESHOLD_MS = 24 * 3600 * 1000

// MGR-005: политики менеджера. Тик идемпотентен: сам heartbeat gated на бэкенде
// (по умолчанию раз в 5 минут), а снапшот политики читается из памяти.
const POLICY_POLL_MS = 60 * 1000

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  // MGR-005: активная политика воркера (ban/update/override/квоты/force_logout)
  const [policy, setPolicy] = useState(null)

  const refreshPolicy = useCallback(async () => {
    try {
      setPolicy(await invoke('telemetry_get_policy'))
    } catch (e) {
      logger.debug('[Auth] policy snapshot unavailable:', e?.message ?? e)
    }
  }, [])

  const login = useCallback(
    async (username, password) => {
      const result = await invoke('user_login', {
        username,
        password,
        ipAddress: null,
        deviceInfo: navigator.userAgent ?? null,
      })
      setCurrentUser(result)
      persistExpiry(result)
      refreshPolicy() // MGR-005: политика восстановлена бэкендом — подтягиваем сразу
      // FINAL-013: Check if token was saved, warn if localStorage is full
      const saved = safeSetItem('cc_session_token', result.token)
      if (!saved) {
        console.error('[Auth] Failed to persist session token — session will not survive reload')
      }
      return result
    },
    [refreshPolicy]
  )

  const logout = useCallback(async () => {
    if (currentUser?.token) {
      try {
        await invoke('user_logout', { token: currentUser.token })
      } catch (e) {
        console.warn('[Auth] Logout request failed:', e.message)
      }
    }
    setCurrentUser(null)
    // SEC-010/SEC-014: Clear all sensitive data from stores on logout
    useCardsStore.getState().clearSensitiveData()
    useOrdersStore.getState().clearSensitiveData()
    useUIStore.getState().clearSensitiveData()
    try {
      safeRemoveItem('cc_session_token')
      safeRemoveItem(EXPIRES_KEY)
    } catch (e) {
      console.warn('[Auth] Failed to remove session token:', e.message)
    }
  }, [currentUser])

  const autoLogin = useCallback(async () => {
    try {
      const result = await invoke('try_auto_login', {
        ipAddress: null,
        deviceInfo: navigator.userAgent ?? null,
      })
      if (!result) return null
      setCurrentUser(result)
      persistExpiry(result)
      refreshPolicy() // MGR-005
      try {
        safeSetItem('cc_session_token', result.token)
      } catch (e) {
        console.warn('[Auth] Failed to save session token:', e.message)
      }
      return result
    } catch (e) {
      handleError(e)
      return null
    }
  }, [refreshPolicy])

  const resumeSession = useCallback(async () => {
    try {
      const token = safeGetItem('cc_session_token')
      if (!token) return null
      const result = await invoke('resume_session', { token })
      setCurrentUser(result)
      persistExpiry(result)
      refreshPolicy() // MGR-005
      return result
    } catch (e) {
      handleError(e)
      try {
        safeRemoveItem('cc_session_token')
      } catch (e) {
        handleError(e)
        /* ignore */
      }
      return null
    }
  }, [refreshPolicy])

  // MGR-005: permissions_override мержится поверх models::perms — явный false
  // режет право даже админу (килсвитч менеджера), явный true — выдаёт.
  const hasPerm = useCallback(
    key => {
      if (!currentUser) return false
      const ov = policy?.permissions_override
      if (ov && typeof ov === 'object' && Object.prototype.hasOwnProperty.call(ov, key)) {
        return !!ov[key]
      }
      if (currentUser.role === 'admin') return true
      return currentUser.permissions?.includes(key) ?? false
    },
    [currentUser, policy]
  )

  const isAdmin = currentUser?.role === 'admin'

  // FEAT-016: периодический sliding-refresh сессии. Раз в 5 минут смотрим на
  // сохранённый expires_at; если до истечения < 24ч — продлеваем на бэкенде.
  // session_expired → полный logout (токен мёртв, refresh бессмысленнен).
  const logoutRef = useRef(logout)
  useEffect(() => {
    logoutRef.current = logout
  }, [logout])

  const currentUserRef = useRef(currentUser)
  useEffect(() => {
    currentUserRef.current = currentUser
  }, [currentUser])

  const { toast } = useToast()
  const { t } = useLang()
  const toastRef = useRef(toast)
  const tRef = useRef(t)
  useEffect(() => {
    toastRef.current = toast
    tRef.current = t
  }, [toast, t])

  // MGR-005: поллинг политик. Тик запускает heartbeat/daily_stats по расписанию
  // (бэкенд сам следит за интервалами), затем читаем снапшот из памяти.
  // Работает и без залогиненного пользователя — ack force_logout должен уйти
  // даже когда воркер уже выкинут на экран логина.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        await invoke('telemetry_tick', {})
        const p = await invoke('telemetry_get_policy')
        if (cancelled) return
        setPolicy(p)
        if (p?.force_logout && currentUserRef.current) {
          toastRef.current(tRef.current('policy_force_logout_toast'), 'error')
          await logoutRef.current()
        }
      } catch (e) {
        // база заперта / лицензии нет — до политики сейчас не добраться
        logger.debug('[Auth] policy poll skipped:', e?.message ?? e)
      }
    }
    tick()
    const timer = setInterval(tick, POLICY_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (!currentUser?.token) return undefined
    const tick = async () => {
      const raw = safeGetItem(EXPIRES_KEY)
      if (!raw) return
      const expires = Date.parse(raw.replace(' ', 'T') + 'Z')
      if (!Number.isFinite(expires)) return
      const left = expires - Date.now()
      if (left > REFRESH_THRESHOLD_MS) return
      try {
        const refreshed = await invoke('refresh_session', { token: currentUser.token })
        setCurrentUser(refreshed)
        persistExpiry(refreshed)
      } catch (e) {
        const msg = String(e?.message ?? e)
        if (msg.includes('session_expired')) {
          await logoutRef.current()
        } else {
          console.warn('[Auth] Session refresh failed:', msg)
        }
      }
    }
    const timer = setInterval(tick, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [currentUser?.token])

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        login,
        logout,
        resumeSession,
        autoLogin,
        hasPerm,
        isAdmin,
        policy,
        refreshPolicy,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- хук и провайдер намеренно в одном файле
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
