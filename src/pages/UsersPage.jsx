import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getDateLocale } from '../utils/dateLocale'
import {
  Users,
  Plus,
  Shield,
  Activity,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Check,
  X,
  ToggleLeft,
  ToggleRight,
  BarChart2,
  Clock,
  CreditCard,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'

// ── Permission keys labels ─────────────────────────────────────────────────
// Ключи обязаны совпадать с `perms` в src-tauri/src/models.rs.
// Здесь перечислены только те права, которые бэкенд реально проверяет —
// см. docs/PERMISSIONS.md. Намеренно отсутствуют четыре объявленных,
// но не работающих ключа:
//   view_all_orders    — в таблице orders нет колонки владельца, разделить
//                        «свои/чужие» нечем (нужна миграция orders.created_by);
//   manage_users       — команды пользователей закрыты require_admin(), то есть
//   manage_permissions   проверяют РОЛЬ, а не право: выдача ничего не давала;
//   view_reports       — не привязано ни к одной команде.
// Тумблеры для них выглядели рабочими и молча не работали.
const PERM_LABELS = {
  view_stats_global: 'Общая статистика',
  view_cards_pool: 'Просмотр пула карт',
  take_cards: 'Брать карты из пула',
  add_cards_manual: 'Добавлять карты вручную',
  transfer_cards: 'Передавать карты',
  view_own_cards_full: 'Полные данные своих карт',
  create_orders: 'Создавать заказы',
  export_data: 'Экспорт данных',
  manage_shops: 'Управление магазинами',
  manage_emails: 'Управление email-пулом',
  manage_proxies: 'Управление прокси',
  // Курьеры и посылки (Stuffer). Раньше их здесь не было вовсе, хотя бэкенд
  // их проверяет: manage_couriers невозможно было выдать никому — из-за чего
  // настройка Stuffer оставалась недоступна любому оператору навсегда.
  view_couriers: 'Просмотр курьеров',
  manage_couriers: 'Управление курьерами и настройка Stuffer',
  view_packages: 'Просмотр посылок',
  create_packages: 'Создавать посылки',
}

const PERM_GROUPS = [
  {
    label: 'Карты',
    keys: [
      'view_cards_pool',
      'take_cards',
      'add_cards_manual',
      'transfer_cards',
      'view_own_cards_full',
    ],
  },
  { label: 'Заказы', keys: ['create_orders'] },
  { label: 'Данные', keys: ['view_stats_global', 'export_data'] },
  {
    label: 'Курьеры',
    keys: ['view_couriers', 'manage_couriers', 'view_packages', 'create_packages'],
  },
  { label: 'Управление', keys: ['manage_shops', 'manage_emails', 'manage_proxies'] },
]

function fmtDate(s) {
  if (!s) return '—'
  try {
    const locale = getDateLocale(localStorage.getItem('vaultbase_lang') || 'en')
    return new Date(s.replace(' ', 'T') + 'Z').toLocaleString(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return s
  }
}

function fmtMoney(v) {
  if (!v) return '$0'
  return (
    '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

// ── Create/Edit User Modal ────────────────────────────────────────────────
function UserModal({ user, onClose, onSaved }) {
  const isNew = !user
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [role, setRole] = useState(user?.role ?? 'operator')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [isActive, setIsActive] = useState(user?.is_active ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (isNew && !username.trim()) {
      setError('Введите логин')
      return
    }
    if (isNew && !password) {
      setError('Введите пароль')
      return
    }
    if (!isNew && password && password.length < 6) {
      setError('Пароль минимум 6 символов')
      return
    }
    setLoading(true)
    try {
      if (isNew) {
        await invoke('create_user', {
          input: { username: username.trim(), password, display_name: displayName || null, role },
        })
      } else {
        await invoke('update_user_cmd', {
          id: user.id,
          displayName: displayName || null,
          isActive,
          role,
        })
        if (password) await invoke('set_user_password_cmd', { id: user.id, newPassword: password })
      }
      onSaved()
    } catch (e) {
      const msg = String(e)
      if (msg.includes('username_taken')) setError('Логин уже занят')
      else if (msg.includes('last_admin'))
        setError('Нельзя убрать роль у последнего администратора')
      else setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isNew ? 'Новый пользователь' : `Редактировать: ${user.username}`}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isNew && (
            <label className="field-label">
              Логин
              <input
                className="field-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="username"
              />
            </label>
          )}

          <label className="field-label">
            Отображаемое имя
            <input
              className="field-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Иван Петров"
            />
          </label>

          <label className="field-label">
            {isNew ? 'Пароль' : 'Новый пароль (оставьте пустым, если не меняется)'}
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="field-input pr-10"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isNew ? 'Минимум 6 символов' : '••••••••'}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                }}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <label className="field-label">
            Роль
            <select className="field-input" value={role} onChange={e => setRole(e.target.value)}>
              <option value="operator">Оператор</option>
              <option value="admin">Администратор</option>
            </select>
          </label>

          {!isNew && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <button
                type="button"
                onClick={() => setIsActive(v => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent-green)' : 'var(--muted)',
                  padding: 0,
                }}
              >
                {isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
              </button>
              <span style={{ fontSize: 13 }}>
                {isActive ? 'Аккаунт активен' : 'Аккаунт деактивирован'}
              </span>
            </label>
          )}

          {error && <p style={{ color: 'var(--accent-red)', fontSize: 13, margin: 0 }}>{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? <span className="spinner-xs" /> : isNew ? 'Создать' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Permission Editor ─────────────────────────────────────────────────────
function PermissionsPanel({ user, onClose, onSaved }) {
  const [perms, setPerms] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    invoke('get_user_with_permissions', { id: user.id })
      .then(r => {
        setPerms(r.permissions)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [user.id])

  const toggle = async (key, currentGranted) => {
    if (user.role === 'admin') return
    setSaving(key)
    try {
      await invoke('set_user_permission_cmd', { userId: user.id, key, granted: !currentGranted })
      setPerms(p =>
        p.map(x =>
          x.permission_key === key ? { ...x, granted: !currentGranted, is_default: false } : x
        )
      )
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(null)
    }
  }

  const resetAll = async () => {
    setSaving('__all__')
    try {
      await invoke('reset_user_permissions_cmd', { userId: user.id })
      const r = await invoke('get_user_with_permissions', { id: user.id })
      setPerms(r.permissions)
      onSaved?.()
    } finally {
      setSaving(null)
    }
  }

  const permMap = Object.fromEntries(perms.map(p => [p.permission_key, p]))
  const isAdmin = user.role === 'admin'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Shield size={15} style={{ marginRight: 6 }} />
            Права: {user.display_name || user.username}
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {isAdmin ? (
            <div style={{ padding: '12px 0', color: 'var(--muted)', fontSize: 13 }}>
              Администратор имеет все права автоматически.
            </div>
          ) : loading ? (
            <div className="flex-center" style={{ padding: 32 }}>
              <div className="spinner-xs" />
            </div>
          ) : (
            <>
              {PERM_GROUPS.map(group => (
                <div key={group.label} style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 8,
                    }}
                  >
                    {group.label}
                  </div>
                  {group.keys.map(key => {
                    const p = permMap[key]
                    if (!p) return null
                    const isSaving = saving === key
                    return (
                      <button
                        key={key}
                        onClick={() => toggle(key, p.granted)}
                        disabled={!!saving}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '8px 12px',
                          marginBottom: 4,
                          background: p.granted
                            ? 'var(--accent-green-alpha, rgba(34,197,94,0.08))'
                            : 'var(--surface)',
                          border: `1px solid ${p.granted ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
                          borderRadius: 8,
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            flexShrink: 0,
                            background: p.granted ? 'var(--accent-green)' : 'transparent',
                            border: `2px solid ${p.granted ? 'var(--accent-green)' : 'var(--border)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isSaving ? (
                            <span className="spinner-xs" style={{ width: 10, height: 10 }} />
                          ) : p.granted ? (
                            <Check size={11} color="white" />
                          ) : null}
                        </div>
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>
                          {PERM_LABELS[key] ?? key}
                        </span>
                        {p.is_default && (
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                            по умолч.
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
              <button
                className="btn-secondary"
                style={{ marginTop: 8 }}
                onClick={resetAll}
                disabled={!!saving}
              >
                Сбросить к дефолтам
              </button>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  )
}

// ── User Detail (Stats + Activity) ────────────────────────────────────────
function UserDetailPanel({ user, onClose }) {
  const [stats, setStats] = useState(null)
  const [period, setPeriod] = useState([])
  const [activity, setActivity] = useState([])
  const [tab, setTab] = useState('stats')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- стандартный паттерн loading-флага перед fetch
    setLoading(true)
    Promise.all([
      invoke('get_users_stats').then(r => r.find(u => u.user_id === user.id)),
      invoke('get_user_period_stats', { userId: user.id }),
      invoke('get_user_activity_log', { userId: user.id, limit: 50, offset: 0 }),
    ])
      .then(([s, p, a]) => {
        setStats(s)
        setPeriod(p)
        setActivity(a)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [user.id])

  const PERIOD_LABELS = { today: 'Сегодня', '7d': '7 дней', '30d': '30 дней' }
  const ACTION_ICONS = {
    'auth.login': '🔑',
    'card.taken': '💳',
    'card.transferred': '↔️',
    'card.add_manual': '➕',
    'user.created': '👤',
    'user.permission_set': '🛡',
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{
          maxWidth: 620,
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: user.role === 'admin' ? 'var(--accent-blue)' : 'var(--accent-green)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {(user.display_name || user.username)[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {user.display_name || user.username}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                @{user.username} · {user.role === 'admin' ? 'Администратор' : 'Оператор'}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: '0 20px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {['stats', 'activity'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 13,
                color: tab === t ? 'var(--accent-blue)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--accent-blue)' : '2px solid transparent',
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t === 'stats' ? 'Статистика' : 'Активность'}
            </button>
          ))}
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div className="flex-center" style={{ padding: 40 }}>
              <div className="spinner-xs" />
            </div>
          ) : tab === 'stats' ? (
            <div style={{ padding: 20 }}>
              {stats && (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    {[
                      {
                        icon: <CreditCard size={15} />,
                        label: 'Карт взято',
                        value: stats.cards_taken,
                        color: 'var(--accent-blue)',
                      },
                      {
                        icon: <ShoppingCart size={15} />,
                        label: 'Заказов создано',
                        value: stats.orders_created,
                        color: 'var(--accent-green)',
                      },
                      {
                        icon: <Check size={15} />,
                        label: 'Доставлено',
                        value: stats.orders_delivered,
                        color: 'var(--accent-green)',
                      },
                      {
                        icon: <X size={15} />,
                        label: 'Отказов',
                        value: stats.orders_declined,
                        color: 'var(--accent-red)',
                      },
                      {
                        icon: <TrendingUp size={15} />,
                        label: 'Потрачено',
                        value: fmtMoney(stats.total_spent),
                        color: 'var(--accent-yellow)',
                      },
                      {
                        icon: <Activity size={15} />,
                        label: 'Треков',
                        value: stats.tracking_count,
                        color: 'var(--muted)',
                      },
                    ].map((item, i) => (
                      <div
                        key={i}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          padding: '12px 14px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            color: item.color,
                            marginBottom: 6,
                          }}
                        >
                          {item.icon}
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{item.label}</span>
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 10,
                    }}
                  >
                    По периодам
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: 'var(--muted)', fontSize: 12 }}>
                        <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 500 }}>
                          Период
                        </th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 500 }}>
                          Заказы
                        </th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 500 }}>
                          Доставка
                        </th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 500 }}>
                          Сумма
                        </th>
                        <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 500 }}>
                          Карт
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.map(p => (
                        <tr key={p.period} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 0', fontWeight: 500 }}>
                            {PERIOD_LABELS[p.period] ?? p.period}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px 0' }}>
                            {p.orders_created}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: '8px 0',
                              color: 'var(--accent-green)',
                            }}
                          >
                            {p.orders_delivered}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              padding: '8px 0',
                              color: 'var(--accent-yellow)',
                            }}
                          >
                            {fmtMoney(p.total_spent)}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px 0' }}>{p.cards_taken}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div
                    style={{
                      marginTop: 20,
                      padding: '12px 14px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 13,
                    }}
                  >
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                    >
                      <span style={{ color: 'var(--muted)' }}>Последний визит</span>
                      <span>{fmtDate(stats.last_seen)}</span>
                    </div>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                    >
                      <span style={{ color: 'var(--muted)' }}>Последний IP</span>
                      <span style={{ fontFamily: 'monospace' }}>{stats.last_ip ?? '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--muted)' }}>Активных сессий (1ч)</span>
                      <span
                        style={{
                          color: stats.active_sessions > 0 ? 'var(--accent-green)' : 'var(--muted)',
                        }}
                      >
                        {stats.active_sessions}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ padding: 20 }}>
              {activity.length === 0 ? (
                <p
                  style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}
                >
                  Активность не найдена
                </p>
              ) : (
                activity.map(a => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0 }}>
                      {ACTION_ICONS[a.action_type] ?? '📋'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)' }}>{a.action_type}</div>
                      {a.details && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.details}</div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {fmtDate(a.created_at)}
                      </div>
                      {a.ip_address && (
                        <div
                          style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}
                        >
                          {a.ip_address}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Admin Overview Banner ─────────────────────────────────────────────────
function AdminOverviewBanner({ overview }) {
  if (!overview) return null
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 24 }}
    >
      {[
        { label: 'Заказов сегодня', value: overview.today_orders, color: 'var(--accent-blue)' },
        {
          label: 'Доставлено сегодня',
          value: overview.today_delivered,
          color: 'var(--accent-green)',
        },
        {
          label: 'Потрачено сегодня',
          value: fmtMoney(overview.today_spent),
          color: 'var(--accent-yellow)',
        },
        { label: 'Карт в пуле', value: overview.total_cards_in_pool, color: 'var(--muted)' },
        {
          label: 'Карт назначено',
          value: overview.total_cards_assigned,
          color: 'var(--accent-blue)',
        },
        {
          label: 'Онлайн (1ч)',
          value: overview.online_sessions,
          color: overview.online_sessions > 0 ? 'var(--accent-green)' : 'var(--muted)',
        },
      ].map((item, i) => (
        <div
          key={i}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{item.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | { type: 'create'|'edit'|'perms'|'detail', user? }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, o] = await Promise.all([invoke('get_users_stats'), invoke('get_admin_overview')])
      setUsers(u)
      setOverview(o)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка пользователей
    load()
  }, [load])

  const handleDelete = async user => {
    if (!confirm(`Удалить пользователя "${user.username}"? Это действие необратимо.`)) return
    try {
      await invoke('delete_user_cmd', { id: user.user_id })
      load()
    } catch (e) {
      alert(String(e))
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Нет доступа</div>
    )
  }

  return (
    <div className="content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={20} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Пользователи</h1>
        </div>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setModal({ type: 'create' })}
        >
          <Plus size={15} /> Добавить
        </button>
      </div>

      {overview && <AdminOverviewBanner overview={overview} />}

      {loading ? (
        <div className="flex-center" style={{ padding: 60 }}>
          <div className="spinner-xs" />
        </div>
      ) : users.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
          Нет пользователей
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => (
            <div
              key={u.user_id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                opacity: u.is_active ? 1 : 0.5,
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: u.role === 'admin' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 16,
                  color: u.role === 'admin' ? 'var(--accent-blue)' : 'var(--accent-green)',
                }}
              >
                {(u.display_name || u.username)[0].toUpperCase()}
              </div>

              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {u.display_name || u.username}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>@{u.username}</span>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 20,
                      background:
                        u.role === 'admin' ? 'rgba(59,130,246,0.12)' : 'rgba(34,197,94,0.10)',
                      color: u.role === 'admin' ? 'var(--accent-blue)' : 'var(--accent-green)',
                      fontWeight: 500,
                    }}
                  >
                    {u.role === 'admin' ? 'Admin' : 'Оператор'}
                  </span>
                  {!u.is_active && (
                    <span style={{ fontSize: 11, color: 'var(--accent-red)', fontWeight: 500 }}>
                      деактивирован
                    </span>
                  )}
                  {u.active_sessions > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 20,
                        background: 'rgba(34,197,94,0.12)',
                        color: 'var(--accent-green)',
                        fontWeight: 500,
                      }}
                    >
                      🟢 онлайн
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Карт: <strong style={{ color: 'var(--text)' }}>{u.cards_taken}</strong>
                  &nbsp;·&nbsp;Заказов:{' '}
                  <strong style={{ color: 'var(--text)' }}>{u.orders_created}</strong>
                  &nbsp;·&nbsp;Доставлено:{' '}
                  <strong style={{ color: 'var(--accent-green)' }}>{u.orders_delivered}</strong>
                  &nbsp;·&nbsp;Сумма:{' '}
                  <strong style={{ color: 'var(--accent-yellow)' }}>
                    {fmtMoney(u.total_spent)}
                  </strong>
                  &nbsp;·&nbsp;Треков:{' '}
                  <strong style={{ color: 'var(--text)' }}>{u.tracking_count}</strong>
                  {u.last_ip && (
                    <>
                      &nbsp;·&nbsp;IP: <span style={{ fontFamily: 'monospace' }}>{u.last_ip}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Last seen */}
              <div
                style={{ textAlign: 'right', flexShrink: 0, fontSize: 12, color: 'var(--muted)' }}
              >
                <Clock size={11} style={{ display: 'inline', marginRight: 4 }} />
                {fmtDate(u.last_seen)}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  title="Статистика"
                  onClick={() => setModal({ type: 'detail', user: u })}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                  }}
                >
                  <BarChart2 size={14} />
                </button>
                <button
                  title="Права"
                  onClick={() => setModal({ type: 'perms', user: u })}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                  }}
                >
                  <Shield size={14} />
                </button>
                <button
                  title="Редактировать"
                  onClick={() => setModal({ type: 'edit', user: u })}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  title="Удалить"
                  onClick={() => handleDelete(u)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    color: 'var(--accent-red)',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal?.type === 'create' && (
        <UserModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
      {modal?.type === 'edit' && (
        <UserModal
          user={{ ...modal.user, id: modal.user.user_id }}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            load()
          }}
        />
      )}
      {modal?.type === 'perms' && (
        <PermissionsPanel
          user={{ ...modal.user, id: modal.user.user_id }}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {modal?.type === 'detail' && (
        <UserDetailPanel
          user={{ ...modal.user, id: modal.user.user_id }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
