import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePersistedState } from '../../hooks/usePersistedState.js'
import { ColumnPicker } from '../../components/ColumnPicker.jsx'

function hasActiveFilter(f) {
  return !!(f.status || f.shop_id || f.date_from || f.date_to || f.search)
}

export function OrderFilters({
  filter,
  setFilter,
  load,
  searchInput,
  setSearchInput,
  shopOptions,
  columns,
  visibleCols,
  onColumnsChange,
}) {
  const { t } = useLang()
  // REDESIGN-05-4 (порция 2): сохранённые фильтры-пресеты (localStorage), как у Cards
  const [presets, setPresets] = usePersistedState('orders_filter_presets', [])
  const [presetName, setPresetName] = useState('')
  const [showPresetInput, setShowPresetInput] = useState(false)
  const [showColPicker, setShowColPicker] = useState(false)

  const setFilterVal = (key, val) => {
    const f = { ...filter, [key]: val }
    setFilter(f)
    load(1, f)
  }

  const handleReset = () => {
    const f = { status: '', shop_id: null, date_from: '', date_to: '', search: '' }
    setFilter(f)
    load(1, f)
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name || !hasActiveFilter(filter)) return
    setPresets(prev => [...prev.filter(p => p.name !== name), { name, filter: { ...filter } }])
    setPresetName('')
    setShowPresetInput(false)
  }

  const loadPreset = preset => {
    const f = { status: '', shop_id: null, date_from: '', date_to: '', ...preset.filter }
    setFilter(f)
    load(1, f)
  }

  return (
    <div className="filters">
      <button
        className={`flt${!filter.status ? ' active' : ''}`}
        onClick={() => setFilterVal('status', '')}
        data-shortcut="refresh"
      >
        {t('filter_all')}
      </button>
      <button
        className={`flt${filter.status === 'pending' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'pending')}
      >
        {t('status_pending')}
      </button>
      <button
        className={`flt${filter.status === 'processing' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'processing')}
      >
        {t('status_processing')}
      </button>
      <button
        className={`flt${filter.status === 'shipped' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'shipped')}
      >
        {t('status_shipped')}
      </button>
      <button
        className={`flt${filter.status === 'in_transit' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'in_transit')}
      >
        {t('status_in_transit')}
      </button>
      <button
        className={`flt${filter.status === 'delivered' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'delivered')}
      >
        {t('status_delivered')}
      </button>
      <button
        className={`flt${filter.status === 'declined' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'declined')}
      >
        {t('status_declined')}
      </button>
      <button
        className={`flt${filter.status === 'cancelled' ? ' active' : ''}`}
        onClick={() => setFilterVal('status', 'cancelled')}
      >
        {t('status_cancelled')}
      </button>
      <select
        value={filter.shop_id || ''}
        onChange={e => {
          const v = e.target.value ? parseInt(e.target.value) : null
          setFilterVal('shop_id', v)
        }}
        className="inline-select"
      >
        <option value="">{t('cc_filter_status').replace('Statuses', 'Shops')}</option>
        {shopOptions.map(s => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={filter.date_from}
        onChange={e => setFilterVal('date_from', e.target.value)}
        className="inline-select px-2 py-[5px]"
        title={t('col_date')}
      />
      <input
        type="date"
        value={filter.date_to}
        onChange={e => setFilterVal('date_to', e.target.value)}
        className="inline-select px-2 py-[5px]"
        title={t('col_date')}
      />
      <input
        className="search-box"
        placeholder="order number, profile..."
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && load(1, { ...filter, search: searchInput })}
      />
      {presets.length > 0 && (
        <select
          value=""
          onChange={e => {
            const p = presets.find(x => x.name === e.target.value)
            if (p) loadPreset(p)
          }}
          className="inline-select max-w-[120px]"
          aria-label={t('cc_filter_presets')}
        >
          <option value="">{t('cc_filter_presets')}</option>
          {presets.map(p => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {hasActiveFilter(filter) && !showPresetInput && (
        <button
          onClick={() => setShowPresetInput(true)}
          className="btn btn-ghost btn-sm"
          title={t('cc_save_filter')}
          aria-label={t('cc_save_filter')}
        >
          <Save size={12} />
        </button>
      )}
      {showPresetInput && (
        <span className="flex items-center gap-1">
          <input
            className="search-box w-[100px]"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && savePreset()}
            placeholder={t('cc_preset_name')}
            autoFocus
          />
          <button onClick={savePreset} className="btn btn-b btn-sm">
            OK
          </button>
          <button
            onClick={() => setShowPresetInput(false)}
            aria-label="Close"
            className="btn btn-ghost btn-sm"
          >
            ✕
          </button>
        </span>
      )}
      {presets.length > 0 && (
        <button
          onClick={() => {
            const last = presets[presets.length - 1]
            if (last) setPresets(prev => prev.filter(p => p.name !== last.name))
          }}
          className="btn btn-ghost btn-sm"
          title={t('cc_delete_last_preset')}
          aria-label={t('cc_delete_last_preset')}
        >
          <Trash2 size={12} />
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setShowColPicker(v => !v)}
          className="btn btn-ghost btn-sm"
          aria-label={t('cc_columns')}
          aria-expanded={showColPicker}
        >
          {t('cc_columns')}
        </button>
        {showColPicker && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
            <ColumnPicker
              visible={visibleCols}
              onChange={onColumnsChange}
              allColumns={columns}
              defaultCols={columns.map(c => c.id)}
              lockedIds={['select', 'actions']}
              t={t}
            />
          </>
        )}
      </div>
      {(filter.status || filter.search || filter.date_from || filter.date_to || filter.shop_id) && (
        <button className="btn btn-ghost btn-sm" onClick={handleReset}>
          Reset
        </button>
      )}
    </div>
  )
}
