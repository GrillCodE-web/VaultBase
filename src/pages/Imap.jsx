import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  Inbox,
  Plus,
  Trash2,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Mail,
  CheckCircle,
  AlertCircle,
  Package,
  X,
  Send,
  ChevronDown,
  ChevronRight,
  Folder,
  Settings,
  PenSquare,
  AlertOctagon,
  FileText,
  Database,
  CornerUpLeft,
  Archive,
  Search,
} from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import { detectImapConfig, detectSmtpConfig } from '../constants/emailProviders.js'

function FolderIcon({ name, size = 13 }) {
  const n = (name ?? '').toLowerCase()
  if (n === 'inbox') return <Inbox size={size} />
  if (n.includes('sent')) return <Send size={size} />
  if (n.includes('trash') || n.includes('deleted')) return <Trash2 size={size} />
  if (n.includes('spam') || n.includes('junk')) return <AlertOctagon size={size} />
  if (n.includes('draft')) return <FileText size={size} />
  return <Folder size={size} />
}

// ─── Action badge ───────────────────────────────────────────────────────────
function ActionBadge({ action }) {
  if (!action) return null
  const cls =
    {
      shipped: 'st-transit',
      delivered: 'st-delivered',
      cancelled: 'st-cancelled',
      processing: 'st-processing',
    }[action] ?? 'st-pending'
  return <span className={`st ${cls}`}>{action}</span>
}

