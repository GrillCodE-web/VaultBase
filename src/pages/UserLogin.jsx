import { useState } from 'react'
import { User, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

export default function UserLogin({ onLoggedIn }) {
  const { login } = useAuth()
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
      <div className="auth-card" style={{ maxWidth: 380 }}>
        <div className="auth-logo-row" style={{ marginBottom: 8 }}>
          <div className="auth-logo-icon">
            <User size={22} />
          </div>
        </div>

        <h1 className="auth-title">Вход в систему</h1>
        <p
          className="auth-subtitle"
          style={{ marginBottom: 24, color: 'var(--muted)', fontSize: 13 }}
        >
          Введите логин и пароль вашего аккаунта
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="relative">
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted)',
                pointerEvents: 'none',
              }}
            >
              <User size={15} />
            </span>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Имя пользователя"
              autoFocus
              autoComplete="username"
              className="auth-input"
              style={{ paddingLeft: 36 }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          <div className="relative">
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted)',
                pointerEvents: 'none',
              }}
            >
              <Lock size={15} />
            </span>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="current-password"
              className="auth-input"
              style={{ paddingLeft: 36, paddingRight: 44 }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPw(v => !v)}
              className="bg-transparent border-none cursor-pointer p-0"
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted)',
              }}
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          {error && (
            <p role="alert" style={{ color: 'var(--accent-red)', fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="auth-btn"
            style={{
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
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
