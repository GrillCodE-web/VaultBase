import { useState, useEffect, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAuth } from '../hooks/useAuth'
import { fmtDate as fmtDateShared, fmtMoney } from '../utils/formatting.js'
import { getDeliveryRateColor } from '../constants/colors.js'
import {
  Users,
  CreditCard,
  ShoppingCart,
  TrendingUp,
  CheckCircle,
  XCircle,
  Truck,
  Calendar,
  Activity,
  Shield,
} from 'lucide-react'

const PERIOD_MAP = { today: 'Сегодня', '7d': '7 дней', '30d': '30 дней' }

const ACTION_ICONS = {
  'auth.login': '🔑',
  'card.taken': '💳',
  'card.transferred': '↔️',
  'card.add_manual': '➕',
  'card.status_changed': '🔄',
  'order.created': '🛒',
}

/**
 * Конверсия считается от ЗАВЕРШЁННЫХ заказов (доставлено + отказ), а не от
 * всех: заказы «в пути» качество не характеризуют и занижали бы показатель
 * у активных операторов. Тот же принцип, что и в OperatorsTable дашборда
 * (DashboardRedesigned.jsx) — держим формулу одинаковой в обоих местах,
 * иначе цифры по одному оператору будут расходиться между страницами.
 */
function withDerived(u) {
  const delivered = u.orders_delivered || 0
  const declined = u.orders_declined || 0
  const finished = delivered + declined
  return {
    ...u,
    conversion: finished > 0 ? (delivered / finished) * 100 : null,
    avgCheck: delivered > 0 ? (u.total_spent || 0) / delivered : 0,
  }
}

