import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ShoppingCart,
  Sparkles,
  FolderOpen,
  Save,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  MapPin,
} from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { useAuth } from '../../hooks/useAuth'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { Modal } from '../../components/Modal.jsx'
import { useSmartSuggestions, SuggestionBadge } from '../Shops'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'
import { STATUS_COLORS } from '../../constants/colors.js'
import { RiskBlock } from '../Orders/RiskBlock.jsx'
import { DropForm } from './DropForm.jsx'

const EMPTY_ITEM = { name: '', sku: '', qty: 1, price: '' }

// SPEC-A (bri): единая форма заказа в контексте профиля — заменяет 9-шаговый
// CreateOrderModal. Профиль приходит пропом (мы уже внутри него), дроп/email/
// прокси автоподставляются (primary / geo-match), risk-check живой.
// Enter в поле магазина — поиск; Ctrl+Enter — создать и начать следующий.
export function QuickOrderModal({ profile, repeatFrom = null, preset = null, onClose, onCreated }) {
  const { t } = useLang()
  const { policy } = useAuth()
  const { toast } = usePremiumToast()

  // ── контекст профиля ──
  const [profileDetail, setProfileDetail] = useState(null)

  // ── магазин ──
  // SPEC-A (7cx): предзаполнение из repeatFrom/preset — ленивые инициализаторы
  // useState (одноразовые, модалка монтируется заново при каждом открытии),
  // а не эффекты с setState (react-hooks/set-state-in-effect).
  const [shopId, setShopId] = useState(() => repeatFrom?.shop_id ?? preset?.shop_id ?? null)
  const [shopObj, setShopObj] = useState(null)
  const [shopSearch, setShopSearch] = useState(() => {
    const src = repeatFrom ?? preset
    if (!src?.shop_id) return ''
    return src.shop_name || src.shop_domain || `Shop #${src.shop_id}`
  })
  const [shopResults, setShopResults] = useState([])

  // ── подстановки ──
  // Дроп копируем только из preset (тот же профиль); repeatFrom — НЕ копируем
  // (иначе дроп профиля A уезжал бы в заказ профиля B — там primary текущего).
  const [dropId, setDropId] = useState(() => preset?.drop_id ?? null)
  const [emails, setEmails] = useState([])
  const [emailId, setEmailId] = useState(null)
  const [emailMode, setEmailMode] = useState('pool')
  const [customEmail, setCustomEmail] = useState('')
  const [proxies, setProxies] = useState([])
  const [proxyId, setProxyId] = useState(null)

  // ── заказ ──
  const [items, setItems] = useState(() => {
    const its = repeatFrom?.items
    if (Array.isArray(its) && its.length > 0) {
      return its.map(it => ({
        name: it.name || '',
        sku: it.sku || '',
        qty: it.qty || 1,
        price: it.price != null ? String(it.price) : '',
      }))
    }
    return [{ ...EMPTY_ITEM }]
  })
  const [orderNumber, setOrderNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [addingDrop, setAddingDrop] = useState(false)

  // ── риск/шаблоны ──
  const [riskResult, setRiskResult] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [templates, setTemplates] = useState([])
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  // BUG-016: sequence-защита асинхронного поиска (как в CreateOrderModal)
  const searchSeqRef = useRef({ shop: 0, items: {} })
  const selectShopSeqRef = useRef(0)
  const quickCreateRef = useRef(false)
  const [itemSuggestions, setItemSuggestions] = useState({})
  const [activeItemIdx, setActiveItemIdx] = useState(null)

  const { suggestions: smartSuggs } = useSmartSuggestions(shopId, profileDetail?.card?.id)

  // MGR-019: чёрный список шопов (как в CreateOrderModal)
  const isShopBlacklisted = useCallback(
    s => {
      const bl = policy?.shop_blacklist
      if (!Array.isArray(bl) || bl.length === 0) return false
      const host = String(s?.domain || s?.url || '')
        .replace(/^[a-z]+:\/\//i, '')
        .split('/')[0]
        .split(':')[0]
        .toLowerCase()
      if (!host) return false
      return bl.some(d => host === d || host.endsWith(`.${d}`))
    },
    [policy]
  )

  // ── загрузка профиля: дропы + автоподстановка primary ──
  const loadProfileDetail = useCallback(async () => {
    try {
      const d = await invoke('get_profile_detail', { id: profile.id })
      setProfileDetail(d)
      const primary = d.drops?.find(dd => dd.is_primary) || d.drops?.[0]
      // Предзаполненный дроп (preset из ⌘K) оставляем, только если он реально
      // принадлежит ЭТОМУ профилю; иначе — primary.
      setDropId(prev => {
        if (prev != null && d.drops?.some(dd => dd.id === prev)) return prev
        return primary?.id ?? prev
      })
    } catch (e) {
      handleError(e)
    }
  }, [profile.id])

  useEffect(() => {
    // микротаска, не синхронно в теле эффекта (react-hooks/set-state-in-effect)
    // — паттерн как в Profiles.jsx
    const run = async () => {
      await Promise.resolve()
      loadProfileDetail()
    }
    run()
  }, [loadProfileDetail])

  // Предзаполнение repeatFrom/preset — в ленивых инициализаторах useState выше.

  // Справочники email/прокси грузим один раз; allSettled — у оператора может
  // не быть прав manage_emails/manage_proxies, и это не должно ронять форму.
  useEffect(() => {
    ;(async () => {
      const [em, px] = await Promise.allSettled([
        invoke('get_emails', { filter: {}, page: 1, perPage: 100 }),
        invoke('get_proxies', { filter: {}, page: 1, perPage: 100 }),
      ])
      setEmails(em.status === 'fulfilled' ? em.value.items || [] : [])
      setProxies(px.status === 'fulfilled' ? px.value.items || [] : [])
    })()
  }, [])

  // ── поиск магазина (local + catalog, blacklist, seq-защита) ──
  const searchShops = useCallback(
    async q => {
      const seq = ++searchSeqRef.current.shop
      if (!q.trim()) {
        setShopResults([])
        return
      }
      try {
        const [local, catalog] = await Promise.all([
          invoke('get_shops', { page: 1, perPage: 8, search: q })
            .then(r => r.items || [])
            .catch(() => []),
          invoke('search_catalog_shops', { q, limit: 6 })
            .then(r => r.map(s => ({ ...s, _fromCatalog: true })))
            .catch(() => []),
        ])
        if (seq !== searchSeqRef.current.shop) return
        const localDomains = new Set(local.map(s => s.domain))
        const merged = [...local, ...catalog.filter(s => !localDomains.has(s.domain))]
        setShopResults(merged.filter(s => !isShopBlacklisted(s)))
      } catch (e) {
        if (seq !== searchSeqRef.current.shop) return
        handleError(e)
        setShopResults([])
      }
    },
    [isShopBlacklisted]
  )

  useEffect(() => {
    // магазин уже выбран (или предзаполнен repeatFrom) — поиск не нужен
    if (shopId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронный поиск магазинов
    searchShops(shopSearch)
  }, [shopSearch, shopId, searchShops])

  const selectShop = async s => {
    if (s._fromCatalog && quickCreateRef.current) return
    const mySelect = ++selectShopSeqRef.current
    if (s._fromCatalog) {
      quickCreateRef.current = true
      try {
        const created = await invoke('create_shop', {
          input: {
            name: s.domain,
            url: `https://${s.domain}`,
            category: s.category || '',
            notes: s.top_products ? `Top products: ${s.top_products}` : '',
            requires_cvv_match: false,
            blocks_vpn: false,
            phone_must_match: false,
            accepts_amex: false,
            requires_avs: false,
            high_cancel_risk: false,
          },
        })
        if (mySelect !== selectShopSeqRef.current) return
        setShopId(created.id)
        setShopObj(created)
        setShopSearch(created.domain)
      } catch (e) {
        handleError(e)
      } finally {
        quickCreateRef.current = false
      }
      setShopResults([])
      return
    }
    setShopId(s.id)
    setShopObj(s)
    setShopSearch(s.name || s.domain)
    setShopResults([])
    // Шаблоны товаров по магазину (право не нужно — грузим мягко)
    try {
      const tmpl = await invoke('get_order_templates', { shopTag: s.domain })
      setTemplates(tmpl || [])
    } catch {
      setTemplates([])
    }
  }

  // ── товары ──
  const searchCatalogItems = useCallback(async (q, idx) => {
    const prev = searchSeqRef.current.items[idx] || 0
    const seq = (searchSeqRef.current.items[idx] = prev + 1)
    if (!q || q.length < 2) {
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
      return
    }
    try {
      const results = await invoke('search_catalog_items', { q, limit: 8 })
      if (seq !== (searchSeqRef.current.items[idx] || 0)) return
      setItemSuggestions(p => ({ ...p, [idx]: results }))
    } catch (e) {
      if (seq !== (searchSeqRef.current.items[idx] || 0)) return
      handleError(e)
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
    }
  }, [])

  const setItem = (idx, key, val) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)))
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }])
  const removeItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))
  const total = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0), 0)

  // ── живой risk-check (debounce 400мс) ──
  useEffect(() => {
    if (!shopId || !dropId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- очистка результата риск-проверки
      setRiskResult(null)
      return
    }
    const timer = setTimeout(async () => {
      setRiskLoading(true)
      try {
        const r = await invoke('run_risk_check', {
          profileId: profile.id,
          shopId,
          dropId,
          emailPoolId: emailMode === 'pool' ? emailId || null : null,
          proxyId: proxyId || null,
          amount: total > 0 ? total : null,
        })
        setRiskResult(r)
      } catch (e) {
        handleError(e)
        setRiskResult({ level: 'safe', score: 0, warnings: [], offline: true })
      } finally {
        setRiskLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [profile.id, shopId, dropId, emailId, emailMode, proxyId, total])

  // ── шаблоны ──
  const loadTemplate = tmpl => {
    try {
      const parsed = JSON.parse(tmpl.items_json)
      setItems(parsed.map(it => ({ ...it, price: String(it.price) })))
    } catch (e) {
      handleError(e)
      toast(t('template_invalid'), 'error')
    }
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return
    try {
      await invoke('save_order_template', {
        input: {
          name: templateName,
          shop_tag: shopObj?.domain || null,
          items_json: JSON.stringify(items),
        },
      })
      toast('Template saved', 'success')
      setShowSaveTemplate(false)
      setTemplateName('')
    } catch (e) {
      const error = handleError(e, 'QuickOrderModal.handleSaveTemplate')
      toast(getErrorMessage(error), 'error')
    }
  }

  // ── дропы: inline-добавление прямо в форме ──
  const handleAddDrop = async form => {
    try {
      await invoke('add_drop', { profileId: profile.id, drop: form })
      setAddingDrop(false)
      await loadProfileDetail()
      toast('Drop added', 'success')
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleDropFromBilling = async () => {
    const c = profileDetail?.card
    if (!c || (!c.billing_address && !c.city)) {
      toast('No billing address on card', 'warn')
      return
    }
    await handleAddDrop({
      recipient_name: c.holder_name || '',
      address: c.billing_address || '',
      city: c.city || '',
      state: c.state || '',
      zip: c.zip || '',
      country: c.country || '',
      phone: c.phone || '',
    })
  }

  // ── submit ──
  const buildPayload = () => {
    const itemsPayload = items
      .filter(i => i.name.trim())
      .map(i => ({
        name: i.name,
        sku: i.sku,
        qty: parseInt(i.qty) || 1,
        price: parseFloat(i.price) || 0,
      }))
    const notesWithEmail =
      emailMode === 'custom' && customEmail
        ? `Email: ${customEmail}${notes ? `\n${notes}` : ''}`
        : notes
    return {
      profile_id: String(profile.id),
      shop_id: shopId,
      drop_id: dropId,
      email_pool_id: emailMode === 'pool' ? emailId || null : null,
      proxy_id: proxyId || null,
      order_number: orderNumber || null,
      notes: notesWithEmail || null,
      items: itemsPayload,
    }
  }

  const doCreate = async keepOpen => {
    if (!shopId || !dropId) {
      toast('Shop and drop are required', 'warn')
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    try {
      await invoke('create_order', { input: buildPayload() })
      toast('Order created', 'success')
      onCreated?.()
      if (keepOpen) {
        // «Создать и следующий»: сбрасываем только заказ, контекст остаётся
        setItems([{ ...EMPTY_ITEM }])
        setOrderNumber('')
        setNotes('')
        setShopId(null)
        setShopObj(null)
        setShopSearch('')
      } else {
        onClose()
      }
    } catch (e) {
      toast(getErrorMessage(handleError(e, 'QuickOrderModal.create')), 'error')
    } finally {
      setSaving(false)
      submittingRef.current = false
    }
  }

  const FLAGS = [
    {
      key: 'requires_cvv_match',
      label: t('flag_cvv_match'),
      color: { color: STATUS_COLORS.info, background: STATUS_COLORS.infoBg },
    },
    {
      key: 'blocks_vpn',
      label: t('flag_blocks_vpn'),
      color: { color: STATUS_COLORS.error, background: STATUS_COLORS.errorBg },
    },
    {
      key: 'phone_must_match',
      label: t('flag_phone_match'),
      color: { color: 'var(--yellow-t)', background: 'var(--color-warning-bg)' },
    },
    {
      key: 'requires_avs',
      label: 'AVS',
      color: { color: STATUS_COLORS.info, background: 'var(--color-info-bg)' },
    },
    {
      key: 'high_cancel_risk',
      label: t('flag_cancel_risk'),
      color: { color: 'var(--orange)', background: 'var(--color-warning-bg)' },
    },
  ]

  const drops = profileDetail?.drops || []
  const billingCountry = profileDetail?.profile?.country || profileDetail?.card?.country
  const geoProxies = billingCountry
    ? proxies.filter(
        px =>
          !px.is_blocked && px.country && px.country.toUpperCase() === billingCountry.toUpperCase()
      )
    : []

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      scroll
      title={
        <span className="flex items-center gap-2">
          <ShoppingCart size={16} className="text-blue-t" />
          {t('create_order')} — {profile.holder_masked || `••••${profile.last4 || '????'}`}
        </span>
      }
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => doCreate(true)}
            disabled={!shopId || !dropId || saving}
            title="Ctrl+Enter"
          >
            Create & next
          </button>
          <button
            className="btn btn-g"
            onClick={() => doCreate(false)}
            disabled={!shopId || !dropId || saving}
          >
            {saving ? 'Creating...' : t('create_order')}
          </button>
        </>
      }
    >
      <div
        className="flex flex-col gap-5"
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            doCreate(true)
          }
        }}
      >
        {/* ── Shop ── */}
        <div>
          <label className="form-label">{t('create_order_shop') || 'Shop'} *</label>
          <div className="relative">
            <input
              value={shopSearch}
              onChange={e => {
                setShopSearch(e.target.value)
                setShopId(null)
                setShopObj(null)
              }}
              placeholder={t('orders_shop_search_placeholder')}
              className="form-input"
              autoFocus
            />
            {shopResults.length > 0 && (
              <div className="dropdown-results">
                {shopResults.map(s => (
                  <button
                    key={s._fromCatalog ? `cat-${s.id}` : s.id}
                    onClick={() => selectShop(s)}
                    className="dropdown-btn"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-13 text-text">{s.name || s.domain}</span>
                      <div className="flex items-center gap-1.5 text-11 text-muted">
                        {s._fromCatalog && <span className="badge-catalog">catalog</span>}
                        {s.domain && !s._fromCatalog && <span className="mono">{s.domain}</span>}
                        {s.score > 0 && (
                          <span className={s.score >= 60 ? 'score-good' : 'score-warning'}>
                            ★{s.score}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {shopObj && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {FLAGS.filter(f => shopObj[f.key]).map(f => (
                  <span
                    key={f.key}
                    className="text-10 px-2 py-0.5 rounded-full"
                    style={{ ...f.color }}
                  >
                    {f.label}
                  </span>
                ))}
              </div>
              {smartSuggs?.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-10 uppercase tracking-widest text-muted">
                    <Sparkles size={11} /> Smart Suggestions
                  </div>
                  {smartSuggs.map((s, i) => (
                    <SuggestionBadge key={i} s={s} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Items ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">{t('order_items') || 'Items'}</label>
            <div className="flex items-center gap-2">
              {templates.length > 0 && (
                <div className="relative template-group">
                  <button className="flex items-center gap-1 text-12 text-muted bg-transparent border-none cursor-pointer">
                    <FolderOpen size={12} /> Templates
                  </button>
                  <div className="template-dropdown-menu">
                    {templates.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => loadTemplate(tmpl)}
                        className="template-dropdown-item"
                      >
                        {tmpl.name}
                        {tmpl.shop_tag && (
                          <span className="text-muted ml-1">({tmpl.shop_tag})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowSaveTemplate(true)}
                className="flex items-center gap-1 text-12 text-muted bg-transparent border-none cursor-pointer"
              >
                <Save size={12} /> Save Template
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid gap-2 items-center grid-items-layout">
                <div className="relative">
                  <input
                    value={item.name}
                    onChange={e => {
                      setItem(idx, 'name', e.target.value)
                      setActiveItemIdx(idx)
                      searchCatalogItems(e.target.value, idx)
                    }}
                    onBlur={() =>
                      setTimeout(() => {
                        setItemSuggestions(p => ({ ...p, [idx]: [] }))
                        setActiveItemIdx(null)
                      }, 200)
                    }
                    placeholder={t('item_name')}
                    className="form-input-sm"
                  />
                  {activeItemIdx === idx && (itemSuggestions[idx] || []).length > 0 && (
                    <div className="dropdown-results-sm">
                      {(itemSuggestions[idx] || []).map(ci => (
                        <button
                          key={ci.id}
                          onMouseDown={() => {
                            setItem(idx, 'name', ci.name)
                            if (ci.asin) setItem(idx, 'sku', ci.asin)
                            if (ci.price) setItem(idx, 'price', String(ci.price))
                            setItemSuggestions(p => ({ ...p, [idx]: [] }))
                          }}
                          className="dropdown-btn"
                        >
                          <span className="text-12">{ci.name}</span>
                          {ci.price > 0 && (
                            <span className="text-11 text-muted ml-2">${ci.price}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  value={item.sku}
                  onChange={e => setItem(idx, 'sku', e.target.value)}
                  placeholder="SKU"
                  className="form-input-sm mono"
                />
                <input
                  value={item.qty}
                  onChange={e => setItem(idx, 'qty', e.target.value)}
                  type="number"
                  min="1"
                  className="form-input-sm"
                />
                <input
                  value={item.price}
                  onChange={e => setItem(idx, 'price', e.target.value)}
                  placeholder="0.00"
                  className="form-input-sm mono"
                />
                <button
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="text-muted hover:text-red-t bg-transparent border-none cursor-pointer disabled:opacity-30"
                  aria-label="Remove item"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-2">
            <button
              onClick={addItem}
              className="flex items-center gap-1 text-12 text-blue-t bg-transparent border-none cursor-pointer"
            >
              <Plus size={12} /> {t('order_add_item') || 'Add item'}
            </button>
            <div className="text-13">
              <span className="text-muted">{t('order_total') || 'Total'}: </span>
              <span className="mono text-text font-medium">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ── Drop (обязателен; автоподстановка primary) ── */}
        <div>
          <div className="flex items-center justify-between">
            <label className="form-label mb-0">{t('order_drop') || 'Shipping Address'} *</label>
            {!addingDrop && (
              <button
                onClick={() => setAddingDrop(true)}
                className="flex items-center gap-1 text-12 text-muted bg-transparent border-none cursor-pointer"
              >
                <Plus size={12} /> {t('add_drop')}
              </button>
            )}
          </div>
          {addingDrop ? (
            <div className="mt-2">
              <DropForm onSave={handleAddDrop} onCancel={() => setAddingDrop(false)} />
            </div>
          ) : drops.length === 0 ? (
            <div className="empty-inline">
              <MapPin size={14} className="text-warning" />
              <span>{t('orders_profile_no_drops')}</span>
              {profileDetail?.card && (
                <button
                  onClick={handleDropFromBilling}
                  className="text-12 text-blue-t bg-transparent border-none cursor-pointer"
                >
                  {t('drop_from_billing') || 'Use billing address'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mt-2">
              {drops.map(d => (
                <label
                  key={d.id}
                  onClick={() => setDropId(d.id)}
                  className={`radio-label ${dropId === d.id ? 'selected' : ''}`}
                >
                  <div className={`radio-circle ${dropId === d.id ? 'selected' : ''}`}>
                    {dropId === d.id && <div className="radio-dot" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-12">
                      <span className="text-text font-medium">{d.recipient_name}</span>
                      {d.is_primary && <span className="badge-mini">primary</span>}
                    </div>
                    <div className="text-11 text-muted">
                      {d.address}, {d.city}
                      {d.state ? `, ${d.state}` : ''} {d.zip}, {d.country}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ── Риск (живой) ── */}
        <RiskBlock result={riskResult} loading={riskLoading} />

        {/* ── Advanced: email / proxy / номер / заметки ── */}
        <div>
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-1 text-12 text-muted bg-transparent border-none cursor-pointer"
          >
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {t('order_advanced') || 'Advanced'} — email, proxy, order #
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-4 mt-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Email (optional)</label>
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEmailMode('pool')}
                        className={`mode-toggle-btn ${emailMode === 'pool' ? 'active' : ''}`}
                      >
                        Pool
                      </button>
                      <button
                        onClick={() => setEmailMode('custom')}
                        className={`mode-toggle-btn ${emailMode === 'custom' ? 'active' : ''}`}
                      >
                        Custom
                      </button>
                    </div>
                    {emailMode === 'pool' ? (
                      <select
                        value={emailId || ''}
                        onChange={e => setEmailId(e.target.value ? parseInt(e.target.value) : null)}
                        className="inline-select w-full"
                      >
                        <option value="">— None —</option>
                        {emails.map(em => {
                          const usedHere = em.shops_used?.some(s => s.id === shopId)
                          return (
                            <option key={em.id} value={em.id} disabled={em.is_blocked}>
                              {em.is_blocked ? '⛔' : usedHere ? '⚠️' : '✔'} {em.email}{' '}
                              {em.label ? `(${em.label})` : ''}
                            </option>
                          )
                        })}
                      </select>
                    ) : (
                      <input
                        type="email"
                        value={customEmail}
                        onChange={e => setCustomEmail(e.target.value)}
                        placeholder="user@example.com"
                        className="form-input p-[8px_12px] text-13"
                      />
                    )}
                  </div>
                </div>
                <div>
                  <label className="form-label">Proxy (optional)</label>
                  <select
                    value={proxyId || ''}
                    onChange={e => setProxyId(e.target.value ? parseInt(e.target.value) : null)}
                    className="inline-select w-full"
                  >
                    <option value="">— None —</option>
                    {proxies.map(px => {
                      const usedHere = px.shops_used?.some(s => s.id === shopId)
                      return (
                        <option key={px.id} value={px.id} disabled={px.is_blocked}>
                          {px.is_blocked ? '🔴' : usedHere ? '⚠️' : '✔'}{' '}
                          {px.label || `${px.host}:${px.port}`} ({px.proxy_type.toUpperCase()})
                        </option>
                      )
                    })}
                  </select>
                  {geoProxies.length > 0 && (
                    <div className="info-hint-box">
                      <div className="text-info-bold">
                        🎯 {billingCountry.toUpperCase()} proxy recommended
                      </div>
                      {geoProxies.slice(0, 3).map(px => (
                        <div key={px.id} className="text-muted mono">
                          {px.label || `${px.host}:${px.port}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="form-label">
                  {t('order_number') || 'Order Number'} (optional)
                </label>
                <input
                  value={orderNumber}
                  onChange={e => setOrderNumber(e.target.value)}
                  placeholder="ORD-12345"
                  className="form-input mono"
                />
              </div>
              <div>
                <label className="form-label">{t('order_notes') || 'Notes'} (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="form-input"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save-template диалог */}
      {showSaveTemplate && (
        <Modal
          isOpen
          onClose={() => setShowSaveTemplate(false)}
          size="sm"
          title="Save Template"
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setShowSaveTemplate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-g"
                onClick={handleSaveTemplate}
                disabled={!templateName.trim()}
              >
                Save
              </button>
            </>
          }
        >
          <input
            className="form-input"
            placeholder="Template name"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            autoFocus
          />
        </Modal>
      )}
    </Modal>
  )
}
