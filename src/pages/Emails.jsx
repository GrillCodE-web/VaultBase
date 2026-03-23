import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Mail, MailCheck, ShieldOff, Trash2, Plus, RefreshCw, X, Link2, Unlink } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import { SkeletonRows } from '../components/SkeletonRow.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { STATUS_COLORS } from '../constants/colors.js'
import { buildPageNumbers } from '../utils/pagination.js'

// ─── IMAP link cell ───────────────────────────────────────────
function ImapLinkCell({ entry, imapAccounts, onLink, onNavigate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const { t } = useLang()

  useEffect(() => {
    if (!open) return
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (entry.imap_account_id) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => onNavigate?.('imap')}
          title={t('email_tooltip_imap_linked')}
          className="btn btn-ghost btn-sm"
        >
          <MailCheck size={13} />
        </button>
        <button
          onClick={() => onLink(entry.id, null)}
          title={t('email_tooltip_unlink')}
          className="btn btn-ghost btn-sm"
        >
          <Unlink size={11} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={t('email_tooltip_link')}
        className="btn btn-b btn-sm"
      >
        <Link2 size={11} />
        <span>{t('imap_link_to_pool').split(' ')[0]}</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 4,
            zIndex: 40,
            minWidth: 180,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}
        >
          {imapAccounts.length === 0 ? (
            <div
              style={{
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--muted)',
                textAlign: 'center',
              }}
            >
              No IMAP accounts.{' '}
              <button
                onClick={() => {
                  setOpen(false)
                  onNavigate?.('imap')
                }}
                style={{
                  color: 'var(--accent)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {t('imap_add_account')} →
              </button>
            </div>
          ) : (
            <>
              <div
                style={{
                  padding: '6px 14px',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--muted)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                Select IMAP account
              </div>
              {imapAccounts.map(acc => (
                <button
                  key={acc.id}
                  onClick={() => {
                    onLink(entry.id, acc.id)
                    setOpen(false)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 14px',
                    fontSize: 12,
                    color: 'var(--text)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <MailCheck size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {acc.name || acc.login}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Add / Edit modal ────────────────────────────────────────
function EmailModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(
    initial
      ? { email: initial.email, label: initial.label || '', notes: initial.notes || '' }
      : { email: '', label: '', notes: '' }
  )
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const { t } = useLang()
  const isEdit = !!initial

  const valid = form.email.includes('@')

  const handleSave = async () => {
    if (!valid) return
    setLoading(true)
    try {
      await onSave(form)
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  // Scroll lock
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
        style={{ width: 'var(--modal-sm)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-modal-title"
      >
        <div className="flex items-center justify-between mb-[18px]">
          <div id="email-modal-title" className="modal-title">
            {isEdit ? t('email_modal_title_edit') : t('email_modal_title_add')}
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {[
            [t('email_field_email'), 'email', 'email', 'user@example.com'],
            [t('email_field_label'), 'text', 'label', 'Main account'],
            [t('email_field_notes'), 'text', 'notes', 'Optional notes…'],
          ].map(([label, type, key, placeholder]) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              {key === 'notes' ? (
                <textarea
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  rows={2}
                  placeholder={placeholder}
                  disabled={isEdit && key === 'email'}
                  className="form-input"
                  style={{ resize: 'none', opacity: isEdit && key === 'email' ? 0.5 : 1 }}
                />
              ) : (
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  disabled={isEdit && key === 'email'}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  className="form-input"
                  style={{ opacity: isEdit && key === 'email' ? 0.5 : 1 }}
                />
              )}
            </div>
          ))}
          <button
            onClick={handleSave}
            disabled={!valid || loading}
            className="btn btn-b"
            style={{
              width: '100%',
              opacity: !valid || loading ? 0.4 : 1,
              cursor: !valid || loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading
              ? t('email_saving')
              : isEdit
                ? t('email_save_changes')
                : t('email_modal_title_add')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── EmailShopsCell ───────────────────────────────────────────
function EmailShopsCell({ emailId }) {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    invoke('get_email_footprint_stats', { emailId })
      .then(setStats)
      .catch(() => {})
  }, [emailId])
  if (!stats) return <span className="text-muted text-[11px]">—</span>
  return (
    <div className="flex items-center gap-1">
      <span
        style={{ fontSize: 11, color: stats.unique_shops > 0 ? 'var(--text-2)' : 'var(--muted)' }}
      >
        {stats.unique_shops} shop{stats.unique_shops !== 1 ? 's' : ''}
      </span>
      {stats.is_burned && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 4,
            background: STATUS_COLORS.errorBg,
            color: STATUS_COLORS.error,
          }}
        >
          BURNED
        </span>
      )}
    </div>
  )
}

// ─── Main EmailPool ───────────────────────────────────────────
export default function EmailPool({ onNavigate, inTab = false }) {
  const [emails, setEmails] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [filterBlocked, setFilterBlocked] = useState(null) // null | true | false | "used"
  const [modal, setModal] = useState(null) // null | "add" | EmailPoolEntry
  const [imapAccounts, setImapAccounts] = useState([])
  const [selected, setSelected] = useState(new Set())
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const { t } = useLang()
  const PER_PAGE = 50

  const load = useCallback(
    async (p = page, fb = filterBlocked) => {
      setLoading(true)
      try {
        const filter = fb === 'used' ? { is_blocked: false, is_used: true } : { is_blocked: fb }
        const r = await invoke('get_emails', {
          filter,
          page: p,
          perPage: PER_PAGE,
        })
        setEmails(r.items)
        setTotal(r.total)
        if (r.items.length === 0 && r.total > 0 && p > 1) {
          setPage(prev => Math.max(1, prev - 1))
        }
      } catch (e) {
        toast(String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, filterBlocked] // toast is stable from useToast hook
  )

  useEffect(() => {
    load()
    invoke('get_imap_accounts')
      .then(setImapAccounts)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentional: only run on mount

  const handleAdd = async form => {
    await invoke('add_email', { email: form.email, label: form.label, notes: form.notes })
    toast(t('email_added'), 'success')
    load()
  }

  const handleEdit = async form => {
    await invoke('update_email', { id: modal.id, label: form.label, notes: form.notes })
    toast(t('email_updated'), 'success')
    load()
  }

  const handleBlock = async entry => {
    try {
      await invoke('block_email', { id: entry.id, blocked: !entry.is_blocked })
      toast(entry.is_blocked ? t('email_unblocked') : t('email_blocked'), 'success')
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleLink = async (emailId, imapAccountId) => {
    try {
      await invoke('link_email_to_imap', { email_id: emailId, imap_account_id: imapAccountId })
      toast(imapAccountId ? t('imap_linked') : t('email_imap_unlinked'), 'success')
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleDelete = async entry => {
    const ok = await confirm(`Delete ${entry.email}?`, { danger: true })
    if (!ok) return
    try {
      await invoke('delete_email', { id: entry.id })
      toast(t('email_deleted'), 'success')
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const cleanCount = emails.filter(e => !e.is_blocked && !e.shops_used?.length).length
  const toggleSelect = id =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleBulkBlock = async () => {
    try {
      for (const id of selected) await invoke('block_email', { id, blocked: true })
      toast(`Blocked ${selected.size} emails`, 'success')
      setSelected(new Set())
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ok = await confirm(`Delete ${selected.size} emails?`, { danger: true })
    if (!ok) return
    try {
      for (const id of selected) await invoke('delete_email', { id })
      toast(`Deleted ${selected.size} emails`, 'success')
      setSelected(new Set())
      load()
    } catch (e) {
      toast(String(e), 'error')
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  const applyFilter = v => {
    const f = v === filterBlocked ? null : v
    setFilterBlocked(f)
    setPage(1)
    load(1, f)
  }

  const statusLabel = e => {
    if (e.is_blocked) return 'blocked'
    if (e.shops_used?.length > 0) return 'used'
    return 'clean'
  }

  const usedInLabel = e => {
    if (!e.shops_used?.length) return '—'
    return e.shops_used.map(s => s.name).join(', ')
  }

  const poolBody = (
    <>
      {/* inTab header */}
      {inTab && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {cleanCount} clean / {total} total
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g btn-sm" onClick={() => setModal('add')}>
              + {t('add_email')}
            </button>
            <button className="btn btn-b btn-sm" onClick={() => load()}>
              <RefreshCw
                size={13}
                style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
              />
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="filters mb-3">
        {[
          [null, t('filter_all')],
          [false, t('filter_clean')],
          ['used', t('filter_used')],
          [true, t('filter_blocked')],
        ].map(([val, label]) => (
          <button
            key={String(val)}
            onClick={() => applyFilter(val)}
            className={`flt${filterBlocked === val ? ' active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: STATUS_COLORS.infoBg,
            border: `1px solid ${STATUS_COLORS.info}33`,
            borderRadius: 8,
            padding: '8px 14px',
            marginBottom: 10,
            fontSize: 12,
          }}
        >
          <span style={{ color: STATUS_COLORS.info, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <span style={{ color: 'var(--border)', margin: '0 4px' }}>|</span>
          <button className="btn btn-r btn-sm" onClick={handleBulkBlock}>
            <ShieldOff size={12} /> Block Selected
          </button>
          <button className="btn btn-r btn-sm" onClick={handleBulkDelete}>
            <Trash2 size={12} /> Delete Selected
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="panel p-0">
        <div className="overflow-y-auto" style={{ minHeight: 0, flex: 1 }}>
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th className="bg-card" style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={emails.length > 0 && selected.size === emails.length}
                    onChange={e =>
                      e.target.checked
                        ? setSelected(new Set(emails.map(em => em.id)))
                        : setSelected(new Set())
                    }
                  />
                </th>
                <th className="bg-card">{t('col_email')}</th>
                <th className="bg-card">{t('col_label')}</th>
                <th className="bg-card">{t('col_imap')}</th>
                <th className="bg-card">{t('col_status')}</th>
                <th className="bg-card">{t('col_used_in')}</th>
                <th className="bg-card">Shops</th>
                <th className="bg-card"></th>
              </tr>
            </thead>
            <tbody>
              {emails.length === 0 && loading && (
                <tr>
                  <td colSpan={8} className="p-0">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        <SkeletonRows count={5} cols={6} />
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
              {emails.length === 0 && !loading && (
                <EmptyState
                  colSpan={8}
                  icon={<Mail size={38} />}
                  title={t('no_emails')}
                  subtitle={t('email_empty_subtitle')}
                  action={
                    <button className="btn btn-g btn-sm" onClick={() => setModal('add')}>
                      <Plus size={12} /> {t('add_email')}
                    </button>
                  }
                />
              )}
              {emails.map(entry => (
                <tr
                  key={entry.id}
                  style={{
                    opacity: entry.is_blocked ? 0.6 : 1,
                    background: selected.has(entry.id) ? STATUS_COLORS.infoBg : undefined,
                  }}
                >
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => toggleSelect(entry.id)}
                    />
                  </td>
                  <td className="mono text-[11px]">{entry.email}</td>
                  <td className="text-muted">{entry.label || '—'}</td>
                  <td>
                    <ImapLinkCell
                      entry={entry}
                      imapAccounts={imapAccounts}
                      onLink={handleLink}
                      onNavigate={onNavigate}
                    />
                  </td>
                  <td>
                    <span className={`st st-${statusLabel(entry)}`}>{statusLabel(entry)}</span>
                  </td>
                  <td className="text-[11px] text-muted">{usedInLabel(entry)}</td>
                  <td>
                    <EmailShopsCell emailId={entry.id} />
                  </td>
                  <td>
                    <div className="tbl-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal(entry)}>
                        {t('btn_edit')}
                      </button>
                      <button
                        className={`btn btn-sm ${entry.is_blocked ? 'btn-g' : 'btn-r'}`}
                        onClick={() => handleBlock(entry)}
                      >
                        {entry.is_blocked ? t('btn_unblock') : t('btn_block')}
                      </button>
                      <button className="btn btn-r btn-sm" onClick={() => handleDelete(entry)}>
                        {t('btn_delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] text-muted">{total} emails</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map(p =>
              p === '…' ? (
                <span key={`ellipsis-${p}`} className="px-2 text-muted">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => {
                    setPage(p)
                    load(p, filterBlocked)
                  }}
                  className={`btn btn-sm ${page === p ? 'btn-b' : 'btn-ghost'}`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal === 'add' && <EmailModal onSave={handleAdd} onClose={() => setModal(null)} />}
      {modal && modal !== 'add' && (
        <EmailModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </>
  )

  if (inTab) {
    return (
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {poolBody}
      </div>
    )
  }

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">{t('email_pool')}</div>
          <div className="ph-sub">
            {cleanCount} {t('email_clean_subtitle')} / {total} {t('mailboxes_count')}
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn btn-g" onClick={() => setModal('add')}>
            + {t('add_email')}
          </button>
          <button className="btn btn-b btn-sm" onClick={() => load()}>
            <RefreshCw
              size={13}
              style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}
            />
            {t('btn_refresh')}
          </button>
        </div>
      </div>
      {poolBody}
    </div>
  )
}
