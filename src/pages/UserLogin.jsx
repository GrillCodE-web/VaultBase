import { useState } from 'react'
import { User, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'

export default function UserLogin({ onLoggedIn }) {
  const { login, sessionEndNotice } = useAuth()
  const { t } = useLang()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async e => {
    e?.preventDefault()
    if (!username.trim() || !password) return
    setError('')
    setLoading(true)
    try {
      const user = await login(username.trim(), password)
      onLoggedIn(user)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('wrong_credentials')) setError('Неверный логин или пароль')
      else if (msg.includes('user_inactive')) setError('Аккаунт деактивирован')
      else setError('Ошибка входа: ' + msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card max-w-[380px]">
        <div className="auth-logo-row mb-2">
          <div className="auth-logo-icon">
            <User size={22} />
          </div>
        </div>

        <h1 className="auth-title">Вход в систему</h1>
        <p className="auth-subtitle mb-6 text-muted text-13">
          Введите логин и пароль вашего аккаунта
        </p>

        {sessionEndNotice && (
          <p role="alert" className="session-end-notice">
            {t(
              sessionEndNotice === 'force_logout'
                ? 'session_ended_force_logout'
                : 'session_ended_expired'
            )}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
              <User size={15} />
            </span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Имя пользователя"
              autoFocus
              autoComplete="username"
              className="auth-input pl-9"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
              <Lock size={15} />
            </span>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="current-password"
              className="auth-input pl-9 pr-11"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(v => !v)}
              className="bg-transparent border-none cursor-pointer p-0 absolute right-3 top-1/2 -translate-y-1/2 text-muted"
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p role="alert" className="text-red-t text-13 m-0">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="auth-btn mt-1 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="spinner-xs" />
            ) : (
              <>
                <LogIn size={15} /> Войти
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
