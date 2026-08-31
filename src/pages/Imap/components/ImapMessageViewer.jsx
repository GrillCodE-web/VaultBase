import { useState } from 'react'
import { Mail, CheckCircle, CornerUpLeft, Archive, Trash2, Copy, Check } from 'lucide-react'
import { ActionBadge } from './ImapActionBadge'
import { copyText } from '../../../utils/clipboard.js'

/**
 * REDESIGN-05-4 (порция 5): умное копирование — если backend не извлёк
 * трек, ищем его regex'ом в теле (UPS 1Z…, FedEx 12–15, USPS 20–22 цифры).
 */
const TRACK_PATTERNS = [
  /\b1Z[0-9A-Z]{16}\b/, // UPS
  /\b(?:9[0-9]{15,21})\b/, // FedEx/USPS длинные
  /\b(?:\d{12}|\d{15})\b/, // FedEx короткие
]

export function findTrackingInText(text) {
  if (!text) return null
  const plain = text.replace(/<[^>]+>/g, ' ')
  for (const re of TRACK_PATTERNS) {
    const m = plain.match(re)
    if (m) return m[0]
  }
  return null
}

function CopyChip({ value, label }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  const copy = () => {
    copyText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      className="btn btn-ghost btn-sm mono"
      onClick={copy}
      title={label ? `Copy ${label}` : 'Copy'}
      aria-label={label ? `Copy ${label}` : 'Copy value'}
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
      <span className="text-11">{value}</span>
    </button>
  )
}

/**
 * ImapMessageViewer - Email reading panel
 */
export function ImapMessageViewer({ message, onReply, onMarkRead, onDelete, onArchive }) {
  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-13">
        <div className="text-center opacity-50">
          <Mail size={40} className="mb-2" />
          <div>Select a message to read</div>
        </div>
      </div>
    )
  }

  const isHtml = message.body?.trim().startsWith('<')
  // Умное копирование: трек из поля или из тела письма
  const tracking = message.extracted_tracking || findTrackingInText(message.body)

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="p-[12px_16px] border-b bg-card">
        <div className="text-14 font-semibold mb-2 leading-[1.3]">
          {message.subject || '(no subject)'}
        </div>
        <div className="flex flex-col gap-[3px] text-12 text-muted">
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
            <div className="flex gap-1.5 items-center flex-wrap">
              {message.action_taken && <ActionBadge action={message.action_taken} />}
              {message.extracted_order_number && (
                <CopyChip value={message.extracted_order_number} label="order number" />
              )}
              {tracking && <CopyChip value={tracking} label="tracking" />}
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
            <pre className="p-4 text-13 whitespace-pre-wrap break-word m-0 text-text font-inherit">
              {message.body}
            </pre>
          )
        ) : (
          <div className="p-4 text-12 text-muted">No body content</div>
        )}
      </div>
    </div>
  )
}
