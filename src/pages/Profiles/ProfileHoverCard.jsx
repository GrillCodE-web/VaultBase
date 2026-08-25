import { useLang } from '../../hooks/useLang'

/**
 * ProfileHoverCard — всплывающая карточка профиля при ховере строки.
 *
 * ★ Insight: позиционирование фиксированное по rect строки, pointer-events
 * выключены — карточка не перехватывает клики и не сбивает ховер строки.
 */
export function ProfileHoverCard({ profile: p, rect }) {
  const { t } = useLang()
  const top = Math.min(rect.top + rect.height / 2 - 55, window.innerHeight - 130)
  const left = Math.min(rect.right + 10, window.innerWidth - 240)
  return (
    <div
      className="fixed z-200 pointer-events-none bg-card border rounded-[10px] p-\[12px_14px\] min-w-\[200px\] max-w-\[240px\] shadow-lg"
      style={{
        top,
        left,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-text text-[13px] font-medium">
          ••••-{p.last4 || '????'}
        </span>
        <span
          className="text-[10px] py-\[1px\] px-1.5 rounded-sm"
          style={{
            background: p.drop_count > 0 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
            border: `1px solid ${p.drop_count > 0 ? 'var(--color-success-bg)' : 'var(--color-warning-bg)'}`,
            color: p.drop_count > 0 ? 'var(--color-success)' : 'var(--color-warning)',
          }}
        >
          {p.drop_count > 0 ? t('profile_ready') : t('profile_no_drop')}
        </span>
      </div>
      {p.holder_masked && <div className="text-muted text-[12px] mb-1">{p.holder_masked}</div>}
      <div className="flex flex-wrap gap-1.5">
        {p.bin && <span className="text-muted text-[11px] font-mono">BIN {p.bin}</span>}
        {p.bank_name && <span className="text-[11px] text-muted">· {p.bank_name}</span>}
      </div>
      {p.drop_count !== undefined && (
        <div className="mt-\[5px\] text-muted text-[11px]">
          {p.drop_count} drop{p.drop_count !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
