import React, { useState, useRef, useEffect } from 'react'
import { X, Search, Keyboard } from 'lucide-react'
import { getShortcutsByCategory, formatKeyForDisplay } from '../config/shortcuts'
import { useLang } from '../hooks/useLang'

// Visual keyboard key component
function KeyboardKey({ keyName }) {
  const displayKey = formatKeyForDisplay(keyName)
  return (
    <kbd
      style={{
        display: 'inline-block',
        background: 'var(--border)',
        color: 'var(--text)',
        borderRadius: 4,
        padding: '3px 8px',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        minWidth: 24,
        textAlign: 'center',
      }}
    >
      {displayKey}
    </kbd>
  )
}

// Render key combination with proper spacing
function KeyCombo({ combo }) {
  const parts = combo.split('+').map(p => p.trim())
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <KeyboardKey keyName={part} />
          {i < parts.length - 1 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>+</span>}
        </React.Fragment>
      ))}
    </div>
  )
}

// Render multiple key options (e.g., "Cmd+K or Ctrl+K")
function KeyOptions({ keys }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          <KeyCombo combo={key} />
          {i < keys.length - 1 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>or</span>}
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

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  const totalShortcuts = Object.values(shortcuts).reduce((acc, items) => acc + items.length, 0)
  const filteredCount = Object.values(filteredShortcuts).reduce(
    (acc, items) => acc + items.length,
    0
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        style={{
          width: '90%',
          maxWidth: 720,
          maxHeight: '85vh',
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Keyboard size={16} style={{ color: 'white' }} />
            </div>
            <div>
              <h2
                id="shortcuts-title"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  margin: 0,
                }}
              >
                {t('shortcuts_title') || 'Keyboard Shortcuts'}
              </h2>
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  margin: 0,
                }}
              >
                {totalShortcuts} shortcuts available
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--border)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
            }}
            aria-label="Close shortcuts help"
          >
            <X size={16} className="text-muted" />
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
            }}
          >
            <Search size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search shortcuts..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 13,
              }}
              aria-label="Search shortcuts"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                }}
                aria-label="Clear search"
              >
                <X size={12} className="text-muted" />
              </button>
            )}
          </div>
        </div>

        {/* Shortcuts list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 20px',
          }}
        >
          {Object.keys(filteredShortcuts).length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No shortcuts found for &quot;{searchQuery}&quot;
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {Object.entries(filteredShortcuts).map(([category, items]) => (
                <div key={category}>
                  <h3
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--accent)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: 12,
                    }}
                  >
                    {category}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((shortcut, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          padding: '10px 12px',
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--text)',
                            flex: 1,
                          }}
                        >
                          {shortcut.description}
                        </span>
                        <KeyOptions keys={shortcut.keys} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {searchQuery
              ? `Showing ${filteredCount} of ${totalShortcuts} shortcuts`
              : `${totalShortcuts} shortcuts`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Press</span>
            <KeyboardKey keyName="Esc" />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>to close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
