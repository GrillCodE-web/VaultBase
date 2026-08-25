import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  CreditCard,
  MapPin,
  Plus,
  Star,
  StarOff,
  Edit2,
  Trash2,
  SearchCode,
  Import,
  Package,
  ShoppingCart,
} from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useConfirm } from '../../hooks/useConfirm'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'
import { CARD_STATUS_COLORS, ORDER_STATUS_CSS } from '../../constants/status.js'
import { DropForm } from './DropForm.jsx'
import { ImportDropsModal } from './ImportDropsModal.jsx'
import { DuplicateDropsModal } from './DuplicateDropsModal.jsx'

export function ProfileDetailPanel({ profileId, onRefresh, onNavigate }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editNotes, setEditNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [addingDrop, setAddingDrop] = useState(false)
  const [editingDrop, setEditingDrop] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showDupDrops, setShowDupDrops] = useState(false)
  const [dupDropGroups, setDupDropGroups] = useState([])
  const [ltvData, setLtvData] = useState(null)
  const { toast } = usePremiumToast()
  const { confirm } = useConfirm()
  const { t } = useLang()

  useEffect(() => {
    if (!profileId) return
    invoke('get_profile_ltv', { profileId: String(profileId) })
      .then(data => setLtvData(data))
      .catch(() => setLtvData(null))
  }, [profileId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await invoke('get_profile_detail', { id: profileId })
      setDetail(d)
      setNotes(d.profile.notes || '')
    } catch (e) {
      const error = handleError(e, 'Profiles.loadDetail')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]) // toast is stable from useToast hook

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка профилей
    load()
  }, [load])

  const saveNotes = async () => {
    try {
      await invoke('update_profile_notes', { id: profileId, notes })
      setEditNotes(false)
      toast('Notes saved', 'success')
    } catch (e) {
      const error = handleError(e, 'Profiles.handleSaveNotes')
      toast(getErrorMessage(error), 'error')
    }
  }

  const handleAddDrop = async form => {
    try {
      await invoke('add_drop', { profileId, drop: form })
      setAddingDrop(false)
      load()
      onRefresh?.()
      toast('Drop added', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleAutoDropFromBilling = async () => {
    if (!detail?.card) return
    const c = detail.card
    if (!c.billing_address && !c.city) {
      toast('No billing address on card', 'warn')
      return
    }
    const form = {
      recipient_name: c.holder_name || '',
      address: c.billing_address || '',
      city: c.city || '',
      state: c.state || '',
      zip: c.zip || '',
      country: c.country || '',
      phone: c.phone || '',
    }
    try {
      await invoke('add_drop', { profileId, drop: form })
      load()
      onRefresh?.()
      toast('Drop created from billing address', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleUpdateDrop = async form => {
    try {
      await invoke('update_drop', { id: editingDrop.id, drop: form })
      setEditingDrop(null)
      load()
      toast('Drop updated', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleSetPrimary = async drop => {
    try {
      await invoke('set_primary_drop', { id: drop.id, profileId })
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleDeleteDrop = async drop => {
    const ok = await confirm(t('confirm_delete_drop'), { danger: true })
    if (!ok) return
    try {
      await invoke('delete_drop', { id: drop.id })
      load()
      onRefresh?.()
      toast('Drop deleted', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleFindDupDrops = async () => {
    try {
      const groups = await invoke('find_duplicate_drops')
      setDupDropGroups(groups)
      setShowDupDrops(true)
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--color-info-bg)] border-t-blue animate-spin" />
      </div>
    )
  }
  if (!detail) return null

  const { card, drops, orders } = detail

  return (
    <div className="border-t border-border" style={{ background: 'var(--overlay-loading)' }}>
      <div className="grid grid-cols-3 border-t-0">
        {/* ── Card info ── */}
        <div className="p-5 border-r border-border">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={14} className="text-blue-t" />
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
              {t('section_card')}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {[
              [
                t('card_label_number'),
                card.card_number ? `${card.bin || ''}••••••••${card.last4 || ''}` : '—',
              ],
              [t('card_label_expiry'), card.expiry_date || '—'],
              [t('card_label_cvv'), '•••'],
              [t('card_label_holder'), card.holder_name || '—'],
              [t('card_label_bank'), card.bank_name || '—'],
              [t('card_label_type'), card.card_type || '—'],
              [t('card_label_level'), card.card_level || '—'],
              [t('card_label_country'), card.country || '—'],
              [t('cc_col_status'), card.status || '—'],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-muted">{label}</span>
                <span
                  className="text-[12px] mono"
                  style={{
                    color:
                      label === t('cc_col_status')
                        ? CARD_STATUS_COLORS[card.status]?.text || 'var(--muted)'
                        : 'var(--text)',
                  }}
                >
                  {val}
                </span>
              </div>
            ))}
          </div>
          {/* Notes */}
          <div className="pt-4 mt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted">{t('cc_col_notes')}</span>
              {!editNotes && (
                <button
                  onClick={() => setEditNotes(true)}
                  aria-label="Edit notes"
                  className="bg-transparent border-none cursor-pointer text-muted p-0.5"
                >
                  <Edit2 size={12} />
                </button>
              )}
            </div>
            {editNotes ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  className="w-full box-border bg-surface border rounded p-\[8px_12px\] text-[12px] text-text outline-none resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditNotes(false)} className="btn btn-ghost btn-sm">
                    {t('btn_cancel')}
                  </button>
                  <button onClick={saveNotes} className="btn btn-b btn-sm">
                    {t('btn_save')}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted italic m-0">{notes || t('no_notes')}</p>
            )}
          </div>
        </div>

        {/* ── Drops ── */}
        <div className="p-5 border-r border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-green-t" />
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
                {t('section_shipping')}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleFindDupDrops}
                title={t('find_dup_drops')}
                className="icon-btn icon-btn-yellow"
              >
                <SearchCode size={13} />
              </button>
              <button
                onClick={() => setShowImport(true)}
                title={t('import_drops')}
                className="icon-btn icon-btn-blue"
              >
                <Import size={13} />
              </button>
              <button
                onClick={handleAutoDropFromBilling}
                title="Auto-create drop from card billing address"
                className="icon-btn icon-btn-purple"
              >
                <CreditCard size={13} />
              </button>
              <button
                onClick={() => {
                  setAddingDrop(true)
                  setEditingDrop(null)
                }}
                title={t('add_drop')}
                className="icon-btn icon-btn-green"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {addingDrop && <DropForm onSave={handleAddDrop} onCancel={() => setAddingDrop(false)} />}

          <div className="flex flex-col gap-2 max-h-[288px] overflow-y-auto pr-1">
            {drops.length === 0 && !addingDrop && (
              <div className="text-center py-6 text-muted text-[12px]">
                <MapPin size={24} className="block opacity-30 mx-auto mb-2" />
                No shipping addresses
              </div>
            )}
            {drops.map(drop => (
              <div key={drop.id}>
                {editingDrop?.id === drop.id ? (
                  <DropForm
                    initial={drop}
                    onSave={handleUpdateDrop}
                    onCancel={() => setEditingDrop(null)}
                  />
                ) : (
                  <div
                    className="rounded-[10px] p-3 transition-border"
                    style={{
                      border: `1px solid ${drop.is_primary ? 'var(--color-success-bg)' : 'var(--border)'}`,
                      background: drop.is_primary ? 'var(--color-success-bg)' : 'var(--surface)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {drop.is_primary && (
                            <Star size={11} className="text-green-t fill-green-t shrink-0" />
                          )}
                          <span className="text-[12px] font-medium text-text overflow-hidden text-ellipsis whitespace-nowrap">
                            {drop.recipient_name}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted leading-[1.5] m-0">
                          {drop.address}, {drop.city}
                          {drop.state ? `, ${drop.state}` : ''} {drop.zip}, {drop.country}
                        </p>
                        {drop.phone && (
                          <p className="text-[11px] text-muted mt-0.5 mb-0">{drop.phone}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {!drop.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(drop)}
                            title={t('set_primary')}
                            className="icon-btn icon-btn-green"
                          >
                            <StarOff size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingDrop(drop)}
                          aria-label="Edit drop"
                          className="icon-btn icon-btn-blue"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteDrop(drop)}
                          aria-label="Delete drop"
                          className="icon-btn icon-btn-red"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Orders ── */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-blue-t" />
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted">
                {t('section_orders')}
              </span>
            </div>
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1"
              onClick={() => onNavigate?.('orders', { profileId })}
            >
              <ShoppingCart size={12} /> New Order
            </button>
          </div>
          {ltvData && (
            <div className="text-[11px] text-muted mb-2.5 mono">
              LTV: ${Number(ltvData.total).toFixed(2)} | {ltvData.orders} orders | Avg $
              {Number(ltvData.avg).toFixed(2)}
            </div>
          )}
          <div className="flex flex-col max-h-[288px] overflow-y-auto pr-1">
            {orders.length === 0 && (
              <div className="text-center py-6 text-muted text-[12px]">
                <Package size={24} className="block opacity-30 mx-auto mb-2" />
                No orders yet
              </div>
            )}
            {orders.map(o => (
              <div key={o.id} className="order-list-item">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`st ${ORDER_STATUS_CSS[o.status] ?? 'st-archive'}`}>
                      {o.status}
                    </span>
                    <span className="text-[12px] text-text">{o.shop_name || '—'}</span>
                  </div>
                  {o.tracking_number && (
                    <p className="text-[10px] font-mono text-muted m-0">{o.tracking_number}</p>
                  )}
                </div>
                <div className="text-right">
                  {o.total_amount != null && (
                    <p className="text-[12px] text-text m-0">${o.total_amount.toFixed(2)}</p>
                  )}
                  <p className="text-[10px] text-muted m-0">{o.created_at?.slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showImport && (
        <ImportDropsModal
          profileId={profileId}
          onDone={() => {
            load()
            onRefresh?.()
          }}
          onClose={() => setShowImport(false)}
        />
      )}
      {showDupDrops && (
        <DuplicateDropsModal groups={dupDropGroups} onClose={() => setShowDupDrops(false)} />
      )}
    </div>
  )
}
