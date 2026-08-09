// Сброс кеша WebView при смене версии сборки.
//
// КАК РАБОТАЕТ КЕШИРОВАНИЕ В TAURI:
// Tauri раздаёт фронт через кастомный протокол tauri://localhost/.
// WebView2 (Windows) и WKWebView (macOS) кешируют ответы этого протокола
// в ДВУХ разных слоях:
//
//   1. HTTP disk-кеш (основной, проблемный):
//      Windows: %LOCALAPPDATA%\com.vaultbase.app\EBWebView
//      macOS:   ~/Library/WebKit/com.vaultbase.app/...
//      Переживает переустановку приложения. Из JS НЕДОСТУПЕН.
//      → Исправлено в main.rs (purge_old_webview_cache): Rust удаляет папку
//        EBWebView до инициализации WebView2, когда версия приложения меняется.
//
//   2. Cache Storage API (SW-кеш, вторичный):
//      Доступен из JS через caches.keys() / caches.delete().
//      Обычно пуст (нет Service Worker-ов), но чистим на всякий случай.
//
// ПОЧЕМУ ОДНИХ ХЕШЕЙ В ИМЕНАХ ФАЙЛОВ НЕ ДОСТАТОЧНО:
// WebView2 кеширует index.html по tauri://localhost/index.html.
// При установке новой версии EBWebView не трогается → браузер отдаёт
// старый index.html из кеша → тот ссылается на старый CSS с прежним хешем
// → CSS визуально не меняется, хотя в бинарнике он уже новый.
//
// ИТОГОВОЕ РЕШЕНИЕ:
//   • Windows: Rust чистит EBWebView ДО запуска WebView2 (надёжно, всегда).
//   • Все платформы: этот модуль чистит Cache Storage и вызывает
//     clearAllBrowsingData() через Tauri API как страховку (особенно macOS/Linux).

const VERSION_KEY = 'vb_build_version'
// __APP_VERSION__ подставляется Vite на этапе сборки (define).
// Фолбэк 'dev' — для запусков без define (не должно случаться в проде).
const BUILD_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

/**
 * @returns {Promise<boolean>} true, если была перезагрузка (дальше код не идёт).
 */
export async function purgeCacheOnVersionChange() {
  let stored
  try {
    stored = localStorage.getItem(VERSION_KEY)
  } catch (err) {
    // localStorage недоступен (приватный режим/битый профиль) — тогда
    // сброс по версии невозможен, но и кеша-состояния там нет. Выходим тихо.
    if (import.meta.env.DEV) console.warn('[cache-buster] localStorage недоступен:', err)
    return false
  }

  // Первая установка (stored=null) не считается сменой версии: чистить
  // нечего, а лишняя перезагрузка на первом старте раздражает.
  // Примечание: после того как Rust удалил EBWebView, localStorage тоже пуст →
  // stored=null → мы попадём сюда и просто сохраним версию без лишнего reload.
  if (stored === null) {
    try {
      localStorage.setItem(VERSION_KEY, BUILD_VERSION)
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[cache-buster] не смог записать версию:', err)
    }
    return false
  }

  if (stored === BUILD_VERSION) return false

  // Версия сменилась — чистим всё доступное из WebView.
  if (import.meta.env.DEV) {
    console.warn(`[cache-buster] версия ${stored} → ${BUILD_VERSION}, чищу кеш`)
  }

  // 1. Cache Storage API — SW-кеш. Обычно пуст, но чистим для надёжности.
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[cache-buster] caches.delete:', err)
  }

  // 2. Service Workers — если когда-нибудь появятся, они держат свой кеш.
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[cache-buster] SW unregister:', err)
  }

  // 3. Tauri clearAllBrowsingData() — чистит HTTP disk-кеш через нативный API
  //    WebView. Работает на всех платформах (macOS/Linux/Windows).
  //    На Windows это страховка: Rust уже удалил EBWebView до запуска WebView2.
  //    Импорт динамический: вне Tauri (браузер, тесты) модуль отсутствует.
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const win = getCurrentWebviewWindow()
    if (typeof win.clearAllBrowsingData === 'function') {
      await win.clearAllBrowsingData()
    }
  } catch (err) {
    // Не Tauri-окружение или версия API без этого метода — ок, продолжаем.
    if (import.meta.env.DEV) console.warn('[cache-buster] clearAllBrowsingData:', err)
  }

  // Записываем новую версию ДО перезагрузки, иначе уйдём в цикл
  // «сменилась → перезагрузка → снова сменилась».
  try {
    localStorage.setItem(VERSION_KEY, BUILD_VERSION)
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[cache-buster] запись версии перед reload:', err)
  }

  // 4. Жёсткая перезагрузка: кеш очищен, движок дотянет свежие ассеты.
  window.location.reload()
  return true
}
