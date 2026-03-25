import { ImapFolderIcon } from './ImapFolderIcon'

/**
 * ImapFolderRow - Single folder row in the folder tree
 */
export function ImapFolderRow({ acc, folder, s, selectedAccount, selectedFolder, onSelectFolder }) {
  const folderStats = s?.folders?.find(f => f.name === folder)
  const unread = folderStats?.unread ?? 0
  const isActive = selectedAccount?.id === acc.id && selectedFolder === folder

  return (
    <div
      onClick={() => onSelectFolder(acc, folder)}
      className={`folder-tree-item ${isActive ? 'active' : ''}`}
    >
      <span className={`text-muted flex ${isActive ? 'active' : ''}`}>
        <ImapFolderIcon name={folder} size={12} />
      </span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{folder}</span>
      {unread > 0 && <span className="unread-badge">{unread}</span>}
    </div>
  )
}
