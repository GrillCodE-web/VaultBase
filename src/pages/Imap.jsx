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
        className="modal"
        style={{ width: 'var(--modal-md)' }}
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
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-success)' }}>
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
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
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
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--color-info-bg)',
              border: '1px solid var(--color-info-bg)',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={setupSmtp}
                onChange={e => setSetupSmtp(e.target.checked)}
              />
              Also configure SMTP: {smtpDetected.host}:{smtpDetected.port}
            </label>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              Will use same login and app password for outgoing mail
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
        className="modal"
        style={{ width: 'var(--modal-md)' }}
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
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.use_tls}
                onChange={e => set('use_tls', e.target.checked)}
              />
              Use TLS (port 465)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.use_starttls}
                onChange={e => set('use_starttls', e.target.checked)}
              />
              STARTTLS (port 587)
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-ghost btn-sm">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSave} disabled={saving} className="btn btn-b btn-sm">
            {saving ? (
              <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
            ) : null}
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
        className="modal"
        style={{ width: 'var(--modal-lg)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="compose-modal-title" className="modal-title">
            <PenSquare size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
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
              className="form-input"
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
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
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 13,
        }}
      >
        <div style={{ textAlign: 'center', opacity: 0.5 }}>
          <Mail size={40} style={{ marginBottom: 8 }} />
          <div>Select a message to read</div>
        </div>
      </div>
    )
  }

  const isHtml = message.body?.trim().startsWith('<')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, lineHeight: 1.3 }}>
          {message.subject || '(no subject)'}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            fontSize: 12,
            color: 'var(--muted)',
          }}
        >
          <div>
            <span style={{ color: 'var(--dim)' }}>From:</span> {message.from_email}
          </div>
          {message.to_email && (
            <div>
              <span style={{ color: 'var(--dim)' }}>To:</span> {message.to_email}
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span>{message.received_at ? new Date(message.received_at).toLocaleString() : ''}</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {message.action_taken && <ActionBadge action={message.action_taken} />}
              {message.extracted_order_number && (
                <span style={{ fontSize: 11, color: 'var(--blue-t)' }}>
                  <Package size={10} style={{ display: 'inline', marginRight: 2 }} />#
                  {message.extracted_order_number}
                </span>
              )}
              {message.extracted_tracking && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {message.extracted_tracking}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
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
      <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
        {message.body ? (
          isHtml ? (
            <iframe
              srcDoc={message.body}
              sandbox="allow-same-origin"
              style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
              title="email-body"
            />
          ) : (
            <pre
              style={{
                padding: '16px',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            >
              {message.body}
            </pre>
          )
        ) : (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>No body content</div>
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
      style={{
        padding: '6px 10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        background: isActive ? 'var(--color-info-bg)' : 'transparent',
        borderRadius: 4,
        margin: '1px 4px',
      }}
    >
      <span style={{ color: 'var(--muted)', display: 'flex' }}>
        <FolderIcon name={folder} size={12} />
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {folder}
      </span>
      {unread > 0 && (
        <span
          style={{
            fontSize: 10,
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            borderRadius: 999,
            padding: '1px 5px',
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
    <div
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        background: 'var(--surface)',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>ACCOUNTS</span>
        <button
          onClick={onAddImap}
          className="btn btn-ghost btn-sm"
          title="Add IMAP account"
          style={{ padding: '2px 6px' }}
        >
          <Plus size={13} />
        </button>
      </div>
      {/* All Inboxes virtual entry */}
      {accounts.length > 1 && (
        <div
          onClick={() => onSelectFolder(ALL_INBOX, 'INBOX')}
          style={{
            padding: '8px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: selectedAccount?.id === -1 ? 'var(--color-info-bg)' : 'transparent',
            borderLeft:
              selectedAccount?.id === -1 ? '2px solid var(--blue)' : '2px solid transparent',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Inbox size={13} style={{ color: 'var(--blue)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, flex: 1, fontWeight: 600 }}>All Inboxes</span>
          {allUnread > 0 && (
            <span
              style={{
                fontSize: 10,
                background: 'var(--red)',
                color: 'var(--bg)',
                borderRadius: 999,
                padding: '1px 5px',
                flexShrink: 0,
              }}
            >
              {allUnread}
            </span>
          )}
        </div>
      )}
      {accounts.length === 0 && (
        <div
          style={{ padding: '20px 12px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}
        >
          No accounts
          <br />
          <button onClick={onAddImap} className="btn btn-g btn-sm" style={{ marginTop: 8 }}>
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
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: isSelected ? 'var(--color-info-bg)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--blue)' : '2px solid transparent',
              }}
            >
              {expanded ? (
                <ChevronDown size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              ) : (
                <ChevronRight size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              )}
              <Inbox
                size={13}
                style={{ color: acc.is_active ? 'var(--blue)' : 'var(--muted)', flexShrink: 0 }}
              />
              <span
                style={{
                  fontSize: 12,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {acc.label}
              </span>
              {unread > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    background: 'var(--red)',
                    color: 'var(--bg)',
                    borderRadius: 999,
                    padding: '1px 5px',
                    flexShrink: 0,
                  }}
                >
                  {unread}
                </span>
              )}
            </div>
            {expanded && (
              <div style={{ paddingLeft: 8 }}>
                {loadingFolders[acc.id] ? (
                  <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--muted)' }}>
                    Loading…
                  </div>
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
    <div
      style={{
        width: 300,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{selectedFolder}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{msgTotal} msgs</span>
        <button
          onClick={() =>
            selectedAccount &&
            onLoadMessages(selectedAccount.id, selectedFolder, msgPage, msgSearch)
          }
          className="btn btn-ghost btn-sm"
          style={{ padding: '2px 4px' }}
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface)',
        }}
      >
        <Search size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <input
          type="search"
          placeholder="Search messages…"
          defaultValue={msgSearch}
          ref={searchRef}
          onChange={handleSearchChange}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: 12,
            color: 'var(--text)',
            minWidth: 0,
          }}
        />
      </div>
      {loadingMsgs ? (
        <div style={{ padding: 12 }}>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{ height: 52, background: 'var(--hover)', borderRadius: 6, marginBottom: 6 }}
            />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div
          style={{ padding: '40px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}
        >
          <Mail size={30} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div>No messages in {selectedFolder}</div>
          <div style={{ fontSize: 11, marginTop: 4, color: 'var(--dim)' }}>
            Click Check Now to fetch
          </div>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          {messages.map(msg => (
            <div
              key={msg.id}
              onClick={() => onSelectMessage(msg)}
              onContextMenu={e => {
                e.preventDefault()
                onMsgContextMenu?.({ x: e.clientX, y: e.clientY, msg })
              }}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                background: selectedMessage?.id === msg.id ? 'var(--color-info-bg)' : 'transparent',
                borderLeft:
                  selectedMessage?.id === msg.id
                    ? '2px solid var(--blue)'
                    : '2px solid transparent',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: msg.is_read ? 400 : 600,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {msg.from_email?.replace(/<.*>/, '').trim() || '(unknown)'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
                  {msg.received_at ? new Date(msg.received_at).toLocaleDateString() : ''}
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: msg.is_read ? 'var(--muted)' : 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                }}
              >
                {msg.subject || '(no subject)'}
              </div>
              {(msg.action_taken || msg.extracted_order_number) && (
                <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                  {msg.action_taken && <ActionBadge action={msg.action_taken} />}
                  {msg.extracted_order_number && (
                    <span style={{ fontSize: 10, color: 'var(--blue-t)' }}>
                      #{msg.extracted_order_number}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
              <button
                disabled={msgPage <= 1}
                onClick={() =>
                  onLoadMessages(selectedAccount.id, selectedFolder, msgPage - 1, msgSearch)
                }
                className="btn btn-ghost btn-sm"
              >
                ← Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
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
        className="modal"
        style={{
          width: 'var(--modal-lg)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="imap-settings-title"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div id="imap-settings-title" style={{ display: 'flex', gap: 0 }}>
            {[
              { key: 'imap', label: 'IMAP Accounts' },
              { key: 'smtp', label: 'SMTP Configs' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
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

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {view === 'imap' && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
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
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 0',
                    color: 'var(--muted)',
                    fontSize: 13,
                  }}
                >
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
                            <div style={{ fontWeight: 500 }}>{acc.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{acc.login}</div>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
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
                                  <ToggleRight size={15} style={{ color: 'var(--accent)' }} />
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button onClick={onAddSmtp} className="btn btn-g btn-sm">
                  <Plus size={13} /> {t('imap_add_smtp_btn')}
                </button>
              </div>
              {smtpConfigs.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 0',
                    color: 'var(--muted)',
                    fontSize: 13,
                  }}
                >
                  {t('imap_no_smtp')}
                </div>
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
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {c.host}:{c.port}
                        </td>
                        <td style={{ fontSize: 11 }}>{c.login}</td>
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
  }, [selectedFolder, loadMessages, loadStats, msgSearch])

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
    <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title">Email / IMAP</div>
          <div className="ph-sub">
            {accounts.length} accounts · {smtpConfigs.length} SMTP
          </div>
        </div>
        <div className="ph-actions">
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border)',
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setViewMode('inbox')}
              className="btn btn-sm"
              style={{
                borderRadius: 0,
                background: viewMode === 'inbox' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'inbox' ? '#fff' : 'var(--muted)',
                border: 'none',
              }}
            >
              <Inbox size={13} /> Inbox
            </button>
            <button
              onClick={() => setViewMode('sent')}
              className="btn btn-sm"
              style={{
                borderRadius: 0,
                background: viewMode === 'sent' ? 'var(--blue)' : 'transparent',
                color: viewMode === 'sent' ? '#fff' : 'var(--muted)',
                border: 'none',
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
            <RefreshCw
              size={13}
              style={{ animation: checking ? 'spin 1s linear infinite' : 'none' }}
            />
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
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 4px',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {sentTotal} sent email{sentTotal !== 1 ? 's' : ''}
            </span>
            <button onClick={() => loadSentEmails(sentPage)} className="btn btn-ghost btn-sm">
              <RefreshCw size={13} />
            </button>
          </div>
          {loadingSent ? (
            <div
              style={{
                padding: '40px 0',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              Loading…
            </div>
          ) : sentEmails.length === 0 ? (
            <div
              style={{
                padding: '60px 0',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No sent emails
            </div>
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
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{e.from_email ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{e.to_email}</td>
                    <td style={{ fontSize: 12 }}>{e.subject ?? '—'}</td>
                    <td>
                      <span
                        className={`st ${e.status === 'sent' ? 'st-delivered' : e.status === 'failed' ? 'st-decline' : 'st-pending'}`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {e.sent_at ? e.sent_at.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sentTotal > 50 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '12px 0' }}>
              <button
                disabled={sentPage <= 1}
                onClick={() => loadSentEmails(sentPage - 1)}
                className="btn btn-ghost btn-sm"
              >
                ← Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: '28px' }}>
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
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 9999,
            minWidth: 160,
            padding: '4px 0',
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 14px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--text)',
                textAlign: 'left',
              }}
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
