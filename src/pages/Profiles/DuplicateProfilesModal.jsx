import { useRef, useEffect } from 'react'
import { Layers, X, CheckCircle2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { shortId } from '../../utils/formatting.js'
import { useEscapeKey } from '../../hooks/useEscapeKey.js'

export function DuplicateProfilesModal({ groups, onClose }) {
  useEscapeKey(onClose)
  const { t } = useLang()
  const dupProfRef = useRef(null)
  useFocusTrap(dupProfRef, true)
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
        ref={dupProfRef}
        className="modal w-[620px] max-h-[75vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-profiles-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-orange-t" />
            <span id="duplicate-profiles-title" className="modal-title m-0">
              {t('duplicate_profiles')}
            </span>
            <span className="ml-2 text-[11px] bg-warning text-[var(--orange)] py-0.5 px-2 rounded-[20px]">
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
              <p className="m-0">{t('no_dup_profiles')}</p>
            </div>
          ) : (
            groups.map((group, gi) => (
              <div
                key={gi}
                className="border-[var(--color-warning-bg)] rounded-[10px] overflow-hidden"
              >
                <div className="bg-warning p-\[8px_16px\] text-[12px] text-[var(--orange)] font-medium border-b-[var(--color-warning-bg)]">
                  Card {group[0].bin}••••{group[0].last4} — {group.length} profiles
                </div>
                {group.map(p => (
                  <div key={p.id} className="duplicate-list-item">
                    <span className="text-[12px] font-mono text-text">{shortId(p.id)}</span>
                    <span className="text-[11px] text-muted">
                      {p.drop_count} drops · {p.order_count} orders
                    </span>
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
