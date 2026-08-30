import { useEffect } from 'react'
import { useLang } from './useLang'
import { runLiteRules } from '../utils/liteRulesRunner.js'
import { handleError } from '../utils/errorHandler.js'

const FIRST_RUN_DELAY_MS = 4000
const RERUN_INTERVAL_MS = 120_000

/**
 * REDESIGN-05-4 (порция 3): периодическая оценка lite-правил.
 * Вешается один раз в AppShell; пишет подсветку/уведомления в сторы.
 */
export function useLiteRules() {
  const { t } = useLang()
  useEffect(() => {
    const run = () => runLiteRules(t).catch(e => handleError(e, 'useLiteRules'))
    const first = setTimeout(run, FIRST_RUN_DELAY_MS)
    const timer = setInterval(run, RERUN_INTERVAL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [t])
}
