import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

/**
 * UX-016: Track sync server online/offline status.
 * Listens to server_online / server_offline events from Rust background thread.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const unlisteners = []
    listen('server_online', () => setOnline(true)).then(u => unlisteners.push(u))
    listen('server_offline', () => setOnline(false)).then(u => unlisteners.push(u))
    return () => unlisteners.forEach(u => u())
  }, [])

  return online
}
