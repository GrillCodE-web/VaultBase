import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang.jsx'
import {
  fmtDateTime,
  getWorkerSnapshots,
  vaultBurn,
  vaultExport,
  vaultExportLog,
  vaultImport,
  vaultIssue,
  vaultList,
  vaultRecall,
  vaultStats,
  vaultSyncIssueStatus,
} from '../api/server.js'

const POOLS = ['pool', 'on_worker', 'declined', 'burned', 'exported']
const TAG = { pool: 'green', on_worker: 'accent', declined: 'amber', burned: 'red', exported: 'gray' }

function lostCount(stats) {
  return (stats.lost_by_worker || []).reduce((acc, w) => acc + (w.cards || 0), 0)
}

export default function Cards() {
  const { t } = useLang()
  const [stats, setStats] = useState(null)
  const [cards, setCards] = useState(null)
  const [pool, setPool] = useState('all')
  const [query] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [modal, setModal] = useState(null) // 'import' | 'issue' | 'export'
  const [importText, setImportText] = useState('')
  const [importReport, setImportReport] = useState(null)
  const [workers, setWorkers] = useState([])
  const [issueTarget, setIssueTarget] = useState('')
  const [exportPath, setExportPath] = useState('')
  const [exportPass, setExportPass] = useState('')
  const [notice, setNotice] = useState('')
  const [journal, setJournal] = useState(null)

  const load = () => {
    vaultStats().then(setStats).catch(() => {})
    vaultList(pool === 'all' ? null : pool, query, 300)
      .then((r) => setCards(r.cards || []))
      .catch(() => setCards([]))
    vaultExportLog().then((r) => setJournal(r.exports || [])).catch(() => setJournal([]))
  }

  useEffect(() => {
    load()
    getWorkerSnapshots()
      .then((r) => setWorkers((r.workers || []).filter((w) => w.is_active && w.role !== 'manager')))
      .catch(() => setWorkers([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  const selectedIds = [...selected]
  const allChecked = Array.isArray(cards) && cards.length > 0 && selected.size === cards.length
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(cards.map((c) => c.id)))
  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = async (promise, okKey) => {
    try {
      const r = await promise
      const n = r?.recalled ?? r?.burned ?? r?.issued ?? r?.exported ?? ''
      setNotice(okKey ? t(okKey, { n }) : String(r ?? ''))
      setSelected(new Set())
      setModal(null)
      load()
      return r
    } catch (e) {
      setNotice(String(e))
      return null
    }
  }

  const doImport = async () => {
    try {
      const r = await vaultImport(importText)
      setImportReport(r)
      setSelected(new Set())
      load()
    } catch (e) {
      setNotice(String(e))
    }
  }

  const doIssue = async () => {
    if (!issueTarget || selected.size === 0) return
    try {
      const r = await vaultIssue(issueTarget, [...selected])
      setNotice(t('vault_issue_ok', { n: r.issued }))
      setModal(null)
      setSelected(new Set())
      setPool('on_worker')
      load()
    } catch (e) {
      setNotice(String(e))
    }
  }

  const doExport = async () => {
    if (!exportPath || exportPass.length < 8) {
      setNotice(t('vault_export_err_pw'))
      return
    }
    try {
      const r = await vaultExport([...selected], exportPath, exportPass, true)
      setNotice(t('vault_export_done', { n: r.exported, path: r.path }))
      setSelected(new Set())
      setModal(null)
      setPool('exported')
      load()
    } catch (e) {
      setNotice(String(e))
    }
  }

  const syncStatuses = async () => {
    try {
      const r = await vaultSyncIssueStatus()
      setNotice(t('vault_sync_done', { n: r.updated }))
      load()
    } catch (e) {
      setNotice(String(e))
    }
  }

  if (stats === null) return <div className="empty">{t('loading')}</div>

  const bs = stats.by_status || {}
  const occupied = stats.occupied_by_worker || []

  return (
    <div>
      <div className="grid-cards">
        <div className="stat-card">
          <div className="value">{stats.total}</div>
          <div className="label">{t('vault_total')}</div>
        </div>
        <div className="stat-card">
          <div className="value">{bs.pool ?? 0}</div>
          <div className="label">{t('vault_pool')}</div>
        </div>
        <div className="stat-card">
          <div className="value">{bs.on_worker ?? 0}</div>
          <div className="label">{t('vault_on_worker')}</div>
          <div className="hint">{t('vault_occupied')}: {occupied.length}</div>
        </div>
        <div className="stat-card">
          <div className="value">{bs.declined ?? 0}</div>
          <div className="label">{t('vault_declined')}</div>
          <div className="hint">{t('vault_decline_total')}: {stats.decline_total ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="value">{bs.burned ?? 0}</div>
          <div className="label">{t('vault_burned')}</div>
        </div>
        <div className="stat-card">
          <div className="value">{lostCount(stats)}</div>
          <div className="label">{t('vault_lost')}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {POOLS.map((p) => (
            <button
              key={p}
              className={pool === p ? 'active' : ''}
              onClick={() => { setPool(p); setSelected(new Set()) }}
            >
              {t(`vault_tab_${p}`)}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn small" onClick={syncStatuses}>{t('vault_sync_status')}</button>
        <button className="btn" onClick={() => { setModal('import'); setImportReport(null) }}>
          {t('vault_import_btn')}
        </button>
      </div>

      {notice && <div className="meta">{notice}</div>}

      <div className="panel">
        <div className="toolbar">
          <span>{t('vault_selected')}: {selected.size}</span>
          <div className="grow" />
          <button
            className="btn small"
            disabled={selected.size === 0}
            onClick={() => setModal('issue')}
          >
            {t('vault_issue_btn')}
          </button>
          <button className="btn small" disabled={selected.size === 0} onClick={() => run(vaultRecall(selectedIds, 'pool'), 'vault_recalled')}>
            {t('vault_recall_to_pool')}
          </button>
          <button className="btn small" disabled={selected.size === 0} onClick={() => run(vaultRecall(selectedIds, 'declined'), 'vault_recalled')}>
            {t('vault_recall_to_pool2')}
          </button>
          <button className="btn small danger" disabled={selected.size === 0} onClick={() => { vaultBurn(selectedIds).then(load).catch((e) => setNotice(String(e))) }}>
            {t('vault_burn_btn')}
          </button>
          <button className="btn small" disabled={selected.size === 0} onClick={() => setModal('export')}>
            {t('vault_export_btn')}
          </button>
        </div>
        {cards === null || cards.length === 0 ? (
          <div className="empty">{t('vault_empty')}</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th><input type="checkbox" checked={selected.size === cards.length && selected.size > 0} onChange={toggleAll} /></th>
                <th>{t('vault_col_pan')}</th>
                <th>{t('vault_col_bin')}</th>
                <th>{t('col_status')}</th>
                <th>{t('vault_col_worker')}</th>
                <th>{t('vault_col_issued')}</th>
                <th>{t('vault_col_declines')}</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                  <td className="mono">{c.pan_masked}</td>
                  <td>{c.bin}</td>
                  <td><span className={`tag ${TAG[c.status] || 'gray'}`}>{t(`vault_tab_${c.status}`)}</span></td>
                  <td className="mono">{c.assigned_iid || '—'}</td>
                  <td>{fmtDateTime(c.issued_at)}</td>
                  <td>{c.decline_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>{t('vault_export_log')}</h3>
        {journal && journal.length > 0 ? (
          <table className="data">
            <thead>
              <tr>
                <th>{t('col_time')}</th>
                <th>{t('vault_col_cards')}</th>
                <th>File</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {journal.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDateTime(e.created_at)}</td>
                  <td>{e.cards_count}</td>
                  <td className="mono">{e.file_path}</td>
                  <td className="mono">{String(e.file_sha256).slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">{t('vault_empty')}</div>
        )}
      </div>

      {modal === 'import' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('vault_import_title')}</h3>
            <p className="meta">{t('vault_import_hint')}</p>
            <textarea rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} className="mono" />
            {importReport && (
              <div>
                <p>{t('vault_imported')}: {importReport.added}</p>
                <p>{t('vault_dups')}: {importReport.duplicates.length}</p>
                <p>{t('vault_import_invalid')}: {importReport.invalid.length}</p>
              </div>
            )}
            <div className="toolbar">
              <button className="btn" onClick={doImport}>{t('vault_import_run')}</button>
              <button className="btn small" onClick={() => setModal(null)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'issue' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('vault_issue_title')}</h3>
            <p>{t('vault_issue_count')}: {selected.size}</p>
            <select value={issueTarget} onChange={(e) => setIssueTarget(e.target.value)}>
              <option value="">— {t('vault_issue_pick')} —</option>
              {workers.map((w) => (
                <option key={w.installation_id} value={w.installation_id}>
                  {w.label || w.installation_id}
                </option>
              ))}
            </select>
            <div className="toolbar">
              <button className="btn" onClick={doIssue} disabled={!issueTarget || selected.size === 0}>
                {t('vault_issue_do')}
              </button>
              <button className="btn small" onClick={() => setModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'export' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('vault_export_title')}</h3>
            <p className="meta">{t('vault_export_warn')}</p>
            <input
              className="wide"
              placeholder="vaultbase-export-20260830.vbex"
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
            />
            <input
              type="password"
              placeholder={t('vault_export_pass')}
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
            />
            <div className="toolbar">
              <button className="btn" onClick={doExport} disabled={selected.size === 0}>
                {t('vault_export_btn')} ({selected.size})
              </button>
              <button className="btn small" onClick={() => setModal(null)}>{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
