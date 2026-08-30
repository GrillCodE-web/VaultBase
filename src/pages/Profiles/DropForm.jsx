import { useState } from 'react'
import { useLang } from '../../hooks/useLang'

export function DropForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || {
      recipient_name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      country: '',
      phone: '',
    }
  )
  const { t } = useLang()
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const valid = form.address.trim() && form.city.trim() && form.country.trim()

  const fields = [
    ['recipient_name', t('drop_field_recipient'), 2],
    ['address', t('drop_field_address'), 2],
    ['city', t('drop_field_city'), 1],
    ['state', t('drop_field_state'), 1],
    ['zip', t('drop_field_zip'), 1],
    ['country', t('drop_field_country'), 1],
    ['phone', t('drop_field_phone'), 2],
  ]

  return (
    <div className="bg-surface rounded-md border p-4 mt-2">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, span]) => (
          <div key={key} className={span === 2 ? 'col-span-full' : ''}>
            <label className="block text-10 uppercase tracking-wide text-muted mb-1">{label}</label>
            <input value={form[key]} onChange={set(key)} className="form-input w-full box-border" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="btn btn-ghost btn-sm">
          {t('btn_cancel')}
        </button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="btn btn-b btn-sm"
        >
          Save Drop
        </button>
      </div>
    </div>
  )
}
