import { invoke } from '@tauri-apps/api/core'

// REDESIGN-05-6: десктоп-натив — трей/окна/panic. Настройки живут вне БД
// (desktop.json рядом с vaultbase.db), поэтому доступны до разблокировки.
export const desktopApi = {
  getConfig: () => invoke('desktop_get_config'),
  setStartMinimized: flag => invoke('desktop_set_start_minimized', { flag }),
  setFloatAot: flag => invoke('desktop_set_float_aot', { flag }),
  // null/'' — снять хоткей; возвращает нормализованную строку или null
  setPanicHotkey: hotkey => invoke('desktop_set_panic_hotkey', { hotkey }),
  applyWindowPreset: preset => invoke('window_apply_preset', { preset }),
  resetWindowLayout: () => invoke('window_reset_layout'),
  // pin = panic-пароль (MGR-013). При успехе процесс завершается — ответа нет.
  panicWipe: pin => invoke('panic_wipe', { pin }),
}
