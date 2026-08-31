import { invoke } from '@tauri-apps/api/core'
import { useNotificationsStore } from '../store/notifications.js'
import { safeGetItem, safeSetItem } from './localStorage'
import { fmtMoney } from './formatting.js'
import { handleError } from './errorHandler.js'

const LS_KEY = 'vb_last_digest_date'

/**
 * REDESIGN-05-4 (порция 4): дневной дайджест в центр уведомлений.
 * Раз в календарный день (UTC) после входа: статистика «сегодня» из
 * существующей get_dashboard_stats.
 */
export async function maybeSendDailyDigest(t) {
  const today = new Date().toISOString().slice(0, 10)
  if (safeGetItem(LS_KEY) === today) return
  try {
    const s = await invoke('get_dashboard_stats', { period: 'today', from: null, to: null })
    useNotificationsStore.getState().add({
      kind: 'system',
      severity: 'info',
      title: t('digest_title'),
      body: t('digest_body', {
        orders: s?.total_orders ?? 0,
        delivered: s?.delivered ?? 0,
        declined: s?.declined ?? 0,
        revenue: fmtMoney(s?.revenue ?? 0),
      }),
      key: `digest:${today}`,
    })
    safeSetItem(LS_KEY, today)
  } catch (e) {
    handleError(e, 'dailyDigest')
  }
}
