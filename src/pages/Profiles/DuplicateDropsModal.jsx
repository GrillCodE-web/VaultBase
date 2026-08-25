import { useEffect } from 'react'
import { SearchCode, X, CheckCircle2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { shortId } from '../../utils/formatting.js'
import { useEscapeKey } from '../../hooks/useEscapeKey.js'

export function DuplicateDropsModal({ groups, onClose }) {
  useEscapeKey(onClose)
  const { t } = useLang()
  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay">
      <div
        className="modal w-[620px] max-h-[75vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-drops-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <SearchCode size={18} className="text-yellow-t" />
            <span id="duplicate-drops-title" className="modal-title m-0">
              {t('duplicate_drops')}
            </span>
            <span className="ml-2 text-[11px] bg-warning text-[var(--color-warning)] py-0.5 px-2 rounded-[20px]">
              {groups.length} groups
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-6 flex flex-col gap-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <CheckCircle2
                size={40}
                className="mx-auto mb-3 text-[var(--color-success)] opacity-40"
              />
              <p className="m-0">{t('no_dup_drops')}</p>
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={gi} className="border-warning-yellow rounded-[10px] overflow-hidden">
                <div className="bg-warning p-\[8px_16px\] text-[12px] text-[var(--color-warning)] font-medium border-b-[var(--color-warning-bg)]">
                  {group[0].address}, {group[0].city}, {group[0].country} — {group.length}{' '}
                  duplicates
                </div>
                {group.map(d => (
                  <div key={d.id} className="duplicate-list-item">
                    <div>
                      <span className="text-[13px] text-text">{d.recipient_name}</span>
                      <span className="text-[11px] text-muted ml-2">
                        profile: {shortId(d.profile_id)}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-muted">{d.phone || '—'}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
