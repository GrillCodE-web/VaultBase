// AppShell — Layout component with sidebar navigation
// FIX F-MED-03: Extracted from App.jsx (1128 → ~600 lines)
import {
  LayoutDashboard,
  CreditCard,
  Users,
  ShoppingCart,
  Store,
  Shield,
  Inbox,
  ClipboardList,
  Settings as SettingsIcon,
  Globe,
  AlertTriangle,
  BookOpen,
} from 'lucide-react'

const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav_dashboard' },
  { id: 'cards', icon: CreditCard, label: 'nav_cards' },
  { id: 'profiles', icon: Users, label: 'nav_profiles' },
  { id: 'drops', icon: ShoppingCart, label: 'nav_drops' },
  { id: 'orders', icon: ShoppingCart, label: 'nav_orders' },
  { id: 'catalog', icon: BookOpen, label: 'nav_catalog' },
  { id: 'shops', icon: Store, label: 'nav_shops' },
  { id: 'proxies', icon: Shield, label: 'nav_proxies' },
  { id: 'imap', icon: Inbox, label: 'nav_imap' },
  { id: 'activity_log', icon: ClipboardList, label: 'nav_activity' },
  { id: 'updates', icon: AlertTriangle, label: 'nav_updates' },
  { id: 'settings', icon: SettingsIcon, label: 'nav_settings' },
  { id: 'onboarding', icon: Globe, label: 'nav_onboarding' },
]

export function AppShell({ currentPage, onPageChange, children, t }) {
  return (
    <div className="flex h-screen bg-var(--bg)">
      {/* Sidebar */}
      <aside className="w-56 bg-var(--card) border-r border-var(--border) flex flex-col">
        <nav className="flex-1 overflow-y-auto py-4">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  ${
                    isActive
                      ? 'bg-var(--primary)/10 text-var(--primary) border-r-2 border-var(--primary)'
                      : 'text-var(--foreground) hover:bg-var(--accent)'
                  }`}
              >
                <Icon size={18} />
                <span>{t(item.label)}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
