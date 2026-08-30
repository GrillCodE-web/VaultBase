import React, { useState, useRef, useEffect } from 'react'
import { X, Search, Keyboard } from 'lucide-react'
import { getShortcutsByCategory, formatKeyForDisplay } from '../config/shortcuts'
import { useLang } from '../hooks/useLang'
import { escapeHtml } from '../utils/escape.js'
import { Modal } from './Modal.jsx'

// Visual keyboard key component
function KeyboardKey({ keyName }) {
  const displayKey = formatKeyForDisplay(keyName)
  return <kbd className="kbd-key">{displayKey}</kbd>
}

// Render key combination with proper spacing
function KeyCombo({ combo }) {
  const parts = combo.split('+').map(p => p.trim())
  return (
    <div className="key-combo">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <KeyboardKey keyName={part} />
          {i < parts.length - 1 && <span className="key-separator">+</span>}
        </React.Fragment>
      ))}
    </div>
  )
}

// Render multiple key options (e.g., "Cmd+K or Ctrl+K")
function KeyOptions({ keys }) {
  return (
    <div className="key-options">
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          <KeyCombo combo={key} />
          {i < keys.length - 1 && <span className="key-separator">or</span>}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function ShortcutsHelp({ onClose }) {
  const { t } = useLang()
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef(null)
  const shortcuts = getShortcutsByCategory()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Filter shortcuts based on search query
  const filteredShortcuts = {}
  Object.entries(shortcuts).forEach(([category, items]) => {
    const filtered = items.filter(
      item =>
        item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.keys.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    if (filtered.length > 0) {
      filteredShortcuts[category] = filtered
    }
  })

  const totalShortcuts = Object.values(shortcuts).reduce((acc, items) => acc + items.length, 0)
  const filteredCount = Object.values(filteredShortcuts).reduce(
    (acc, items) => acc + items.length,
    0
  )

  // REDESIGN-05-2: ручной оверлей/шапка/Escape заменены общим <Modal scroll>;
  // внутренние классы поиска/списка сохранены (components.css).
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="720px"
      scroll
      title={
        <span className="flex items-center gap-2.5">
          <span className="shortcuts-icon-box">
            <Keyboard size={16} style={{ color: 'white' }} />
          </span>
          <span>
            <span className="shortcuts-title block">
              {t('shortcuts_title') || 'Keyboard Shortcuts'}
            </span>
            <span className="shortcuts-subtitle block">{totalShortcuts} shortcuts available</span>
          </span>
        </span>
      }
      footer={
        <>
          <span className="shortcuts-footer-text mr-auto">
            {searchQuery
              ? `Showing ${filteredCount} of ${totalShortcuts} shortcuts`
              : `${totalShortcuts} shortcuts`}
          </span>
          <div className="shortcuts-footer-hint">
            <span className="shortcuts-footer-text">Press</span>
            <KeyboardKey keyName="Esc" />
            <span className="shortcuts-footer-text">to close</span>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Search */}
        <div className="shortcuts-search-wrapper">
          <Search size={14} className="text-muted icon-no-shrink" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search shortcuts..."
            className="shortcuts-search-input"
            aria-label="Search shortcuts"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="shortcuts-clear-btn"
              aria-label="Clear search"
            >
              <X size={12} className="text-muted" />
            </button>
          )}
        </div>

        {/* Shortcuts list */}
        {Object.keys(filteredShortcuts).length === 0 ? (
          <div className="shortcuts-empty">
            No shortcuts found for &quot;{escapeHtml(searchQuery)}&quot;
          </div>
        ) : (
          <div className="shortcuts-categories">
            {Object.entries(filteredShortcuts).map(([category, items]) => (
              <div key={category}>
                <h3 className="shortcuts-category-title">{category}</h3>
                <div className="shortcuts-category-items">
                  {items.map((shortcut, i) => (
                    <div key={i} className="shortcuts-item">
                      <span className="shortcuts-item-desc">{shortcut.description}</span>
                      <KeyOptions keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
