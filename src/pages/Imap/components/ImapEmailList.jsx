import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { RefreshCw, Search, Mail, FolderSearch } from 'lucide-react'
import { ImapEmailRow } from './ImapEmailRow.jsx'
import { ActionBadge } from './ImapActionBadge.jsx'
import { IMAP_OVERSCAN } from '../../../constants/virtualization.js'
import { useLang } from '../../../hooks/useLang'

const MSG_PAGE_SIZE = 30

/**
 * ImapEmailList - Virtualized email list component
 */
export function ImapEmailList({
  messages,
  selectedMessage,
  selectedFolder,
  selectedAccount,
  msgTotal,
  msgPage,
  loadingMsgs,
  onLoadMessages,
  onSelectMessage,
  onSearch,
  onMarkRead: _onMarkRead,
  onArchive: _onArchive,
  onDelete: _onDelete,
  msgSearch,
  onMsgContextMenu,
  domainRoutes = [],
  searchAll = false,
  onToggleSearchAll,
}) {
  const { t } = useLang()
  const totalPages = Math.ceil(msgTotal / MSG_PAGE_SIZE)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)
  const parentRef = useRef(null)

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 65,
    overscan: IMAP_OVERSCAN,
  })

  const handleSearchChange = e => {
    const val = e.target.value
    if (searchRef.current !== null) searchRef.current.value = val
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch(val)
    }, 400)
  }

  // IMAP-ROUTING: клик по чипу домена = мгновенный фильтр (from_email содержит домен)
  const applyDomainFilter = domain => {
    if (searchRef.current !== null) searchRef.current.value = domain
    clearTimeout(debounceRef.current)
    onSearch(domain)
  }

  return (
    <div className="w-[300px] shrink-0 border-r flex flex-col overflow-y-auto">
      <div className="p-[8px_12px] border-b bg-card flex items-center gap-1.5">
        <span className="text-12 font-semibold flex-1">
          {searchAll ? t('imap_all_folders') : selectedFolder}
        </span>
        <span className="text-11 text-muted">{msgTotal} msgs</span>
        <button
          onClick={() =>
            selectedAccount &&
            onLoadMessages(selectedAccount.id, selectedFolder, msgPage, msgSearch)
          }
          className="btn btn-ghost btn-sm p-[2px_4px]"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      <div className="p-[6px_10px] border-b flex items-center gap-1.5 bg-surface">
        <Search size={12} className="text-muted shrink-0" />
        <input
          type="search"
          placeholder="Search messages…"
          defaultValue={msgSearch}
          ref={searchRef}
          onChange={handleSearchChange}
          className="flex-1 border-none bg-transparent outline-none text-12 text-text min-w-0"
        />
        <button
          onClick={onToggleSearchAll}
          className={`px-2 py-[2px] rounded-full text-11 border transition-colors shrink-0 ${
            searchAll
              ? 'bg-accent text-white border-accent'
              : 'bg-transparent text-muted border-border hover:bg-hover'
          }`}
          title={t('imap_search_all_hint')}
          aria-pressed={searchAll}
        >
          <FolderSearch size={11} className="inline -mt-px" /> {t('imap_all_folders')}
        </button>
      </div>

      {domainRoutes.length > 0 && (
        <div className="px-[10px] py-[6px] border-b flex flex-wrap gap-1 bg-surface">
          {domainRoutes.map(r => {
            const active = msgSearch === r.domain
            return (
              <button
                key={r.domain}
                onClick={() => applyDomainFilter(active ? '' : r.domain)}
                className={`px-2 py-[2px] rounded-full text-11 border transition-colors ${
                  active
                    ? 'bg-accent text-white border-accent'
                    : 'bg-transparent text-muted border-border hover:bg-hover'
                }`}
                title={r.account_label ?? ''}
              >
                {r.domain}
              </button>
            )
          })}
        </div>
      )}

      {loadingMsgs ? (
        <div className="p-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[52px] bg-hover rounded mb-1.5" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="p-[40px_16px] text-center text-12 text-muted">
          <Mail size={30} className="opacity-[0.3] mb-2" />
          <div>No messages in {selectedFolder}</div>
          <div className="text-11 mt-1 text-dim">Click Check Now to fetch</div>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const msg = messages[virtualRow.index]
              return (
                <div
                  key={msg.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  onClick={() => onSelectMessage(msg)}
                  onContextMenu={e => {
                    e.preventDefault()
                    onMsgContextMenu?.({ x: e.clientX, y: e.clientY, msg })
                  }}
                  className={`message-list-item ${selectedMessage?.id === msg.id ? 'active' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ImapEmailRow
                    msg={msg}
                    selectedMessage={selectedMessage}
                    ActionBadge={ActionBadge}
                  />
                </div>
              )
            })}
          </div>

          {totalPages > 1 && !searchAll && (
            <div className="flex justify-center gap-2 p-3 border-t">
              <button
                disabled={msgPage <= 1}
                onClick={() =>
                  onLoadMessages(selectedAccount.id, selectedFolder, msgPage - 1, msgSearch)
                }
                className="btn btn-ghost btn-sm"
              >
                ← Prev
              </button>
              <span className="text-12 text-muted self-center">
                {msgPage} / {totalPages}
              </span>
              <button
                disabled={msgPage >= totalPages}
                onClick={() =>
                  onLoadMessages(selectedAccount.id, selectedFolder, msgPage + 1, msgSearch)
                }
                className="btn btn-ghost btn-sm"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
