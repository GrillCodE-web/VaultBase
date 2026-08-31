import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Search,
  X,
  CreditCard,
  ShoppingCart,
  Users,
  Store,
  Mail,
  Shield,
  Bookmark,
  StickyNote,
  Inbox,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { isUnauthorizedError, handleError, getErrorMessage } from '../utils/errorHandler.js'
import { escapeHtml } from '../utils/escape.js'
import { getRecentEntities, recordRecentEntity } from '../utils/recentEntities.js'
import { getOrderPresets, APPLY_ORDER_PRESET_EVENT } from '../utils/orderPresets.js'
import { useOrdersStore } from '../store/orders.js'

const TYPE_PAGE = {
  card: 'cards',
  order: 'orders',
  profile: 'profiles',
  shop: 'shops',
  email: 'imap',
  proxy: 'proxies',
}

const TYPE_ICON = {
  card: CreditCard,
  order: ShoppingCart,
  profile: Users,
  shop: Store,
  email: Mail,
  proxy: Shield,
}

// Подпись результата global_search — общая для строки результата и recent-записи
function resultLabel(item) {
  return (
    (item.last4 ? `••••${item.last4}` : '') ||
    item.order_number ||
    item.name ||
    item.label ||
    item.host ||
    item.domain ||
    ''
  )
}

function resultSub(item) {
  return [item.city, item.country, item.status].filter(Boolean).join(' · ')
}

/**
 * CommandPalette — ⌘K центр команд 05 «Adaptive» (REDESIGN-05-1).
 *
 * Пустой запрос → «Действия» + «Переходы». Запрос → отфильтрованные
 * команды + секции global_search. Классы search-overlay /
 * search-main-input / search-result-row / search-section-label
 * сохранены — на них завязан e2e TEST-003 (e2e не трогаем).
 *
 * Props:
 *   onClose()
 *   onNavigate(page)
 *   actions: Array<{ id?, label, hint?, icon?, run?|onClick? }>
 *   navItems: Array<{ page, label, hint?, icon? }>
 */