// ─── IMAP Account Modal ─────────────────────────────────────────────────────
function AccountModal({ account, onSave, onClose }) {
  const { t } = useLang()
  const [form, setForm] = useState({
    label: account?.label ?? '',
    host: account?.host ?? '',
    port: account?.port ?? 993,
    login: account?.login ?? '',
    password: '',
    poll_interval: account?.poll_interval ?? 60,
  })
  const [autoDetected, setAutoDetected] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const { error: toastErr } = useToast()
  const isEdit = !!account

  const [smtpDetected, setSmtpDetected] = useState(null)
  const [setupSmtp, setSetupSmtp] = useState(true)
  const [smtpForm, setSmtpForm] = useState({
    host: '',
    port: 587,
    use_tls: false,
    use_starttls: true,
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleLoginChange = email => {
    set('login', email)
    if (!form.label) set('label', email.split('@')[0])
    const imapCfg = detectImapConfig(email)
    const smtpCfg = detectSmtpConfig(email)
    if (imapCfg && !isEdit) {
      setForm(p => ({
        ...p,
        login: email,
        label: p.label || email.split('@')[0],
        host: imapCfg.host,
        port: imapCfg.port,
      }))
      setAutoDetected(imapCfg.host)
    } else {
      setAutoDetected(null)
    }
    if (smtpCfg && !isEdit) {
      setSmtpDetected(smtpCfg)
      setSmtpForm({
        host: smtpCfg.host,
        port: smtpCfg.port,
        use_tls: smtpCfg.use_tls,
        use_starttls: smtpCfg.use_starttls,
      })
    } else {
      setSmtpDetected(null)
    }
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
      setTestResult({ ok: false, msg: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!form.label || !form.host || !form.login) {
      toastErr(t('imap_fields_required'))
      return
    }
    setSaving(true)
    try {
      await onSave(form)
      // Auto-create SMTP config if requested and password provided
      if (!isEdit && setupSmtp && smtpDetected && form.password) {
        try {
          await invoke('add_smtp_config', {
            input: {
              label: form.label + ' SMTP',
              host: smtpForm.host,
              port: smtpForm.port,
              login: form.login,
              password: form.password,
              use_tls: smtpForm.use_tls,
              use_starttls: smtpForm.use_starttls,
            },
          })
        } catch {
          /* SMTP save failed — non-critical */
        }
      }
      onClose()
    } catch (e) {
      toastErr(String(e))
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
    <div className="modal-overlay">
      <div
        className="modal w-modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="imap-account-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="imap-account-title" className="modal-title">
            {account ? t('imap_edit_account') : t('imap_add_account')}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="form-group">
            <label className="form-label">{t('imap_login_label')}</label>
            <input
              type="text"
              value={form.login}
              onChange={e => handleLoginChange(e.target.value)}
              placeholder="user@yahoo.com"
              className="form-input"
            />
            {autoDetected && (
              <div className="mt-1 text-[11px] text-success">
                ✓ {t('imap_auto_configured')}: {autoDetected}:{form.port} —{' '}
                {t('imap_use_app_password')}
              </div>
            )}
          </div>
          {[
            { label: t('col_label'), key: 'label', type: 'text', placeholder: 'Yahoo work' },
            {
              label: t('col_host_port')?.split(':')[0] ?? 'Host',
              key: 'host',
              type: 'text',
              placeholder: 'imap.mail.yahoo.com',
            },
            { label: t('imap_port'), key: 'port', type: 'number', placeholder: '993' },
            {
              label: t('imap_app_password'),
              key: 'password',
              type: 'password',
              placeholder: account ? t('imap_leave_blank') : t('imap_app_password_hint'),
            },
            {
              label: t('imap_poll_interval'),
              key: 'poll_interval',
              type: 'number',
              placeholder: '60',
            },
          ].map(({ label, key, type, placeholder }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={e =>
                  set(key, type === 'number' ? Number(e.target.value) : e.target.value)
                }
                placeholder={placeholder}
                className="form-input"
              />
            </div>
          ))}
        </div>
        {testResult && (
          <div
            className="mt-3 p-[10px_12px] rounded-md text-[12px] flex items-center gap-2"
            style={{
              backgroundColor: testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
              border: `1px solid ${testResult.ok ? 'var(--color-success-bg)' : 'var(--color-error-bg)'}`,
              color: testResult.ok ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {testResult.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
            {testResult.msg}
          </div>
        )}
        {!isEdit && smtpDetected && (
          <div
            className="mt-3 p-[10px_12px] rounded-md"
            style={{
              background: 'var(--color-info-bg)',
              border: '1px solid var(--color-info-bg)',
            }}
          >
            <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={setupSmtp}
                onChange={e => setSetupSmtp(e.target.checked)}
              />
              Also configure SMTP: {smtpDetected.host}:{smtpDetected.port}
            </label>
            <div className="text-[11px] text-muted mt-[3px]">
              Will use same login and app password for outgoing mail
            </div>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button onClick={handleTest} disabled={testing} className="btn btn-b btn-sm">
            {testing ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            {t('btn_test')}
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-b btn-sm">
            {saving ? t('email_saving') : t('btn_save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SMTP Config Modal ──────────────────────────────────────────────────────
function SmtpModal({ onSave, onClose }) {
  const { t } = useLang()
  const { error: toastErr } = useToast()
  const [form, setForm] = useState({
    label: '',
    host: '',
    port: 587,
    login: '',
    password: '',
    use_tls: false,
    use_starttls: true,
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.label || !form.host || !form.login || !form.password) {
      toastErr(t('imap_fields_required'))
      return
    }
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      toastErr(String(e))
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
    <div className="modal-overlay">
      <div
        className="modal w-modal-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="smtp-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="smtp-modal-title" className="modal-title">
            {t('imap_add_smtp')}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          {[
            { label: 'Label', key: 'label', type: 'text', placeholder: 'Gmail SMTP' },
            { label: 'Host', key: 'host', type: 'text', placeholder: 'smtp.gmail.com' },
            { label: 'Port', key: 'port', type: 'number', placeholder: '587' },
            { label: 'Login', key: 'login', type: 'text', placeholder: 'user@gmail.com' },
            {
              label: 'Password / App Password',
              key: 'password',
              type: 'password',
              placeholder: '',
            },
          ].map(({ label, key, type, placeholder }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={e =>
                  set(key, type === 'number' ? Number(e.target.value) : e.target.value)
                }
                placeholder={placeholder}
                className="form-input"
              />
            </div>
          ))}
          <div className="flex gap-4 items-center text-[13px]">
            <label className="flex items-center gap-1\.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.use_tls}
                onChange={e => set('use_tls', e.target.checked)}
              />
              Use TLS (port 465)
            </label>
            <label className="flex items-center gap-1\.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.use_starttls}
                onChange={e => set('use_starttls', e.target.checked)}
              />
              STARTTLS (port 587)
            </label>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-b btn-sm">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : null}
            {saving ? t('email_saving') : t('btn_save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Compose Modal ──────────────────────────────────────────────────────────
function ComposeModal({ smtpConfigs, defaultTo, defaultSubject, defaultBody, onClose, onSent }) {
  const { t } = useLang()
  const { success: toastOk, error: toastErr } = useToast()
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
      toastErr(String(e))
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
    <div className="modal-overlay">
      <div
        className="modal w-modal-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="compose-modal-title" className="modal-title">
            <PenSquare size={14} className="align-middle mr-1\.5" />
            {t('imap_compose_title')}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div className="form-group">
            <label className="form-label">{t('imap_from')}</label>
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
            <label className="form-label">{t('imap_to')}</label>
            <input
              type="text"
              value={form.to}
              onChange={e => set('to', e.target.value)}
              placeholder="recipient@example.com"
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('imap_subject')}</label>
            <input
              type="text"
              value={form.subject}
              onChange={e => set('subject', e.target.value)}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t('imap_body')}</label>
            <textarea
              value={form.body}
              onChange={e => set('body', e.target.value)}
              rows={8}
              className="form-input resize-vertical font-inherit"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSend} disabled={sending} className="btn btn-g btn-sm">
            {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
            {sending ? t('imap_sending') : t('imap_send')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Message Viewer ─────────────────────────────────────────────────────────
function MessageViewer({ message, onReply, onMarkRead, onDelete, onArchive }) {
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
            <div className="flex gap-1\.5 items-center">
              {message.action_taken && <ActionBadge action={message.action_taken} />}
              {message.extracted_order_number && (
                <span className="text-[11px] text-blue-t">
                  <Package size={10} className="inline mr-0\.5" />#{message.extracted_order_number}
                </span>
              )}
              {message.extracted_tracking && (
                <span className="mono text-[11px] text-muted">{message.extracted_tracking}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1\.5 mt-2">
          {!message.is_read && (
            <button onClick={() => onMarkRead(message)} className="btn btn-b btn-sm">
              <CheckCircle size={12} /> Mark Read
            </button>
          )}
          <button onClick={() => onReply(message)} className="btn btn-ghost btn-sm">
            <CornerUpLeft size={12} /> Reply
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onArchive(message)}
            title="Archive"
          >
            <Archive size={12} /> Archive
          </button>
          <button className="btn btn-r btn-sm btn-icon" onClick={() => onDelete(message)}>
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
              sandbox="allow-same-origin"
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

// Virtual "All Inboxes" account pseudo-object
const ALL_INBOX = { id: -1, label: 'All Inboxes', is_active: true }

// ─── FolderRow ───────────────────────────────────────────────────────────────
function FolderRow({ acc, folder, s, selectedAccount, selectedFolder, onSelectFolder }) {
  const folderStats = s?.folders?.find(f => f.name === folder)
  const unread = folderStats?.unread ?? 0
  const isActive = selectedAccount?.id === acc.id && selectedFolder === folder
  return (
    <div
      onClick={() => onSelectFolder(acc, folder)}
      className="p-[6px_10px] cursor-pointer flex items-center gap-1\.5 text-[12px] rounded-sm mx-1 my-[1px]"
      style={{
        background: isActive ? 'var(--color-info-bg)' : 'transparent',
      }}
    >
      <span className="text-muted flex">
        <FolderIcon name={folder} size={12} />
      </span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{folder}</span>
      {unread > 0 && (
        <span
          className="text-[10px] rounded-full py-[1px] px-[5px]"
          style={{
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
          }}
        >
          {unread}
        </span>
      )}
    </div>
  )
}

// ─── FolderTree ───────────────────────────────────────────────────────────────
function FolderTree({
  accounts,
  expandedAccounts,
  accountFolders,
  loadingFolders,
  stats,
  selectedAccount,
  selectedFolder,
  onToggleExpand,
  onSelectFolder,
  onAddImap,
}) {
  const allUnread = Object.values(stats).reduce((s, a) => s + (a?.unread ?? 0), 0)
  return (
    <div className="w-[220px] shrink-0 border-r flex flex-col overflow-y-auto bg-surface">
      <div className="p-[10px_12px] border-b flex justify-between items-center">
        <span className="text-[12px] font-semibold text-muted">ACCOUNTS</span>
        <button
          onClick={onAddImap}
          className="btn btn-ghost btn-sm p-[2px_6px]"
          title="Add IMAP account"
        >
          <Plus size={13} />
        </button>
      </div>
      {/* All Inboxes virtual entry */}
      {accounts.length > 1 && (
        <div
          onClick={() => onSelectFolder(ALL_INBOX, 'INBOX')}
          className="p-[8px_10px] cursor-pointer flex items-center gap-1\.5 border-b"
          style={{
            background: selectedAccount?.id === -1 ? 'var(--color-info-bg)' : 'transparent',
            borderLeft:
              selectedAccount?.id === -1 ? '2px solid var(--blue)' : '2px solid transparent',
          }}
        >
          <Inbox size={13} className="shrink-0 text-blue" />
          <span className="text-[12px] flex-1 font-semibold">All Inboxes</span>
          {allUnread > 0 && (
            <span className="text-[10px] bg-red text-bg rounded-full py-[1px] px-[5px] shrink-0">
              {allUnread}
            </span>
          )}
        </div>
      )}
      {accounts.length === 0 && (
        <div className="p-[20px_12px] text-center text-[12px] text-muted">
          No accounts
          <br />
          <button onClick={onAddImap} className="btn btn-g btn-sm mt-2">
            <Plus size={11} /> Add
          </button>
        </div>
      )}
      {accounts.map(acc => {
        const expanded = expandedAccounts[acc.id]
        const folders = accountFolders[acc.id] ?? []
        const s = stats[acc.id]
        const unread = s?.unread ?? 0
        const isSelected = selectedAccount?.id === acc.id
        return (
          <div key={acc.id}>
            <div
              onClick={() => onToggleExpand(acc)}
              className="p-[8px_10px] cursor-pointer flex items-center gap-1\.5"
              style={{
                background: isSelected ? 'var(--color-info-bg)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--blue)' : '2px solid transparent',
              }}
            >
              {expanded ? (
                <ChevronDown size={13} className="text-muted shrink-0" />
              ) : (
                <ChevronRight size={13} className="text-muted shrink-0" />
              )}
              <Inbox
                size={13}
                className="shrink-0"
                style={{ color: acc.is_active ? 'var(--blue)' : 'var(--muted)' }}
              />
              <span className="text-[12px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {acc.label}
              </span>
              {unread > 0 && (
                <span className="text-[10px] bg-red text-bg rounded-full py-[1px] px-[5px] shrink-0">
                  {unread}
                </span>
              )}
            </div>
            {expanded && (
              <div className="pl-2">
                {loadingFolders[acc.id] ? (
                  <div className="p-[6px_12px] text-[11px] text-muted">Loading…</div>
                ) : folders.length === 0 ? (
                  ['INBOX'].map(f => (
                    <FolderRow
                      key={f}
                      acc={acc}
                      folder={f}
                      s={s}
                      selectedAccount={selectedAccount}
                      selectedFolder={selectedFolder}
                      onSelectFolder={onSelectFolder}
                    />
                  ))
                ) : (
                  folders.map(f => (
                    <FolderRow
                      key={f}
                      acc={acc}
                      folder={f}
                      s={s}
                      selectedAccount={selectedAccount}
                      selectedFolder={selectedFolder}
                      onSelectFolder={onSelectFolder}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── MessageList ──────────────────────────────────────────────────────────────
const MSG_PAGE_SIZE = 30
function MessageList({
  messages,
  selectedMessage,
  selectedFolder,
  selectedAccount,
  msgTotal,
  msgPage,
  loadingMsgs,
  onLoadMessages,
  onSelectMessage,
  onSearch,
  onMarkRead: _onMarkRead,
  onArchive: _onArchive,
  onDelete: _onDelete,
  msgSearch,
  onMsgContextMenu,
}) {
  const totalPages = Math.ceil(msgTotal / MSG_PAGE_SIZE)
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  const handleSearchChange = e => {
    const val = e.target.value
    if (searchRef.current !== null) searchRef.current.value = val
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearch(val)
    }, 400)
  }

  return (
    <div className="w-[300px] shrink-0 border-r flex flex-col overflow-y-auto">
      <div className="p-[8px_12px] border-b bg-card flex items-center gap-1\.5">
        <span className="text-[12px] font-semibold flex-1">{selectedFolder}</span>
        <span className="text-[11px] text-muted">{msgTotal} msgs</span>
        <button
          onClick={() =>
            selectedAccount &&
            onLoadMessages(selectedAccount.id, selectedFolder, msgPage, msgSearch)
          }
          className="btn btn-ghost btn-sm p-[2px_4px]"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      <div className="p-[6px_10px] border-b flex items-center gap-1\.5 bg-surface">
        <Search size={12} className="text-muted shrink-0" />
        <input
          type="search"
          placeholder="Search messages…"
          defaultValue={msgSearch}
          ref={searchRef}
          onChange={handleSearchChange}
          className="flex-1 border-none bg-transparent outline-none text-[12px] text-text min-w-0"
        />
      </div>
      {loadingMsgs ? (
        <div className="p-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[52px] bg-hover rounded mb-1\.5" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="p-[40px_16px] text-center text-[12px] text-muted">
          <Mail size={30} className="opacity-[0.3] mb-2" />
          <div>No messages in {selectedFolder}</div>
          <div className="text-[11px] mt-1 text-dim">Click Check Now to fetch</div>
        </div>
      ) : (
        <div className="flex-1">
          {messages.map(msg => (
            <div
              key={msg.id}
              onClick={() => onSelectMessage(msg)}
              onContextMenu={e => {
                e.preventDefault()
                onMsgContextMenu?.({ x: e.clientX, y: e.clientY, msg })
              }}
              className="p-[10px_12px] cursor-pointer border-b"
              style={{
                background: selectedMessage?.id === msg.id ? 'var(--color-info-bg)' : 'transparent',
                borderLeft:
                  selectedMessage?.id === msg.id
                    ? '2px solid var(--blue)'
                    : '2px solid transparent',
              }}
            >
              <div className="flex justify-between items-start gap-1">
                <div
                  className="text-[12px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ fontWeight: msg.is_read ? 400 : 600 }}
                >
                  {msg.from_email?.replace(/<.*>/, '').trim() || '(unknown)'}
                </div>
                <div className="text-[10px] text-muted shrink-0">
                  {msg.received_at ? new Date(msg.received_at).toLocaleDateString() : ''}
                </div>
              </div>
              <div
                className="text-[12px] overflow-hidden text-ellipsis whitespace-nowrap mt-0\.5"
                style={{ color: msg.is_read ? 'var(--muted)' : 'var(--text)' }}
              >
                {msg.subject || '(no subject)'}
              </div>
              {(msg.action_taken || msg.extracted_order_number) && (
                <div className="flex gap-1 mt-[3px] flex-wrap">
                  {msg.action_taken && <ActionBadge action={msg.action_taken} />}
                  {msg.extracted_order_number && (
                    <span className="text-[10px] text-blue-t">#{msg.extracted_order_number}</span>
                  )}
                </div>
              )}
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 p-3">
              <button
                disabled={msgPage <= 1}
                onClick={() =>
                  onLoadMessages(selectedAccount.id, selectedFolder, msgPage - 1, msgSearch)
                }
                className="btn btn-ghost btn-sm"
              >
                ← Prev
              </button>
              <span className="text-[12px] text-muted self-center">
                {msgPage} / {totalPages}
              </span>
              <button
                disabled={msgPage >= totalPages}
                onClick={() =>
                  onLoadMessages(selectedAccount.id, selectedFolder, msgPage + 1, msgSearch)
                }
                className="btn btn-ghost btn-sm"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Accounts & SMTP Panel ───────────────────────────────────────────────────
function AccountsPanel({
  accounts,
  smtpConfigs,
  stats,
  onAddImap,
  onEditImap,
  onDeleteImap,
  onToggleImap,
  onAddSmtp,
  onDeleteSmtp,
  onTestSmtp,
  onLinkAll,
  onClose,
}) {
  const { t } = useLang()
  const [view, setView] = useState('imap') // "imap" | "smtp"
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])
  return (
    <div className="modal-overlay">
      <div
        className="modal w-modal-lg max-h-\[80vh\] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="imap-settings-title"
      >
        <div className="flex items-center justify-between mb-4">
          <div id="imap-settings-title" className="flex gap-0">
            {[
              { key: 'imap', label: 'IMAP Accounts' },
              { key: 'smtp', label: 'SMTP Configs' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className="py-1\.5 px-\[14px] border-none bg-transparent cursor-pointer text-[12px]"
                style={{
                  color: view === key ? 'var(--blue)' : 'var(--muted)',
                  borderBottom: view === key ? '2px solid var(--blue)' : '2px solid transparent',
                  fontWeight: view === key ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {view === 'imap' && (
            <>
              <div className="flex justify-between items-center mb-2">
                <button
                  onClick={onLinkAll}
                  className="btn btn-b btn-sm"
                  title="Auto-link email pool entries to IMAP accounts by matching login"
                >
                  <Database size={13} /> Auto-link Emails
                </button>
                <button onClick={onAddImap} className="btn btn-g btn-sm">
                  <Plus size={13} /> {t('imap_add_account_btn')}
                </button>
              </div>
              {accounts.length === 0 ? (
                <div className="text-center py-10 text-muted text-[13px]">
                  {t('imap_no_accounts')}
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('col_label')}</th>
                      <th>{t('col_server')}</th>
                      <th>{t('col_status')}</th>
                      <th>{t('imap_unread')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map(acc => {
                      const s = stats[acc.id]
                      return (
                        <tr key={acc.id}>
                          <td>
                            <div className="font-medium">{acc.label}</div>
                            <div className="text-[11px] text-muted">{acc.login}</div>
                          </td>
                          <td className="mono text-[11px]">
                            {acc.host}:{acc.port}
                          </td>
                          <td>
                            <span className={`st ${acc.is_active ? 'st-active' : 'st-pending'}`}>
                              {acc.is_active ? t('imap_active') : t('imap_paused')}
                            </span>
                          </td>
                          <td>{s ? `${s.unread} / ${s.total}` : '—'}</td>
                          <td>
                            <div className="tbl-actions">
                              <button
                                onClick={() => onToggleImap(acc)}
                                className="btn btn-ghost btn-sm"
                                title={acc.is_active ? 'Pause' : 'Resume'}
                              >
                                {acc.is_active ? (
                                  <ToggleRight size={15} className="text-accent-color" />
                                ) : (
                                  <ToggleLeft size={15} />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  onEditImap(acc)
                                  onClose()
                                }}
                                className="btn btn-ghost btn-sm"
                              >
                                {t('btn_edit')}
                              </button>
                              <button
                                onClick={() => onDeleteImap(acc)}
                                className="btn btn-r btn-sm"
                              >
                                {t('btn_delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}

          {view === 'smtp' && (
            <>
              <div className="flex justify-end mb-2">
                <button onClick={onAddSmtp} className="btn btn-g btn-sm">
                  <Plus size={13} /> {t('imap_add_smtp_btn')}
                </button>
              </div>
              {smtpConfigs.length === 0 ? (
                <div className="text-center py-10 text-muted text-[13px]">{t('imap_no_smtp')}</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{t('col_label')}</th>
                      <th>{t('col_host_port')}</th>
                      <th>{t('imap_login_label')}</th>
                      <th>TLS</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {smtpConfigs.map(c => (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td className="mono text-[11px]">
                          {c.host}:{c.port}
                        </td>
                        <td className="text-[11px]">{c.login}</td>
                        <td>
                          <span className="st">
                            {c.use_tls ? 'TLS' : c.use_starttls ? 'STARTTLS' : 'None'}
                          </span>
                        </td>
                        <td>
                          <div className="tbl-actions">
                            <button onClick={() => onTestSmtp(c.id)} className="btn btn-b btn-sm">
                              {t('btn_test')}
                            </button>
                            <button onClick={() => onDeleteSmtp(c.id)} className="btn btn-r btn-sm">
                              {t('btn_delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function Imap({ onNavigate: _onNavigate }) {
  const { success: toastOk, error: toastErr } = useToast()
  const { confirm } = useConfirm()
  const { t } = useLang()

  // Data
  const [accounts, setAccounts] = useState([])
  const [smtpConfigs, setSmtpConfigs] = useState([])
  const [stats, setStats] = useState({}) // accountId → ImapAccountStats

  // Navigation
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [selectedFolder, setSelectedFolder] = useState('INBOX')
  const [expandedAccounts, setExpandedAccounts] = useState({})
  const [accountFolders, setAccountFolders] = useState({}) // accountId → string[]

  // Messages
  const [messages, setMessages] = useState([])
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [msgPage, setMsgPage] = useState(1)
  const [msgTotal, setMsgTotal] = useState(0)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [msgSearch, setMsgSearch] = useState('')

  // Context menu
  const [contextMenu, setContextMenu] = useState(null) // { x, y, msg }

  // Panels
  const [showAccountsPanel, setShowAccountsPanel] = useState(false)

  // Modals
  const [showAddImap, setShowAddImap] = useState(false)
  const [editAccount, setEditAccount] = useState(null) // account object or null
  const [showAddSmtp, setShowAddSmtp] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [composeReply, setComposeReply] = useState(null)

  // Sent view
  const [viewMode, setViewMode] = useState('inbox') // "inbox" | "sent"
  const [sentEmails, setSentEmails] = useState([])
  const [sentPage, setSentPage] = useState(1)
  const [sentTotal, setSentTotal] = useState(0)
  const [loadingSent, setLoadingSent] = useState(false)

  // Misc
  const [checking, setChecking] = useState(false)
  const [loadingFolders, setLoadingFolders] = useState({})

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadAccounts = useCallback(async () => {
    try {
      const list = await invoke('get_imap_accounts')
      setAccounts(list)
      // Use functional update to avoid stale closure on selectedAccount
      setSelectedAccount(prev => {
        if (prev) return list.find(a => a.id === prev.id) ?? list[0] ?? null
        return list[0] ?? null
      })
    } catch (e) {
      toastErr(String(e))
    }
  }, [toastErr])

  const loadSmtp = useCallback(async () => {
    try {
      const list = await invoke('get_smtp_configs')
      setSmtpConfigs(list)
    } catch {
      /* silent */
    }
  }, [])

  const loadStats = useCallback(async accountId => {
    if (accountId === -1) return
    try {
      const s = await invoke('get_imap_account_stats', { accountId })
      setStats(prev => ({ ...prev, [accountId]: s }))
    } catch {
      /* silent */
    }
  }, [])

  const loadFolders = useCallback(async account => {
    setLoadingFolders(p => {
      if (p[account.id]) return p
      return { ...p, [account.id]: true }
    })
    try {
      const folders = await invoke('list_imap_folders', { accountId: account.id })
      setAccountFolders(p => {
        if (p[account.id]) return p
        return { ...p, [account.id]: folders }
      })
    } catch {
      setAccountFolders(p => {
        if (p[account.id]) return p
        return { ...p, [account.id]: ['INBOX'] }
      })
    } finally {
      setLoadingFolders(p => ({ ...p, [account.id]: false }))
    }
  }, [])

  const loadMessages = useCallback(
    async (accountId, folder, page, search = '') => {
      if (!accountId) return
      setLoadingMsgs(true)
      setSelectedMessage(null)
      try {
        // Unified inbox: all accounts combined
        if (accountId === -1) {
          const res = await invoke('get_unified_inbox', { page, search: search || null })
          setMessages(res.items ?? [])
          setMsgTotal(res.total ?? 0)
          setMsgPage(page)
          return
        }
        // Normal: returns DB cache immediately (no IMAP connection)
        const res = await invoke('get_folder_messages', {
          accountId,
          folder,
          page,
          search: search || null,
        })
        setMessages(res.items ?? [])
        setMsgTotal(res.total ?? 0)
        setMsgPage(page)
        // Trigger background IMAP refresh (fire-and-forget; result via imap_messages_refreshed event)
        if (!search && page === 1) {
          invoke('refresh_folder_from_imap', { accountId, folder }).catch(() => {})
        }
      } catch (e) {
        toastErr(String(e))
      } finally {
        setLoadingMsgs(false)
      }
    },
    [toastErr]
  )

  const loadSentEmails = useCallback(
    async page => {
      setLoadingSent(true)
      try {
        const res = await invoke('get_sent_emails', { page })
        setSentEmails(res.items ?? [])
        setSentTotal(res.total ?? 0)
        setSentPage(page)
      } catch (e) {
        toastErr(String(e))
      } finally {
        setLoadingSent(false)
      }
    },
    [toastErr]
  )

  useEffect(() => {
    loadAccounts()
    loadSmtp()
  }, [loadAccounts, loadSmtp])

  useEffect(() => {
    if (selectedAccount) {
      if (selectedAccount.id !== -1) loadStats(selectedAccount.id)
      loadMessages(selectedAccount.id, selectedFolder, 1, msgSearch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, selectedFolder])

  useEffect(() => {
    if (viewMode === 'sent') loadSentEmails(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  // Tracking active check progress — map accountId → boolean
  const setCheckingAccounts = useState({})[1]

  // B5: Listen for new IMAP messages emitted by the background poll thread
  useEffect(() => {
    let unlisten
    ;(async () => {
      unlisten = await listen('new_imap_message', event => {
        const { subject, from, account_id } = event.payload
        toastOk(`New email: ${subject} from ${from}`)
        setSelectedAccount(prev => {
          if (prev && prev.id === account_id) {
            loadMessages(prev.id, selectedFolder, 1)
          }
          return prev
        })
      })
    })()
    return () => {
      if (unlisten) unlisten()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder, loadMessages])

  // Background IMAP check progress events
  useEffect(() => {
    let u1, u2, u3
    ;(async () => {
      // imap_check_progress: per-account result
      u1 = await listen('imap_check_progress', event => {
        const { account_id, error } = event.payload
        if (error) {
          console.warn('[imap] check error:', error)
        }
        // Refresh stats for this account
        loadStats(account_id)
        // If this is the account we're viewing, reload messages from DB
        setSelectedAccount(prev => {
          if (prev && (prev.id === account_id || prev.id === -1)) {
            loadMessages(prev.id, selectedFolder, 1, msgSearch)
          }
          return prev
        })
        // Clear checking when all done — use a counter approach
        setCheckingAccounts(prev => {
          const updated = { ...prev, [account_id]: false }
          if (Object.values(updated).every(v => v === false)) {
            setChecking(false)
          }
          return updated
        })
      })

      // imap_messages_refreshed: background folder refresh completed
      u2 = await listen('imap_messages_refreshed', event => {
        const { account_id, folder, new_count } = event.payload
        if (new_count > 0) {
          setSelectedAccount(prev => {
            if (!prev) return prev
            if (prev.id === -1) {
              // Unified inbox — reload
              invoke('get_unified_inbox', { page: 1, search: null })
                .then(res => {
                  setMessages(res.items ?? [])
                  setMsgTotal(res.total ?? 0)
                })
                .catch(() => {})
            } else if (prev.id === account_id) {
              invoke('get_folder_messages', {
                accountId: account_id,
                folder,
                page: 1,
                search: null,
              })
                .then(res => {
                  setMessages(res.items ?? [])
                  setMsgTotal(res.total ?? 0)
                })
                .catch(() => {})
            }
            return prev
          })
          loadStats(account_id)
        }
      })

      // imap_folders_refreshed: background folder list update
      u3 = await listen('imap_folders_refreshed', event => {
        const { account_id, folders } = event.payload
        setAccountFolders(prev => ({ ...prev, [account_id]: folders }))
      })
    })()
    return () => {
      if (u1) u1()
      if (u2) u2()
      if (u3) u3()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder, loadMessages, loadStats, msgSearch]) // setCheckingAccounts is stable setState

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleCheckAll = async () => {
    setChecking(true)
    try {
      // Pre-mark all active accounts as pending (so the event listener knows when all are done)
      const pending = {}
      accounts
        .filter(a => a.is_active)
        .forEach(a => {
          pending[a.id] = true
        })
      setCheckingAccounts(pending)
      // Returns immediately; progress arrives via imap_check_progress events
      const res = await invoke('imap_check_all')
      if (res.accounts_checked === 0) {
        toastOk(t('imap_no_accounts') || 'No active accounts')
        setChecking(false)
      }
    } catch (e) {
      toastErr(String(e))
      setChecking(false)
    }
  }

  const handleLinkAll = async () => {
    try {
      const linked = await invoke('link_all_imap_accounts')
      toastOk(`Auto-linked ${linked} email(s) to IMAP accounts`)
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleSaveImapAccount = async form => {
    if (editAccount) {
      await invoke('update_imap_account', { id: editAccount.id, input: form })
      toastOk(t('imap_account_updated'))
    } else {
      await invoke('add_imap_account', { input: form })
      toastOk(t('imap_account_added'))
    }
    await loadAccounts()
  }

  const handleToggle = async acc => {
    try {
      await invoke('toggle_imap_account', { id: acc.id, active: !acc.is_active })
      setAccounts(prev => prev.map(a => (a.id === acc.id ? { ...a, is_active: !a.is_active } : a)))
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleDelete = async acc => {
    const ok = await confirm(`${t('imap_confirm_delete')} "${acc.label}"?`, {
      title: t('imap_delete_account'),
    })
    if (!ok) return
    try {
      await invoke('delete_imap_account', { id: acc.id })
      toastOk(t('msg_deleted'))
      await loadAccounts()
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleSaveSmtp = async form => {
    await invoke('add_smtp_config', { input: form })
    toastOk(t('imap_smtp_added'))
    await loadSmtp()
  }

  const handleDeleteSmtp = async id => {
    const ok = await confirm(t('imap_confirm_delete_smtp'), { title: t('imap_delete_smtp') })
    if (!ok) return
    try {
      await invoke('delete_smtp_config', { id })
      toastOk(t('msg_deleted'))
      await loadSmtp()
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleTestSmtp = async id => {
    try {
      const msg = await invoke('test_smtp_connection', { id })
      toastOk(msg)
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleSelectMessage = async msg => {
    setSelectedMessage(msg)
    if (!msg.is_read) {
      try {
        await invoke('mark_imap_message_read', { accountId: msg.account_id, messageId: msg.id })
        setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_read: true } : m)))
        if (selectedAccount) loadStats(selectedAccount.id)
      } catch {
        /* silent */
      }
    }
  }

  const handleMarkRead = async msg => {
    try {
      await invoke('mark_imap_message_read', { accountId: msg.account_id, messageId: msg.id })
      setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_read: true } : m)))
      setSelectedMessage(prev => (prev?.id === msg.id ? { ...prev, is_read: true } : prev))
    } catch (e) {
      toastErr(String(e))
    }
  }

  const handleDeleteMessage = async msg => {
    try {
      await invoke('delete_imap_message', { accountId: msg.account_id, messageId: msg.id })
    } catch {
      // Ignore delete errors - remove locally anyway
    }
    setMessages(prev => prev.filter(m => m.id !== msg.id))
    setSelectedMessage(prev => (prev?.id === msg.id ? null : prev))
    setMsgTotal(prev => Math.max(0, prev - 1))
    toastOk(t('msg_deleted'))
  }

  const handleArchiveMessage = async msg => {
    try {
      await invoke('archive_imap_message', { accountId: msg.account_id, messageId: msg.id })
    } catch {
      // Ignore archive errors
    }
    setMessages(prev => prev.filter(m => m.id !== msg.id))
    setSelectedMessage(prev => (prev?.id === msg.id ? null : prev))
    setMsgTotal(prev => Math.max(0, prev - 1))
    toastOk('Message archived')
  }

  const handleReply = msg => {
    const originalLines = (msg.body ?? '')
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
    // Don't force tab switch — let user stay in Accounts/SMTP if they're there
  }

  // ── (FolderRow, FolderTree, MessageList are top-level components above) ──

  return (
    <div className="content flex flex-col">
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">Email / IMAP</div>
          <div className="ph-sub">
            {accounts.length} accounts · {smtpConfigs.length} SMTP
          </div>
        </div>
        <div className="ph-actions">
          <div className="flex border rounded overflow-hidden">
            <button
              onClick={() => setViewMode('inbox')}
              className="btn btn-sm border-none"
              style={{
                borderRadius: 0,
                background: viewMode === 'inbox' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'inbox' ? '#fff' : 'var(--muted)',
              }}
            >
              <Inbox size={13} /> Inbox
            </button>
            <button
              onClick={() => setViewMode('sent')}
              className="btn btn-sm border-none"
              style={{
                borderRadius: 0,
                background: viewMode === 'sent' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'sent' ? '#fff' : 'var(--muted)',
              }}
            >
              <Send size={13} /> Sent
            </button>
          </div>
          <button
            onClick={() => setShowCompose(true)}
            className="btn btn-g btn-sm"
            disabled={smtpConfigs.length === 0}
            title={smtpConfigs.length === 0 ? 'Add SMTP config first' : 'Compose'}
          >
            <PenSquare size={13} /> {t('imap_compose')}
          </button>
          <button onClick={handleCheckAll} disabled={checking} className="btn btn-b btn-sm">
            <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
            {t('imap_check_now')}
          </button>
          <button
            onClick={() => setShowAccountsPanel(true)}
            className="btn btn-ghost btn-sm"
            title="Manage accounts & SMTP"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* ── 3-column inbox view ── */}
      {viewMode === 'inbox' && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <FolderTree
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
          <MessageList
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
          />
          <MessageViewer
            message={selectedMessage}
            onReply={handleReply}
            onMarkRead={handleMarkRead}
            onDelete={handleDeleteMessage}
            onArchive={handleArchiveMessage}
          />
        </div>
      )}

      {/* ── Sent emails view ── */}
      {viewMode === 'sent' && (
        <div className="flex-1 overflow-y-auto px-1">
          <div className="flex items-center justify-between p-[8px_4px]">
            <span className="text-[12px] text-muted">
              {sentTotal} sent email{sentTotal !== 1 ? 's' : ''}
            </span>
            <button onClick={() => loadSentEmails(sentPage)} className="btn btn-ghost btn-sm">
              <RefreshCw size={13} />
            </button>
          </div>
          {loadingSent ? (
            <div className="py-10 text-center text-muted text-[13px]">Loading…</div>
          ) : sentEmails.length === 0 ? (
            <div className="py-[60px] text-center text-muted text-[13px]">No sent emails</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Sent At</th>
                </tr>
              </thead>
              <tbody>
                {sentEmails.map(e => (
                  <tr key={e.id}>
                    <td className="text-[11px] text-muted">{e.from_email ?? '—'}</td>
                    <td className="text-[12px]">{e.to_email}</td>
                    <td className="text-[12px]">{e.subject ?? '—'}</td>
                    <td>
                      <span
                        className={`st ${e.status === 'sent' ? 'st-delivered' : e.status === 'failed' ? 'st-decline' : 'st-pending'}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="text-[11px] text-muted">
                      {e.sent_at ? e.sent_at.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sentTotal > 50 && (
            <div className="flex justify-center gap-2 py-3">
              <button
                disabled={sentPage <= 1}
                onClick={() => loadSentEmails(sentPage - 1)}
                className="btn btn-ghost btn-sm"
              >
                ← Prev
              </button>
              <span className="text-[12px] text-muted leading-[28px]">
                Page {sentPage} / {Math.ceil(sentTotal / 50)}
              </span>
              <button
                disabled={sentPage >= Math.ceil(sentTotal / 50)}
                onClick={() => loadSentEmails(sentPage + 1)}
                className="btn btn-ghost btn-sm"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          className="fixed bg-card border rounded-md min-w-\[160px\] py-1 z-\[9999\]"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {[
            {
              label: 'Mark as Read',
              icon: <CheckCircle size={12} />,
              action: () => {
                handleMarkRead(contextMenu.msg)
                setContextMenu(null)
              },
            },
            {
              label: 'Archive',
              icon: <Archive size={12} />,
              action: () => {
                handleArchiveMessage(contextMenu.msg)
                setContextMenu(null)
              },
            },
            {
              label: 'Delete',
              icon: <Trash2 size={12} />,
              action: () => {
                handleDeleteMessage(contextMenu.msg)
                setContextMenu(null)
              },
            },
          ].map(({ label, icon, action }) => (
            <button
              key={label}
              onClick={action}
              className="flex items-center gap-2 w-full py-2 px-\[14px\] border-none bg-transparent cursor-pointer text-[13px] text-text text-left"
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {icon} {label}
            </button>
          ))}
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
      {showAddSmtp && <SmtpModal onSave={handleSaveSmtp} onClose={() => setShowAddSmtp(false)} />}
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
      {showAccountsPanel && (
        <AccountsPanel
          accounts={accounts}
          smtpConfigs={smtpConfigs}
          stats={stats}
          onAddImap={() => {
            setShowAccountsPanel(false)
            setShowAddImap(true)
          }}
          onEditImap={acc => setEditAccount(acc)}
          onDeleteImap={handleDelete}
          onToggleImap={handleToggle}
          onAddSmtp={() => {
            setShowAccountsPanel(false)
            setShowAddSmtp(true)
          }}
          onDeleteSmtp={handleDeleteSmtp}
          onTestSmtp={handleTestSmtp}
          onLinkAll={handleLinkAll}
          onClose={() => setShowAccountsPanel(false)}
        />
      )}
    </div>
  )
}
