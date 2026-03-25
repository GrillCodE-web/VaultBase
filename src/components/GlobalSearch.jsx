// GlobalSearch — Universal search component
// FIX F-MED-03: Extracted from App.jsx

import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Search, X, ArrowRight } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { handleError } from '../utils/errorHandler'

const TYPE_PAGE = {
  card: 'cards',
  order: 'orders',
  profile: 'profiles',
  shop: 'shops',
  email: 'imap',
  proxy: 'proxies',
}

export function GlobalSearch({ onNavigate, toast }) {
  const { t } = useLang()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  const performSearch = useCallback(
    async query => {
      if (!query || query.length < 2) {
        setSearchResults([])
        return
      }

      setSearching(true)
      try {
        const results = await invoke('global_search', { query })
        setSearchResults(results || [])
      } catch (e) {
        const error = handleError(e, 'GlobalSearch')
        toast(error.message, 'error')
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    },
    [toast]
  )

  const handleSelect = useCallback(
    item => {
      const page = TYPE_PAGE[item.type]
      if (page) {
        onNavigate(page, item.id)
        setSearchOpen(false)
        setSearchQuery('')
        setSearchResults([])
      }
    },
    [onNavigate]
  )

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter' && searchResults.length > 0) {
        handleSelect(searchResults[0])
      }
    },
    [searchResults, handleSelect]
  )

  if (!searchOpen) {
    return (
      <button
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-var(--accent) hover:bg-var(--accent)/80 transition-colors"
        title={`${t('search')} (Ctrl+K)`}
      >
        <Search size={16} />
        <span className="text-xs text-var(--muted)">{t('search')}...</span>
      </button>
    )
  }

  return (
    <div className="relative flex-1 max-w-md">
      <div className="flex items-center gap-2 px-3 py-2 bg-var(--card) border border-var(--border) rounded-lg">
        <Search size={16} className="text-var(--muted)" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value)
            performSearch(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          placeholder={`${t('search')}...`}
          className="flex-1 bg-transparent outline-none text-sm"
          autoFocus
        />
        {searching && <span className="text-xs text-var(--muted)">{t('loading')}...</span>}
        <button
          onClick={() => {
            setSearchOpen(false)
            setSearchQuery('')
            setSearchResults([])
          }}
          className="p-1 hover:bg-var(--accent) rounded"
        >
          <X size={14} />
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-var(--card) border border-var(--border) rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {searchResults.map((item, idx) => (
            <button
              key={`${item.type}-${item.id}-${idx}`}
              onClick={() => handleSelect(item)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-var(--accent) transition-colors text-left"
            >
              <ArrowRight size={14} className="text-var(--muted)" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.display}</div>
                <div className="text-xs text-var(--muted)">
                  {t(`nav_${TYPE_PAGE[item.type]}`)} • {item.subtitle}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
