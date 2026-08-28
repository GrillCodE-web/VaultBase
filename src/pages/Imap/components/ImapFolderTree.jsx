import { Inbox, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { useLang } from '../../../hooks/useLang.jsx'
import { ImapFolderRow } from './ImapFolderRow.jsx'

// Virtual "All Inboxes" account pseudo-object
const ALL_INBOX = { id: -1, label: 'All Inboxes', is_active: true }

/**
 * ImapFolderTree - Sidebar folder tree with accounts
 */
export function ImapFolderTree({
  accounts,
  expandedAccounts,
  accountFolders,
  loadingFolders,
  stats,
  selectedAccount,
  selectedFolder,
  onToggleExpand,
  onSelectFolder,
  onAddImap,
}) {
  const { t } = useLang()
  const allUnread = Object.values(stats).reduce((s, a) => s + (a?.unread ?? 0), 0)

  return (
    <div className="w-[220px] shrink-0 border-r flex flex-col overflow-y-auto bg-surface">
      <div className="p-[10px_12px] border-b flex justify-between items-center">
        <span className="text-[12px] font-semibold text-muted">ACCOUNTS</span>
        <button
          onClick={onAddImap}
          className="btn btn-ghost btn-sm p-[2px_6px]"
          title="Add IMAP account"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* All Inboxes virtual entry */}
      {accounts.length > 1 && (
        <div
          onClick={() => onSelectFolder(ALL_INBOX, 'INBOX')}
          className={`p-[8px_10px] cursor-pointer flex items-center gap-1.5 border-b folder-tree-item ${
            selectedAccount?.id === -1 ? 'active' : ''
          }`}
        >
          <Inbox size={13} className="shrink-0 text-blue" />
          <span className="text-[12px] flex-1 font-semibold">All Inboxes</span>
          {allUnread > 0 && <span className="unread-badge">{allUnread}</span>}
        </div>
      )}

      {accounts.length === 0 && (
        <div className="p-[20px_12px] text-center text-[12px] text-muted">
          No accounts
          <br />
          <button onClick={onAddImap} className="btn btn-g btn-sm mt-2">
            <Plus size={11} /> Add
          </button>
        </div>
      )}

      {accounts.map(acc => {
        const expanded = expandedAccounts[acc.id]
        const folders = accountFolders[acc.id] ?? []
        const s = stats[acc.id]
        const unread = s?.unread ?? 0
        const isSelected = selectedAccount?.id === acc.id
        const failCount = acc.fail_count ?? 0
        const isDead = failCount >= 3
        const healthTip = isDead
          ? `${t('imap_health_dead')} (${failCount})${acc.last_error ? `: ${acc.last_error}` : ''}`
          : failCount > 0
            ? `${t('imap_health_flaky')} (${failCount})`
            : ''

        return (
          <div key={acc.id}>
            <div
              onClick={() => onToggleExpand(acc)}
              className={`p-[8px_10px] cursor-pointer flex items-center gap-1.5 folder-tree-item ${
                isSelected ? 'active' : ''
              }`}
            >
              {expanded ? (
                <ChevronDown size={13} className="text-muted shrink-0" />
              ) : (
                <ChevronRight size={13} className="text-muted shrink-0" />
              )}
              <Inbox
                size={13}
                className={`shrink-0 folder-icon ${acc.is_active ? 'active' : 'inactive'}`}
              />
              <span className="text-[12px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {acc.label}
              </span>
              {failCount > 0 && (
                <span
                  title={healthTip}
                  className={`shrink-0 flex ${isDead ? 'text-error' : 'text-warning'}`}
                >
                  <AlertTriangle size={12} />
                </span>
              )}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
            </div>

            {expanded && (
              <div className="pl-2">
                {loadingFolders[acc.id] ? (
                  <div className="p-[6px_12px] text-[11px] text-muted">{t('msg_loading')}</div>
                ) : folders.length === 0 ? (
                  ['INBOX'].map(f => (
                    <ImapFolderRow
                      key={f}
                      acc={acc}
                      folder={f}
                      s={s}
                      selectedAccount={selectedAccount}
                      selectedFolder={selectedFolder}
                      onSelectFolder={onSelectFolder}
                    />
                  ))
                ) : (
                  folders.map(f => (
                    <ImapFolderRow
                      key={f}
                      acc={acc}
                      folder={f}
                      s={s}
                      selectedAccount={selectedAccount}
                      selectedFolder={selectedFolder}
                      onSelectFolder={onSelectFolder}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
