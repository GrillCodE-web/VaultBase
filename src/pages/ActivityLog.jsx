import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  CreditCard,
  User,
  ShoppingBag,
  Mail,
  Settings,
  RefreshCcw,
  RefreshCw,
  KeyRound,
} from 'lucide-react'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { useLang } from '../hooks/useLang.jsx'
import { useDebounce } from '../hooks/useDebounce.js'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { STATUS_COLORS } from '../constants/colors.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

const ENTITY_COLORS = {
  card: { bg: STATUS_COLORS.infoBg, text: STATUS_COLORS.info, border: 'var(--color-info-bg)' },
  order: {
    bg: STATUS_COLORS.successBg,
    text: STATUS_COLORS.success,
    border: 'var(--color-success-bg)',
  },
  profile: {
    bg: 'var(--color-warning-bg)',
    text: 'var(--orange)',
    border: 'var(--color-warning-bg)',
  },
  imap: {
    bg: STATUS_COLORS.warningBg,
    text: STATUS_COLORS.warning,
    border: 'var(--color-warning-bg)',
  },
  sync: { bg: 'rgba(20,184,166,0.1)', text: 'var(--teal-t)', border: 'rgba(20,184,166,0.2)' },
  license: { bg: STATUS_COLORS.infoBg, text: STATUS_COLORS.info, border: 'var(--color-info-bg)' },
  system: {
    bg: STATUS_COLORS.neutralBg,
    text: STATUS_COLORS.neutral,
    border: 'rgba(107,114,128,0.2)',
  },
}

const ENTITY_ICONS = {
  card: CreditCard,
  order: ShoppingBag,
  profile: User,
  imap: Mail,
  sync: RefreshCcw,
  license: KeyRound,
  system: Settings,
}

function EntityBadge({ type }) {
  if (!type) return null
  const cfg = ENTITY_COLORS[type] ?? ENTITY_COLORS.system
  const Icon = ENTITY_ICONS[type] ?? Settings
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold mono"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.text,
        border: `1px solid ${cfg.border}`,
      }}
    >
      <Icon size={9} />
      {type}
    </span>
  )
}

export default function ActivityLog() {
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { confirm } = useConfirm()
  const { t } = useLang()

  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const limit = 50

  // #20 — debounce search
  const search = useDebounce(searchInput, 300)

  const FILTER_TABS = [
    { label: t('log_filter_all'), value: '' },
    { label: t('log_filter_cards'), value: 'card' },
    { label: t('log_filter_profiles'), value: 'profile' },
    { label: t('log_filter_orders'), value: 'order' },
    { label: t('log_filter_imap'), value: 'imap' },
    { label: t('log_filter_sync'), value: 'sync' },
    { label: t('log_filter_system'), value: 'system' },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await invoke('get_activity_log', {
        filter: {
          event_type: search || null,
          entity_type: entityFilter || null,
          from_date: null,
          to_date: null,
        },
        page,
      })
      setEntries(res.items ?? [])
      setTotal(res.total ?? 0)
    } catch (e) {
      const error = handleError(e, 'ActivityLog.load')
      toastErr(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toastErr is stable from useToast
  }, [search, entityFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const handleClear = async () => {
    const ok = await confirm(t('log_confirm_clear'), t('log_clear'))
    if (!ok) return
    try {
      await invoke('clear_activity_log')
      toastOk(t('log_cleared'))
      setPage(1)
      await load()
    } catch (e) {
      const error = handleError(e, 'ActivityLog.handleClear')
      toastErr(getErrorMessage(error))
    }
  }

  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">{t('log_title')}</div>
          <div className="ph-sub">
            {total} {t('log_records')}
          </div>
        </div>
        <div className="ph-actions">
          <button
            className="btn btn-ghost btn-sm btn-icon"
            onClick={load}
            disabled={loading}
            aria-label={t('btn_refresh')}
          >
            {loading ? (
              '…'
            ) : (
              <>
                <RefreshCw size={13} /> {t('btn_refresh')}
              </>
            )}
          </button>
          <button className="btn btn-r btn-sm" onClick={handleClear}>
            {t('log_clear')}
          </button>
        </div>
      </div>

      <div className="filters">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            className={`flt${entityFilter === tab.value ? ' active' : ''}`}
            onClick={() => {
              setEntityFilter(tab.value)
              setPage(1)
            }}
          >
            {tab.label}
          </button>
        ))}
        <input
          className="search-box"
          placeholder={t('log_search_placeholder')}
          value={searchInput}
          onChange={e => {
            setSearchInput(e.target.value)
            setPage(1)
          }}
        />
      </div>

      <div className="panel p-0 overflow-hidden">
        {entries.length === 0 && !loading ? (
          <div className="py-10 px-6 text-center text-muted text-[13px]">
            {search || entityFilter ? t('log_not_found') : t('log_empty')}
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="pl-4">{t('log_col_time')}</th>
                <th>{t('log_col_category')}</th>
                <th>{t('log_col_event')}</th>
                <th>{t('log_col_description')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? <SkeletonRows count={8} cols={4} /> : null}
              {entries.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td className="pl-4 text-muted text-[11px] whitespace-nowrap mono">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <EntityBadge type={e.entity_type} />
                  </td>
                  <td className="text-blue-t text-[11px] font-mono">{e.event_type}</td>
                  <td className="text-text text-[12px] max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {e.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>
            {t('log_page')} {page} {t('log_of')} {pages}
          </span>
          <div className="flex gap-1">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              {t('log_prev')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page >= pages}
            >
              {t('log_next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
