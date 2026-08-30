import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useLang } from '../hooks/useLang'
import { useTasksStore } from '../store/tasks.js'

/**
 * REDESIGN-05-4 (порция 3): глобальный индикатор фоновых задач в статус-баре.
 * Показывает число активных задач; клик — список с прогрессом и отменой.
 */
export function TasksIndicator() {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const tasks = useTasksStore(s => s.tasks)
  const cancel = useTasksStore(s => s.cancel)
  const wrapRef = useRef(null)
  const running = tasks.filter(tk => tk.status === 'running').length

  useEffect(() => {
    if (!open) return
    const onDocClick = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = e => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  if (tasks.length === 0) return null

  return (
    <div className="tasks-wrap" ref={wrapRef}>
      <button
        className="tasks-pill"
        onClick={() => setOpen(v => !v)}
        title={t('tasks_indicator')}
        aria-label={t('tasks_indicator')}
        aria-expanded={open}
      >
        <Loader2 size={11} className={running > 0 ? 'animate-spin' : ''} aria-hidden="true" />
        {running > 0 ? running : tasks.length}
      </button>
      {open && (
        <div className="tasks-pop" role="dialog" aria-label={t('tasks_indicator')}>
          {tasks.map(tk => (
            <div key={tk.id} className={`tasks-item tasks-${tk.status}`}>
              <span className="tasks-item-label" title={tk.label}>
                {tk.label}
              </span>
              <span className="tasks-item-prog">
                {tk.status === 'running'
                  ? tk.total > 0
                    ? `${tk.done}/${tk.total}`
                    : '…'
                  : t(`tasks_status_${tk.status}`)}
              </span>
              {tk.status === 'running' && tk.cancellable && (
                <button
                  className="tasks-item-x"
                  onClick={() => cancel(tk.id)}
                  title={t('tasks_cancel')}
                  aria-label={t('tasks_cancel')}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
