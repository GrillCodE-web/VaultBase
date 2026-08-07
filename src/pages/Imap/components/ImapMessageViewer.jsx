import { Mail, CheckCircle, CornerUpLeft, Archive, Trash2, Package } from 'lucide-react'
import { ActionBadge } from './ImapActionBadge'

/**
 * ImapMessageViewer - Email reading panel
 */
export function ImapMessageViewer({ message, onReply, onMarkRead, onDelete, onArchive }) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-[13px]">
        <div className="text-center opacity-50">
          <Mail size={40} className="mb-2" />
          <div>Select a message to read</div>
        </div>
      </div>
    )
  }

  const isHtml = message.body?.trim().startsWith('<')

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="p-[12px_16px] border-b bg-card">
        <div className="text-[14px] font-semibold mb-2 leading-[1.3]">
          {message.subject || '(no subject)'}
        </div>
        <div className="flex flex-col gap-[3px] text-[12px] text-muted">
          <div>
            <span className="text-dim">From:</span> {message.from_email}
          </div>
          {message.to_email && (
            <div>
              <span className="text-dim">To:</span> {message.to_email}
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-1">
            <span>{message.received_at ? new Date(message.received_at).toLocaleString() : ''}</span>
            <div className="flex gap-1.5 items-center">
              {message.action_taken && <ActionBadge action={message.action_taken} />}
              {message.extracted_order_number && (
                <span className="text-[11px] text-blue-t">
                  <Package size={10} className="inline mr-0.5" />#{message.extracted_order_number}
                </span>
              )}
              {message.extracted_tracking && (
                <span className="mono text-[11px] text-muted">{message.extracted_tracking}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 mt-2">
          {!message.is_read && (
            <button onClick={() => onMarkRead(message)} className="btn btn-b btn-sm">
              <CheckCircle size={12} /> Mark Read
            </button>
          )}
          <button
            onClick={() => onReply(message)}
            className="btn btn-ghost btn-sm"
            aria-label="Reply to message"
          >
            <CornerUpLeft size={12} /> Reply
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onArchive(message)}
            title="Archive"
            aria-label="Archive message"
          >
            <Archive size={12} /> Archive
          </button>
          <button
            className="btn btn-r btn-sm btn-icon"
            onClick={() => onDelete(message)}
            aria-label="Delete message"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-0">
        {message.body ? (
          isHtml ? (
            <iframe
              srcDoc={message.body}
              sandbox=""
              className="w-full h-full border-none bg-white"
              title="email-body"
            />
          ) : (
            <pre className="p-4 text-[13px] whitespace-pre-wrap break-word m-0 text-text font-inherit">
              {message.body}
            </pre>
          )
        ) : (
          <div className="p-4 text-[12px] text-muted">No body content</div>
        )}
      </div>
    </div>
  )
}
