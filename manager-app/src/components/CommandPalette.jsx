import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useLang } from '../hooks/useLang.jsx'

// Командная палитра (Ctrl+K / Cmd+K). Упрощённый порт воркерской
// CommandPalette: у менеджера нет global_search — только переходы по
// разделам и действия. Классы .pal-* — в manager.css.
//
// Props:
//   onClose()
//   actions: Array<{ id, label, hint?, run }>
//   navItems: Array<{ page, label }>
export default function CommandPalette({ onClose, actions = [], navItems = [] }) {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  const [activeIndexRaw, setActiveIndexRaw] = useState(-1)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()
  const match = useCallback((label) => !q || String(label).toLowerCase().includes(q), [q])

  const visibleActions = useMemo(() => actions.filter((a) => match(a.label)), [actions, match])
  const visibleNav = useMemo(() => navItems.filter((n) => match(n.label)), [navItems, match])

  // Плоский список для клавиатурной навигации
  const flat = useMemo(() => {
    const out = []
    visibleActions.forEach((a) => out.push({ kind: 'action', key: `a:${a.id}`, action: a }))
    visibleNav.forEach((n) => out.push({ kind: 'nav', key: `n:${n.page}`, nav: n }))
    return out
  }, [visibleActions, visibleNav])

  const activeIndex =
    flat.length === 0 ? -1 : activeIndexRaw < 0 ? 0 : Math.min(activeIndexRaw, flat.length - 1)

  const runEntry = (entry) => {
    if (!entry) return
    onClose()
    if (entry.kind === 'action') entry.action.run?.()
    else entry.nav.run?.()
  }

  const handleKey = (e) => {
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

  const indexByKey = useMemo(() => {
    const m = new Map()
    flat.forEach((f, i) => m.set(f.key, i))
    return m
  }, [flat])

  const renderItem = (f, label, hint) => {
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
        <span className="pal-item-label">{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
    )
  }

  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t('palette_placeholder')}
          className="pal-input"
          aria-label={t('palette_placeholder')}
          role="combobox"
          aria-expanded="true"
          aria-activedescendant={activeIndex >= 0 ? `pal-item-${activeIndex}` : undefined}
        />
        <div className="pal-list" ref={listRef} role="listbox">
          {visibleActions.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_actions')}</div>
              {visibleActions.map((a) =>
                renderItem(flat.find((f) => f.key === `a:${a.id}`), a.label, a.hint)
              )}
            </>
          )}
          {visibleNav.length > 0 && (
            <>
              <div className="pal-label">{t('palette_section_nav')}</div>
              {visibleNav.map((n) =>
                renderItem(flat.find((f) => f.key === `n:${n.page}`), n.label, n.hint)
              )}
            </>
          )}
          {flat.length === 0 && <div className="pal-empty">{t('palette_no_results')}</div>}
        </div>
        <div className="pal-foot">
          <kbd>↑↓</kbd> — {t('palette_hint_nav')} · <kbd>Enter</kbd> — {t('palette_hint_run')} ·{' '}
          <kbd>Esc</kbd> — {t('close')}
        </div>
      </div>
    </div>
  )
}
