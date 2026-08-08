// Сброс кеша WebView2 при смене версии сборки.
//
// ПРОБЛЕМА, которую это чинит: на Windows Tauri рендерит фронт через
// системный WebView2. У него собственный HTTP-кеш в
// %LOCALAPPDATA%\com.vaultbase.app\EBWebView, который ПЕРЕЖИВАЕТ
// переустановку приложения (деинсталлятор его не трогает). Ассеты
// раздаются со стабильных tauri://-адресов, поэтому движок отдаёт старый
// закешированный фронт и игнорирует свежую сборку. Симптом: ставишь
// новую версию — визуально ничего не меняется.
//
// РЕШЕНИЕ: версию сборки Vite вшивает в бандл (см. vite.config → define
// __APP_VERSION__). При старте сравниваем её с сохранённой. Если сборка
// сменилась — чистим все кеши, доступные из WebView (Cache Storage,
// Service Workers, storage-квоту) и один раз перезагружаемся. Rust не
// может снести кеш сам: пока движок жив, файлы залочены; а изнутри JS
// эти хранилища доступны.
//
// Хеши в именах файлов (index-XX␣.css) обычно спасают от такого — но
// EBWebView кеширует и по абсолютному tauri-URL самого index.html,
// поэтому одних хешей мало. Явный сброс надёжнее.

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
  if (stored === null) {
    try {
      localStorage.setItem(VERSION_KEY, BUILD_VERSION)
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[cache-buster] не смог записать версию:', err)
    }
    return false
  }

  if (stored === BUILD_VERSION) return false

  // Версия сменилась — чистим всё, до чего дотягивается WebView.
  if (import.meta.env.DEV) {
    console.warn(`[cache-buster] версия ${stored} → ${BUILD_VERSION}, чищу кеш WebView2`)
  }

  // 1. Cache Storage API — основной HTTP-кеш ассетов.
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

  // Записываем новую версию ДО перезагрузки, иначе уйдём в цикл
  // «сменилась → перезагрузка → снова сменилась».
  try {
    localStorage.setItem(VERSION_KEY, BUILD_VERSION)
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[cache-buster] запись версии перед reload:', err)
  }

  // 3. Жёсткая перезагрузка: теперь кеш пуст, движок дотянет свежие ассеты.
  window.location.reload()
  return true
}
