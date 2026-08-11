import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle } from 'lucide-react'
import { useLang } from '../../hooks/useLang.jsx'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { useScrollLock } from '../../hooks/useScrollLock.js'
import { normalizeExpiry } from '../../utils/formatting.js'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

const FIELD_OPTIONS = [
  'skip',
  'card_number',
  'expiry_date',
  'cvv',
  'holder_name',
  'billing_address',
  'city',
  'state',
  'zip',
  'country',
  'phone',
  'email',
  'ip_address',
]

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 mr-1.5 border-2 border-t-text rounded-full animate-spin align-middle"
      style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'var(--text)' }}
    />
  )
}

export function ImportModal({ onClose, onImported }) {
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const modalRef = useRef(null)
  const importTimerRef = useRef(null)
  const [step, setStep] = useState(1)
  const [raw, setRaw] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [mapping, setMapping] = useState([])
  const [result, setResult] = useState(null)

  useFocusTrap(modalRef, true)

  const handlePreview = async () => {
    if (!raw.trim()) {
      toast(t('cc_import_paste_first'), 'warn')
      return
    }
    setLoading(true)
    try {
      const data = await invoke('detect_mapping_preview', { raw })
      // BUG-017: Validate non-empty preview
      if (!data || !data.preview_rows || data.preview_rows.length === 0) {
        toast(t('cc_import_no_data') || 'No parseable data found', 'warn')
        return
      }
      setPreview(data)
      setMapping([...data.detected_mapping])
      setStep(2)
    } catch (e) {
      const error = handleError(e, 'ImportModal.handlePreview')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleToMapping = () => setStep(3)

  const handleImport = async () => {
    setLoading(true)
    try {
      const expiryIdx = mapping.findIndex(m => m === 'expiry_date')
      let processedRaw = raw

      if (expiryIdx >= 0) {
        const sep = raw.includes('|') ? '|' : raw.includes(';') ? ';' : ','
        processedRaw = raw
          .split('\n')
          .map(line => {
            const cols = line.split(sep)
            if (cols[expiryIdx] !== undefined) {
              const norm = normalizeExpiry(cols[expiryIdx])
              if (norm) cols[expiryIdx] = norm
            }
            return cols.join(sep)
          })
          .join('\n')
      }

      const res = await invoke('import_cards', {
        raw: processedRaw,
        mapping,
        source: source || 'dump',
      })
      setResult(res)
      // FIX P1-13: Debounce onImported to prevent rapid refetch
      importTimerRef.current = setTimeout(() => onImported?.(), 300)
    } catch (e) {
      const error = handleError(e, 'ImportModal.handleImport')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const colCount = preview?.preview_rows?.[0]?.length ?? 0
  const expiryColIdx = preview ? mapping.findIndex(m => m === 'expiry_date') : -1

  // BUG-012: Use useScrollLock for safe ref-counted scroll locking
  useScrollLock()

  useEffect(() => {
    return () => {
      if (importTimerRef.current) {
        clearTimeout(importTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal max-w-[680px] w-full max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <span id="import-modal-title" className="modal-title m-0">
              {t('cc_import_title')}
            </span>
            <div className="flex gap-1">
              {[1, 2, 3].map(s => (
                <div
                  key={s}
                  className="w-6 h-1 rounded transition-colors duration-200"
                  style={{
                    background: s <= step ? 'var(--accent)' : 'var(--border)',
                  }}
                />
              ))}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {/* Step 1 */}
          {step === 1 && (
            <div className="flex flex-col gap-3.5">
              <p className="text-muted text-[12px] m-0">{t('cc_import_step1_hint')}</p>
              <textarea
                value={raw}
                onChange={e => setRaw(e.target.value)}
                placeholder="4111111111111111|12/26|123|JOHN SMITH|john@example.com..."
                rows={10}
                className="form-input font-mono resize-none text-[12px]"
              />
              <div className="form-group">
                <label className="form-label">{t('cc_import_source_label')}</label>
                <input
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="nike-dump-jan"
                  className="form-input"
                />
              </div>
            </div>
          )}

          {/* Step 2 — preview with expiry validation highlight */}
          {step === 2 && preview && (
            <div className="flex flex-col gap-3.5">
              <p className="text-muted text-[12px] m-0">{t('cc_import_step2_hint')}</p>
              <div className="panel p-0 overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      {preview.detected_mapping.map((field, i) => (
                        <th key={i}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 10,
                              background:
                                field !== 'skip' ? 'var(--color-success-bg)' : 'transparent',
                              color: field !== 'skip' ? 'var(--color-success)' : 'var(--muted)',
                              border:
                                field !== 'skip' ? '1px solid var(--color-success-bg)' : 'none',
                            }}
                          >
                            {field !== 'skip' ? `✓ ${field}` : `col ${i + 1}`}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => {
                          const isExp = ci === expiryColIdx
                          const norm = isExp ? normalizeExpiry(cell) : null
                          const bad = isExp && norm === null
                          return (
                            <td
                              key={ci}
                              title={
                                isExp && norm && norm !== cell ? `Normalised: ${norm}` : undefined
                              }
                              className="mono max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap"
                              style={{
                                background: bad ? 'var(--color-error-bg)' : undefined,
                                color: bad ? 'var(--color-error)' : undefined,
                              }}
                            >
                              {isExp && norm ? norm : cell}
                              {bad && (
                                <AlertTriangle
                                  size={11}
                                  title={t('cards_bad_expiry')}
                                  className="ml-1"
                                />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3 — mapping */}
          {step === 3 && preview && (
            <div className="flex flex-col gap-2.5">
              <p className="text-muted text-[12px] m-0">{t('cc_import_step3_hint')}</p>
              {Array.from({ length: colCount }).map((_, ci) => (
                <div
                  key={ci}
                  className="flex items-center gap-[10px] p-[10px_12px] bg-surface rounded-[7px] border border-border"
                >
                  <div className="w-[22px] h-[22px] rounded-[5px] bg-border flex items-center justify-center text-[11px] text-muted flex-shrink-0">
                    {ci + 1}
                  </div>
                  <div className="flex-1 font-mono text-[11px] text-muted overflow-hidden text-ellipsis whitespace-nowrap">
                    {preview.preview_rows[0]?.[ci] ?? '—'}
                  </div>
                  <select
                    value={mapping[ci] ?? 'skip'}
                    onChange={e => {
                      const m = [...mapping]
                      m[ci] = e.target.value
                      setMapping(m)
                    }}
                    className="inline-select"
                  >
                    {FIELD_OPTIONS.map(f => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {result && (
                <div
                  className="mt-2 p-[14px] rounded-md"
                  style={{
                    background: 'var(--color-success-bg)',
                    border: '1px solid var(--color-success-bg)',
                  }}
                >
                  <p className="text-green-t font-semibold text-[13px] mb-[6px]">
                    {t('cc_import_done')}
                  </p>
                  <div className="flex gap-5 text-[12px] text-muted">
                    <span>
                      ✓ {t('imported')}: <strong className="text-green-t">{result.imported}</strong>
                    </span>
                    <span>
                      ↷ {t('skipped')}: <strong className="text-yellow-t">{result.skipped}</strong>
                    </span>
                    <span>
                      ✗ {t('errors')}:{' '}
                      <strong className="text-red-t">{result.errors?.length ?? 0}</strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-[14px] border-t border-border">
          <button
            onClick={() => (step > 1 && !result ? setStep(s => s - 1) : onClose())}
            className="btn btn-ghost btn-sm"
          >
            {result ? t('btn_close') : step > 1 ? '← ' + t('btn_back') : t('btn_cancel')}
          </button>
          <div className="flex gap-2">
            {step === 1 && (
              <button
                onClick={handlePreview}
                disabled={loading || !raw.trim()}
                className="btn btn-b"
              >
                {loading && <Spinner />}
                {t('cc_import_preview')} →
              </button>
            )}
            {step === 2 && (
              <button onClick={handleToMapping} className="btn btn-b">
                {t('cc_import_mapping')} →
              </button>
            )}
            {step === 3 && !result && (
              <button onClick={handleImport} disabled={loading} className="btn btn-b">
                {loading && <Spinner />}
                {t('cc_import_do')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
