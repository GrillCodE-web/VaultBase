import { useState, useEffect, useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { invoke } from '@tauri-apps/api/core'
import { User, MapPin, Check, X, Shuffle } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { useToast } from '../../hooks/useToast'
import { HEX_COLORS } from '../../constants/colors.js'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

export function ProfileModal({ onCreated, onClose }) {
  const { t } = useLang()
  const [mode, setMode] = useState('quick') // "quick" | "full"
  const [cardId, setCardId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [freeCards, setFreeCards] = useState([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [templates, setTemplates] = useState([])
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [autoCreateDrop, setAutoCreateDrop] = useState(true)
  const { toast, error: toastErr } = useToast()

  // ── Email auto-assignment state ──────────
  const [emailInput, setEmailInput] = useState('')
  const [emailId, setEmailId] = useState(null)
  const [availableEmails, setAvailableEmails] = useState([])
  const [emailLoading, setEmailLoading] = useState(false)

  // ── Card billing preview state ────────────
  const [cardBillingPreview, setCardBillingPreview] = useState(null)

  const handleDeleteTemplate = async id => {
    try {
      await invoke('delete_profile_template', { id })
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (e) {
      const error = handleError(e, 'ProfileModal.handleDeleteTemplate')
      toastErr(getErrorMessage(error))
    }
  }

  useEffect(() => {
    setCardsLoading(true)
    invoke('get_cards', {
      filter: {
        status: 'free',
        search: null,
        country: null,
        bank_name: null,
        source: null,
        date_from: null,
        date_to: null,
      },
      page: 1,
      perPage: 200,
    })
      .then(r => setFreeCards(r.items || []))
      .catch(() => setFreeCards([]))
      .finally(() => setCardsLoading(false))
    invoke('get_profile_templates')
      .then(setTemplates)
      .catch(() => {})
    // Load available emails for the datalist
    invoke('get_available_emails', { limit: 50 })
      .then(emails => {
        setAvailableEmails(emails)
      })
      .catch(() => {})
  }, [])

  const filtered = freeCards.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      c.last4?.includes(q) ||
      c.bin?.includes(q) ||
      c.holder_name?.toLowerCase().includes(q) ||
      c.bank_name?.toLowerCase().includes(q)
    )
  })

  // Handle card selection — show billing preview from unencrypted fields
  const handleCardSelect = c => {
    setCardId(String(c.id))
    // Build preview from non-encrypted card fields available in Card struct
    const parts = [c.city, c.state, c.zip, c.country].filter(Boolean)
    setCardBillingPreview(parts.length > 0 ? parts.join(', ') : null)
  }

  // Auto-assign a free email
  const handleAutoAssignEmail = async () => {
    setEmailLoading(true)
    try {
      const free = await invoke('get_free_email_for_shop', { shopId: null })
      if (free) {
        setEmailInput(free.email)
        setEmailId(free.id)
        toast('Email auto-assigned', 'success')
      } else {
        toast('No free emails available', 'warn')
      }
    } catch (e) {
      const error = handleError(e, 'ProfileModal.handleAutoEmail')
      toast(getErrorMessage(error), 'error')
    } finally {
      setEmailLoading(false)
    }
  }

  const handleCreate = async () => {
    const id = parseInt(cardId, 10)
    if (!id) {
      toast('Select a free card', 'warn')
      return
    }
    setLoading(true)
    try {
      const p = await invoke('create_profile', {
        cardId: id,
        notes: mode === 'quick' ? null : notes || null,
      })
      // Quick mode: auto-create drop from card billing (reveal encrypted fields)
      if (mode === 'quick' && autoCreateDrop) {
        try {
          const card = await invoke('reveal_card', { id })
          if (card.billing_address || card.city) {
            await invoke('add_drop', {
              profileId: p.id,
              drop: {
                recipient_name: card.holder_name || '',
                address: card.billing_address || '',
                city: card.city || '',
                state: card.state || '',
                zip: card.zip || '',
                country: card.country || '',
                phone: card.phone || '',
              },
            })
          }
        } catch {
          /* billing reveal failed — profile still created */
        }
      }
      if (saveAsTemplate && templateName.trim()) {
        const card = freeCards.find(c => String(c.id) === cardId)
        await invoke('save_profile_template', {
          name: templateName.trim(),
          country: card?.country || null,
          state: null,
          city: null,
          phonePrefix: null,
          source: null,
        }).catch(() => {})
      }
      // Assign email to profile if one was selected/auto-assigned
      if (emailId) {
        try {
          await invoke('set_profile_email', { profileId: p.id, emailPoolId: emailId })
        } catch {
          /* email linking failed — profile still created */
        }
      }
      toast('Profile created', 'success')
      onCreated(p)
      onClose()
    } catch (e) {
      const error = handleError(e, 'ProfileModal.handleSave')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const createProfRef = useRef(null)
  useFocusTrap(createProfRef, true)
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
        ref={createProfRef}
        className="modal w-[480px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-profile-title"
      >
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <User size={16} className="text-blue-t" />
            <span id="create-profile-title" className="modal-title m-0">
              {t('new_profile')}
            </span>
            <div className="mode-toggle-group">
              {['quick', 'full'].map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="mode-toggle-btn"
                  style={{
                    background: mode === m ? 'var(--accent)' : 'transparent',
                    color: mode === m ? HEX_COLORS.white : 'var(--muted)',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          <div className="form-group">
            <div className="flex items-center justify-between mb-1.5">
              <label className="form-label m-0">Free Card *</label>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Auto-select first free card"
                onClick={() => {
                  if (filtered.length > 0) handleCardSelect(filtered[0])
                }}
              >
                <Shuffle size={12} /> Auto
              </button>
            </div>
            <input
              className="form-input mb-2"
              placeholder={t('profiles_search_placeholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="card-selection-list">
              {cardsLoading ? (
                <div className="p-4 text-center text-muted text-[12px]">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-muted text-[12px]">{t('no_free_cards')}</div>
              ) : (
                filtered.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleCardSelect(c)}
                    className="card-selection-item"
                    style={{
                      background: cardId === String(c.id) ? 'var(--color-info-bg)' : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (cardId !== String(c.id)) e.currentTarget.style.background = 'var(--hover)'
                    }}
                    onMouseLeave={e => {
                      if (cardId !== String(c.id)) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {c.card_type && (
                        <span className="text-[10px] text-muted uppercase font-semibold">
                          {c.card_type}
                        </span>
                      )}
                      <span className="font-mono text-[12px] text-text">
                        ●●●● {c.last4 || '????'}
                      </span>
                      {c.expiry_date && (
                        <span className="text-[11px] text-muted">{c.expiry_date}</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {c.bank_name && <span className="text-[11px] text-muted">{c.bank_name}</span>}
                      {c.country && (
                        <span className="text-[10px] font-mono text-muted">{c.country}</span>
                      )}
                      {cardId === String(c.id) && <Check size={13} className="text-blue-t" />}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          {/* Card billing preview */}
          {cardId && cardBillingPreview && (
            <div className="billing-preview-box">
              <MapPin size={11} className="icon-no-shrink" />
              <span>{cardBillingPreview}</span>
            </div>
          )}

          {/* Email assignment */}
          <div className="form-group mb-0">
            <label className="form-label mb-1">Email (optional)</label>
            <div className="input-with-button">
              <input
                className="form-input"
                list="email-suggestions"
                placeholder="Email address…"
                value={emailInput}
                onChange={e => {
                  setEmailInput(e.target.value)
                  // If user picks from datalist, find matching id
                  const match = availableEmails.find(em => em.email === e.target.value)
                  setEmailId(match ? match.id : null)
                }}
              />
              <button
                className="btn btn-ghost btn-sm text-sm"
                type="button"
                title="Auto-assign free email"
                disabled={emailLoading}
                onClick={handleAutoAssignEmail}
              >
                🎲
              </button>
            </div>
            <datalist id="email-suggestions">
              {availableEmails.map(e => (
                <option key={e.id} value={e.email} />
              ))}
            </datalist>
          </div>

          {mode === 'quick' ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoCreateDrop}
                onChange={e => setAutoCreateDrop(e.target.checked)}
              />
              <span>Auto-create drop from billing address</span>
              <span className="helper-text">(faster setup)</span>
            </label>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">{t('cc_col_notes')}</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder={t('cc_col_notes') + '…'}
                  className="form-input resize-none"
                />
              </div>
              {templates.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Templates</label>
                  <div className="template-list">
                    {templates.map(tpl => (
                      <div key={tpl.id} className="template-item">
                        <button
                          type="button"
                          className="template-apply-btn"
                          onClick={() => {
                            if (tpl.source) setNotes(n => (n ? n : `Source: ${tpl.source}`))
                          }}
                          title="Apply template"
                        >
                          {tpl.name}
                          {tpl.country ? ` · ${tpl.country}` : ''}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm template-delete-btn"
                          onClick={() => handleDeleteTemplate(tpl.id)}
                          title="Delete template"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={e => setSaveAsTemplate(e.target.checked)}
                />
                Save as template
                {saveAsTemplate && (
                  <input
                    className="form-input inline-input-sm ml-2"
                    placeholder="Template name…"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                  />
                )}
              </label>
            </>
          )}
          <button
            onClick={handleCreate}
            disabled={loading || !cardId}
            className="btn btn-b btn-full-width"
            style={{ opacity: loading || !cardId ? 0.4 : 1 }}
          >
            {loading ? t('msg_loading') : t('new_profile')}
          </button>
        </div>
      </div>
    </div>
  )
}
