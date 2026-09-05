import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useLang } from '../hooks/useLang.jsx'
import { chatFetch, chatList, chatMarkRead, chatPeers, chatSend } from '../api/server.js'

// REDESIGN-05-5B4: E2E-чат менеджера (docs/CHAT_E2E.md). Менеджер шлёт ОДИН
// запечатанный конверт конкретному воркеру (dm), групповой комнаты нет.
// Живые обновления — Tauri-события chat:message / chat:read от backend'а.

const MAX_BODY_CHARS = 4000

const dmRoom = (a, b) => `dm:${[a, b].sort().join(':')}`

const shortIid = (iid) => (iid && iid.length > 12 ? `${iid.slice(0, 6)}…${iid.slice(-4)}` : iid || '')

function fmtTime(value) {
  if (!value) return ''
  const iso = String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hm}`
}

export default function Chat() {
  const { t } = useLang()
  const [peersData, setPeersData] = useState(null)
  const [messages, setMessages] = useState([])
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')

  const feedRef = useRef(null)
  const selectedRoomRef = useRef(null)
  useEffect(() => {
    selectedRoomRef.current = selectedRoom
  }, [selectedRoom])

  const upsertMessages = useCallback((incoming) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id))
      const fresh = incoming.filter((m) => !seen.has(m.id))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pd, msgs] = await Promise.all([chatPeers(), chatList(null, 500)])
        if (cancelled) return
        setPeersData(pd)
        setMessages(Array.isArray(msgs) ? msgs : [])
        chatFetch().catch(() => {})
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unlisteners = []
    let cancelled = false
    listen('chat:message', (e) => {
      const msg = e.payload
      if (!msg || typeof msg.id !== 'number') return
      upsertMessages([msg])
      if (msg.direction === 'in' && msg.room === selectedRoomRef.current) {
        chatMarkRead([msg.id]).catch(() => {})
      }
    }).then((fn) => !cancelled && unlisteners.push(fn))
    listen('chat:read', (e) => {
      const ids = new Set(e.payload?.ids ?? [])
      if (ids.size === 0) return
      const now = new Date().toISOString()
      setMessages((prev) => prev.map((m) => (ids.has(m.id) && !m.read_at ? { ...m, read_at: now } : m)))
    }).then((fn) => !cancelled && unlisteners.push(fn))
    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [upsertMessages])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages, selectedRoom])

  // Прочитано при входе в комнату.
  useEffect(() => {
    if (!selectedRoom) return
    const ids = messages
      .filter((m) => m.room === selectedRoom && m.direction === 'in' && !m.read_at)
      .map((m) => m.id)
    if (ids.length > 0) chatMarkRead(ids).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoom])

  const rooms = useMemo(() => {
    if (!peersData) return []
    const byRoom = new Map()
    for (const m of messages) {
      const agg = byRoom.get(m.room) ?? { last: null, unread: 0 }
      if (!agg.last || m.id > agg.last.id) agg.last = m
      if (m.direction === 'in' && !m.read_at) agg.unread += 1
      byRoom.set(m.room, agg)
    }
    return (peersData.peers ?? [])
      .map((p) => {
        const room = dmRoom(peersData.self, p.installation_id)
        return {
          room,
          iid: p.installation_id,
          label: p.label || shortIid(p.installation_id),
          ...(byRoom.get(room) ?? { last: null, unread: 0 }),
        }
      })
      .sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0))
  }, [peersData, messages])

  const current = rooms.find((r) => r.room === selectedRoom) ?? null
  const roomMessages = useMemo(
    () => (selectedRoom ? messages.filter((m) => m.room === selectedRoom) : []),
    [messages, selectedRoom]
  )

  const handleRefresh = async () => {
    setFetching(true)
    setError('')
    try {
      await chatFetch()
      const pd = await chatPeers().catch(() => null)
      if (pd) setPeersData(pd)
    } catch (e) {
      setError(String(e))
    } finally {
      setFetching(false)
    }
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || !current || sending) return
    setSending(true)
    setError('')
    try {
      // chat:message прилетит событием — лента пополнится через upsertMessages.
      await chatSend(current.iid, body)
      setDraft('')
    } catch (e) {
      setError(String(e))
    } finally {
      setSending(false)
    }
  }

  const handleComposerKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-layout">
      <div className="chat-head">
        <h2>{t('nav_chat')}</h2>
        <span className="tag accent" title={t('chat_e2e_hint')}>
          {t('chat_e2e_badge')}
        </span>
        <div className="grow" />
        <button className="btn small" onClick={handleRefresh} disabled={fetching}>
          {fetching ? t('loading') : t('refresh')}
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="chat-main">
        <div className="chat-rooms panel">
          {rooms.length === 0 ? (
            <div className="empty">{t('chat_no_peers')}</div>
          ) : (
            rooms.map((r) => (
              <button
                key={r.room}
                className={`chat-room${selectedRoom === r.room ? ' active' : ''}`}
                onClick={() => setSelectedRoom(r.room)}
              >
                <div className="chat-room-title">
                  <span className="chat-room-label">{r.label}</span>
                  {r.unread > 0 && <span className="tag red">{r.unread > 99 ? '99+' : r.unread}</span>}
                </div>
                {r.last && (
                  <div className="chat-room-last">
                    <span className="chat-room-preview">
                      {r.last.direction === 'out' ? `${t('chat_you')}: ` : ''}
                      {r.last.body}
                    </span>
                    <span className="chat-room-time">{fmtTime(r.last.created_at)}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        <div className="chat-feed panel">
          {!current ? (
            <div className="empty">{t('chat_select_room')}</div>
          ) : (
            <>
              <div ref={feedRef} className="chat-messages">
                {roomMessages.length === 0 ? (
                  <div className="empty">{t('chat_empty_room')}</div>
                ) : (
                  roomMessages.map((m) => (
                    <div key={m.id} className={`chat-msg ${m.direction}`}>
                      <div className="chat-msg-body">{m.body}</div>
                      {m.ref_type && m.ref_id && (
                        <div className="chat-msg-ref">
                          {t(`chat_ref_${m.ref_type}`)} #{m.ref_id}
                        </div>
                      )}
                      <div className="chat-msg-time">{fmtTime(m.created_at)}</div>
                    </div>
                  ))
                )}
              </div>
              <div className="chat-composer">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_CHARS))}
                  onKeyDown={handleComposerKey}
                  placeholder={t('chat_input_placeholder')}
                  rows={Math.min(4, Math.max(1, draft.split('\n').length))}
                />
                <button className="btn primary" onClick={handleSend} disabled={sending || !draft.trim()}>
                  {t('chat_send')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
