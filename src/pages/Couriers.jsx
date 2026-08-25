import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Truck,
  Package as PackageIcon,
  Plus,
  RefreshCw,
  Download,
  X,
  MapPin,
  Loader2,
  Settings as SettingsIcon,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useAuth } from '../hooks/useAuth'
import { Modal } from '../components/Modal.jsx'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// Енум pay_option панели SWAT (docs/API_STUFFER.md, new_package). Панель
// жёстко валидирует значения — старый список prepaid/cod/... давал 400.
// Реальные значения приходят из stuffer_get_config (capabilities провайдера).
const DEFAULT_PAY_OPTIONS = ['%', 'forwarding', 'test', '50/50_admin', '50/50_stuffer', 'sale']

const EMPTY_FORM = {
  courier_id: '',
  name: '',
  comment: '',
  holder_name: '',
  weight: '',
  quantity: '',
  shop: '',
  price: '',
  delivery_date: '',
  pay_option: '',
  asin: '',
  upc: '',
  tracks: [{ track: '', carrier: '' }],
}

function base64ToBlobUrl(b64) {
  const bin = window.atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

export default function Couriers({ activeTab, onNavigate }) {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { hasPerm } = useAuth()

  const tab = ['assigned', 'available', 'packages'].includes(activeTab) ? activeTab : 'assigned'

  const [couriers, setCouriers] = useState([])
  const [available, setAvailable] = useState([])
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState(null)

  const [labelsFor, setLabelsFor] = useState(null)
  const [labels, setLabels] = useState([])
  const [labelsLoading, setLabelsLoading] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)

  const notify = useCallback((e, ctx) => toastErr(getErrorMessage(handleError(e, ctx))), [toastErr])

  // Пока не знаем статус ключа — null. true/false после проверки.
  // Без ключа не дёргаем API вообще: иначе на каждой вкладке сыпались тосты
  // «Stuffer не настроен». Вместо этого показываем экран настройки.
  const [stufferReady, setStufferReady] = useState(null)
  // Енум pay_option отдаёт бэкенд из capabilities провайдера (панель жёстко
  // валидирует значения). Дефолт — енум SWAT из docs/API_STUFFER.md.
  const [payOptions, setPayOptions] = useState(DEFAULT_PAY_OPTIONS)
  useEffect(() => {
    invoke('stuffer_get_config')
      .then(cfg => {
        setStufferReady(!!cfg?.api_key_set)
        if (Array.isArray(cfg?.pay_options) && cfg.pay_options.length) {
          setPayOptions(cfg.pay_options)
        }
      })
      .catch(() => setStufferReady(false))
  }, [])

  const load = useCallback(async () => {
    if (!stufferReady) return
    setLoading(true)
    try {
      if (tab === 'assigned') setCouriers(await invoke('stuffer_list_couriers'))
      else if (tab === 'available') setAvailable(await invoke('stuffer_list_available_couriers'))
      else if (tab === 'packages') setPackages(await invoke('stuffer_list_packages'))
    } catch (e) {
      notify(e, `Couriers.load.${tab}`)
    } finally {
      setLoading(false)
    }
  }, [tab, notify, stufferReady])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка курьеров
    load()
  }, [load])

  // Assigned couriers are needed for the "new package" courier selector.
  useEffect(() => {
    if (stufferReady && tab === 'packages' && couriers.length === 0) {
      invoke('stuffer_list_couriers')
        .then(setCouriers)
        .catch(() => {})
    }
  }, [tab, couriers.length, stufferReady])

  const handleAdd = async id => {
    if (!hasPerm('manage_couriers')) return
    setAddingId(id)
    try {
      await invoke('stuffer_add_courier', { courierId: id })
      toastOk(t('couriers_added'))
      setAvailable(prev => prev.filter(c => c.id !== id))
    } catch (e) {
      notify(e, 'Couriers.add')
    } finally {
      setAddingId(null)
    }
  }

  const openLabels = async pkgId => {
    setLabelsFor(pkgId)
    setLabels([])
    setLabelsLoading(true)
    try {
      setLabels(await invoke('stuffer_get_labels', { packageId: pkgId }))
    } catch (e) {
      notify(e, 'Couriers.labels')
    } finally {
      setLabelsLoading(false)
    }
  }

  const downloadLabel = label => {
    if (!label.file) {
      toastErr(t('pkg_no_pdf'))
      return
    }
    const url = base64ToBlobUrl(label.file)
    const a = document.createElement('a')
    a.href = url
    a.download = `label_${label.track || 'package'}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setTrack = (i, k, v) =>
    setForm(f => ({
      ...f,
      tracks: f.tracks.map((tr, idx) => (idx === i ? { ...tr, [k]: v } : tr)),
    }))
  const addTrackRow = () =>
    setForm(f => ({ ...f, tracks: [...f.tracks, { track: '', carrier: '' }] }))
  const removeTrackRow = i =>
    setForm(f => ({ ...f, tracks: f.tracks.filter((_, idx) => idx !== i) }))

  const submit = async () => {
    if (!form.courier_id) {
      toastErr(t('pkg_courier_required'))
      return
    }
    if (!form.shop || !form.shop.trim()) {
      toastErr(t('pkg_shop_required') || 'Shop is required')
      return
    }
    setCreating(true)
    try {
      const tracks = form.tracks.filter(tr => tr.track.trim())
      const pkg = {
        courier_id: parseInt(form.courier_id, 10),
        name: form.name || null,
        comment: form.comment || null,
        holder_name: form.holder_name || null,
        weight: form.weight || null,
        quantity: form.quantity ? parseInt(form.quantity, 10) : null,
        shop: form.shop || null,
        price: form.price ? parseFloat(form.price) : null,
        delivery_date: form.delivery_date || null,
        pay_option: form.pay_option || null,
        asin: form.asin || null,
        upc: form.upc || null,
        pickup: null,
        pickup_address: null,
        pickup_holder_name: null,
        tracks: tracks.length ? tracks : null,
      }
      const id = await invoke('stuffer_create_package', { package: pkg })
      toastOk(`${t('pkg_created')} #${id}`)
      setShowForm(false)
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      notify(e, 'Couriers.create')
    } finally {
      setCreating(false)
    }
  }

  const renderPkgCount = p => (
    <span className="courier-pkg-count">
      <span className="st st-active">
        {t('couriers_pkg_new')}: {p?.new ?? 0}
      </span>
      <span className="st st-pending">
        {t('couriers_pkg_shipped')}: {p?.shipped ?? 0}
      </span>
      <span className="st st-used">
        {t('couriers_pkg_sent')}: {p?.sent ?? 0}
      </span>
    </span>
  )

  // ── Assigned couriers ──
  if (tab === 'assigned') {
    if (loading)
      return (
        <div className="content">
          <SkeletonRows count={6} />
        </div>
      )
    if (!couriers.length)
      return <EmptyState icon={<Truck size={40} />} title={t('couriers_assigned_empty')} />
    return (
      <div className="couriers-grid p-4">
        {couriers.map(c => (
          <div key={c.id} className="courier-card">
            <div className="courier-card__head">
              <span className="courier-card__name">{c.name || `#${c.id}`}</span>
              <span className={`st st-${c.status || 'used'}`}>{c.status}</span>
            </div>
            <div className="courier-card__addr">
              <MapPin size={13} />
              <span>
                {[c.address1, c.address2].filter(Boolean).join(', ')}
                {c.city ? `, ${c.city}` : ''} {c.state} {c.zip} {c.country}
              </span>
            </div>
            {c.expired_date && (
              <div className="courier-card__exp">
                {t('couriers_expires')}: {c.expired_date}
              </div>
            )}
            {renderPkgCount(c.packages)}
            {c.public_description && (
              <div className="courier-card__desc">{c.public_description}</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ── Available couriers ──
  if (tab === 'available') {
    if (loading)
      return (
        <div className="content">
          <SkeletonRows count={6} />
        </div>
      )
    if (!available.length)
      return <EmptyState icon={<Truck size={40} />} title={t('couriers_available_empty')} />
    return (
      <div className="couriers-grid p-4">
        {available.map(c => (
          <div key={c.id} className="courier-card">
            <div className="courier-card__head">
              <span className="courier-card__name">
                {c.city}
                {c.state ? `, ${c.state}` : ''}
              </span>
              <span className={`st st-${c.status || 'used'}`}>{c.status}</span>
            </div>
            <div className="courier-card__addr">
              <MapPin size={13} />
              <span>
                {c.zip} {c.country}
              </span>
            </div>
            {renderPkgCount(c.packages)}
            {c.public_description && (
              <div className="courier-card__desc">{c.public_description}</div>
            )}
            <button
              className="btn btn-primary btn-sm mt-2"
              disabled={!hasPerm('manage_couriers') || addingId === c.id}
              onClick={() => handleAdd(c.id)}
            >
              {addingId === c.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t('couriers_add')}
            </button>
          </div>
        ))}
      </div>
    )
  }

  // Ключ Stuffer не настроен — показываем аккуратный экран, а не ошибки.
  if (stufferReady === false) {
    return (
      <div className="content">
        <div className="empty-state" style={{ paddingTop: 64 }}>
          <div className="empty-state-icon empty-state-icon--lg">
            <Truck />
          </div>
          <div className="empty-state-title">Stuffer не подключён</div>
          <div className="empty-state-text" style={{ maxWidth: 380 }}>
            Курьеры и посылки берутся из внешнего сервиса Stuffer. Укажите API-ключ в настройках,
            чтобы раздел заработал.
          </div>
          {hasPerm('manage_couriers') && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => onNavigate?.('settings')}
            >
              <SettingsIcon size={14} /> Открыть настройки
            </button>
          )}
        </div>
      </div>
    )
  }

  // Пока проверяем статус ключа — лёгкий скелетон, без дёрганья API.
  if (stufferReady === null) {
    return (
      <div className="content">
        <SkeletonRows count={5} />
      </div>
    )
  }

  // ── Packages ──
  return (
    <div className="content">
      <div className="flex items-center justify-between mb-3">
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={load}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('couriers_refresh')}
        </button>
        {hasPerm('create_packages') && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            <Plus size={14} /> {t('pkg_new')}
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonRows count={6} />
      ) : !packages.length ? (
        <EmptyState icon={<PackageIcon size={40} />} title={t('couriers_packages_empty')} />
      ) : (
        <div className="pkg-table">
          <div className="pkg-row pkg-row--head">
            <span>{t('pkg_id')}</span>
            <span>{t('pkg_name')}</span>
            <span>{t('pkg_status')}</span>
            <span>{t('pkg_tracks')}</span>
            <span />
          </div>
          {packages.map(p => (
            <div key={p.id} className="pkg-row">
              <span className="mono">#{p.id}</span>
              <span>{p.name || '—'}</span>
              <span>
                <span className={`st st-${p.status || 'used'}`}>{p.status}</span>
              </span>
              <span className="mono text-xs">{(p.tracks || []).join(', ') || '—'}</span>
              <span>
                <button className="btn btn-ghost btn-sm" onClick={() => openLabels(p.id)}>
                  <PackageIcon size={13} /> {t('pkg_view_labels')}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Labels panel */}
      <Modal
        isOpen={labelsFor != null}
        onClose={() => setLabelsFor(null)}
        title={`${t('pkg_labels_title')} · #${labelsFor}`}
        size="md"
      >
        {labelsLoading ? (
          <SkeletonRows count={3} />
        ) : !labels.length ? (
          <EmptyState icon={<PackageIcon size={40} />} title={t('pkg_labels_empty')} />
        ) : (
          <div className="cou-label-list">
            {labels.map((l, i) => (
              <div key={i} className="cou-label-row">
                <span className="mono">{l.track}</span>
                <span className="text-muted">{l.carrier}</span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!l.file}
                  onClick={() => downloadLabel(l)}
                >
                  <Download size={13} /> {l.file ? t('pkg_download_pdf') : t('pkg_no_pdf')}
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* New package form */}
      <Modal
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={t('pkg_new')}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
              {t('pkg_cancel')}
            </button>
            <button className="btn btn-primary" disabled={creating} onClick={submit}>
              {creating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <PackageIcon size={14} />
              )}
              {creating ? t('pkg_creating') : t('pkg_create')}
            </button>
          </>
        }
      >
        <div className="cou-form-grid">
          <label className="cou-form-field">
            <span>{t('pkg_courier')} *</span>
            <select value={form.courier_id} onChange={e => setField('courier_id', e.target.value)}>
              <option value="">{t('pkg_select_courier')}</option>
              {couriers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name || `#${c.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_name')}</span>
            <input value={form.name} onChange={e => setField('name', e.target.value)} />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_holder')}</span>
            <input
              value={form.holder_name}
              onChange={e => setField('holder_name', e.target.value)}
            />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_shop')} *</span>
            <input value={form.shop} onChange={e => setField('shop', e.target.value)} required />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_weight')}</span>
            <input value={form.weight} onChange={e => setField('weight', e.target.value)} />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_quantity')}</span>
            <input
              type="number"
              value={form.quantity}
              onChange={e => setField('quantity', e.target.value)}
            />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_price')}</span>
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={e => setField('price', e.target.value)}
            />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_delivery_date')}</span>
            <input
              type="date"
              value={form.delivery_date}
              onChange={e => setField('delivery_date', e.target.value)}
            />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_pay_option')}</span>
            <select value={form.pay_option} onChange={e => setField('pay_option', e.target.value)}>
              <option value="">{t('pkg_select_pay_option') || '— Select —'}</option>
              {payOptions.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_asin')}</span>
            <input value={form.asin} onChange={e => setField('asin', e.target.value)} />
          </label>
          <label className="cou-form-field">
            <span>{t('pkg_field_upc')}</span>
            <input value={form.upc} onChange={e => setField('upc', e.target.value)} />
          </label>
          <label className="cou-form-field cou-form-field--full">
            <span>{t('pkg_field_comment')}</span>
            <textarea
              rows={2}
              value={form.comment}
              onChange={e => setField('comment', e.target.value)}
            />
          </label>
        </div>

        <div className="cou-form-tracks">
          <div className="flex items-center justify-between">
            <span className="form-label">{t('pkg_field_tracks')}</span>
            <button className="btn btn-ghost btn-sm" onClick={addTrackRow}>
              <Plus size={13} /> {t('pkg_add_track')}
            </button>
          </div>
          {form.tracks.map((tr, i) => (
            <div key={i} className="cou-track-row">
              <input
                placeholder={t('pkg_track_number')}
                value={tr.track}
                onChange={e => setTrack(i, 'track', e.target.value)}
              />
              <input
                placeholder={t('pkg_track_carrier')}
                value={tr.carrier}
                onChange={e => setTrack(i, 'carrier', e.target.value)}
              />
              {form.tracks.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label="Remove track"
                  onClick={() => removeTrackRow(i)}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
