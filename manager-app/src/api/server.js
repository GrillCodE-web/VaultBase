import { invoke } from '@tauri-apps/api/core'

export async function api(method, path, body) {
  return invoke('server_request', {
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
  })
}

export const getAppState = () => invoke('get_app_state')
export const setServerUrl = (url) => invoke('set_server_url', { url })
export const activateLicense = (activationKey) => invoke('activate_license', { activationKey })
export const setupMasterPassword = (password) => invoke('setup_master_password', { password })
export const unlockApp = (password) => invoke('unlock_app', { password })
export const lockApp = () => invoke('lock_app')
export const syncTelemetry = () => invoke('sync_telemetry')
export const getAnalytics = (from, to) => invoke('get_analytics', { from, to })
export const getWorkerSnapshots = () => invoke('get_worker_snapshots')
export const getWorkerStats = (installationId, days = 30) => invoke('get_worker_stats', { installationId, days })
export const evaluateAlerts = () => invoke('evaluate_alerts')
export const getLocalAlerts = (status = 'all') => invoke('get_local_alerts', { status })
export const localAlertAction = (id, action) => invoke('local_alert_action', { id, action })
export const getConfigValues = (keys) => invoke('get_config_values', { keys })
export const setConfigValue = (key, value) => invoke('set_config_value', { key, value })
export const wipeLocalData = () => invoke('wipe_local_data', { confirm: true })

export function fmtDateTime(value) {
  if (!value) return '—'
  const iso = String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

export function fmtRelative(value, lang) {
  if (!value) return '—'
  const iso = String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return lang === 'ru' ? 'только что' : 'just now'
  if (mins < 60) return lang === 'ru' ? `${mins} мин назад` : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return lang === 'ru' ? `${hours} ч назад` : `${hours}h ago`
  const days = Math.round(hours / 24)
  return lang === 'ru' ? `${days} дн назад` : `${days}d ago`
}
