import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { XCircle, Truck, PackageCheck, ChevronRight } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { handleError } from '../../utils/errorHandler.js'

const DAY_MS = 86400000

// SPEC-A (tyw): инбокс «требуют действий» на главной — declined (повторить),
// shipped без движения 3+ дней (проверить трек), delivered (закрыть/оценить).
// Пустой инбокс не рендерится вообще: «нет проблем» = тишина, а не плашка.
export function ActionInbox({ onNavigate }) {
  const { t } = useLang()
  const [groups, setGroups] = useState(null)

  useEffect(() => {
    let alive = true
    invoke('get_orders', { filter: {}, page: 1, perPage: 100 })
      .then(r => {
        if (!alive) return
        const items = r?.items ?? []
        const now = Date.now()
        const ts = o => {
          const v = o.updated_at || o.created_at
          if (!v) return 0
          const parsed = new Date(String(v).replace(' ', 'T') + 'Z').getTime()
          return Number.isNaN(parsed) ? 0 : parsed
        }
        setGroups({
          declined: items.filter(o => o.status === 'declined'),
          stuck: items.filter(o => o.status === 'shipped' && now - ts(o) > 3 * DAY_MS),
          delivered: items.filter(o => o.status === 'delivered'),
        })
      })
      .catch(e => {
        handleError(e, 'ActionInbox')
        if (alive) setGroups({ declined: [], stuck: [], delivered: [] })
      })
    return () => {
      alive = false
    }
  }, [])

  if (!groups) return null
  const total = groups.declined.length + groups.stuck.length + groups.delivered.length
  if (total === 0) return null

  const rows = [
    {
      key: 'declined',
      icon: XCircle,
      tone: 'var(--red-t)',
      count: groups.declined.length,
      label: t('dash_inbox_declined', { n: groups.declined.length }),
      onClick: () => onNavigate?.('orders', { status: 'declined' }),
    },
    {
      key: 'stuck',
      icon: Truck,
      tone: 'var(--yellow-t)',
      count: groups.stuck.length,
      label: t('dash_inbox_stuck', { n: groups.stuck.length }),
      onClick: () => onNavigate?.('orders', { status: 'shipped' }),
    },
    {
      key: 'delivered',
      icon: PackageCheck,
      tone: 'var(--green-t)',
      count: groups.delivered.length,
      label: t('dash_inbox_delivered', { n: groups.delivered.length }),
      onClick: () => onNavigate?.('orders', { status: 'delivered' }),
    },
  ].filter(r => r.count > 0)

  return (
    <div className="mb-4">
      <div className="slabel mt-2">{t('dash_inbox_title', { n: total })}</div>
      <div className="panel p-2 flex flex-col gap-1">
        {rows.map(({ key, icon: Icon, tone, label, onClick }) => (
          <button
            key={key}
            onClick={onClick}
            className="flex items-center gap-2.5 w-full text-left bg-transparent border-none cursor-pointer rounded-[8px] px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Icon size={14} style={{ color: tone }} className="shrink-0" />
            <span className="text-13 text-text flex-1">{label}</span>
            <ChevronRight size={14} className="text-muted shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