export default function MyStats() {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [periodStats, setPeriodStats] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  // ── Общий список пользователей + общая лента активности ──────────────
  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const [u, a] = await Promise.all([
        invoke('get_users_stats').catch(() => []),
        // user_id не передан -> get_user_activity_log отдаёт всех
        // пользователей разом (см. database/_users.rs), это и есть общая
        // лента активности команды, а не только текущего юзера.
        invoke('get_user_activity_log', { userId: null, limit: 100, offset: 0 }).catch(() => []),
      ])
      setUsers(u.map(withDerived))
      setActivity(a)
      setSelectedId(prev => prev ?? u[0]?.user_id ?? currentUser?.user_id ?? null)
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка сводки
    loadOverview()
  }, [loadOverview])

  // ── По периодам для выбранного оператора ──────────────────────────────
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- установка loading-флага перед асинхронной загрузкой
    setDetailLoading(true)
    invoke('get_user_period_stats', { userId: selectedId })
      .catch(() => [])
      .then(p => {
        if (!cancelled) setPeriodStats(p)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selected = useMemo(
    () => users.find(u => u.user_id === selectedId) ?? null,
    [users, selectedId]
  )

  const team = useMemo(() => {
    const active = users.filter(u => u.is_active)
    return active.reduce(
      (acc, u) => ({
        operators: acc.operators + 1,
        online: acc.online + (u.active_sessions > 0 ? 1 : 0),
        cards: acc.cards + (u.cards_taken || 0),
        orders: acc.orders + (u.orders_created || 0),
        delivered: acc.delivered + (u.orders_delivered || 0),
        declined: acc.declined + (u.orders_declined || 0),
        spent: acc.spent + (u.total_spent || 0),
      }),
      { operators: 0, online: 0, cards: 0, orders: 0, delivered: 0, declined: 0, spent: 0 }
    )
  }, [users])

  const teamConversion =
    team.delivered + team.declined > 0
      ? (team.delivered / (team.delivered + team.declined)) * 100
      : null

  if (loading) {
    return (
      <div className="content">
        <div className="ph">
          <div className="ph-title">
            <Users size={14} /> Общая статистика
          </div>
        </div>
        <div className="panel mstats-loading-panel">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">
            <Users size={14} /> Общая статистика
            <span className="text-muted text-[14px] font-normal">
              {' '}
              {team.operators} {team.operators === 1 ? 'пользователь' : 'пользователей'}
              {team.online > 0 && ` · ${team.online} в сети`}
            </span>
          </div>
        </div>
        <div className="ph-actions">
          <button onClick={loadOverview} className="btn btn-ghost btn-sm">
            {loading ? '⟳' : '↺'} Обновить
          </button>
        </div>
      </div>

      {/* Сводка по всей команде */}
      <div className="stat-bar-grid mb-3">
        <div className="stat-card">
          <div className="stat-card-label">Карт взято</div>
          <div className="stat-card-value">{team.cards}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Заказов</div>
          <div className="stat-card-value">{team.orders}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Доставлено</div>
          <div className="stat-card-value text-green-t">{team.delivered}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Отказов</div>
          <div className="stat-card-value text-red-t">{team.declined}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Конверсия команды</div>
          <div
            className="stat-card-value"
            style={{
              color: teamConversion !== null ? getDeliveryRateColor(teamConversion) : undefined,
            }}
          >
            {teamConversion !== null ? `${teamConversion.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Оборот</div>
          <div className="stat-card-value">{fmtMoney(team.spent)}</div>
        </div>
      </div>

      <div className="stats-split-layout">
        {/* Список операторов — кликабельная таблица */}
        <div className="panel p-0 overflow-hidden">
          <div className="mstats-panel-header">Пользователи</div>
          <div className="overflow-x-auto">
            <table className="tbl w-full">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th className="text-right">Заказов</th>
                  <th className="text-right">Конверсия</th>
                  <th className="text-right">Оборот</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .slice()
                  .sort((a, b) => b.orders_delivered - a.orders_delivered)
                  .map(u => (
                    <tr
                      key={u.user_id}
                      onClick={() => setSelectedId(u.user_id)}
                      className={`mstats-user-row ${u.user_id === selectedId ? 'row-selected' : ''}${u.is_active ? '' : ' inactive'}`}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              u.active_sessions > 0 ? 'status-dot active' : 'status-dot inactive'
                            }
                          />
                          <div>
                            <div className="text-text-1">{u.display_name || u.username}</div>
                            <div className="text-[10px] text-muted flex items-center gap-1">
                              {u.role === 'admin' && <Shield size={9} />}
                              {u.role === 'admin' ? 'админ' : 'оператор'}
                              {!u.is_active && ' · отключён'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right">{u.orders_created || 0}</td>
                      <td className="text-right">
                        {u.conversion === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span
                            className="mstats-conversion"
                            style={{ color: getDeliveryRateColor(u.conversion) }}
                          >
                            {u.conversion.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="text-right mono">{fmtMoney(u.total_spent)}</td>
                    </tr>
                  ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="mstats-empty text-muted">
                      Нет пользователей
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Детальная карточка выбранного пользователя */}
        <div className="panel">
          {!selected ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <Users />
              </div>
              <div className="empty-state-title">Выберите пользователя</div>
              <div className="empty-state-text">Кликните по строке в списке слева</div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <div className="mstats-avatar">
                  {(selected.display_name || selected.username || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-[15px] font-semibold">
                    {selected.display_name || selected.username}
                  </div>
                  <div className="text-[12px] text-muted">
                    {selected.role === 'admin' ? 'Администратор' : 'Оператор'} · @
                    {selected.username}
                  </div>
                </div>
              </div>

              <div className="tabs mb-3">
                {[
                  { key: 'overview', label: 'Обзор' },
                  { key: 'periods', label: 'По периодам' },
                ].map(tb => (
                  <button
                    key={tb.key}
                    className={`tab${activeTab === tb.key ? ' active' : ''}`}
                    onClick={() => setActiveTab(tb.key)}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>

              {activeTab === 'overview' && (
                <>
                  <div className="stat-bar-grid mb-3">
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <CreditCard size={11} /> Карт взято
                      </div>
                      <div className="stat-card-value">{selected.cards_taken}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <ShoppingCart size={11} /> Заказов
                      </div>
                      <div className="stat-card-value">{selected.orders_created}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <TrendingUp size={11} /> Потрачено
                      </div>
                      <div className="stat-card-value">{fmtMoney(selected.total_spent)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <Truck size={11} /> Треков
                      </div>
                      <div className="stat-card-value">{selected.tracking_count}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <CheckCircle size={11} /> Доставлено
                      </div>
                      <div className="stat-card-value text-green-t">
                        {selected.orders_delivered}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label flex items-center gap-1">
                        <XCircle size={11} /> Отказов
                      </div>
                      <div className="stat-card-value text-red-t">{selected.orders_declined}</div>
                    </div>
                  </div>

                  <div className="panel-inset">
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
                      Сессия
                    </div>
                    <div className="flex gap-8">
                      <div>
                        <div className="text-[11px] text-muted mb-1">Последний вход</div>
                        <div className="text-[13px]">
                          {fmtDateShared(selected.last_seen, 'medium')}
                        </div>
                      </div>
                      {selected.last_ip && (
                        <div>
                          <div className="text-[11px] text-muted mb-1">IP-адрес</div>
                          <div className="text-[13px] mono">{selected.last_ip}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] text-muted mb-1">Активных сессий (1ч)</div>
                        <div
                          className={
                            selected.active_sessions > 0
                              ? 'text-[13px] text-green-t'
                              : 'text-[13px] text-muted'
                          }
                        >
                          {selected.active_sessions}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'periods' && (
                <div className="flex flex-col gap-3">
                  {detailLoading && <div className="spinner" style={{ margin: '20px auto' }} />}
                  {!detailLoading &&
                    periodStats.map(p => (
                      <div key={p.period} className="panel-inset">
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar size={13} className="text-blue-t" />
                          <span className="text-[14px] font-semibold">
                            {PERIOD_MAP[p.period] ?? p.period}
                          </span>
                        </div>
                        <div className="stat-bar-grid">
                          <div>
                            <div className="text-[11px] text-muted mb-1">Карт взято</div>
                            <div className="text-[18px] font-bold text-blue-t">{p.cards_taken}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted mb-1">Заказов</div>
                            <div className="text-[18px] font-bold">{p.orders_created}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted mb-1">Доставлено</div>
                            <div className="text-[18px] font-bold text-green-t">
                              {p.orders_delivered}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted mb-1">Сумма</div>
                            <div className="text-[18px] font-bold">{fmtMoney(p.total_spent)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  {!detailLoading && periodStats.length === 0 && (
                    <p className="text-muted text-center" style={{ padding: 32 }}>
                      Нет данных
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Общая лента активности команды */}
      <div className="panel mt-3">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={13} className="text-blue-t" />
          <span className="text-[13px] font-semibold text-text-2">Активность команды</span>
        </div>
        {activity.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: 32 }}>
            Активности нет
          </p>
        ) : (
          <div className="activity-feed">
            {activity.map(a => (
              <div key={a.id} className="activity-feed-item">
                <span className="activity-feed-icon">{ACTION_ICONS[a.action_type] ?? '📋'}</span>
                <div className="flex-1">
                  <div className="text-[13px]">
                    <span className="font-semibold">{a.display_name || a.username}</span>{' '}
                    <span className="text-muted">{a.action_type}</span>
                  </div>
                  {a.details && <div className="text-[12px] text-muted">{a.details}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] text-muted">
                    {fmtDateShared(a.created_at, 'medium')}
                  </div>
                  {a.ip_address && (
                    <div className="text-[11px] text-muted mono">{a.ip_address}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
