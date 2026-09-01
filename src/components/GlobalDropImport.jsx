// REDESIGN-05-6: глобальный D&D импорт — бросил файл в окно → превью → импорт.
// Цели: прокси (нужно право manage_proxies) и дропы (нужен профиль). Ручной
// импорт КАРТ выпилен MGR-018 — карты приходят срезами менеджера, поэтому
// карточной цели здесь нет. dragDropEnabled:false в tauri.conf.json — события
// доходят до веб-вида как обычные HTML5 drag&drop.
import { lazy, Suspense, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { FileUp } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth.jsx'
import { usePremiumToast } from '../hooks/usePremiumToast'
import { handleError } from '../utils/errorHandler.js'
import { detectImportKind, splitLines } from '../utils/dropDetect.js'
import { Modal } from './Modal.jsx'

// Доменные модалки лениво — не раздуваем корневой чанк.
const ImportDropsModal = lazy(() =>
  import('../pages/Profiles/ImportDropsModal.jsx').then(m => ({ default: m.ImportDropsModal }))
)
const ProxyImportModal = lazy(() =>
  import('../pages/Proxies.jsx').then(m => ({ default: m.ImportModal }))
)

const MAX_FILE_BYTES = 5 * 1024 * 1024

export function GlobalDropImport() {
  const { currentUser, hasPerm } = useAuth()
  const { t } = useLang()
  const { toast } = usePremiumToast()
  const [dragActive, setDragActive] = useState(false)
  const [pending, setPending] = useState(null) // { name, text }
  const [target, setTarget] = useState('drops')
  const [profiles, setProfiles] = useState(null)
  const [profileId, setProfileId] = useState('')
  const [stage, setStage] = useState('choose') // choose | drops | proxies

  const canProxies = hasPerm('manage_proxies')

  useEffect(() => {
    if (!currentUser) return undefined
    let depth = 0
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files')

    const handleFile = async file => {
      if (file.size > MAX_FILE_BYTES) {
        toast(t('drop_too_big'), 'error')
        return
      }
      try {
        const text = await file.text()
        const kind = detectImportKind(text)
        if (!kind) {
          toast(t('drop_unknown'), 'info')
          return
        }
        if (kind === 'proxies' && !hasPerm('manage_proxies')) {
          toast(t('drop_no_perm_proxies'), 'error')
          return
        }
        setPending({ name: file.name || 'file', text })
        setTarget(kind === 'proxies' ? 'proxies' : 'drops')
        setStage('choose')
        setProfiles(prev => {
          if (prev) return prev
          invoke('get_profiles', { filter: {}, page: 1, perPage: 200 })
            .then(r => {
              setProfiles(r.items || [])
              setProfileId(r.items?.[0]?.id || '')
            })
            .catch(e => handleError(e, 'GlobalDropImport.loadProfiles'))
          return prev
        })
      } catch (e) {
        handleError(e, 'GlobalDropImport.handleFile')
        toast(t('drop_read_fail'), 'error')
      }
    }

    const onDragEnter = e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth += 1
      setDragActive(true)
    }
    // preventDefault на dragover обязателен — иначе drop не сработает
    const onDragOver = e => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDragLeave = e => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = e => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragActive(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) void handleFile(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
    // hasPerm стабилен в рамках сессии; слушатели перевешиваем на смену юзера
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  if (!currentUser) return null

  const reset = () => {
    setStage('choose')
    setPending(null)
  }

  const lines = pending ? splitLines(pending.text) : []
  const dropsReady = (profiles?.length ?? 0) > 0

  return (
    <>
      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">
            <FileUp size={40} className="text-accent" />
            <div className="drop-overlay-text">{t('drop_overlay_hint')}</div>
          </div>
        </div>
      )}

      {stage === 'choose' && pending && (
        <Modal isOpen onClose={reset} size="560px" title={t('drop_title')}>
          <div className="flex flex-col gap-3.5">
            <div className="text-13 text-muted">
              {pending.name} · {t('drop_lines', { n: lines.length })}
            </div>
            <div className="bg-surface border rounded-md p-2.5 mono text-11 max-h-[140px] overflow-y-auto">
              {lines.slice(0, 5).map((l, i) => (
                <div key={i} className="py-[1px] whitespace-nowrap overflow-hidden text-ellipsis">
                  {l}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-12 text-muted">{t('drop_target_label')}</label>
              <select
                className="form-input"
                value={target}
                onChange={e => setTarget(e.target.value)}
              >
                <option value="drops">{t('drop_target_drops')}</option>
                {canProxies && <option value="proxies">{t('drop_target_proxies')}</option>}
              </select>
            </div>
            {target === 'drops' &&
              (dropsReady ? (
                <div className="flex flex-col gap-2">
                  <label className="text-12 text-muted">{t('drop_profile_label')}</label>
                  <select
                    className="form-input"
                    value={profileId}
                    onChange={e => setProfileId(e.target.value)}
                  >
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="text-12 text-yellow-t">{t('drop_no_profiles')}</div>
              ))}
            <div className="flex gap-3">
              <button onClick={reset} className="btn btn-ghost">
                {t('btn_cancel')}
              </button>
              <button
                onClick={() => setStage(target)}
                disabled={target === 'drops' && (!dropsReady || !profileId)}
                className="btn btn-b flex-1"
              >
                {t('drop_continue')} →
              </button>
            </div>
          </div>
        </Modal>
      )}

      {stage === 'drops' && pending && profileId && (
        <Suspense fallback={null}>
          <ImportDropsModal
            profileId={profileId}
            initialRaw={pending.text}
            onDone={reset}
            onClose={reset}
          />
        </Suspense>
      )}
      {stage === 'proxies' && pending && (
        <Suspense fallback={null}>
          <ProxyImportModal initialRaw={pending.text} onDone={reset} onClose={reset} />
        </Suspense>
      )}
    </>
  )
}
