import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ShoppingCart, X, Sparkles, FolderOpen, Save, Trash2, Plus } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { useSmartSuggestions, SuggestionBadge } from '../Shops'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'
import { STATUS_COLORS } from '../../constants/colors.js'
import { RiskBlock } from './RiskBlock.jsx'

const EMPTY_ITEM = { name: '', sku: '', qty: 1, price: '' }

export function CreateOrderModal({ onCreated, onClose }) {
  const { t } = useLang()
  // Step state
  const [profileId, setProfileId] = useState('')
  const [profileDetail, setProfileDetail] = useState(null)
  const [shopId, setShopId] = useState(null)
  const [shopObj, setShopObj] = useState(null)
  const [shopSearch, setShopSearch] = useState('')
  const [shopResults, setShopResults] = useState([])
  const [dropId, setDropId] = useState(null)
  const [emailId, setEmailId] = useState(null)
  const [emails, setEmails] = useState([])
  const [proxyId, setProxyId] = useState(null)
  const [proxies, setProxies] = useState([])
  const [orderNumber, setOrderNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ ...EMPTY_ITEM }])
  const [riskResult, setRiskResult] = useState(null)
  const [riskLoading, setRiskLoading] = useState(false)
  const [templates, setTemplates] = useState([])
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)
  const [itemSuggestions, setItemSuggestions] = useState({}) // {idx: [{id,name,asin,price}]}
  const [activeItemIdx, setActiveItemIdx] = useState(null)
  const [customEmail, setCustomEmail] = useState('')
  const [emailMode, setEmailMode] = useState('pool') // "pool" | "custom"
  const [profileSearch, setProfileSearch] = useState('')
  const [profileResults, setProfileResults] = useState([])

  const { toast } = usePremiumToast()
  const { suggestions: smartSuggs } = useSmartSuggestions(shopId, profileDetail?.card?.id)

  // ── Profile search ──
  const searchProfiles = useCallback(async q => {
    try {
      const r = await invoke('get_profiles', {
        filter: { search: q || null, has_drop: true },
        page: 1,
        perPage: 20,
      })
      setProfileResults(r.items || [])
    } catch {
      setProfileResults([])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронный поиск профилей
    searchProfiles(profileSearch)
  }, [profileSearch, searchProfiles])

  const selectProfile = async p => {
    setProfileId(p.id)
    setProfileSearch(`${p.holder_masked || '—'} ···${p.last4 || '????'}`)
    setProfileResults([])
    try {
      const d = await invoke('get_profile_detail', { id: p.id })
      setProfileDetail(d)
      // Default to primary drop
      const primary = d.drops?.find(dd => dd.is_primary) || d.drops?.[0]
      if (primary) setDropId(primary.id)
    } catch {
      setProfileDetail(null)
    }
  }

  // ── Shop search ──
  const searchShops = useCallback(async q => {
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
      // Merge: local first, then catalog items not already in local
      const localDomains = new Set(local.map(s => s.domain))
      const merged = [...local, ...catalog.filter(s => !localDomains.has(s.domain))]
      setShopResults(merged)
    } catch {
      setShopResults([])
    }
  }, [])

  const searchCatalogItems = useCallback(async (q, idx) => {
    if (!q || q.length < 2) {
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
      return
    }
    try {
      const results = await invoke('search_catalog_items', { q, limit: 8 })
      setItemSuggestions(p => ({ ...p, [idx]: results }))
    } catch {
      setItemSuggestions(p => ({ ...p, [idx]: [] }))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронный поиск магазинов
    searchShops(shopSearch)
  }, [shopSearch, searchShops])

  const selectShop = async s => {
    if (s._fromCatalog) {
      // Quick-create local shop from catalog data
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
        setShopId(created.id)
        setShopObj(created)
        setShopSearch(created.domain)
      } catch {
        // Fallback: create shop with minimal info
        try {
          const created = await invoke('create_shop', {
            input: {
              name: s.domain,
              url: `https://${s.domain}`,
              category: '',
              notes: '',
              requires_cvv_match: false,
              blocks_vpn: false,
              phone_must_match: false,
              accepts_amex: false,
              requires_avs: false,
              high_cancel_risk: false,
            },
          })
          setShopId(created.id)
          setShopObj(created)
          setShopSearch(created.domain)
        } catch {
          /* ignore */
        }
      }
      setShopResults([])
      return
    }
    setShopId(s.id)
    setShopObj(s)
    setShopSearch(s.name || s.domain)
    setShopResults([])
    // allSettled, а не all: get_emails требует manage_emails, get_proxies —
    // manage_proxies, и у оператора этих прав по умолчанию нет. С Promise.all
    // один отказ ронял всю тройку, и шаблоны заказа (на которые право не
    // нужно) тоже не подгружались — оператор видел три пустых списка без
    // единого сообщения. Теперь каждый список живёт своей жизнью.
    const [em, px, tmpl] = await Promise.allSettled([
      invoke('get_emails', { filter: {}, page: 1, perPage: 100 }),
      invoke('get_proxies', { filter: {}, page: 1, perPage: 100 }),
      invoke('get_order_templates', { shopTag: s.domain }),
    ])
    setEmails(em.status === 'fulfilled' ? em.value.items || [] : [])
    setProxies(px.status === 'fulfilled' ? px.value.items || [] : [])
    setTemplates(tmpl.status === 'fulfilled' ? tmpl.value || [] : [])

    // Об отказе по правам сообщаем один раз и мягко: список останется пустым,
    // но оформить заказ можно и без письма из пула или прокси.
    const denied = [em, px, tmpl]
      .filter(r => r.status === 'rejected')
      .map(r => String(r.reason?.message || r.reason || ''))
      .filter(m => m.startsWith('permission_denied'))
    if (denied.length) {
      console.warn('[Orders] selectShop: часть справочников недоступна по правам:', denied)
    }
  }

  // ── Risk check ──
  useEffect(() => {
    if (!profileId || !shopId || !dropId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- очистка результата риск-проверки
      setRiskResult(null)
      return
    }
    const timer = setTimeout(async () => {
      setRiskLoading(true)
      try {
        const r = await invoke('run_risk_check', {
          profileId,
          shopId,
          dropId,
          emailPoolId: emailId || null,
          proxyId: proxyId || null,
        })
        setRiskResult(r)
      } catch {
        setRiskResult({ level: 'safe', score: 0, warnings: [], offline: true })
      } finally {
        setRiskLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [profileId, shopId, dropId, emailId, proxyId])

  // ── Items ──
  const total = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0), 0)
  const setItem = (idx, key, val) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)))
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }])
  const removeItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))

  // ── Template ──
  const loadTemplate = tmpl => {
    try {
      const parsed = JSON.parse(tmpl.items_json)
      setItems(parsed.map(it => ({ ...it, price: String(it.price) })))
    } catch {
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
      const error = handleError(e, 'Orders.handleSaveTemplate')
      toast(getErrorMessage(error), 'error')
    }
  }

  // ── Submit ──
  const handleCreate = async () => {
    if (!profileId || !shopId || !dropId) {
      toast('Profile, shop and drop are required', 'warn')
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    try {
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
      await invoke('create_order', {
        input: {
          profile_id: profileId,
          shop_id: shopId,
          drop_id: dropId,
          email_pool_id: emailMode === 'pool' ? emailId || null : null,
          proxy_id: proxyId || null,
          order_number: orderNumber || null,
          notes: notesWithEmail || null,
          items: itemsPayload,
        },
      })
      toast('Order created', 'success')
      onCreated()
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
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
  const primaryDrop = drops.find(d => d.is_primary) || drops[0]

  const createModalRef = useRef(null)
  useFocusTrap(createModalRef, true)

  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay items-start overflow-y-auto py-6">
      <div
        ref={createModalRef}
        className="modal w-modal-lg m-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-order-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-card z-10 rounded-t-xl">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-blue-t" />
            <span id="create-order-title" className="font-semibold text-text">
              {t('create_order')}
            </span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* ── 1. Profile ── */}
          <div>
            <label className="form-label">1. Profile *</label>
            <div className="relative">
              <input
                value={profileSearch}
                onChange={e => {
                  setProfileSearch(e.target.value)
                  setProfileId('')
                  setProfileDetail(null)
                }}
                placeholder={t('orders_holder_search_placeholder')}
                className="form-input"
              />
              {profileResults.length > 0 && (
                <div className="dropdown-results">
                  {profileResults.map(p => (
                    <button key={p.id} onClick={() => selectProfile(p)} className="dropdown-btn">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-text">{p.holder_masked || '—'}</span>
                        <div className="flex items-center gap-2 text-[12px] text-muted">
                          <span className="font-mono">···{p.last4}</span>
                          <span>{p.bank_name || ''}</span>
                          <span
                            className={p.drop_count > 0 ? 'drop-count-safe' : 'drop-count-warning'}
                          >
                            {p.drop_count} drop{p.drop_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Profile card */}
            {profileDetail && (
              <div className="info-card">
                <div>
                  <div className="text-muted mb-0.5">Card</div>
                  <div className="text-text mono">
                    ···{profileDetail.profile.last4 || profileDetail.card?.last4}
                  </div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">Bank</div>
                  <div className="text-text">{profileDetail.card?.bank_name || '—'}</div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">{t('primary_drop')}</div>
                  <div className="text-text text-truncate">
                    {primaryDrop
                      ? `${primaryDrop.city}, ${primaryDrop.country}`
                      : t('profile_no_drop')}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Shop ── */}
          <div>
            <label className="form-label">2. Shop *</label>
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
                        <span className="text-[13px] text-text">{s.name || s.domain}</span>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          {s._fromCatalog && <span className="badge-catalog">catalog</span>}
                          {s.domain && !s._fromCatalog && <span className="mono">{s.domain}</span>}
                          {s.score > 0 && (
                            <span className={s.score >= 60 ? 'score-good' : 'score-warning'}>
                              в…{s.score}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Shop flags + smart suggestions */}
            {shopObj && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {FLAGS.filter(f => shopObj[f.key]).map(f => (
                    <span
                      key={f.key}
                      style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 999,
                        ...f.color,
                      }}
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
                {smartSuggs?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted">
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

          {/* ── 3. Drop ── */}
          {drops.length > 0 && (
            <div>
              <label className="form-label">3. Shipping Address</label>
              <div className="flex flex-col gap-1.5">
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
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="text-text font-medium">{d.recipient_name}</span>
                        {d.is_primary && <span className="badge-mini">primary</span>}
                      </div>
                      <div className="text-[11px] text-muted">
                        {d.address}, {d.city}
                        {d.state ? `, ${d.state}` : ''} {d.zip}, {d.country}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── 4+5. Email + Proxy ── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">4. Email (optional)</label>
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
                          {em.is_blocked ? 'в›”' : usedHere ? 'вљ ' : 'вњ“'} {em.email}{' '}
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
                    className="form-input p-[8px_12px] text-[13px]"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="form-label">5. Proxy (optional)</label>
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
                      {px.is_blocked ? 'рџ”ґ' : usedHere ? 'вљ пёЏ' : 'вњ“'}{' '}
                      {px.label || `${px.host}:${px.port}`} ({px.proxy_type.toUpperCase()})
                    </option>
                  )
                })}
              </select>
              {/* G3: Geo-match hint — show recommended proxies matching profile billing country */}
              {(() => {
                const billingCountry =
                  profileDetail?.profile?.country || profileDetail?.card?.country
                if (!billingCountry || proxies.length === 0) return null
                const geoMatches = proxies.filter(
                  px =>
                    !px.is_blocked &&
                    px.country &&
                    px.country.toUpperCase() === billingCountry.toUpperCase()
                )
                if (geoMatches.length === 0) return null
                return (
                  <div className="info-hint-box">
                    <div className="text-info-bold">
                      рџЋЇ {billingCountry.toUpperCase()} proxy recommended for this profile
                    </div>
                    {geoMatches.slice(0, 3).map(px => (
                      <div key={px.id} className="text-muted mono">
                        {px.label || `${px.host}:${px.port}`}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* ── 6. Risk Check ── */}
          <div>
            <label className="form-label">6. Risk Check</label>
            <RiskBlock result={riskResult} loading={riskLoading} />
          </div>

          {/* ── 7. Order number ── */}
          <div>
            <label className="form-label">7. Order Number (optional)</label>
            <input
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              placeholder="ORD-12345"
              className="form-input mono"
            />
          </div>

          {/* ── 8. Items ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">8. Items</label>
              <div className="flex items-center gap-2">
                {/* Load template */}
                {templates.length > 0 && (
                  <div className="relative template-group">
                    <button className="flex items-center gap-1 text-[12px] text-muted bg-transparent border-none cursor-pointer">
                      <FolderOpen size={12} /> Templates
                    </button>
                    <div className="template-dropdown-menu">
                      {templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => loadTemplate(t)}
                          className="template-dropdown-item"
                        >
                          {t.name}
                          {t.shop_tag && <span className="text-muted ml-1">({t.shop_tag})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setShowSaveTemplate(true)}
                  className="flex items-center gap-1 text-[12px] text-muted bg-transparent border-none cursor-pointer"
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
                            className="dropdown-btn-sm flex justify-between items-center"
                          >
                            <span className="text-[12px] text-text text-truncate flex-1 mr-2">
                              {ci.name}
                            </span>
                            <div className="flex gap-1.5 items-center shrink-0">
                              {ci.asin && (
                                <span className="text-[10px] mono text-muted">{ci.asin}</span>
                              )}
                              {ci.price && (
                                <span className="text-[11px] text-green-t">${ci.price}</span>
                              )}
                            </div>
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
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={e => setItem(idx, 'qty', e.target.value)}
                    placeholder="Qty"
                    className="form-input-sm mono"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={item.price}
                    onChange={e => setItem(idx, 'price', e.target.value)}
                    placeholder="$0.00"
                    className="form-input-sm mono"
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    className={items.length === 1 ? 'btn-opacity-disabled' : 'btn-opacity-normal'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addItem} className="btn-text-info">
                <Plus size={12} /> Add Item
              </button>
              {total > 0 && (
                <div className="text-[12px] text-gray-t">
                  Total: <span className="text-text text-mono-medium">${total.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Save template inline dialog */}
            {showSaveTemplate && (
              <div className="template-dialog">
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder={t('template_name')}
                  className="form-input-sm flex-1-auto bg-transparent"
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className={`btn btn-b btn-sm ${!templateName.trim() ? 'btn-opacity-disabled' : 'btn-opacity-normal'}`}
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveTemplate(false)}
                  className="btn-icon-only"
                  aria-label="Cancel save template"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* ── 9. Notes ── */}
          <div>
            <label className="form-label">9. Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="form-input resize-none"
            />
          </div>

          {/* ── Submit ── */}
          <button
            onClick={handleCreate}
            disabled={loading || !profileId || !shopId || !dropId}
            className={`btn btn-b btn-submit-full ${
              loading || !profileId || !shopId || !dropId
                ? 'btn-opacity-disabled'
                : 'btn-opacity-normal'
            }`}
          >
            {loading ? t('msg_loading') : t('create_order') + ' в†’'}
          </button>
        </div>
      </div>
    </div>
  )
}
