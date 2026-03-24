export function ColumnPicker({ visible, onChange, _onClose, allColumns, t }) {
  return (
    <div className="column-picker">
      <p className="ptitle mb-2 pl-1">{t('cc_columns')}</p>
      <button
        className="btn btn-ghost btn-sm w-full mb-2 text-[11px]"
        onClick={() =>
          onChange([
            'card_number',
            'expiry',
            'cvv',
            'holder',
            'billing',
            'zip',
            'city',
            'state',
            'country',
            'phone',
            'status',
            'actions',
          ])
        }
      >
        {t('cards_carder_view')}
      </button>
      {allColumns
        .filter(c => c.id !== 'actions')
        .map(col => (
          <label key={col.id} className="column-picker-label">
            <input
              type="checkbox"
              checked={visible.includes(col.id)}
              onChange={e => {
                if (e.target.checked) onChange([...visible, col.id])
                else onChange(visible.filter(v => v !== col.id))
              }}
              className="accent-accent"
            />
            {t(col.label)}
          </label>
        ))}
    </div>
  )
}
