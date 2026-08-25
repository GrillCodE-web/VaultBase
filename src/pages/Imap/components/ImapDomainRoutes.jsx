import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Globe, Plus, Trash2, X, ArrowRight } from 'lucide-react'
import { useLang } from '../../../hooks/useLang.jsx'

/**
 * ImapDomainRoutes - модалка маршрутов «домен = почта».
 * Домен уникален глобально: backend вернёт domain_already_routed при повторе.
 */
export function ImapDomainRoutes({ accounts, onClose, onError }) {
  const { t } = useLang()
  const [routes, setRoutes] = useState([])
  const [domain, setDomain] = useState('')
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await invoke('list_domain_routes')
      setRoutes(list)
    } catch (e) {
      onError?.(e)
    }
  }, [onError])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первичная загрузка данных модалки
    load()
  }, [load])

  const add = async () => {
    const d = domain.trim().toLowerCase()
    if (!d || !accountId || busy) return
    setBusy(true)
    try {
      await invoke('add_domain_route', { domain: d, imapAccountId: Number(accountId) })
      setDomain('')
      await load()
    } catch (e) {
      const msg = String(e)
      if (msg.startsWith('domain_already_routed')) {
        onError?.(t('imap_domain_exists'))
      } else {
        onError?.(e)
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async d => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('remove_domain_route', { domain: d })
      await load()
    } catch (e) {
      onError?.(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-modal-md"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('imap_domain_routes_title')}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('imap_domain_routes_title')}</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm p-1" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="zoro.com"
              className="form-input flex-1"
              aria-label={t('imap_domain_add_placeholder')}
            />
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="form-input flex-1"
              aria-label={t('imap_domain_account')}
            >
              <option value="">{t('imap_domain_account')}</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <button
              onClick={add}
              disabled={!domain.trim() || !accountId || busy}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus size={13} /> {t('imap_domain_add')}
            </button>
          </div>

          {routes.length === 0 ? (
            <div className="text-center text-[12px] text-muted py-6">
              {t('imap_domain_empty')}
            </div>
          ) : (
            <div className="flex flex-col">
              {routes.map(r => (
                <div
                  key={r.domain}
                  className="flex items-center gap-2 py-2 border-b border-border last:border-b-0 text-[12px]"
                >
                  <span className="font-semibold text-text">{r.domain}</span>
                  <ArrowRight size={12} className="text-muted shrink-0" />
                  <span className="flex-1 text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                    {r.account_label ?? `#${r.imap_account_id}`}
                  </span>
                  <button
                    onClick={() => remove(r.domain)}
                    disabled={busy}
                    className="btn btn-ghost btn-sm p-1 text-error"
                    title={t('imap_domain_remove')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
