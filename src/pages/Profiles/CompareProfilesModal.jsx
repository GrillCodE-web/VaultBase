import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal.jsx'
import { LoadingSpinner } from '../../components/LoadingSpinner.jsx'
import { profilesApi } from '../../api/profiles.js'
import { useLang } from '../../hooks/useLang'
import { fmtDate } from '../../utils/formatting.js'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

const norm = v => (v == null || v === '' ? '—' : String(v))

/**
 * REDESIGN-05-4 (порция 3): сравнение двух профилей side-by-side —
 * диф перед созданием дубля. Различающиеся строки подсвечиваются.
 */
export function CompareProfilesModal({ ids, onClose }) {
  const { t } = useLang()
  const [details, setDetails] = useState(null) // [ProfileDetail, ProfileDetail]
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setDetails(null)
    setError(null)
    Promise.all(ids.map(id => profilesApi.getProfile(id)))
      .then(res => {
        if (alive) setDetails(res)
      })
      .catch(e => {
        if (alive) setError(getErrorMessage(handleError(e, 'CompareProfiles')))
      })
    return () => {
      alive = false
    }
  }, [ids])

  const buildRows = () => {
    const [a, b] = details
    const dropA = a.drops?.find(d => d.is_primary) || a.drops?.[0] || null
    const dropB = b.drops?.find(d => d.is_primary) || b.drops?.[0] || null
    const rows = [
      [
        'cmp_field_card',
        `${norm(a.card?.last4)} (${norm(a.profile.bin)})`,
        `${norm(b.card?.last4)} (${norm(b.profile.bin)})`,
      ],
      ['cmp_field_bank', a.profile.bank_name, b.profile.bank_name],
      ['cmp_field_card_type', a.profile.card_type, b.profile.card_type],
      ['cmp_field_card_status', a.profile.card_status, b.profile.card_status],
      ['cmp_field_card_country', a.profile.country, b.profile.country],
      ['cmp_field_drops', a.profile.drop_count, b.profile.drop_count],
      ['cmp_field_orders', a.profile.order_count, b.profile.order_count],
      ['cmp_field_recipient', dropA?.recipient_name, dropB?.recipient_name],
      ['cmp_field_address', dropA?.address, dropB?.address],
      ['cmp_field_city', dropA?.city, dropB?.city],
      ['cmp_field_state', dropA?.state, dropB?.state],
      ['cmp_field_zip', dropA?.zip, dropB?.zip],
      ['cmp_field_phone', dropA?.phone, dropB?.phone],
      ['cmp_field_notes', a.profile.notes, b.profile.notes],
      ['cmp_field_created', fmtDate(a.profile.created_at), fmtDate(b.profile.created_at)],
    ]
    return rows.map(([key, va, vb]) => ({
      key,
      va: norm(va),
      vb: norm(vb),
      diff: norm(va) !== norm(vb),
    }))
  }

  return (
    <Modal isOpen onClose={onClose} title={t('cmp_title')} size="xl" scroll>
      {error && <div className="text-12 text-red-t p-2">{error}</div>}
      {!details && !error && <LoadingSpinner />}
      {details && (
        <>
          <div className="text-11 text-muted mb-2">{t('cmp_hint')}</div>
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col" className="w-40"></th>
                <th scope="col">#{ids[0]}</th>
                <th scope="col">#{ids[1]}</th>
              </tr>
            </thead>
            <tbody>
              {buildRows().map(r => (
                <tr key={r.key} className={r.diff ? 'cmp-diff' : ''}>
                  <td className="text-muted">{t(r.key)}</td>
                  <td>{r.va}</td>
                  <td>{r.vb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}
