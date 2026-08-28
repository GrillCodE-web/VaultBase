// UX-012: нативные OS-уведомления через @tauri-apps/plugin-notification.
// Best-effort: любая ошибка (нет разрешения, locked БД, e2e/jsdom без
// window.Notification) проглатывается — уведомление не должно ронять UI.
import { invoke } from '@tauri-apps/api/core'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

// configKey: os_notify_mail / os_notify_package / os_notify_errors ('0' = выкл, дефолт вкл)
export async function osNotify(configKey, title, body) {
  try {
    const enabled = await invoke('get_config', { key: configKey }).catch(() => null)
    if (enabled === '0') return
    let granted = await isPermissionGranted().catch(() => false)
    if (!granted) {
      granted = (await requestPermission().catch(() => 'denied')) === 'granted'
    }
    if (!granted) return
    sendNotification({ title, body })
  } catch {
    // намеренно пусто — уведомления не критичны
  }
}
