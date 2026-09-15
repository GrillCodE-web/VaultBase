import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  AtSign,
  Bell,
  BellOff,
  CornerUpLeft,
  CornerUpRight,
  Copy,
  Download,
  FileText,
  Lock,
  MessagesSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Send,
  SmilePlus,
  Timer,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { usePersistedState } from '../hooks/usePersistedState.js'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'

// REDESIGN-05-5B4: E2E-чат (docs/CHAT_E2E.md). Backend — commands/chat.rs:
// в сети только sealed-конверты (X25519/AES-GCM), plaintext живёт в SQLCipher.
// Комнаты: 'dm:<iidA>:<iidB>' (iid'ы отсортированы) и 'group:<group_id>'.
// Живые обновления — Tauri-события chat:message / chat:read (эмитит backend
// после WS-нотификации или chat_fetch), pull-to-refresh — кнопка в шапке.

const MAX_BODY_CHARS = 4000

const dmRoom = (a, b) => `dm:${[a, b].sort().join(':')}`

const shortIid = iid => (iid && iid.length > 12 ? `${iid.slice(0, 6)}…${iid.slice(-4)}` : iid || '')

// 6if: быстрый набор эмодзи для реакций.
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '🔥']

// da9: @упоминания в группах. Хендл — метка без пробелов; парсинг из plaintext
// тела (метаданные не отправляются, всё локально по расшифрованному тексту).
const MENTION_ALL = ['all', 'все', 'everyone']
const mentionHandle = label =>
  String(label || '')
    .trim()
    .replace(/\s+/g, '_')
const MENTION_RE = /@([^\s@]+)/g

// o87: слеш-команды сущностей — /order 1234, /card ABCD, /profile <id>.
// Тело едет как обычный E2E-конверт, сущность цепляется через ref (order|card
// |profile). Карточку видят только участники комнаты (шифрование по комнате).
function parseSlashCommand(text) {
  const m = /^\/(order|card|profile)\s+(\S.*)$/i.exec(text.trim())
  if (!m) return null
  return { refType: m[1].toLowerCase(), refId: m[2].trim().slice(0, 120) }
}

// created_at приходит из SQLite CURRENT_TIMESTAMP (UTC без 'Z').
// CHAT-2.0 (g80): троттлинг исходящих «печатает…» — вынесен из компонента:
// Date.now() в теле компонента ловит react-hooks/purity (false positive на
// event-хендлерах), а модульная функция линтеру прозрачна. Приложение
// однооконное, модульного состояния достаточно.
const TYPING_THROTTLE_MS = 3000
let typingLastSentAt = 0
function typingThrottleOk() {
  const now = Date.now()
  if (now - typingLastSentAt < TYPING_THROTTLE_MS) return false
  typingLastSentAt = now
  return true
}

