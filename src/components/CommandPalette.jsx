import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Search, X } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { isUnauthorizedError } from '../utils/errorHandler.js'
import { escapeHtml } from '../utils/escape.js'

const TYPE_PAGE = {
  card: 'cards',
  order: 'orders',
  profile: 'profiles',
  shop: 'shops',
  email: 'imap',
  proxy: 'proxies',
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
  // activeIndexRaw: -1 = «не выбрано» → derived ниже даёт первый элемент
  const [activeIndexRaw, setActiveIndexRaw] = useState(-1)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const timerRef = useRef(null)
  const { t } = useLang()

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

  // Плоский список для клавиатурной навигации: действия, переходы, результаты.
  // Каждая запись знает свой flatIndex — рендер берёт его, без счётчиков.
  const flat = useMemo(() => {
    const out = []
    visibleActions.forEach(a => out.push({ kind: 'action', key: `a:${a.label}`, action: a }))
    visibleNav.forEach(n => out.push({ kind: 'nav', key: `n:${n.page}`, nav: n }))
    sections.forEach(sec =>
      sec.items.forEach(item =>
        out.push({ kind: 'result', key: `r:${item._type}-${item.id}`, sec, item })
      )
    )
    return out
  }, [visibleActions, visibleNav, sections])

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
    } else {
      onNavigate(TYPE_PAGE[entry.item._type] ?? entry.sec.key)
      onClose()
    }
  }

  const handleKey = e => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndexRaw(Math.min(activeIndex + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndexRaw(Math.max(activeIndex - 1, 0))
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

  const total = sections.reduce((acc, s) => acc + s.items.length, 0)

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
          <span className="search-footer-text">
            <kbd>↑↓</kbd> — {t('palette_nav_hint')} · <kbd>Enter</kbd> — {t('palette_run_hint')} ·{' '}
            <kbd>Esc</kbd> — {t('shortcut_close').replace('Esc — ', '')}
          </span>
          <span className="search-footer-text ml-auto">
            {q && total > 0 ? t('search_result_count').replace('{n}', total) : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
