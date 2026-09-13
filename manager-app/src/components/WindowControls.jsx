import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Кастомная «слитая» шапка окна для Windows/Linux: убираем нативную рамку и
// рисуем свои кнопки. На macOS система рисует свои трафик-лайты — там ничего
// не показываем и рамку не трогаем.
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac/i.test(
    navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ''
  )

export default function WindowControls() {
  const [maximized, setMaximized] = useState(true)

  useEffect(() => {
    if (IS_MAC) return
    document.documentElement.dataset.chrome = 'custom'
    const w = getCurrentWindow()
    w.setDecorations(false).catch(() => {})
    let unlisten
    const sync = () => w.isMaximized().then(setMaximized).catch(() => {})
    sync()
    w.onResized(sync)
      .then((u) => {
        unlisten = u
      })
      .catch(() => {})
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  if (IS_MAC) return null

  const w = getCurrentWindow()
  return (
    <>
      <div className="win-drag-strip" data-tauri-drag-region />
      <div className="win-controls">
        <button
          className="win-ctl"
          onClick={() => w.minimize()}
          aria-label="Свернуть"
          title="Свернуть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5 H10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="win-ctl"
          onClick={() => w.toggleMaximize()}
          aria-label={maximized ? 'Восстановить' : 'Развернуть'}
          title={maximized ? 'Восстановить' : 'Развернуть'}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M2.5 2.5 V0.5 H8.5 V6.5 H6.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="win-ctl win-ctl-close"
          onClick={() => w.close()}
          aria-label="Закрыть"
          title="Закрыть"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </>
  )
}
