import { useState, useCallback } from 'react';

export function useCopyFlash() {
  const [flashKey, setFlashKey] = useState(null);

  const flash = useCallback((key, text) => {
    if (text) navigator.clipboard.writeText(text).catch(() => {});
    setFlashKey(key);
    setTimeout(() => setFlashKey(null), 300);
  }, []);

  return { flash, isFlashing: (key) => flashKey === key };
}
