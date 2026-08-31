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
 * lastSyncAt берём из config sync_last_at (пишется забором срезов, MGR-018)
 * и обновляем на событиях входящего sync (slices_received / ...).
 * stale = последний sync старше 5 минут. В solo-режиме (last_sync пуст)
 * индикатор не показываем — устаревать просто нечему.
 */
export function useSyncFreshness() {
  const [lastSyncAt, setLastSyncAt] = useState(null)
  // тик для пересчёта stale без поллинга backend
  const [nowTick, setNowTick] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      // MGR-018 (этап E1): sync_get_group_status выпилена вместе с группами —
      // метку sync_last_at теперь пишет забор срезов (commands/slices.rs).
      const v = await invoke('get_config', { key: 'sync_last_at' })
      const ms = parseDbUtc(v)
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
    // sync:full_data/sync:card_update (групповой sync) выпилены в MGR-018 E1;
    // свежесть теперь отмечает приём срезов от менеджера.
    const events = ['slices_received', 'sync:settings_update']
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
