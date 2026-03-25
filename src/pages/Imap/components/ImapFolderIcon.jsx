import { Inbox, Send, Trash2, AlertOctagon, FileText, Folder } from 'lucide-react'

/**
 * ImapFolderIcon - Icon based on folder name
 */
export function ImapFolderIcon({ name, size = 13 }) {
  const n = (name ?? '').toLowerCase()
  if (n === 'inbox') return <Inbox size={size} />
  if (n.includes('sent')) return <Send size={size} />
  if (n.includes('trash') || n.includes('deleted')) return <Trash2 size={size} />
  if (n.includes('spam') || n.includes('junk')) return <AlertOctagon size={size} />
  if (n.includes('draft')) return <FileText size={size} />
  return <Folder size={size} />
}
