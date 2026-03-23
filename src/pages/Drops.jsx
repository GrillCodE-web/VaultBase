import { MapPin, Users, ArrowRight } from 'lucide-react'
import { useLang } from '../hooks/useLang'

export default function Drops() {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-accent-dim border border-accent-border flex items-center justify-center">
        <MapPin size={26} className="text-blue-t" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[15px] font-semibold text-text">{t('drops_managed_in_profiles')}</h1>
        <p className="text-[13px] max-w-[300px] leading-relaxed text-muted">
          {t('drops_description')}
        </p>
      </div>
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-card border border-border text-[13px] text-muted">
        <Users size={14} className="text-blue-t" />
        <span className="text-text">{t('nav_profiles')}</span>
        <ArrowRight size={12} />
        <span className="text-text">{t('drops_expand_row')}</span>
        <ArrowRight size={12} />
        <span className="text-text">{t('nav_drops_tab')}</span>
      </div>
    </div>
  )
}
