import { useState, useEffect } from 'react'

/**
 * Theme management hook
 * Persists theme preference to localStorage and applies to document root
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first, fallback to dark
    const saved = localStorage.getItem('theme')
    return saved || 'dark'
  })

  useEffect(() => {
    // Apply theme to document root
    document.documentElement.setAttribute('data-theme', theme)
    // Persist to localStorage
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  return { theme, setTheme, toggleTheme }
}