function fmtTime(value) {
  if (!value) return ''
  const iso = String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${hm}`
}

// CHAT-2.0 (k9c): галочки статуса исходящего. out_* — агрегаты по конвертам
// fan-out'а (NULL у старых сообщений/входящих → одинарная «отправлено»).
// Группа (total > 1): рядом счётчик delivered/read — N/M, языконезависимый.
function OutStatus({ m, t }) {
  if (m.direction !== 'out') return null
  // 13q: в оффлайн-очереди — часики вместо галочек (ещё не ушло на сервер).
  if (m.pending) {
    return (
      <span
        aria-hidden="true"
        title={t?.('chat_pending')}
        className="inline-block ml-1 leading-none"
      >
        🕐
      </span>
    )
  }
  const total = m.out_total ?? 0
  const delivered = m.out_delivered ?? 0
  const read = m.out_read ?? 0
  const allRead = total > 0 && read === total
  const allDelivered = total > 0 && delivered === total
  return (
    <span
      aria-hidden="true"
      title={total > 0 ? `${delivered}/${total} · ${read}/${total}` : undefined}
      className="inline-block ml-1 leading-none"
      style={{ fontWeight: allRead ? 700 : 400 }}
    >
      {allRead || allDelivered ? '✓✓' : '✓'}
      {total > 1 && read > 0 ? (
        <span className="text-[10px] ml-0.5">{`${read}/${total}`}</span>
      ) : null}
    </span>
  )
}

// avm: человекочитаемый размер файла.
function fmtBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// avm: карточка вложения в ленте. Метаданные (att) приехали внутри E2E-конверта;
// шифротекст-чанки тянем лениво через chat_blob_fetch и расшифровываем на месте
// (content-key/nonce — из att, сервер их не видел). Картинки показываем инлайн,
// остальное — иконкой с кнопкой «скачать» (data:-URL).
function AttachmentCard({ att, t, outgoing }) {
  const [state, setState] = useState('idle') // idle | loading | ready | error
  const [url, setUrl] = useState(null)
  const isImage = typeof att.mime === 'string' && att.mime.startsWith('image/')

  const load = useCallback(async () => {
    if (state === 'loading' || state === 'ready') return url
    setState('loading')
    try {
      const res = await invoke('chat_blob_fetch', {
        blobId: att.blob_id,
        key: att.key,
        nonce: att.nonce,
      })
      const dataUrl = `data:${att.mime || 'application/octet-stream'};base64,${res.data}`
      setUrl(dataUrl)
      setState('ready')
      return dataUrl
    } catch {
      setState('error')
      return null
    }
  }, [att.blob_id, att.key, att.nonce, att.mime, state, url])

  const download = useCallback(async () => {
    const dataUrl = url || (await load())
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = att.name || 'file'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [url, load, att.name])

  const border = outgoing ? 'border-white/25' : 'border-border'
  if (isImage && state === 'ready' && url) {
    return (
      <div className="mt-1">
        <img src={url} alt={att.name || ''} className="max-h-64 max-w-full rounded" />
        <div className="mt-0.5 text-11 opacity-70">
          {att.name} · {fmtBytes(att.size)}
        </div>
      </div>
    )
  }
  return (
    <div className={`mt-1 flex items-center gap-2 rounded border ${border} px-2 py-1.5`}>
      {isImage ? (
        <Paperclip size={16} className="shrink-0" />
      ) : (
        <FileText size={16} className="shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-13">{att.name || 'file'}</div>
        <div className="text-11 opacity-70">
          {fmtBytes(att.size)}
          {state === 'error' ? ` · ${t('chat_att_error')}` : ''}
        </div>
      </div>
      {isImage ? (
        <button
          type="button"
          onClick={load}
          disabled={state === 'loading'}
          className="btn btn-ghost btn-sm shrink-0"
          title={t('chat_att_preview')}
        >
          {state === 'loading' ? '…' : t('chat_att_preview')}
        </button>
      ) : (
        <button
          type="button"
          onClick={download}
          disabled={state === 'loading'}
          className="btn btn-ghost btn-sm shrink-0 flex items-center gap-1"
          title={t('chat_att_download')}
        >
          <Download size={14} />
        </button>
      )}
    </div>
  )
}

// Известные коды ошибок backend → i18n; остальное — сырой текст через handler.
function chatErrorMessage(e, t) {
  const raw = e instanceof Error ? e.message : String(e)
  const code = raw.split(':')[0].trim()
  const key = `chat_err_${code}`
  const localized = t(key)
  return localized === key ? null : localized
}

// 19d: модалка профиля — свой (правка публичного label + Chat-ID/IID для
// копирования) или пира (его Chat-ID + личная заметка, хранится локально).
function ProfileModal({
  modal,
  selfIid,
  selfChatId,
  selfLabel,
  notes,
  t,
  initials,
  copyText,
  onClose,
  onSaveLabel,
  onSaveNote,
}) {
  const isSelf = modal.kind === 'self'
  const peer = isSelf ? null : modal.peer
  const [label, setLabel] = useState(isSelf ? selfLabel : '')
  const [note, setNote] = useState(isSelf ? '' : notes[peer?.installation_id] || '')
  const name = isSelf ? selfLabel : peer?.label
  const iid = isSelf ? selfIid : peer?.installation_id
  const chatId = isSelf ? selfChatId : peer?.chat_id
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text">
            {isSelf ? t('chat_my_profile') : t('chat_profile')}
          </h2>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            aria-label={t('btn_cancel')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-accent/15 text-accent flex items-center justify-center text-sm font-semibold shrink-0">
            {initials(name || iid)}
          </div>
          <div className="min-w-0">
            <div className="text-13 font-medium text-text truncate">
              {name || t('chat_no_label')}
            </div>
            {!isSelf && (
              <div className="text-11 text-muted">
                {t(peer?.role === 'manager' ? 'chat_role_manager' : 'chat_role_worker')}
                {peer?.online
                  ? ` · ${t('chat_online')}`
                  : peer?.last_seen
                    ? ` · ${t('chat_last_seen', { at: fmtTime(peer.last_seen) })}`
                    : ''}
              </div>
            )}
          </div>
        </div>

        {isSelf && (
          <>
            <label className="block text-11 text-muted mb-1">{t('chat_my_label')}</label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder={t('chat_my_label_ph')}
                className="form-input w-full"
                maxLength={60}
              />
              <button
                className="btn btn-primary btn-sm shrink-0"
                disabled={label.trim() === (selfLabel || '').trim()}
                onClick={() => onSaveLabel(label)}
              >
                {t('btn_save')}
              </button>
            </div>
          </>
        )}

        <label className="block text-11 text-muted mb-1">{t('chat_chat_id')}</label>
        <div className="flex items-center gap-2 mb-2">
          <code className="flex-1 min-w-0 truncate rounded border border-border bg-bg px-2 py-1 text-11 text-text select-all">
            {chatId}
          </code>
          <button
            className="btn btn-secondary btn-sm shrink-0"
            onClick={() => copyText(chatId)}
            title={t('chat_copy')}
          >
            <Copy size={13} />
          </button>
        </div>

        <label className="block text-11 text-muted mb-1">{t('settings_installation_id')}</label>
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 min-w-0 truncate rounded border border-border bg-bg px-2 py-1 text-11 text-text select-all">
            {iid}
          </code>
          <button
            className="btn btn-secondary btn-sm shrink-0"
            onClick={() => copyText(iid)}
            title={t('chat_copy')}
          >
            <Copy size={13} />
          </button>
        </div>

        {!isSelf && (
          <>
            <label className="block text-11 text-muted mb-1">{t('chat_note')}</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('chat_note_ph')}
              className="form-input w-full mb-2 resize-y min-h-[60px]"
              maxLength={500}
            />
            <div className="flex justify-end">
              <button
                className="btn btn-primary btn-sm"
                disabled={note.trim() === (notes[iid] || '').trim()}
                onClick={() => onSaveNote(iid, note)}
              >
                {t('btn_save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Chat({ onNavigate }) {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { confirm } = useConfirm()

  const [peersData, setPeersData] = useState(null) // { self, group_id, peers }
  const [messages, setMessages] = useState([])
  // mgt: пользовательские комнаты (m4i) — [{ room, title, owner_iid, members }]
  const [customRooms, setCustomRooms] = useState([])
  const [groupModal, setGroupModal] = useState(null) // null | { title, selected:Set, invite }
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [draft, setDraft] = useState('')
  // bjb: черновики по комнатам (room -> текст). Держим в памяти сессии, а не в
  // localStorage: plaintext сообщений не должен утекать из SQLCipher на диск
  // открытым текстом. Ref — чтобы эффект восстановления читал свежую карту,
  // не подписываясь на неё (иначе клобберит ввод).
  const [drafts, setDrafts] = useState({})
  const draftsRef = useRef(drafts)
  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  // bjb: при переключении комнаты восстанавливаем её черновик в композер.
  useEffect(() => {
    if (selectedRoom == null) return
    setEditingId(null)
    setDraft(draftsRef.current[selectedRoom] ?? '')
    setMentionBox(null) // da9: сбросить подсказки при смене комнаты
  }, [selectedRoom])
  // tdq: id редактируемого исходящего сообщения (переиспользуем композер).
  const [editingId, setEditingId] = useState(null)
  const [sending, setSending] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [loading, setLoading] = useState(true)
  // CHAT-2.0 (g80): «печатает…» — iid пира, пока горит его 5-секундный таймер.
  const [typingFrom, setTypingFrom] = useState(null)
  const typingTimerRef = useRef(null)
  // CHAT-2.0 (3pt): presence — дельты chat:presence поверх снапшота peers.
  const [presence, setPresence] = useState({})
  // qfk: TTL текущей комнаты в часах (0 — автоудаление выключено).
  const [ttlHours, setTtlHours] = useState(0)
  // bx6: список замьюченных комнат (room-ключи).
  const [mutedRooms, setMutedRooms] = useState([])
  // yyt: закреплённые в текущей комнате — server_id'ы (Set) + метаданные.
  const [pins, setPins] = useState([])
  // 6if: реакции комнаты [{message_id, emoji, count, reactors[]}] + пикер.
  const [reactions, setReactions] = useState([])
  const [emojiPickerFor, setEmojiPickerFor] = useState(null) // server_id | null
  // azl: пометить следующее сообщение важным (сбрасывается после отправки).
  const [priorityDraft, setPriorityDraft] = useState(false)
  // 39b: сообщение, на которое отвечаем с цитатой (ref_type=message).
  const [replyTo, setReplyTo] = useState(null)
  // qsk: сообщение, выбранное для пересылки в другую комнату (модалка).
  const [forwardMsg, setForwardMsg] = useState(null)
  // 19d: локальные заметки о пирах (iid -> текст) + модалка профиля/Chat-ID.
  const [peerNotes, setPeerNotes] = useState({})
  const [profileModal, setProfileModal] = useState(null) // null | {kind:'self'} | {kind:'peer', peer}
  // 6jk: id первого непрочитанного при входе в комнату — якорь разделителя.
  // Снимаем снапшот ДО пометки прочитанным, иначе линия сразу пропадёт.
  const [unreadAnchorId, setUnreadAnchorId] = useState(null)
  // 2td: закреплённые комнаты (room-ключи) — наверх списка, порядок локальный.
  // Ключи комнат — метаданные маршрутизации (не plaintext), localStorage ок.
  const [pinnedRooms, setPinnedRooms] = usePersistedState('chat_pinned_rooms', [])

  // da9: @упоминания пробивают mute (UI-настройка, localStorage допустим).
  const [mentionsPierceMute, setMentionsPierceMute] = usePersistedState(
    'chat_mentions_pierce_mute',
    true
  )
  const [mentionBox, setMentionBox] = useState(null) // null | { query, items }
  const [uploading, setUploading] = useState(false) // avm: идёт заливка вложения

  const feedRef = useRef(null)
  // 6jk: ref разделителя новых сообщений — для кнопки «к непрочитанным».
  const unreadDividerRef = useRef(null)
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
  // 13q: известные id обновляем на месте (досыл оффлайн-очереди переэмитит
  // сообщение с pending=false — надо перерисовать статус, не плодя дубль).
  const upsertMessages = useCallback(incoming => {
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id))
      const updates = new Map(incoming.filter(m => seen.has(m.id)).map(m => [m.id, m]))
      const fresh = incoming.filter(m => !seen.has(m.id))
      const next =
        updates.size > 0
          ? prev.map(m => (updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m))
          : prev
      return fresh.length > 0 ? [...next, ...fresh] : next
    })
  }, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    try {
      const [pd, msgs, rr, muted] = await Promise.all([
        invoke('chat_peers'),
        invoke('chat_list', { room: null, limit: 500 }),
        invoke('chat_rooms_list').catch(() => ({ rooms: [] })),
        invoke('chat_muted_rooms').catch(() => []),
      ])
      setPeersData(pd)
      setMessages(Array.isArray(msgs) ? msgs : [])
      setCustomRooms(Array.isArray(rr?.rooms) ? rr.rooms : [])
      setMutedRooms(Array.isArray(muted) ? muted : [])
      // Свежее с сервера — события chat:message дотащат новинки в ленту.
      invoke('chat_fetch').catch(e => handleError(e, 'Chat.initialFetch'))
      // 13q: если что-то зависло в оффлайн-очереди с прошлой сессии — досылаем.
      invoke('chat_flush_pending').catch(e => handleError(e, 'Chat.flushPending'))
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
    // CHAT-2.0 (k9c): статусы исходящих — delivered/read агрегаты от backend'а.
    listen('chat:status', e => {
      const updates = e.payload?.updates
      if (!Array.isArray(updates) || updates.length === 0) return
      const byId = new Map(updates.map(u => [u.msg_id, u]))
      setMessages(prev =>
        prev.map(m => {
          const u = byId.get(m.id)
          return u ? { ...m, out_total: u.total, out_delivered: u.delivered, out_read: u.read } : m
        })
      )
    }).then(fn => !cancelled && unlisteners.push(fn))
    // CHAT-2.0 (g80): «печатает…» — эфемерно, 5с без продления гаснет.
    listen('chat:typing', e => {
      const p = e.payload
      if (!p || p.room !== selectedRoomRef.current) return
      setTypingFrom(p.from)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => setTypingFrom(null), 5000)
    }).then(fn => !cancelled && unlisteners.push(fn))
    // CHAT-2.0 (3pt): presence-дельта от ws_sync. Ушедший в оффлайн: метка
    // last_seen остаётся из последнего снапшота peers (сервер пишет её на
    // disconnect), обновится при следующем chat_peers.
    listen('chat:presence', e => {
      const p = e.payload
      if (!p?.installation_id) return
      setPresence(prev => ({ ...prev, [p.installation_id]: !!p.online }))
    }).then(fn => !cancelled && unlisteners.push(fn))
    // t8l: сообщение удалено (своё — локально, чужое — E2E delete от автора).
    listen('chat:deleted', e => {
      const id = e.payload?.id
      if (typeof id !== 'number') return
      setMessages(prev => prev.filter(m => m.id !== id))
    }).then(fn => !cancelled && unlisteners.push(fn))
    return () => {
      cancelled = true
      unlisteners.forEach(fn => fn())
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [upsertMessages])

  // Автоскролл ленты вниз при новых сообщениях/смене комнаты.
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages, selectedRoom])

  // 6jk: при входе в комнату снимаем якорь первого непрочитанного (до пометки
  // прочитанным ниже), чтобы отрисовать над ним разделитель «новые сообщения».
  useEffect(() => {
    if (!selectedRoom) {
      setUnreadAnchorId(null)
      return
    }
    let anchor = null
    for (const m of messages) {
      if (m.room === selectedRoom && m.direction === 'in' && !m.read_at) {
        if (anchor == null || m.id < anchor) anchor = m.id
      }
    }
    setUnreadAnchorId(anchor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoom])

  // При входе в комнату — пометить её входящие прочитанными.
  useEffect(() => {
    if (selectedRoom) markRoomRead(selectedRoom, messages)
    setTypingFrom(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoom])

  // da9: мой хендл для распознавания @self в чужих сообщениях.
  const selfHandle = useMemo(() => mentionHandle(peersData?.self_label || ''), [peersData])
  // da9: упомянут ли я в теле (свой хендл или @all/@все/@everyone).
  const bodyMentionsSelf = useCallback(
    body => {
      if (!body) return false
      const toks = String(body).match(MENTION_RE)
      if (!toks) return false
      return toks.some(tok => {
        const h = tok.slice(1).toLowerCase()
        if (MENTION_ALL.includes(h)) return true
        return selfHandle && h === selfHandle.toLowerCase()
      })
    },
    [selfHandle]
  )

  // ── Комнаты ───────────────────────────────────────────────
  const rooms = useMemo(() => {
    if (!peersData) return []
    const byRoom = new Map()
    for (const m of messages) {
      const agg = byRoom.get(m.room) ?? { last: null, unread: 0, mentioned: false }
      if (!agg.last || m.id > agg.last.id) agg.last = m
      if (m.direction === 'in' && !m.read_at) {
        agg.unread += 1
        // da9: непрочитанное упоминание себя помечает комнату отдельным флагом.
        if (bodyMentionsSelf(m.body)) agg.mentioned = true
      }
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
    // mgt: пользовательские комнаты (m4i) из серверного списка chat_rooms_list.
    for (const r of customRooms) {
      list.push({
        room: r.room,
        kind: 'room',
        label: r.title || shortIid(r.room),
        peerIid: null,
        role: null,
        ownerIid: r.owner_iid,
        members: r.members ?? [],
        ...(byRoom.get(r.room) ?? { last: null, unread: 0 }),
      })
    }
    // qhi: комнаты объявлений материализуются лениво — из самих сообщений
    // (сервер их не отдаёт списком). Read-only, отправка/typing запрещены.
    for (const [room, agg] of byRoom) {
      if (room.startsWith('room:announcements-')) {
        list.push({
          room,
          kind: 'announce',
          label: t('chat_room_announcements'),
          peerIid: null,
          role: null,
          readonly: true,
          ...agg,
        })
      }
    }
    // Объявления сверху, затем группа и пользовательские комнаты, DM внизу.
    const order = { announce: 0, group: 1, room: 2, dm: 3 }
    return list.sort((a, b) => {
      // 2td: закреплённые комнаты всегда выше остальных, в порядке закрепления.
      const aPin = pinnedRooms.indexOf(a.room)
      const bPin = pinnedRooms.indexOf(b.room)
      if ((aPin !== -1) !== (bPin !== -1)) return aPin !== -1 ? -1 : 1
      if (aPin !== -1 && bPin !== -1) return aPin - bPin
      if (a.kind !== b.kind) return order[a.kind] - order[b.kind]
      return (b.last?.id ?? 0) - (a.last?.id ?? 0)
    })
  }, [peersData, messages, customRooms, t, pinnedRooms, bodyMentionsSelf])

  const current = rooms.find(r => r.room === selectedRoom) ?? null
  const roomMessages = useMemo(
    () => (selectedRoom ? messages.filter(m => m.room === selectedRoom) : []),
    [messages, selectedRoom]
  )

  // CHAT-2.0 (3pt): итоговый онлайн пира — дельта chat:presence поверх
  // снапшота из chat_peers; last_seen только из снапшота.
  const peerOnline = useCallback(
    iid => presence[iid] ?? peersData?.peers?.find(x => x.installation_id === iid)?.online ?? false,
    [presence, peersData]
  )
  const peerLastSeen = useCallback(
    iid => peersData?.peers?.find(x => x.installation_id === iid)?.last_seen ?? null,
    [peersData]
  )

  const peerLabel = useCallback(
    iid => {
      const p = peersData?.peers?.find(x => x.installation_id === iid)
      return p?.label || shortIid(iid)
    },
    [peersData]
  )

  // da9: множество известных хендлов — подсвечиваем только реальных участников.
  const knownHandles = useMemo(() => {
    const set = new Set()
    if (selfHandle) set.add(selfHandle.toLowerCase())
    for (const p of peersData?.peers ?? []) {
      const h = mentionHandle(p.label || shortIid(p.installation_id))
      if (h) set.add(h.toLowerCase())
    }
    return set
  }, [peersData, selfHandle])
  // da9: разбить тело на текст и токены @mention, подсветив известные/себя.
  const renderBody = useCallback(
    body => {
      const text = String(body ?? '')
      if (!text.includes('@')) return text
      const out = []
      let last = 0
      let mm
      MENTION_RE.lastIndex = 0
      while ((mm = MENTION_RE.exec(text)) !== null) {
        const h = mm[1].toLowerCase()
        const isAll = MENTION_ALL.includes(h)
        const isKnown = knownHandles.has(h)
        if (!isAll && !isKnown) continue
        const isSelf = isAll || (selfHandle && h === selfHandle.toLowerCase())
        if (mm.index > last) out.push(text.slice(last, mm.index))
        out.push(
          <span
            key={mm.index}
            className={
              isSelf
                ? 'rounded bg-accent/25 text-accent font-semibold px-0.5'
                : 'text-accent font-medium'
            }
          >
            {mm[0]}
          </span>
        )
        last = mm.index + mm[0].length
      }
      if (last === 0) return text
      if (last < text.length) out.push(text.slice(last))
      return out
    },
    [knownHandles, selfHandle]
  )

  // 39b: цитируемое сообщение (ref_type=message) ищем в ленте по server_id.
  const quotedOf = useCallback(
    m => {
      if (m?.ref_type !== 'message' || !m?.ref_id) return null
      const sid = Number(m.ref_id)
      return roomMessages.find(x => x.server_id === sid) || null
    },
    [roomMessages]
  )

  // 19d: инициалы для буквенного аватара (имя или короткий iid).
  const initials = name => {
    const s = (name || '').trim()
    if (!s) return '?'
    const parts = s.split(/\s+/)
    if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase()
    return s.slice(0, 2).toUpperCase()
  }

  // 19d: копирование в буфер с тостом-подтверждением.
  const copyText = async text => {
    try {
      await navigator.clipboard.writeText(text)
      toastOk(t('chat_copied'))
    } catch {
      toastErr(t('chat_copy_failed'))
    }
  }

  // 19d: найти peer-объект по installation_id.
  const peerByIid = useCallback(
    iid => peersData?.peers?.find(x => x.installation_id === iid) || null,
    [peersData]
  )

  // 19d: подтягиваем локальные заметки о пирах один раз при монтировании.
  useEffect(() => {
    invoke('chat_notes_get')
      .then(n => setPeerNotes(n && typeof n === 'object' ? n : {}))
      .catch(() => {})
  }, [])

  // qfk: подтягиваем TTL выбранной комнаты (0 — если выключен/не задан).
  useEffect(() => {
    if (!current || current.kind === 'announce') {
      setTtlHours(0)
      return
    }
    invoke('chat_room_ttl_get', { room: current.room })
      .then(h => setTtlHours(Number(h) || 0))
      .catch(() => setTtlHours(0))
  }, [current])

  // qfk: смена TTL комнаты — влияет на последующие отправки (сервер+получатель).
  const changeTtl = async hours => {
    if (!current) return
    try {
      await invoke('chat_room_ttl_set', { room: current.room, hours })
      setTtlHours(hours)
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.ttlSet')))
    }
  }

  // yyt: подтягиваем закреплённые выбранной комнаты.
  useEffect(() => {
    if (!current || current.kind === 'announce') {
      setPins([])
      return
    }
    invoke('chat_pins_list', { room: current.room })
      .then(r => setPins(Array.isArray(r?.pins) ? r.pins : []))
      .catch(() => setPins([]))
  }, [current])

  // yyt: множество закреплённых server_id для быстрой проверки.
  const pinnedIds = useMemo(() => new Set(pins.map(p => p.message_id)), [pins])

  // 6if: подтягиваем реакции выбранной комнаты.
  useEffect(() => {
    if (!current || current.kind === 'announce') {
      setReactions([])
      return
    }
    invoke('chat_reactions_list', { room: current.room })
      .then(r => setReactions(Array.isArray(r?.reactions) ? r.reactions : []))
      .catch(() => setReactions([]))
  }, [current])

  // 6if: реакции конкретного сообщения по его server_id.
  const reactionsFor = useCallback(
    sid => (sid == null ? [] : reactions.filter(r => r.message_id === sid)),
    [reactions]
  )

  // 6if: поставить/снять реакцию (toggle). Доступно для сообщений с server_id.
  const toggleReaction = async (m, emoji) => {
    if (!current || m.server_id == null) return
    setEmojiPickerFor(null)
    try {
      const r = await invoke('chat_reaction_set', {
        room: current.room,
        messageId: m.server_id,
        emoji,
      })
      setReactions(Array.isArray(r?.reactions) ? r.reactions : [])
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.reactionSet')))
    }
  }

  // yyt: закрепить/открепить сообщение (по server_id; у исходящих его нет).
  const togglePin = async m => {
    if (!current || m.server_id == null) return
    const next = !pinnedIds.has(m.server_id)
    try {
      const r = await invoke('chat_pin_set', {
        room: current.room,
        messageId: m.server_id,
        pinned: next,
      })
      setPins(Array.isArray(r?.pins) ? r.pins : [])
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.pinSet')))
    }
  }

  // bx6: замьючена ли комната.
  const isMuted = useCallback(room => mutedRooms.includes(room), [mutedRooms])

  // bx6: тумблер mute текущей комнаты.
  const toggleMute = async () => {
    if (!current) return
    const next = !isMuted(current.room)
    try {
      await invoke('chat_room_mute_set', { room: current.room, muted: next })
      setMutedRooms(prev => (next ? [...prev, current.room] : prev.filter(r => r !== current.room)))
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.muteSet')))
    }
  }

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
      // tdq: в режиме правки шлём E2E edit-конверт вместо нового сообщения.
      if (editingId != null) {
        // chat:message с обновлённой строкой прилетит событием — upsert по id.
        await invoke('chat_edit', { msgId: editingId, body })
        setEditingId(null)
        setDraft('')
        return
      }
      // o87: слеш-команда сущности (/order|/card|/profile) — тело заменяем
      // читаемой подписью, сущность цепляем через ref. Приоритет над reply.
      const slash = parseSlashCommand(body)
      const sendBody = slash ? `${t(`chat_ref_${slash.refType}`)} #${slash.refId}` : body
      // chat:message прилетит событием — в ленту попадёт через upsertMessages.
      await invoke('chat_send', {
        body: sendBody,
        peerIid: current.kind === 'dm' ? current.peerIid : null,
        // mgt: пользовательская комната адресуется по room-ключу.
        room: current.kind === 'room' ? current.room : null,
        // 39b: ответ с цитатой — ссылаемся на server_id исходного сообщения.
        refType: slash ? slash.refType : replyTo ? 'message' : null,
        refId: slash ? slash.refId : replyTo ? String(replyTo.server_id) : null,
        // azl: флаг важности едет внутри E2E-конверта.
        priority: priorityDraft,
      })
      setDraft('')
      // bjb: сообщение ушло — сбрасываем сохранённый черновик комнаты.
      if (selectedRoom != null) {
        setDrafts(prev => {
          if (!(selectedRoom in prev)) return prev
          const next = { ...prev }
          delete next[selectedRoom]
          return next
        })
      }
      setPriorityDraft(false)
      setReplyTo(null)
      setMentionBox(null) // da9: скрыть подсказки после отправки
    } catch (e) {
      const error = handleError(e, 'Chat.send')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  // avm: прикрепить файл. Выбираем файл, заливаем в blob-relay (шифрование
  // content-key'ом в Rust), затем отправляем сообщение с meta вложения —
  // content-key едет только внутри E2E-конверта. Текст композера, если есть,
  // уходит подписью к файлу.
  const handleAttach = async () => {
    if (!current || current.kind === 'announce' || uploading || sending) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const path = await open({ multiple: false })
      if (!path) return
      setUploading(true)
      const room = current.kind === 'dm' ? dmRoom(peersData.self, current.peerIid) : current.room
      const att = await invoke('chat_blob_upload', { room, path })
      const caption = draft.trim()
      await invoke('chat_send', {
        body: caption,
        peerIid: current.kind === 'dm' ? current.peerIid : null,
        room: current.kind === 'room' ? current.room : null,
        refType: null,
        refId: null,
        priority: priorityDraft,
        attachment: JSON.stringify(att),
      })
      setDraft('')
      setPriorityDraft(false)
      setReplyTo(null)
      setMentionBox(null)
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.attach')))
    } finally {
      setUploading(false)
    }
  }

  // tdq: начать правку своего сообщения — прячем текст в композер.
  const handleEdit = msg => {
    if (!msg || msg.direction !== 'out') return
    setEditingId(msg.id)
    setDraft(msg.body || '')
  }

  const handleEditCancel = () => {
    setEditingId(null)
    // bjb: выходя из правки, возвращаем сохранённый черновик комнаты.
    setDraft(selectedRoom != null ? (draftsRef.current[selectedRoom] ?? '') : '')
  }

  // 39b: ответить с цитатой — доступно для сообщений с server_id (входящие).
  const handleReply = msg => {
    if (!msg || msg.server_id == null) return
    setReplyTo(msg)
  }

  // qsk: переслать выбранное сообщение в другую комнату с пометкой «переслано».
  // Автор оригинала уходит в ref_id (forward), тело — как обычное сообщение.
  const handleForward = async target => {
    const msg = forwardMsg
    if (!msg || !target) return
    setSending(true)
    try {
      const author = msg.direction === 'out' ? t('chat_you') : peerLabel(msg.peer_iid)
      await invoke('chat_send', {
        body: msg.body,
        peerIid: target.kind === 'dm' ? target.peerIid : null,
        room: target.kind === 'room' ? target.room : null,
        refType: 'forward',
        refId: String(author).slice(0, 120),
        priority: false,
      })
      setForwardMsg(null)
      toastOk(t('chat_forwarded_ok'))
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.forward')))
    } finally {
      setSending(false)
    }
  }

  // o87: клик по карточке сущности — открыть её на соответствующей странице.
  // Для order/card наводим поиск на #id; profile — просто открываем список.
  const openRef = useCallback(
    (refType, refId) => {
      if (!onNavigate) return
      if (refType === 'order') onNavigate('orders', { search: String(refId) })
      else if (refType === 'card') onNavigate('cards', { search: String(refId) })
      else if (refType === 'profile') onNavigate('profiles')
    },
    [onNavigate]
  )

  // 6jk: прокрутить ленту к разделителю первого непрочитанного.
  const jumpToUnread = () => {
    unreadDividerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // 2td: закрепить/открепить текущую комнату (локальный порядок в списке).
  const toggleRoomPin = room => {
    if (!room) return
    setPinnedRooms(prev => (prev.includes(room) ? prev.filter(r => r !== room) : [...prev, room]))
  }

  // 19d: сохранить локальную заметку о пире (пустая — удаляет).
  const handleSaveNote = async (iid, note) => {
    try {
      await invoke('chat_note_set', { peerIid: iid, note })
      setPeerNotes(prev => {
        const next = { ...prev }
        if (note.trim()) next[iid] = note.trim()
        else delete next[iid]
        return next
      })
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.noteSet')))
    }
  }

  // 19d: сменить свой публичный label (виден всем пирам).
  const handleSaveLabel = async label => {
    try {
      await invoke('chat_set_label', { label })
      setPeersData(prev => (prev ? { ...prev, self_label: label.trim() } : prev))
      toastOk(t('chat_profile_saved'))
    } catch (e) {
      toastErr(chatErrorMessage(e, t) || getErrorMessage(handleError(e, 'Chat.setLabel')))
    }
  }

  const handleComposerKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // mgt: создание пользовательской группы — выбранные пиры + приглашённые по
  // Chat-ID. Сервер делает создателя владельцем; список комнат перезагружаем.
  const handleCreateGroup = async () => {
    if (!groupModal || sending) return
    const title = groupModal.title.trim()
    if (!title) return
    const invited = groupModal.invite
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const members = [...new Set([...groupModal.selected, ...invited])]
    if (members.length === 0) return
    setSending(true)
    try {
      const res = await invoke('chat_room_create', { title, members })
      const rr = await invoke('chat_rooms_list').catch(() => ({ rooms: [] }))
      setCustomRooms(Array.isArray(rr?.rooms) ? rr.rooms : [])
      setGroupModal(null)
      if (res?.room) setSelectedRoom(res.room)
      toastOk(t('chat_group_created'))
    } catch (e) {
      const error = handleError(e, 'Chat.createGroup')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  // t8l: удаление своего сообщения у себя и у получателей (E2E delete-конверт).
  const handleDelete = async msg => {
    if (!msg || msg.direction !== 'out') return
    const ok = await confirm(t('chat_delete_confirm'), {
      title: t('chat_delete_title'),
      danger: true,
      confirmLabel: t('chat_delete'),
      cancelLabel: t('btn_cancel'),
    })
    if (!ok) return
    try {
      // chat:deleted прилетит событием — из ленты уберётся слушателем.
      await invoke('chat_delete', { msgId: msg.id })
    } catch (e) {
      const error = handleError(e, 'Chat.delete')
      toastErr(chatErrorMessage(e, t) || getErrorMessage(error))
    }
  }

  // CHAT-2.0 (g80): сигнал «печатает…» пиру в DM — не чаще раза в 3с и только
  // при непустом вводе. Ошибки глотаем: индикатор не критичен.
  const handleDraftChange = e => {
    const v = e.target.value.slice(0, MAX_BODY_CHARS)
    setDraft(v)
    // bjb: сохраняем черновик на текущую комнату (в режиме правки — не трогаем).
    if (editingId == null && selectedRoom != null) {
      setDrafts(prev => {
        if (v) return { ...prev, [selectedRoom]: v }
        if (!(selectedRoom in prev)) return prev
        const next = { ...prev }
        delete next[selectedRoom]
        return next
      })
    }
    if (v && current?.kind === 'dm' && typingThrottleOk()) {
      invoke('chat_typing', { peerIid: current.peerIid }).catch(() => {})
    }
    // da9: автодополнение @упоминаний (только группы и пользовательские комнаты).
    if (current && (current.kind === 'group' || current.kind === 'room')) {
      const mq = /(?:^|\s)@([^\s@]*)$/.exec(v)
      if (mq) {
        const q = mq[1].toLowerCase()
        const items = (peersData?.peers ?? [])
          .filter(p =>
            mentionHandle(p.label || shortIid(p.installation_id))
              .toLowerCase()
              .includes(q)
          )
          .slice(0, 6)
        setMentionBox({ items })
      } else if (mentionBox) setMentionBox(null)
    } else if (mentionBox) setMentionBox(null)
  }

  // da9: подставить выбранный хендл вместо набираемого @токена.
  const insertMention = h => {
    const v = draft.replace(/(?:^|\s)@([^\s@]*)$/, m => `${m.startsWith('@') ? '' : m[0]}@${h} `)
    setDraft(v)
    if (editingId == null && selectedRoom != null) {
      setDrafts(prev => ({ ...prev, [selectedRoom]: v }))
    }
    setMentionBox(null)
  }

  // ── Рендер ────────────────────────────────────────────────
  // bx6: тумблер mute в шапке комнаты.
  const muteControl = (
    <button
      onClick={toggleMute}
      title={isMuted(current?.room) ? t('chat_unmute') : t('chat_mute')}
      aria-label={isMuted(current?.room) ? t('chat_unmute') : t('chat_mute')}
      aria-pressed={isMuted(current?.room)}
      className={`shrink-0 p-1 rounded hover:bg-border transition-colors ${
        isMuted(current?.room) ? 'text-red' : 'text-muted hover:text-accent'
      }`}
    >
      {isMuted(current?.room) ? <BellOff size={14} /> : <Bell size={14} />}
    </button>
  )

  // 2td: закрепление комнаты в шапке (рядом с mute).
  const pinRoomControl = (
    <button
      onClick={() => toggleRoomPin(current?.room)}
      title={pinnedRooms.includes(current?.room) ? t('chat_room_unpin') : t('chat_room_pin')}
      aria-label={pinnedRooms.includes(current?.room) ? t('chat_room_unpin') : t('chat_room_pin')}
      aria-pressed={pinnedRooms.includes(current?.room)}
      className={`shrink-0 p-1 rounded hover:bg-border transition-colors ${
        pinnedRooms.includes(current?.room) ? 'text-accent' : 'text-muted hover:text-accent'
      }`}
    >
      {pinnedRooms.includes(current?.room) ? <PinOff size={14} /> : <Pin size={14} />}
    </button>
  )

  // qfk: селектор автоудаления в шапке комнаты (off/1ч/1д/1нед).
  const ttlControl = (
    <label
      className="ml-auto shrink-0 flex items-center gap-1 text-11 text-muted"
      title={t('chat_ttl_hint')}
    >
      <Timer size={13} aria-hidden="true" />
      <select
        value={ttlHours}
        onChange={e => changeTtl(Number(e.target.value))}
        className="bg-app border border-border rounded px-1 py-0.5 text-11 text-text"
        aria-label={t('chat_ttl')}
      >
        <option value={0}>{t('chat_ttl_off')}</option>
        <option value={1}>{t('chat_ttl_1h')}</option>
        <option value={24}>{t('chat_ttl_1d')}</option>
        <option value={168}>{t('chat_ttl_1w')}</option>
      </select>
    </label>
  )

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
          {/* mgt: создание пользовательской группы (m4i) */}
          {/* 19d: мой профиль — Chat-ID и правка своего имени */}
          <button
            onClick={() => setProfileModal({ kind: 'self' })}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            title={t('chat_my_profile')}
          >
            <User size={14} />
            {t('chat_profile')}
          </button>
          <button
            onClick={() => setGroupModal({ title: '', selected: new Set(), invite: '' })}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            title={t('chat_group_create')}
          >
            <Users size={14} />
            {t('chat_group_create')}
          </button>
          {/* da9: тумблер «упоминания пробивают mute» */}
          <button
            onClick={() => setMentionsPierceMute(v => !v)}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
            title={mentionsPierceMute ? t('chat_mention_pierce_on') : t('chat_mention_pierce_off')}
            aria-pressed={mentionsPierceMute}
          >
            <AtSign size={14} className={mentionsPierceMute ? 'text-accent' : 'text-muted'} />
          </button>
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
                  {/* CHAT-2.0 (3pt): зелёная точка онлайна у DM-пиров */}
                  {r.kind === 'dm' && peerOnline(r.peerIid) && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: 'var(--green)' }}
                      title={t('chat_online')}
                    />
                  )}
                  <span className="text-13 font-medium text-text truncate">{r.label}</span>
                  {/* bjb: индикатор несохранённого черновика в комнате */}
                  {drafts[r.room] && (
                    <Pencil size={11} className="text-accent shrink-0" title={t('chat_draft')} />
                  )}
                  {r.role === 'manager' && (
                    <span className="text-11 text-muted shrink-0">({t('chat_role_manager')})</span>
                  )}
                  {/* da9: упоминание пробивает mute — отдельный акцентный бейдж */}
                  {isMuted(r.room) && r.mentioned && mentionsPierceMute && (
                    <AtSign
                      size={12}
                      className="ml-auto text-accent shrink-0"
                      title={t('chat_mentioned')}
                    />
                  )}
                  {/* bx6: mute — иконка вместо бейджа непрочитанных */}
                  {isMuted(r.room) && !(r.mentioned && mentionsPierceMute) && (
                    <BellOff
                      size={12}
                      className="ml-auto text-muted shrink-0"
                      title={t('chat_muted')}
                    />
                  )}
                  {!isMuted(r.room) && r.unread > 0 && (
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      {r.mentioned && (
                        <AtSign size={12} className="text-accent" title={t('chat_mentioned')} />
                      )}
                      <span className="text-11 bg-accent text-white rounded-full px-1.5 py-0.5 leading-none">
                        {r.unread > 99 ? '99+' : r.unread}
                      </span>
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
              {/* CHAT-2.0 (3pt): шапка диалога — имя + присутствие (DM) */}
              {current.kind === 'dm' && (
                <div className="shrink-0 border-b border-border bg-surface px-4 py-2 flex items-center gap-2">
                  {/* 19d: аватар-буква открывает профиль/Chat-ID пира */}
                  <button
                    onClick={() => {
                      const p = peerByIid(current.peerIid)
                      if (p) setProfileModal({ kind: 'peer', peer: p })
                    }}
                    className="w-7 h-7 rounded-full bg-accent text-white text-11 flex items-center justify-center shrink-0 hover:opacity-80"
                    title={t('chat_profile')}
                    aria-label={t('chat_profile')}
                  >
                    {initials(current.label || current.peerIid)}
                  </button>
                  <span className="text-13 font-medium text-text truncate">{current.label}</span>
                  {peerNotes[current.peerIid] && (
                    <span
                      className="text-11 text-muted italic truncate max-w-[160px]"
                      title={peerNotes[current.peerIid]}
                    >
                      · {peerNotes[current.peerIid]}
                    </span>
                  )}
                  {peerOnline(current.peerIid) ? (
                    <span
                      className="text-11 flex items-center gap-1.5"
                      style={{ color: 'var(--green-t)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: 'var(--green)' }}
                      />
                      {t('chat_online')}
                    </span>
                  ) : (
                    peerLastSeen(current.peerIid) && (
                      <span className="text-11 text-muted">
                        {t('chat_last_seen', { at: fmtTime(peerLastSeen(current.peerIid)) })}
                      </span>
                    )
                  )}
                  {ttlControl}
                  {pinRoomControl}
                  {muteControl}
                </div>
              )}
              {/* qfk: шапка встроенной группы (worker↔manager) — TTL-таймер */}
              {current.kind === 'group' && (
                <div className="shrink-0 border-b border-border bg-surface px-4 py-2 flex items-center gap-2">
                  <span className="text-13 font-medium text-text truncate">{current.label}</span>
                  {ttlControl}
                  {pinRoomControl}
                  {muteControl}
                </div>
              )}
              {/* qhi: шапка комнаты объявлений */}
              {current.kind === 'announce' && (
                <div className="shrink-0 border-b border-border bg-surface px-4 py-2 flex items-center gap-2">
                  <span className="text-13 font-medium text-text truncate">{current.label}</span>
                </div>
              )}
              {/* mgt: шапка пользовательской комнаты — название + число участников */}
              {current.kind === 'room' && (
                <div className="shrink-0 border-b border-border bg-surface px-4 py-2 flex items-center gap-2">
                  <span className="text-13 font-medium text-text truncate">{current.label}</span>
                  <span className="text-11 text-muted">
                    {t('chat_room_members_n', { n: current.members?.length ?? 0 })}
                  </span>
                  {ttlControl}
                  {pinRoomControl}
                  {muteControl}
                </div>
              )}
              {/* yyt: полоса закреплённых — тела берём из уже загруженной ленты */}
              {pins.length > 0 &&
                (() => {
                  const pinnedMsgs = roomMessages.filter(
                    m => m.server_id != null && pinnedIds.has(m.server_id)
                  )
                  if (pinnedMsgs.length === 0) return null
                  return (
                    <div className="shrink-0 border-b border-border bg-surface/60 px-4 py-1.5 space-y-1">
                      {pinnedMsgs.map(m => (
                        <div
                          key={`pin-${m.id}`}
                          className="flex items-center gap-2 text-11 text-muted min-w-0"
                        >
                          <Pin size={12} className="shrink-0 text-accent" />
                          <span className="truncate flex-1">{m.body}</span>
                          <button
                            onClick={() => togglePin(m)}
                            title={t('chat_unpin')}
                            aria-label={t('chat_unpin')}
                            className="shrink-0 p-0.5 rounded hover:text-red hover:bg-border transition-colors"
                          >
                            <PinOff size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {roomMessages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted text-sm">
                    {t('chat_empty_room')}
                  </div>
                ) : (
                  roomMessages.map(m => (
                    <Fragment key={m.id}>
                      {/* 6jk: разделитель над первым непрочитанным при входе */}
                      {unreadAnchorId === m.id && (
                        <div ref={unreadDividerRef} className="flex items-center gap-2 py-1">
                          <div className="flex-1 h-px bg-accent/40" />
                          <span className="text-11 text-accent font-medium shrink-0">
                            {t('chat_unread_divider')}
                          </span>
                          <div className="flex-1 h-px bg-accent/40" />
                        </div>
                      )}
                      <div
                        className={`group flex items-center gap-1.5 ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                      >
                        {m.direction === 'out' && (
                          <>
                            {/* qsk: переслать своё сообщение в другую комнату */}
                            <button
                              onClick={() => setForwardMsg(m)}
                              title={t('chat_forward')}
                              aria-label={t('chat_forward')}
                              className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-opacity"
                            >
                              <CornerUpRight size={14} />
                            </button>
                            {/* tdq: правка своего сообщения */}
                            <button
                              onClick={() => handleEdit(m)}
                              title={t('chat_edit')}
                              aria-label={t('chat_edit')}
                              className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-opacity"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(m)}
                              title={t('chat_delete')}
                              aria-label={t('chat_delete')}
                              className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-red hover:bg-border transition-opacity"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        <div
                          className={`max-w-[70%] rounded-lg px-3 py-2 text-13 ${
                            m.direction === 'out'
                              ? 'bg-accent text-white'
                              : 'bg-surface border border-border text-text'
                          }${m.priority ? ' ring-2 ring-red' : ''}`}
                        >
                          {m.direction === 'in' &&
                            (current.kind === 'group' || current.kind === 'room') && (
                              <div className="text-11 opacity-70 mb-0.5">
                                {peerLabel(m.peer_iid)}
                              </div>
                            )}
                          {/* azl: маркер важного сообщения */}
                          {m.priority && (
                            <div
                              className={`text-11 mb-0.5 flex items-center gap-1 ${m.direction === 'out' ? 'text-white' : 'text-red'}`}
                            >
                              <AlertTriangle size={12} />
                              <span>{t('chat_priority')}</span>
                            </div>
                          )}
                          {/* 39b: цитата сообщения-ответа над телом */}
                          {m.ref_type === 'message' && (
                            <div
                              className={`mb-1 border-l-2 pl-2 text-11 rounded-sm ${
                                m.direction === 'out'
                                  ? 'border-white/50 bg-white/10 text-white/80'
                                  : 'border-accent bg-border/50 text-muted'
                              }`}
                            >
                              {(() => {
                                const q = quotedOf(m)
                                if (!q)
                                  return (
                                    <span className="italic opacity-70">
                                      {t('chat_reply_missing')}
                                    </span>
                                  )
                                return (
                                  <>
                                    <div className="opacity-80 font-medium">
                                      {peerLabel(q.peer_iid)}
                                    </div>
                                    <div className="truncate max-w-[240px]">{q.body}</div>
                                  </>
                                )
                              })()}
                            </div>
                          )}
                          {/* qsk: пометка «переслано от …» над телом */}
                          {m.ref_type === 'forward' && (
                            <div
                              className={`mb-0.5 text-11 flex items-center gap-1 ${
                                m.direction === 'out' ? 'text-white/80' : 'text-accent'
                              }`}
                            >
                              <CornerUpRight size={12} />
                              <span>{t('chat_forwarded_from', { who: m.ref_id })}</span>
                            </div>
                          )}
                          {m.body ? (
                            <div className="whitespace-pre-wrap break-words">
                              {renderBody(m.body)}
                            </div>
                          ) : null}
                          {/* avm: карточка вложения (ленивое скачивание + расшифровка) */}
                          {m.attachment
                            ? (() => {
                                let att = null
                                try {
                                  att = JSON.parse(m.attachment)
                                } catch {
                                  att = null
                                }
                                return att && att.blob_id ? (
                                  <AttachmentCard
                                    att={att}
                                    t={t}
                                    outgoing={m.direction === 'out'}
                                  />
                                ) : null
                              })()
                            : null}
                          {/* o87: карточка сущности — кликабельна, открывает order/card/profile */}
                          {m.ref_type &&
                            m.ref_id &&
                            m.ref_type !== 'message' &&
                            m.ref_type !== 'forward' && (
                              <button
                                type="button"
                                onClick={() => openRef(m.ref_type, m.ref_id)}
                                title={t('chat_ref_open')}
                                className={`mt-1 text-11 inline-block rounded px-1.5 py-0.5 transition-colors hover:underline ${
                                  m.direction === 'out'
                                    ? 'bg-white/20 hover:bg-white/30'
                                    : 'bg-border text-muted hover:text-accent'
                                }`}
                              >
                                {t(`chat_ref_${m.ref_type}`)} #{m.ref_id}
                              </button>
                            )}
                          <div
                            className={`mt-0.5 text-11 text-right ${
                              m.direction === 'out' ? 'text-white/70' : 'text-muted'
                            }`}
                          >
                            {fmtTime(m.created_at)}
                            {m.edited && (
                              <span className="ml-1 opacity-70">({t('chat_edited')})</span>
                            )}
                            <OutStatus m={m} t={t} />
                          </div>
                          {/* 6if: агрегированные реакции под телом сообщения */}
                          {(() => {
                            const rs = reactionsFor(m.server_id)
                            if (rs.length === 0) return null
                            const self = peersData?.self
                            return (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {rs.map(r => {
                                  const mine = self && r.reactors.includes(self)
                                  return (
                                    <button
                                      key={r.emoji}
                                      onClick={() => toggleReaction(m, r.emoji)}
                                      title={r.reactors.map(peerLabel).join(', ')}
                                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-11 border transition-colors ${
                                        mine
                                          ? 'bg-accent/20 border-accent text-accent'
                                          : m.direction === 'out'
                                            ? 'bg-white/15 border-white/20 text-white/90'
                                            : 'bg-border/50 border-border text-muted hover:border-accent'
                                      }`}
                                    >
                                      <span>{r.emoji}</span>
                                      <span>{r.count}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </div>
                        {/* 39b: ответить с цитатой — для сообщений с server_id (входящие) */}
                        {m.direction === 'in' && m.server_id != null && (
                          <button
                            onClick={() => handleReply(m)}
                            title={t('chat_reply')}
                            aria-label={t('chat_reply')}
                            className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-opacity"
                          >
                            <CornerUpLeft size={14} />
                          </button>
                        )}
                        {/* qsk: переслать входящее сообщение в другую комнату */}
                        {m.direction === 'in' && (
                          <button
                            onClick={() => setForwardMsg(m)}
                            title={t('chat_forward')}
                            aria-label={t('chat_forward')}
                            className="shrink-0 p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-opacity"
                          >
                            <CornerUpRight size={14} />
                          </button>
                        )}
                        {/* yyt: пин доступен для сообщений с server_id (входящие) */}
                        {m.direction === 'in' && m.server_id != null && (
                          <button
                            onClick={() => togglePin(m)}
                            title={pinnedIds.has(m.server_id) ? t('chat_unpin') : t('chat_pin')}
                            aria-label={
                              pinnedIds.has(m.server_id) ? t('chat_unpin') : t('chat_pin')
                            }
                            className={`shrink-0 p-1 rounded hover:bg-border transition-opacity ${
                              pinnedIds.has(m.server_id)
                                ? 'text-accent'
                                : 'text-muted opacity-0 group-hover:opacity-100 hover:text-accent'
                            }`}
                          >
                            <Pin size={14} />
                          </button>
                        )}
                        {/* 6if: реакция — для сообщений с server_id (входящие) */}
                        {m.direction === 'in' && m.server_id != null && (
                          <div className="relative shrink-0">
                            <button
                              onClick={() =>
                                setEmojiPickerFor(
                                  emojiPickerFor === m.server_id ? null : m.server_id
                                )
                              }
                              title={t('chat_react')}
                              aria-label={t('chat_react')}
                              className="p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-border transition-opacity"
                            >
                              <SmilePlus size={14} />
                            </button>
                            {emojiPickerFor === m.server_id && (
                              <div className="absolute z-20 top-full left-0 mt-1 flex gap-0.5 bg-surface border border-border rounded-lg p-1 shadow-lg">
                                {REACTION_EMOJIS.map(em => (
                                  <button
                                    key={em}
                                    onClick={() => toggleReaction(m, em)}
                                    className="text-15 leading-none p-1 rounded hover:bg-border transition-colors"
                                  >
                                    {em}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Fragment>
                  ))
                )}
              </div>

              {/* 6jk: кнопка перехода к первому непрочитанному */}
              {unreadAnchorId != null && (
                <div className="shrink-0 flex justify-center pb-1">
                  <button
                    onClick={jumpToUnread}
                    className="btn btn-secondary btn-sm flex items-center gap-1"
                  >
                    <CornerUpLeft size={12} className="-rotate-90" />
                    {t('chat_jump_unread')}
                  </button>
                </div>
              )}

              {/* qhi: комната объявлений — только чтение, композер скрыт */}
              {current.readonly ? (
                <div className="shrink-0 border-t border-border bg-surface p-3 text-center text-12 text-muted">
                  {t('chat_room_readonly')}
                </div>
              ) : (
                <div className="shrink-0 border-t border-border bg-surface p-3">
                  {/* tdq: индикатор режима правки + отмена */}
                  {editingId != null && (
                    <div className="px-1 pb-1.5 text-11 text-accent flex items-center gap-2">
                      <Pencil size={12} />
                      <span>{t('chat_edit_hint')}</span>
                      <button onClick={handleEditCancel} className="underline hover:no-underline">
                        {t('btn_cancel')}
                      </button>
                    </div>
                  )}
                  {/* 39b: предпросмотр цитаты ответа + отмена */}
                  {replyTo && editingId == null && (
                    <div className="px-2 py-1 mb-1.5 border-l-2 border-accent bg-border/40 rounded-sm flex items-start gap-2">
                      <CornerUpLeft size={12} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="text-11 text-accent font-medium">
                          {peerLabel(replyTo.peer_iid)}
                        </div>
                        <div className="text-11 text-muted truncate">{replyTo.body}</div>
                      </div>
                      <button
                        onClick={() => setReplyTo(null)}
                        title={t('btn_cancel')}
                        aria-label={t('btn_cancel')}
                        className="shrink-0 p-0.5 rounded text-muted hover:text-red hover:bg-border"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {typingFrom && (
                    <div className="px-1 pb-1.5 text-11 text-muted">
                      {peerLabel(typingFrom)} {t('chat_typing')}
                    </div>
                  )}
                  {/* o87: подсказка по слеш-командам сущностей */}
                  {draft.startsWith('/') && !editingId && (
                    <div className="px-1 pb-1.5 text-11 text-muted">{t('chat_slash_hint')}</div>
                  )}
                  {/* da9: список подсказок @упоминаний */}
                  {mentionBox && mentionBox.items.length > 0 && (
                    <div className="mb-1.5 rounded border border-border bg-surface shadow-lg overflow-hidden">
                      {mentionBox.items.map(p => {
                        const h = mentionHandle(p.label || shortIid(p.installation_id))
                        return (
                          <button
                            key={p.installation_id}
                            type="button"
                            onClick={() => insertMention(h)}
                            className="w-full text-left px-3 py-1.5 text-13 flex items-center gap-2 hover:bg-hover"
                          >
                            <AtSign size={12} className="text-accent shrink-0" />
                            <span className="truncate">
                              {p.label || shortIid(p.installation_id)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={handleDraftChange}
                      onKeyDown={handleComposerKey}
                      placeholder={t('chat_input_placeholder')}
                      rows={Math.min(4, Math.max(1, draft.split('\n').length))}
                      className="form-input flex-1 resize-none"
                    />
                    {/* avm: прикрепить файл (sealed-вложение) */}
                    {editingId == null && (
                      <button
                        type="button"
                        onClick={handleAttach}
                        disabled={uploading || sending}
                        title={t('chat_attach')}
                        aria-label={t('chat_attach')}
                        className="btn btn-sm btn-ghost text-muted flex items-center"
                      >
                        {uploading ? <span className="text-11">…</span> : <Paperclip size={14} />}
                      </button>
                    )}
                    {/* azl: тумблер важности — активен только для новых сообщений */}
                    {editingId == null && (
                      <button
                        type="button"
                        onClick={() => setPriorityDraft(v => !v)}
                        title={t('chat_priority')}
                        aria-label={t('chat_priority')}
                        aria-pressed={priorityDraft}
                        className={`btn btn-sm flex items-center ${priorityDraft ? 'btn-danger' : 'btn-ghost text-muted'}`}
                      >
                        <AlertTriangle size={14} />
                      </button>
                    )}
                    <button
                      onClick={handleSend}
                      disabled={sending || !draft.trim()}
                      className="btn btn-primary btn-sm flex items-center gap-1.5"
                    >
                      {editingId != null ? <Pencil size={14} /> : <Send size={14} />}
                      {editingId != null ? t('chat_edit_save') : t('chat_send')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* mgt: модалка создания пользовательской группы */}
      {groupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setGroupModal(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-text mb-3">{t('chat_group_create')}</h2>
            <label className="block text-11 text-muted mb-1">{t('chat_group_title')}</label>
            <input
              type="text"
              value={groupModal.title}
              maxLength={120}
              onChange={e => setGroupModal(g => ({ ...g, title: e.target.value }))}
              placeholder={t('chat_group_title')}
              className="form-input w-full mb-3"
            />
            <label className="block text-11 text-muted mb-1">{t('chat_group_members')}</label>
            <div className="max-h-48 overflow-y-auto border border-border rounded mb-3">
              {(peersData?.peers ?? []).filter(p => p.role !== 'manager').length === 0 ? (
                <div className="p-2 text-11 text-muted">{t('chat_no_peers')}</div>
              ) : (
                (peersData?.peers ?? [])
                  .filter(p => p.role !== 'manager')
                  .map(p => {
                    const checked = groupModal.selected.has(p.installation_id)
                    return (
                      <label
                        key={p.installation_id}
                        className="flex items-center gap-2 px-2 py-1.5 border-b border-border cursor-pointer hover:bg-hover/50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setGroupModal(g => {
                              const sel = new Set(g.selected)
                              if (sel.has(p.installation_id)) sel.delete(p.installation_id)
                              else sel.add(p.installation_id)
                              return { ...g, selected: sel }
                            })
                          }
                        />
                        <span className="text-12 text-text truncate">
                          {p.label || shortIid(p.installation_id)}
                        </span>
                      </label>
                    )
                  })
              )}
            </div>
            <label className="block text-11 text-muted mb-1">{t('chat_group_invite')}</label>
            <input
              type="text"
              value={groupModal.invite}
              onChange={e => setGroupModal(g => ({ ...g, invite: e.target.value }))}
              placeholder={t('chat_group_invite_ph')}
              className="form-input w-full mb-4"
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setGroupModal(null)}>
                {t('btn_cancel')}
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={
                  sending ||
                  !groupModal.title.trim() ||
                  (groupModal.selected.size === 0 && !groupModal.invite.trim())
                }
                onClick={handleCreateGroup}
              >
                {t('chat_group_create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 19d: модалка профиля/Chat-ID (свой label или заметка о пире) */}
      {profileModal && (
        <ProfileModal
          modal={profileModal}
          selfIid={peersData?.self || ''}
          selfChatId={peersData?.self_chat_id || ''}
          selfLabel={peersData?.self_label || ''}
          notes={peerNotes}
          t={t}
          initials={initials}
          copyText={copyText}
          onClose={() => setProfileModal(null)}
          onSaveLabel={handleSaveLabel}
          onSaveNote={handleSaveNote}
        />
      )}

      {/* qsk: модалка пересылки — выбор комнаты-получателя */}
      {forwardMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setForwardMsg(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-text mb-3">{t('chat_forward')}</h2>
            <div className="mb-3 rounded border border-border bg-bg px-3 py-2 text-12 text-muted line-clamp-3 whitespace-pre-wrap break-words">
              {forwardMsg.body}
            </div>
            <label className="block text-11 text-muted mb-1">{t('chat_forward_to')}</label>
            <div className="max-h-64 overflow-y-auto border border-border rounded">
              {rooms.filter(r => !r.readonly && r.room !== forwardMsg.room).length === 0 ? (
                <div className="p-2 text-11 text-muted">{t('chat_no_peers')}</div>
              ) : (
                rooms
                  .filter(r => !r.readonly && r.room !== forwardMsg.room)
                  .map(r => (
                    <button
                      key={r.room}
                      disabled={sending}
                      onClick={() => handleForward(r)}
                      className="flex w-full items-center gap-2 px-2 py-1.5 border-b border-border text-left hover:bg-hover/50 disabled:opacity-50"
                    >
                      <span className="text-12 text-text truncate">{r.label}</span>
                    </button>
                  ))
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="btn btn-secondary btn-sm" onClick={() => setForwardMsg(null)}>
                {t('btn_cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
