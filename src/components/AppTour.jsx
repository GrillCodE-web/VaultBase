import { useMemo } from 'react'
import { Joyride, STATUS } from 'react-joyride'
import { useLang } from '../hooks/useLang'

/**
 * AppTour — онбординг-тур по интерфейсу (UX-013, react-joyride).
 *
 * Таргеты — data-tour атрибуты сайдбара, они видны на любой странице.
 * Шаги, чьи таргеты отсутствуют в DOM (например, скрытые правами роли),
 * вырезаются при монтировании, чтобы тур не падал с target not found.
 */
export function AppTour({ onFinish }) {
  const { t } = useLang()

  const steps = useMemo(() => {
    const defs = [
      { target: '[data-tour="sidebar"]', key: 'tour_step_sidebar', placement: 'right-start' },
      { target: '[data-tour="nav-dashboard"]', key: 'tour_step_dashboard', placement: 'right' },
      { target: '[data-tour="nav-cards"]', key: 'tour_step_cards', placement: 'right' },
      { target: '[data-tour="nav-profiles"]', key: 'tour_step_profiles', placement: 'right' },
      { target: '[data-tour="nav-orders"]', key: 'tour_step_orders', placement: 'right' },
      { target: '[data-tour="nav-imap"]', key: 'tour_step_imap', placement: 'right' },
      { target: '[data-tour="nav-settings"]', key: 'tour_step_settings', placement: 'right' },
    ]
    return defs
      .filter(d => typeof document !== 'undefined' && document.querySelector(d.target))
      .map(d => ({
        target: d.target,
        content: t(d.key),
        placement: d.placement,
        disableBeacon: true,
      }))
  }, [t])

  const handleEvent = data => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      onFinish?.(data.status)
    }
  }

  return (
    <Joyride
      steps={steps}
      run
      continuous
      showSkipButton
      showProgress
      onEvent={handleEvent}
      locale={{
        back: t('tour_back'),
        close: t('tour_close'),
        last: t('tour_last'),
        next: t('tour_next'),
        skip: t('tour_skip'),
      }}
      styles={{
        options: {
          zIndex: 12000,
          primaryColor: 'var(--accent)',
          textColor: 'var(--text)',
          backgroundColor: 'var(--surface)',
          overlayColor: 'rgba(0, 0, 0, 0.5)',
        },
      }}
    />
  )
}
