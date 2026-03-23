import { AlertTriangle } from 'lucide-react'
import { useLang } from '../../hooks/useLang'

export function ProfileFilters({ filter, searchInput, onFilterChange, onSearchChange, onSearch }) {
  const { t } = useLang()

  const handleFilterClick = newFilter => {
    onFilterChange(newFilter)
  }

  return (
    <div className="filters">
      <button
        className={`flt${filter.card_status === null && filter.has_drop === null ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, card_status: null, has_drop: null })}
      >
        {t('filter_all')}
      </button>
      <button
        className={`flt${filter.card_status === 'active' ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, card_status: 'active' })}
      >
        {t('status_in_use')}
      </button>
      <button
        className={`flt${filter.card_status === 'dead' ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, card_status: 'dead' })}
      >
        {t('status_dead')}
      </button>
      <button
        className={`flt${filter.card_status === 'archive' ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, card_status: 'archive' })}
      >
        {t('status_archive')}
      </button>
      <button
        className={`flt${filter.has_drop === true ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, has_drop: true, card_status: null })}
      >
        {t('filter_has_drop')}
      </button>
      <button
        className={`flt${filter.has_drop === false ? ' active' : ''}`}
        onClick={() => handleFilterClick({ ...filter, has_drop: false, card_status: null })}
      >
        <AlertTriangle size={12} /> {t('filter_no_drop')}
      </button>
      <input
        className="search-box"
        placeholder={t('profiles_search_placeholder')}
        value={searchInput}
        onChange={e => onSearchChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onSearch()}
      />
    </div>
  )
}
