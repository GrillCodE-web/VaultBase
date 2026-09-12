import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { PackageCheck, XCircle, Users, DollarSign } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { handleError } from '../../utils/errorHandler.js'
import { formatCurrency, formatNumber } from '../../utils/formatting'
import { PremiumStatCard } from './cards'

/**
 * q77: стартовый экран дня — утренняя сводка над сеткой дашборда:
 * перебивки сегодня / деклайны за ночь / воркеры offline / выручка вчера.
 * Все цифры приходят одной командой get_day_start_stats.
 */
export function DayStartPanel({ onNavigate }) {
  const { t } = useLang()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    let alive = true
    invoke('get_day_start_stats')
      .then(s => {
        if (alive) setStats(s)
      })
      .catch(e => {
        handleError(e, 'DayStartPanel')
        if (alive) setStats(null)
      })
    return () => {
      alive = false
    }
  }, [])

  if (!stats) return null

  const online = stats.workers_online || 0
  const total = stats.workers_total || 0
  const offline = Math.max(0, total - online)

  return (
    <div className="mb-4">
      <div className="slabel mt-2">{t('day_start_title')}</div>
      <div className="smart-cards-grid">
        <PremiumStatCard
          icon={PackageCheck}
          label={t('day_start_rework')}
          value={formatNumber(stats.rework_today)}
          variant="orders"
          onClick={() => onNavigate?.('orders')}
        />
        <PremiumStatCard
          icon={XCircle}
          label={t('day_start_declines')}
          value={formatNumber(stats.declines_overnight)}
          variant="cards"
          onClick={() => onNavigate?.('orders')}
        />
        <PremiumStatCard
          icon={Users}
          label={t('day_start_offline')}
          value={formatNumber(offline)}
          subtext={t('day_start_offline_sub', { online, total })}
          variant="default"
        />
        <PremiumStatCard
          icon={DollarSign}
          label={t('day_start_revenue')}
          value={formatCurrency(stats.revenue_yesterday)}
          variant="revenue"
        />
      </div>
    </div>
  )
}
