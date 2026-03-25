import { MapPin, Users } from 'lucide-react'
import { useLang } from '../hooks/useLang'

export default function Drops() {
  const { t } = useLang()

  return (
    <div className="premium-empty-state-wrapper">
      <div className="premium-empty-state">
        {/* Animated background particles */}
        <div className="premium-empty-state__particles">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="particle"
              style={{
                left: `${15 + i * 7}%`,
                top: `${20 + (i % 5) * 15}%`,
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>

        {/* Main content */}
        <div className="premium-empty-state__content">
          <div
            className="premium-empty-state__icon-container"
            style={{
              background: 'var(--accent-dim)',
              borderColor: 'var(--accent-border)',
              boxShadow: '0 0 40px rgba(0, 217, 255, 0.15)',
            }}
          >
            <div
              className="premium-empty-state__icon-glow"
              style={{ background: 'rgba(0, 217, 255, 0.15)' }}
            />
            <MapPin
              size={48}
              className="premium-empty-state__icon"
              style={{ color: 'var(--accent)' }}
            />
          </div>

          <h2 className="premium-empty-state__title">{t('drops_managed_in_profiles')}</h2>
          <p className="premium-empty-state__description">{t('drops_description')}</p>

          {/* Steps */}
          <div className="premium-empty-state__steps">
            <div className="premium-empty-state__step">
              <div className="premium-empty-state__step-number">1</div>
              <div className="premium-empty-state__step-content">
                <div className="premium-empty-state__step-title">
                  <Users size={14} style={{ display: 'inline', marginRight: 6 }} />
                  {t('nav_profiles')}
                </div>
                <div className="premium-empty-state__step-description">{t('drops_step_1')}</div>
              </div>
            </div>

            <div className="premium-empty-state__step">
              <div className="premium-empty-state__step-number">2</div>
              <div className="premium-empty-state__step-content">
                <div className="premium-empty-state__step-title">{t('drops_expand_row')}</div>
                <div className="premium-empty-state__step-description">{t('drops_step_2')}</div>
              </div>
            </div>

            <div className="premium-empty-state__step">
              <div className="premium-empty-state__step-number">3</div>
              <div className="premium-empty-state__step-content">
                <div className="premium-empty-state__step-title">
                  <MapPin size={14} style={{ display: 'inline', marginRight: 6 }} />
                  {t('nav_drops_tab')}
                </div>
                <div className="premium-empty-state__step-description">{t('drops_step_3')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Decorative grid */}
        <div className="premium-empty-state__grid" />
      </div>
    </div>
  )
}
