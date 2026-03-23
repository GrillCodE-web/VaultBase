import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X, Upload } from 'lucide-react'
import { useToast } from '../../hooks/useToast'
import { STATUS_COLORS } from '../../constants/colors'
import { handleError, getErrorMessage } from '../../utils/errorHandler.js'

export function BatchImportModal({ onCreated, onClose }) {
  const [parsedRows, setParsedRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const modalRef = useRef(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const handleFile = e => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target.result
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
      // Skip header row if it starts with "profile_id"
      const dataLines = lines[0]?.toLowerCase().startsWith('profile_id') ? lines.slice(1) : lines
      const rows = dataLines
        .map(line => {
          const parts = line.split(',')
          return {
            profile_id: (parts[0] || '').trim(),
            shop_id: parseInt((parts[1] || '0').trim(), 10) || 0,
            item_name: (parts[2] || '').trim(),
            item_sku: (parts[3] || '').trim(),
            amount: (parts[4] || '0').trim(),
          }
        })
        .filter(r => r.profile_id && r.shop_id)
      setParsedRows(rows)
    }
    reader.readAsText(file)
  }

  const handleCreate = async () => {
    if (parsedRows.length === 0) return
    setLoading(true)
    try {
      const res = await invoke('batch_create_orders', { orders: parsedRows })
      setResult(res)
      onCreated()
    } catch (e) {
      const error = handleError(e, 'BatchImportModal.handleCreate')
      toast(getErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div
        ref={modalRef}
        className="modal w-[var(--modal-sm)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-import-title"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Upload size={15} className="text-blue-t" />
            <span className="modal-title m-0">Batch Import Orders</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!result ? (
          <div className="flex flex-col gap-4">
            <div className="bg-surface border border-border rounded-lg p-[10px_14px] text-[11px] text-muted mono">
              <div className="font-semibold mb-1 text-text-2">CSV format:</div>
              <div>profile_id,shop_id,item_name,item_sku,amount</div>
            </div>

            <div>
              <label className="form-label">Select CSV file</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="form-input p-[7px_12px] text-[12px] cursor-pointer"
              />
            </div>

            {parsedRows.length > 0 && (
              <div
                style={{
                  background: STATUS_COLORS.infoBg,
                  border: `1px solid ${STATUS_COLORS.info}33`,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 12,
                }}
              >
                <span style={{ color: STATUS_COLORS.info, fontWeight: 600 }}>
                  {parsedRows.length}
                </span>
                <span style={{ color: 'var(--text-2)', marginLeft: 6 }}>
                  valid row{parsedRows.length !== 1 ? 's' : ''} parsed from {fileName}
                </span>
              </div>
            )}

            <div className="flex gap-2 mt-1">
              <button onClick={onClose} className="btn btn-ghost btn-sm flex-1">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || parsedRows.length === 0}
                className="btn btn-b btn-sm flex-1 disabled:opacity-40"
              >
                {loading ? 'Creating…' : `Create ${parsedRows.length} Orders`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div
                style={{
                  background: STATUS_COLORS.successBg,
                  border: `1px solid ${STATUS_COLORS.success}33`,
                  borderRadius: 10,
                  padding: 16,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 28, fontWeight: 700, color: STATUS_COLORS.success }}>
                  {result.created}
                </div>
                <div className="text-[11px] text-muted mt-1">Created</div>
              </div>
              <div
                style={{
                  background: STATUS_COLORS.errorBg,
                  border: `1px solid ${STATUS_COLORS.error}33`,
                  borderRadius: 10,
                  padding: 16,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 28, fontWeight: 700, color: STATUS_COLORS.error }}>
                  {result.failed}
                </div>
                <div className="text-[11px] text-muted mt-1">Failed</div>
              </div>
            </div>
            <button onClick={onClose} className="btn btn-g w-full">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
