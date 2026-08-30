/**
 * REDESIGN-05-4 (порция 2): обобщённый выбор колонок таблицы.
 * Раньше был приватным для Cards (Cards/ColumnPicker.jsx) — вынесен в shared,
 * чтобы Orders/Profiles получили тот же UX (показать/скрыть, состояние
 * персистит страница через usePersistedState/usePersistedColumns).
 *
 * lockedIds — колонки вне выбора (чекбоксы, actions): не рисуются в списке.
 * defaultCols — список для кнопки сброса (у Cards это «carder view»).
 */
export function ColumnPicker({
  visible,
  onChange,
  allColumns,
  t,
  defaultCols,
  lockedIds = ['actions'],
}) {
  return (
    <div
      className="column-picker"
      role="group"
      aria-label={t('cc_columns') || 'Select visible columns'}
    >
      <p className="ptitle mb-2 pl-1">{t('cc_columns')}</p>
      {defaultCols && (
        <button
          className="btn btn-ghost btn-sm w-full mb-2 text-11"
          onClick={() => onChange(defaultCols)}
          aria-label={t('cards_carder_view') || 'Reset to default view'}
        >
          {t('cards_carder_view')}
        </button>
      )}
      {allColumns
        .filter(c => !lockedIds.includes(c.id))
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
              aria-label={`Show ${t(col.label)} column`}
            />
            {t(col.label)}
          </label>
        ))}
    </div>
  )
}
