import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CreditCard, MapPin, Package, Plus } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { handleError } from '../../utils/errorHandler.js'

// SPEC-A (tyw): карточки профилей на главной — «рабочие лошадки» со здоровьем.
// Здоровье: burned (карта мертва), needs_drop (нет дропа), active (заказы>0),
// fresh (новый, чистый). Клик — переход на страницу профилей.
export function ProfileCards({ onNavigate }) {
  const { t } = useLang()
  const [profiles, setProfiles] = useState(null)

  useEffect(() => {
    let alive = true
    invoke('get_profiles', { filter: {}, page: 1, perPage: 8 })
      .then(r => {
        if (alive) setProfiles(r?.items ?? [])
      })
      .catch(e => {
        handleError(e, 'ProfileCards')
        if (alive) setProfiles([])
      })
    return () => {
      alive = false
    }
  }, [])

  if (!profiles) return null

  const healthOf = p => {
    const st = String(p.card_status || '').toLowerCase()
    if (['dead', 'blocked', 'declined', 'burned'].includes(st)) return 'burned'
    if ((p.drop_count ?? 0) === 0) return 'needs_drop'
    if ((p.order_count ?? 0) > 0) return 'active'
    return 'fresh'
  }
  const healthTone = {
    burned: 'var(--red-t)',
    needs_drop: 'var(--yellow-t)',
    active: 'var(--green-t)',
    fresh: 'var(--blue-t)',
  }

  // живые сверху: active → fresh → needs_drop → burned
  const rank = { active: 0, fresh: 1, needs_drop: 2, burned: 3 }
  const sorted = [...profiles].sort((a, b) => (rank[healthOf(a)] ?? 9) - (rank[healthOf(b)] ?? 9))

  return (
    <div className="mb-4">
      <div className="slabel mt-2 flex items-center justify-between">
        <span>{t('dash_profiles_title')}</span>
        <button
          onClick={() => onNavigate?.('profiles', { openCreate: true })}
          className="flex items-center gap-1 text-11 text-blue-t bg-transparent border-none cursor-pointer normal-case tracking-normal"
        >
          <Plus size={11} /> {t('quick_create_profile')}
        </button>
      </div>
      {sorted.length === 0 ? (
        <div className="panel p-6 text-center text-12 text-muted">{t('msg_no_data')}</div>
      ) : (
        <div className="hq-cards-grid">
          {sorted.map(p => {
            const h = healthOf(p)
            return (
              <button
                key={p.id}
                onClick={() => onNavigate?.('profiles')}
                className="hq-card"
                title={t(`dash_health_${h}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="hq-dot shrink-0"
                    style={{ background: healthTone[h] }}
                    aria-hidden="true"
                  />
                  <span className="text-13 font-medium text-text overflow-hidden text-ellipsis whitespace-nowrap">
                    {p.holder_masked || `••••${p.last4 || '????'}`}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-11 text-muted">
                  {p.bank_name && (
                    <span className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      <CreditCard size={11} /> {p.bank_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <MapPin size={11} /> {p.drop_count ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <Package size={11} /> {p.order_count ?? 0}
                  </span>
                </div>
                <div className="text-10 mt-1.5" style={{ color: healthTone[h] }}>
                  {t(`dash_health_${h}`)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
