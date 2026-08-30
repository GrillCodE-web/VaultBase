import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

const STALE_MS = 5 * 60 * 1000
const RECHECK_MS = 30 * 1000
const POLL_MS = 60 * 1000

// Парсинг DB-даты «YYYY-MM-DD HH:MM:SS» (UTC) в ms; NaN при мусоре
function parseDbUtc(s) {
  if (!s || typeof s !== 'string') return null
  const ms = Date.parse(`${s.replace(' ', 'T')}Z`)
  return Number.isNaN(ms) ? null : ms
}

/**
 * REDESIGN-05-4 (порция 2): индикатор «данные устарели».
 * lastSyncAt берём из sync_get_group_status (config sync_last_at) и обновляем
 * на событиях входящего sync (sync:full_data / sync:card_update / ...).
 * stale = последний sync старше 5 минут. В solo-режиме (last_sync пуст)
 * индикатор не показываем — устаревать просто нечему.
 */
export function useSyncFreshness() {
  const [lastSyncAt, setLastSyncAt] = useState(null)
  // тик для пересчёта stale без поллинга backend
  const [nowTick, setNowTick] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      const st = await invoke('sync_get_group_status')
      const ms = parseDbUtc(st?.last_sync)
      if (ms != null) setLastSyncAt(ms)
    } catch {
      /* sync не настроен — индикатор молчит */
    }
  }, [])

  useEffect(() => {
    refresh()
    const poll = setInterval(refresh, POLL_MS)
    const tick = setInterval(() => setNowTick(Date.now()), RECHECK_MS)
    let unlisteners = []
    let alive = true
    const events = ['sync:full_data', 'sync:card_update', 'sync:settings_update']
    Promise.all(events.map(ev => listen(ev, () => setLastSyncAt(Date.now())))).then(fns => {
      if (alive) unlisteners = fns
      else fns.forEach(u => u())
    })
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(tick)
      unlisteners.forEach(u => u())
    }
  }, [refresh])

  const stale = lastSyncAt != null && nowTick - lastSyncAt > STALE_MS
  return { stale, lastSyncAt, refresh }
}
