import { useEffect, useRef } from 'react'

/**
 * Escape закрывает модалку. onClose через ref — слушатель не пересоздаётся
 * при каждом рендере. Модалки монтируются только когда открыты, поэтому
 * флаг active не нужен.
 */
export function useEscapeKey(onClose) {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  }, [onClose])
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') ref.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
}
