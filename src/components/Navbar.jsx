// Navbar — Top navigation bar with user info, badges, and search
// FIX F-MED-03: Extracted from App.jsx

import { useLang } from '../hooks/useLang'
import { Bell, Sun, Moon, Lock, LogOut } from 'lucide-react'
import { GlobalSearch } from './GlobalSearch'

export function Navbar({ badges, theme, onToggleTheme, onLock, onLogout, onNavigate, toast }) {
  const { t } = useLang()
  return (
    <header className="h-14 border-b border-var(--border) flex items-center justify-between px-4 bg-var(--bg)">
      {/* Left: Page title would go here */}
      <div className="flex-1" />

      {/* Center: Global Search */}
      <GlobalSearch onNavigate={onNavigate} toast={toast} />

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* IMAP Badge */}
        {badges?.unread_imap > 0 && (
          <button
            onClick={() => onNavigate('imap')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-var(--accent) hover:bg-var(--accent)/80 transition-colors"
            title={`${badges.unread_imap} unread emails`}
          >
            <Bell size={14} />
            <span className="text-xs font-medium">{badges.unread_imap}</span>
          </button>
        )}

        {/* Theme Toggle */}
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-var(--accent) rounded transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Lock */}
        <button
          onClick={onLock}
          className="p-2 hover:bg-var(--accent) rounded transition-colors"
          title={`${t('lock')} (Ctrl+L)`}
        >
          <Lock size={16} />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="p-2 hover:bg-red-500/10 text-red-500 rounded transition-colors"
          title={t('logout')}
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
