import React from 'react'

/**
 * ImapEmailRow - Single email row in the virtualized list
 */
export const ImapEmailRow = React.memo(function ImapEmailRow({ msg, ActionBadge }) {
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
