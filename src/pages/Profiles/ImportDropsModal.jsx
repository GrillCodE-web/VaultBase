import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Import, X } from 'lucide-react'
import { useLang } from '../../hooks/useLang'
import { usePremiumToast } from '../../hooks/usePremiumToast'
import { useFocusTrap } from '../../hooks/useFocusTrap.js'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

export function ImportDropsModal({ profileId, onDone, onClose }) {
  const [step, setStep] = useState(1)
  const [raw, setRaw] = useState('')
  const [mapping, setMapping] = useState([])
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const { toast } = usePremiumToast()
  const { t } = useLang()

  const DROP_COLUMNS = [
    'recipient_name',
    'address',
    'city',
    'state',
    'zip',
    'country',
    'phone',
    'skip',
  ]

  const handlePreview = async () => {
    if (!raw.trim()) return
    setLoading(true)
    try {
      const p = await invoke('detect_mapping_preview', { raw })
      const cols = p.detected_mapping || []
      const remapped = cols.map(c => (DROP_COLUMNS.includes(c) ? c : 'skip'))
      setMapping(remapped)
      setPreview(p)
      setStep(2)
    } catch (e) {
      const error = handleError(e, 'Profiles.handlePreview')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    setLoading(true)
    try {
      const r = await invoke('import_drops', { profileId, raw, mapping })
      setResult(r)
      setStep(3)
    } catch (e) {
      const error = handleError(e, 'Profiles.handleImport')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const dropFormRef = useRef(null)
  useFocusTrap(dropFormRef, true)
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
        ref={dropFormRef}
        className="modal w-[680px] max-h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-drops-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Import size={18} className="text-blue-t" />
            <span id="import-drops-title" className="modal-title m-0">
              {t('import_drops_title')}
            </span>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className="w-6 h-1.5 rounded-[3px] transition-bg"
                style={{
                  background: step >= s ? 'var(--blue)' : 'var(--border)',
                }}
              />
            ))}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-muted m-0">
                Paste raw drop data below. Supported delimiters:{' '}
                <code className="text-blue-t text-[11px] font-mono">| , ; TAB</code>
              </p>
              <textarea
                value={raw}
                onChange={e => setRaw(e.target.value)}
                rows={12}
                placeholder="John Doe | 123 Main St | New York | NY | 10001 | US | +1-555-0100"
                className="w-full box-border bg-surface border rounded-md p-\[12px_16px\] text-[13px] text-text mono outline-none resize-none"
              />
              <button
                onClick={handlePreview}
                disabled={!raw.trim() || loading}
                className="btn btn-b w-full"
                style={{ opacity: !raw.trim() || loading ? 0.4 : 1 }}
              >
                {loading ? t('drops_detecting') : t('drops_detect_btn')}
              </button>
            </div>
          )}

          {step === 2 && preview && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-muted m-0">
                Map columns to drop fields. First row shown as example.
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="tbl">
                  <thead>
                    <tr>
                      {mapping.map((_, i) => (
                        <th key={i} className="font-normal">
                          <select
                            value={mapping[i]}
                            onChange={e => {
                              const m = [...mapping]
                              m[i] = e.target.value
                              setMapping(m)
                            }}
                            className="bg-surface border text-text rounded py-\[5px\] px-\[10px\] text-[12px] outline-none"
                          >
                            {DROP_COLUMNS.map(c => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.slice(0, 5).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className={
                              mapping[ci] === 'skip' ? 'mono preview-cell-skipped' : 'mono'
                            }
                          >
                            {cell || <span className="text-muted">вЂ”</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn btn-ghost">
                  в†ђ {t('btn_cancel')}
                </button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="btn btn-b flex-1"
                  style={{ opacity: loading ? 0.4 : 1 }}
                >
                  {loading
                    ? t('drops_importing')
                    : t('drops_import_rows').replace('{n}', preview.preview_rows.length)}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--color-success-bg)] border-[var(--color-success-bg)] rounded-[10px] p-4 text-center">
                  <div className="text-[32px] font-bold text-green-t">{result.imported}</div>
                  <div className="text-[12px] text-muted mt-1">{t('cc_import_done')}</div>
                </div>
                <div className="bg-warning-yellow border-warning-yellow rounded-[10px] p-4 text-center">
                  <div className="text-[32px] font-bold text-yellow-t">{result.skipped}</div>
                  <div className="text-[12px] text-muted mt-1">{t('profiles_skipped')}</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="bg-surface rounded-[10px] border p-3 max-h-[160px] overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-[12px] text-red-t font-mono py-[2px]">
                      {e}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  onDone()
                  onClose()
                }}
                className="btn btn-g w-full"
              >
                {t('proxy_import_done')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
