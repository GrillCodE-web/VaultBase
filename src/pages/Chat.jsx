import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Lock, MessagesSquare, RefreshCw, Send, Users } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// REDESIGN-05-5B4: E2E-чат (docs/CHAT_E2E.md). Backend — commands/chat.rs:
// в сети только sealed-конверты (X25519/AES-GCM), plaintext живёт в SQLCipher.
// Комнаты: 'dm:<iidA>:<iidB>' (iid'ы отсортированы) и 'group:<group_id>'.
// Живые обновления — Tauri-события chat:message / chat:read (эмитит backend
// после WS-нотификации или chat_fetch), pull-to-refresh — кнопка в шапке.

const MAX_BODY_CHARS = 4000

const dmRoom = (a, b) => `dm:${[a, b].sort().join(':')}`

const shortIid = iid => (iid && iid.length > 12 ? `${iid.slice(0, 6)}…${iid.slice(-4)}` : iid || '')

// created_at приходит из SQLite CURRENT_TIMESTAMP (UTC без 'Z').
function fmtTime(value) {
  if (!value) return ''
  const iso = String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hm}`
}

// Известные коды ошибок backend → i18n; остальное — сырой текст через handler.
function chatErrorMessage(e, t) {
  const raw = e instanceof Error ? e.message : String(e)
  const code = raw.split(':')[0].trim()
  const key = `chat_err_${code}`
  const localized = t(key)
  return localized === key ? null : localized
}

export default function Chat() {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()

  const [peersData, setPeersData] = useState(null) // { self, group_id, peers }
  const [messages, setMessages] = useState([])
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [loading, setLoading] = useState(true)

  const feedRef = useRef(null)
  // Ref'ы для стабильных listener'ов (patтерн FIX P0-5 из Imap.jsx).
  const selectedRoomRef = useRef(null)
  useEffect(() => {
    selectedRoomRef.current = selectedRoom
  }, [selectedRoom])

  const markRoomRead = useCallback((room, msgs) => {
    const ids = msgs
      .filter(m => m.room === room && m.direction === 'in' && !m.read_at)
      .map(m => m.id)
    if (ids.length > 0) {
      invoke('chat_mark_read', { ids }).catch(e => handleError(e, 'Chat.markRead'))
    }
  }, [])

  // Слияние пришедшего сообщения (дедуп по id — chat:message эмитится и при
  // своей отправке, и при fetch, invoke-результат chat_send не добавляем).
  const upsertMessages = useCallback(incoming => {
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id))
      const fresh = incoming.filter(m => !seen.has(m.id))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    try {
      const [pd, msgs] = await Promise.all([
        invoke('chat_peers'),
        invoke('chat_list', { room: null, limit: 500 }),
      ])
      setPeersData(pd)
      setMessages(Array.isArray(msgs) ? msgs : [])
      // Свежее с сервера — события chat:message дотащат новинки в ленту.
      invoke('chat_fetch').catch(e => handleError(e, 'Chat.initialFetch'))
    } catch (e) {
      const error = handleError(e, 'Chat.loadInitial')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  // Живые события backend'а.
  useEffect(() => {
    const unlisteners = []
    let cancelled = false
    listen('chat:message', e => {
      const msg = e.payload
      if (!msg || typeof msg.id !== 'number') return
      upsertMessages([msg])
      if (msg.direction === 'in' && msg.room === selectedRoomRef.current) {
        invoke('chat_mark_read', { ids: [msg.id] }).catch(() => {})
      }
    }).then(fn => !cancelled && unlisteners.push(fn))
    listen('chat:read', e => {
      const ids = new Set(e.payload?.ids ?? [])
      if (ids.size === 0) return
      const now = new Date().toISOString()
      setMessages(prev => prev.map(m => (ids.has(m.id) && !m.read_at ? { ...m, read_at: now } : m)))
    }).then(fn => !cancelled && unlisteners.push(fn))
    return () => {
      cancelled = true
      unlisteners.forEach(fn => fn())
    }
  }, [upsertMessages])

  // Автоскролл ленты вниз при новых сообщениях/смене комнаты.
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages, selectedRoom])

  // При входе в комнату — пометить её входящие прочитанными.
  useEffect(() => {
    if (selectedRoom) markRoomRead(selectedRoom, messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoom])

  // ── Комнаты ───────────────────────────────────────────────
  const rooms = useMemo(() => {
    if (!peersData) return []
    const byRoom = new Map()
    for (const m of messages) {
      const agg = byRoom.get(m.room) ?? { last: null, unread: 0 }
      if (!agg.last || m.id > agg.last.id) agg.last = m
      if (m.direction === 'in' && !m.read_at) agg.unread += 1
      byRoom.set(m.room, agg)
    }
    const list = []
    if (peersData.group_id) {
      list.push({
        room: `group:${peersData.group_id}`,
        kind: 'group',
        label: t('chat_group_room'),
        peerIid: null,
        role: null,
        ...(byRoom.get(`group:${peersData.group_id}`) ?? { last: null, unread: 0 }),
      })
    }
    for (const p of peersData.peers ?? []) {
      const room = dmRoom(peersData.self, p.installation_id)
      list.push({
        room,
        kind: 'dm',
        label: p.label || shortIid(p.installation_id),
        peerIid: p.installation_id,
        role: p.role,
        ...(byRoom.get(room) ?? { last: null, unread: 0 }),
      })
    }
    // Активные сверху по времени последнего сообщения, пустые — внизу.
    return list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1
      return (b.last?.id ?? 0) - (a.last?.id ?? 0)
    })
  }, [peersData, messages, t])

  const current = rooms.find(r => r.room === selectedRoom) ?? null
  const roomMessages = useMemo(
    () => (selectedRoom ? messages.filter(m => m.room === selectedRoom) : []),
    [messages, selectedRoom]
  )

  const peerLabel = useCallback(
    iid => {
      const p = peersData?.peers?.find(x => x.installation_id === iid)
      return p?.label || shortIid(iid)
    },
    [peersData]
  )

  // ── Действия ──────────────────────────────────────────────
  const handleRefresh = async () => {
    setFetching(true)
    try {
      const res = await invoke('chat_fetch')
      if ((res?.stored ?? 0) > 0) {
        toastOk(t('chat_new_messages', { n: res.stored }))
      }
      const pd = await invoke('chat_peers').catch(() => null)
      if (pd) setPeersData(pd)
    } catch (e) {
      const error = handleError(e, 'Chat.refresh')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    } finally {
      setFetching(false)
    }
  }

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || !current || sending) return
    setSending(true)
    try {
      // chat:message прилетит событием — в ленту попадёт через upsertMessages.
      await invoke('chat_send', {
        body,
        peerIid: current.kind === 'dm' ? current.peerIid : null,
        refType: null,
        refId: null,
      })
      setDraft('')
    } catch (e) {
      const error = handleError(e, 'Chat.send')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  const handleComposerKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Рендер ────────────────────────────────────────────────
  return (
    <div className="h-full min-h-0 flex flex-col bg-app">
      {/* ── Header ── */}
      <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessagesSquare size={18} className="text-accent" />
            <h1 className="text-sm font-semibold text-text">{t('nav_chat')}</h1>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-border text-muted flex items-center gap-1"
            title={t('chat_e2e_hint')}
          >
            <Lock size={11} aria-hidden="true" />
            {t('chat_e2e_badge')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={fetching}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            title={t('chat_refresh')}
          >
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
            {t('chat_refresh')}
          </button>
        </div>
      </header>

      {/* ── Main: комнаты слева, лента справа ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <aside className="w-64 shrink-0 border-r border-border bg-surface overflow-y-auto">
          {loading ? (
            <div className="p-4 text-xs text-muted">{t('loading')}</div>
          ) : rooms.length === 0 ? (
            <div className="p-4 text-xs text-muted">{t('chat_no_peers')}</div>
          ) : (
            rooms.map(r => (
              <button
                key={r.room}
                onClick={() => setSelectedRoom(r.room)}
                className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors ${
                  selectedRoom === r.room ? 'bg-hover' : 'hover:bg-hover/50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {r.kind === 'group' ? (
                    <Users size={14} className="text-accent shrink-0" />
                  ) : (
                    <MessagesSquare size={14} className="text-muted shrink-0" />
                  )}
                  <span className="text-13 font-medium text-text truncate">{r.label}</span>
                  {r.role === 'manager' && (
                    <span className="text-11 text-muted shrink-0">({t('chat_role_manager')})</span>
                  )}
                  {r.unread > 0 && (
                    <span className="ml-auto text-11 bg-accent text-white rounded-full px-1.5 py-0.5 leading-none shrink-0">
                      {r.unread > 99 ? '99+' : r.unread}
                    </span>
                  )}
                </div>
                {r.last && (
                  <div className="mt-0.5 flex items-center gap-2 text-11 text-muted min-w-0">
                    <span className="truncate">
                      {r.last.direction === 'out' ? `${t('chat_you')}: ` : ''}
                      {r.last.body}
                    </span>
                    <span className="ml-auto shrink-0">{fmtTime(r.last.created_at)}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          {!current ? (
            <div className="flex-1 flex items-center justify-center text-muted">
              <div className="text-center">
                <MessagesSquare size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">{t('chat_select_room')}</p>
              </div>
            </div>
          ) : (
            <>
              <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {roomMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted text-sm">
                    {t('chat_empty_room')}
                  </div>
                ) : (
                  roomMessages.map(m => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-3 py-2 text-13 ${
                          m.direction === 'out'
                            ? 'bg-accent text-white'
                            : 'bg-surface border border-border text-text'
                        }`}
                      >
                        {m.direction === 'in' && current.kind === 'group' && (
                          <div className="text-11 opacity-70 mb-0.5">{peerLabel(m.peer_iid)}</div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        {m.ref_type && m.ref_id && (
                          <div
                            className={`mt-1 text-11 inline-block rounded px-1.5 py-0.5 ${
                              m.direction === 'out' ? 'bg-white/20' : 'bg-border text-muted'
                            }`}
                          >
                            {t(`chat_ref_${m.ref_type}`)} #{m.ref_id}
                          </div>
                        )}
                        <div
                          className={`mt-0.5 text-11 text-right ${
                            m.direction === 'out' ? 'text-white/70' : 'text-muted'
                          }`}
                        >
                          {fmtTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="shrink-0 border-t border-border bg-surface p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value.slice(0, MAX_BODY_CHARS))}
                    onKeyDown={handleComposerKey}
                    placeholder={t('chat_input_placeholder')}
                    rows={Math.min(4, Math.max(1, draft.split('\n').length))}
                    className="form-input flex-1 resize-none"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !draft.trim()}
                    className="btn btn-primary btn-sm flex items-center gap-1.5"
                  >
                    <Send size={14} />
                    {t('chat_send')}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
