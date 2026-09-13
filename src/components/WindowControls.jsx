import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, Copy, X } from 'lucide-react'

// Кастомная «слитая» шапка окна для Windows/Linux: убираем нативную рамку и
// рисуем свои кнопки свернуть/развернуть/закрыть в стиле приложения. На macOS
// систему рисует свои трафик-лайты (titleBarStyle: Overlay) — там ничего не
// показываем и рамку не трогаем.
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')

export function WindowControls() {
  const [maximized, setMaximized] = useState(true)

  useEffect(() => {
    if (IS_MAC) return
    // CSS-хук: сдвигаем правый край топбара под кнопки окна.
    document.documentElement.dataset.chrome = 'custom'
    const w = getCurrentWindow()
    // Снимаем нативную рамку — дальше рисуем свою шапку.
    w.setDecorations(false).catch(() => {})
    let unlisten
    const sync = () =>
      w
        .isMaximized()
        .then(setMaximized)
        .catch(() => {})
    sync()
    w.onResized(sync)
      .then(u => {
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
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          className="win-ctl"
          onClick={() => w.toggleMaximize()}
          aria-label={maximized ? 'Восстановить' : 'Развернуть'}
          title={maximized ? 'Восстановить' : 'Развернуть'}
        >
          {maximized ? (
            <Copy size={12} aria-hidden="true" />
          ) : (
            <Square size={12} aria-hidden="true" />
          )}
        </button>
        <button
          className="win-ctl win-ctl-close"
          onClick={() => w.close()}
          aria-label="Закрыть"
          title="Закрыть"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </>
  )
}
