import { createContext, useContext, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)

  const login = useCallback(async (username, password) => {
    const result = await invoke('user_login', {
      username,
      password,
      ipAddress: null,
      deviceInfo: navigator.userAgent ?? null,
    })
    setCurrentUser(result)
    try {
      localStorage.setItem('cc_session_token', result.token)
    } catch (e) {
      console.warn('[Auth] Failed to save session token:', e.message)
    }
    return result
  }, [])

  const logout = useCallback(async () => {
    if (currentUser?.token) {
      try {
        await invoke('user_logout', { token: currentUser.token })
      } catch (e) {
        console.warn('[Auth] Logout request failed:', e.message)
      }
    }
    setCurrentUser(null)
    try {
      localStorage.removeItem('cc_session_token')
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
      try {
        localStorage.setItem('cc_session_token', result.token)
      } catch (e) {
        console.warn('[Auth] Failed to save session token:', e.message)
      }
      return result
    } catch {
      return null
    }
  }, [])

  const resumeSession = useCallback(async () => {
    try {
      const token = localStorage.getItem('cc_session_token')
      if (!token) return null
      const result = await invoke('resume_session', { token })
      setCurrentUser(result)
      return result
    } catch {
      try {
        localStorage.removeItem('cc_session_token')
      } catch {
        /* ignore */
      }
      return null
    }
  }, [])

  const hasPerm = useCallback(
    key => {
      if (!currentUser) return false
      if (currentUser.role === 'admin') return true
      return currentUser.permissions?.includes(key) ?? false
    },
    [currentUser]
  )

  const isAdmin = currentUser?.role === 'admin'

  return (
    <AuthContext.Provider
      value={{ currentUser, login, logout, resumeSession, autoLogin, hasPerm, isAdmin }}
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
