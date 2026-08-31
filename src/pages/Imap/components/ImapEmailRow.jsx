import React from 'react'

/** Plain-text сниппет из body (может быть HTML) — первые ~90 символов. */
function bodySnippet(body) {
  if (!body) return ''
  const plain = body
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 90 ? `${plain.slice(0, 90)}…` : plain
}

/**
 * ImapEmailRow - Single email row in the virtualized list
 * REDESIGN-05-4 (порция 5): сниппет-предпросмотр тела без открытия письма.
 */
export const ImapEmailRow = React.memo(function ImapEmailRow({ msg, ActionBadge }) {
  const snippet = bodySnippet(msg.body)
  return (
    <>
      <div className="flex justify-between items-start gap-1">
        <div
          className={`text-12 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
            msg.is_read ? 'message-subject-read' : 'message-subject-unread'
          }`}
        >
          {msg.from_email?.replace(/<.*>/, '').trim() || '(unknown)'}
        </div>
        <div className="text-10 text-muted shrink-0">
          {msg.received_at ? new Date(msg.received_at).toLocaleDateString() : ''}
        </div>
      </div>

      <div
        className={`text-12 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5 ${
          msg.is_read ? 'message-subject-read' : 'message-subject-unread'
        }`}
      >
        {msg.subject || '(no subject)'}
      </div>

      {snippet && (
        <div className="text-11 text-muted overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">
          {snippet}
        </div>
      )}

      {msg._folderLabel && (
        <div className="text-10 text-muted mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap">
          {msg._folderLabel}
        </div>
      )}

      {(msg.action_taken || msg.extracted_order_number) && (
        <div className="flex gap-1 mt-[3px] flex-wrap">
          {msg.action_taken && <ActionBadge action={msg.action_taken} />}
          {msg.extracted_order_number && (
            <span className="text-10 text-blue-t">#{msg.extracted_order_number}</span>
          )}
        </div>
      )}
    </>
  )
})
