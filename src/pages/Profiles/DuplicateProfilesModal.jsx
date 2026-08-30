import { Layers, CheckCircle2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { shortId } from '../../utils/formatting.js'
import { Modal } from '../../components/Modal.jsx'

// REDESIGN-05-2: ручной оверлей/шапка/focus-trap/Escape/body-lock
// заменены общим <Modal scroll> (620px — произвольная ширина через size).
export function DuplicateProfilesModal({ groups, onClose }) {
  const { t } = useLang()

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="620px"
      scroll
      title={
        <span className="flex items-center gap-2">
          <Layers size={18} className="text-orange-t" />
          {t('duplicate_profiles')}
          <span className="ml-2 text-[11px] bg-warning text-[var(--orange)] py-0.5 px-2 rounded-[20px]">
            {groups.length} groups
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
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
              <div className="bg-warning p-[8px_16px] text-[12px] text-[var(--orange)] font-medium border-b-[var(--color-warning-bg)]">
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
    </Modal>
  )
}
