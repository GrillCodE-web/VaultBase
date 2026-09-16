// 7rn: онбординг-тур менеджера — пошаговый оверлей, показывается один раз
// (флаг localStorage vb-mgr-tour-done), повторный запуск из палитры команд.
import { useEffect, useState } from 'react'

const STEPS = ['dashboard', 'workers', 'orders', 'cards', 'chat', 'updates', 'palette']
const FLAG_KEY = 'vb-mgr-tour-done'

export default function OnboardingTour({ t, open, onClose }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  if (!open) return null

  const finish = () => {
    try {
      localStorage.setItem(FLAG_KEY, '1')
    } catch { /* localStorage недоступен */ }
    onClose()
  }

  const last = step === STEPS.length - 1

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label={t('tour_title')}>
      <div className="tour-card">
        <h3 className="tour-heading">{t('tour_title')}</h3>
        <div className="tour-step-title">{t(`tour_${STEPS[step]}_title`)}</div>
        <p className="tour-body">{t(`tour_${STEPS[step]}_body`)}</p>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`tour-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="btn small" onClick={finish}>
            {t('tour_skip')}
          </button>
          <span className="tour-spacer" />
          {step > 0 && (
            <button type="button" className="btn small" onClick={() => setStep(step - 1)}>
              {t('tour_back')}
            </button>
          )}
          <button
            type="button"
            className="btn primary small"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? t('tour_finish') : t('tour_next')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function shouldShowTour() {
  try {
    return !localStorage.getItem(FLAG_KEY)
  } catch {
    return false
  }
}