export default function CommandPalette({ onClose, onNavigate, actions = [], navItems = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  // REDESIGN-05-4: последние сущности (localStorage) — палитра монтируется
  // при каждом открытии, ленивая инициализация всегда отдаёт свежий список
  const [recent, setRecent] = useState(() => getRecentEntities())
  // REDESIGN-05-4 (порция 4): шаблоны ордеров (localStorage)
  const [presets] = useState(() => getOrderPresets())
  // REDESIGN-05-4 (порция 4): мультивыбор ордеров (Space) + массовый статус
  const [selectedOrders, setSelectedOrders] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // activeIndexRaw: -1 = «не выбрано» → derived ниже даёт первый элемент
  const [activeIndexRaw, setActiveIndexRaw] = useState(-1)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const timerRef = useRef(null)
  const { t } = useLang()
  const { toast } = usePremiumToast()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()

  const match = useCallback(label => !q || String(label).toLowerCase().includes(q), [q])

  const visibleActions = useMemo(() => actions.filter(a => match(a.label)), [actions, match])
  const visibleNav = useMemo(() => navItems.filter(n => match(n.label)), [navItems, match])

  // ── Поиск сущностей (debounce 300ms, команда global_search) ──
  // Результаты хранятся вместе с запросом ({ q, data }): при смене ввода
  // старые секции отсекаются по несовпадению q — без сброса state в effect.
  useEffect(() => {
    if (!q) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await invoke('global_search', { query: query.trim() })
        setResults({ q: query.trim(), data: r })
      } catch (e) {
        if (isUnauthorizedError(e)) onClose()
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timerRef.current)
  }, [q, query, onClose])

  const liveResults = q && results && results.q.toLowerCase() === q ? results.data : null

  // REDESIGN-05-4 (порция 4): FTS-lite поверх существующих команд —
  // письма IMAP (get_unified_inbox) и заметки ордеров/карт (notes,
  // клиентская фильтрация по подстроке). Дедуп против global_search по id.
  const [extResults, setExtResults] = useState(null)
  useEffect(() => {
    if (!q) return
    const timer = setTimeout(async () => {
      const EMPTY_OF = {
        status: null,
        shop_id: null,
        profile_id: null,
        card_id: null,
        search: null,
      }
      const ql = query.trim().toLowerCase()
      const [emailsRes, ordersRes, cardsRes] = await Promise.allSettled([
        invoke('get_unified_inbox', { page: 1, search: query.trim() }),
        invoke('get_orders', { filter: EMPTY_OF, page: 1, perPage: 200 }),
        invoke('get_cards', {
          filter: {
            id: null,
            status: null,
            source: null,
            bank_name: null,
            card_type: null,
            country: null,
            state: null,
            zip_prefix: null,
            search: null,
            bin: null,
            expiring_soon: null,
            domain: null,
          },
          page: 1,
          perPage: 200,
        }),
      ])
      const inNotes = v => typeof v === 'string' && v.toLowerCase().includes(ql)
      const emails = (
        (emailsRes.status === 'fulfilled' ? emailsRes.value?.items : null) ?? []
      ).slice(0, 5)
      const orderNotes = ((ordersRes.status === 'fulfilled' ? ordersRes.value?.items : null) ?? [])
        .filter(o => inNotes(o.notes))
        .slice(0, 5)
        .map(o => ({
          _type: 'order',
          id: o.id,
          label: `#${o.order_number || o.id}`,
          sub: o.notes,
        }))
      const cardNotes = ((cardsRes.status === 'fulfilled' ? cardsRes.value?.items : null) ?? [])
        .filter(c => inNotes(c.notes))
        .slice(0, 5)
        .map(c => ({ _type: 'card', id: c.id, label: `••••${c.last4 || '????'}`, sub: c.notes }))
      setExtResults({ q: query.trim(), emails, notes: [...orderNotes, ...cardNotes] })
    }, 400)
    return () => clearTimeout(timer)
  }, [q, query])

  const liveExt = q && extResults && extResults.q.toLowerCase() === q ? extResults : null

  const sections = useMemo(
    () =>
      liveResults
        ? [
            { key: 'cards', label: t('nav_cards'), items: liveResults.cards ?? [] },
            { key: 'orders', label: t('nav_orders'), items: liveResults.orders ?? [] },
            { key: 'profiles', label: t('nav_profiles'), items: liveResults.profiles ?? [] },
            { key: 'shops', label: t('nav_shops'), items: liveResults.shops ?? [] },
            { key: 'emails', label: t('nav_imap'), items: liveResults.emails ?? [] },
            { key: 'proxies', label: t('nav_proxies'), items: liveResults.proxies ?? [] },
          ].filter(s => s.items.length > 0)
        : [],
    [liveResults, t]
  )

  // REDESIGN-05-4 (порция 4): секции FTS-lite — шаблоны ордеров (матч по
  // имени), письма IMAP и заметки (дедуп id против global_search)
  const extSections = useMemo(() => {
    const out = []
    const seen = new Set()
    if (liveResults) {
      ;['orders', 'cards', 'emails'].forEach(k =>
        (liveResults[k] ?? []).forEach(i => seen.add(`${i._type}:${i.id}`))
      )
    }
    if (q) {
      const ql = q.toLowerCase()
      const presetItems = presets.filter(p => p.name.toLowerCase().includes(ql))
      if (presetItems.length > 0) {
        out.push({ key: 'presets', label: t('palette_section_presets'), items: presetItems })
      }
    }
    if (liveExt) {
      const emails = liveExt.emails.filter(m => !seen.has(`email:${m.id}`))
      if (emails.length > 0) {
        out.push({ key: 'emails_ext', label: t('palette_section_emails'), items: emails })
      }
      const notes = liveExt.notes.filter(n => !seen.has(`${n._type}:${n.id}`))
      if (notes.length > 0) {
        out.push({ key: 'notes', label: t('palette_section_notes'), items: notes })
      }
    }
    return out
  }, [q, liveResults, liveExt, presets, t])

  // Плоский список для клавиатурной навигации: последние (пустой запрос),
  // шаблоны (пустой запрос), действия, переходы, результаты, FTS-секции.
  // Каждая запись знает свой flatIndex — рендер берёт его, без счётчиков.
  const flat = useMemo(() => {
    const out = []
    if (!q) {
      recent.forEach(rec => out.push({ kind: 'recent', key: `rec:${rec.type}-${rec.id}`, rec }))
      presets.forEach(p => out.push({ kind: 'preset', key: `p:${p.id}`, preset: p }))
    }
    visibleActions.forEach(a => out.push({ kind: 'action', key: `a:${a.label}`, action: a }))
    visibleNav.forEach(n => out.push({ kind: 'nav', key: `n:${n.page}`, nav: n }))
    sections.forEach(sec =>
      sec.items.forEach(item =>
        out.push({ kind: 'result', key: `r:${item._type}-${item.id}`, sec, item })
      )
    )
    extSections.forEach(sec =>
      sec.items.forEach(item => {
        if (sec.key === 'presets') {
          out.push({ kind: 'preset', key: `p:${item.id}`, preset: item })
        } else if (sec.key === 'emails_ext') {
          out.push({ kind: 'email', key: `e:${item.id}`, email: item })
        } else {
          out.push({ kind: 'note', key: `nt:${item._type}-${item.id}`, note: item })
        }
      })
    )
    return out
  }, [q, recent, presets, visibleActions, visibleNav, sections, extSections])

  // Derived active index: -1 → первый элемент; за границей → последний
  const activeIndex =
    flat.length === 0 ? -1 : activeIndexRaw < 0 ? 0 : Math.min(activeIndexRaw, flat.length - 1)

  const runEntry = entry => {
    if (!entry) return
    if (entry.kind === 'action') {
      onClose()
      ;(entry.action.run ?? entry.action.onClick)?.()
    } else if (entry.kind === 'nav') {
      onNavigate(entry.nav.page)
      onClose()
    } else if (entry.kind === 'preset') {
      // Пресет ордера → Orders открывает CreateOrderModal с предзаполнением
      onNavigate('orders')
      window.dispatchEvent(
        new window.CustomEvent(APPLY_ORDER_PRESET_EVENT, { detail: entry.preset })
      )
      onClose()
    } else if (entry.kind === 'email') {
      recordRecentEntity({
        type: 'email',
        id: entry.email.id,
        label: entry.email.subject || '(no subject)',
        sub: entry.email.from_email || '',
      })
      onNavigate('imap')
      onClose()
    } else if (entry.kind === 'note') {
      recordRecentEntity({
        type: entry.note._type,
        id: entry.note.id,
        label: entry.note.label,
        sub: entry.note.sub,
      })
      onNavigate(TYPE_PAGE[entry.note._type] ?? 'dashboard')
      onClose()
    } else if (entry.kind === 'recent') {
      // Повторный выбор поднимает запись наверх списка
      const bumped = entry.rec
      recordRecentEntity(bumped)
      setRecent(getRecentEntities())
      onNavigate(TYPE_PAGE[bumped.type] ?? 'dashboard')
      onClose()
    } else {
      recordRecentEntity({
        type: entry.item._type,
        id: entry.item.id,
        label: resultLabel(entry.item),
        sub: resultSub(entry.item),
      })
      onNavigate(TYPE_PAGE[entry.item._type] ?? entry.sec.key)
      onClose()
    }
  }

  // REDESIGN-05-4 (порция 4): Tab — мультивыбор ордера; массовый статус —
  // в футере. Space не трогаем: конфликтует с набором запроса.
  const toggleOrderSelect = useCallback(id => {
    setSelectedOrders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const applyBulkStatus = useCallback(
    async status => {
      const ids = [...selectedOrders]
      if (ids.length === 0 || bulkBusy) return
      setBulkBusy(true)
      try {
        // оптимистичное обновление + инвалидация кэша — внутри стора
        await useOrdersStore.getState().bulkUpdateStatus(ids, status)
        toast(t('palette_bulk_done', { n: ids.length }), 'success')
        setSelectedOrders(new Set())
      } catch (e) {
        const err = handleError(e, 'Palette.bulkStatus')
        toast(getErrorMessage(err), 'error')
      } finally {
        setBulkBusy(false)
      }
    },
    [selectedOrders, bulkBusy, t, toast]
  )

  const handleKey = e => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (selectedOrders.size > 0) {
        setSelectedOrders(new Set())
      } else {
        onClose()
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndexRaw(Math.min(activeIndex + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndexRaw(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'Tab') {
      const entry = flat[activeIndex]
      if (entry?.kind === 'result' && entry.item._type === 'order') {
        e.preventDefault()
        toggleOrderSelect(entry.item.id)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runEntry(flat[activeIndex])
    }
  }

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    listRef.current
      .querySelector(`[data-pal-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // flatIndex каждой записи — из flat; ключи совпадают с рендером
  const indexByKey = useMemo(() => {
    const m = new Map()
    flat.forEach((f, i) => m.set(f.key, i))
    return m
  }, [flat])

  const total =
    sections.reduce((acc, s) => acc + s.items.length, 0) +
    extSections.reduce((acc, s) => acc + s.items.length, 0)

  const renderPalItem = (f, label, Icon, hint) => {
    const idx = indexByKey.get(f.key)
    return (
      <button
        key={f.key}
        id={`pal-item-${idx}`}
        data-pal-index={idx}
        role="option"
        aria-selected={idx === activeIndex}
        className={`pal-item${idx === activeIndex ? ' active' : ''}`}
        onMouseEnter={() => setActiveIndexRaw(idx)}
        onClick={() => runEntry(f)}
      >
        {Icon && <Icon size={14} className="pal-ico" aria-hidden="true" />}
        <span className="pal-item-label">{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
    )
  }

  return (
    <div className="search-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pal" onClick={e => e.stopPropagation()}>
        <div className="search-input-row pal-input-row">
          <Search size={16} className="text-muted icon-no-shrink" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('palette_placeholder')}
            className="search-main-input"
            aria-label={t('palette_placeholder')}
            role="combobox"
            aria-expanded="true"
            aria-activedescendant={activeIndex >= 0 ? `pal-item-${activeIndex}` : undefined}
          />
          {loading && <div className="spinner-sm" />}
          <button onClick={onClose} className="pal-close" aria-label={t('shortcut_close')}>
            <X size={15} className="text-muted" aria-hidden="true" />
          </button>
        </div>

        <div className="pal-list" ref={listRef} role="listbox">
          {!q && recent.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_recent')}</div>
              {recent.map(rec => {
                const key = `rec:${rec.type}-${rec.id}`
                const idx = indexByKey.get(key)
                const RecIcon = TYPE_ICON[rec.type]
                return (
                  <button
                    key={key}
                    id={`pal-item-${idx}`}
                    data-pal-index={idx}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`pal-item${idx === activeIndex ? ' active' : ''}`}
                    onMouseEnter={() => setActiveIndexRaw(idx)}
                    onClick={() => runEntry(flat[idx])}
                  >
                    {RecIcon && <RecIcon size={14} className="pal-ico" aria-hidden="true" />}
                    <span className="pal-item-label">{rec.label || `#${rec.id}`}</span>
                    {rec.sub && <span className="text-muted text-11 ml-auto">{rec.sub}</span>}
                  </button>
                )
              })}
            </>
          )}

          {visibleActions.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_actions')}</div>
              {visibleActions.map(a =>
                renderPalItem(
                  flat.find(f => f.key === `a:${a.label}`),
                  a.label,
                  a.icon,
                  a.hint
                )
              )}
            </>
          )}

          {visibleNav.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_nav')}</div>
              {visibleNav.map(n =>
                renderPalItem(
                  flat.find(f => f.key === `n:${n.page}`),
                  n.label,
                  n.icon,
                  n.hint
                )
              )}
            </>
          )}

          {!q && presets.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_presets')}</div>
              {presets.map(p =>
                renderPalItem(
                  flat.find(f => f.key === `p:${p.id}`),
                  p.name,
                  Bookmark
                )
              )}
            </>
          )}

          {sections.map(sec => (
            <div key={sec.key}>
              <div className="search-section-label">{sec.label}</div>
              {sec.items.map(item => {
                const key = `r:${item._type}-${item.id}`
                const idx = indexByKey.get(key)
                return (
                  <button
                    key={key}
                    id={`pal-item-${idx}`}
                    data-pal-index={idx}
                    role="option"
                    aria-selected={idx === activeIndex}
                    onClick={() => runEntry(flat[idx])}
                    onMouseEnter={() => setActiveIndexRaw(idx)}
                    className={`search-result-row${idx === activeIndex ? ' active' : ''}`}
                  >
                    <span className="search-result-type">{item._type}</span>
                    {item._type === 'order' && selectedOrders.has(item.id) && (
                      <span className="pal-sel-mark" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    <span className="search-result-text">
                      {item.last4 ? `••••${item.last4}` : ''}
                      {item.order_number ?? ''}
                      {item.name ?? ''}
                      {item.city ? ` · ${item.city}` : ''}
                      {item.country ? `, ${item.country}` : ''}
                      {item.label ?? ''}
                      {item.host ?? ''}
                      {item.domain ?? ''}
                    </span>
                    {item.status && <span className="search-result-status">{item.status}</span>}
                  </button>
                )
              })}
            </div>
          ))}

          {extSections.map(sec => (
            <div key={sec.key}>
              <div className="search-section-label">{sec.label}</div>
              {sec.items.map(item => {
                const key =
                  sec.key === 'presets'
                    ? `p:${item.id}`
                    : sec.key === 'emails_ext'
                      ? `e:${item.id}`
                      : `nt:${item._type}-${item.id}`
                const idx = indexByKey.get(key)
                const Icon =
                  sec.key === 'presets' ? Bookmark : sec.key === 'emails_ext' ? Inbox : StickyNote
                return (
                  <button
                    key={key}
                    id={`pal-item-${idx}`}
                    data-pal-index={idx}
                    role="option"
                    aria-selected={idx === activeIndex}
                    onClick={() => runEntry(flat[idx])}
                    onMouseEnter={() => setActiveIndexRaw(idx)}
                    className={`search-result-row${idx === activeIndex ? ' active' : ''}`}
                  >
                    <Icon size={14} className="pal-ico" aria-hidden="true" />
                    <span className="search-result-text">
                      {sec.key === 'presets' && item.name}
                      {sec.key === 'emails_ext' &&
                        `${item.subject || '(no subject)'} · ${item.from_email || ''}`}
                      {sec.key === 'notes' && `${item.label} — ${item.sub}`}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}

          {q && !loading && flat.length === 0 && (
            <div className="search-empty">
              {t('search_no_results').replace('{q}', escapeHtml(query.trim()))}
            </div>
          )}
          {!q && flat.length === 0 && (
            <div className="search-empty text-11">{t('app_type_to_search')}</div>
          )}
        </div>

        <div className="search-footer pal-foot">
          {selectedOrders.size > 0 ? (
            <span className="search-footer-text flex items-center gap-1 flex-wrap">
              <span className="text-accent font-medium">
                {t('palette_bulk_selected', { n: selectedOrders.size })}
              </span>
              {[
                'pending',
                'processing',
                'shipped',
                'in_transit',
                'delivered',
                'declined',
                'cancelled',
              ].map(s => (
                <button
                  key={s}
                  className="btn btn-ghost btn-sm"
                  disabled={bulkBusy}
                  onClick={() => applyBulkStatus(s)}
                >
                  {t(`status_${s}`)}
                </button>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedOrders(new Set())}
                disabled={bulkBusy}
              >
                <X size={11} />
              </button>
            </span>
          ) : (
            <span className="search-footer-text">
              <kbd>↑↓</kbd> — {t('palette_nav_hint')} · <kbd>Enter</kbd> — {t('palette_run_hint')} ·{' '}
              <kbd>Tab</kbd> — {t('palette_sel_hint')} · <kbd>Esc</kbd> —{' '}
              {t('shortcut_close').replace('Esc — ', '')}
            </span>
          )}
          <span className="search-footer-text ml-auto">
            {q && total > 0 ? t('search_result_count').replace('{n}', total) : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
