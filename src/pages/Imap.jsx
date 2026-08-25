import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Inbox,
  Send,
  Plus,
  RefreshCw,
  Settings,
  PenSquare,
  Mail,
  Archive,
  Trash2,
  AlertCircle,
  CheckCircle,
  X,
  Globe,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { useConfirm } from '../hooks/useConfirm'
import { handleError, getErrorMessage } from '../utils/errorHandler.js'
import { ImapFolderTree, ImapEmailList, ImapMessageViewer } from './Imap/components/index.js'
import { ImapDomainRoutes } from './Imap/components/ImapDomainRoutes.jsx'
import { useEscapeKey } from '../hooks/useEscapeKey.js'

// ─── IMAP Account Modal ─────────────────────────────────────────────────────
function AccountModal({ account, onSave, onClose }) {
  useEscapeKey(onClose)
  const { t } = useLang()
  const [form, setForm] = useState({
    label: account?.label ?? '',
    host: account?.host ?? '',
    port: account?.port ?? 993,
    login: account?.login ?? '',
    password: '',
    poll_interval: account?.poll_interval ?? 60,
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const { error: toastErr } = usePremiumToast()
  const isEdit = !!account

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleLoginChange = email => {
    set('login', email)
    if (!form.label) set('label', email.split('@')[0])
    // Auto-detect would go here
  }

  const handleTest = async () => {
    if (!isEdit) {
      setTestResult({ ok: false, msg: t('imap_test_save_first') })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const msg = await invoke('test_imap_connection', { id: account.id })
      setTestResult({ ok: true, msg })
    } catch (e) {
      const error = handleError(e, 'Imap.handleTest')
      setTestResult({ ok: false, msg: getErrorMessage(error) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    // SEC-017: при редактировании пустой пароль = оставить текущий
    // (backend update_imap_account пропускает password, если он пустой).
    // Ротация пароля — просто ввести новый в это же поле.
    if (!form.label || !form.host || !form.login || (!isEdit && !form.password)) {
      toastErr(t('imap_fields_required'))
      return
    }
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      const error = handleError(e, 'AccountModal.handleSave')
      toastErr(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-modal-md"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="modal-title">
            {account ? t('imap_edit_account') : t('imap_add_account')}
          </h2>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="text"
              value={form.login}
              onChange={e => handleLoginChange(e.target.value)}
              placeholder="you@company.com"
              className="form-input"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="form-group">
              <label className="form-label">Label</label>
              <input
                type="text"
                value={form.label}
                onChange={e => set('label', e.target.value)}
                placeholder="Work Email"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Host</label>
              <input
                type="text"
                value={form.host}
                onChange={e => set('host', e.target.value)}
                placeholder="imap.gmail.com"
                className="form-input"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="form-group">
              <label className="form-label">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={e => set('port', Number(e.target.value))}
                placeholder="993"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Poll (sec)</label>
              <input
                type="number"
                value={form.poll_interval}
                onChange={e => set('poll_interval', Number(e.target.value))}
                placeholder="60"
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                {isEdit ? t('imap_leave_blank') : t('imap_app_password')}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••"
                className="form-input"
              />
            </div>
          </div>
        </div>

        {testResult && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
              testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
            }`}
          >
            {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {testResult.msg}
          </div>
        )}

        <div className="flex gap-2 mt-6 pt-4 border-t border-border">
          <button onClick={handleTest} disabled={testing} className="btn btn-primary btn-sm">
            {testing ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {t('btn_test')}
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
            {saving ? t('email_saving') : t('btn_save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Compose Modal ──────────────────────────────────────────────────────────
function ComposeModal({ smtpConfigs, defaultTo, defaultSubject, defaultBody, onClose, onSent }) {
  useEscapeKey(onClose)
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const [form, setForm] = useState({
    smtp_config_id: smtpConfigs[0]?.id ?? null,
    to: defaultTo ?? '',
    subject: defaultSubject ?? '',
    body: defaultBody ?? '',
  })
  const [sending, setSending] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSend = async () => {
    if (!form.smtp_config_id) {
      toastErr(t('imap_select_smtp'))
      return
    }
    if (!form.to || !form.subject) {
      toastErr(t('imap_to_subject_required'))
      return
    }
    setSending(true)
    try {
      await invoke('send_email', {
        smtpConfigId: form.smtp_config_id,
        to: form.to,
        subject: form.subject,
        body: form.body,
      })
      toastOk(t('imap_email_sent'))
      onSent?.()
      onClose()
    } catch (e) {
      const error = handleError(e, 'ComposeModal.handleSend')
      toastErr(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal w-modal-lg"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="modal-title flex items-center gap-2">
            <PenSquare size={18} />
            Compose Email
          </h2>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="form-group">
            <label className="form-label">From</label>
            <select
              value={form.smtp_config_id ?? ''}
              onChange={e => set('smtp_config_id', Number(e.target.value))}
              className="form-input"
            >
              {smtpConfigs.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.login})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">To</label>
            <input
              type="text"
              value={form.to}
              onChange={e => set('to', e.target.value)}
              placeholder="recipient@example.com"
              className="form-input"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              type="text"
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              value={form.body}
              onChange={e => set('body', e.target.value)}
              rows={10}
              className="form-input resize-vertical font-mono text-sm"
              placeholder="Write your message..."
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6 pt-4 border-t border-border">
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending} className="btn btn-primary btn-sm">
            {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Imap Page ───────────────────────────────────────────────────────
export default function Imap({ onNavigate: _onNavigate }) {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = usePremiumToast()
  const { confirm } = useConfirm()

  // Data
  const [accounts, setAccounts] = useState([])
  const [smtpConfigs, setSmtpConfigs] = useState([])
  const [stats, setStats] = useState({})

  // Navigation
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [selectedFolder, setSelectedFolder] = useState('INBOX')
  const [expandedAccounts, setExpandedAccounts] = useState({})
  const [accountFolders, setAccountFolders] = useState({})
  const [loadingFolders, setLoadingFolders] = useState({})

  // Messages
  const [messages, setMessages] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [msgPage, setMsgPage] = useState(1)
  const [msgTotal, setMsgTotal] = useState(0)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgSearch, setMsgSearch] = useState('')

  // UI State
  const [viewMode, setViewMode] = useState('inbox')
  const [checking, setChecking] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  // Modals & Panels
  const [showAddImap, setShowAddImap] = useState(false)
  const [editAccount, setEditAccount] = useState(null)
  const [showCompose, setShowCompose] = useState(false)
  const [composeReply, setComposeReply] = useState(null)
  // IMAP-ROUTING: маршруты «домен = почта» + модалка управления
  const [domainRoutes, setDomainRoutes] = useState([])
  const [showDomainRoutes, setShowDomainRoutes] = useState(false)

  // Load folders for an account
  const loadFolders = useCallback(async account => {
    if (!account) return
    setLoadingFolders(p => ({ ...p, [account.id]: true }))
    try {
      const folders = await invoke('get_imap_folders', { id: account.id })
      setAccountFolders(p => ({ ...p, [account.id]: Array.isArray(folders) ? folders : [] }))
      // Load stats
      const stats = await invoke('get_imap_stats', { id: account.id })
      setStats(p => ({ ...p, [account.id]: stats }))
    } catch (e) {
      handleError(e, 'Imap.loadFolders')
    } finally {
      setLoadingFolders(p => ({ ...p, [account.id]: false }))
    }
  }, [])

  // Load accounts
  const loadAccounts = useCallback(async () => {
    try {
      const [imap, smtp, routes] = await Promise.all([
        invoke('get_imap_accounts'),
        invoke('get_smtp_configs'),
        invoke('list_domain_routes'),
      ])
      // invoke может вернуть null (команда недоступна/ошибка) — null пробивает
      // дефолт `= []` и роняет рендер на .length. Все три — через Array-гвард.
      setAccounts(Array.isArray(imap) ? imap : [])
      setSmtpConfigs(Array.isArray(smtp) ? smtp : [])
      setDomainRoutes(Array.isArray(routes) ? routes : [])
      const list = Array.isArray(imap) ? imap : []
      if (list.length > 0 && !selectedAccount) {
        setSelectedAccount(list[0])
        loadFolders(list[0])
      }
    } catch (e) {
      const error = handleError(e, 'Imap.loadAccounts')
      toastErr(getErrorMessage(error))
    }
  }, [selectedAccount, toastErr, loadFolders])

  const loadMessages = useCallback(
    async (accountId, folder, page = 1, search = '') => {
      if (!accountId) return
      setLoadingMsgs(true)
      try {
        const result = await invoke('get_imap_messages', {
          accountId,
          folder,
          page,
          perPage: 30,
          search,
        })
        // ★ Insight: Проверка актуальности — если accountId изменился, не обновляем состояние
        // Бэкенд возвращает PaginatedMessages { items, total, ... } — поле
        // называется items, не messages. Через гвард: null/undefined не
        // уронит рендер списка (.map по undefined).
        setMessages(result?.items ?? [])
        setMsgTotal(result?.total ?? 0)
        setMsgPage(page)
      } catch (e) {
        const error = handleError(e, 'Imap.loadMessages')
        toastErr(getErrorMessage(error))
      } finally {
        setLoadingMsgs(false)
      }
    },
    [toastErr]
  )

  // FIX P0-5: Use refs for stable values to prevent listener recreation
  const msgPageRef = useRef(msgPage)
  const msgSearchRef = useRef(msgSearch)
  useEffect(() => {
    msgPageRef.current = msgPage
    msgSearchRef.current = msgSearch
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- асинхронная загрузка IMAP-аккаунтов
    loadAccounts()
    let unlistenFn = null
    // Событие называется new_imap_message — так его шлёт бэкенд
    // (main.rs:1323 и main.rs:2034). Здесь раньше слушалось
    // imap_message_received, которое не эмитит никто: список писем не
    // обновлялся при получении новой почты.
    listen('new_imap_message', async () => {
      await loadAccounts()
      if (selectedAccount) {
        loadMessages(selectedAccount.id, selectedFolder, msgPageRef.current, msgSearchRef.current)
      }
    }).then(fn => {
      unlistenFn = fn
    })
    return () => {
      if (unlistenFn) unlistenFn()
    }
  }, [loadAccounts, loadMessages, selectedAccount, selectedFolder])

  const handleCheckAll = async () => {
    setChecking(true)
    try {
      await invoke('check_all_imap')
      toastOk('Checked all accounts')
      loadAccounts()
    } catch (e) {
      const error = handleError(e, 'Imap.handleCheckAll')
      toastErr(getErrorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  const handleSelectMessage = msg => {
    setSelectedMessage(msg)
    if (!msg.is_read) {
      handleMarkRead(msg)
    }
  }

  const handleMarkRead = async msg => {
    try {
      await invoke('mark_imap_read', { id: msg.id })
      setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_read: true } : m)))
    } catch (e) {
      const error = handleError(e, 'Imap.handleMarkRead')
      toastErr(getErrorMessage(error))
    }
  }

  const handleArchiveMessage = async msg => {
    try {
      await invoke('archive_imap_message', { id: msg.id })
      setMessages(prev => prev.filter(m => m.id !== msg.id))
      if (selectedMessage?.id === msg.id) setSelectedMessage(null)
      toastOk('Message archived')
    } catch (e) {
      const error = handleError(e, 'Imap.handleArchive')
      toastErr(getErrorMessage(error))
    }
  }

  const handleDeleteMessage = async msg => {
    const ok = await confirm('Delete this message?', { danger: true })
    if (!ok) return
    try {
      await invoke('delete_imap_message', { id: msg.id })
      setMessages(prev => prev.filter(m => m.id !== msg.id))
      if (selectedMessage?.id === msg.id) setSelectedMessage(null)
      toastOk('Message deleted')
    } catch (e) {
      const error = handleError(e, 'Imap.handleDelete')
      toastErr(getErrorMessage(error))
    }
  }

  const handleReply = msg => {
    const originalLines = msg.body
      .split('\n')
      .slice(0, 10)
      .map(l => `> ${l}`)
      .join('\n')
    setComposeReply({
      to: msg.from_email ?? '',
      subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject ?? ''}`,
      body: `\n\n--- Original message ---\nFrom: ${msg.from_email}\nDate: ${msg.received_at?.slice(0, 16) ?? ''}\n\n${originalLines}`,
    })
    setShowCompose(true)
  }

  const toggleExpand = acc => {
    if (acc.id === -1) return
    const expanded = !expandedAccounts[acc.id]
    setExpandedAccounts(p => ({ ...p, [acc.id]: expanded }))
    if (expanded) loadFolders(acc)
  }

  const selectFolder = (acc, folder) => {
    setSelectedAccount(acc)
    setSelectedFolder(folder)
    loadMessages(acc.id, folder, 1, msgSearch)
  }

  const handleSaveImapAccount = async form => {
    try {
      if (editAccount) {
        await invoke('update_imap_account', { id: editAccount.id, input: form })
        toastOk('Account updated')
      } else {
        await invoke('add_imap_account', { input: form })
        toastOk('Account added')
      }
      loadAccounts()
    } catch (e) {
      const error = handleError(e, 'Imap.handleSaveImapAccount')
      toastErr(getErrorMessage(error))
    }
  }

  return (
    <div className="h-full flex flex-col bg-app">
      {/* ── Header ── */}
      <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-accent" />
            <h1 className="text-sm font-semibold text-text">IMAP Mail</h1>
          </div>
          <span className="text-xs text-muted px-2 py-0.5 bg-border rounded-full">
            {accounts.length} accounts
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('inbox')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                viewMode === 'inbox'
                  ? 'bg-accent text-white'
                  : 'bg-surface text-muted hover:bg-hover'
              }`}
            >
              <Inbox size={14} /> Inbox
            </button>
            <button
              onClick={() => setViewMode('sent')}
              className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
                viewMode === 'sent'
                  ? 'bg-accent text-white'
                  : 'bg-surface text-muted hover:bg-hover'
              }`}
            >
              <Send size={14} /> Sent
            </button>
          </div>

          <button
            onClick={() => setShowCompose(true)}
            disabled={smtpConfigs.length === 0}
            className="btn btn-primary btn-sm flex items-center gap-1.5"
            title={smtpConfigs.length === 0 ? 'Add SMTP first' : 'Compose'}
          >
            <PenSquare size={14} /> Compose
          </button>

          <button
            onClick={handleCheckAll}
            disabled={checking}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            Check All
          </button>

          <button
            onClick={() => setShowDomainRoutes(true)}
            className="btn btn-ghost btn-sm p-2"
            title={t('imap_domain_routes_title')}
          >
            <Globe size={16} />
          </button>

          <button
            onClick={() => setShowAddImap(true)}
            className="btn btn-ghost btn-sm p-2"
            title="Add Account"
          >
            <Plus size={16} />
          </button>

          <button onClick={loadAccounts} className="btn btn-ghost btn-sm p-2" title="Refresh">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      {viewMode === 'inbox' && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <ImapFolderTree
            accounts={accounts}
            expandedAccounts={expandedAccounts}
            accountFolders={accountFolders}
            loadingFolders={loadingFolders}
            stats={stats}
            selectedAccount={selectedAccount}
            selectedFolder={selectedFolder}
            onToggleExpand={toggleExpand}
            onSelectFolder={selectFolder}
            onAddImap={() => setShowAddImap(true)}
          />

          <ImapEmailList
            messages={messages}
            selectedMessage={selectedMessage}
            selectedFolder={selectedFolder}
            selectedAccount={selectedAccount}
            msgTotal={msgTotal}
            msgPage={msgPage}
            loadingMsgs={loadingMsgs}
            onLoadMessages={loadMessages}
            onSelectMessage={handleSelectMessage}
            onSearch={val => {
              setMsgSearch(val)
              loadMessages(selectedAccount?.id, selectedFolder, 1, val)
            }}
            onMarkRead={handleMarkRead}
            onArchive={handleArchiveMessage}
            onDelete={handleDeleteMessage}
            msgSearch={msgSearch}
            onMsgContextMenu={info => setContextMenu(info)}
            domainRoutes={domainRoutes}
          />

          <ImapMessageViewer
            message={selectedMessage}
            onReply={handleReply}
            onMarkRead={handleMarkRead}
            onDelete={handleDeleteMessage}
            onArchive={handleArchiveMessage}
          />
        </div>
      )}

      {viewMode === 'sent' && (
        <div className="flex-1 flex items-center justify-center text-muted">
          <div className="text-center">
            <Send size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Sent emails will appear here</p>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showAddImap && (
        <AccountModal
          account={null}
          onSave={handleSaveImapAccount}
          onClose={() => setShowAddImap(false)}
        />
      )}
      {editAccount && (
        <AccountModal
          account={editAccount}
          onSave={handleSaveImapAccount}
          onClose={() => setEditAccount(null)}
        />
      )}
      {showCompose && (
        <ComposeModal
          smtpConfigs={smtpConfigs}
          defaultTo={composeReply?.to}
          defaultSubject={composeReply?.subject}
          defaultBody={composeReply?.body}
          onSent={() => {
            setShowCompose(false)
            setComposeReply(null)
          }}
          onClose={() => {
            setShowCompose(false)
            setComposeReply(null)
          }}
        />
      )}
      {showDomainRoutes && (
        <ImapDomainRoutes
          accounts={accounts}
          onClose={() => {
            setShowDomainRoutes(false)
            loadAccounts()
          }}
          onError={e => toastErr(typeof e === 'string' ? e : getErrorMessage(e))}
        />
      )}

      {/* ── Context Menu ── */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full px-3 py-2 text-xs text-left hover:bg-hover flex items-center gap-2"
              onClick={() => {
                handleMarkRead(contextMenu.msg)
                setContextMenu(null)
              }}
            >
              <CheckCircle size={14} /> Mark as Read
            </button>
            <button
              className="w-full px-3 py-2 text-xs text-left hover:bg-hover flex items-center gap-2"
              onClick={() => {
                handleArchiveMessage(contextMenu.msg)
                setContextMenu(null)
              }}
            >
              <Archive size={14} /> Archive
            </button>
            <button
              className="w-full px-3 py-2 text-xs text-left hover:bg-hover flex items-center gap-2 text-error"
              onClick={() => {
                handleDeleteMessage(contextMenu.msg)
                setContextMenu(null)
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
