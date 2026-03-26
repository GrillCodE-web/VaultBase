import { Landmark } from 'lucide-react'
import { countryFlag } from '../../utils/formatting.js'

export function CardFilters({
  filter,
  setFilter,
  setPage,
  filterMeta,
  searchInput,
  setSearchInput,
  handleSearch,
  handleResetFilters,
  loading,
  loadCards,
  t,
}) {
  return (
    <>
      {/* Filters row */}
      <div className="filters" role="group" aria-label="Card filters">
        <select
          value={filter.status || ''}
          onChange={e => {
            setFilter(f => ({ ...f, status: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label={t('cc_filter_status')}
        >
          <option value="">{t('cc_filter_status')}</option>
          <option value="free">{t('status_free')}</option>
          <option value="in_use">{t('status_in_use')}</option>
          <option value="dead">{t('status_dead')}</option>
          <option value="archive">{t('status_archive')}</option>
        </select>

        <select
          value={filter.country || ''}
          onChange={e => {
            setFilter(f => ({ ...f, country: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label={t('cc_filter_country')}
        >
          <option value="">{t('cc_filter_country')}</option>
          {filterMeta.countries.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filter.bank_name || ''}
          onChange={e => {
            setFilter(f => ({ ...f, bank_name: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label={t('cc_filter_bank')}
        >
          <option value="">{t('cc_filter_bank')}</option>
          {filterMeta.banks.map(b => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={filter.source || ''}
          onChange={e => {
            setFilter(f => ({ ...f, source: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label={t('cc_filter_source')}
        >
          <option value="">{t('cc_filter_source')}</option>
          {filterMeta.sources.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={filter.card_type || ''}
          onChange={e => {
            setFilter(f => ({ ...f, card_type: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label={t('cc_col_type')}
        >
          <option value="">{t('cc_col_type')}</option>
          <option value="visa">Visa</option>
          <option value="mastercard">Mastercard</option>
          <option value="amex">Amex</option>
          <option value="discover">Discover</option>
        </select>

        {/* P2-DOMAIN: Domain filter */}
        <select
          value={filter.domain || ''}
          onChange={e => {
            setFilter(f => ({ ...f, domain: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label="Filter by domain"
        >
          <option value="">{t('cc_filter_domain') || 'Domain'}</option>
          {filterMeta.domains?.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* P2-QUARANTINE: Quarantine status filter */}
        <select
          value={filter.quarantine_status || ''}
          onChange={e => {
            setFilter(f => ({ ...f, quarantine_status: e.target.value || null }))
            setPage(1)
          }}
          className="inline-select"
          aria-label="Filter by quarantine status"
          title="Filter cards by quarantine status (cards < 14 days old)"
        >
          <option value="">{t('cc_filter_quarantine') || 'Quarantine'}</option>
          <option value="available">
            {t('cc_quarantine_available') || 'Available (>14 days)'}
          </option>
          <option value="quarantined">
            {t('cc_quarantine_status') || 'In Quarantine (<14 days)'}
          </option>
        </select>

        <input
          value={filter.state || ''}
          onChange={e => {
            setFilter(f => ({ ...f, state: e.target.value || null }))
            setPage(1)
          }}
          placeholder={t('drop_field_state')}
          className="search-box"
          style={{ width: 60 }}
          aria-label={t('drop_field_state')}
        />

        <input
          value={filter.zip_prefix || ''}
          onChange={e => {
            setFilter(f => ({ ...f, zip_prefix: e.target.value || null }))
            setPage(1)
          }}
          placeholder="ZIP"
          title={t('cards_zip_filter_hint')}
          className="inline-select w-[70px]"
          aria-label="ZIP prefix filter"
        />

        <div className="ml-auto flex items-center gap-1.5">
          <input
            className="search-box"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={t('btn_search') + '...'}
            aria-label={t('btn_search')}
          />
          <button onClick={handleSearch} className="btn btn-b btn-sm">
            {t('btn_search')}
          </button>
          <button onClick={handleResetFilters} className="btn btn-ghost btn-sm">
            {t('cc_reset_filters')}
          </button>
          <button
            onClick={loadCards}
            className="btn btn-ghost btn-sm"
            title="Refresh (r)"
            aria-label="Refresh cards"
            data-shortcut="refresh"
          >
            {loading ? '⟳' : '↺'}
          </button>
        </div>
      </div>

      {/* Filter chips for bank/country quick-filters */}
      {(filter.bank_name || filter.country) && (
        <div className="flex gap-1.5 mb-2.5 flex-wrap">
          {filter.bank_name && (
            <span className="quick-filter-pill">
              <Landmark size={11} /> {filter.bank_name}
              <button
                onClick={() => setFilter(f => ({ ...f, bank_name: null }))}
                className="quick-filter-remove"
                aria-label={`Remove ${filter.bank_name} filter`}
              >
                ×
              </button>
            </span>
          )}
          {filter.country && (
            <span className="quick-filter-pill">
              {countryFlag(filter.country)} {filter.country}
              <button
                onClick={() => setFilter(f => ({ ...f, country: null }))}
                className="quick-filter-remove"
                aria-label={`Remove ${filter.country} filter`}
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </>
  )
}
