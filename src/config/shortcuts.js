// Keyboard shortcuts configuration for VaultBase

export const SHORTCUTS = {
  // Navigation shortcuts
  navigation: {
    dashboard: {
      keys: ['Alt+1', 'g d'],
      description: 'Go to Dashboard',
      action: 'navigate:dashboard',
    },
    cards: {
      keys: ['Alt+2', 'g c'],
      description: 'Go to Cards',
      action: 'navigate:cards',
    },
    profiles: {
      keys: ['Alt+3', 'g p'],
      description: 'Go to Profiles',
      action: 'navigate:profiles',
    },
    orders: {
      keys: ['Alt+4', 'g o'],
      description: 'Go to Orders',
      action: 'navigate:orders',
    },
    shops: {
      keys: ['Alt+5'],
      description: 'Go to Shops',
      action: 'navigate:shops',
    },
    proxies: {
      keys: ['Alt+6'],
      description: 'Go to Proxies',
      action: 'navigate:proxies',
    },
    imap: {
      keys: ['Alt+7'],
      description: 'Go to IMAP',
      action: 'navigate:imap',
    },
    activity: {
      keys: ['Alt+8'],
      description: 'Go to Activity Log',
      action: 'navigate:activity_log',
    },
    updates: {
      keys: ['Alt+9'],
      description: 'Go to Updates',
      action: 'navigate:updates',
    },
    settings: {
      keys: ['Alt+0', 'Cmd+,', 'Ctrl+,'],
      description: 'Go to Settings',
      action: 'navigate:settings',
    },
  },

  // Global actions
  global: {
    search: {
      keys: ['Cmd+K', 'Ctrl+K'],
      description: 'Global search',
      action: 'global:search',
    },
    focusSearch: {
      keys: ['/', 'f', 'Cmd+F', 'Ctrl+F'],
      description: 'Focus search input',
      action: 'global:focus-search',
      requireNoInput: true,
    },
    refresh: {
      keys: ['r', 'Cmd+R', 'Ctrl+R'],
      description: 'Refresh current page',
      action: 'global:refresh',
      requireNoInput: true,
    },
    new: {
      keys: ['n', 'Cmd+N', 'Ctrl+N'],
      description: 'Create new item',
      action: 'global:new',
      requireNoInput: true,
    },
    save: {
      keys: ['Cmd+S', 'Ctrl+S'],
      description: 'Save (in forms)',
      action: 'global:save',
    },
    close: {
      keys: ['Escape'],
      description: 'Close modal/panel',
      action: 'global:close',
    },
    help: {
      keys: ['?'],
      description: 'Show keyboard shortcuts',
      action: 'global:help',
      requireNoInput: true,
    },
  },

  // Page-specific shortcuts
  cards: {
    export: {
      keys: ['e', 'Cmd+E', 'Ctrl+E'],
      description: 'Export cards',
      action: 'cards:export',
      requireNoInput: true,
      page: 'cards',
    },
  },

  orders: {
    create: {
      keys: ['o'],
      description: 'Create new order',
      action: 'orders:create',
      requireNoInput: true,
      page: 'orders',
    },
    batchImport: {
      keys: ['b'],
      description: 'Batch import orders',
      action: 'orders:batch',
      requireNoInput: true,
      page: 'orders',
    },
  },

  profiles: {
    create: {
      keys: ['p'],
      description: 'Create new profile',
      action: 'profiles:create',
      requireNoInput: true,
      page: 'profiles',
    },
    addDrop: {
      keys: ['d'],
      description: 'Add drop address',
      action: 'profiles:drop',
      requireNoInput: true,
      page: 'profiles',
    },
  },

  settings: {
    save: {
      keys: ['s', 'Cmd+S', 'Ctrl+S'],
      description: 'Save settings',
      action: 'settings:save',
      requireNoInput: true,
      page: 'settings',
    },
  },
}

// UX-022: conflict detection — та же клавиша/комбо на двух разных действиях
// одной области видимости (global или одна страница). Вызывается один раз при
// загрузке config; в dev кидает, чтобы конфликт не прошёл незамеченным.
export function findShortcutConflicts() {
  const seen = new Map() // key -> "category:action"
  const conflicts = []
  Object.entries(SHORTCUTS).forEach(([category, shortcuts]) => {
    Object.entries(shortcuts).forEach(([action, config]) => {
      for (const rawKey of config.keys) {
        // секвенции ('g d') не конфликтуют с одиночными/модификаторными
        if (rawKey.includes(' ')) continue
        const norm = rawKey.replace(/Cmd/gi, 'Ctrl').toLowerCase()
        const scope = config.page || 'global'
        const id = `${scope}:${norm}`
        const prev = seen.get(id)
        if (prev && prev !== `${category}:${action}`) {
          conflicts.push({ key: rawKey, scope, a: prev, b: `${category}:${action}` })
        }
        seen.set(id, `${category}:${action}`)
      }
    })
  })
  return conflicts
}

// Helper to get all shortcuts as flat array
export function getAllShortcuts() {
  const result = []
  Object.entries(SHORTCUTS).forEach(([category, shortcuts]) => {
    Object.entries(shortcuts).forEach(([key, config]) => {
      result.push({
        ...config,
        category,
        id: `${category}:${key}`,
      })
    })
  })
  return result
}

// Helper to get shortcuts by category
export function getShortcutsByCategory() {
  return {
    Navigation: getAllShortcuts().filter(s => s.category === 'navigation'),
    'Global Actions': getAllShortcuts().filter(s => s.category === 'global'),
    'Cards Page': getAllShortcuts().filter(s => s.category === 'cards'),
    'Orders Page': getAllShortcuts().filter(s => s.category === 'orders'),
    'Profiles Page': getAllShortcuts().filter(s => s.category === 'profiles'),
    'Settings Page': getAllShortcuts().filter(s => s.category === 'settings'),
  }
}

// Helper to check if user is in an input field
export function isInInputField() {
  const el = document.activeElement
  return (
    el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.contentEditable === 'true')
  )
}

// Helper to format key for display (Mac vs Windows)
export function formatKeyForDisplay(key) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  if (isMac) {
    return key
      .replace(/Ctrl/g, '⌃')
      .replace(/Alt/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/Meta/g, '⌘')
      .replace(/Cmd/g, '⌘')
  }
  return key
}
