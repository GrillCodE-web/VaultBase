import { create } from 'zustand'

let _tid = 0
const DONE_TTL = 4000
const _cancelHandlers = new Map()

/**
 * REDESIGN-05-4 (порция 3): реестр фоновых задач. Длительные операции
 * (пакетная проверка прокси, поиск по всем IMAP-папкам и т.п.) регистрируются
 * через start()/progress()/finish(); статус-бар показывает индикатор с
 * возможностью отмены (cancel вызывает onCancel из start).
 *
 * task: { id, label, done, total, cancellable,
 *         status: 'running'|'done'|'cancelled'|'error', ts }
 */
export const useTasksStore = create(set => ({
  tasks: [],

  start: (label, { total = 0, cancellable = false, onCancel = null } = {}) => {
    const id = ++_tid
    if (cancellable && onCancel) _cancelHandlers.set(id, onCancel)
    set(s => ({
      tasks: [
        ...s.tasks,
        {
          id,
          label,
          done: 0,
          total,
          cancellable: cancellable && !!onCancel,
          status: 'running',
          ts: Date.now(),
        },
      ],
    }))
    return id
  },

  progress: (id, done, total) =>
    set(s => ({
      tasks: s.tasks.map(t => (t.id === id ? { ...t, done, total: total ?? t.total } : t)),
    })),

  finish: (id, status = 'done') => {
    _cancelHandlers.delete(id)
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, status } : t)) }))
    setTimeout(() => set(s => ({ tasks: s.tasks.filter(t => t.id !== id) })), DONE_TTL)
  },

  cancel: id => {
    const fn = _cancelHandlers.get(id)
    _cancelHandlers.delete(id)
    if (fn) fn()
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, status: 'cancelled' } : t)) }))
    setTimeout(() => set(s => ({ tasks: s.tasks.filter(t => t.id !== id) })), DONE_TTL)
  },
}))
