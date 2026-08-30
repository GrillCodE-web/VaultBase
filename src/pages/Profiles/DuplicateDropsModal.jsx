import { SearchCode, CheckCircle2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { shortId } from '../../utils/formatting.js'
import { Modal } from '../../components/Modal.jsx'

// REDESIGN-05-2: ручной оверлей/шапка/focus-trap/Escape/body-lock
// заменены общим <Modal scroll> (620px — произвольная ширина через size).
export function DuplicateDropsModal({ groups, onClose }) {
  const { t } = useLang()

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="620px"
      scroll
      title={
        <span className="flex items-center gap-2">
          <SearchCode size={18} className="text-yellow-t" />
          {t('duplicate_drops')}
          <span className="ml-2 text-[11px] bg-warning text-[var(--color-warning)] py-0.5 px-2 rounded-[20px]">
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
            <p className="m-0">{t('no_dup_drops')}</p>
          </div>
        ) : (
          groups.map((group, gi) => (
            <div key={gi} className="border-warning-yellow rounded-[10px] overflow-hidden">
              <div className="bg-warning p-[8px_16px] text-[12px] text-[var(--color-warning)] font-medium border-b-[var(--color-warning-bg)]">
                {group[0].address}, {group[0].city}, {group[0].country} — {group.length} duplicates
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
    </Modal>
  )
}
