import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAuth } from '../hooks/useAuth'
import {
  CreditCard,
  ShoppingCart,
  TrendingUp,
  CheckCircle,
  XCircle,
  Truck,
  BarChart2,
  Calendar,
} from 'lucide-react'

function fmtMoney(v) {
  if (!v) return '$0.00'
  return (
    '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

function fmtDate(s) {
  if (!s) return '—'
  try {
    return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return s
  }
}

const PERIOD_MAP = { today: 'Сегодня', '7d': '7 дней', '30d': '30 дней' }

const ACTION_ICONS = {
  'auth.login': '🔑',
  'card.taken': '💳',
  'card.transferred': '↔️',
  'card.add_manual': '➕',
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, color: color ?? 'var(--muted)' }}
      >
        {icon}
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? 'var(--text)', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}

export default function MyStats() {
  const { currentUser } = useAuth()
  const [stats, setStats] = useState(null)
  const [period, setPeriod] = useState([])
  const [activity, setActivity] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    if (!currentUser) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- стандартный паттерн loading-флага перед fetch
    setLoading(true)
    Promise.all([
      invoke('get_users_stats')
        .then(r => r.find(u => u.user_id === currentUser.user_id))
        .catch(() => null),
      invoke('get_user_period_stats', { userId: currentUser.user_id }).catch(() => []),
      invoke('get_user_activity_log', { userId: currentUser.user_id, limit: 50, offset: 0 }).catch(
        () => []
      ),
      invoke('get_my_card_assignments').catch(() => []),
    ]).then(([s, p, a, ca]) => {
      setStats(s)
      setPeriod(p)
      setActivity(a)
      setAssignments(ca)
      setLoading(false)
    })
  }, [currentUser])

  if (loading)
    return (
      <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
        {/* Header skeleton */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              animation: 'pulse 2s infinite',
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                height: 24,
                borderRadius: 8,
                background: 'var(--surface)',
                marginBottom: 8,
                animation: 'pulse 2s infinite',
              }}
            />
            <div
              style={{
                height: 16,
                borderRadius: 6,
                background: 'var(--surface)',
                width: '60%',
                animation: 'pulse 2s infinite',
              }}
            />
          </div>
        </div>

        {/* Stats grid skeleton */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div
              key={i}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 18px',
                height: 120,
                animation: 'pulse 2s infinite',
              }}
            />
          ))}
        </div>

        {/* Tabs skeleton */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                height: 32,
                width: 100,
                borderRadius: 6,
                background: 'var(--surface)',
                animation: 'pulse 2s infinite',
              }}
            />
          ))}
        </div>

        {/* Content skeleton */}
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 20,
            height: 300,
            animation: 'pulse 2s infinite',
          }}
        />
      </div>
    )

  const convRate =
    stats && stats.orders_created > 0
      ? ((stats.orders_delivered / stats.orders_created) * 100).toFixed(1) + '%'
      : '—'

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'rgba(59,130,246,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--accent-blue)',
          }}
        >
          {(currentUser?.display_name || currentUser?.username || '?')[0].toUpperCase()}
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            {currentUser?.display_name || currentUser?.username}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            Ваша личная статистика
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          marginBottom: 20,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {[
          { key: 'overview', label: 'Обзор' },
          { key: 'periods', label: 'По периодам' },
          { key: 'cards', label: 'Мои карты' },
          { key: 'activity', label: 'Активность' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '9px 18px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 13,
              color: activeTab === t.key ? 'var(--accent-blue)' : 'var(--muted)',
              borderBottom:
                activeTab === t.key ? '2px solid var(--accent-blue)' : '2px solid transparent',
              fontWeight: activeTab === t.key ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.key === 'cards' && assignments.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  background: 'var(--accent-blue)',
                  color: 'white',
                  padding: '1px 6px',
                  borderRadius: 10,
                }}
              >
                {assignments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && stats && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <StatCard
              icon={<CreditCard size={16} />}
              label="Карт взято всего"
              value={stats.cards_taken}
              color="var(--accent-blue)"
            />
            <StatCard
              icon={<ShoppingCart size={16} />}
              label="Заказов создано"
              value={stats.orders_created}
              color="var(--accent-green)"
            />
            <StatCard
              icon={<TrendingUp size={16} />}
              label="Потрачено всего"
              value={fmtMoney(stats.total_spent)}
              color="var(--accent-yellow)"
            />
            <StatCard icon={<Truck size={16} />} label="Треков" value={stats.tracking_count} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard
              icon={<CheckCircle size={16} />}
              label="Доставлено"
              value={stats.orders_delivered}
              color="var(--accent-green)"
            />
            <StatCard
              icon={<XCircle size={16} />}
              label="Отказов"
              value={stats.orders_declined}
              color="var(--accent-red)"
            />
            <StatCard
              icon={<BarChart2 size={16} />}
              label="Конверсия"
              value={convRate}
              sub="delivered / created"
            />
            <StatCard
              icon={<CreditCard size={16} />}
              label="Добавлено вручную"
              value={stats.cards_added_manual}
            />
          </div>

          {/* Last seen / IP */}
          <div
            style={{
              marginTop: 20,
              padding: '14px 18px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 12,
              }}
            >
              Сессия
            </div>
            <div style={{ display: 'flex', gap: 32 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  Последний вход
                </div>
                <div style={{ fontSize: 14 }}>{fmtDate(stats.last_seen)}</div>
              </div>
              {stats.last_ip && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                    IP-адрес
                  </div>
                  <div style={{ fontSize: 14, fontFamily: 'monospace' }}>{stats.last_ip}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                  Активных сессий (1ч)
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: stats.active_sessions > 0 ? 'var(--accent-green)' : 'var(--muted)',
                  }}
                >
                  {stats.active_sessions}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Periods */}
      {activeTab === 'periods' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {period.map(p => (
            <div
              key={p.period}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Calendar size={15} style={{ color: 'var(--accent-blue)' }} />
                <span style={{ fontWeight: 600, fontSize: 15 }}>
                  {PERIOD_MAP[p.period] ?? p.period}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                {[
                  { label: 'Карт взято', value: p.cards_taken, color: 'var(--accent-blue)' },
                  { label: 'Заказов', value: p.orders_created, color: 'var(--text)' },
                  { label: 'Доставлено', value: p.orders_delivered, color: 'var(--accent-green)' },
                  { label: 'Сумма', value: fmtMoney(p.total_spent), color: 'var(--accent-yellow)' },
                  {
                    label: 'Конверсия',
                    value:
                      p.orders_created > 0
                        ? ((p.orders_delivered / p.orders_created) * 100).toFixed(0) + '%'
                        : '—',
                    color: 'var(--muted)',
                  },
                ].map((item, idx) => (
                  <div key={idx}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: item.color }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {period.length === 0 && (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Нет данных</p>
          )}
        </div>
      )}

      {/* My cards */}
      {activeTab === 'cards' && (
        <div>
          {assignments.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 60 }}>
              <CreditCard size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p>Вы ещё не взяли ни одной карты из пула</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {assignments.map(ca => (
                <div
                  key={ca.card_id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <CreditCard size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      Card #{ca.card_id}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Взята: {fmtDate(ca.assigned_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Activity */}
      {activeTab === 'activity' && (
        <div>
          {activity.length === 0 ? (
            <p style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>
              Активности нет
            </p>
          ) : (
            activity.map(a => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>
                  {ACTION_ICONS[a.action_type] ?? '📋'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{a.action_type}</div>
                  {a.details && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.details}</div>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(a.created_at)}</div>
                  {a.ip_address && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
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
  )
}
